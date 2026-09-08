import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { StyleSpecification } from "@maplibre/maplibre-react-native";

// Подложка под погоду. Готовые стили (positron и прочие) рисуют дороги, здания
// и POI — под облачностью и радаром это шум, в котором ничего не разобрать.
// Поэтому собираем свою: плоская суша, вода, границы, подписи городов. Ровно
// то, что делают погодные приложения, — у Weather&Radar подложка тоже своя.
//
// Векторные тайлы берём у OpenFreeMap: бесплатно, без ключа и без лимитов,
// схема openmaptiles.
const OPENFREEMAP_TILEJSON = "https://tiles.openfreemap.org/planet";
const OPENFREEMAP_GLYPHS =
  "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

// Погодные растры вставляются «перед» этими слоями-якорями, и только так их
// порядок предсказуем: слои монтируются и пересоздаются в разное время, а
// MapLibre кладёт новый слой прямо под тот, что указан в beforeId.
//
// Облачность едет под якорь радара, радар — под границы. В итоге получается
// стопка: подложка → облака → радар → границы и подписи. Подписи городов
// поверх погоды — как в Weather&Radar: они читаются даже под сплошной облачностью.
export const CLOUD_ANCHOR_LAYER = "anchor-radar";
export const RADAR_ANCHOR_LAYER = "boundary-country";

// Все три источника требуют указания при использовании, поэтому строка висит
// в нижней панели, а не прячется за кнопкой «информация».
export const MAP_CREDITS =
  "© OpenStreetMap · снимок EUMETSAT · радар RainViewer · прогноз Open-Meteo";

const LAND = "#78976a";
const WATER = "#2b4257";
const BOUNDARY = "rgba(255, 255, 255, 0.45)";
const LABEL = "#f4f7fa";
const LABEL_HALO = "rgba(8, 14, 20, 0.85)";

// Подпись берётся латиницей, если она есть: локальные названия на кириллице
// или греческом требуют своих шрифтов, а мы грузим только Noto Sans Latin.
const NAME_FIELD: ExpressionSpecification = [
  "coalesce",
  ["get", "name:latin"],
  ["get", "name_en"],
  ["get", "name"],
];

export const MAP_STYLE: StyleSpecification = {
  version: 8,
  name: "wind-route",
  glyphs: OPENFREEMAP_GLYPHS,
  sources: {
    openmaptiles: {
      type: "vector",
      url: OPENFREEMAP_TILEJSON,
      attribution: "© OpenStreetMap",
    },
  },
  layers: [
    // Суша — это фон: рисовать её полигоном не нужно, вода ляжет сверху.
    { id: "land", type: "background", paint: { "background-color": LAND } },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "fill-color": WATER, "fill-antialias": true },
    },

    // ↓ Облачность вставляется сюда, перед `anchor-radar`.

    // Пустой слой-разделитель: сам ничего не рисует, но держит место в порядке
    // отрисовки между облачностью и радаром.
    {
      id: CLOUD_ANCHOR_LAYER,
      type: "background",
      paint: { "background-opacity": 0 },
    },

    // ↓ Радар вставляется сюда, перед `boundary-country`.

    {
      id: RADAR_ANCHOR_LAYER,
      type: "line",
      source: "openmaptiles",
      "source-layer": "boundary",
      filter: [
        "all",
        ["==", ["get", "admin_level"], 2],
        ["!=", ["get", "maritime"], 1],
        ["!=", ["get", "disputed"], 1],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": BOUNDARY,
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 10, 2.4],
      },
    },
    {
      id: "label-city",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 3,
      filter: ["match", ["get", "class"], ["city", "town"], true, false],
      layout: {
        "text-field": NAME_FIELD,
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 4, 11, 10, 15],
        "text-max-width": 8,
      },
      paint: {
        "text-color": LABEL,
        "text-halo-color": LABEL_HALO,
        "text-halo-width": 1.4,
      },
    },
    {
      id: "label-country",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      maxzoom: 7,
      filter: ["==", ["get", "class"], "country"],
      layout: {
        "text-field": NAME_FIELD,
        "text-font": ["Noto Sans Bold"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 2, 10, 6, 14],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.12,
      },
      paint: {
        "text-color": LABEL,
        "text-halo-color": LABEL_HALO,
        "text-halo-width": 1.4,
        "text-opacity": 0.75,
      },
    },
  ],
};
