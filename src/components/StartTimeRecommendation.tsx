import { degToCompass } from "@shared/compass";
import { formatDuration, formatExposure } from "@shared/format";
import type { RouteScore } from "@shared/types";

interface StartTimeRecommendationProps {
  nowScore: RouteScore;
  bestScore: RouteScore;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatWeather(score: RouteScore): string {
  const parts = [
    formatDuration(score.durationSeconds),
    formatExposure(score.totalHeadwindExposure),
    score.wetDistanceRatio > 0
      ? `дождь на ${(score.wetDistanceRatio * 100).toFixed(0)}% маршрута`
      : "сухо",
  ];
  return parts.join(", ");
}

export function StartTimeRecommendation({
  nowScore,
  bestScore,
}: StartTimeRecommendationProps) {
  // Разница во времени в пути — самая понятная выгода от переноса старта.
  const savedSeconds = nowScore.durationSeconds - bestScore.durationSeconds;

  const drierByPct =
    (nowScore.wetDistanceRatio - bestScore.wetDistanceRatio) * 100;

  const worstSegments = [...bestScore.segments]
    .sort((a, b) => b.headwindComponent - a.headwindComponent)
    .slice(0, 3);

  const sameTime =
    new Date(nowScore.startTime).getTime() ===
    new Date(bestScore.startTime).getTime();

  return (
    <div className="start-time-recommendation">
      <h3>Рекомендация</h3>
      {sameTime ? (
        <p>Сейчас — уже лучшее время старта в ближайшие 48 часов.</p>
      ) : (
        <p>
          Лучшее время старта: <strong>{formatTime(bestScore.startTime)}</strong>
          {drierByPct > 5 && (
            <>
              {" "}— сухого маршрута на{" "}
              <strong>{drierByPct.toFixed(0)} п.п.</strong> больше
            </>
          )}
          {drierByPct <= 5 && savedSeconds > 60 && (
            <>
              {" "}— проедешь на <strong>{formatDuration(savedSeconds)}</strong>{" "}
              быстрее, чем при старте сейчас
            </>
          )}
        </p>
      )}
      <p>
        Сейчас: {formatWeather(nowScore)} · при рекомендуемом старте:{" "}
        {formatWeather(bestScore)}
      </p>
      <h4>Худшие участки (при рекомендуемом старте)</h4>
      <ul>
        {worstSegments.map((s, i) => (
          <li key={i}>
            {(s.start.distanceFromStart / 1000).toFixed(1)}–
            {(s.end.distanceFromStart / 1000).toFixed(1)} км:{" "}
            {formatExposure(s.headwindComponent)} (ветер {degToCompass(s.windDirection)}
            , {s.windSpeed.toFixed(0)} км/ч)
          </li>
        ))}
      </ul>
    </div>
  );
}
