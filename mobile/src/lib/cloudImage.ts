import { Directory, File, Paths } from "expo-file-system";
import {
  cloudSliceAt,
  precipSliceAt,
  type CloudGrid,
} from "@shared/clouds";
import {
  CLOUD_MAX_OPACITY,
  CLOUD_SHADOW_DENSE,
  CLOUD_SHADOW_THIN,
} from "@shared/cloudTone";
import { RADAR_SCALE } from "../theme";
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

// Как раскрасить значение сетки: цвет и непрозрачность (0..1) либо null —
// пиксель пустой. Отрисовка одна на облака и дождь, отличается только этим.
type Shade = (value: number) => [r: number, g: number, b: number, a: number] | null;

// Облачность — тень: чем плотнее, тем темнее и гуще.
const cloudShade: Shade = (cover) => {
  const linear = Math.max(
    0,
    Math.min(1, (cover - CLEAR_THRESHOLD) / (OVERCAST_LEVEL - CLEAR_THRESHOLD)),
  );
  if (linear <= 0) return null;
  const density = Math.pow(linear, CONTRAST_GAMMA);
  const tone = (c: number) =>
    Math.round(
      CLOUD_SHADOW_THIN[c] + (CLOUD_SHADOW_DENSE[c] - CLOUD_SHADOW_THIN[c]) * density,
    );
  return [tone(0), tone(1), tone(2), density * CLOUD_MAX_OPACITY];
};

// Дождь — цветами радара, чтобы на стыке «радар → прогноз» он не менял вид.
// Ступени шкалы RainViewer заданы в dBZ; в мм/ч их переводит формула
// Маршалла–Палмера (Z = 200·R^1,6), которой радары и считают интенсивность:
// 10 dBZ ≈ 0,15 мм/ч, 20 ≈ 0,6, 30 ≈ 2,7, 40 ≈ 11, 45 ≈ 24, 50 ≈ 49.
// Модель усредняет осадки по ячейке в десяток километров, поэтому ливни в ней
// мягче, чем на радаре, — верхние ступени встречаются редко.
const RAIN_STEPS_MM = [0.1, 0.6, 2.7, 11, 24, 49];
// Модель размазывает морось ~0,1 мм/ч по ячейкам в десяток километров: в полную
// силу она легла бы ровной голубой заливкой на весь экран, хотя радар в это
// время видит сухую сушу. Поэтому слабые осадки проявляются постепенно: ниже
// 0,1 мм/ч — сухо, к 0,4 мм/ч — в полную силу, как на радаре.
const RAIN_FADE_FROM_MM = 0.1;
const RAIN_FADE_TO_MM = 0.4;
const RAIN_OPACITY = 0.9; // полностью непрозрачным не делаем — под дождём видны дороги
const RAIN_RGB = RADAR_SCALE.map((hex) => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]);

const rainShade: Shade = (mm) => {
  if (mm < RAIN_FADE_FROM_MM) return null;
  let step = 0;
  while (step + 1 < RAIN_STEPS_MM.length && mm >= RAIN_STEPS_MM[step + 1]) step++;
  const fade = Math.min(
    1,
    (mm - RAIN_FADE_FROM_MM) / (RAIN_FADE_TO_MM - RAIN_FADE_FROM_MM),
  );
  const [r, g, b] = RAIN_RGB[step];
  return [r, g, b, fade * RAIN_OPACITY];
};

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

// Подъём от 0 у края сетки до 1 у края ядра по одной стороне.
function ramp(distance: number, width: number): number {
  if (width <= 0) return 1;
  const x = Math.max(0, Math.min(1, distance / width));
  return x * x * (3 - 2 * x); // сглаженная ступенька — без излома на краю ядра
}

