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

// Родное разрешение снимка над Европой ~2 км — это примерно z=8. Выше тайлы
// просит уже система, растягивая последний уровень: сервер всё равно выдал бы
// ту же картинку, только запросов было бы вчетверо больше на каждый зум.
export const SAT_MAX_NATIVE_ZOOM = 8;

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

// Шаблон для <WMSTile>: {minX}/{minY}/{maxX}/{maxY}/{width}/{height} подставляет
// нативный слой, границы приходят в метрах Меркатора (EPSG:3857).
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
    "bbox={minX},{minY},{maxX},{maxY}",
    "width={width}",
    "height={height}",
    `time=${frame.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
  ];
  return `${EUMETSAT_WMS}?${params.join("&")}`;
}
