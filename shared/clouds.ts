// Модельное поле облачности — на будущее. Снимок спутника (см. shared/satellite.ts)
// знает только то, что уже было, а маршрут планируется вперёд, поэтому дальше
// последнего кадра карту рисует прогноз: берём численную модель Open-Meteo на
// сетке точек и строим поле сами.
//
// Точно так же устроена облачность у погодных приложений: наблюдение на прошлое
// и «сейчас», модель — на будущее.
import { createCache, type CacheStore } from "./cache";
import { requestOpenMeteo } from "./openMeteo";
import type { RoutePoint } from "./types";

// 12x12 = 144 точки в одном запросе. Каждая координата расходует квоту
// Open-Meteo отдельно, а сеток на экран уходит до четырёх тайлов плюс
// мелкая по маршруту — 16x16 (256) выжигало часовой лимит за одну сессию
// с отдалениями. На 7x7 поле было десятком размытых пятен; 12 узлов держат
// отдельные фронты, а над маршрутом мелкая сетка и на 12 узлах даёт
// ~2,5 км — около родного шага модели.
//
// Верхний предел — 24x24: координаты уходят в строку запроса, и дальше
// сервер отвечает 414 (URI Too Long).
const GRID_SIZE = 12;

// Поле собирается из двух слоёв. Основа — сетки-тайлы по видимой области
// карты (см. `cloudTilesFor`): облачность есть на любом зуме и в любом месте,
// куда уехала карта. Сверху — мелкая сетка по маршруту: она обтягивает трек с
// небольшим запасом, 12 узлов на полградуса — это 3–5 км, около родного шага
// модели, и при приближении фронты не расплываются. Между собой слои
// склеиваются уже при отрисовке.
const FINE_PADDING_RATIO = 0.15;
const FINE_MIN_PADDING_DEG = 0.08;

// Тайлы уложены по градусной сетке с началом в (0°, 0°). Уровень 0 — 2,4°,
// каждый следующий вдвое крупнее; уровень выбирается так, чтобы экран
// закрывался не более чем 2×2 тайлами — четыре запроса на самый неудачный
// вид, а обычно один-два. Число узлов в тайле не меняется, поэтому при
// отдалении поле честно грубеет вместе с картой.
//
// Потолок — масштаб региона: приложение проверяет маршрут, а не глобус, и
// отдалённый «в космос» экран не должен стоить четырёх запросов на каждое
// движение. Дальше потолка новых тайлов нет — остаётся последнее поле.
const TILE_BASE_SPAN_DEG = 2.4;
const TILE_MAX_LEVEL = 2; // 9,6° — экран страны
// Проекция Меркатора у полюсов уходит в бесконечность; выше 85° карты и так
// нет, а запрос за пределы диапазона Open-Meteo отвергает.
const MAX_LAT = 85;

// Самый дорогой запрос приложения — 256 координат за раз, — поэтому кэшируем
// его в первую очередь. Час — с таким шагом обновляется сам прогноз; записей
// хватает на маршрут и на тайлы нескольких зумов вокруг него.
// Ключ — bbox, округлённый до 0,05°: сетка на 2,4° от дрожания геолокации
// на сотни метров не меняется, а без округления каждый запуск шёл бы мимо.
const CACHE_TTL_MS = 60 * 60_000;
const CACHE_MAX_ENTRIES = 16;
const CACHE_KEY_STEP_DEG = 0.05;

const cache = createCache<CloudGrid>({
  ttlMs: CACHE_TTL_MS,
  maxEntries: CACHE_MAX_ENTRIES,
});

// Приложение подключает хранилище само: в mobile это файл, у веба своё.
export function attachCloudCacheStore(store: CacheStore): void {
  cache.attachStore(store);
}

