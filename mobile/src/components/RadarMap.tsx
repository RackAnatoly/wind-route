import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import MapView, {
  Marker,
  Polyline,
  UrlTile,
  WMSTile,
  type Region,
} from "react-native-maps";
import {
  MAX_NATIVE_TILE_ZOOM,
  radarTileUrl,
  type RadarFrame,
  type RadarIndex,
} from "@shared/radar";
import {
  SAT_MAX_NATIVE_ZOOM,
  satelliteTileUrl,
} from "@shared/satellite";
import type { ScoredSegment } from "@shared/types";
import type { CloudTiles } from "../lib/cloudTiles";
import { buildRouteChunks, routeCoordinates } from "../lib/routeChunks";
import type { MapLayers } from "./LayerSwitcher";
import { theme } from "../theme";

export type MapRegion = Region;

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
  cloudTiles: CloudTiles | null;
  // Кадр спутника на отображаемый момент; null — момент вне архива снимков
  // (будущее), тогда облачность рисуется из модельной сетки.
  satelliteFrame: Date | null;
  layers: MapLayers;
  // Камера на старте и пока маршрут не загружен — геолокация или фолбэк.
  defaultRegion: MapRegion;
}

// Кратность приближения/отдаления по кнопкам зума.
const ZOOM_FACTOR = 0.5;

// Снимок непрозрачный: под ним лежит своя суша и своё море. Оставляем карту
// просвечивать, иначе на iOS пропадут названия городов — тайловые слои MapKit
// рисуются поверх подписей.
const CLOUD_OPACITY = 0.82;

const EDGE_PADDING = { top: 140, right: 60, bottom: 260, left: 60 };
const LABEL_COUNT = 5;

// Равномерно выбирает до `count` сегментов для подписей и стрелок.
function pickEvenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  return Array.from(
    { length: count },
    (_, i) => items[Math.round((i / (count - 1)) * (items.length - 1))],
  );
}

