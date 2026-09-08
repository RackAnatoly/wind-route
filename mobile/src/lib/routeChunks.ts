import type { ScoredSegment } from "@shared/types";
import { theme } from "../theme";

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface RouteChunk {
  coordinates: LatLng[];
  color: string;
}

// Сколько градаций встречного/попутного ветра различаем цветом.
const LEVELS = 5;

function levelOf(headwind: number, maxAbs: number): number {
  if (maxAbs <= 0) return 0;
  const normalized = Math.max(-1, Math.min(1, headwind / maxAbs));
  return Math.round(normalized * LEVELS);
}

function colorOf(level: number): string {
  if (level === 0) return "hsl(0, 0%, 70%)";
  const intensity = Math.abs(level) / LEVELS;
  const hue = level > 0 ? theme.headwind : theme.tailwind;
  return `hsl(${hue}, 75%, ${70 - intensity * 32}%)`;
}

// Цвет линии в MapLibre берётся из свойства объекта, поэтому весь маршрут живёт
// в одном слое. Но каждый сегмент отдельным объектом — это сотни объектов на
// перерисовку, поэтому квантуем ветер в несколько уровней и склеиваем соседние
// сегменты одного уровня в один кусок.
export function buildRouteChunks(segments: ScoredSegment[]): RouteChunk[] {
  if (segments.length === 0) return [];

  const maxAbs = Math.max(
    ...segments.map((s) => Math.abs(s.headwindComponent)),
    0.001,
  );

  const chunks: RouteChunk[] = [];
  let currentLevel = levelOf(segments[0].headwindComponent, maxAbs);
  let coordinates: LatLng[] = [
    { latitude: segments[0].start.lat, longitude: segments[0].start.lon },
  ];

  for (const segment of segments) {
    const level = levelOf(segment.headwindComponent, maxAbs);
    const end = { latitude: segment.end.lat, longitude: segment.end.lon };

    if (level !== currentLevel) {
      chunks.push({ coordinates, color: colorOf(currentLevel) });
      // Новый кусок начинается с последней точки предыдущего — иначе в линии дырка.
      coordinates = [coordinates[coordinates.length - 1], end];
      currentLevel = level;
    } else {
      coordinates.push(end);
    }
  }

  chunks.push({ coordinates, color: colorOf(currentLevel) });
  return chunks;
}

export function routeCoordinates(segments: ScoredSegment[]): LatLng[] {
  if (segments.length === 0) return [];
  return [
    { latitude: segments[0].start.lat, longitude: segments[0].start.lon },
    ...segments.map((s) => ({ latitude: s.end.lat, longitude: s.end.lon })),
  ];
}
