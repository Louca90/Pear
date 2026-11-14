import { ComponentType, useEffect, useState, useSyncExternalStore } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';
import { CircleAlert, Info } from 'lucide-react-native';

import { haptics } from '../haptics';
import { EASE } from '../motion';
import { createStyles, radius, spacing, useColors } from '../theme';
import { useNavigationBarHeight } from './ui';

export type DialogButton = {
  label: string;
  onPress?: () => void;
  style?: 'default' | 'danger' | 'cancel';
};

// icon : une icône pour la pastille du haut (sinon une icône d'alerte si un bouton est destructeur, une
// icône d'information s'il n'y a qu'un bouton, aucune pour une liste de choix).
export type DialogOptions = { icon?: ComponentType<{ size: number; color: string; strokeWidth: number }> };

type Dialog = {
  title: string;
  message?: string;
  buttons: DialogButton[];
  options: DialogOptions;
  // Change à chaque nouvelle boîte : elle rejoue son entrée.
  id: number;
};

let current: Dialog | null = null;
let counter = 0;
const listeners = new Set<() => void>();

function update(next: Dialog | null) {
  current = next;
  listeners.forEach((listener) => listener());
}

// Remplace la boîte de dialogue d'Android, partout dans l'app.
export function showDialog(title: string, message?: string, buttons: DialogButton[] = [{ label: 'OK' }], options: DialogOptions = {}) {
  counter += 1;
  update({ title, message, buttons, options, id: counter });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function config(duration: number) {
  'worklet';
  return { duration, easing: EASE, reduceMotion: ReduceMotion.System };
}

// La carte monte de 18 points en fondu, d'une échelle de 0,96 à 1 ; la pastille d'icône suit, de 0,6 à 1.
const cardIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 18 }, { scale: 0.96 }] },
    animations: { opacity: withTiming(1, config(300)), transform: [{ translateY: withTiming(0, config(300)) }, { scale: withTiming(1, config(300)) }] },
  };
};
const iconIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.6 }] },
    animations: { opacity: withDelay(80, withTiming(1, config(280))), transform: [{ scale: withDelay(80, withTiming(1, config(280))) }] },
  };
};
function rowIn(index: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    const run = (value: number) => withDelay(60 + index * 30, withTiming(value, config(240)));
    return { initialValues: { opacity: 0, transform: [{ translateY: 6 }] }, animations: { opacity: run(1), transform: [{ translateY: run(0) }] } };
  };
}

