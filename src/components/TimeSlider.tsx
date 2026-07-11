import { degToCompass } from "../lib/compass";
import { formatExposure } from "../lib/format";
import type { RouteScore } from "../types";
import "./TimeSlider.css";

interface TimeSliderProps {
  candidateTimes: Date[];
  selectedIndex: number;
  bestIndex: number;
  onChange: (index: number) => void;
  score: RouteScore;
  avgWindSpeed: number;
  avgWindDirection: number;
  maxPrecipitation: number;
}

function formatTime(d: Date): string {
  return d.toLocaleString("ru-RU", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TimeSlider({
  candidateTimes,
  selectedIndex,
  bestIndex,
  onChange,
  score,
  avgWindSpeed,
  avgWindDirection,
  maxPrecipitation,
}: TimeSliderProps) {
  if (candidateTimes.length === 0) return null;
  const selectedTime = candidateTimes[selectedIndex];

  return (
    <div className="time-slider">
      <div className="time-slider-header">
        <strong>{formatTime(selectedTime)}</strong>
        {selectedIndex === bestIndex && (
          <span className="time-slider-badge">рекомендовано</span>
        )}
        <button
          type="button"
          className="time-slider-jump"
          onClick={() => onChange(bestIndex)}
        >
          К лучшему времени
        </button>
        <button
          type="button"
          className="time-slider-jump"
          onClick={() => onChange(0)}
        >
          Сейчас
        </button>
      </div>

      <input
        type="range"
        min={0}
        max={candidateTimes.length - 1}
        value={selectedIndex}
        onChange={(e) => onChange(Number(e.target.value))}
        className="time-slider-input"
      />

      <div className="time-slider-scale">
        <span>{formatTime(candidateTimes[0])}</span>
        <span>{formatTime(candidateTimes[candidateTimes.length - 1])}</span>
      </div>

      <div className="time-slider-summary">
        <span>
          Ветер: {avgWindSpeed.toFixed(0)} км/ч, {degToCompass(avgWindDirection)}
        </span>
        <span>В среднем по маршруту: {formatExposure(score.totalHeadwindExposure)}</span>
        {maxPrecipitation >= 0.1 && (
          <span>Осадки: до {maxPrecipitation.toFixed(1)} мм/ч</span>
        )}
      </div>
    </div>
  );
}
