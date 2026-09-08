import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { File } from "expo-file-system";
import * as Location from "expo-location";
import { parseGpx, type ParsedRoute } from "@shared/gpx";
import { fetchRouteWind, type RouteWindPoint } from "@shared/wind";
import {
  fetchRadarIndex,
  frameAt,
  radarCoverage,
  type RadarIndex,
} from "@shared/radar";
import { positionAtTime, scoreRoute, summarizeWind } from "@shared/scoring";
import { DEFAULT_RIDER, RIDER_PRESETS, type RiderProfile } from "@shared/physics";
import { buildDodgeGrid, type DodgeCell } from "@shared/dodge";
import {
  fetchCloudGrid,
  fetchCloudGridForBounds,
  type CloudGrid,
} from "@shared/clouds";
import { satelliteFrameAt } from "@shared/satellite";
import type { RouteScore } from "@shared/types";
import type { MapRegion, RadarMapHandle } from "./src/components/RadarMap";
import { RadarMap } from "./src/components/RadarMap";
import { writeCloudField, type CloudField } from "./src/lib/cloudImage";
import {
  DEFAULT_LAYERS,
  LayerSwitcher,
  type MapLayers,
} from "./src/components/LayerSwitcher";
import { MapControls } from "./src/components/MapControls";
import { DodgeSheet } from "./src/components/DodgeSheet";
import { RiderSheet } from "./src/components/RiderSheet";
import { RouteHeader } from "./src/components/RouteHeader";
import { TimelineBar } from "./src/components/TimelineBar";
import { DEMO_ROUTE_GPX, DEMO_ROUTE_NAME } from "./src/lib/demoRoute";
import { MAP_CREDITS } from "./src/lib/mapStyle";
import { theme } from "./src/theme";

// Индекс кадров радара обновляется каждые 10 минут — перечитываем чуть чаще.
const RADAR_REFRESH_MS = 5 * 60 * 1000;
const OPACITY_STEPS = [0.65, 0.35, 1] as const;

// Пока маршрут не загружен, карта открывается на геолокации пользователя —
// это примерно тот же масштаб, что даёт подгонка под маршрут в полсотни км.
const DEFAULT_ZOOM = 8.5;
// Поле облачности запрашиваем заметно шире экрана: иначе слой обрывается по
// краю, стоит чуть отъехать в сторону.
const CLOUD_SPAN_DEG = 2.4;
// Геолокация недоступна/запрещена — открываемся на Гданьске, как в демо-маршруте.
const FALLBACK_REGION: MapRegion = {
  latitude: 54.352,
  longitude: 18.6466,
  zoom: DEFAULT_ZOOM,
};

export default function App() {
  return (
    <SafeAreaProvider>
      <RadarScreen />
    </SafeAreaProvider>
  );
}

