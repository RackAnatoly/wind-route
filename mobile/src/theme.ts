// Тёмный «радарный» chrome поверх приглушённой карты — как в приложениях-радарах.
export const theme = {
  panel: "rgba(18, 20, 24, 0.92)",
  panelBorder: "rgba(255, 255, 255, 0.12)",
  text: "#f2f4f7",
  textMuted: "#9aa3ad",
  rider: "#f5a623",
  start: "#2e7d32",
  finish: "#c62828",
  radarBadge: "#1a5fb4",
  forecastBadge: "#5b6068",
  headwind: 0, // hue: красный
  tailwind: 130, // hue: зелёный
} as const;

// Цвета сняты с настоящего тайла RainViewer (color scheme 2): слабые осадки —
// голубой, сильные — синий, ливень — жёлтый/оранжевый/красный.
export const RADAR_SCALE = [
  "#88ddee",
  "#00a3e0",
  "#004768",
  "#ffee00",
  "#ff9500",
  "#cd0d00",
] as const;
