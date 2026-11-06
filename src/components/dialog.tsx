import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { createStyles, radius, spacing, useColors } from '../theme';

export type DialogButton = {
  label: string;
  onPress?: () => void;
  style?: 'default' | 'danger' | 'cancel';
};

type Dialog = {
  title: string;
  message?: string;
  buttons: DialogButton[];
};

let current: Dialog | null = null;
const listeners = new Set<() => void>();

function update(next: Dialog | null) {
  current = next;
  listeners.forEach((listener) => listener());
}

// Remplace la boîte de dialogue d'Android, partout dans l'app.
export function showDialog(title: string, message?: string, buttons: DialogButton[] = [{ label: 'OK' }]) {
  update({ title, message, buttons });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function DialogBox({ dialog }: { dialog: Dialog }) {
  const colors = useColors();
  const styles = useStyles();
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    Animated.spring(progress, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 240 }).start();
  }, [progress]);

  const close = (after?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: 130, useNativeDriver: true }).start(() => {
      update(null);
      after?.();
    });
  };

  const cancel = dialog.buttons.find((button) => button.style === 'cancel');

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => close(cancel?.onPress)} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: progress }]} />
      <View style={styles.center}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => cancel && close(cancel.onPress)} />
        <Animated.View
          style={[
            styles.box,
            { opacity: progress, transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] },
          ]}
        >
          <Text style={styles.title}>{dialog.title}</Text>
          {dialog.message && <Text style={styles.message}>{dialog.message}</Text>}
          <View style={styles.buttons}>
            {dialog.buttons.map((button) => (
              <Pressable
                key={button.label}
                onPress={() => close(button.onPress)}
                style={({ pressed }) => [
                  styles.button,
                  button.style === 'danger' ? styles.buttonDanger : button.style === 'cancel' ? styles.buttonCancel : styles.buttonDefault,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.label, { color: button.style === 'cancel' ? colors.text : colors.background }]}>{button.label}</Text>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

export function DialogHost() {
  const dialog = useSyncExternalStore(subscribe, () => current);
  return dialog ? <DialogBox dialog={dialog} /> : null;
}

const useStyles = createStyles((colors) => ({
  overlay: {
    backgroundColor: colors.overlay,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  box: {
    width: '100%',
    maxWidth: 360,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  message: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  buttons: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  button: {
    height: 48,
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
  buttonCancel: {
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.7,
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
  },
}));
