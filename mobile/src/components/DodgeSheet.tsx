import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { dodgeAdvice, type DodgeCell, type DodgeGrid } from "@shared/dodge";
import { theme } from "../theme";

interface DodgeSheetProps {
  visible: boolean;
  grid: DodgeGrid | null;
  onApply: (cell: DodgeCell) => void;
  onClose: () => void;
  bottomInset: number;
}

const DRY_THRESHOLD_KM = 0.5;

// Зелёный — сухо, дальше синий тем гуще, чем больше километров под дождём.
function cellColor(wetKm: number, maxWetKm: number): string {
  if (wetKm < DRY_THRESHOLD_KM) return "hsl(140, 45%, 32%)";
  const intensity = maxWetKm > 0 ? Math.min(wetKm / maxWetKm, 1) : 0;
  return `hsl(210, 70%, ${52 - intensity * 30}%)`;
}

function formatDelay(minutes: number): string {
  if (minutes === 0) return "сейчас";
  if (minutes % 60 === 0) return `+${minutes / 60} ч`;
  return `+${minutes}м`;
}

export function DodgeSheet({
  visible,
  grid,
  onApply,
  onClose,
  bottomInset,
}: DodgeSheetProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: bottomInset + 16 }]}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Проскочить между дождями</Text>

          {grid === null ? (
            <Text style={styles.hint}>Загрузите маршрут, чтобы посчитать варианты.</Text>
          ) : (
            <>
              <Text style={styles.advice}>{dodgeAdvice(grid)}</Text>

              <Text style={styles.hint}>
                Сколько километров придётся ехать под дождём при разной задержке
                старта и темпе. Нажмите клетку, чтобы посмотреть этот вариант на карте.
              </Text>

              <View style={styles.headerRow}>
                <View style={styles.rowLabel} />
                {grid.powers.map((p) => (
                  <View key={p} style={styles.cellWrap}>
                    <Text style={styles.colLabel}>{p} Вт</Text>
                  </View>
                ))}
              </View>

              {grid.delays.map((delay, rowIndex) => (
                <View key={delay} style={styles.row}>
                  <View style={styles.rowLabel}>
                    <Text style={styles.rowLabelText}>{formatDelay(delay)}</Text>
                  </View>
                  {grid.cells[rowIndex].map((cell) => {
                    const isBest =
                      cell.delayMinutes === grid.best.delayMinutes &&
                      cell.powerW === grid.best.powerW;
                    return (
                      <Pressable
                        key={cell.powerW}
                        style={styles.cellWrap}
                        onPress={() => onApply(cell)}
                        accessibilityRole="button"
                        accessibilityLabel={`Задержка ${cell.delayMinutes} минут, ${cell.powerW} ватт, под дождём ${cell.wetKm.toFixed(1)} километров`}
                      >
                        <View
                          style={[
                            styles.cell,
                            { backgroundColor: cellColor(cell.wetKm, grid.maxWetKm) },
                            isBest && styles.cellBest,
                          ]}
                        >
                          <Text style={styles.cellText}>
                            {cell.wetKm < DRY_THRESHOLD_KM
                              ? "сухо"
                              : cell.wetKm.toFixed(0)}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}

              <View style={styles.legendRow}>
                <View
                  style={[styles.legendDot, { backgroundColor: cellColor(0, grid.maxWetKm) }]}
                />
                <Text style={styles.legendText}>сухо</Text>
                <View
                  style={[
                    styles.legendDot,
                    { backgroundColor: cellColor(grid.maxWetKm, grid.maxWetKm) },
                  ]}
                />
                <Text style={styles.legendText}>
                  до {grid.maxWetKm.toFixed(0)} км под дождём
                </Text>
              </View>
            </>
          )}

          <Pressable onPress={onClose} style={styles.doneButton} accessibilityRole="button">
            <Text style={styles.doneText}>Закрыть</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    backgroundColor: "#15181d",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
    maxHeight: "88%",
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
    marginBottom: 14,
  },
  title: { color: theme.text, fontSize: 19, fontWeight: "700" },
  advice: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(245, 166, 35, 0.14)",
  },
  hint: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 10,
    marginBottom: 12,
  },
  headerRow: { flexDirection: "row", marginBottom: 4 },
  row: { flexDirection: "row", marginBottom: 4 },
  rowLabel: { width: 56, justifyContent: "center" },
  rowLabelText: { color: theme.textMuted, fontSize: 11 },
  colLabel: { color: theme.textMuted, fontSize: 10, textAlign: "center" },
  cellWrap: { flex: 1, paddingHorizontal: 2 },
  cell: {
    height: 34,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  cellBest: { borderWidth: 2, borderColor: theme.rider },
  cellText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    flexWrap: "wrap",
  },
  legendDot: { width: 12, height: 12, borderRadius: 3 },
  legendText: { color: theme.textMuted, fontSize: 11, marginRight: 8 },
  doneButton: {
    marginTop: 18,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  doneText: { color: theme.text, fontSize: 15, fontWeight: "700" },
});
