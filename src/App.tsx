import { useState } from "react";
import { RouteUploader } from "./components/RouteUploader";
import { MapView } from "./components/MapView";
import { ElevationProfile } from "./components/ElevationProfile";
import { StartTimeRecommendation } from "./components/StartTimeRecommendation";
import { parseGpx, type ParsedRoute } from "./lib/gpx";
import { fetchRouteWind, type RouteWindPoint } from "./lib/wind";
import { scoreRoute, findBestStartTime } from "./lib/scoring";
import type { RouteScore } from "./types";
import "./App.css";

type Status = "idle" | "loading" | "error";

function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<ParsedRoute | null>(null);
  const [nowScore, setNowScore] = useState<RouteScore | null>(null);
  const [bestScore, setBestScore] = useState<RouteScore | null>(null);
  const [displayMode, setDisplayMode] = useState<"now" | "best">("best");

  const handleFileLoaded = async (xmlText: string, fileName: string) => {
    setStatus("loading");
    setError(null);
    setRoute(null);
    setNowScore(null);
    setBestScore(null);

    try {
      const parsed = parseGpx(xmlText);
      setRoute(parsed);

      const windPoints: RouteWindPoint[] = await fetchRouteWind(
        parsed.routePoints,
      );

      const now = scoreRoute(parsed.routePoints, windPoints, new Date());
      const best = findBestStartTime(parsed.routePoints, windPoints);

      setNowScore(now);
      setBestScore(best);
      setStatus("idle");
    } catch (e) {
      console.error(e);
      setError(
        e instanceof Error
          ? `Не удалось обработать "${fileName}": ${e.message}`
          : `Не удалось обработать "${fileName}"`,
      );
      setStatus("error");
    }
  };

  const displayedScore = displayMode === "best" ? bestScore : nowScore;

  return (
    <div className="app">
      <h1>Wind &amp; Elevation Route Overlay</h1>

      <RouteUploader
        onFileLoaded={handleFileLoaded}
        disabled={status === "loading"}
      />

      {status === "loading" && <p>Загружаю трек и прогноз ветра…</p>}
      {status === "error" && error && <p className="error">{error}</p>}

      {route && nowScore && bestScore && (
        <>
          <StartTimeRecommendation nowScore={nowScore} bestScore={bestScore} />

          <div className="display-toggle">
            <label>
              <input
                type="radio"
                checked={displayMode === "best"}
                onChange={() => setDisplayMode("best")}
              />
              Показать: рекомендуемое время старта
            </label>
            <label>
              <input
                type="radio"
                checked={displayMode === "now"}
                onChange={() => setDisplayMode("now")}
              />
              Показать: старт сейчас
            </label>
          </div>

          {displayedScore && <MapView segments={displayedScore.segments} />}

          <h3>Профиль высоты</h3>
          <ElevationProfile points={route.rawPoints} />
        </>
      )}
    </div>
  );
}

export default App;
