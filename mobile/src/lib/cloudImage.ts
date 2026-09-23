import { Directory, File, Paths } from "expo-file-system";
import { cloudSliceAt, type CloudGrid } from "@shared/clouds";
import { encodeRgbaPng } from "./png";

// Модельное поле облачности — на будущее, куда не достаёт снимок спутника.
// Каждая сетка кладётся на карту своей картинкой через <ImageSource>: MapLibre
// растянет её между четырьмя углами и сгладит сам. Сетки идут от грубой к
// мелкой; там, где грубую накрывает мелкая, в грубой оставлена прозрачная
// дыра — иначе полупрозрачные слои складывались бы в двойную плотность.
const CACHE_DIR = "cloud-field";

// Сетка данных грубее картинки на порядок, поэтому больше пикселей не добавят
// деталей — только вес файла.
const IMAGE_PX = 256;

// Модельная облачность — среднее по ячейке в десяток километров, поэтому нули
// в ней почти не встречаются: без порога поле выходит сплошным серым киселём.
const CLEAR_THRESHOLD = 28; // %, ниже — рисуем чистое небо
const OVERCAST_LEVEL = 92; // %, выше — сплошная облачность
const CONTRAST_GAMMA = 1.5;
const MAX_ALPHA = 235;

export interface CloudImage {
  uri: string;
  // Углы для <ImageSource>: левый верхний, правый верхний, правый нижний, левый нижний.
  coordinates: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
}

export interface CloudField {
  key: string; // однозначно задаёт набор картинок — по нему идёт кроссфейд
  images: CloudImage[]; // от грубой к мелкой
}

function mercatorY(lat: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
}

function mercatorLat(y: number): number {
  return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
}

// Билинейная выборка из сетки cols x rows по долям (0..1).
function sample(
  values: number[],
  cols: number,
  rows: number,
  u: number,
  v: number,
): number {
  const x = Math.max(0, Math.min(cols - 1, u * (cols - 1)));
  const y = Math.max(0, Math.min(rows - 1, v * (rows - 1)));

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;

  return (
    values[y0 * cols + x0] * (1 - fx) * (1 - fy) +
    values[y0 * cols + x1] * fx * (1 - fy) +
    values[y1 * cols + x0] * (1 - fx) * fy +
    values[y1 * cols + x1] * fx * fy
  );
}

// Края картинок растушёваны: у своей границы сетка гаснет к нулю, а под
// мелкой сеткой грубая гаснет в той же полосе, где мелкая набирает
// плотность. Свой край гасят только слои поверх основы — основа (тайлы)
// закрывает экран целиком, и её край либо за экраном, либо ровно по нему. Без этого на стыке рисуется контур — MapLibre смешивает крайний
// пиксель картинки с прозрачностью, и жёсткая дыра в грубой сетке
// не совпадает с ним ровно. Полоса — доля меньшей стороны сетки, но не
// больше десятка километров: обзорной сетке незачем терять четверть площади
// на края.
const FEATHER_RATIO = 0.12;
const FEATHER_MAX_DEG = 0.12;

// 0 за пределами сетки, 1 в глубине, между ними — линейно по полосе.
function insetWeight(grid: CloudGrid, lat: number, lon: number): number {
  const inset = Math.min(
    lat - grid.south,
    grid.north - lat,
    lon - grid.west,
    grid.east - lon,
  );
  if (inset <= 0) return 0;
  const feather = Math.min(
    FEATHER_MAX_DEG,
    FEATHER_RATIO * Math.min(grid.north - grid.south, grid.east - grid.west),
  );
  return Math.min(1, inset / feather);
}

