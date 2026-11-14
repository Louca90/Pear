import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Reanimated, { ReduceMotion, withDelay, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';
import { Minus, Plus } from 'lucide-react-native';

import { Sheet } from '../../../components/Sheet';
import { EASE } from '../../../motion';
import { dateLocale, t } from '../../../i18n';
import { createStyles, radius, spacing, useColors } from '../../../theme';
import { parisNow } from '../../../time';
import { formatTime } from '../format';

const MINUTE = 60 * 1000;
const DAYS = 7;

// Le moment à `hours`:`minutes` du jour décalé de `dayOffset` (heure de Paris).
function at(dayOffset: number, hours: number, minutes: number) {
  const date = new Date(parisNow());
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

function dayLabel(offset: number) {
  if (offset === 0) return t('programme.aujourdhui');
  if (offset === 1) return t('programme.demain');
  const date = new Date(parisNow());
  date.setDate(date.getDate() + offset);
  return date.toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric' });
}

export function scheduleLabel(time: number) {
  const date = new Date(time);
  const today = new Date(parisNow());
  const tomorrow = new Date(parisNow());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day =
    date.toDateString() === today.toDateString()
      ? t('programme.aujourdhui')
      : date.toDateString() === tomorrow.toDateString()
        ? t('programme.demain')
        : date.toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} · ${formatTime(time)}`;
}

function tileIn(index: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    const config = { duration: 260, easing: EASE, reduceMotion: ReduceMotion.System };
    const run = (value: number) => withDelay(60 + index * 35, withTiming(value, config));
    return { initialValues: { opacity: 0, transform: [{ translateY: 8 }] }, animations: { opacity: run(1), transform: [{ translateY: run(0) }] } };
  };
}

// Programmer un message (planche « Feuilles du bas ») : des choix rapides en tuiles, ou un jour et une
// heure précis (par pas de 5 minutes), puis « Programmer pour… ».
export function ScheduleSheet({ onSchedule, onClose }: { onSchedule: (time: number) => void; onClose: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const start = new Date(parisNow() + 60 * MINUTE);
  const [day, setDay] = useState(0);
  const [hours, setHours] = useState(start.getHours());
  const [minutes, setMinutes] = useState(Math.ceil(start.getMinutes() / 5) * 5 % 60);

  const now = parisNow();
  const quick = [
    { label: t('programme.dansUneHeure'), time: now + 60 * MINUTE },
    ...(at(0, 20, 0) > now + 5 * MINUTE ? [{ label: t('programme.ceSoir'), time: at(0, 20, 0) }] : []),
    { label: t('programme.demainMatin'), time: at(1, 9, 0) },
    { label: t('programme.demainSoir'), time: at(1, 19, 0) },
  ];
  const custom = at(day, hours, minutes);
  const customValid = custom > now + MINUTE;

  const stepper = (value: number, onChange: (next: number) => void, max: number, step: number) => (
    <View style={styles.stepper}>
      <Pressable onPress={() => onChange((value - step + max) % max)} style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]} accessibilityLabel={t('programme.moins')}>
        <Minus size={18} color={colors.text} strokeWidth={2} />
      </Pressable>
      <Text style={styles.stepValue}>{String(value).padStart(2, '0')}</Text>
      <Pressable onPress={() => onChange((value + step) % max)} style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]} accessibilityLabel={t('programme.plus')}>
        <Plus size={18} color={colors.text} strokeWidth={2} />
      </Pressable>
    </View>
  );

  return (
    <Sheet title={t('programme.titre')} onClose={onClose}>
      {(close) => (
        <>
          <View style={styles.tiles}>
            {quick.map((option, index) => (
              <Reanimated.View key={option.label} entering={tileIn(index)} style={styles.tileSlot}>
                <Pressable onPress={() => close(() => onSchedule(option.time))} accessibilityRole="button" style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
                  <Text style={styles.tileLabel} numberOfLines={1}>
                    {option.label}
                  </Text>
                  <Text style={styles.tileTime}>{formatTime(option.time)}</Text>
                </Pressable>
              </Reanimated.View>
            ))}
          </View>
          <Text style={styles.section}>{t('programme.choisir')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
            {Array.from({ length: DAYS }, (_, offset) => (
              <Pressable key={offset} onPress={() => setDay(offset)} accessibilityState={{ selected: day === offset }} style={[styles.day, day === offset && styles.dayOn]}>
                <Text style={[styles.dayLabel, day === offset && styles.dayLabelOn]}>{dayLabel(offset)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.time}>
            {stepper(hours, setHours, 24, 1)}
            <Text style={styles.colon}>:</Text>
            {stepper(minutes, setMinutes, 60, 5)}
          </View>
          <Pressable disabled={!customValid} onPress={() => close(() => onSchedule(custom))} accessibilityRole="button" style={({ pressed }) => [styles.confirm, !customValid && styles.confirmOff, pressed && styles.pressed]}>
            <Text style={[styles.confirmLabel, !customValid && styles.confirmLabelOff]}>
              {customValid ? t('programme.programmerPour', { quand: scheduleLabel(custom) }) : t('programme.passe')}
            </Text>
          </Pressable>
          <Text style={styles.hint}>{t('programme.aide')}</Text>
        </>
      )}
    </Sheet>
  );
}

const useStyles = createStyles((colors) => ({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tileSlot: { flexBasis: '47%', flexGrow: 1 },
  tile: { height: 64, borderRadius: 16, paddingHorizontal: 14, justifyContent: 'center', gap: 2, backgroundColor: colors.surface },
  tileLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  tileTime: { fontSize: 12, color: colors.textMuted },
  section: { marginTop: 4, marginHorizontal: 4, fontSize: 12, fontWeight: '600', letterSpacing: 0.7, textTransform: 'uppercase', color: colors.textMuted },
  days: { gap: 6 },
  day: { height: 36, paddingHorizontal: 14, borderRadius: radius.full, justifyContent: 'center', backgroundColor: colors.surface },
  dayOn: { backgroundColor: colors.text },
  dayLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  dayLabelOn: { color: colors.background },
  time: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 4, borderRadius: 18, backgroundColor: colors.surface },
  stepButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.elevated },
  stepValue: { minWidth: 40, textAlign: 'center', fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'], color: colors.text },
  colon: { fontSize: 24, fontWeight: '700', color: colors.textMuted },
  confirm: { height: 54, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text },
  confirmOff: { backgroundColor: colors.surface },
  confirmLabel: { fontSize: 16, fontWeight: '700', color: colors.background },
  confirmLabelOff: { color: colors.textMuted },
  hint: { textAlign: 'center', fontSize: 12, color: colors.textMuted },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
}));