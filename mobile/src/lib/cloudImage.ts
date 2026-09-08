import { Directory, File, Paths } from "expo-file-system";
import { cloudSliceAt, type CloudGrid } from "@shared/clouds";
import { encodeRgbaPng } from "./png";

// Модельное поле облачности — на будущее, куда не достаёт снимок спутника.
// Кладётся на карту одной картинкой через <ImageSource>: MapLibre растянет её
// между четырьмя углами и сгладит сам. Резать поле на тайлы незачем — оно
// всё равно интерполируется из сетки в пару сотен точек.
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

export interface CloudField {
  uri: string;
  // Углы для <ImageSource>: левый верхний, правый верхний, правый нижний, левый нижний.
  coordinates: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
}

function mercatorY(lat: number): number {
  return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
}

function mercatorLat(y: number): number {
  return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
}

// Билинейная выборка из сетки size x size по долям (0..1).
function sample(values: number[], size: number, u: number, v: number): number {
  const x = Math.max(0, Math.min(size - 1, u * (size - 1)));
  const y = Math.max(0, Math.min(size - 1, v * (size - 1)));

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;

  return (
    values[y0 * size + x0] * (1 - fx) * (1 - fy) +
    values[y0 * size + x1] * fx * (1 - fy) +
    values[y1 * size + x0] * (1 - fx) * fy +
    values[y1 * size + x1] * fx * fy
  );
}

function render(grid: CloudGrid, slice: number[]): Uint8Array {
  const gridSize = grid.latitudes.length;
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

      const cover = sample(slice, gridSize, u, v);
      const linear = Math.max(
        0,
        Math.min(
          1,
          (cover - CLEAR_THRESHOLD) / (OVERCAST_LEVEL - CLEAR_THRESHOLD),
        ),
      );
      const density = Math.pow(linear, CONTRAST_GAMMA);

      // Тон подогнан под снимок: плотная облачность почти белая, тонкая —
      // сероватая. Иначе на стыке «снимок → прогноз» цвет заметно прыгает.
      const tone = 250 - Math.round(density * 34);
      rgba[i] = tone;
      rgba[i + 1] = tone;
      rgba[i + 2] = Math.min(255, tone + 4); // чуть холоднее серого
      rgba[i + 3] = Math.round(density * MAX_ALPHA);
    }
  }

  return encodeRgbaPng(IMAGE_PX, IMAGE_PX, rgba);
}

// Сколько последних картинок держим на диске. Удалять предыдущую сразу нельзя:
// при перемотке времени слой ещё несколько сотен миллисекунд показывает старый
// кадр, пока проявляется новый, — и файл под ним исчезал бы прямо во время
// проявления. Двух хватило бы для кроссфейда, четыре оставляют запас на
// быструю перемотку туда-обратно.
const KEEP_FILES = 4;

const written: string[] = [];
let cleanedStale = false;

export function writeCloudField(
  grid: CloudGrid,
  targetMs: number,
): CloudField | null {
  const slice = cloudSliceAt(grid, targetMs);
  if (slice.length === 0) return null;

  const root = new Directory(Paths.cache, CACHE_DIR);
  if (!root.exists) root.create({ intermediates: true });

  // Картинки от прошлых запусков показывать уже некому — чистим их разом.
  if (!cleanedStale) {
    cleanedStale = true;
    for (const entry of root.list()) {
      if (entry instanceof File) entry.delete();
    }
  }

  // Срез почасовой, поэтому час вместе с границами однозначно задаёт картинку.
  const name = `${Math.round(targetMs / 3600_000)}-${grid.south.toFixed(2)}-${grid.west.toFixed(2)}.png`;
  const file = new File(root, name);
  if (!file.exists) {
    file.create({ overwrite: true });
    file.write(render(grid, slice));
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
