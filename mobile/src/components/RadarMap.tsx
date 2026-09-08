import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  Camera,
  GeoJSONSource,
  ImageSource,
  Layer,
  Map,
  Marker,
  RasterSource,
  UserLocation,
  type CameraRef,
} from "@maplibre/maplibre-react-native";
import {
  MAX_NATIVE_TILE_ZOOM,
  radarTileUrl,
  type RadarFrame,
  type RadarIndex,
} from "@shared/radar";
import {
  SAT_MAX_NATIVE_ZOOM,
  SAT_TILE_SIZE,
  satelliteTileUrl,
} from "@shared/satellite";
import type { ScoredSegment } from "@shared/types";
import type { CloudField } from "../lib/cloudImage";
import {
  CLOUD_ANCHOR_LAYER,
  MAP_STYLE,
  RADAR_ANCHOR_LAYER,
} from "../lib/mapStyle";
import { buildRouteChunks, routeCoordinates } from "../lib/routeChunks";
import {
  CLOUD_FADE_MS as FADE_MS,
  CLOUD_PRELOAD_MS as PRELOAD_MS,
} from "../lib/timing";
import type { MapLayers } from "./LayerSwitcher";
import { theme } from "../theme";

export interface MapRegion {
  latitude: number;
  longitude: number;
  zoom: number;
}

// Зум/локация живут в App.tsx рядом с LayerSwitcher — единым столбцом
// кнопок, чтобы два независимо позиционированных стека никогда не
// накладывались друг на друга. RadarMap отдаёт наружу только зум.
export interface RadarMapHandle {
  zoomIn: () => void;
  zoomOut: () => void;
}

interface RadarMapProps {
  segments: ScoredSegment[];
  radarIndex: RadarIndex | null;
  // Кадр радара на отображаемый момент; null — момент вне покрытия радара.
  radarFrame: RadarFrame | null;
  radarOpacity: number;
  riderPosition: { lat: number; lon: number; distanceKm: number } | null;
  // Модельное поле облачности — на моменты, куда не достаёт снимок.
  cloudField: CloudField | null;
  // Кадр спутника на отображаемый момент; null — момент вне архива снимков.
  satelliteFrame: Date | null;
  layers: MapLayers;
  // Камера на старте и пока маршрут не загружен — геолокация или фолбэк.
  defaultRegion: MapRegion;
}

const ZOOM_STEP = 1;
const MIN_ZOOM = 2;
// Выше родного разрешения снимка (~2 км) поднимать некуда: дальше карта только
// растягивает те же пиксели. Weather&Radar по той же причине держит потолок 10.
const MAX_ZOOM = 11;

const EDGE_PADDING = { top: 150, right: 60, bottom: 280, left: 60 };
const LABEL_COUNT = 5;

// Что показывает слой облачности в конкретный момент: снимок или модель.
type CloudContent =
  | { kind: "satellite"; key: string; frame: Date }
  | { kind: "model"; key: string; field: CloudField };

interface CloudSlot {
  content: CloudContent | null;
  opacity: number;
}

const EMPTY_SLOT: CloudSlot = { content: null, opacity: 0 };

// Равномерно выбирает до `count` сегментов для подписей и стрелок.
function pickEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  return Array.from(
    { length: count },
    (_, i) => items[Math.round((i / (count - 1)) * (items.length - 1))],
  );
}

