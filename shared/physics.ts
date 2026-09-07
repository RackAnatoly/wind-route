// Модель скорости велосипедиста: по целевой мощности, уклону и встречному ветру
// считаем установившуюся скорость. Нужна, чтобы время прихода в каждую точку
// маршрута было честным — от него зависит, какой прогноз погоды туда подставится.

const G = 9.80665; // м/с²
const DRIVETRAIN_EFFICIENCY = 0.975; // потери в цепи
const R_SPECIFIC_AIR = 287.058; // Дж/(кг·К), удельная газовая постоянная сухого воздуха

export const STANDARD_AIR_DENSITY = 1.225; // кг/м³ при 15 °C и 1013 гПа

// Границы поиска скорости: от «веду велосипед в горку» до предела на спуске.
const MIN_SPEED_MS = 0.8;
const BISECTION_STEPS = 24;

export interface RiderProfile {
  totalMassKg: number; // велосипедист + велосипед + вода и багаж
  cda: number; // м², произведение Cd на лобовую площадь
  crr: number; // коэффициент сопротивления качению
  targetPowerW: number; // мощность, которую велосипедист держит ровно
  maxDescentSpeedKmh: number; // на спуске тормозят, а не разгоняются бесконечно
}

export const DEFAULT_RIDER: RiderProfile = {
  totalMassKg: 82, // ~73 кг велосипедист + 8 кг шоссейник + фляги
  cda: 0.35, // руки на хватах шоссейного руля, обычная посадка любителя
  crr: 0.005, // хорошая шоссейная резина по асфальту
  targetPowerW: 180, // темп «катаю в удовольствие» у любителя
  maxDescentSpeedKmh: 60,
};

// Пресеты, между которыми осмысленно переключаться в интерфейсе.
export const RIDER_PRESETS: { id: string; label: string; profile: RiderProfile }[] = [
  {
    id: "endurance",
    label: "Прогулочный",
    profile: { ...DEFAULT_RIDER, targetPowerW: 140, cda: 0.4 },
  },
  { id: "tempo", label: "Темповый", profile: DEFAULT_RIDER },
  {
    id: "racing",
    label: "Гоночный",
    profile: { ...DEFAULT_RIDER, targetPowerW: 240, cda: 0.3, totalMassKg: 76 },
  },
];

// Плотность воздуха из уравнения состояния. Тёплый воздух заметно реже холодного:
// разница между -5 °C и +30 °C — около 13% сопротивления на той же скорости.
export function airDensity(
  temperatureC: number | null,
  pressureHpa: number | null,
): number {
  if (temperatureC === null || pressureHpa === null) return STANDARD_AIR_DENSITY;
  const kelvin = temperatureC + 273.15;
  if (kelvin <= 0 || pressureHpa <= 0) return STANDARD_AIR_DENSITY;
  return (pressureHpa * 100) / (R_SPECIFIC_AIR * kelvin);
}

// Силы, не зависящие от скорости, — считаются один раз на сегмент.
// Тригонометрия здесь заметна: решатель вызывается десятки тысяч раз на сетке
// вариантов старта, и пересчитывать atan/sin/cos внутри итераций расточительно.
function slopeForces(profile: RiderProfile, gradient: number) {
  const slopeAngle = Math.atan(gradient);
  return (
    profile.crr * profile.totalMassKg * G * Math.cos(slopeAngle) +
    profile.totalMassKg * G * Math.sin(slopeAngle)
  );
}

function powerWith(
  profile: RiderProfile,
  constantForce: number,
  speedMs: number,
  headwindMs: number,
  rho: number,
): number {
  // Сопротивление считается по воздушной скорости, а не по путевой.
  const airSpeed = speedMs + headwindMs;
  const drag = 0.5 * rho * profile.cda * airSpeed * Math.abs(airSpeed);
  return ((constantForce + drag) * speedMs) / DRIVETRAIN_EFFICIENCY;
}

// Мощность, нужная чтобы ехать со скоростью speedMs при данных условиях.
// headwindMs > 0 — встречный, < 0 — попутный.
export function powerAt(
  profile: RiderProfile,
  speedMs: number,
  gradient: number,
  headwindMs: number,
  rho: number,
): number {
  return powerWith(
    profile,
    slopeForces(profile, gradient),
    speedMs,
    headwindMs,
    rho,
  );
}

// Обратная задача: какая скорость получится, если держать targetPowerW.
// Уравнение кубическое по скорости, поэтому решаем численно делением пополам.
export function speedFor(
  profile: RiderProfile,
  gradient: number,
  headwindMs: number,
  rho: number = STANDARD_AIR_DENSITY,
): number {
  const maxSpeedMs = (profile.maxDescentSpeedKmh * 1000) / 3600;
  const constantForce = slopeForces(profile, gradient);

  const power = (v: number) =>
    powerWith(profile, constantForce, v, headwindMs, rho);

  // На крутом спуске даже на предельной скорости педалировать не нужно —
  // велосипедист катится и придерживает тормозом.
  if (power(maxSpeedMs) <= profile.targetPowerW) return maxSpeedMs;
  // В крутую гору целевой мощности не хватает даже на минимальный ход.
  if (power(MIN_SPEED_MS) >= profile.targetPowerW) return MIN_SPEED_MS;

  let low = MIN_SPEED_MS;
  let high = maxSpeedMs;
  for (let i = 0; i < BISECTION_STEPS; i++) {
    const mid = (low + high) / 2;
    if (power(mid) < profile.targetPowerW) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return (low + high) / 2;
}
