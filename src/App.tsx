import { useMemo, useState } from "react";
import { RouteUploader } from "./components/RouteUploader";
import { MapView } from "./components/MapView";
import { ElevationProfile } from "./components/ElevationProfile";
import { StartTimeRecommendation } from "./components/StartTimeRecommendation";
import { TimeSlider } from "./components/TimeSlider";
import { parseGpx, type ParsedRoute } from "./lib/gpx";
import { fetchRouteWind, type RouteWindPoint } from "./lib/wind";
import {
  scoreRoute,
  findBestStartTime,
  getCandidateStartTimes,
  summarizeWind,
} from "./lib/scoring";
import type { RouteScore } from "./types";
import "./App.css";

type Status = "idle" | "loading" | "error";

function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [route, setRoute] = useState<ParsedRoute | null>(null);
  const [windPoints, setWindPoints] = useState<RouteWindPoint[] | null>(null);
  const [candidateTimes, setCandidateTimes] = useState<Date[]>([]);
  const [nowScore, setNowScore] = useState<RouteScore | null>(null);
  const [bestScore, setBestScore] = useState<RouteScore | null>(null);
  const [bestIndex, setBestIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const handleFileLoaded = async (xmlText: string, fileName: string) => {
    setStatus("loading");
    setError(null);
    setRoute(null);
    setWindPoints(null);
    setCandidateTimes([]);
    setNowScore(null);
    setBestScore(null);

    try {
      const parsed = parseGpx(xmlText);
      const wp = await fetchRouteWind(parsed.routePoints);
      const times = getCandidateStartTimes(wp);
      const now = scoreRoute(parsed.routePoints, wp, new Date());
      const best = findBestStartTime(parsed.routePoints, wp);
      const bestIdx = Math.max(
        0,
        times.findIndex((t) => t.toISOString() === best.startTime),
      );

      setRoute(parsed);
      setWindPoints(wp);
      setCandidateTimes(times);
      setNowScore(now);
      setBestScore(best);
      setBestIndex(bestIdx);
      setSelectedIndex(bestIdx);
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

  const selectedScore = useMemo(() => {
    if (!route || !windPoints || candidateTimes.length === 0) return null;
    return scoreRoute(
      route.routePoints,
      windPoints,
      candidateTimes[selectedIndex],
    );
  }, [route, windPoints, candidateTimes, selectedIndex]);

  const windSummary = useMemo(
    () => (selectedScore ? summarizeWind(selectedScore.segments) : null),
    [selectedScore],
  );

  return (
    <div className="app">
      <h1>Wind &amp; Elevation Route Overlay</h1>

      <RouteUploader
        onFileLoaded={handleFileLoaded}
        disabled={status === "loading"}
      />

      {status === "loading" && <p>Загружаю трек и прогноз ветра…</p>}
      {status === "error" && error && <p className="error">{error}</p>}

      {route && nowScore && bestScore && selectedScore && windSummary && (
        <>
          <StartTimeRecommendation nowScore={nowScore} bestScore={bestScore} />

          <TimeSlider
            candidateTimes={candidateTimes}
            selectedIndex={selectedIndex}
            bestIndex={bestIndex}
            onChange={setSelectedIndex}
            score={selectedScore}
            avgWindSpeed={windSummary.avgSpeed}
            avgWindDirection={windSummary.avgDirection}
            maxPrecipitation={windSummary.maxPrecipitation}
          />

          <MapView segments={selectedScore.segments} />

          <h3>Профиль высоты</h3>
          <ElevationProfile points={route.rawPoints} />
        </>
      )}
    </div>
  );
}

export default App;
