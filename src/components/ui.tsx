import { ReactNode, useRef, useSyncExternalStore } from 'react';
import { Animated, Image, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { ArrowLeft, LucideIcon, User } from 'lucide-react-native';

import { getInsets, subscribeInsets } from '../../modules/pear-native';
import { colors, radius, spacing } from '../theme';

// Les barres d'Android (en dp), toujours à jour : remesurées au déverrouillage, au retour dans l'app
// et quand on passe des gestes aux boutons.
export function useInsets() {
  return useSyncExternalStore(subscribeInsets, getInsets);
}

// La barre d'Android reste visible, sur un fond transparent : l'interface se place juste au-dessus.
export function useNavigationBarHeight() {
  return useInsets().bottom;
}

export function Screen({ children, edgeToEdgeBottom }: { children: ReactNode; edgeToEdgeBottom?: boolean }) {
  const { top } = useInsets();
  return <View style={[styles.screen, { paddingTop: top }, edgeToEdgeBottom && styles.noBottom]}>{children}</View>;
}

type HeaderProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: ReactNode;
  avatar?: ReactNode;
  onTitlePress?: () => void;
};

type IconButtonProps = {
  onPress: () => void;
  label: string;
  disabled?: boolean;
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

// Bouton à icône : il se tasse sous le doigt et revient avec un petit rebond.
export function IconButton({ onPress, label, disabled, hitSlop = 12, style, children }: IconButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (toValue: number) => Animated.spring(scale, { toValue, useNativeDriver: true, damping: 12, stiffness: 320 }).start();
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => animate(0.82)}
      onPressOut={() => animate(1)}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityLabel={label}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

export function Avatar({ uri, size = 44 }: { uri?: string | null; size?: number }) {
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={shape} resizeMode="cover" />;
  return (
    <View style={[styles.avatarEmpty, shape]}>
      <User size={size * 0.46} color={colors.text} strokeWidth={1.75} />
    </View>
  );
}

export function Header({ title, subtitle, onBack, action, avatar, onTitlePress }: HeaderProps) {
  return (
    <View style={styles.header}>
      {onBack && (
        <IconButton onPress={onBack} label="Retour" style={styles.back}>
          <ArrowLeft size={24} color={colors.text} strokeWidth={1.75} />
        </IconButton>
      )}
      <Pressable onPress={onTitlePress} disabled={!onTitlePress} style={styles.headerTitleArea}>
        {avatar}
        <View style={styles.headerText}>
          <Text style={subtitle ? styles.headerTitleSmall : styles.headerTitle} numberOfLines={1}>{title}</Text>
          {subtitle && <Text style={styles.headerSubtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>
      </Pressable>
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
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (toValue: number) => Animated.spring(scale, { toValue, useNativeDriver: true, damping: 14, stiffness: 320 }).start();
  return (
    <Pressable onPress={onPress} onPressIn={() => animate(0.95)} onPressOut={() => animate(1)}>
      <Animated.View style={[styles.button, primary ? styles.primary : styles.secondary, { transform: [{ scale }] }]}>
        <Icon size={20} color={foreground} strokeWidth={1.75} />
        <Text style={[styles.buttonLabel, { color: foreground }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // L'app s'affiche sous les barres d'Android : on réserve leur place.
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingBottom: spacing.lg,
  },
  noBottom: {
    paddingBottom: 0,
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
  avatarEmpty: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
  },
  headerTitleSmall: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
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
  buttonLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
});
