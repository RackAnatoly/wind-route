import { XMLParser } from "fast-xml-parser";
import { haversineDistance } from "./bearing";
import type { RoutePoint } from "./types";

const RESAMPLE_INTERVAL_M = 400;
const RESAMPLE_THRESHOLD_POINTS = 500;

// Высоты в GPX шумят на несколько метров от точки к точке (барометр, GPS).
// На дистанции сегмента это даёт фантомные уклоны в проценты, из-за чего
// расчётная скорость скачет. Сглаживаем скользящим средним.
const ELEVATION_SMOOTHING_WINDOW = 2;

function smoothElevations(points: RoutePoint[]): RoutePoint[] {
  if (points.length < 3) return points;

  return points.map((p, i) => {
    const from = Math.max(0, i - ELEVATION_SMOOTHING_WINDOW);
    const to = Math.min(points.length - 1, i + ELEVATION_SMOOTHING_WINDOW);
    let sum = 0;
    for (let j = from; j <= to; j++) sum += points[j].ele;
    return { ...p, ele: sum / (to - from + 1) };
  });
}

interface RawGpxPoint {
  lat: number;
  lon: number;
  ele: number | null;
}

export interface ParsedRoute {
  rawPoints: RoutePoint[]; // полное разрешение GPX — для elevation profile
  routePoints: RoutePoint[]; // ресемплированные точки — для bearing/wind/scoring
}

// fast-xml-parser вместо gpxparser: тот тянет DOMParser, которого нет в React Native.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  isArray: (name) =>
    ["trk", "trkseg", "trkpt", "rte", "rtept"].includes(name),
});

interface GpxNode {
  "@lat"?: string;
  "@lon"?: string;
  ele?: number | string;
}

function toRawPoints(nodes: GpxNode[] | undefined): RawGpxPoint[] {
  if (!nodes) return [];
  return nodes
    .map((n) => ({
      lat: Number(n["@lat"]),
      lon: Number(n["@lon"]),
      ele: n.ele === undefined || n.ele === "" ? null : Number(n.ele),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
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
  const doc = parser.parse(xmlText);
  const gpx = doc?.gpx;
  if (!gpx) {
    throw new Error("Файл не похож на GPX: нет корневого элемента <gpx>");
  }

  // Трек может быть разбит на несколько сегментов; маршрут (<rte>) — запасной вариант.
  const trackPoints: GpxNode[] = (gpx.trk ?? []).flatMap(
    (trk: { trkseg?: { trkpt?: GpxNode[] }[] }) =>
      (trk.trkseg ?? []).flatMap((seg) => seg.trkpt ?? []),
  );
  const routeNodes: GpxNode[] = (gpx.rte ?? []).flatMap(
    (rte: { rtept?: GpxNode[] }) => rte.rtept ?? [],
  );
  const nodes = trackPoints.length > 0 ? trackPoints : routeNodes;

  const rawGpxPoints = toRawPoints(nodes);
  if (rawGpxPoints.length === 0) {
    throw new Error("GPX-файл не содержит трека с точками");
  }

  const resampled =
    rawGpxPoints.length > RESAMPLE_THRESHOLD_POINTS
      ? resample(rawGpxPoints, RESAMPLE_INTERVAL_M)
      : rawGpxPoints;

  return {
    // rawPoints остаются без сглаживания — это профиль высоты для графика.
    rawPoints: withDistances(rawGpxPoints),
    routePoints: smoothElevations(withDistances(resampled)),
  };
}
