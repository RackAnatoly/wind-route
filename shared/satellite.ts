import {
  CLOUD_MAX_OPACITY,
  CLOUD_SHADOW_DENSE,
  CLOUD_SHADOW_THIN,
  toHex,
} from "./cloudTone";

// Спутниковая облачность: то, что в погодных приложениях выглядит настоящими
// тучами с рваными краями, а не размытым пятном, — это снимок геостационарного
// спутника, а не модельная сетка.
//
// Над Европой такой снимок даёт Meteosat: EUMETSAT публикует его открытым
// WMS-сервисом view.eumetsat.int без ключа. Цветные композиты (GeoColour и
// прочие) отдают облака вместе с поверхностью и закрывают подложку целиком —
// дорог под ними не видно, а при перемотке в прогноз меняется вся картинка.
// Поэтому берём инфракрасный канал 10,5 мкм и красим его своим стилем прямо в
// запросе: холодное (облака) — тенью, тёплое (земля, море) — прозрачным.
// Канал MTG — 1 км, шаг 10 минут, днём и ночью одинаково.
//
// Ограничение снимка — он знает только прошлое. Будущее по-прежнему рисуется
// из модельной сетки (см. shared/clouds.ts), поэтому слой гибридный; тон
// облаков у них общий (shared/cloudTone.ts), и на стыке картинка не прыгает.
const EUMETSAT_WMS = "https://view.eumetsat.int/geoserver/wms";

// MTG Full Disc, композит GeoColour. Альтернативы того же сервиса:
// msg_fes:rgb_natural (старый MSG, 3 км) и msg_rss:rgb_natural_nrt (5 минут,
// только Европа) — годятся как запасные, если MTG однажды пропадёт.
const LAYER = "mtg_fd:ir105_hrfi";

// Где кончается облако. Канал меряет температуру, поэтому единого порога нет:
// летом ясная земля тёплая и облака начинаются рано, зимой холодная земля
// выглядит как летнее облако. Пороги подобраны по маске облачности EUMETSAT
// на архивных кадрах Европы (по два дня в месяц за два года, день и ночь) —
// [день, ночь] по месяцам, в сырых единицах канала (0–255, чем меньше, тем
// холоднее). Совпадение с маской — около 80–90 %; низкую тёплую облачность и
// туман ИК частично не видит.
//
// Шкала сырых значений не вечна: в конце января 2026 EUMETSAT перевёл дневные
// кадры на ту же шкалу, что и ночные (до этого ясное море днём было на 45–60
// единиц «холоднее», чем ночью). Таблица — по новой шкале: ночь за оба года,
// день — с февраля 2026. Дневных кадров в новой шкале за октябрь–январь в
// архиве ещё не было — там день оценён как ночь + 18 (средняя разница
// день−ночь за февраль–сентябрь); пересчитать, когда кадры появятся.
const THRESHOLDS: [day: number, night: number][] = [
  [175, 157], // январь — день оценён
  [188, 154], // февраль
  [192, 170], // март
  [192, 169], // апрель
  [194, 179], // май
  [204, 193], // июнь
  [209, 198], // июль
  [209, 196], // август
  [206, 190], // сентябрь
  [197, 179], // октябрь — день оценён
  [183, 165], // ноябрь — день оценён
  [186, 168], // декабрь — день оценён
];

// Переход от прозрачного к полной тени — не ступенька: на пороге облако уже
// видно, но вполсилы, а на краях полосы исчезает или густеет полностью.
const RAMP_DENSE = 25; // на столько холоднее порога — полная тень
const RAMP_CLEAR = 10; // на столько теплее порога — прозрачно

function midMonth(year: number, month: number): number {
  return Date.UTC(year, month, 15, 12);
}

