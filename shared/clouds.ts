// Поле облачности для карты. Бесплатного тайлового слоя облаков, покрывающего
// Европу, не существует: спутник RainViewer в открытом доступе пуст, а у NASA
// GIBS геостационарные снимки есть только над Америкой и Азией. Поэтому берём
// численный прогноз Open-Meteo на сетке точек и рисуем поле сами.
//
// У прогноза перед снимком есть и преимущество: он знает облачность на завтра,
// а снимок — только то, что уже было.
import type { RoutePoint } from "./types";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

// 7x7 = 49 точек в одном запросе. Облачные поля крупные, более частая сетка
// не добавила бы информации, зато утяжелила бы запрос.
const GRID_SIZE = 7;

// Запас вокруг маршрута, чтобы поле закрывало экран, а не обрывалось по треку.
const PADDING_RATIO = 0.45;
const MIN_PADDING_DEG = 0.3;

export interface CloudGrid {
  latitudes: number[]; // по возрастанию, с юга на север
  longitudes: number[]; // по возрастанию, с запада на восток
  times: string[]; // ISO, UTC, почасовые
  // Для каждого часа — плоский массив длиной latitudes * longitudes.
  cover: number[][];
  south: number;
  west: number;
  north: number;
  east: number;
}

interface CloudResponse {
  hourly: { time: string[]; cloud_cover: (number | null)[] };
}

function buildQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

function routeBounds(points: RoutePoint[]) {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;

  for (const p of points) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lon);
    east = Math.max(east, p.lon);
  }

  const padLat = Math.max((north - south) * PADDING_RATIO, MIN_PADDING_DEG);
  const padLon = Math.max((east - west) * PADDING_RATIO, MIN_PADDING_DEG);

  return {
    south: south - padLat,
    north: north + padLat,
    west: west - padLon,
    east: east + padLon,
  };
}

export interface Bounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

export async function fetchCloudGrid(
  routePoints: RoutePoint[],
): Promise<CloudGrid> {
  return fetchCloudGridForBounds(routeBounds(routePoints));
}

// Тот же запрос, но по произвольному bbox — используется для дефолтного вида
// карты вокруг пользователя, когда маршрут ещё не загружен.
export async function fetchCloudGridForBounds({
  south,
  north,
  west,
  east,
}: Bounds): Promise<CloudGrid> {
  const latitudes: number[] = [];
  const longitudes: number[] = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    const f = i / (GRID_SIZE - 1);
    latitudes.push(south + (north - south) * f);
    longitudes.push(west + (east - west) * f);
  }

  // Запрос идёт построчно: сначала весь южный ряд, затем следующий и так далее.
  const lats: number[] = [];
  const lons: number[] = [];
  for (const lat of latitudes) {
    for (const lon of longitudes) {
      lats.push(lat);
      lons.push(lon);
    }
  }

  const query = buildQuery({
    latitude: lats.map((v) => v.toFixed(4)).join(","),
    longitude: lons.map((v) => v.toFixed(4)).join(","),
    hourly: "cloud_cover",
    forecast_days: "3",
    timezone: "GMT",
  });

  const res = await fetch(`${OPEN_METEO_URL}?${query}`);
  if (!res.ok) throw new Error(`Open-Meteo вернул ошибку ${res.status}`);

  const data = (await res.json()) as CloudResponse | CloudResponse[];
  const list = Array.isArray(data) ? data : [data];

  const times = list[0].hourly.time.map((t) => `${t}Z`);
  const cover = times.map((_, timeIndex) =>
    list.map((entry) => entry.hourly.cloud_cover[timeIndex] ?? 0),
  );

  return { latitudes, longitudes, times, cover, south, west, north, east };
}

// Срез поля на ближайший час. Ряд времён равномерный, поэтому индекс считается,
// а не ищется перебором.
export function cloudSliceAt(grid: CloudGrid, targetMs: number): number[] {
  if (grid.times.length === 0) return [];

  const startMs = new Date(grid.times[0]).getTime();
  const stepMs =
    grid.times.length > 1
      ? new Date(grid.times[1]).getTime() - startMs
      : 3600_000;

  const i = Math.round((targetMs - startMs) / (stepMs > 0 ? stepMs : 3600_000));
  return grid.cover[Math.max(0, Math.min(grid.cover.length - 1, i))];
}