// `finer` — сетки поверх этой: под ними пиксель гаснет.
function render(
  grid: CloudGrid,
  slice: number[],
  finer: CloudGrid[],
  softEdge: boolean,
): Uint8Array {
  const cols = grid.longitudes.length;
  const rows = grid.latitudes.length;
  const rgba = new Uint8Array(IMAGE_PX * IMAGE_PX * 4);

  // <ImageSource> размещает картинку линейно в проекции Меркатора, а сетка
  // задана в градусах — поэтому строки переводим обратно в широту.
  const yTop = mercatorY(grid.north);
  const yBottom = mercatorY(grid.south);

  for (let py = 0; py < IMAGE_PX; py++) {
    const lat = mercatorLat(
      yTop + ((yBottom - yTop) * (py + 0.5)) / IMAGE_PX,
    );
    const v = (lat - grid.south) / (grid.north - grid.south);

    for (let px = 0; px < IMAGE_PX; px++) {
      // По долготе Меркатор линеен, пересчёт не нужен.
      const u = (px + 0.5) / IMAGE_PX;
      const i = (py * IMAGE_PX + px) * 4;

      const lon = grid.west + (grid.east - grid.west) * u;
      const own = softEdge ? insetWeight(grid, lat, lon) : 1;
      if (own <= 0) continue;

      const cover = sample(slice, cols, rows, u, v);
      const linear = Math.max(
        0,
        Math.min(
          1,
          (cover - CLEAR_THRESHOLD) / (OVERCAST_LEVEL - CLEAR_THRESHOLD),
        ),
      );
      const density = Math.pow(linear, CONTRAST_GAMMA);
      const alpha = (density * MAX_ALPHA) / 255;

      // Под мелкой сеткой гаснем не линейно, а с поправкой на то, что мелкая
      // ложится сверху: при её плотности t·A и нашей A·(1−t)/(1−t·A) сумма
      // остаётся ровно A, и вдоль стыка не проступает светлая рамка.
      let weight = own;
      for (const g of finer) {
        const t = insetWeight(g, lat, lon);
        weight *= (1 - t) / (1 - t * alpha);
      }
      if (weight <= 0) continue;

      // Тон подогнан под снимок: плотная облачность почти белая, тонкая —
      // сероватая. Иначе на стыке «снимок → прогноз» цвет заметно прыгает.
      const tone = 250 - Math.round(density * 34);
      rgba[i] = tone;
      rgba[i + 1] = tone;
      rgba[i + 2] = Math.min(255, tone + 4); // чуть холоднее серого
      rgba[i + 3] = Math.round(alpha * weight * 255);
    }
  }

  return encodeRgbaPng(IMAGE_PX, IMAGE_PX, rgba);
}

// Сколько последних картинок держим на диске. Удалять предыдущую сразу нельзя:
// при перемотке времени слой ещё несколько сотен миллисекунд показывает старый
// кадр, пока проявляется новый, — и файл под ним исчезал бы прямо во время
// проявления. Кадр — это по картинке на сетку, обычно две; четырёх кадров
// хватает на кроссфейд и быструю перемотку туда-обратно.
const KEEP_FILES = 8;

const written: string[] = [];
let cleanedStale = false;

function writeImage(
  root: Directory,
  grid: CloudGrid,
  slice: number[],
  finer: CloudGrid[],
  softEdge: boolean,
  targetMs: number,
): CloudImage {
  // Срез почасовой, поэтому час вместе с границами однозначно задаёт картинку.
  // Дыра под мелкими сетками входит в имя через их границы — иначе картинка
  // без дыры от старого набора сеток подошла бы по имени к новому.
  const hole = finer.map((g) => `${g.south.toFixed(2)}-${g.west.toFixed(2)}`).join("_");
  const name = `${Math.round(targetMs / 3600_000)}-${grid.south.toFixed(2)}-${grid.west.toFixed(2)}-${grid.north.toFixed(2)}-${grid.east.toFixed(2)}${hole ? `-h${hole}` : ""}.png`;
  const file = new File(root, name);
  if (!file.exists) {
    file.create({ overwrite: true });
    file.write(render(grid, slice, finer, softEdge));
  }

  // Иначе кэш рос бы неограниченно: за поездку набегают десятки часовых срезов.
  const already = written.indexOf(name);
  if (already !== -1) written.splice(already, 1);
  written.push(name);
  while (written.length > KEEP_FILES) {
    const stale = new File(root, written.shift()!);
    if (stale.exists) stale.delete();
  }

  return {
    uri: file.uri,
    coordinates: [
      [grid.west, grid.north],
      [grid.east, grid.north],
      [grid.east, grid.south],
      [grid.west, grid.south],
    ],
  };
}

// `grids` — от грубой к мелкой.
export function writeCloudField(
  grids: CloudGrid[],
  targetMs: number,
): CloudField | null {
  const slices = grids.map((g) => cloudSliceAt(g, targetMs));
  if (slices.some((s) => s.length === 0)) return null;

  const root = new Directory(Paths.cache, CACHE_DIR);
  if (!root.exists) root.create({ intermediates: true });

  // Картинки от прошлых запусков показывать уже некому — чистим их разом.
  if (!cleanedStale) {
    cleanedStale = true;
    for (const entry of root.list()) {
      if (entry instanceof File) entry.delete();
    }
  }

  const images = grids.map((grid, i) =>
    writeImage(root, grid, slices[i], grids.slice(i + 1), i > 0, targetMs),
  );
  return { key: images.map((img) => img.uri).join("|"), images };
}
