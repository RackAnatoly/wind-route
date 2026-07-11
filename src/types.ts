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
  time: string; // ISO hour
  speed: number; // км/ч
  direction: number; // градусы, откуда дует
}

export interface ScoredSegment extends Segment {
  windSpeed: number; // км/ч, на момент прохождения сегмента
  windDirection: number; // градусы, откуда дует
  headwindComponent: number; // положительное = headwind, отрицательное = tailwind, км/ч
}

export interface RouteScore {
  startTime: string; // ISO hour
  totalHeadwindExposure: number; // взвешено по дистанции сегмента, км/ч
  segments: ScoredSegment[];
}
