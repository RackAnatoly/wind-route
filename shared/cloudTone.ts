// Тон облачности на карте — один на снимок спутника и прогноз модели: на стыке
// «снимок → прогноз» облака не должны менять цвет. Подложка светлая, поэтому
// облако — не белое пятно (его не видно), а сине-серая тень, сквозь которую
// угадываются дороги и леса. Сплошная облачность — самая густая тень, но не
// заливка.
export const CLOUD_SHADOW_THIN: [number, number, number] = [118, 128, 142];
export const CLOUD_SHADOW_DENSE: [number, number, number] = [62, 70, 84];
export const CLOUD_MAX_OPACITY = 150 / 255;

export function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