// Размер сетки — часть ключа: соседние тайлы сшиваются по общим узлам, и
// сетка на 16 узлов из старого кэша с сеткой на 12 рядом не уживётся.
function cacheKey({ south, west, north, east }: Bounds): string {
  const bounds = [south, west, north, east]
    .map((v) => (Math.round(v / CACHE_KEY_STEP_DEG) * CACHE_KEY_STEP_DEG).toFixed(2))
    .join(",");
  return `${GRID_SIZE}:${bounds}`;
}

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
  // Ядро, которое сетка обязана покрыть в полную силу, — у мелкой сетки по
  // маршруту это сам трек без запаса. Снаружи ядра, в запасе, поле плавно
  // гаснет к краю сетки и отдаёт место грубому слою под ней. Без ядра край
  // гасится узкой полосой (см. cloudImage).
  core?: Bounds;
}

interface CloudResponse {
  hourly: { time: string[]; cloud_cover: (number | null)[] };
}

function routeBounds(points: RoutePoint[]): { outer: Bounds; core: Bounds } {
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

  const padLat = Math.max(
    (north - south) * FINE_PADDING_RATIO,
    FINE_MIN_PADDING_DEG,
  );
  const padLon = Math.max(
    (east - west) * FINE_PADDING_RATIO,
    FINE_MIN_PADDING_DEG,
  );

  return {
    outer: {
      south: south - padLat,
      north: north + padLat,
      west: west - padLon,
      east: east + padLon,
    },
    core: { south, north, west, east },
  };
}

// Набор тайлов, закрывающий видимую область: уровень и диапазон индексов.
export interface CloudTileSet {
  key: string; // однозначно задаёт набор — по нему решаем, нужен ли новый запрос
  level: number;
  i0: number; // долгота, включительно
  i1: number;
  j0: number; // широта, включительно
  j1: number;
}

function tileSpan(level: number): number {
  return TILE_BASE_SPAN_DEG * 2 ** level;
}

// null — экран шире потолка, тайлы не запрашиваем.
export function cloudTilesFor(viewport: Bounds): CloudTileSet | null {
  const extent = Math.max(
    viewport.north - viewport.south,
    viewport.east - viewport.west,
  );
  let level = 0;
  while (level < TILE_MAX_LEVEL && tileSpan(level) < extent) level++;
  const span = tileSpan(level);
  if (extent > span) return null;

  const i0 = Math.floor(viewport.west / span);
  const i1 = Math.floor(viewport.east / span);
  const j0 = Math.floor(viewport.south / span);
  const j1 = Math.floor(viewport.north / span);

  return { key: `${level}/${i0}..${i1}/${j0}..${j1}`, level, i0, i1, j0, j1 };
}

function tileBounds(set: CloudTileSet, i: number, j: number): Bounds {
  const span = tileSpan(set.level);
  return {
    west: Math.max(-180, i * span),
    east: Math.min(180, (i + 1) * span),
    south: Math.max(-MAX_LAT, j * span),
    north: Math.min(MAX_LAT, (j + 1) * span),
  };
}

