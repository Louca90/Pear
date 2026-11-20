import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LucideIcon } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import Reanimated, { interpolate, ReduceMotion, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';

import { usePressFeedback } from '../components/ui';
import { t } from '../i18n';
import { enterUp, timing } from '../motion';
import { createStyles, radius, readableOn, useColors } from '../theme';
import { PermissionState } from './permissions';

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

// La coche de la pastille (viewBox 24), dessinée trait par trait une fois l'autorisation accordée.
const CHECK = 'M5 12.5 10 17 19 7';
const CHECK_LENGTH = 24;
// Bouton → pastille, puis la coche se dessine juste après.
const SWAP_MS = 220;
const CHECK_MS = 240;
// Entrée en cascade des cartes.
const ENTER_MS = 260;
const STAGGER_MS = 50;
// Petit délai entre la pastille et la coche.
const CHECK_DELAY_MS = 80;
const CARD_GAP = 12;

type Props = {
  index: number;
  icon: LucideIcon;
  title: string;
  why: string;
  state: PermissionState;
  onPress: () => void;
  // Prise en main : un « Plus tard » discret sous le bouton ; la carte s'estompe, rien n'est imposé.
  later?: boolean;
};

// Une carte de l'étape « Quelques autorisations » : icône, titre, à quoi elle sert, et le bouton qui
// lance la vraie demande. Accordée, le bouton devient une pastille signature où une coche se dessine.
export function PermissionCard({ index, icon: Icon, title, why, state, onPress, later }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const granted = state === 'granted';
  const done = useSharedValue(granted ? 1 : 0);
  const draw = useSharedValue(granted ? 1 : 0);
  const feedback = usePressFeedback();
  const [postponed, setPostponed] = useState(false);
  const dim = useSharedValue(1);
  useEffect(() => {
    dim.set(timing(postponed && !granted ? 0.5 : 1, 240));
  }, [postponed, granted, dim]);
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.get() }));

  useEffect(() => {
    done.set(timing(granted ? 1 : 0, SWAP_MS));
    // La coche ne se dessine qu'une fois la pastille posée ; elle s'efface aussitôt si on retire l'accès.
    draw.set(granted ? withDelay(CHECK_DELAY_MS, timing(1, CHECK_MS), ReduceMotion.System) : 0);
  }, [granted, done, draw]);

  const allowStyle = useAnimatedStyle(() => ({
    opacity: 1 - done.get(),
    transform: [{ scale: interpolate(done.get(), [0, 1], [1, 0.9]) }],
  }));
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: done.get(),
    transform: [{ scale: interpolate(done.get(), [0, 1], [0.8, 1]) }],
  }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK_LENGTH * (1 - draw.get()) }));

  return (
    <Reanimated.View entering={enterUp(10, ENTER_MS, index * STAGGER_MS)} style={[styles.card, dimStyle]}>
      <View style={styles.icon}>
        <Icon size={20} color={colors.text} strokeWidth={1.8} />
      </View>
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.why}>{why}</Text>
      </View>
      <View style={styles.action}>
        <Reanimated.View style={[styles.badge, badgeStyle]} pointerEvents="none" accessibilityLabel={t('priseEnMain.autorise', { nom: title })}>
          <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
            <AnimatedPath
              d={CHECK}
              stroke={readableOn(colors.signatureStrong).text}
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${CHECK_LENGTH} ${CHECK_LENGTH}`}
              animatedProps={checkProps}
            />
          </Svg>
        </Reanimated.View>
        <Reanimated.View style={allowStyle} pointerEvents={granted ? 'none' : 'auto'}>
          <Pressable
            onPress={onPress}
            onPressIn={feedback.onPressIn}
            onPressOut={feedback.onPressOut}
            accessibilityRole="button"
            accessibilityLabel={`${t('priseEnMain.autoriser')} : ${title}`}
          >
            <Reanimated.View style={[styles.allow, feedback.style]}>
              <Text style={styles.allowLabel}>{state === 'blocked' ? t('priseEnMain.reglages') : t('priseEnMain.autoriser')}</Text>
            </Reanimated.View>
          </Pressable>
        </Reanimated.View>
        {later && !granted && !postponed && (
          <Pressable onPress={() => setPostponed(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${t('priseEnMain.plusTard')} : ${title}`}>
            <Text style={styles.later}>{t('priseEnMain.plusTard')}</Text>
          </Pressable>
        )}
      </View>
    </Reanimated.View>
  );
}

const useStyles = createStyles((colors) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: CARD_GAP,
    paddingVertical: 10,
    paddingHorizontal: CARD_GAP,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  why: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  action: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 44,
  },
  allow: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allowLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.onAccent,
  },
  later: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textMuted,
  },
  badge: {
    position: 'absolute',
    right: 0,
    width: 44,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.signatureStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
