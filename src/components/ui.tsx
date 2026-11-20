import { ReactNode, useEffect, useRef, useSyncExternalStore } from 'react';
import { Image, Pressable, StyleProp, Text, View, ViewStyle } from 'react-native';
import { ArrowLeft, LucideIcon, NotebookPen, User } from 'lucide-react-native';

import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { getInsets, subscribeInsets } from '../../modules/pear-native';
import { DURATION, EASE, timing } from '../motion';
import { useMediaUri } from '../chat/media';
import { createStyles, motion, radius, spacing, useColors } from '../theme';
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
  // Couleur du sous-titre (« en ligne » en couleur signature).
  subtitleColor?: string;
  // À côté du titre (indicateurs de la conversation : connexion, éphémère).
  titleAccessory?: ReactNode;
  onBack?: () => void;
  action?: ReactNode;
  avatar?: ReactNode;
  onTitlePress?: () => void;
};

type IconButtonProps = {
  onPress: () => void;
  onLongPress?: () => void;
  label: string;
  disabled?: boolean;
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

// L'effet d'appui de tous les boutons, défini une seule fois : sous le doigt, échelle 0,97 et
// opacité 0,85 en motion.press, retour à l'identique avec la même courbe, sans rebond.
// Sur le fil natif (Reanimated) : l'effet ne saccade pas même si l'app est occupée.
export function usePressFeedback(scale: number = motion.pressScale, opacity: number = motion.pressOpacity) {
  const pressed = useSharedValue(0);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - (1 - opacity) * pressed.get(),
    transform: [{ scale: 1 - (1 - scale) * pressed.get() }],
  }));
  return { onPressIn: () => pressed.set(timing(1, DURATION.press)), onPressOut: () => pressed.set(timing(0, DURATION.press)), style };
}

// Bouton à icône, avec l'effet d'appui commun.
export function IconButton({ onPress, onLongPress, label, disabled, hitSlop = 12, style, children }: IconButtonProps) {
  const feedback = usePressFeedback();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={feedback.onPressIn}
      onPressOut={feedback.onPressOut}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Reanimated.View style={[style, feedback.style]}>{children}</Reanimated.View>
    </Pressable>
  );
}

// notes : l'avatar de la conversation « Notes à moi-même » (un carnet à la place de la silhouette).
export function Avatar({ uri, size = 44, notes }: { uri?: string | null; size?: number; notes?: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const shape = { width: size, height: size, borderRadius: size / 2 };
  // Photo de profil chiffrée sur le disque (lot 2.3) : affichée depuis sa copie déchiffrée.
  const source = useMediaUri(uri, { scope: 'app' });
  if (source) return <Image source={{ uri: source }} style={shape} resizeMode="cover" />;
  return (
    <View style={[styles.avatarEmpty, shape]}>
      {notes ? <NotebookPen size={size * 0.46} color={colors.text} strokeWidth={1.75} /> : <User size={size * 0.46} color={colors.text} strokeWidth={1.75} />}
    </View>
  );
}

// Le sous-titre de l'en-tête (« Connecté », « écrit… ») change en fondu.
function FadingSubtitle({ text, color }: { text: string; color?: string }) {
  const styles = useStyles();
  const opacity = useSharedValue(1);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    opacity.set(0);
    opacity.set(withTiming(1, { duration: motion.small, easing: EASE }));
  }, [text, opacity]);
  return (
    <Reanimated.Text style={[styles.headerSubtitle, !!color && { color }, fade]} numberOfLines={1}>
      {text}
    </Reanimated.Text>
  );
}

export function Header({ title, subtitle, subtitleColor, onBack, action, avatar, onTitlePress, titleAccessory }: HeaderProps) {
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
          {!!subtitle && <FadingSubtitle text={subtitle} color={subtitleColor} />}
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
  // Maintien : la ligne rétrécit doucement et un fond se remplit de gauche à droite pendant ce délai ; le
  // maintien aboutit à la fin (onLongPress), relâcher avant annule tout.
  holdMs?: number;
  children: ReactNode;
};

// Une ligne qu'on touche (liste, menu) : le fond d'appui suit ses coins arrondis au lieu de déborder
// en rectangle sur les bords du conteneur.
export function RowPressable({ onPress, onLongPress, style, label, holdMs, children }: RowPressableProps) {
  const styles = useStyles();
  // Une ligne se touche souvent : l'effet reste presque imperceptible (0,99), le fond fait le reste.
  const feedback = usePressFeedback(0.99, 1);
  const hold = useSharedValue(0);
  // Le maintien est l'animation de la sélection elle-même : la ligne devient peu à peu la carte (fond qui
  // apparaît, coins qui s'arrondissent, léger rétrécissement), sur exactement la durée du maintien.
  const holdStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 - 0.03 * hold.get() }] }));
  const fillStyle = useAnimatedStyle(() => ({ opacity: hold.get(), borderRadius: 12 + 8 * hold.get() }));
  return (
    <Reanimated.View style={[feedback.style, holdMs ? holdStyle : null]}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={holdMs}
        onPressIn={() => {
          feedback.onPressIn();
          if (holdMs) hold.set(withTiming(1, { duration: holdMs, easing: Easing.linear }));
        }}
        onPressOut={() => {
          feedback.onPressOut();
          if (holdMs) hold.set(withTiming(0, { duration: 160, easing: Easing.out(Easing.quad) }));
        }}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.rowPressable, style, pressed && !holdMs && styles.rowPressed]}
      >
        {holdMs ? <Reanimated.View pointerEvents="none" style={[styles.holdFill, fillStyle]} /> : null}
        {children}
      </Pressable>
    </Reanimated.View>
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
  const foreground = primary ? colors.onSignature : colors.text;
  const feedback = usePressFeedback();
  return (
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="button" accessibilityLabel={label}>
      <Reanimated.View style={[styles.button, primary ? styles.primary : styles.secondary, feedback.style]}>
        <Icon size={20} color={foreground} strokeWidth={1.75} />
        <Text style={[styles.buttonLabel, { color: foreground }]}>{label}</Text>
      </Reanimated.View>
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
  // Le fond du maintien : il se remplit de gauche à droite derrière la ligne.
  holdFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
    backgroundColor: colors.signature,
  },
  secondary: {
    backgroundColor: colors.surface,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
}));