// Слой облачности перелистывается кроссфейдом: новый кадр монтируется вторым
// слотом, получает фору на загрузку тайлов и проявляется поверх старого. Пока
// он проявляется, старый лежит под ним непрозрачным, поэтому суммарная
// плотность не проседает и «мигания» карты между кадрами не видно.
//
// Это то же, что делает Weather&Radar, только у них слои — текстуры в WebGL,
// а здесь за смешивание отвечает сам MapLibre.
function useCloudCrossfade(desired: CloudContent | null): {
  slots: [CloudSlot, CloudSlot];
  ids: [string, string];
} {
  const [slots, setSlots] = useState<[CloudSlot, CloudSlot]>([
    EMPTY_SLOT,
    EMPTY_SLOT,
  ]);
  // Индекс слота, который сейчас показывается; новый кадр всегда едет в другой.
  const activeRef = useRef(0);

  const desiredKey = desired?.key ?? null;

  useEffect(() => {
    if (!desiredKey) {
      activeRef.current = 0;
      setSlots([EMPTY_SLOT, EMPTY_SLOT]);
      return;
    }
    if (!desired) return;

    const active = activeRef.current;
    if (slots[active].content?.key === desiredKey) return;

    const incoming = active === 0 ? 1 : 0;

    // Первый кадр показываем сразу: проявлять не из чего, а задержка на пустой
    // карте выглядит как подвисание.
    if (!slots[active].content) {
      activeRef.current = incoming;
      setSlots((prev) => {
        const next: [CloudSlot, CloudSlot] = [...prev] as [CloudSlot, CloudSlot];
        next[incoming] = { content: desired, opacity: 1 };
        return next;
      });
      return;
    }

    setSlots((prev) => {
      const next: [CloudSlot, CloudSlot] = [...prev] as [CloudSlot, CloudSlot];
      next[incoming] = { content: desired, opacity: 0 };
      return next;
    });

    const fadeIn = setTimeout(() => {
      setSlots((prev) => {
        const next: [CloudSlot, CloudSlot] = [...prev] as [CloudSlot, CloudSlot];
        next[incoming] = { ...next[incoming], opacity: 1 };
        return next;
      });
    }, PRELOAD_MS);

    // Старый кадр гасим только когда новый уже полностью проявился.
    const drop = setTimeout(() => {
      activeRef.current = incoming;
      setSlots((prev) => {
        const next: [CloudSlot, CloudSlot] = [...prev] as [CloudSlot, CloudSlot];
        next[active] = EMPTY_SLOT;
        return next;
      });
    }, PRELOAD_MS + FADE_MS);

    return () => {
      clearTimeout(fadeIn);
      clearTimeout(drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desiredKey]);

  return { slots, ids: ["cloud-0", "cloud-1"] };
}

function CloudLayer({
  id,
  slot,
}: {
  id: string;
  slot: CloudSlot;
}) {
  const { content, opacity } = slot;
  if (!content) return null;

  const paint = {
    "raster-opacity": opacity,
    "raster-opacity-transition": { duration: FADE_MS, delay: 0 },
  } as const;

  // Идентификатор источника уникален для каждого кадра, а не для слота. Иначе
  // при пересоздании новый источник заявляется под тем же именем, что ещё не
  // снятый старый, — и MapLibre отвергает его («Failed to load source»).
  // Особенно заметно на стыке «снимок → модель»: там ещё и тип источника разный.
  const sourceId = `${id}-${content.key.replace(/[^a-zA-Z0-9]+/g, "-")}`;

  if (content.kind === "satellite") {
    return (
      <RasterSource
        // Ключ по кадру: источник в MapLibre неизменяемый, новый адрес тайлов
        // требует пересоздания.
        key={content.key}
        id={sourceId}
        tiles={[satelliteTileUrl(content.frame)]}
        tileSize={SAT_TILE_SIZE}
        maxzoom={SAT_MAX_NATIVE_ZOOM}
      >
        <Layer
          id={`${sourceId}-layer`}
          type="raster"
          beforeId={CLOUD_ANCHOR_LAYER}
          paint={paint}
        />
      </RasterSource>
    );
  }

  return (
    <ImageSource
      key={content.key}
      id={sourceId}
      url={content.field.uri}
      coordinates={content.field.coordinates}
    >
      <Layer
        id={`${sourceId}-layer`}
        type="raster"
        beforeId={CLOUD_ANCHOR_LAYER}
        paint={paint}
      />
    </ImageSource>
  );
}

export const RadarMap = forwardRef<RadarMapHandle, RadarMapProps>(
  function RadarMap(
    {
      segments,
      radarIndex,
      radarFrame,
      radarOpacity,
      riderPosition,
      cloudField,
      satelliteFrame,
      layers,
      defaultRegion,
    },
    ref,
  ) {
    const cameraRef = useRef<CameraRef>(null);
    // Текущий зум нужен только для кнопок +/− — держим в ref, чтобы не гонять
    // лишний рендер на каждый жест панорамирования.
    const zoomRef = useRef(defaultRegion.zoom);

    const coordinates = routeCoordinates(segments);
    const chunks = buildRouteChunks(segments);

    const zoomBy = useCallback((delta: number) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current + delta));
      zoomRef.current = next;
      cameraRef.current?.zoomTo(next, { duration: 250 });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        zoomIn: () => zoomBy(ZOOM_STEP),
        zoomOut: () => zoomBy(-ZOOM_STEP),
      }),
      [zoomBy],
    );

    // Подгоняем камеру только при смене геометрии маршрута: при перемотке времени
    // сегменты пересчитываются заново, и рефит сбрасывал бы ручной зум.
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    const routeKey = first
      ? `${coordinates.length}:${first.latitude},${first.longitude}:${last.latitude},${last.longitude}`
      : "";

    useEffect(() => {
      if (coordinates.length === 0) return;
      let west = Infinity;
      let south = Infinity;
      let east = -Infinity;
      let north = -Infinity;
      for (const c of coordinates) {
        west = Math.min(west, c.longitude);
        east = Math.max(east, c.longitude);
        south = Math.min(south, c.latitude);
        north = Math.max(north, c.latitude);
      }
      cameraRef.current?.fitBounds([west, south, east, north], {
        padding: EDGE_PADDING,
        duration: 600,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routeKey]);

    // Геолокация приходит асинхронно, уже после первого рендера карты, а
    // initialViewState применяется только один раз — без этого камера так и
    // осталась бы на фолбэке. С маршрутом камерой распоряжается рефит выше.
    useEffect(() => {
      if (coordinates.length > 0) return;
      cameraRef.current?.flyTo({
        center: [defaultRegion.longitude, defaultRegion.latitude],
        zoom: defaultRegion.zoom,
        duration: 700,
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [defaultRegion.latitude, defaultRegion.longitude]);

    // Снимок покрывает прошлое и «сейчас», модель — всё, что дальше.
    const cloudContent = useMemo<CloudContent | null>(() => {
      if (!layers.clouds) return null;
      if (satelliteFrame) {
        return {
          kind: "satellite",
          key: `sat-${satelliteFrame.toISOString()}`,
          frame: satelliteFrame,
        };
      }
      if (cloudField) {
        return { kind: "model", key: `model-${cloudField.uri}`, field: cloudField };
      }
      return null;
    }, [layers.clouds, satelliteFrame, cloudField]);

    const { slots, ids } = useCloudCrossfade(cloudContent);

    // Весь маршрут — один слой: цвет берётся из свойства линии, поэтому сотня
    // кусков не превращается в сотню слоёв.
    const routeGeoJson = useMemo(
      () => ({
        type: "FeatureCollection" as const,
        features: chunks.map((chunk, i) => ({
          type: "Feature" as const,
          id: i,
          properties: { color: chunk.color },
          geometry: {
            type: "LineString" as const,
            coordinates: chunk.coordinates.map(
              (c) => [c.longitude, c.latitude] as [number, number],
            ),
          },
        })),
      }),
      [chunks],
    );

    return (
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE}
        logo={false}
        attribution={false}
        compass={false}
        scaleBar={false}
        touchRotate={false}
        touchPitch={false}
        onRegionDidChange={(e) => {
          zoomRef.current = e.nativeEvent.zoom;
        }}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            center: [defaultRegion.longitude, defaultRegion.latitude],
            zoom: defaultRegion.zoom,
          }}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
        />

        <CloudLayer id={ids[0]} slot={slots[0]} />
        <CloudLayer id={ids[1]} slot={slots[1]} />

        {layers.rain && radarIndex && radarFrame && (
          <RasterSource
            key={radarFrame.path}
            id="radar-src"
            tiles={[radarTileUrl(radarIndex, radarFrame)]}
            tileSize={512}
            // Бесплатный тайлкеш RainViewer отдаёт мозаику только до z=7,
            // выше MapLibre сам растягивает последний доступный уровень.
            maxzoom={MAX_NATIVE_TILE_ZOOM}
          >
            <Layer
              id="radar-layer"
              type="raster"
              beforeId={RADAR_ANCHOR_LAYER}
              paint={{
                "raster-opacity": radarOpacity,
                "raster-opacity-transition": { duration: FADE_MS, delay: 0 },
              }}
            />
          </RasterSource>
        )}

        {chunks.length > 0 && (
          <GeoJSONSource id="route-src" data={routeGeoJson}>
            <Layer
              id="route-casing"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{
                "line-color": "rgba(10, 12, 16, 0.55)",
                "line-width": 9,
              }}
            />
            <Layer
              id="route-line"
              type="line"
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{ "line-color": ["get", "color"], "line-width": 5 }}
            />
          </GeoJSONSource>
        )}

        <UserLocation />

        {first && (
          <Marker lngLat={[first.longitude, first.latitude]} anchor="center">
            <View style={[styles.endpoint, { backgroundColor: theme.start }]}>
              <Text style={styles.endpointLabel}>С</Text>
            </View>
          </Marker>
        )}

        {last && coordinates.length > 1 && (
          <Marker lngLat={[last.longitude, last.latitude]} anchor="center">
            <View style={[styles.endpoint, { backgroundColor: theme.finish }]}>
              <Text style={styles.endpointLabel}>Ф</Text>
            </View>
          </Marker>
        )}

        {layers.temperature &&
          pickEvenly(segments, LABEL_COUNT).map((segment, i) =>
            segment.temperature === null ? null : (
              <Marker
                key={`temp-${i}`}
                lngLat={[
                  (segment.start.lon + segment.end.lon) / 2,
                  (segment.start.lat + segment.end.lat) / 2,
                ]}
                anchor="center"
              >
                <View style={styles.tempPill}>
                  <Text style={styles.tempText}>
                    {Math.round(segment.temperature)}°
                  </Text>
                </View>
              </Marker>
            ),
          )}

        {layers.wind &&
          pickEvenly(segments, LABEL_COUNT).map((segment, i) => (
            <Marker
              key={`wind-${i}`}
              lngLat={[
                (segment.start.lon + segment.end.lon) / 2,
                (segment.start.lat + segment.end.lat) / 2,
              ]}
              anchor="center"
            >
              <View style={styles.windMarker}>
                {/* Стрелка смотрит туда, куда дует ветер: направление в прогнозе —
                    откуда, поэтому разворачиваем на 180°. */}
                <Text
                  style={[
                    styles.windArrow,
                    {
                      transform: [
                        { rotate: `${(segment.windDirection + 180) % 360}deg` },
                      ],
                    },
                  ]}
                >
                  ➤
                </Text>
                <Text style={styles.windSpeed}>
                  {segment.windSpeed.toFixed(0)}
                </Text>
              </View>
            </Marker>
          ))}

        {riderPosition && (
          <Marker
            lngLat={[riderPosition.lon, riderPosition.lat]}
            anchor="center"
          >
            <View style={styles.rider}>
              <View style={styles.riderDot} />
              <Text style={styles.riderLabel}>
                {riderPosition.distanceKm.toFixed(0)} км
              </Text>
            </View>
          </Marker>
        )}
      </Map>
    );
  },
);

const styles = StyleSheet.create({
  endpoint: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  endpointLabel: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
  },
  rider: {
    alignItems: "center",
  },
  riderDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.rider,
    borderWidth: 3,
    borderColor: "#fff",
  },
  tempPill: {
    backgroundColor: "rgba(20, 22, 26, 0.82)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 9,
  },
  tempText: {
    color: "#ffd24a",
    fontSize: 13,
    fontWeight: "700",
  },
  windMarker: {
    alignItems: "center",
  },
  windArrow: {
    fontSize: 20,
    color: "#eaf4ff",
    textShadowColor: "rgba(0,0,0,0.75)",
    textShadowRadius: 3,
  },
  windSpeed: {
    color: "#eaf4ff",
    fontSize: 10,
    fontWeight: "700",
    textShadowColor: "rgba(0,0,0,0.8)",
    textShadowRadius: 3,
  },
  riderLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
    color: "#7a4a00",
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    paddingHorizontal: 4,
    borderRadius: 3,
    overflow: "hidden",
  },
});