// Порог на момент кадра: между серединами месяцев — линейно, чтобы облака не
// менялись скачком 1-го числа; между днём и ночью — плавно по часу UTC (над
// Европой местный полдень близок к 12 UTC).
export function cloudThreshold(frame: Date): number {
  const t = frame.getTime();
  let year = frame.getUTCFullYear();
  let month = frame.getUTCMonth();
  if (t < midMonth(year, month)) {
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  const nextMonth = (month + 1) % 12;
  const nextYear = month === 11 ? year + 1 : year;
  const from = midMonth(year, month);
  const f = (t - from) / (midMonth(nextYear, nextMonth) - from);

  const [dayA, nightA] = THRESHOLDS[month];
  const [dayB, nightB] = THRESHOLDS[nextMonth];
  const day = dayA + (dayB - dayA) * f;
  const night = nightA + (nightB - nightA) * f;

  const hours = frame.getUTCHours() + frame.getUTCMinutes() / 60;
  const dayWeight = 0.5 + 0.5 * Math.cos((2 * Math.PI * (hours - 12)) / 24);
  return Math.round(night + (day - night) * dayWeight);
}

// Стиль прямо в запросе (SLD_BODY): сервер красит канал по нашей шкале и сам
// отдаёт прозрачность. Порог целый — один кадр даёт один и тот же адрес тайлов,
// и кэш карты не промахивается.
function cloudStyle(threshold: number): string {
  const dense = toHex(CLOUD_SHADOW_DENSE);
  const thin = toHex(CLOUD_SHADOW_THIN);
  const full = CLOUD_MAX_OPACITY.toFixed(2);
  const half = (CLOUD_MAX_OPACITY / 2).toFixed(2);
  const denseAt = Math.max(1, threshold - RAMP_DENSE);
  const clearAt = Math.min(254, threshold + RAMP_CLEAR);
  const entry = (color: string, quantity: number, opacity: string) =>
    `<ColorMapEntry color="${color}" quantity="${quantity}" opacity="${opacity}"/>`;
  return (
    '<StyledLayerDescriptor version="1.0.0" xmlns="http://www.opengis.net/sld" xmlns:ogc="http://www.opengis.net/ogc">' +
    `<NamedLayer><Name>${LAYER}</Name><UserStyle><FeatureTypeStyle><Rule><RasterSymbolizer>` +
    '<ColorMap type="ramp">' +
    entry(dense, 0, full) +
    entry(dense, denseAt, full) +
    entry(thin, threshold, half) +
    entry(thin, clearAt, "0") +
    entry(thin, 255, "0") +
    "</ColorMap></RasterSymbolizer></Rule></FeatureTypeStyle></UserStyle></NamedLayer></StyledLayerDescriptor>"
  );
}

// Кадры идут раз в 10 минут, но публикуются с задержкой на приём и обработку.
export const SAT_FRAME_INTERVAL_MS = 10 * 60 * 1000;
const PUBLISH_LAG_MS = 25 * 60 * 1000;

// Архив на сервисе куда глубже, но дальше суток назад листать в приложении
// нечего: маршрут планируется вперёд.
const HISTORY_MS = 24 * 60 * 60 * 1000;

// Предел детализации задаёт сам снимок: замер по автокорреляции показывает у
// GeoColour шаг исходной сетки ~950 м (днём композит подмешивает километровые
// каналы MTG). Резче этого не станет ничем — но можно не добавлять мыла сверху.
//
// Мыло добавляется двумя способами, и оба здесь убраны:
//
// 1. Растягиванием тайла. Выше maxzoom карта не ходит на сервер, а увеличивает
//    последний уровень. На z=8 тайл покрывает под 90 км, и к зуму 11 его тянут
//    восьмикратно. На z=9 растяжение вчетверо меньше, а запросов — вдвое больше
//    на уровень; это компромисс, дальше растёт трафик при проигрывании.
export const SAT_MAX_NATIVE_ZOOM = 9;

// 2. Двойной интерполяцией. Тайл в 512 логических точек на экране с тройной
//    плотностью растягивается видеокартой втрое — поверх того, что сервер уже
//    пересчитал снимок под 512 точек. Просим вдвое больше пикселей, чем занимает
//    тайл: пересчёт остаётся один, серверный, и по исходной сетке.
export const SAT_TILE_SIZE = 512;
const SAT_REQUEST_PX = SAT_TILE_SIZE * 2;

// Из-за задержки публикации самый свежий кадр отстаёт от «сейчас» на полчаса,
// и запрашивать его буквально на текущую минуту нельзя. Но показать «сейчас»
// последним пришедшим снимком — ровно то, что делают радарные приложения,
// поэтому ближайшее будущее подтягивается к последнему кадру, а не проваливается
// в модель. Дальше этого запаса начинается прогноз.
const FORWARD_GRACE_MS = SAT_FRAME_INTERVAL_MS;

function latestFrameMs(now: Date): number {
  return (
    Math.floor((now.getTime() - PUBLISH_LAG_MS) / SAT_FRAME_INTERVAL_MS) *
    SAT_FRAME_INTERVAL_MS
  );
}

// Кадр, действующий на момент `target`: время округляется вниз до сетки кадров.
// Вне покрытия (будущее или старше суток) — null, тогда рисуется модель.
export function satelliteFrameAt(target: Date, now: Date = new Date()): Date | null {
  const latest = latestFrameMs(now);
  const frame =
    Math.floor(target.getTime() / SAT_FRAME_INTERVAL_MS) * SAT_FRAME_INTERVAL_MS;

  if (frame < latest - HISTORY_MS) return null;
  if (frame > latest) {
    return target.getTime() <= now.getTime() + FORWARD_GRACE_MS
      ? new Date(latest)
      : null;
  }
  return new Date(frame);
}

export function satelliteCoverage(now: Date = new Date()): { from: Date; to: Date } {
  return {
    from: new Date(latestFrameMs(now) - HISTORY_MS),
    to: new Date(now.getTime() + FORWARD_GRACE_MS),
  };
}

// Шаблон растрового источника MapLibre. {bbox-epsg-3857} — единственный токен,
// который здесь работает: карта подставляет вместо него границы тайла в метрах
// Меркатора, в порядке запад,юг,восток,север — ровно как ждёт WMS 1.1.1.
//
// Время передаём явно: без параметра time сервис отдаёт «последний доступный»,
// а он у разных запросов разъезжается — на карте это видно как шов между
// дневным и ночным кадром.
export function satelliteTileUrl(frame: Date): string {
  const params = [
    "service=WMS",
    "version=1.1.1",
    "request=GetMap",
    `layers=${encodeURIComponent(LAYER)}`,
    "styles=",
    "format=image/png",
    "transparent=true",
    "srs=EPSG:3857",
    "bbox={bbox-epsg-3857}",
    `width=${SAT_REQUEST_PX}`,
    `height=${SAT_REQUEST_PX}`,
    `time=${frame.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    `SLD_BODY=${encodeURIComponent(cloudStyle(cloudThreshold(frame)))}`,
  ];
  return `${EUMETSAT_WMS}?${params.join("&")}`;
}

// Кадры для проигрывания: последние `count` снимков подряд, самый свежий —
// последним. Список строится заранее, одним куском, чтобы слой мог подгружать
// следующий кадр, пока показывает текущий, — иначе анимация спотыкается на
// каждой смене. Так же устроен и плеер у радарных приложений: они получают
// перечень кадров одним запросом и предзагружают его.
export function satelliteFrames(count: number, now: Date = new Date()): Date[] {
  const latest = latestFrameMs(now);
  const frames: Date[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const ms = latest - i * SAT_FRAME_INTERVAL_MS;
    if (ms >= latest - HISTORY_MS) frames.push(new Date(ms));
  }
  return frames;
}
