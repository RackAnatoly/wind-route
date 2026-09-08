// Минимальный кодировщик PNG. Нужен, чтобы нарисовать поле облачности:
// react-native-maps умеет накладывать картинку по географическим границам
// (<Overlay image bounds>), а система растянет её со сглаживанием — получается
// плавное поле, которого не добиться сеткой полигонов.
//
// Картинка отдаётся байтами, а не data-URI: <Overlay> принимает только локальные
// ресурсы и сетевые адреса, поэтому PNG пишется во временный файл.
//
// Сжатие не используется: deflate допускает «сохранённые» блоки без сжатия,
// и для картинки 64x64 разница в размере не имеет значения, зато не нужна
// библиотека сжатия.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function chunk(type: string, data: number[]): number[] {
  const typeBytes = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)];
  const body = new Uint8Array([...typeBytes, ...data]);
  return [...u32(data.length), ...typeBytes, ...data, ...u32(crc32(body))];
}

// Поток zlib из несжатых deflate-блоков (BTYPE = 00).
function storedZlib(raw: Uint8Array): number[] {
  const out: number[] = [0x78, 0x01];
  const MAX_BLOCK = 65535;

  for (let offset = 0; offset < raw.length; offset += MAX_BLOCK) {
    const len = Math.min(MAX_BLOCK, raw.length - offset);
    const isLast = offset + len >= raw.length;
    out.push(isLast ? 1 : 0);
    out.push(len & 0xff, (len >> 8) & 0xff);
    out.push(~len & 0xff, (~len >> 8) & 0xff);
    for (let i = 0; i < len; i++) out.push(raw[offset + i]);
  }

  out.push(...u32(adler32(raw)));
  return out;
}

// rgba — width * height * 4 байта. Возвращает готовый PNG.
export function encodeRgbaPng(
  width: number,
  height: number,
  rgba: Uint8Array,
): Uint8Array {
  // Каждая строка PNG начинается с байта фильтра; используем 0 («без фильтра»).
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }

  const bytes = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [...u32(width), ...u32(height), 8, 6, 0, 0, 0]),
    ...chunk("IDAT", storedZlib(raw)),
    ...chunk("IEND", []),
  ];

  return new Uint8Array(bytes);
}
