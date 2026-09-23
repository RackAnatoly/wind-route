import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { degToCompass } from "@shared/compass";
import { formatDuration, formatWindCost } from "@shared/format";
import type { RouteScore } from "@shared/types";
import { theme } from "../theme";

interface RouteHeaderProps {
  routeName: string | null;
  // Длина трека из GPX — известна и без прогноза.
  distanceKm: number | null;
  score: RouteScore | null;
  // Почему нет прогноза по маршруту; null — прогноз есть или ещё грузится.
  forecastError: string | null;
  avgWindSpeed: number;
  avgWindDirection: number;
  loading: boolean;
  topInset: number;
  riderLabel: string;
  dodgeHint: string | null;
  onPickRoute: () => void;
  onLoadDemo: () => void;
  onOpenRider: () => void;
  onOpenDodge: () => void;
  onRetryForecast: () => void;
}

export function RouteHeader({
  routeName,
  distanceKm,
  score,
  forecastError,
  avgWindSpeed,
  avgWindDirection,
  loading,
  topInset,
  riderLabel,
  dodgeHint,
  onPickRoute,
  onLoadDemo,
  onOpenRider,
  onOpenDodge,
  onRetryForecast,
}: RouteHeaderProps) {

  return (
    <View style={[styles.container, { paddingTop: topInset + 6 }]}>
      <View style={styles.row}>
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {routeName ?? "Маршрут не загружен"}
          </Text>
          {score ? (
            <Text style={styles.subtitle}>
              {(distanceKm ?? 0).toFixed(0)} км ·{" "}
              {formatDuration(score.durationSeconds)} ·{" "}
              {score.avgSpeedKmh.toFixed(1)} км/ч
            </Text>
          ) : (
            distanceKm !== null && (
              <Text style={styles.subtitle}>{distanceKm.toFixed(0)} км</Text>
            )
          )}
        </View>

        {loading ? (
          <ActivityIndicator color={theme.text} />
        ) : (
          <Pressable onPress={onPickRoute} style={styles.button} accessibilityRole="button">
            <Text style={styles.buttonText}>GPX</Text>
          </Pressable>
        )}
      </View>

      {score ? (
        <View style={styles.statsRow}>
          <Text style={styles.stat}>
            Ветер {avgWindSpeed.toFixed(0)} км/ч, {degToCompass(avgWindDirection)} ·{" "}
            <Text style={styles.statAccent}>
              {formatWindCost(score.windTimeCostSeconds)}
            </Text>
          </Text>
          <Text style={styles.stat}>
            {score.wetDistanceRatio > 0
              ? `Дождь на ${(score.wetDistanceRatio * 100).toFixed(0)}% · до ${score.maxPrecipitation.toFixed(1)} мм/ч`
              : "Сухо на всём маршруте"}
          </Text>
          {dodgeHint && (
            <Pressable onPress={onOpenDodge} accessibilityRole="button">
              <Text style={styles.dodgeLink}>{dodgeHint}</Text>
            </Pressable>
          )}
          <Pressable onPress={onOpenRider} accessibilityRole="button">
            <Text style={styles.riderLink}>Профиль: {riderLabel} →</Text>
          </Pressable>
        </View>
      ) : forecastError ? (
        // Трек уже на карте, но без прогноза ни времени, ни цены ветра не
        // посчитать — говорим почему и даём повторить, не перезагружая GPX.
        <View style={styles.statsRow}>
          {/* Сетевые ошибки iOS бывают на полэкрана — хватит начала. */}
          <Text style={styles.stat} numberOfLines={2}>
            Прогноз недоступен. {forecastError}
          </Text>
          {!loading && (
            <Pressable onPress={onRetryForecast} accessibilityRole="button">
              <Text style={styles.demoLink}>Повторить →</Text>
            </Pressable>
          )}
        </View>
      ) : (
        !loading &&
        !routeName && (
          <Pressable onPress={onLoadDemo} accessibilityRole="button">
            <Text style={styles.demoLink}>Открыть демо-маршрут →</Text>
          </Pressable>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.panel,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.panelBorder,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  titleBlock: {
    flex: 1,
  },
  title: {
    color: theme.text,
    fontSize: 17,
    fontWeight: "700",
  },
  subtitle: {
    color: theme.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  buttonText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "700",
  },
  statsRow: {
    gap: 2,
  },
  stat: {
    color: theme.textMuted,
    fontSize: 12,
  },
  statAccent: {
    color: theme.text,
    fontWeight: "600",
  },
  dodgeLink: {
    color: "#7fc8ff",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 3,
  },
  riderLink: {
    color: theme.rider,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  demoLink: {
    color: theme.rider,
    fontSize: 13,
    fontWeight: "600",
  },
});
