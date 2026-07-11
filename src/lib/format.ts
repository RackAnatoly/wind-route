// Форматирует headwind-экспозицию (км/ч, положительное = встречный) в читаемый текст.
export function formatExposure(exposure: number): string {
  const abs = Math.abs(exposure).toFixed(1);
  return exposure >= 0 ? `встречный ${abs} км/ч` : `попутный ${abs} км/ч`;
}
