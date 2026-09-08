import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import { MAP_CREDITS } from "../lib/mapStyle";
import { CLOUD_SETTLE_MS } from "../lib/timing";
import { RADAR_SCALE, theme } from "../theme";

const STEP_MINUTES = 10;
const STEP_MS = STEP_MINUTES * 60 * 1000;
// Шаг проигрывания чуть длиннее полной смены кадра облачности: иначе следующий
// кроссфейд начинается поверх незакончившегося и картинка дёргается.
const PLAY_INTERVAL_MS = CLOUD_SETTLE_MS + 150;

export type WeatherSource = "radar" | "forecast";

interface TimelineBarProps {
  // Начало шкалы: если радар покрывает время до старта, даём отмотать назад —
  // по движению засветки видно, приближается облако к маршруту или уходит.
  timelineStart: Date;
  rideStart: Date;
  endTime: Date;
  value: Date;
  onChange: (time: Date) => void;
  source: WeatherSource;
  radarCoverage: { from: Date; to: Date } | null;
  radarOpacity: number;
  bottomInset: number;
  onCycleOpacity: () => void;
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

// Ползунок оперирует абсолютным временем в минутах эпохи, а не индексом в массиве
// шагов: начало шкалы сдвигается, когда подгружается радарная история, и индекс
// от старой сетки означал бы уже другой момент.
function toStepMinutes(ms: number): number {
  return Math.round(ms / STEP_MS) * STEP_MINUTES;
}

export function TimelineBar({
  timelineStart,
  rideStart,
  endTime,
  value,
  onChange,
  source,
  radarCoverage,
  radarOpacity,
  bottomInset,
  onCycleOpacity,
}: TimelineBarProps) {
  const [playing, setPlaying] = useState(false);

  const minMinutes = toStepMinutes(timelineStart.getTime());
  const maxMinutes = Math.max(minMinutes + STEP_MINUTES, toStepMinutes(endTime.getTime()));
  const valueMinutes = Math.max(
    minMinutes,
    Math.min(maxMinutes, toStepMinutes(value.getTime())),
  );

  const handleSlide = useCallback(
    (minutes: number) => onChange(new Date(Math.round(minutes) * 60 * 1000)),
    [onChange],
  );

  // Шаг читается из ref, а не из замыкания: иначе каждая смена времени
  // пересоздавала бы интервал и отсчёт начинался бы заново — кадры шли бы
  // рвано, с разной паузой.
  const playState = useRef({ valueMinutes, minMinutes, maxMinutes, onChange });
  playState.current = { valueMinutes, minMinutes, maxMinutes, onChange };

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const state = playState.current;
      const next =
        state.valueMinutes + STEP_MINUTES > state.maxMinutes
          ? state.minMinutes
          : state.valueMinutes + STEP_MINUTES;
      state.onChange(new Date(next * 60 * 1000));
    }, PLAY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [playing]);

  const elapsedMin = Math.round((value.getTime() - rideStart.getTime()) / 60000);
  const elapsedLabel =
    elapsedMin < 0
      ? `за ${-elapsedMin} мин до старта`
      : elapsedMin >= 60
        ? `${Math.floor(elapsedMin / 60)} ч ${elapsedMin % 60} мин в пути`
        : `${elapsedMin} мин в пути`;

  const note =
    source === "radar"
      ? "Радарная мозаика RainViewer — реальные отражения от осадков, шаг 10 минут."
      : radarCoverage
        ? `Радар покрывает ${formatClock(radarCoverage.from)}–${formatClock(radarCoverage.to)}. Дальше — прогноз модели Open-Meteo.`
        : "Радар недоступен, показан прогноз модели Open-Meteo.";

  return (
    <View style={[styles.container, { paddingBottom: bottomInset + 10 }]}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => setPlaying((p) => !p)}
          style={styles.playButton}
          accessibilityLabel={playing ? "Пауза" : "Проиграть поездку"}
          accessibilityRole="button"
        >
          <Text style={styles.playIcon}>{playing ? "❚❚" : "▶"}</Text>
        </Pressable>

        <View style={styles.clockBlock}>
          <Text style={styles.clock}>{formatClock(value)}</Text>
          <Text style={styles.elapsed}>{elapsedLabel}</Text>
        </View>

        <View
          style={[
            styles.badge,
            {
              backgroundColor:
                source === "radar" ? theme.radarBadge : theme.forecastBadge,
            },
          ]}
        >
          <Text style={styles.badgeText}>
            {source === "radar" ? "радар" : "модель"}
          </Text>
        </View>
      </View>

      <Slider
        style={styles.slider}
        minimumValue={minMinutes}
        maximumValue={maxMinutes}
        step={STEP_MINUTES}
        value={valueMinutes}
        onValueChange={handleSlide}
        minimumTrackTintColor={theme.radarBadge}
        maximumTrackTintColor="rgba(255,255,255,0.25)"
        thumbTintColor={theme.text}
      />

      <View style={styles.scaleRow}>
        <Text style={styles.scaleLabel}>
          {timelineStart.getTime() < rideStart.getTime()
            ? `радар с ${formatClock(timelineStart)}`
            : `старт ${formatClock(rideStart)}`}
        </Text>
        <Text style={styles.scaleLabel}>финиш {formatClock(endTime)}</Text>
      </View>

      <Pressable
        onPress={onCycleOpacity}
        style={styles.legendRow}
        accessibilityRole="button"
        accessibilityLabel="Прозрачность радара"
      >
        <View style={styles.legendScale}>
          {RADAR_SCALE.map((color) => (
            <View key={color} style={[styles.legendCell, { backgroundColor: color }]} />
          ))}
        </View>
        <Text style={styles.legendText}>
          морось → ливень · {Math.round(radarOpacity * 100)}%
        </Text>
      </Pressable>

      <Text style={styles.note}>{note}</Text>
      <Text style={styles.credits}>{MAP_CREDITS}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.panel,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: theme.panelBorder,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 6,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  playIcon: {
    color: theme.text,
    fontSize: 15,
  },
  clockBlock: {
    flex: 1,
  },
  clock: {
    color: theme.text,
    fontSize: 26,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  elapsed: {
    color: theme.textMuted,
    fontSize: 12,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 11,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
  },
  slider: {
    width: "100%",
    height: 34,
  },
  scaleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  scaleLabel: {
    color: theme.textMuted,
    fontSize: 11,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 2,
  },
  legendScale: {
    flexDirection: "row",
    width: 96,
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  legendCell: {
    flex: 1,
  },
  legendText: {
    color: theme.textMuted,
    fontSize: 11,
  },
  note: {
    color: theme.textMuted,
    fontSize: 11,
    lineHeight: 15,
  },
  credits: {
    color: theme.textMuted,
    fontSize: 9,
    opacity: 0.7,
  },
});