function RadarScreen() {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<RadarMapHandle>(null);
  const [routeName, setRouteName] = useState<string | null>(null);
  const [route, setRoute] = useState<ParsedRoute | null>(null);
  const [windPoints, setWindPoints] = useState<RouteWindPoint[] | null>(null);
  const [rideStart, setRideStart] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [radarIndex, setRadarIndex] = useState<RadarIndex | null>(null);
  const [mapTime, setMapTime] = useState<Date | null>(null);
  const [opacityStep, setOpacityStep] = useState(0);
  const [rider, setRider] = useState<RiderProfile>(DEFAULT_RIDER);
  const [riderSheetOpen, setRiderSheetOpen] = useState(false);
  const [dodgeSheetOpen, setDodgeSheetOpen] = useState(false);
  const [cloudGrid, setCloudGrid] = useState<CloudGrid | null>(null);
  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const [defaultRegion, setDefaultRegion] = useState<MapRegion>(FALLBACK_REGION);
  const [defaultCloudGrid, setDefaultCloudGrid] = useState<CloudGrid | null>(null);

  // Радар — отдельный необязательный слой: если RainViewer недоступен,
  // приложение продолжает работать на модельном прогнозе.
  useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetchRadarIndex()
        .then((index) => {
          if (!cancelled) setRadarIndex(index);
        })
        .catch((e) => console.warn("Радар недоступен:", e));
    };

    load();
    const id = setInterval(load, RADAR_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Пока маршрут не загружен, «сейчас» ведёт таймлайн само — обновляем каждые
  // несколько минут, чтобы кадр радара не протухал. С маршрутом временем
  // управляет пользователь через TimelineBar, поэтому эффект замолкает.
  useEffect(() => {
    if (route) return;
    const tick = () => setMapTime(new Date());
    tick();
    const id = setInterval(tick, RADAR_REFRESH_MS);
    return () => clearInterval(id);
  }, [route]);

  // Геолокация — тоже необязательная: без разрешения или на симуляторе без
  // заданной позиции просто остаёмся на FALLBACK_REGION. Вынесена в функцию —
  // её же дёргает кнопка «моё местоположение» на карте.
  const locateMe = useCallback(async () => {
    let region = FALLBACK_REGION;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        region = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          zoom: DEFAULT_ZOOM,
        };
      }
    } catch (e) {
      console.warn("Геолокация недоступна:", e);
    }
    setDefaultRegion(region);

    try {
      const grid = await fetchCloudGridForBounds({
        south: region.latitude - CLOUD_SPAN_DEG / 2,
        north: region.latitude + CLOUD_SPAN_DEG / 2,
        west: region.longitude - CLOUD_SPAN_DEG / 2,
        east: region.longitude + CLOUD_SPAN_DEG / 2,
      });
      setDefaultCloudGrid(grid);
    } catch (e) {
      console.warn("Облачность недоступна:", e);
    }
  }, []);

  useEffect(() => {
    locateMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRoute = useCallback(async (xmlText: string, name: string) => {
    setLoading(true);
    setCloudGrid(null);
    try {
      const parsed = parseGpx(xmlText);
      // Облачность — отдельный необязательный слой: если её не удалось получить,
      // остальное должно работать.
      const [wp, clouds] = await Promise.all([
        fetchRouteWind(parsed.routePoints),
        fetchCloudGrid(parsed.routePoints).catch((e) => {
          console.warn("Облачность недоступна:", e);
          return null;
        }),
      ]);
      const start = new Date();

      setRoute(parsed);
      setWindPoints(wp);
      setCloudGrid(clouds);
      setRouteName(name);
      setRideStart(start);
      setMapTime(start);
    } catch (e) {
      console.error(e);
      Alert.alert(
        "Не удалось открыть маршрут",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePickRoute = useCallback(async () => {
    try {
      const picked = await File.pickFileAsync();
      if (picked.canceled) return;

      const file = picked.result;
      const name = file.name ?? "Маршрут";
      if (!name.toLowerCase().endsWith(".gpx")) {
        Alert.alert("Нужен файл .gpx", `Выбран «${name}».`);
        return;
      }
      await loadRoute(await file.text(), name.replace(/\.gpx$/i, ""));
    } catch (e) {
      console.error(e);
      Alert.alert(
        "Не удалось прочитать файл",
        e instanceof Error ? e.message : String(e),
      );
    }
  }, [loadRoute]);

  const handleLoadDemo = useCallback(
    () => loadRoute(DEMO_ROUTE_GPX, DEMO_ROUTE_NAME),
    [loadRoute],
  );

  const score: RouteScore | null = useMemo(() => {
    if (!route || !windPoints || !rideStart) return null;
    return scoreRoute(route.routePoints, windPoints, rideStart, rider);
  }, [route, windPoints, rideStart, rider]);

  const windSummary = useMemo(
    () => (score ? summarizeWind(score.segments) : null),
    [score],
  );

  // Сетка «задержка старта × темп» — считается за десятки миллисекунд,
  // поэтому пересчитывается прямо при смене маршрута или профиля.
  const dodgeGrid = useMemo(() => {
    if (!route || !windPoints || !rideStart) return null;
    return buildDodgeGrid(route.routePoints, windPoints, rideStart, rider);
  }, [route, windPoints, rideStart, rider]);

  // Применить вариант из сетки: сдвинуть старт и взять предложенный темп.
  const applyDodgeCell = useCallback(
    (cell: DodgeCell) => {
      setRideStart(new Date(cell.startTime));
      setRider((prev) => ({ ...prev, targetPowerW: cell.powerW }));
      setMapTime(new Date(cell.startTime));
      setDodgeSheetOpen(false);
    },
    [],
  );

  // Картинка поля облачности строится за считанные миллисекунды, поэтому
  // пересобирается прямо на каждый шаг таймлайна и кладётся во временный файл.
  // Без маршрута используем поле вокруг геолокации, чтобы слой был виден сразу.
  const activeCloudGrid = cloudGrid ?? defaultCloudGrid;

  // На прошлое и «сейчас» облачность показывается снимком Meteosat, и модельное
  // поле для этих моментов не нужно — оно рисуется только дальше в будущее,
  // куда снимок не достаёт.
  const satelliteFrame = useMemo(
    () => (mapTime ? satelliteFrameAt(mapTime) : null),
    [mapTime],
  );

  const cloudField = useMemo<CloudField | null>(() => {
    if (!activeCloudGrid || !mapTime || satelliteFrame) return null;
    try {
      return writeCloudField(activeCloudGrid, mapTime.getTime());
    } catch (e) {
      console.warn("Слой облачности недоступен:", String(e));
      return null;
    }
    // Кадр снимка меняется реже, чем `mapTime`, но зависимость нужна: без неё
    // модельное поле не пересобралось бы на переходе «снимок → прогноз».
  }, [activeCloudGrid, mapTime, satelliteFrame]);

  const toggleLayer = useCallback(
    (key: keyof MapLayers) =>
      setLayers((prev) => ({ ...prev, [key]: !prev[key] })),
    [],
  );

  const coverage = radarIndex ? radarCoverage(radarIndex) : null;
  const radarFrame = radarIndex && mapTime ? frameAt(radarIndex, mapTime) : null;
  const riderPosition = score && mapTime ? positionAtTime(score, mapTime) : null;

  // Шкала начинается с более раннего из двух: начала поездки и начала радарной
  // истории — чтобы было видно, куда движется дождь.
  const timelineStart =
    rideStart && coverage && coverage.from < rideStart ? coverage.from : rideStart;

  const riderLabel =
    RIDER_PRESETS.find(
      (p) =>
        p.profile.targetPowerW === rider.targetPowerW &&
        p.profile.cda === rider.cda &&
        p.profile.totalMassKg === rider.totalMassKg,
    )?.label ?? `${rider.targetPowerW} Вт`;

  const cycleOpacity = useCallback(
    () => setOpacityStep((s) => (s + 1) % OPACITY_STEPS.length),
    [],
  );

  return (
    <View style={styles.root}>
      <RadarMap
        ref={mapRef}
        segments={score?.segments ?? []}
        radarIndex={radarIndex}
        radarFrame={radarFrame}
        radarOpacity={OPACITY_STEPS[opacityStep]}
        riderPosition={riderPosition}
        cloudField={cloudField}
        satelliteFrame={satelliteFrame}
        layers={layers}
        defaultRegion={defaultRegion}
      />

      {/* Панели идут от края до края и заходят под статус-бар — так же выглядят
          радарные приложения, и белый текст статус-бара остаётся читаемым. */}
      <View style={styles.overlay} pointerEvents="box-none">
        <RouteHeader
          routeName={routeName}
          score={score}
          avgWindSpeed={windSummary?.avgSpeed ?? 0}
          avgWindDirection={windSummary?.avgDirection ?? 0}
          loading={loading}
          topInset={insets.top}
          riderLabel={riderLabel}
          onPickRoute={handlePickRoute}
          onLoadDemo={handleLoadDemo}
          onOpenRider={() => setRiderSheetOpen(true)}
          onOpenDodge={() => setDodgeSheetOpen(true)}
          dodgeHint={
            dodgeGrid && dodgeGrid.baseline.wetKm >= 0.5
              ? `Проскочить между дождями (${dodgeGrid.baseline.wetKm.toFixed(0)} км под дождём) →`
              : null
          }
        />

        <View style={styles.spacer} pointerEvents="box-none">
          <LayerSwitcher layers={layers} onToggle={toggleLayer} />
          <MapControls
            onLocateMe={locateMe}
            onZoomIn={() => mapRef.current?.zoomIn()}
            onZoomOut={() => mapRef.current?.zoomOut()}
          />
        </View>

        {score && rideStart && timelineStart && mapTime ? (
          <TimelineBar
            timelineStart={timelineStart}
            rideStart={rideStart}
            endTime={new Date(score.endTime)}
            value={mapTime}
            onChange={setMapTime}
            source={radarFrame ? "radar" : "forecast"}
            radarCoverage={coverage}
            radarOpacity={OPACITY_STEPS[opacityStep]}
            bottomInset={insets.bottom}
            onCycleOpacity={cycleOpacity}
          />
        ) : (
          <View style={[styles.hint, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.hintText}>
              Загрузите GPX — карта покажет радар осадков и то, где вы будете в
              каждый момент поездки.
            </Text>
            <Text style={styles.credits}>{MAP_CREDITS}</Text>
          </View>
        )}
      </View>

      <DodgeSheet
        visible={dodgeSheetOpen}
        grid={dodgeGrid}
        onApply={applyDodgeCell}
        onClose={() => setDodgeSheetOpen(false)}
        bottomInset={insets.bottom}
      />

      <RiderSheet
        visible={riderSheetOpen}
        profile={rider}
        onChange={setRider}
        onClose={() => setRiderSheetOpen(false)}
        bottomInset={insets.bottom}
      />

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0b0d10",
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "space-between",
  },
  spacer: {
    flex: 1,
    justifyContent: "center",
  },
  hint: {
    backgroundColor: theme.panel,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
  },
  hintText: {
    color: theme.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  credits: {
    color: theme.textMuted,
    fontSize: 9,
    opacity: 0.7,
    marginTop: 8,
  },
});