export const RadarMap = forwardRef<RadarMapHandle, RadarMapProps>(function RadarMap(
  {
    segments,
    radarIndex,
    radarFrame,
    radarOpacity,
    riderPosition,
    cloudTiles,
    satelliteFrame,
    layers,
    defaultRegion,
  },
  ref,
) {
  const mapRef = useRef<MapView>(null);
  // Текущий регион нужен только для зума — держим в ref, чтобы не гонять
  // лишний рендер на каждый жест панорамирования.
  const regionRef = useRef<Region>(defaultRegion);
  const chunks = buildRouteChunks(segments);
  const coordinates = routeCoordinates(segments);

  const zoomBy = useCallback((factor: number) => {
    const r = regionRef.current;
    const next: Region = {
      ...r,
      latitudeDelta: r.latitudeDelta * factor,
      longitudeDelta: r.longitudeDelta * factor,
    };
    regionRef.current = next;
    mapRef.current?.animateToRegion(next, 200);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomBy(ZOOM_FACTOR),
      zoomOut: () => zoomBy(1 / ZOOM_FACTOR),
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
    mapRef.current?.fitToCoordinates(coordinates, {
      edgePadding: EDGE_PADDING,
      animated: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  // Геолокация приходит асинхронно, уже после первого рендера MapView, а
  // `initialRegion` применяется только один раз — без этого камера так и
  // осталась бы на фолбэке, пока данные (например, облачность) уже тянутся
  // для настоящих координат. Без маршрута — гоняем камеру следом за регионом.
  useEffect(() => {
    if (coordinates.length > 0) return;
    const next: Region = { ...defaultRegion };
    regionRef.current = next;
    mapRef.current?.animateToRegion(next, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultRegion.latitude, defaultRegion.longitude]);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      initialRegion={defaultRegion}
      onRegionChangeComplete={(r) => {
        regionRef.current = r;
      }}
      // Приглушённая подложка не спорит с цветами радара — так делают погодные приложения.
      mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}
      showsUserLocation
      showsMyLocationButton={false}
      showsPointsOfInterests={false}
      showsTraffic={false}
      toolbarEnabled={false}
    >
      {/* Прошлое и «сейчас» — снимок Meteosat: настоящая фактура облаков.
          Дальше в будущее снимка нет, и слой переключается на модель. */}
      {layers.clouds && satelliteFrame && (
        <WMSTile
          // Ключ по кадру: без него слой не перерисуется при перемотке времени.
          key={satelliteFrame.toISOString()}
          urlTemplate={satelliteTileUrl(satelliteFrame)}
          maximumNativeZ={SAT_MAX_NATIVE_ZOOM}
          maximumZ={20}
          opacity={CLOUD_OPACITY}
          shouldReplaceMapContent={false}
          zIndex={0}
        />
      )}

      {layers.clouds && !satelliteFrame && cloudTiles && (
        <UrlTile
          // Ключ по адресу: без него слой не перерисуется при перемотке времени.
          key={cloudTiles.urlTemplate}
          urlTemplate={cloudTiles.urlTemplate}
          // Тайлы нарисованы на одном зуме; выше система растягивает их сама.
          maximumNativeZ={cloudTiles.maxZoom}
          maximumZ={20}
          shouldReplaceMapContent={false}
          zIndex={0}
        />
      )}

      {layers.rain && radarIndex && radarFrame && (
        <UrlTile
          // Смена ключа пересоздаёт оверлей — иначе кадр не перерисовывается.
          key={radarFrame.path}
          urlTemplate={radarTileUrl(radarIndex, radarFrame)}
          tileSize={512}
          // Бесплатный тайлкеш RainViewer отдаёт мозаику только до z=7,
          // выше нативный слой сам растягивает последний доступный уровень.
          maximumNativeZ={MAX_NATIVE_TILE_ZOOM}
          maximumZ={20}
          opacity={radarOpacity}
          zIndex={1}
        />
      )}

      {coordinates.length > 1 && (
        <Polyline
          coordinates={coordinates}
          strokeColor="rgba(10, 12, 16, 0.55)"
          strokeWidth={9}
          zIndex={2}
        />
      )}

      {chunks.map((chunk, i) => (
        <Polyline
          key={`chunk-${i}`}
          coordinates={chunk.coordinates}
          strokeColor={chunk.color}
          strokeWidth={5}
          zIndex={3}
        />
      ))}

      {first && (
        <Marker coordinate={first} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
          <View style={[styles.endpoint, { backgroundColor: theme.start }]}>
            <Text style={styles.endpointLabel}>С</Text>
          </View>
        </Marker>
      )}

      {last && coordinates.length > 1 && (
        <Marker coordinate={last} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
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
              coordinate={{
                latitude: (segment.start.lat + segment.end.lat) / 2,
                longitude: (segment.start.lon + segment.end.lon) / 2,
              }}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              zIndex={6}
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
            coordinate={{
              latitude: (segment.start.lat + segment.end.lat) / 2,
              longitude: (segment.start.lon + segment.end.lon) / 2,
            }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            zIndex={5}
          >
            <View style={styles.windMarker}>
              {/* Стрелка смотрит туда, куда дует ветер: направление в прогнозе —
                  откуда, поэтому разворачиваем на 180°. */}
              <Text
                style={[
                  styles.windArrow,
                  { transform: [{ rotate: `${(segment.windDirection + 180) % 360}deg` }] },
                ]}
              >
                ➤
              </Text>
              <Text style={styles.windSpeed}>{segment.windSpeed.toFixed(0)}</Text>
            </View>
          </Marker>
        ))}

      {riderPosition && (
        <Marker
          coordinate={{ latitude: riderPosition.lat, longitude: riderPosition.lon }}
          anchor={{ x: 0.5, y: 0.5 }}
          zIndex={10}
        >
          <View style={styles.rider}>
            <View style={styles.riderDot} />
            <Text style={styles.riderLabel}>{riderPosition.distanceKm.toFixed(0)} км</Text>
          </View>
        </Marker>
      )}
    </MapView>
  );
});

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
