import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Clock, Minus, Plus } from 'lucide-react-native';

import { useNavigationBarHeight } from '../../../components/ui';
import { dateLocale, t } from '../../../i18n';
import { createStyles, radius, spacing, useColors } from '../../../theme';
import { parisNow } from '../../../time';
import { formatTime } from '../format';

const OPEN_MS = 240;
const CLOSE_MS = 180;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
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

// Programmer un message : choix rapides, ou un jour et une heure précis (par pas de 5 minutes).
export function ScheduleSheet({ onSchedule, onClose }: { onSchedule: (time: number) => void; onClose: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const bottom = useNavigationBarHeight();
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const start = new Date(parisNow() + 60 * MINUTE);
  const [day, setDay] = useState(0);
  const [hours, setHours] = useState(start.getHours());
  const [minutes, setMinutes] = useState(Math.ceil(start.getMinutes() / 5) * 5 % 60);

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start();
  }, [progress]);

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: CLOSE_MS, easing: EASING, useNativeDriver: true }).start(() => {
      onClose();
      then?.();
    });
  };

  const choose = (time: number) => close(() => onSchedule(time));
  const now = parisNow();
  const quick = [
    { label: t('programme.dansUneHeure'), time: now + 60 * MINUTE },
    ...(at(0, 20, 0) > now + 5 * MINUTE ? [{ label: t('programme.ceSoir'), time: at(0, 20, 0) }] : []),
    { label: t('programme.demainMatin'), time: at(1, 9, 0) },
  ];
  const custom = at(day, hours, minutes);
  const customValid = custom > now + MINUTE;

  const stepper = (value: number, onChange: (next: number) => void, max: number, step: number) => (
    <View style={styles.stepper}>
      <Pressable onPress={() => onChange((value - step + max) % max)} style={styles.stepButton} accessibilityLabel={t('programme.moins')}>
        <Minus size={18} color={colors.text} strokeWidth={2} />
      </Pressable>
      <Text style={styles.stepValue}>{String(value).padStart(2, '0')}</Text>
      <Pressable onPress={() => onChange((value + step) % max)} style={styles.stepButton} accessibilityLabel={t('programme.plus')}>
        <Plus size={18} color={colors.text} strokeWidth={2} />
      </Pressable>
    </View>
  );

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => close()} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={styles.flex} onPress={() => close()} accessibilityLabel={t('commun.fermer')} />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { paddingBottom: bottom + spacing.md }, { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [520, 0] }) }] }]}
      >
        <Pressable onPress={() => close()} style={styles.header} accessibilityLabel={t('commun.fermer')}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t('programme.titre')}</Text>
        </Pressable>
        {quick.map((option) => (
          <Pressable key={option.label} onPress={() => choose(option.time)} style={({ pressed }) => [styles.quick, pressed && styles.pressed]}>
            <Clock size={20} color={colors.text} strokeWidth={1.75} />
            <Text style={styles.quickLabel}>{option.label}</Text>
            <Text style={styles.quickTime}>{scheduleLabel(option.time)}</Text>
          </Pressable>
        ))}
        <Text style={styles.section}>{t('programme.choisir')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
          {Array.from({ length: DAYS }, (_, offset) => (
            <Pressable key={offset} onPress={() => setDay(offset)} style={[styles.day, day === offset && styles.dayOn]}>
              <Text style={[styles.dayLabel, day === offset && styles.dayLabelOn]}>{dayLabel(offset)}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.time}>
          {stepper(hours, setHours, 24, 1)}
          <Text style={styles.colon}>:</Text>
          {stepper(minutes, setMinutes, 60, 5)}
        </View>
        <Pressable
          disabled={!customValid}
          onPress={() => choose(custom)}
          style={({ pressed }) => [styles.confirm, !customValid && styles.confirmOff, pressed && styles.pressed]}
        >
          <Text style={[styles.confirmLabel, !customValid && styles.confirmLabelOff]}>
            {customValid ? t('programme.programmerPour', { quand: scheduleLabel(custom) }) : t('programme.passe')}
          </Text>
        </Pressable>
        <Text style={styles.hint}>{t('programme.aide')}</Text>
      </Animated.View>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.background,
  },
  header: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    paddingHorizontal: spacing.lg,
  },
  quick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    height: 52,
  },
  pressed: {
    opacity: 0.6,
  },
  quickLabel: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
  quickTime: {
    fontSize: 14,
    color: colors.textMuted,
  },
  section: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  days: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  day: {
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  dayOn: {
    backgroundColor: colors.accent,
  },
  dayLabel: {
    fontSize: 14,
    color: colors.text,
  },
  dayLabelOn: {
    color: colors.onAccent,
    fontWeight: '600',
  },
  time: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    width: 48,
    textAlign: 'center',
    fontSize: 28,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  colon: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.text,
  },
  confirm: {
    height: 52,
    marginHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmOff: {
    backgroundColor: colors.surface,
  },
  confirmLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.onAccent,
  },
  confirmLabelOff: {
    color: colors.textMuted,
  },
  hint: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
}));
