import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { StyleSpecification } from "@maplibre/maplibre-react-native";

// Подложка под погоду — светлая, по мотивам positron: велосипедисту нужны
// дороги, иначе маршрут висит в пустоте. Но дорог не должно быть больше, чем
// нужно для ориентира, иначе под облаками и радаром получается шум: леса,
// застройка и вода приглушены, POI и дома не рисуем.
//
// Главное — порядок слоёв. Подложка лежит под погодой, а дороги и подписи —
// поверх неё: маршрут и города читаются даже под сплошной облачностью.
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
// Облачность едет под якорь радара, радар — под якорь дорог. В итоге стопка:
// подложка → облака → радар → дороги, границы и подписи.
export const CLOUD_ANCHOR_LAYER = "anchor-radar";
export const RADAR_ANCHOR_LAYER = "anchor-overlay";

// Все источники требуют указания при использовании, поэтому строка висит
// в нижней панели, а не прячется за кнопкой «информация».
export const MAP_CREDITS =
  "OpenFreeMap © OpenMapTiles © OpenStreetMap · снимок EUMETSAT · радар RainViewer · прогноз Open-Meteo";

const LAND = "#f2f1ec";
const WOOD = "#dfe7d6";
const PARK = "#e2ead9";
const RESIDENTIAL = "#e9e7e1";
const WATER = "#bcd4e4";
const WATER_LABEL = "#4b6a86";

const ROAD_CASING = "#c9c4ba";
const MOTORWAY = "#f6d38a";
const MOTORWAY_CASING = "#d8a551";
const ROAD = "#ffffff";
const PATH = "#8d929b";
const BOUNDARY = "#9a9a9a";

const LABEL = "#2f3337";
const LABEL_MUTED = "#5f656c";
const LABEL_HALO = "rgba(255, 255, 255, 0.9)";

// Подпись берётся латиницей, если она есть: локальные названия на кириллице
// или греческом требуют своих шрифтов, а мы грузим только Noto Sans Latin.
const NAME_FIELD: ExpressionSpecification = [
  "coalesce",
  ["get", "name:latin"],
  ["get", "name_en"],
  ["get", "name"],
];

// Классы дорог openmaptiles, от крупных к мелким. Тропы и велодорожки рисуются
// отдельно пунктиром. Велодорожки не зелёные: зелёным на карте показан
// попутный ветер на маршруте.
const ROAD_CLASSES = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "service",
];

const ROAD_FILTER: ExpressionSpecification = [
  "all",
  ["match", ["get", "class"], ROAD_CLASSES, true, false],
  ["!=", ["get", "brunnel"], "tunnel"],
];

// Ширина по классу на данном зуме. Мелкие дороги появляются позже крупных:
// на обзорном зуме видна только сеть магистралей, у маршрута — все улицы.
function roadWidth(scale: number): ExpressionSpecification {
  const byClass = (
    motorway: number,
    primary: number,
    secondary: number,
    minor: number,
  ): ExpressionSpecification => [
    "match",
    ["get", "class"],
    ["motorway", "trunk"],
    motorway * scale,
    "primary",
    primary * scale,
    ["secondary", "tertiary"],
    secondary * scale,
    minor * scale,
  ];
  return [
    "interpolate",
    ["exponential", 1.5],
    ["zoom"],
    5,
    byClass(0.6, 0, 0, 0),
    8,
    byClass(1.4, 0.8, 0.4, 0),
    11,
    byClass(3, 2.2, 1.6, 0.8),
    14,
    byClass(7, 5.5, 4.5, 3),
    16,
    byClass(13, 11, 9, 7),
  ];
}

// Мелкие дороги видны только вблизи — прозрачность, а не minzoom слоя, чтобы
// все классы жили в одном слое.
const ROAD_OPACITY: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  7,
  ["match", ["get", "class"], ["motorway", "trunk", "primary"], 1, 0],
  9,
  [
    "match",
    ["get", "class"],
    ["motorway", "trunk", "primary", "secondary", "tertiary"],
    1,
    0,
  ],
  10.5,
  ["match", ["get", "class"], "service", 0, 1],
  12,
  1,
];

// Крупные дороги поверх мелких на перекрёстках.
const ROAD_SORT: ExpressionSpecification = [
  "match",
  ["get", "class"],
  ["motorway", "trunk"],
  5,
  "primary",
  4,
  ["secondary", "tertiary"],
  3,
  "minor",
  2,
  1,
];

