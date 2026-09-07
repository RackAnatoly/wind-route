// Форматирует headwind-экспозицию (км/ч, положительное = встречный) в читаемый текст.
export function formatExposure(exposure: number): string {
  const abs = Math.abs(exposure).toFixed(1);
  return exposure >= 0 ? `встречный ${abs} км/ч` : `попутный ${abs} км/ч`;
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} ч ${minutes} мин` : `${minutes} мин`;
}

// «Цена ветра»: насколько дольше едешь, чем проехал бы то же самое в безветрие
// при той же мощности. Отрицательное значение — ветер сегодня помогает.
export function formatWindCost(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 1) return "ветер почти не влияет";
  return minutes > 0
    ? `ветер стоит +${formatDuration(Math.abs(seconds))}`
    : `ветер экономит ${formatDuration(Math.abs(seconds))}`;
}
