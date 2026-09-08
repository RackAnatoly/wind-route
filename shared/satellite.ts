// Спутниковая облачность: то, что в погодных приложениях выглядит настоящими
// тучами с рваными краями, а не размытым пятном, — это снимок геостационарного
// спутника, а не модельная сетка.
//
// Над Европой такой снимок даёт Meteosat: EUMETSAT публикует его открытым
// WMS-сервисом view.eumetsat.int без ключа. Композит GeoColour — дневной
// натуральный цвет и ночная ИК-подсветка облаков в одном слое, шаг 10 минут,
// разрешение MTG над Европой ~2 км. Это ровно то, что показывают Weather&Radar
// и подобные приложения на слое «облачность».
//
// Ограничение снимка — он знает только прошлое. Будущее по-прежнему рисуется
// из модельной сетки (см. shared/clouds.ts), поэтому слой гибридный.
const EUMETSAT_WMS = "https://view.eumetsat.int/geoserver/wms";

// MTG Full Disc, композит GeoColour. Альтернативы того же сервиса:
// msg_fes:rgb_natural (старый MSG, 3 км) и msg_rss:rgb_natural_nrt (5 минут,
// только Европа) — годятся как запасные, если MTG однажды пропадёт.
const LAYER = "mtg_fd:rgb_geocolour";

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