export const MAP_STYLE: StyleSpecification = {
  version: 8,
  name: "wind-route",
  glyphs: OPENFREEMAP_GLYPHS,
  sources: {
    openmaptiles: {
      type: "vector",
      url: OPENFREEMAP_TILEJSON,
      attribution: "OpenFreeMap © OpenMapTiles © OpenStreetMap",
    },
  },
  layers: [
    // ── Подложка: под погодой ────────────────────────────────────────────

    // Суша — это фон: рисовать её полигоном не нужно, остальное ляжет сверху.
    { id: "land", type: "background", paint: { "background-color": LAND } },
    {
      id: "landcover-wood",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landcover",
      filter: ["==", ["get", "class"], "wood"],
      paint: { "fill-color": WOOD, "fill-antialias": false },
    },
    {
      id: "park",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "park",
      paint: { "fill-color": PARK, "fill-antialias": false },
    },
    {
      id: "landuse-residential",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "landuse",
      minzoom: 8,
      filter: [
        "match",
        ["get", "class"],
        ["residential", "suburb", "neighbourhood"],
        true,
        false,
      ],
      paint: {
        "fill-color": RESIDENTIAL,
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 10, 1],
      },
    },
    {
      id: "water",
      type: "fill",
      source: "openmaptiles",
      "source-layer": "water",
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "fill-color": WATER, "fill-antialias": true },
    },
    {
      id: "waterway",
      type: "line",
      source: "openmaptiles",
      "source-layer": "waterway",
      minzoom: 8,
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: {
        "line-color": WATER,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 2.5, 16, 5],
      },
    },

    // ↓ Облачность вставляется сюда, перед `anchor-radar`.

    // Пустой слой-разделитель: сам ничего не рисует, но держит место в порядке
    // отрисовки между облачностью и радаром.
    {
      id: CLOUD_ANCHOR_LAYER,
      type: "background",
      paint: { "background-opacity": 0 },
    },

    // ↓ Радар вставляется сюда, перед `anchor-overlay`.

    {
      id: RADAR_ANCHOR_LAYER,
      type: "background",
      paint: { "background-opacity": 0 },
    },

    // ── Поверх погоды: дороги, границы, подписи ─────────────────────────

    {
      id: "road-path",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 11,
      // Велосипедисту нужны велодорожки, тропы и грунтовки. Тротуары и
      // лестницы — пунктирная каша в каждом квартале, их не рисуем.
      filter: [
        "all",
        ["match", ["get", "class"], ["path", "track"], true, false],
        [
          "match",
          ["get", "subclass"],
          ["footway", "steps", "pedestrian", "corridor", "platform"],
          false,
          true,
        ],
        ["!=", ["get", "brunnel"], "tunnel"],
      ],
      paint: {
        "line-color": PATH,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 14, 1.4, 16, 2.4],
        "line-dasharray": [2, 1.5],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0, 12, 0.8],
      },
    },
    {
      id: "road-casing",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 5,
      filter: ROAD_FILTER,
      layout: {
        "line-cap": "round",
        "line-join": "round",
        "line-sort-key": ROAD_SORT,
      },
      paint: {
        "line-color": [
          "match",
          ["get", "class"],
          ["motorway", "trunk"],
          MOTORWAY_CASING,
          ROAD_CASING,
        ],
        "line-width": roadWidth(1.45),
        "line-opacity": ROAD_OPACITY,
      },
    },
    {
      id: "road",
      type: "line",
      source: "openmaptiles",
      "source-layer": "transportation",
      minzoom: 5,
      filter: ROAD_FILTER,
      layout: {
        "line-cap": "round",
        "line-join": "round",
        "line-sort-key": ROAD_SORT,
      },
      paint: {
        "line-color": [
          "match",
          ["get", "class"],
          ["motorway", "trunk"],
          MOTORWAY,
          ROAD,
        ],
        "line-width": roadWidth(1),
        "line-opacity": ROAD_OPACITY,
      },
    },
    {
      id: "boundary-country",
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
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.8, 10, 1.8],
        "line-dasharray": [3, 2],
      },
    },
    {
      id: "label-road",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "transportation_name",
      minzoom: 12,
      filter: [
        "match",
        ["get", "class"],
        ["motorway", "trunk", "primary", "secondary", "tertiary", "minor"],
        true,
        false,
      ],
      layout: {
        "symbol-placement": "line",
        "text-field": NAME_FIELD,
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9, 15, 13],
        "text-max-angle": 30,
      },
      paint: {
        "text-color": LABEL_MUTED,
        "text-halo-color": LABEL_HALO,
        "text-halo-width": 1.2,
      },
    },
    {
      id: "label-water",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "water_name",
      minzoom: 7,
      layout: {
        "text-field": NAME_FIELD,
        "text-font": ["Noto Sans Italic"],
        "text-size": 11,
        "text-max-width": 8,
      },
      paint: {
        "text-color": WATER_LABEL,
        "text-halo-color": LABEL_HALO,
        "text-halo-width": 1,
      },
    },
    {
      id: "label-village",
      type: "symbol",
      source: "openmaptiles",
      "source-layer": "place",
      minzoom: 10,
      filter: [
        "match",
        ["get", "class"],
        ["village", "suburb", "hamlet"],
        true,
        false,
      ],
      layout: {
        "text-field": NAME_FIELD,
        "text-font": ["Noto Sans Regular"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 14, 13],
        "text-max-width": 8,
      },
      paint: {
        "text-color": LABEL_MUTED,
        "text-halo-color": LABEL_HALO,
        "text-halo-width": 1.2,
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
        "text-opacity": 0.7,
      },
    },
  ],
};
