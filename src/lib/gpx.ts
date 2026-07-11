import GpxParser from "gpxparser";
import { haversineDistance } from "./bearing";
import type { RoutePoint } from "../types";

const RESAMPLE_INTERVAL_M = 400;
const RESAMPLE_THRESHOLD_POINTS = 500;

interface RawGpxPoint {
  lat: number;
  lon: number;
  ele: number | null;
}

export interface ParsedRoute {
  rawPoints: RoutePoint[]; // полное разрешение GPX — для elevation profile
  routePoints: RoutePoint[]; // ресемплированные точки — для bearing/wind/scoring
}

function withDistances(points: RawGpxPoint[]): RoutePoint[] {
  let distanceFromStart = 0;
  return points.map((p, i) => {
    if (i > 0) {
      const prev = points[i - 1];
      distanceFromStart += haversineDistance(prev.lat, prev.lon, p.lat, p.lon);
    }
    return { lat: p.lat, lon: p.lon, ele: p.ele ?? 0, distanceFromStart };
  });
}

// Прореживает точки так, чтобы соседние выбранные точки были на расстоянии
// не менее intervalM друг от друга — иначе bearing шумит на соседних GPS-фиксах.
function resample(points: RawGpxPoint[], intervalM: number): RawGpxPoint[] {
  if (points.length <= 2) return points;

  const picked: RawGpxPoint[] = [points[0]];
  let accSinceLastPicked = 0;

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    accSinceLastPicked += haversineDistance(
      prev.lat,
      prev.lon,
      curr.lat,
      curr.lon,
    );
    if (accSinceLastPicked >= intervalM) {
      picked.push(curr);
      accSinceLastPicked = 0;
    }
  }

  const last = points[points.length - 1];
  if (picked[picked.length - 1] !== last) {
    picked.push(last);
  }

  return picked;
}

export function parseGpx(xmlText: string): ParsedRoute {
  const parser = new GpxParser();
  parser.parse(xmlText);

  const track = parser.tracks[0] ?? parser.routes[0];
  if (!track || track.points.length === 0) {
    throw new Error("GPX-файл не содержит трека с точками");
  }

  const rawGpxPoints: RawGpxPoint[] = track.points.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    ele: p.ele,
  }));

  const resampled =
    rawGpxPoints.length > RESAMPLE_THRESHOLD_POINTS
      ? resample(rawGpxPoints, RESAMPLE_INTERVAL_M)
      : rawGpxPoints;

  return {
    rawPoints: withDistances(rawGpxPoints),
    routePoints: withDistances(resampled),
  };
}
