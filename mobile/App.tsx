import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { File } from "expo-file-system";
import * as Location from "expo-location";
import { parseGpx, type ParsedRoute } from "@shared/gpx";
import {
  attachWindCacheStore,
  fetchRouteWind,
  type RouteWindPoint,
} from "@shared/wind";
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
  attachCloudCacheStore,
  cloudTilesFor,
  fetchCloudTiles,
  fetchRouteCloudGrid,
  type Bounds,
  type CloudGrid,
} from "@shared/clouds";
import { satelliteFrameAt } from "@shared/satellite";
import type { RouteScore } from "@shared/types";
import type { MapRegion, RadarMapHandle } from "./src/components/RadarMap";
import { RadarMap } from "./src/components/RadarMap";
import { writeCloudField, type CloudField } from "./src/lib/cloudImage";
import { fileCacheStore } from "./src/lib/cacheStore";
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

// Кэши погоды переживают перезапуск: подключаем дисковые хранилища
// до первого запроса.
attachCloudCacheStore(fileCacheStore("cloud-grid"));
attachWindCacheStore(fileCacheStore("route-wind"));

// Индекс кадров радара обновляется каждые 10 минут — перечитываем чуть чаще.
const RADAR_REFRESH_MS = 5 * 60 * 1000;
// Стабильная пустая геометрия: новый массив на каждом рендере дёргал бы
// пересчёт трека в карте.
const EMPTY_TRACK: { lat: number; lon: number }[] = [];
// Пауза после ошибки Open-Meteo — ровно окно минутного лимита.
const CLOUD_RETRY_MS = 60 * 1000;
const OPACITY_STEPS = [0.65, 0.35, 1] as const;

