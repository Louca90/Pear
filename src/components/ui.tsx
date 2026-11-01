import { ReactNode } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft, LucideIcon } from 'lucide-react-native';

import { colors, radius, spacing } from '../theme';

export function Screen({ children }: { children: ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Header({ title, onBack, action }: { title: string; onBack?: () => void; action?: ReactNode }) {
  return (
    <View style={styles.header}>
      {onBack && (
        <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Retour" style={styles.back}>
          <ArrowLeft size={24} color={colors.text} strokeWidth={1.75} />
        </Pressable>
      )}
      <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      {action}
    </View>
  );
}

type ButtonProps = {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
};

export function Button({ label, icon: Icon, onPress, variant = 'primary' }: ButtonProps) {
  const primary = variant === 'primary';
  const foreground = primary ? colors.background : colors.text;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.button, primary ? styles.primary : styles.secondary, pressed && styles.pressed]}
    >
      <Icon size={20} color={foreground} strokeWidth={1.75} />
      <Text style={[styles.buttonLabel, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // L'app s'affiche sous les barres d'Android : on réserve leur place.
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: StatusBar.currentHeight,
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: {
    marginLeft: -4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 52,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
  },
  primary: {
    backgroundColor: colors.text,
  },
  secondary: {
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.6,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
});
