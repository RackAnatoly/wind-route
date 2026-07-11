import { haversineDistance, buildSegments } from "./bearing";
import type {
  RoutePoint,
  Segment,
  ScoredSegment,
  RouteScore,
  WindForecast,
} from "../types";
import type { RouteWindPoint } from "./wind";

// Средняя скорость на шоссейном велосипеде, км/ч — используется для оценки ETA на сегмент.
export const DEFAULT_AVG_SPEED_KMH = 27;

function nearestWindPoint(
  segment: Segment,
  windPoints: RouteWindPoint[],
): RouteWindPoint {
  const midLat = (segment.start.lat + segment.end.lat) / 2;
  const midLon = (segment.start.lon + segment.end.lon) / 2;

  let best = windPoints[0];
  let bestDist = Infinity;
  for (const wp of windPoints) {
    const d = haversineDistance(midLat, midLon, wp.point.lat, wp.point.lon);
    if (d < bestDist) {
      bestDist = d;
      best = wp;
    }
  }
  return best;
}

function nearestForecast(
  forecasts: WindForecast[],
  targetTime: Date,
): WindForecast {
  let best = forecasts[0];
  let bestDiff = Infinity;
  for (const f of forecasts) {
    const diff = Math.abs(new Date(f.time).getTime() - targetTime.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = f;
    }
  }
  return best;
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

export function scoreRoute(
  routePoints: RoutePoint[],
  windPoints: RouteWindPoint[],
  startTime: Date,
  avgSpeedKmh: number = DEFAULT_AVG_SPEED_KMH,
): RouteScore {
  const segments = buildSegments(routePoints);
  const avgSpeedMS = (avgSpeedKmh * 1000) / 3600;

  let totalWeighted = 0;
  let totalDistance = 0;

  const scoredSegments: ScoredSegment[] = segments.map((segment) => {
    const etaSeconds = segment.start.distanceFromStart / avgSpeedMS;
    const etaTime = new Date(startTime.getTime() + etaSeconds * 1000);

    const wp = nearestWindPoint(segment, windPoints);
    const forecast = nearestForecast(wp.forecasts, etaTime);

    const headwind = headwindComponent(
      forecast.speed,
      forecast.direction,
      segment.bearing,
    );

    totalWeighted += headwind * segment.distance;
    totalDistance += segment.distance;

    return {
      ...segment,
      windSpeed: forecast.speed,
      windDirection: forecast.direction,
      headwindComponent: headwind,
    };
  });

  return {
    startTime: startTime.toISOString(),
    totalHeadwindExposure: totalDistance > 0 ? totalWeighted / totalDistance : 0,
    segments: scoredSegments,
  };
}

// Перебирает времена старта на ближайшие 48ч (шаг 1ч, только будущее) и выбирает
// вариант с минимальной суммарной headwind-экспозицией.
export function findBestStartTime(
  routePoints: RoutePoint[],
  windPoints: RouteWindPoint[],
  avgSpeedKmh: number = DEFAULT_AVG_SPEED_KMH,
): RouteScore {
  const now = Date.now();
  const candidateTimes = windPoints[0].forecasts
    .map((f) => new Date(f.time))
    .filter((t) => t.getTime() >= now);

  let best: RouteScore | null = null;
  for (const t of candidateTimes) {
    const score = scoreRoute(routePoints, windPoints, t, avgSpeedKmh);
    if (!best || score.totalHeadwindExposure < best.totalHeadwindExposure) {
      best = score;
    }
  }

  return best ?? scoreRoute(routePoints, windPoints, new Date(), avgSpeedKmh);
}
