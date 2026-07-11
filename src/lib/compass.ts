const COMPASS_POINTS = ["С", "СВ", "В", "ЮВ", "Ю", "ЮЗ", "З", "СЗ"];

// Переводит направление в градусах (0=С, 90=В, ...) в 8-румбовое обозначение.
export function degToCompass(deg: number): string {
  const normalized = ((deg % 360) + 360) % 360;
  const index = Math.round(normalized / 45) % 8;
  return COMPASS_POINTS[index];
}
