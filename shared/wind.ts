import { createCache, type CacheStore } from "./cache";
import { requestOpenMeteo } from "./openMeteo";
import type { PrecipSample, RoutePoint, WindForecast } from "./types";

const SAMPLE_POINTS_COUNT = 12;

// Прогноз по точкам маршрута кэшируется на час — с таким шагом он и
// обновляется. Ключ — сами точки выборки: тот же GPX даёт те же 12 точек,
// а значит, повторное открытие маршрута (и перезапуск приложения) квоту
// не тратит. Записей — на несколько маршрутов за день.
const CACHE_TTL_MS = 60 * 60_000;
const CACHE_MAX_ENTRIES = 8;

type RouteSeries = { forecasts: WindForecast[]; precip: PrecipSample[] }[];

const cache = createCache<RouteSeries>({
  ttlMs: CACHE_TTL_MS,
  maxEntries: CACHE_MAX_ENTRIES,
});

// Приложение подключает хранилище само: в mobile это файл, у веба — localStorage.
export function attachWindCacheStore(store: CacheStore): void {
  cache.attachStore(store);
}

function cacheKey(points: RoutePoint[]): string {
  return points.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(";");
}

export interface RouteWindPoint {
  point: RoutePoint;
  forecasts: WindForecast[]; // почасовые: ветер, температура, давление
  precip: PrecipSample[]; // 15-минутные осадки; пусто — берём почасовые
}

interface OpenMeteoResponse {
  hourly: {
    time: string[];
    windspeed_10m: number[];
    winddirection_10m: number[];
    precipitation: number[];
    precipitation_probability: (number | null)[];
    temperature_2m: (number | null)[];
    surface_pressure: (number | null)[];
  };
  minutely_15?: {
    time: string[];
    precipitation: (number | null)[];
  };
}

function toPrecipSamples(data: OpenMeteoResponse): PrecipSample[] {
  const series = data.minutely_15;
  if (!series) return [];
  return series.time.map((t, i) => ({
    time: `${t}Z`,
    precipitation: series.precipitation[i] ?? 0,
  }));
}

function toForecasts(data: OpenMeteoResponse): WindForecast[] {
  const {
    time,
    windspeed_10m,
    winddirection_10m,
    precipitation,
    precipitation_probability,
    temperature_2m,
    surface_pressure,
  } = data.hourly;

  return time.map((t, i) => ({
    // Open-Meteo отдаёт время без смещения; с timezone=GMT это UTC, поэтому
    // дописываем "Z" — иначе Date прочитает строку как время устройства и
    // маршрут в другом часовом поясе поедет на несколько часов.
    time: `${t}Z`,
    speed: windspeed_10m[i],
    direction: winddirection_10m[i],
    precipitation: precipitation[i],
    precipitationProbability: precipitation_probability[i] ?? 0,
    temperature: temperature_2m[i] ?? null,
    pressure: surface_pressure[i] ?? null,
  }));
}

// Open-Meteo принимает несколько координат через запятую и отвечает массивом —
// весь маршрут забираем одним запросом вместо N параллельных.
async function fetchForecasts(
  points: RoutePoint[],
): Promise<{ forecasts: WindForecast[]; precip: PrecipSample[] }[]> {
  const data = await requestOpenMeteo<OpenMeteoResponse | OpenMeteoResponse[]>({
    latitude: points.map((p) => p.lat.toFixed(4)).join(","),
    longitude: points.map((p) => p.lon.toFixed(4)).join(","),
    hourly:
      "windspeed_10m,winddirection_10m,precipitation,precipitation_probability,temperature_2m,surface_pressure",
    minutely_15: "precipitation",
    windspeed_unit: "kmh",
    forecast_days: "3",
    timezone: "GMT",
  });
  const list = Array.isArray(data) ? data : [data];
  return list.map((entry) => ({
    forecasts: toForecasts(entry),
    precip: toPrecipSamples(entry),
  }));
}

// Выбирает до `count` репрезентативных точек вдоль маршрута: старт, промежуточные, финиш.
function pickRepresentativePoints(
  routePoints: RoutePoint[],
  count: number,
): RoutePoint[] {
  if (routePoints.length <= count) return routePoints;

  const picked: RoutePoint[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i / (count - 1)) * (routePoints.length - 1));
    picked.push(routePoints[idx]);
  }
  return picked;
}

export async function fetchRouteWind(
  routePoints: RoutePoint[],
): Promise<RouteWindPoint[]> {
  const samplePoints = pickRepresentativePoints(
    routePoints,
    SAMPLE_POINTS_COUNT,
  );

  const series = await cache.resolve(cacheKey(samplePoints), () =>
    fetchForecasts(samplePoints),
  );

  return samplePoints.map((point, i) => ({
    point,
    forecasts: series[i].forecasts,
    precip: series[i].precip,
  }));
}
