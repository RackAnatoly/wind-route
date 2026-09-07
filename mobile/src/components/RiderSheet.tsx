import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Slider from "@react-native-community/slider";
import { RIDER_PRESETS, speedFor, STANDARD_AIR_DENSITY, type RiderProfile } from "@shared/physics";
import { theme } from "../theme";

interface RiderSheetProps {
  visible: boolean;
  profile: RiderProfile;
  onChange: (profile: RiderProfile) => void;
  onClose: () => void;
  bottomInset: number;
}

// Три опорные ситуации: по ним сразу видно, что даёт правка профиля.
function referenceSpeeds(profile: RiderProfile) {
  return [
    { label: "ровно, штиль", value: speedFor(profile, 0, 0, STANDARD_AIR_DENSITY) },
    {
      label: "против 25 км/ч",
      value: speedFor(profile, 0, 25 / 3.6, STANDARD_AIR_DENSITY),
    },
    { label: "подъём 6%", value: speedFor(profile, 0.06, 0, STANDARD_AIR_DENSITY) },
  ];
}

export function RiderSheet({
  visible,
  profile,
  onChange,
  onClose,
  bottomInset,
}: RiderSheetProps) {
  const activePreset = RIDER_PRESETS.find(
    (p) =>
      p.profile.targetPowerW === profile.targetPowerW &&
      p.profile.cda === profile.cda &&
      p.profile.totalMassKg === profile.totalMassKg,
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: bottomInset + 16 }]}>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Профиль велосипедиста</Text>
          <Text style={styles.hint}>
            От него зависит расчётная скорость на каждом сегменте, а значит — время
            прихода в точку и то, какая погода там будет.
          </Text>

          <View style={styles.presetRow}>
            {RIDER_PRESETS.map((preset) => {
              const active = activePreset?.id === preset.id;
              return (
                <Pressable
                  key={preset.id}
                  onPress={() => onChange(preset.profile)}
                  style={[styles.preset, active && styles.presetActive]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.presetText, active && styles.presetTextActive]}>
                    {preset.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Field
            label="Мощность"
            value={`${profile.targetPowerW} Вт`}
            min={90}
            max={330}
            step={5}
            current={profile.targetPowerW}
            onChange={(targetPowerW) => onChange({ ...profile, targetPowerW })}
          />

          <Field
            label="Масса с велосипедом"
            value={`${profile.totalMassKg} кг`}
            min={55}
            max={130}
            step={1}
            current={profile.totalMassKg}
            onChange={(totalMassKg) => onChange({ ...profile, totalMassKg })}
          />

          <Field
            label="Аэродинамика CdA"
            value={profile.cda.toFixed(2)}
            min={0.24}
            max={0.55}
            step={0.01}
            current={profile.cda}
            onChange={(cda) => onChange({ ...profile, cda: Number(cda.toFixed(2)) })}
          />

          <View style={styles.referenceBlock}>
            {referenceSpeeds(profile).map((r) => (
              <View key={r.label} style={styles.referenceRow}>
                <Text style={styles.referenceLabel}>{r.label}</Text>
                <Text style={styles.referenceValue}>
                  {(r.value * 3.6).toFixed(1)} км/ч
                </Text>
              </View>
            ))}
          </View>

          <Pressable onPress={onClose} style={styles.doneButton} accessibilityRole="button">
            <Text style={styles.doneText}>Готово</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Field({
  label,
  value,
  min,
  max,
  step,
  current,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  current: number;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue}>{value}</Text>
      </View>
      <Slider
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={current}
        onValueChange={onChange}
        minimumTrackTintColor={theme.radarBadge}
        maximumTrackTintColor="rgba(255,255,255,0.25)"
        thumbTintColor={theme.text}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  sheet: {
    backgroundColor: "#15181d",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 8,
    maxHeight: "82%",
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.25)",
    marginBottom: 14,
  },
  title: {
    color: theme.text,
    fontSize: 19,
    fontWeight: "700",
  },
  hint: {
    color: theme.textMuted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    marginBottom: 14,
  },
  presetRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 18,
  },
  preset: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  presetActive: {
    backgroundColor: theme.radarBadge,
  },
  presetText: {
    color: theme.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  presetTextActive: {
    color: "#fff",
  },
  field: {
    marginBottom: 8,
  },
  fieldRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  fieldLabel: {
    color: theme.textMuted,
    fontSize: 13,
  },
  fieldValue: {
    color: theme.text,
    fontSize: 15,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  referenceBlock: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    gap: 6,
  },
  referenceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  referenceLabel: {
    color: theme.textMuted,
    fontSize: 12,
  },
  referenceValue: {
    color: theme.text,
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  doneButton: {
    marginTop: 18,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  doneText: {
    color: theme.text,
    fontSize: 15,
    fontWeight: "700",
  },
});
