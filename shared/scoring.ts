import { haversineDistance, buildSegments } from "./bearing";
import {
  DEFAULT_RIDER,
  airDensity,
  speedFor,
  type RiderProfile,
} from "./physics";
import type {
  RoutePoint,
  Segment,
  ScoredSegment,
  RouteScore,
  RainWindow,
  PrecipSample,
} from "./types";
import type { RouteWindPoint } from "./wind";

// Ниже этого порога осадки не влияют на планирование и не рисуются на карте.
export const RAIN_THRESHOLD_MM = 0.1;

// Веса сводной «цены» погоды — в минутах, чтобы ветер и дождь можно было
// сравнивать в одних единицах: ветер уже даёт потерянные минуты напрямую,
// а промокнуть на всём маршруте субъективно «стоит» примерно получаса.
const WET_RATIO_PENALTY_MIN = 30;
const INTENSITY_PENALTY_MIN = 3;
const MAX_GRADIENT = 0.2;

const CANDIDATE_HORIZON_HOURS = 48;

function nearestWindPointIndex(
  segment: Segment,
  windPoints: RouteWindPoint[],
): number {
  const midLat = (segment.start.lat + segment.end.lat) / 2;
  const midLon = (segment.start.lon + segment.end.lon) / 2;

  let bestIndex = 0;
  let bestDist = Infinity;
  for (let i = 0; i < windPoints.length; i++) {
    const wp = windPoints[i];
    const d = haversineDistance(midLat, midLon, wp.point.lat, wp.point.lon);
    if (d < bestDist) {
      bestDist = d;
      bestIndex = i;
    }
  }
  return bestIndex;
}

// Геометрия маршрута не зависит ни от времени старта, ни от темпа. Считаем её
// один раз, чтобы перебор вариантов старта не пересчитывал одно и то же.
export interface RoutePlan {
  segments: Segment[];
  windPointIndex: number[];
  gradients: number[];
}

export function buildRoutePlan(
  routePoints: RoutePoint[],
  windPoints: RouteWindPoint[],
): RoutePlan {
  const segments = buildSegments(routePoints);
  return {
    segments,
    windPointIndex: segments.map((s) => nearestWindPointIndex(s, windPoints)),
    gradients: segments.map((s) =>
      s.distance > 0
        ? Math.max(
            -MAX_GRADIENT,
            Math.min(MAX_GRADIENT, (s.end.ele - s.start.ele) / s.distance),
          )
        : 0,
    ),
  };
}

// Ряды прогноза равномерные (час и 15 минут), поэтому нужный отсчёт считается
// арифметикой, а не перебором. На сетке вариантов старта это разница между
// сотнями миллисекунд и единицами: перебор 288 точек осадков на каждый сегмент
// каждого варианта был самой дорогой операцией расчёта.
interface SeriesIndex {
  startMs: number;
  stepMs: number;
}

const seriesIndexCache = new WeakMap<object, SeriesIndex>();

function seriesIndex(items: { time: string }[]): SeriesIndex {
  const cached = seriesIndexCache.get(items);
  if (cached) return cached;

  const startMs = new Date(items[0].time).getTime();
  const stepMs =
    items.length > 1 ? new Date(items[1].time).getTime() - startMs : 3600_000;
  const index = { startMs, stepMs: stepMs > 0 ? stepMs : 3600_000 };
  seriesIndexCache.set(items, index);
  return index;
}

function sampleAt<T extends { time: string }>(items: T[], targetMs: number): T {
  const { startMs, stepMs } = seriesIndex(items);
  const i = Math.round((targetMs - startMs) / stepMs);
  return items[Math.max(0, Math.min(items.length - 1, i))];
}

// Осадки берём из 15-минутного ряда: он вчетверо подробнее почасового и именно
// от него зависит, поможет ли сдвиг старта на полчаса. Если ряда нет — почасовые.
function precipitationAt(
  samples: PrecipSample[],
  hourly: number,
  targetMs: number,
): number {
  if (samples.length === 0) return hourly;
  return sampleAt(samples, targetMs).precipitation;
}

// windDirection — направление, откуда дует ветер (метеорологическая конвенция).
// Если ветер дует оттуда же, куда едет велосипедист (bearing) — это headwind.
function headwindComponent(
  windSpeed: number,
  windDirectionFrom: number,
  segmentBearing: number,
): number {
  const relativeAngle = windDirectionFrom - segmentBearing;
  return windSpeed * Math.cos((relativeAngle * Math.PI) / 180);
}