function DialogBox({ dialog }: { dialog: Dialog }) {
  const colors = useColors();
  const styles = useStyles();
  const bottom = useNavigationBarHeight();
  const shown = useSharedValue(1);
  const [closing, setClosing] = useState(false);

  const cancel = dialog.buttons.find((button) => button.style === 'cancel');
  const actions = dialog.buttons.filter((button) => button.style !== 'cancel');
  const danger = actions.some((button) => button.style === 'danger');
  // Plus de deux actions : une liste de choix, alignée à gauche.
  const choices = actions.length > 2;
  const Icon = dialog.options.icon ?? (choices ? null : danger ? CircleAlert : actions.length <= 1 ? Info : null);

  useEffect(() => {
    if (danger) haptics.action();
  }, [danger]);

  // Fermer : la carte et le voile s'effacent (150 ms), puis l'action choisie.
  const close = (after?: () => void) => {
    if (closing) return;
    setClosing(true);
    shown.set(withTiming(0, config(150)));
    setTimeout(() => {
      if (current?.id === dialog.id) update(null);
      after?.();
    }, 150);
  };
  const fade = useAnimatedStyle(() => ({ opacity: shown.get() }));

  const buttonStyle = (button: DialogButton) => (button.style === 'danger' ? styles.buttonDanger : styles.buttonDefault);
  const labelColor = (button: DialogButton) => (button.style === 'danger' ? colors.background : colors.background);

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => close(cancel?.onPress)} statusBarTranslucent navigationBarTranslucent>
      <Reanimated.View style={[StyleSheet.absoluteFill, fade]}>
        <Reanimated.View entering={scrimIn} style={[StyleSheet.absoluteFill, styles.overlay]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => cancel && close(cancel.onPress)} accessibilityLabel={cancel?.label} />
        </Reanimated.View>
        <Reanimated.View entering={cardIn} style={[styles.card, choices && styles.cardChoices, { bottom: bottom + 34 }]} accessibilityRole="alert" accessibilityViewIsModal>
          {Icon && (
            <Reanimated.View entering={iconIn} style={[styles.icon, danger ? styles.iconDanger : styles.iconInfo]}>
              <Icon size={26} color={danger ? colors.danger : colors.onSignature} strokeWidth={1.8} />
            </Reanimated.View>
          )}
          <Text style={[styles.title, choices && styles.left]}>{dialog.title}</Text>
          {!!dialog.message && <Text style={[styles.message, choices && styles.left]}>{dialog.message}</Text>}
          {choices ? (
            <View style={styles.rows}>
              {actions.map((button, index) => (
                <Reanimated.View key={button.label} entering={rowIn(index)}>
                  <Pressable onPress={() => close(button.onPress)} accessibilityRole="button" style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                    <Text style={[styles.rowLabel, button.style === 'danger' && { color: colors.danger }]}>{button.label}</Text>
                  </Pressable>
                </Reanimated.View>
              ))}
            </View>
          ) : (
            <View style={styles.buttons}>
              {actions.map((button) => (
                <Pressable key={button.label} onPress={() => close(button.onPress)} accessibilityRole="button" style={({ pressed }) => [styles.button, buttonStyle(button), pressed && styles.pressed]}>
                  <Text style={[styles.label, { color: labelColor(button) }]}>{button.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {cancel && (
            <Pressable onPress={() => close(cancel.onPress)} accessibilityRole="button" style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}>
              <Text style={styles.cancelLabel}>{cancel.label}</Text>
            </Pressable>
          )}
        </Reanimated.View>
      </Reanimated.View>
    </Modal>
  );
}

const scrimIn: EntryExitAnimationFunction = () => {
  'worklet';
  return { initialValues: { opacity: 0 }, animations: { opacity: withTiming(1, config(220)) } };
};

export function DialogHost() {
  const dialog = useSyncExternalStore(subscribe, () => current);
  // La clé : une nouvelle boîte (ouverte depuis l'action d'une autre) rejoue son entrée.
  return dialog ? <DialogBox key={dialog.id} dialog={dialog} /> : null;
}

const useStyles = createStyles((colors) => ({
  overlay: {
    backgroundColor: colors.overlay,
  },
  card: {
    position: 'absolute',
    left: 20,
    right: 20,
    alignItems: 'center',
    gap: 10,
    paddingTop: 26,
    paddingHorizontal: 22,
    paddingBottom: 14,
    borderRadius: 30,
    backgroundColor: colors.elevated,
  },
  cardChoices: {
    alignItems: 'stretch',
    paddingTop: 22,
    paddingHorizontal: 14,
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  iconDanger: {
    backgroundColor: colors.dangerSoft,
  },
  iconInfo: {
    backgroundColor: colors.signature,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    textAlign: 'center',
    color: colors.text,
  },
  message: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    color: colors.textMuted,
  },
  left: {
    textAlign: 'left',
    marginHorizontal: 8,
  },
  buttons: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: 12,
  },
  button: {
    height: 52,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDefault: {
    backgroundColor: colors.text,
  },
  buttonDanger: {
    backgroundColor: colors.danger,
  },
  label: {
    fontSize: 15,
    fontWeight: '700',
  },
  rows: {
    gap: 6,
    marginTop: 8,
  },
  row: {
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 16,
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  rowPressed: {
    backgroundColor: colors.elevatedActive,
  },
  rowLabel: {
    fontSize: 15,
    color: colors.text,
  },
  cancel: {
    alignSelf: 'stretch',
    height: 48,
    marginTop: 2,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
}));
