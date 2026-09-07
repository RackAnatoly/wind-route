// Слой радара осадков: RainViewer агрегирует мозаики национальных метеорадаров
// (NEXRAD/MRMS в США, DWD RADOLAN в Германии, UK Met Office, Environment Canada и др.)
// и отдаёт их как XYZ-тайлы с шагом 10 минут: ~2 часа наблюдений назад
// плюс до ~30 минут наукаста (экстраполяция движения эхо-сигнала).
const RAINVIEWER_INDEX_URL = "https://api.rainviewer.com/public/weather-maps.json";

const TILE_SIZE = 512;
const COLOR_SCHEME = 2; // Universal Blue — не конфликтует с красно-зелёной заливкой маршрута
const SMOOTH = 1;
const SNOW = 1;

// Публичный (безключевой) тайлкеш RainViewer отдаёт мозаику только до z=7:
// выше сервер возвращает заглушку «Zoom Level Not Supported». Тайлы 512px дают
// вдвое больше пикселей на тот же z, а на крупных масштабах Leaflet растягивает
// последний доступный уровень. С API-ключом доступны более детальные зумы.
export const MAX_NATIVE_TILE_ZOOM = 7;

// Leaflet: тайл 512px при zoomOffset -1 запрашивается на уровне (mapZoom - 1),
// поэтому по карте ограничение приходится на единицу больший зум.
export const MAX_NATIVE_MAP_ZOOM = MAX_NATIVE_TILE_ZOOM + 1;
export const TILE_ZOOM_OFFSET = -1;

export interface RadarFrame {
  time: number; // unix seconds, начало 10-минутного скана
  path: string;
  kind: "past" | "nowcast";
}

export interface RadarIndex {
  host: string;
  frames: RadarFrame[]; // отсортированы по времени
  generatedAt: number; // unix seconds
}

interface RainViewerResponse {
  host: string;
  generated: number;
  radar?: {
    past?: { time: number; path: string }[];
    nowcast?: { time: number; path: string }[];
  };
}

export async function fetchRadarIndex(): Promise<RadarIndex> {
  const res = await fetch(RAINVIEWER_INDEX_URL);
  if (!res.ok) {
    throw new Error(`RainViewer вернул ошибку ${res.status}`);
  }

  const data = (await res.json()) as RainViewerResponse;
  const past = data.radar?.past ?? [];
  const nowcast = data.radar?.nowcast ?? [];

  const frames: RadarFrame[] = [
    ...past.map((f) => ({ ...f, kind: "past" as const })),
    ...nowcast.map((f) => ({ ...f, kind: "nowcast" as const })),
  ].sort((a, b) => a.time - b.time);

  return { host: data.host, frames, generatedAt: data.generated };
}

export function radarTileUrl(index: RadarIndex, frame: RadarFrame): string {
  return `${index.host}${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/${SMOOTH}_${SNOW}.png`;
}

const FRAME_INTERVAL_MS = 10 * 60 * 1000;

// Индекс RainViewer публикуется с задержкой, поэтому последний скан считаем
// актуальным ещё один интервал — так же ведут себя радарные приложения,
// показывая «сейчас» по последнему пришедшему кадру.
const LAST_FRAME_GRACE_MS = FRAME_INTERVAL_MS;

// Радар покрывает только окно вокруг «сейчас»; за его пределами показываем модельный прогноз.
export function radarCoverage(index: RadarIndex): { from: Date; to: Date } | null {
  if (index.frames.length === 0) return null;
  const last = index.frames[index.frames.length - 1];
  return {
    from: new Date(index.frames[0].time * 1000),
    to: new Date(last.time * 1000 + FRAME_INTERVAL_MS + LAST_FRAME_GRACE_MS),
  };
}

// Кадр, действующий на момент `target`: каждый скан описывает свой 10-минутный
// интервал, у последнего — с запасом на задержку публикации. Вне покрытия — null.
export function frameAt(index: RadarIndex, target: Date): RadarFrame | null {
  if (index.frames.length === 0) return null;

  let best = index.frames[0];
  let bestDiff = Infinity;
  for (const frame of index.frames) {
    const diff = Math.abs(frame.time * 1000 - target.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      best = frame;
    }
  }

  const isLast = best === index.frames[index.frames.length - 1];
  const offset = target.getTime() - best.time * 1000;
  const forwardLimit = isLast
    ? FRAME_INTERVAL_MS + LAST_FRAME_GRACE_MS
    : FRAME_INTERVAL_MS / 2;

  return offset >= -FRAME_INTERVAL_MS / 2 && offset <= forwardLimit
    ? best
    : null;
}
