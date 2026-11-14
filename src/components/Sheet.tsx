import { ReactNode, useEffect, useRef } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { Easing, ReduceMotion, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { X } from 'lucide-react-native';

import { t } from '../i18n';
import { EASE, timing } from '../motion';
import { createStyles, radius, spacing, useColors } from '../theme';
import { useNavigationBarHeight } from './ui';

// La feuille du bas commune (planche « Feuilles du bas ») : un voile, une feuille qui monte en 340 ms
// (courbe douce, sans rebond), une poignée, un titre et un bouton fermer. Elle redescend avant de
// rendre la main (`close(after)` : l'action choisie part une fois la feuille rangée).

const OPEN_MS = 340;
const CLOSE_MS = 220;
const START = 640;
const SHEET_EASE = Easing.bezier(0.32, 0.72, 0, 1);

type Props = {
  title: string;
  onClose: () => void;
  children: (close: (after?: () => void) => void) => ReactNode;
  // Hauteur fixe (liste qui défile dedans) ; sinon la feuille prend la hauteur de son contenu.
  height?: number;
  // Feuille avec des champs : elle remonte au-dessus du clavier.
  keyboard?: boolean;
  // Travail en cours : le voile, le retour et le bouton fermer ne ferment pas.
  locked?: boolean;
};

export function Sheet({ title, onClose, children, height, keyboard, locked }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const bottom = useNavigationBarHeight();
  const shown = useSharedValue(0);
  const closing = useRef(false);

  useEffect(() => {
    shown.set(withTiming(1, { duration: OPEN_MS, easing: SHEET_EASE, reduceMotion: ReduceMotion.System }));
  }, [shown]);

  const close = (after?: () => void) => {
    if (closing.current || locked) return;
    closing.current = true;
    shown.set(withTiming(0, { duration: CLOSE_MS, easing: EASE, reduceMotion: ReduceMotion.System }));
    setTimeout(() => {
      onClose();
      after?.();
    }, CLOSE_MS);
  };

  const scrim = useAnimatedStyle(() => ({ opacity: shown.get() }));
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: START * (1 - shown.get()) }] }));

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => close()} statusBarTranslucent navigationBarTranslucent>
      <Reanimated.View style={[StyleSheet.absoluteFill, styles.scrim, scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityLabel={t('commun.fermer')} />
      </Reanimated.View>
      <KeyboardAvoidingView enabled={!!keyboard} behavior="padding" style={styles.dock} pointerEvents="box-none">
        <Reanimated.View style={[styles.sheet, { paddingBottom: bottom + spacing.lg }, height !== undefined && { height: height + bottom }, sheet]} accessibilityViewIsModal>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Pressable onPress={() => close()} disabled={locked} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('commun.fermer')} style={({ pressed }) => [styles.closeButton, locked && styles.dim, pressed && styles.pressed]}>
              <X size={16} color={colors.text} strokeWidth={2.2} />
            </Pressable>
          </View>
          {children(close)}
        </Reanimated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const AnimatedPath = Reanimated.createAnimatedComponent(Path);
const CHECK = 24;

function rowIn(index: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    const config = { duration: 240, easing: EASE, reduceMotion: ReduceMotion.System };
    const run = (value: number) => withDelay(60 + index * 30, withTiming(value, config));
    return { initialValues: { opacity: 0, transform: [{ translateY: 8 }] }, animations: { opacity: run(1), transform: [{ translateY: run(0) }] } };
  };
}

// Une ligne de choix : le fond se teinte, le rond se remplit de vert et la coche s'y dessine.
// multiple : une case carrée (plusieurs choix possibles) au lieu d'un rond.
export function SheetChoice({ label, detail, selected, index, multiple, left, onPress }: { label: string; detail?: string; selected: boolean; index: number; multiple?: boolean; left?: ReactNode; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.set(timing(selected ? 1 : 0, 200));
  }, [selected, on]);
  const tint = useAnimatedStyle(() => ({ opacity: on.get() }));
  const fill = useAnimatedStyle(() => ({ opacity: on.get() }));
  const check = useAnimatedProps(() => ({ strokeDashoffset: CHECK * (1 - on.get()) }));
  return (
    <Reanimated.View entering={rowIn(index)}>
      <Pressable onPress={onPress} accessibilityRole={multiple ? 'checkbox' : 'radio'} accessibilityState={{ checked: selected }} style={({ pressed }) => [styles.choice, multiple && styles.choiceFlat, pressed && styles.pressed]}>
        {!multiple && <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.choiceTint, tint]} />}
        {left}
        <View style={styles.flex}>
          <Text style={styles.choiceLabel} numberOfLines={1}>
            {label}
          </Text>
          {!!detail && <Text style={styles.choiceDetail}>{detail}</Text>}
        </View>
        <View style={[styles.mark, multiple && styles.markSquare]}>
          <Reanimated.View style={[StyleSheet.absoluteFill, styles.markFill, multiple && styles.markSquare, fill]} />
          <Svg width={14} height={14} viewBox="0 0 24 24">
            <AnimatedPath d="M5 12.5 10 17 19 7" fill="none" stroke={colors.onSignature} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={CHECK} animatedProps={check} />
          </Svg>
        </View>
      </Pressable>
    </Reanimated.View>
  );
}

const useStyles = createStyles((colors) => ({
  flex: { flex: 1 },
  scrim: { backgroundColor: colors.overlay },
  dock: { flex: 1, justifyContent: 'flex-end' },
  dim: { opacity: 0.35 },
  sheet: {
    maxHeight: '92%',
    paddingTop: 10,
    paddingHorizontal: 18,
    gap: 12,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: colors.elevated,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontSize: 20, fontWeight: '700', color: colors.text },
  closeButton: { width: 36, height: 36, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  choiceFlat: { backgroundColor: 'transparent', paddingHorizontal: 8 },
  choiceTint: { backgroundColor: colors.signature, opacity: 0 },
  choiceLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  choiceDetail: { fontSize: 12, marginTop: 2, color: colors.textMuted },
  mark: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  markSquare: { borderRadius: 8, width: 24, height: 24 },
  markFill: { backgroundColor: colors.signatureStrong },
}));
