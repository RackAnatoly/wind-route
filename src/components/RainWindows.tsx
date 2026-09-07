import type { RouteScore } from "@shared/types";
import "./RainWindows.css";

interface RainWindowsProps {
  score: RouteScore;
  onSeek: (time: Date) => void;
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Словесная градация интенсивности — по метеорологической шкале мм/ч.
function intensityLabel(mmPerHour: number): string {
  if (mmPerHour < 0.5) return "морось";
  if (mmPerHour < 2.5) return "слабый дождь";
  if (mmPerHour < 7.5) return "умеренный дождь";
  return "сильный дождь";
}

export function RainWindows({ score, onSeek }: RainWindowsProps) {
  const totalKm =
    score.segments.length > 0
      ? score.segments[score.segments.length - 1].end.distanceFromStart / 1000
      : 0;

  if (totalKm === 0) return null;

  return (
    <div className="rain-windows">
      <h3>Дождь по маршруту</h3>

      <div className="rain-strip" aria-hidden="true">
        {score.rainWindows.map((w, i) => (
          <div
            key={i}
            className="rain-strip-band"
            style={{
              left: `${(w.startKm / totalKm) * 100}%`,
              width: `${Math.max(((w.endKm - w.startKm) / totalKm) * 100, 0.8)}%`,
              opacity: 0.35 + Math.min(w.maxIntensity / 5, 1) * 0.6,
            }}
          />
        ))}
      </div>
      <div className="rain-strip-scale">
        <span>0 км</span>
        <span>{totalKm.toFixed(0)} км</span>
      </div>

      {score.rainWindows.length === 0 ? (
        <p className="rain-windows-dry">
          Сухо на всём маршруте при старте в {formatClock(score.startTime)}.
        </p>
      ) : (
        <>
          <p>
            Под осадками — {(score.wetDistanceRatio * 100).toFixed(0)}% маршрута
            ({(score.wetDistanceRatio * totalKm).toFixed(0)} км), максимум{" "}
            {score.maxPrecipitation.toFixed(1)} мм/ч.
          </p>
          <ul>
            {score.rainWindows.map((w, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="rain-windows-seek"
                  onClick={() => onSeek(new Date(w.startTime))}
                >
                  {w.startKm.toFixed(1)}–{w.endKm.toFixed(1)} км
                </button>{" "}
                · {formatClock(w.startTime)}–{formatClock(w.endTime)} ·{" "}
                {intensityLabel(w.maxIntensity)} до {w.maxIntensity.toFixed(1)}{" "}
                мм/ч
                {w.maxProbability > 0 && ` (${w.maxProbability.toFixed(0)}%)`}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