// Соседние тайлы делят граничные узлы — у обоих есть ряд ровно на общей
// границе, и модель отдаёт для него одни и те же значения. Поэтому их можно
// сшить в одну сетку без шва, а одну сетку карта рисует одной картинкой:
// класть картинки встык нельзя, MapLibre подмешивает к краю прозрачность
// и на стыках проступают линии.
function mergeTiles(
  set: CloudTileSet,
  tiles: CloudGrid[][], // tiles[j - j0][i - i0]
): CloudGrid {
  const rows = set.j1 - set.j0 + 1;
  const cols = set.i1 - set.i0 + 1;

  const latitudes: number[] = [];
  const longitudes: number[] = [];
  for (let r = 0; r < rows; r++) {
    latitudes.push(...tiles[r][0].latitudes.slice(r > 0 ? 1 : 0));
  }
  for (let c = 0; c < cols; c++) {
    longitudes.push(...tiles[0][c].longitudes.slice(c > 0 ? 1 : 0));
  }

  // Ряд времени берём у первого тайла. Остальные могли прийти из кэша с
  // другого часа (или, после полуночи, с другого дня) — их срезы сдвигаем по
  // метке времени, а не по индексу.
  const base = tiles[0][0];
  const baseStart = new Date(base.times[0]).getTime();
  const stepMs =
    base.times.length > 1
      ? new Date(base.times[1]).getTime() - baseStart
      : 3600_000;
  const offsets = tiles.map((row) =>
    row.map((t) =>
      Math.round((new Date(t.times[0]).getTime() - baseStart) / stepMs),
    ),
  );

  const width = longitudes.length;
  const cover = base.times.map((_, k) => {
    const slice = new Array<number>(latitudes.length * width).fill(0);
    let latBase = 0;
    for (let r = 0; r < rows; r++) {
      const tileRows = tiles[r][0].latitudes.length;
      let lonBase = 0;
      for (let c = 0; c < cols; c++) {
        const tile = tiles[r][c];
        const tileCols = tile.longitudes.length;
        const kk = Math.max(0, Math.min(tile.cover.length - 1, k - offsets[r][c]));
        const src = tile.cover[kk];
        for (let y = 0; y < tileRows; y++) {
          for (let x = 0; x < tileCols; x++) {
            slice[(latBase + y) * width + lonBase + x] = src[y * tileCols + x];
          }
        }
        // Общий столбец перезаписывается тем же значением — сдвиг на единицу
        // меньше ширины тайла.
        lonBase += tileCols - 1;
      }
      latBase += tileRows - 1;
    }
    return slice;
  });

  return {
    latitudes,
    longitudes,
    times: base.times,
    cover,
    south: latitudes[0],
    north: latitudes[latitudes.length - 1],
    west: longitudes[0],
    east: longitudes[longitudes.length - 1],
  };
}

export async function fetchCloudTiles(set: CloudTileSet): Promise<CloudGrid> {
  const rows: Promise<CloudGrid[]>[] = [];
  for (let j = set.j0; j <= set.j1; j++) {
    const row: Promise<CloudGrid>[] = [];
    for (let i = set.i0; i <= set.i1; i++) {
      row.push(fetchCloudGridForBounds(tileBounds(set, i, j)));
    }
    rows.push(Promise.all(row));
  }
  return mergeTiles(set, await Promise.all(rows));
}

export interface Bounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

// Мелкая сетка по маршруту — ложится поверх тайлов.
export async function fetchRouteCloudGrid(
  routePoints: RoutePoint[],
): Promise<CloudGrid> {
  const { outer, core } = routeBounds(routePoints);
  // Ядро в кэш не попадает: оно считается из маршрута, а не приходит с сервера.
  const grid = await fetchCloudGridForBounds(outer);
  return { ...grid, core };
}

// Тот же запрос, но по произвольному bbox — используется для дефолтного вида
// карты вокруг пользователя, когда маршрут ещё не загружен.
export function fetchCloudGridForBounds(bounds: Bounds): Promise<CloudGrid> {
  return cache.resolve(cacheKey(bounds), () => requestCloudGrid(bounds));
}

async function requestCloudGrid({
  south,
  north,
  west,
  east,
}: Bounds): Promise<CloudGrid> {
  const latitudes: number[] = [];
  const longitudes: number[] = [];
  // Крайние узлы — ровно в границах, без арифметики: соседние тайлы делят
  // граничный ряд, и он должен совпадать побитово.
  for (let i = 0; i < GRID_SIZE; i++) {
    const f = i / (GRID_SIZE - 1);
    const last = i === GRID_SIZE - 1;
    latitudes.push(last ? north : south + (north - south) * f);
    longitudes.push(last ? east : west + (east - west) * f);
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

  const data = await requestOpenMeteo<CloudResponse | CloudResponse[]>({
    latitude: lats.map((v) => v.toFixed(4)).join(","),
    longitude: lons.map((v) => v.toFixed(4)).join(","),
    hourly: "cloud_cover",
    forecast_days: "3",
    timezone: "GMT",
  });
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