// 0 за пределами сетки, 1 в глубине, между ними — плавный подъём.
function insetWeight(grid: CloudGrid, lat: number, lon: number): number {
  const inset = Math.min(
    lat - grid.south,
    grid.north - lat,
    lon - grid.west,
    grid.east - lon,
  );
  if (inset <= 0) return 0;

  // С ядром гаснем через весь запас: облако, которое мелкая сетка видит у
  // своего края, а грубая — нет, растворяется, а не обрывается прямой линией.
  // Стороны перемножаются, а не берутся по минимуму — углы выходят круглыми,
  // и прямоугольник сетки не читается.
  const core = grid.core;
  if (core) {
    return (
      ramp(lat - grid.south, core.south - grid.south) *
      ramp(grid.north - lat, grid.north - core.north) *
      ramp(lon - grid.west, core.west - grid.west) *
      ramp(grid.east - lon, grid.east - core.east)
    );
  }

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
  shade: Shade,
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

      const color = shade(sample(slice, cols, rows, u, v));
      if (!color) continue;
      const alpha = color[3];

      // Под мелкой сеткой гаснем не линейно, а с поправкой на то, что мелкая
      // ложится сверху: при её плотности t·A и нашей A·(1−t)/(1−t·A) сумма
      // остаётся ровно A, и вдоль стыка не проступает светлая рамка.
      let weight = own;
      for (const g of finer) {
        const t = insetWeight(g, lat, lon);
        const rest = 1 - t * alpha;
        weight *= rest > 1e-6 ? (1 - t) / rest : 0;
      }
      if (weight <= 0) continue;

      rgba[i] = color[0];
      rgba[i + 1] = color[1];
      rgba[i + 2] = color[2];
      rgba[i + 3] = Math.round(alpha * weight * 255);
    }
  }

  return encodeRgbaPng(IMAGE_PX, IMAGE_PX, rgba);
}

// Сколько последних картинок держим на диске. Удалять предыдущую сразу нельзя:
// при перемотке времени слой ещё несколько сотен миллисекунд показывает старый
// кадр, пока проявляется новый, — и файл под ним исчезал бы прямо во время
// проявления. Кадр — это по картинке на сетку, обычно две, и на облака и на
// дождь отдельно; четырёх кадров хватает на кроссфейд и быструю перемотку
// туда-обратно.
const KEEP_FILES = 16;

const written: string[] = [];
let cleanedStale = false;

function writeImage(
  root: Directory,
  kind: string,
  grid: CloudGrid,
  slice: number[],
  finer: CloudGrid[],
  softEdge: boolean,
  targetMs: number,
  shade: Shade,
): CloudImage {
  // Срез почасовой, поэтому час вместе с границами однозначно задаёт картинку.
  // Дыра под мелкими сетками входит в имя через их границы — иначе картинка
  // без дыры от старого набора сеток подошла бы по имени к новому.
  const hole = finer.map((g) => `${g.south.toFixed(2)}-${g.west.toFixed(2)}`).join("_");
  const name = `${kind}-${Math.round(targetMs / 3600_000)}-${grid.south.toFixed(2)}-${grid.west.toFixed(2)}-${grid.north.toFixed(2)}-${grid.east.toFixed(2)}${hole ? `-h${hole}` : ""}.png`;
  const file = new File(root, name);
  if (!file.exists) {
    file.create({ overwrite: true });
    file.write(render(grid, slice, finer, softEdge, shade));
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
  return writeField("cloud", grids, targetMs, cloudSliceAt, cloudShade);
}

// Прогноз дождя — на моменты, куда не достаёт радар.
export function writeRainField(
  grids: CloudGrid[],
  targetMs: number,
): CloudField | null {
  return writeField("rain", grids, targetMs, precipSliceAt, rainShade);
}

function writeField(
  kind: string,
  grids: CloudGrid[],
  targetMs: number,
  sliceAt: (grid: CloudGrid, targetMs: number) => number[],
  shade: Shade,
): CloudField | null {
  const slices = grids.map((g) => sliceAt(g, targetMs));
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
    writeImage(
      root,
      kind,
      grid,
      slices[i],
      grids.slice(i + 1),
      i > 0,
      targetMs,
      shade,
    ),
  );
  return { key: images.map((img) => img.uri).join("|"), images };
}
