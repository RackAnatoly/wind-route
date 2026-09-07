import type { RoutePoint, Segment } from "./types";

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

// Great-circle initial bearing from point a to point b, degrees 0-360, 0 = North.
export function bearing(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const dLon = toRad(bLon - aLon);

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  const theta = Math.atan2(y, x);
  return (toDeg(theta) + 360) % 360;
}

const EARTH_RADIUS_M = 6371000;

// Great-circle distance between two points, meters.
export function haversineDistance(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Строит сегменты маршрута из последовательности точек: бэаринг и дистанция между соседями.
export function buildSegments(points: RoutePoint[]): Segment[] {
  const segments: Segment[] = [];
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1];
    const end = points[i];
    segments.push({
      start,
      end,
      bearing: bearing(start.lat, start.lon, end.lat, end.lon),
      distance: end.distanceFromStart - start.distanceFromStart,
    });
  }
  return segments;
}
