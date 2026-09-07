// «Проскочить между дождями»: перебираем задержку старта и темп, для каждой пары
// считаем, сколько километров придётся ехать под дождём. Обычные приложения
// смотрят погоду в точке; здесь важно, что велосипедист движется — сдвиг старта
// на полчаса или чуть более высокий темп меняют, с какой ячейкой он встретится.
import { buildRoutePlan, scoreWithPlan } from "./scoring";
import type { RiderProfile } from "./physics";
import type { RoutePoint } from "./types";
import type { RouteWindPoint } from "./wind";

const DELAY_STEP_MINUTES = 15;
const MAX_DELAY_MINUTES = 120;

// Множители к целевой мощности: ниже — «спокойнее», выше — «поднажать».
const POWER_FACTORS = [0.8, 0.9, 1, 1.12, 1.25] as const;

// Варианты, отличающиеся от самого сухого меньше чем на столько, считаем
// равноценными — и выбираем из них наименее обременительный.
const WET_TOLERANCE_KM = 0.3;

export interface DodgeCell {
  delayMinutes: number;
  powerW: number;
  wetKm: number;
  wetRatio: number;
  durationSeconds: number;
  maxPrecipitation: number;
  startTime: string; // ISO
  endTime: string; // ISO
}

export interface DodgeGrid {
  delays: number[];
  powers: number[];
  cells: DodgeCell[][]; // [индекс задержки][индекс мощности]
  baseline: DodgeCell; // выехать сейчас в своём темпе
  best: DodgeCell; // самый сухой ценой наименьших неудобств
  // Лучший вариант, если ждать долго нельзя. Совпадает с best, когда тот и так
  // укладывается в короткое ожидание.
  soon: DodgeCell;
  maxWetKm: number; // для раскраски тепловой карты
}

// Граница «ждать ещё приемлемо» для компромиссного варианта.
const SOON_HORIZON_MINUTES = 45;

// Насколько вариант неудобен: ждать не хочется, ехать не в своём темпе — тоже.
function inconvenience(cell: DodgeCell, basePowerW: number): number {
  return (
    cell.delayMinutes / 30 +
    (Math.abs(cell.powerW - basePowerW) / basePowerW) * 2
  );
}

export function buildDodgeGrid(
  routePoints: RoutePoint[],
  windPoints: RouteWindPoint[],
  startTime: Date,
  profile: RiderProfile,
): DodgeGrid {
  const delays: number[] = [];
  for (let d = 0; d <= MAX_DELAY_MINUTES; d += DELAY_STEP_MINUTES) delays.push(d);

  const powers = POWER_FACTORS.map((f) => Math.round((profile.targetPowerW * f) / 5) * 5);

  // Геометрия маршрута для всех вариантов одна — считаем её один раз.
  const plan = buildRoutePlan(routePoints, windPoints);

  const cells: DodgeCell[][] = delays.map((delayMinutes) =>
    powers.map((powerW) => {
      const cellStart = new Date(startTime.getTime() + delayMinutes * 60 * 1000);
      const score = scoreWithPlan(plan, windPoints, cellStart, {
        ...profile,
        targetPowerW: powerW,
      });

      return {
        delayMinutes,
        powerW,
        wetKm: (score.wetDistanceRatio * score.totalDistanceM) / 1000,
        wetRatio: score.wetDistanceRatio,
        durationSeconds: score.durationSeconds,
        maxPrecipitation: score.maxPrecipitation,
        startTime: score.startTime,
        endTime: score.endTime,
      };
    }),
  );

  const flat = cells.flat();
  const baseline =
    cells[0][powers.indexOf(Math.round(profile.targetPowerW / 5) * 5)] ??
    cells[0][Math.floor(powers.length / 2)];

  const minWet = Math.min(...flat.map((c) => c.wetKm));
  const candidates = flat.filter((c) => c.wetKm <= minWet + WET_TOLERANCE_KM);

  let best = candidates[0];
  for (const cell of candidates) {
    if (
      inconvenience(cell, profile.targetPowerW) <
      inconvenience(best, profile.targetPowerW)
    ) {
      best = cell;
    }
  }

  const soonCells = flat.filter((c) => c.delayMinutes <= SOON_HORIZON_MINUTES);
  let soon = soonCells[0];
  for (const cell of soonCells) {
    if (
      cell.wetKm < soon.wetKm - 0.1 ||
      (Math.abs(cell.wetKm - soon.wetKm) <= 0.1 &&
        inconvenience(cell, profile.targetPowerW) <
          inconvenience(soon, profile.targetPowerW))
    ) {
      soon = cell;
    }
  }

  return {
    delays,
    powers,
    cells,
    baseline,
    best,
    soon,
    maxWetKm: Math.max(...flat.map((c) => c.wetKm)),
  };
}

// Текстовый совет: что именно поменять, чтобы приехать сухим.
function describePlan(cell: DodgeCell, baseline: DodgeCell): string {
  const parts: string[] = [];
  if (cell.delayMinutes > 0) parts.push(`выехать на ${cell.delayMinutes} мин позже`);
  if (cell.powerW !== baseline.powerW) {
    const faster = cell.powerW > baseline.powerW;
    parts.push(
      `держать ${faster ? "повыше" : "пониже"} темп (${cell.powerW} Вт вместо ${baseline.powerW})`,
    );
  }
  return parts.length > 0 ? parts.join(" и ") : "выехать сейчас";
}

function describeResult(cell: DodgeCell): string {
  return cell.wetKm < 0.5
    ? "проедешь сухим"
    : `под дождём ${cell.wetKm.toFixed(1)} км`;
}

// Текстовый совет: что именно поменять, чтобы приехать сухим.
export function dodgeAdvice(grid: DodgeGrid): string {
  const { best, baseline, soon } = grid;

  if (baseline.wetKm < 0.5) return "Выезжай как есть — дождя на маршруте нет.";

  if (baseline.wetKm - best.wetKm < 0.5) {
    const hours = grid.delays[grid.delays.length - 1] / 60;
    return `Проскочить не выйдет: под дождём ${baseline.wetKm.toFixed(0)} км при любом раскладе в ближайшие ${hours} ч. Бери дождевик.`;
  }

  const head = `${describePlan(best, baseline)} — ${describeResult(best)}`;
  const capitalized = `${head[0].toUpperCase()}${head.slice(1)}`;
  const now = `Сейчас было бы ${baseline.wetKm.toFixed(1)} км.`;

  // Ждать два часа готовы не все — показываем и лучший быстрый вариант.
  const soonIsBetter =
    best.delayMinutes > soon.delayMinutes &&
    baseline.wetKm - soon.wetKm > 0.5 &&
    soon.wetKm - best.wetKm > 0.5;

  if (!soonIsBetter) return `${capitalized}. ${now}`;

  return `${capitalized}. ${now} Если ждать нельзя — ${describePlan(soon, baseline)}: ${describeResult(soon)}.`;
}
