import { useEffect, useMemo, useState } from "react";
import "./RidePlayback.css";

const STEP_MINUTES = 10;
const PLAY_INTERVAL_MS = 650;

export type WeatherSource = "radar" | "forecast";

interface RidePlaybackProps {
  // Начало шкалы: если радар покрывает время до старта, даём отмотать назад —
  // по движению засветки видно, приближается облако к маршруту или уходит.
  timelineStart: Date;
  rideStart: Date;
  endTime: Date;
  value: Date;
  onChange: (time: Date) => void;
  source: WeatherSource;
  radarCoverage: { from: Date; to: Date } | null;
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function buildSteps(startTime: Date, endTime: Date): Date[] {
  const stepMs = STEP_MINUTES * 60 * 1000;
  const count = Math.max(
    1,
    Math.ceil((endTime.getTime() - startTime.getTime()) / stepMs),
  );
  return Array.from(
    { length: count + 1 },
    (_, i) => new Date(startTime.getTime() + i * stepMs),
  );
}

// Проигрывание поездки: карта показывает погоду на выбранный момент,
// маркер — где велосипедист будет в этот момент.
export function RidePlayback({
  timelineStart,
  rideStart,
  endTime,
  value,
  onChange,
  source,
  radarCoverage,
}: RidePlaybackProps) {
  const [playing, setPlaying] = useState(false);
  // Мемоизируем сетку шагов: без этого новый массив на каждый рендер пересоздавал
  // бы интервал проигрывания и сбивал его темп.
  const timelineStartMs = timelineStart.getTime();
  const endTimeMs = endTime.getTime();
  const steps = useMemo(
    () => buildSteps(new Date(timelineStartMs), new Date(endTimeMs)),
    [timelineStartMs, endTimeMs],
  );

  const index = Math.max(
    0,
    Math.min(
      steps.length - 1,
      Math.round(
        (value.getTime() - timelineStartMs) / (STEP_MINUTES * 60 * 1000),
      ),
    ),
  );

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      onChange(steps[(index + 1) % steps.length]);
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing, index, steps, onChange]);

  const elapsedMin = Math.round((value.getTime() - rideStart.getTime()) / 60000);
  const elapsedLabel =
    elapsedMin < 0
      ? `за ${-elapsedMin} мин до старта`
      : elapsedMin >= 60
        ? `${Math.floor(elapsedMin / 60)} ч ${elapsedMin % 60} мин в пути`
        : `${elapsedMin} мин в пути`;

  return (
    <div className="ride-playback">
      <div className="ride-playback-header">
        <button
          type="button"
          className="ride-playback-play"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Пауза" : "Проиграть поездку"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <button
          type="button"
          className="ride-playback-jump"
          onClick={() => onChange(rideStart)}
        >
          К старту
        </button>
        <strong>{formatClock(value)}</strong>
        <span className="ride-playback-elapsed">{elapsedLabel}</span>
        <span
          className={`ride-playback-source ride-playback-source--${source}`}
        >
          {source === "radar" ? "радар · наблюдение" : "модель · прогноз"}
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={steps.length - 1}
        value={index}
        onChange={(e) => onChange(steps[Number(e.target.value)])}
        className="ride-playback-input"
      />

      <div className="ride-playback-scale">
        <span>
          {timelineStart.getTime() < rideStart.getTime()
            ? `радар с ${formatClock(timelineStart)}`
            : `старт ${formatClock(rideStart)}`}
        </span>
        <span>финиш {formatClock(endTime)}</span>
      </div>

      <p className="ride-playback-note">
        {source === "radar"
          ? "Показана радарная мозаика RainViewer — реальные отражения от осадков, шаг 10 минут."
          : radarCoverage
            ? `Радар покрывает только ${formatClock(radarCoverage.from)}–${formatClock(radarCoverage.to)}. Дальше — почасовой прогноз модели Open-Meteo.`
            : "Радарные данные недоступны, показан почасовой прогноз модели Open-Meteo."}
      </p>
    </div>
  );
}
