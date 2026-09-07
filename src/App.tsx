import { useEffect, useMemo, useState } from "react";
import { RouteUploader } from "./components/RouteUploader";
import { MapView } from "./components/MapView";
import { ElevationProfile } from "./components/ElevationProfile";
import { StartTimeRecommendation } from "./components/StartTimeRecommendation";
import { TimeSlider } from "./components/TimeSlider";
import { RidePlayback } from "./components/RidePlayback";
import { RainWindows } from "./components/RainWindows";
import { parseGpx, type ParsedRoute } from "@shared/gpx";
import { fetchRouteWind, type RouteWindPoint } from "@shared/wind";
import {
  fetchRadarIndex,
  frameAt,
  radarCoverage,
  type RadarIndex,
} from "@shared/radar";
import {
  scoreRoute,
  findBestStartTime,
  getCandidateStartTimes,
  summarizeWind,
  positionAtTime,
} from "@shared/scoring";
import type { RouteScore } from "@shared/types";
import "./App.css";

type Status = "idle" | "loading" | "error";

// Индекс кадров радара обновляется каждые 10 минут — перечитываем чуть чаще.
const RADAR_REFRESH_MS = 5 * 60 * 1000;

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
  const [radarIndex, setRadarIndex] = useState<RadarIndex | null>(null);
  const [mapTime, setMapTime] = useState<Date | null>(null);

  // Радар — отдельный необязательный слой: если RainViewer недоступен,
  // приложение продолжает работать на модельном прогнозе.
  useEffect(() => {
    let cancelled = false;

    const load = () => {
      fetchRadarIndex()
        .then((index) => {
          if (!cancelled) setRadarIndex(index);
        })
        .catch((e) => console.warn("Радар недоступен:", e));
    };

    load();
    const id = setInterval(load, RADAR_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const handleFileLoaded = async (xmlText: string, fileName: string) => {
    setStatus("loading");
    setError(null);
    setRoute(null);
    setWindPoints(null);
    setCandidateTimes([]);
    setNowScore(null);
    setBestScore(null);
    setMapTime(null);

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

  // Смена времени старта возвращает проигрывание к началу поездки.
  const selectedStartIso = selectedScore?.startTime ?? null;
  useEffect(() => {
    if (selectedStartIso) setMapTime(new Date(selectedStartIso));
  }, [selectedStartIso]);

  const windSummary = useMemo(
    () => (selectedScore ? summarizeWind(selectedScore.segments) : null),
    [selectedScore],
  );

  const coverage = radarIndex ? radarCoverage(radarIndex) : null;
  const radarFrame =
    radarIndex && mapTime ? frameAt(radarIndex, mapTime) : null;
  const rider =
    selectedScore && mapTime ? positionAtTime(selectedScore, mapTime) : null;

  // Шкала проигрывания начинается с более раннего из двух: начала поездки и начала
  // радарной истории — чтобы можно было отмотать назад и увидеть, куда идёт дождь.
  const rideStart = selectedScore ? new Date(selectedScore.startTime) : null;
  const timelineStart =
    rideStart && coverage && coverage.from < rideStart ? coverage.from : rideStart;

  return (
    <div className="app">
      <h1>Wind &amp; Rain Route Overlay</h1>

      <RouteUploader
        onFileLoaded={handleFileLoaded}
        disabled={status === "loading"}
      />

      {status === "loading" && <p>Загружаю трек и прогноз погоды…</p>}
      {status === "error" && error && <p className="error">{error}</p>}

      {route &&
        nowScore &&
        bestScore &&
        selectedScore &&
        windSummary &&
        mapTime && (
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

            <RidePlayback
              timelineStart={timelineStart ?? new Date(selectedScore.startTime)}
              rideStart={new Date(selectedScore.startTime)}
              endTime={new Date(selectedScore.endTime)}
              value={mapTime}
              onChange={setMapTime}
              source={radarFrame ? "radar" : "forecast"}
              radarCoverage={coverage}
            />

            <MapView
              segments={selectedScore.segments}
              radarIndex={radarIndex}
              radarFrame={radarFrame}
              rider={rider}
            />

            <RainWindows score={selectedScore} onSeek={setMapTime} />

            <h3>Профиль высоты</h3>
            <ElevationProfile points={route.rawPoints} />
          </>
        )}
    </div>
  );
}

export default App;
