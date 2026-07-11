import type { RoutePoint, WindForecast } from "../types";

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const SAMPLE_POINTS_COUNT = 5;

export interface RouteWindPoint {
  point: RoutePoint;
  forecasts: WindForecast[];
}

interface OpenMeteoResponse {
  hourly: {
    time: string[];
    windspeed_10m: number[];
    winddirection_10m: number[];
    precipitation: number[];
  };
}

async function fetchPointForecast(
  lat: number,
  lon: number,
): Promise<WindForecast[]> {
  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set("latitude", lat.toFixed(5));
  url.searchParams.set("longitude", lon.toFixed(5));
  url.searchParams.set(
    "hourly",
    "windspeed_10m,winddirection_10m,precipitation",
  );
  url.searchParams.set("windspeed_unit", "kmh");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("timezone", "auto");

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(
      `Open-Meteo вернул ошибку ${res.status} для точки ${lat.toFixed(3)},${lon.toFixed(3)}`,
    );
  }

  const data = (await res.json()) as OpenMeteoResponse;
  const { time, windspeed_10m, winddirection_10m, precipitation } = data.hourly;

  return time.map((t, i) => ({
    time: t,
    speed: windspeed_10m[i],
    direction: winddirection_10m[i],
    precipitation: precipitation[i],
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

  const forecasts = await Promise.all(
    samplePoints.map((p) => fetchPointForecast(p.lat, p.lon)),
  );

  return samplePoints.map((point, i) => ({ point, forecasts: forecasts[i] }));
}
