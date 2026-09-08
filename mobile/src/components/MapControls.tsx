import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

// Локация и зум — тем же вертикальным стеком, что и LayerSwitcher, и сразу
// под ним: единая колонка кнопок никогда не пересечётся сама с собой,
// в отличие от двух независимо позиционированных стеков.
export function MapControls({
  onLocateMe,
  onZoomIn,
  onZoomOut,
}: {
  onLocateMe: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
}) {
  return (
    <View style={styles.container}>
      <Pressable
        style={styles.button}
        onPress={onLocateMe}
        accessibilityRole="button"
        accessibilityLabel="Моё местоположение"
      >
        <Text style={styles.icon}>⌖</Text>
      </Pressable>
      <Pressable
        style={styles.button}
        onPress={onZoomIn}
        accessibilityRole="button"
        accessibilityLabel="Приблизить"
      >
        <Text style={styles.icon}>+</Text>
      </Pressable>
      <Pressable
        style={styles.button}
        onPress={onZoomOut}
        accessibilityRole="button"
        accessibilityLabel="Отдалить"
      >
        <Text style={styles.icon}>−</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
    marginTop: 16,
    alignSelf: "flex-end",
    marginRight: 12,
  },
  button: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.panel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.panelBorder,
  },
  icon: {
    fontSize: 20,
    fontWeight: "600",
    color: theme.text,
  },
});
