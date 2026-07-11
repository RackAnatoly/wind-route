import type { RouteScore } from "../types";

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

export function StartTimeRecommendation({
  nowScore,
  bestScore,
}: StartTimeRecommendationProps) {
  const nowExposure = nowScore.totalHeadwindExposure;
  const bestExposure = bestScore.totalHeadwindExposure;

  const improvementPct =
    nowExposure !== 0
      ? ((nowExposure - bestExposure) / Math.abs(nowExposure)) * 100
      : 0;

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
          {improvementPct > 0 && (
            <>
              , суммарная headwind-экспозиция на{" "}
              <strong>{improvementPct.toFixed(0)}%</strong> ниже, чем при старте
              сейчас
            </>
          )}
        </p>
      )}
      <p>
        Экспозиция сейчас: {nowExposure.toFixed(1)} км/ч · при рекомендуемом
        старте: {bestExposure.toFixed(1)} км/ч
      </p>
      <h4>Худшие участки (при рекомендуемом старте)</h4>
      <ul>
        {worstSegments.map((s, i) => (
          <li key={i}>
            {(s.start.distanceFromStart / 1000).toFixed(1)}–
            {(s.end.distanceFromStart / 1000).toFixed(1)} км: встречный{" "}
            {s.headwindComponent.toFixed(1)} км/ч
          </li>
        ))}
      </ul>
    </div>
  );
}