// Склеивает подряд идущие «мокрые» сегменты в интервалы «с какого по какой километр
// и в какие минуты велосипедист едет под дождём».
function buildRainWindows(segments: ScoredSegment[]): RainWindow[] {
  const windows: RainWindow[] = [];
  let current: RainWindow | null = null;

  for (const s of segments) {
    if (s.precipitation >= RAIN_THRESHOLD_MM) {
      if (current) {
        current.endKm = s.end.distanceFromStart / 1000;
        current.endTime = s.arrivalTime;
        current.maxIntensity = Math.max(current.maxIntensity, s.precipitation);
        current.maxProbability = Math.max(
          current.maxProbability,
          s.precipitationProbability,
        );
      } else {
        current = {
          startKm: s.start.distanceFromStart / 1000,
          endKm: s.end.distanceFromStart / 1000,
          startTime: s.arrivalTime,
          endTime: s.arrivalTime,
          maxIntensity: s.precipitation,
          maxProbability: s.precipitationProbability,
        };
      }
    } else if (current) {
      windows.push(current);
      current = null;
    }
  }

  if (current) windows.push(current);
  return windows;
}

export function scoreRoute(
  routePoints: RoutePoint[],
  windPoints: RouteWindPoint[],
  startTime: Date,
  profile: RiderProfile = DEFAULT_RIDER,
): RouteScore {
  return scoreWithPlan(
    buildRoutePlan(routePoints, windPoints),
    windPoints,
    startTime,
    profile,
  );
}

export function scoreWithPlan(
  plan: RoutePlan,
  windPoints: RouteWindPoint[],
  startTime: Date,
  profile: RiderProfile = DEFAULT_RIDER,
): RouteScore {
  const { segments } = plan;

  // Сегменты проходим по порядку, накапливая время: скорость на каждом зависит
  // от ветра в момент прибытия, а момент прибытия — от скорости на предыдущих.
  let elapsedSeconds = 0;
  let windlessSeconds = 0;
  let totalWeighted = 0;
  let totalDistance = 0;
  let wetDistance = 0;
  let maxPrecipitation = 0;

  const startMs = startTime.getTime();

  const scoredSegments: ScoredSegment[] = segments.map((segment, i) => {
    const etaMs = startMs + elapsedSeconds * 1000;

    const wp = windPoints[plan.windPointIndex[i]];
    const forecast = sampleAt(wp.forecasts, etaMs);
    const precipitation = precipitationAt(
      wp.precip,
      forecast.precipitation,
      etaMs,
    );

    const headwind = headwindComponent(
      forecast.speed,
      forecast.direction,
      segment.bearing,
    );

    const gradient = plan.gradients[i];

    const rho = airDensity(forecast.temperature, forecast.pressure);
    const speedMs = speedFor(profile, gradient, headwind / 3.6, rho);
    const windlessSpeedMs = speedFor(profile, gradient, 0, rho);

    const arrivalTime = new Date(etaMs).toISOString();
    elapsedSeconds += segment.distance / speedMs;
    windlessSeconds += segment.distance / windlessSpeedMs;

    totalWeighted += headwind * segment.distance;
    totalDistance += segment.distance;
    if (precipitation >= RAIN_THRESHOLD_MM) {
      wetDistance += segment.distance;
    }
    maxPrecipitation = Math.max(maxPrecipitation, precipitation);

    return {
      ...segment,
      windSpeed: forecast.speed,
      windDirection: forecast.direction,
      precipitation,
      precipitationProbability: forecast.precipitationProbability,
      temperature: forecast.temperature,
      headwindComponent: headwind,
      gradient,
      speedKmh: speedMs * 3.6,
      arrivalTime,
    };
  });

  const totalHeadwindExposure =
    totalDistance > 0 ? totalWeighted / totalDistance : 0;
  const wetDistanceRatio = totalDistance > 0 ? wetDistance / totalDistance : 0;
  const windTimeCostSeconds = elapsedSeconds - windlessSeconds;

  return {
    startTime: startTime.toISOString(),
    endTime: new Date(
      startTime.getTime() + elapsedSeconds * 1000,
    ).toISOString(),
    totalDistanceM: totalDistance,
    durationSeconds: elapsedSeconds,
    windlessDurationSeconds: windlessSeconds,
    windTimeCostSeconds,
    avgSpeedKmh:
      elapsedSeconds > 0 ? (totalDistance / elapsedSeconds) * 3.6 : 0,
    totalHeadwindExposure,
    wetDistanceRatio,
    maxPrecipitation,
    weatherCost:
      windTimeCostSeconds / 60 +
      wetDistanceRatio * WET_RATIO_PENALTY_MIN +
      Math.min(maxPrecipitation, 10) * INTENSITY_PENALTY_MIN,
    rainWindows: buildRainWindows(scoredSegments),
    segments: scoredSegments,
  };
}

