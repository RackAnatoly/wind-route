import { Directory, File, Paths } from "expo-file-system";
import { cloudSliceAt, type CloudGrid } from "@shared/clouds";
import { encodeRgbaPng } from "./png";

// Поле облачности кладётся на карту тайлами, а не одной картинкой: <Overlay>
// в react-native-maps работает только с провайдером Google, а на iOS у нас
// Apple Maps. <UrlTile> же поддерживается везде и умеет читать file:///.

const TILE_PX = 256;
const CACHE_DIR = "cloud-tiles";

// Ищем зум, на котором маршрут укладывается в несколько тайлов: больше — дольше
// рисовать, меньше — грубее. Само поле всё равно интерполируется из сетки 7x7.
const MAX_ZOOM = 8;
const MIN_ZOOM = 3;
const MAX_TILES = 6;

// Модельная облачность — среднее по ячейке в десяток километров, поэтому нули
// в ней почти не встречаются: без порога поле выходит сплошным серым киселём.
const CLEAR_THRESHOLD = 28; // %, ниже — рисуем чистое небо
const OVERCAST_LEVEL = 92; // %, выше — сплошная облачность
const CONTRAST_GAMMA = 1.5;
const MAX_ALPHA = 205;

export interface CloudTiles {
  urlTemplate: string;
  maxZoom: number;
}

function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z
  );
}

function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
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

function chooseZoom(grid: CloudGrid): number {
  for (let z = MAX_ZOOM; z > MIN_ZOOM; z--) {
    const x0 = Math.floor(lonToTileX(grid.west, z));
    const x1 = Math.floor(lonToTileX(grid.east, z));
    const y0 = Math.floor(latToTileY(grid.north, z));
    const y1 = Math.floor(latToTileY(grid.south, z));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) <= MAX_TILES) return z;
  }
  return MIN_ZOOM;
}

function renderTile(
  grid: CloudGrid,
  slice: number[],
  tileX: number,
  tileY: number,
  z: number,
): Uint8Array {
  const gridSize = grid.latitudes.length;
  const rgba = new Uint8Array(TILE_PX * TILE_PX * 4);

  for (let py = 0; py < TILE_PX; py++) {
    // Пиксели тайла лежат в проекции Меркатора, а сетка — в градусах,
    // поэтому переводим каждую строку обратно в широту.
    const lat = tileYToLat(tileY + py / TILE_PX, z);
    const v = (lat - grid.south) / (grid.north - grid.south);

    for (let px = 0; px < TILE_PX; px++) {
      const lon = tileXToLon(tileX + px / TILE_PX, z);
      const u = (lon - grid.west) / (grid.east - grid.west);

      const i = (py * TILE_PX + px) * 4;

      // За пределами сетки данных нет — оставляем прозрачным.
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;

      const cover = sample(slice, gridSize, u, v);
      const linear = Math.max(
        0,
        Math.min(
          1,
          (cover - CLEAR_THRESHOLD) / (OVERCAST_LEVEL - CLEAR_THRESHOLD),
        ),
      );
      const density = Math.pow(linear, CONTRAST_GAMMA);

      // Плотная облачность темнее и глуше, тонкая — почти белая.
      const tone = 244 - Math.round(density * 76);
      rgba[i] = tone;
      rgba[i + 1] = tone;
      rgba[i + 2] = Math.min(255, tone + 8); // чуть холоднее серого
      rgba[i + 3] = Math.round(density * MAX_ALPHA);
    }
  }

  return encodeRgbaPng(TILE_PX, TILE_PX, rgba);
}

let previousKey: string | null = null;

export function writeCloudTiles(
  grid: CloudGrid,
  targetMs: number,
): CloudTiles | null {
  const slice = cloudSliceAt(grid, targetMs);
  if (slice.length === 0) return null;

  const z = chooseZoom(grid);
  // Срез почасовой, поэтому час вместе с границами однозначно задаёт картинку.
  const key = `${Math.round(targetMs / 3600_000)}-${grid.south.toFixed(2)}-${grid.west.toFixed(2)}`;

  const root = new Directory(Paths.cache, CACHE_DIR);
  if (!root.exists) root.create({ intermediates: true });

  const keyDir = new Directory(root, key);
  if (!keyDir.exists) {
    keyDir.create({ intermediates: true });

    const x0 = Math.floor(lonToTileX(grid.west, z));
    const x1 = Math.floor(lonToTileX(grid.east, z));
    const y0 = Math.floor(latToTileY(grid.north, z));
    const y1 = Math.floor(latToTileY(grid.south, z));

    for (let x = x0; x <= x1; x++) {
      const zDir = new Directory(keyDir, String(z), String(x));
      zDir.create({ intermediates: true });
      for (let y = y0; y <= y1; y++) {
        const file = new File(zDir, `${y}.png`);
        file.create({ overwrite: true });
        file.write(renderTile(grid, slice, x, y, z));
      }
    }
  }

  // Кадры за другие часы больше не нужны — иначе кэш растёт неограниченно.
  if (previousKey && previousKey !== key) {
    const stale = new Directory(root, previousKey);
    if (stale.exists) stale.delete();
  }
  previousKey = key;

  return {
    urlTemplate: `${keyDir.uri}/{z}/{x}/{y}.png`,
    maxZoom: z,
  };
}
