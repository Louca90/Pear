import { ReactNode, useEffect, useRef, useSyncExternalStore } from 'react';
import { Animated, Easing, Image, Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { ArrowLeft, LucideIcon, User } from 'lucide-react-native';

import { getInsets, subscribeInsets } from '../../modules/pear-native';
import { createStyles, radius, spacing, useColors } from '../theme';
import { t } from '../i18n';

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
  const styles = useStyles();
  const { top } = useInsets();
  return <View style={[styles.screen, { paddingTop: top }, edgeToEdgeBottom && styles.noBottom]}>{children}</View>;
}

type HeaderProps = {
  title: string;
  subtitle?: string;
  // À côté du titre (la flamme de la série dans une conversation).
  titleAccessory?: ReactNode;
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
  const animate = (toValue: number) => Animated.spring(scale, { toValue, useNativeDriver: true, overshootClamping: true, damping: 12, stiffness: 320 }).start();
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
  const colors = useColors();
  const styles = useStyles();
  const shape = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={shape} resizeMode="cover" />;
  return (
    <View style={[styles.avatarEmpty, shape]}>
      <User size={size * 0.46} color={colors.text} strokeWidth={1.75} />
    </View>
  );
}

// Le sous-titre de l'en-tête (« Connecté », « écrit… ») change en fondu.
function FadingSubtitle({ text }: { text: string }) {
  const styles = useStyles();
  const opacity = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [text, opacity]);
  return (
    <Animated.Text style={[styles.headerSubtitle, { opacity }]} numberOfLines={1}>
      {text}
    </Animated.Text>
  );
}

export function Header({ title, subtitle, onBack, action, avatar, onTitlePress, titleAccessory }: HeaderProps) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={styles.header}>
      {onBack && (
        <IconButton onPress={onBack} label={t('commun.retour')} style={styles.back}>
          <ArrowLeft size={24} color={colors.text} strokeWidth={1.75} />
        </IconButton>
      )}
      <Pressable onPress={onTitlePress} disabled={!onTitlePress} style={styles.headerTitleArea}>
        {avatar}
        <View style={styles.headerText}>
          <View style={styles.headerTitleRow}>
            <Text style={[subtitle ? styles.headerTitleSmall : styles.headerTitle, styles.headerTitleText]} numberOfLines={1}>{title}</Text>
            {titleAccessory}
          </View>
          {subtitle && <FadingSubtitle text={subtitle} />}
        </View>
      </Pressable>
      {action}
    </View>
  );
}

type RowPressableProps = {
  onPress: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  label?: string;
  children: ReactNode;
};

// Une ligne qu'on touche (liste, menu) : le fond d'appui suit ses coins arrondis au lieu de déborder
// en rectangle sur les bords du conteneur.
export function RowPressable({ onPress, onLongPress, style, label, children }: RowPressableProps) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.rowPressable, style, pressed && styles.rowPressed]}
    >
      {children}
    </Pressable>
  );
}

type ButtonProps = {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
};

export function Button({ label, icon: Icon, onPress, variant = 'primary' }: ButtonProps) {
  const colors = useColors();
  const styles = useStyles();
  const primary = variant === 'primary';
  const foreground = primary ? colors.background : colors.text;
  const scale = useRef(new Animated.Value(1)).current;
  const animate = (toValue: number) => Animated.spring(scale, { toValue, useNativeDriver: true, overshootClamping: true, damping: 14, stiffness: 320 }).start();
  return (
    <Pressable onPress={onPress} onPressIn={() => animate(0.95)} onPressOut={() => animate(1)}>
      <Animated.View style={[styles.button, primary ? styles.primary : styles.secondary, { transform: [{ scale }] }]}>
        <Icon size={20} color={foreground} strokeWidth={1.75} />
        <Text style={[styles.buttonLabel, { color: foreground }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

const useStyles = createStyles((colors) => ({
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
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitleText: {
    flexShrink: 1,
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
  rowPressable: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  rowPressed: {
    backgroundColor: colors.surface,
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
}));
