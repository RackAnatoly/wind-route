// Единая точка обращения к Open-Meteo: адрес, сборка запроса и разбор ошибок.
// Адрес — одна константа на оба модуля (ветер и облачность), чтобы прокси
// или свой инстанс подключались в одном месте.
export const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

// Строку запроса собираем вручную: реализация URL/URLSearchParams в React Native
// неполная, а этот модуль общий для веба и мобильного приложения.
export function buildQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

export class OpenMeteoError extends Error {
  readonly status: number;
  readonly reason: string | null;

  constructor(message: string, status: number, reason: string | null) {
    super(message);
    this.name = "OpenMeteoError";
    this.status = status;
    this.reason = reason;
  }
}

// Лимит бесплатного тарифа — единственная ошибка, которую пользователь может
// получить на ровном месте и с которой ничего не сделать, кроме как подождать.
// Open-Meteo пишет в `reason`, какой именно лимит: минутный, часовой или
// дневной, — от этого зависит, сколько ждать.
function limitMessage(reason: string | null): string {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("minute")) return "Лимит запросов к погоде исчерпан — подождите минуту.";
  if (r.includes("hour")) return "Лимит запросов к погоде исчерпан — попробуйте в следующем часу.";
  if (r.includes("daily")) return "Дневной лимит запросов к погоде исчерпан — до завтра.";
  return "Лимит запросов к погоде исчерпан — попробуйте позже.";
}

async function readReason(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { reason?: unknown };
    return typeof body.reason === "string" ? body.reason : null;
  } catch {
    return null;
  }
}

// GET к Open-Meteo с разбором ошибок. Возвращает тело как есть — форму ответа
// каждый модуль описывает сам.
export async function requestOpenMeteo<T>(
  params: Record<string, string>,
): Promise<T> {
  const res = await fetch(`${OPEN_METEO_URL}?${buildQuery(params)}`);
  if (res.ok) return (await res.json()) as T;

  const reason = await readReason(res);
  const message =
    res.status === 429
      ? limitMessage(reason)
      : `Open-Meteo вернул ошибку ${res.status}${reason ? `: ${reason}` : ""}`;
  throw new OpenMeteoError(message, res.status, reason);
}