// Пока маршрут не загружен, карта открывается на геолокации пользователя —
// это примерно тот же масштаб, что даёт подгонка под маршрут в полсотни км.
const DEFAULT_ZOOM = 8.5;
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
  // Почему нет прогноза по открытому маршруту; null — есть или ещё грузится.
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [rideStart, setRideStart] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [radarIndex, setRadarIndex] = useState<RadarIndex | null>(null);
  const [mapTime, setMapTime] = useState<Date | null>(null);
  const [opacityStep, setOpacityStep] = useState(0);
  const [rider, setRider] = useState<RiderProfile>(DEFAULT_RIDER);
  const [riderSheetOpen, setRiderSheetOpen] = useState(false);
  const [dodgeSheetOpen, setDodgeSheetOpen] = useState(false);
  // Мелкая сетка облачности по маршруту — ложится поверх тайлов.
  const [routeCloudGrid, setRouteCloudGrid] = useState<CloudGrid | null>(null);
  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  // null, пока геолокация не отработала: карта стартует на фолбэке, и тайлы
  // облачности за него уходить не должны — через секунду камера улетит
  // в реальный район, и запрос пропал бы зря.
  const [defaultRegion, setDefaultRegion] = useState<MapRegion | null>(null);
  // Видимая область карты и сшитые тайлы облачности под неё.
  const [viewport, setViewport] = useState<Bounds | null>(null);
  const [tileCloudGrid, setTileCloudGrid] = useState<{
    key: string;
    grid: CloudGrid;
  } | null>(null);

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

  // Пока нет маршрута с прогнозом, «сейчас» ведёт таймлайн само — обновляем
  // каждые несколько минут, чтобы кадр радара не протухал. С прогнозом
  // временем управляет пользователь через TimelineBar, и эффект замолкает.
  const hasForecast = windPoints !== null;
  useEffect(() => {
    if (hasForecast) return;
    const tick = () => setMapTime(new Date());
    tick();
    const id = setInterval(tick, RADAR_REFRESH_MS);
    return () => clearInterval(id);
  }, [hasForecast]);

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
    // Тот же объект — нет ререндера: повторное нажатие «моё местоположение»
    // на том же месте ничего не дёргает.
    setDefaultRegion((prev) =>
      prev &&
      prev.latitude === region.latitude &&
      prev.longitude === region.longitude
        ? prev
        : region,
    );
  }, []);

  useEffect(() => {
    locateMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Прогноз по маршруту грузится отдельно от самого маршрута: трек на карте
  // не должен зависеть от лимитов Open-Meteo. Номер запроса отсекает ответ,
  // пришедший уже после того, как открыли другой маршрут.
  const forecastRequestRef = useRef(0);
  const loadForecast = useCallback(async (parsed: ParsedRoute) => {
    const request = ++forecastRequestRef.current;
    setLoading(true);
    setForecastError(null);
    try {
      const wp = await fetchRouteWind(parsed.routePoints);
      if (request !== forecastRequestRef.current) return;
      const start = new Date();
      setWindPoints(wp);
      setRideStart(start);
      setMapTime(start);
    } catch (e) {
      if (request !== forecastRequestRef.current) return;
      console.warn("Прогноз по маршруту недоступен:", e);
      setForecastError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === forecastRequestRef.current) setLoading(false);
    }
  }, []);

  const loadRoute = useCallback(
    async (xmlText: string, name: string) => {
      let parsed: ParsedRoute;
      try {
        parsed = parseGpx(xmlText);
      } catch (e) {
        console.error(e);
        Alert.alert(
          "Не удалось открыть маршрут",
          e instanceof Error ? e.message : String(e),
        );
        return;
      }

      // Сначала трек — карта сразу подгоняется под него, прогноз догоняет.
      setRouteCloudGrid(null);
      setWindPoints(null);
      setRoute(parsed);
      setRouteName(name);
      await loadForecast(parsed);
    },
    [loadForecast],
  );

  const retryForecast = useCallback(() => {
    if (route) loadForecast(route);
  }, [route, loadForecast]);

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

  // Поле облачности — самые дорогие запросы к Open-Meteo (12×12 координат
  // каждая сетка), поэтому оно грузится лениво: только когда слой включён
  // и только если сетки ещё нет. Выключил слой — квота не тратится; включил
  // обратно — сетка уже на месте, повторного запроса не будет.
  //
  // Основа — тайлы под видимую область: карта сообщает границы после каждого
  // движения, и если набор тайлов тот же, ничего не происходит.
  //
  // После ошибки (обычно 429 — минутный лимит Open-Meteo) запросы замолкают
  // на паузу: иначе каждое движение камеры било бы в лимит снова и снова, и
  // он не отпускал бы вообще. По истечении паузы эффект будится сам.
  const tileRetryAfterRef = useRef(0);
  const [tileRetryTick, setTileRetryTick] = useState(0);
  // null и при экране шире потолка тайлов — тогда модельное поле прячется.
  const tileSet = useMemo(
    () => (viewport ? cloudTilesFor(viewport) : null),
    [viewport],
  );
  useEffect(() => {
    if (!layers.clouds || !tileSet) return;
    if (!defaultRegion && !route) return; // камера ещё не там, где надо
    const set = tileSet;
    if (tileCloudGrid?.key === set.key) return;

    const wait = tileRetryAfterRef.current - Date.now();
    if (wait > 0) {
      const id = setTimeout(() => setTileRetryTick((t) => t + 1), wait);
      return () => clearTimeout(id);
    }

    let cancelled = false;
    fetchCloudTiles(set)
      .then((grid) => {
        if (!cancelled) setTileCloudGrid({ key: set.key, grid });
      })
      .catch((e) => {
        console.warn("Облачность недоступна:", e);
        tileRetryAfterRef.current = Date.now() + CLOUD_RETRY_MS;
        if (!cancelled) setTileRetryTick((t) => t + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [layers.clouds, tileSet, tileCloudGrid, defaultRegion, route, tileRetryTick]);

  // Мелкая сетка по маршруту — один раз на маршрут.
  useEffect(() => {
    if (!layers.clouds || !route || routeCloudGrid) return;

    let cancelled = false;
    fetchRouteCloudGrid(route.routePoints)
      .then((grid) => {
        if (!cancelled) setRouteCloudGrid(grid);
      })
      .catch((e) => console.warn("Облачность недоступна:", e));
    return () => {
      cancelled = true;
    };
  }, [layers.clouds, route, routeCloudGrid]);

  const score: RouteScore | null = useMemo(() => {
    if (!route || !windPoints || !rideStart) return null;
    return scoreRoute(route.routePoints, windPoints, rideStart, rider);
  }, [route, windPoints, rideStart, rider]);

  const routeDistanceKm = route
    ? (route.routePoints[route.routePoints.length - 1]?.distanceFromStart ?? 0) /
      1000
    : null;

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

  // Картинки поля облачности строятся за считанные миллисекунды, поэтому
  // пересобираются прямо на каждый шаг таймлайна и кладутся во временные
  // файлы. Слои от грубого к мелкому: тайлы под экран, сверху сетка по треку.
  //
  // Экран шире потолка тайлов — модельное поле прячем целиком: последнее
  // загруженное закрывает лишь часть экрана, и его прямоугольный край
  // режет карту. Приложение про маршрут, облачность на континент ему не нужна;
  // слой уходит тем же кроссфейдом и возвращается при приближении.
  const beyondTileCap = viewport !== null && tileSet === null;
  const activeCloudGrids = useMemo(() => {
    if (beyondTileCap) return null;
    const grids: CloudGrid[] = [];
    if (tileCloudGrid) grids.push(tileCloudGrid.grid);
    if (routeCloudGrid) grids.push(routeCloudGrid);
    return grids.length > 0 ? grids : null;
  }, [beyondTileCap, tileCloudGrid, routeCloudGrid]);

  // На прошлое и «сейчас» облачность показывается снимком Meteosat, и модельное
  // поле для этих моментов не нужно — оно рисуется только дальше в будущее,
  // куда снимок не достаёт.
  const satelliteFrame = useMemo(
    () => (mapTime ? satelliteFrameAt(mapTime) : null),
    [mapTime],
  );

  const cloudField = useMemo<CloudField | null>(() => {
    if (!layers.clouds || !activeCloudGrids || !mapTime || satelliteFrame) {
      return null;
    }
    try {
      return writeCloudField(activeCloudGrids, mapTime.getTime());
    } catch (e) {
      console.warn("Слой облачности недоступен:", String(e));
      return null;
    }
    // Кадр снимка меняется реже, чем `mapTime`, но зависимость нужна: без неё
    // модельное поле не пересобралось бы на переходе «снимок → прогноз».
  }, [layers.clouds, activeCloudGrids, mapTime, satelliteFrame]);

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
        track={route?.routePoints ?? EMPTY_TRACK}
        radarIndex={radarIndex}
        radarFrame={radarFrame}
        radarOpacity={OPACITY_STEPS[opacityStep]}
        riderPosition={riderPosition}
        cloudField={cloudField}
        satelliteFrame={satelliteFrame}
        layers={layers}
        defaultRegion={defaultRegion ?? FALLBACK_REGION}
        onViewportChange={setViewport}
      />

      {/* Панели идут от края до края и заходят под статус-бар — так же выглядят
          радарные приложения, и белый текст статус-бара остаётся читаемым. */}
      <View style={styles.overlay} pointerEvents="box-none">
        <RouteHeader
          routeName={routeName}
          distanceKm={routeDistanceKm}
          score={score}
          forecastError={forecastError}
          onRetryForecast={retryForecast}
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
              {route
                ? "Без прогноза по маршруту не посчитать время в пути и ветер. Радар показывает осадки на сейчас."
                : "Загрузите GPX — карта покажет радар осадков и то, где вы будете в каждый момент поездки."}
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
