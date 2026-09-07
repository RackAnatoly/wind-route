export interface RoutePoint {
  lat: number;
  lon: number;
  ele: number;
  distanceFromStart: number; // метры, накопительно
}

export interface Segment {
  start: RoutePoint;
  end: RoutePoint;
  bearing: number; // градусы, 0-360
  distance: number; // метры
}

export interface WindForecast {
  time: string; // ISO hour, UTC
  speed: number; // км/ч
  direction: number; // градусы, откуда дует
  precipitation: number; // мм/ч
  precipitationProbability: number; // %
  temperature: number | null; // °C, для плотности воздуха и экипировки
  pressure: number | null; // гПа на уровне земли, для плотности воздуха
}

export interface ScoredSegment extends Segment {
  windSpeed: number; // км/ч, на момент прохождения сегмента
  windDirection: number; // градусы, откуда дует
  precipitation: number; // мм/ч, на момент прохождения сегмента
  precipitationProbability: number; // %, на момент прохождения сегмента
  temperature: number | null; // °C, на момент прохождения сегмента
  headwindComponent: number; // положительное = headwind, отрицательное = tailwind, км/ч
  gradient: number; // уклон, доля (0.05 = 5%)
  speedKmh: number; // расчётная скорость на сегменте при целевой мощности
  arrivalTime: string; // ISO, когда велосипедист проходит начало сегмента
}

// Осадки приходят с шагом 15 минут — вдвое-вчетверо подробнее почасового ветра.
// Для «проскочить между дождями» это принципиально: при часовом шаге сдвиг старта
// на 15 или 45 минут давал бы один и тот же ответ.
export interface PrecipSample {
  time: string; // ISO, UTC
  precipitation: number; // мм/ч
}

// Непрерывный участок маршрута, который велосипедист проезжает под осадками.
export interface RainWindow {
  startKm: number;
  endKm: number;
  startTime: string; // ISO
  endTime: string; // ISO
  maxIntensity: number; // мм/ч
  maxProbability: number; // %
}

export interface RouteScore {
  startTime: string; // ISO hour
  endTime: string; // ISO, расчётный финиш
  totalDistanceM: number;
  durationSeconds: number; // расчётное время в пути с учётом ветра и рельефа
  windlessDurationSeconds: number; // та же поездка при той же мощности в безветрие
  windTimeCostSeconds: number; // сколько минут стоит сегодняшний ветер
  avgSpeedKmh: number;
  totalHeadwindExposure: number; // взвешено по дистанции сегмента, км/ч
  wetDistanceRatio: number; // доля маршрута под осадками, 0-1
  maxPrecipitation: number; // мм/ч
  weatherCost: number; // сводная «цена» погоды в минутах: ветер + штраф за дождь
  rainWindows: RainWindow[];
  segments: ScoredSegment[];
}