// Возможные времена старта на ближайшие 48ч: «прямо сейчас» (округлённое вниз до
// 10 минут — шага радара) плюс целые часы из сетки прогноза первой точки.
// Первый вариант важен именно для радара: его покрытие заканчивается около «сейчас»,
// и старт, сдвинутый до ближайшего целого часа, уже выпадал бы из наблюдений.
export function getCandidateStartTimes(windPoints: RouteWindPoint[]): Date[] {
  const now = Date.now();
  const horizon = now + CANDIDATE_HORIZON_HOURS * 3600 * 1000;
  const nowStep = new Date(Math.floor(now / (10 * 60 * 1000)) * 10 * 60 * 1000);

  const hours = windPoints[0].forecasts
    .map((f) => new Date(f.time))
    .filter((t) => t.getTime() > now && t.getTime() <= horizon);

  return [nowStep, ...hours];
}

// Перебирает времена старта на ближайшие 48ч (шаг 1ч, только будущее) и выбирает
// вариант с минимальной сводной «ценой» погоды — ветер плюс штраф за дождь.
export function findBestStartTime(
  routePoints: RoutePoint[],
  windPoints: RouteWindPoint[],
  profile: RiderProfile = DEFAULT_RIDER,
): RouteScore {
  const candidateTimes = getCandidateStartTimes(windPoints);

  let best: RouteScore | null = null;
  for (const t of candidateTimes) {
    const score = scoreRoute(routePoints, windPoints, t, profile);
    if (!best || score.weatherCost < best.weatherCost) {
      best = score;
    }
  }

  return best ?? scoreRoute(routePoints, windPoints, new Date(), profile);
}

// Средние по маршруту скорость, направление ветра (циркулярное среднее) и осадки,
// взвешенные по дистанции сегмента — для сводки на слайдере времени.
export function summarizeWind(segments: ScoredSegment[]): {
  avgSpeed: number;
  avgDirection: number;
  maxPrecipitation: number;
} {
  let sumX = 0;
  let sumY = 0;
  let speedSum = 0;
  let totalDistance = 0;
  let maxPrecipitation = 0;

  for (const s of segments) {
    const rad = (s.windDirection * Math.PI) / 180;
    sumX += Math.cos(rad) * s.distance;
    sumY += Math.sin(rad) * s.distance;
    speedSum += s.windSpeed * s.distance;
    totalDistance += s.distance;
    maxPrecipitation = Math.max(maxPrecipitation, s.precipitation);
  }

  if (totalDistance === 0) return { avgSpeed: 0, avgDirection: 0, maxPrecipitation: 0 };

  const avgDirection = (Math.atan2(sumY, sumX) * 180) / Math.PI;

  return {
    avgSpeed: speedSum / totalDistance,
    avgDirection: (avgDirection + 360) % 360,
    maxPrecipitation,
  };
}

// Положение велосипедиста в момент `time` при выбранном старте — для проигрывания
// поездки поверх радара: карта показывает погоду на этот момент, маркер — где ты будешь.
export function positionAtTime(
  score: RouteScore,
  time: Date,
): { lat: number; lon: number; distanceKm: number } | null {
  const segments = score.segments;
  if (segments.length === 0) return null;

  const t = time.getTime();
  if (t <= new Date(score.startTime).getTime()) {
    const s = segments[0].start;
    return { lat: s.lat, lon: s.lon, distanceKm: 0 };
  }

  for (const s of segments) {
    if (new Date(s.arrivalTime).getTime() >= t) {
      return {
        lat: s.start.lat,
        lon: s.start.lon,
        distanceKm: s.start.distanceFromStart / 1000,
      };
    }
  }

  const last = segments[segments.length - 1].end;
  return {
    lat: last.lat,
    lon: last.lon,
    distanceKm: last.distanceFromStart / 1000,
  };
}
