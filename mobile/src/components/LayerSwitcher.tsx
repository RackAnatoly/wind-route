import { Pressable, StyleSheet, Text, View } from "react-native";
import { theme } from "../theme";

export interface MapLayers {
  clouds: boolean;
  rain: boolean;
  wind: boolean;
  temperature: boolean;
}

export const DEFAULT_LAYERS: MapLayers = {
  clouds: true,
  rain: true,
  wind: false,
  temperature: true,
};

const ITEMS: { key: keyof MapLayers; icon: string; label: string }[] = [
  { key: "clouds", icon: "☁", label: "Облачность" },
  { key: "rain", icon: "💧", label: "Осадки" },
  { key: "temperature", icon: "🌡", label: "Температура" },
  { key: "wind", icon: "🎏", label: "Ветер" },
];

// Вертикальный стек переключателей у правого края — привычная раскладка
// погодных приложений: слои включаются независимо друг от друга.
export function LayerSwitcher({
  layers,
  onToggle,
}: {
  layers: MapLayers;
  onToggle: (key: keyof MapLayers) => void;
}) {
  return (
    <View style={styles.container}>
      {ITEMS.map((item) => {
        const active = layers[item.key];
        return (
          <Pressable
            key={item.key}
            onPress={() => onToggle(item.key)}
            style={[styles.button, active && styles.buttonActive]}
            accessibilityRole="switch"
            accessibilityState={{ checked: active }}
            accessibilityLabel={item.label}
          >
            <Text style={[styles.icon, !active && styles.iconInactive]}>
              {item.icon}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
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
  buttonActive: {
    backgroundColor: theme.radarBadge,
    borderColor: "rgba(255,255,255,0.35)",
  },
  icon: {
    fontSize: 19,
  },
  iconInactive: {
    opacity: 0.45,
  },
});
