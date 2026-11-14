import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import Reanimated, { Easing, FadeIn, FadeOut, LinearTransition, ReduceMotion, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { ArrowDown } from 'lucide-react-native';

import { haptics } from '../../../haptics';
import { t } from '../../../i18n';
import { createStyles, radius, spacing, useColors } from '../../../theme';

const CURVE = Easing.bezier(0.2, 0.8, 0.2, 1);
const timing = (duration: number) => ({ duration, easing: CURVE, reduceMotion: ReduceMotion.System });
// La pastille s'élargit (ou se resserre) en douceur quand des messages arrivent.
const RESIZE = LinearTransition.duration(240).easing(CURVE).reduceMotion(ReduceMotion.System);

// Revenir en bas de la conversation, en bas à droite au-dessus de la saisie. Remonté d'environ un
// écran : un rond avec une flèche sort en grandissant. Des messages arrivent pendant qu'on lit plus
// haut : il s'élargit en pastille verte avec leur nombre. Un appui : la flèche plonge, la liste
// redescend.
export function NewMessagesButton({ count, far, onPress }: { count: number; far: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const visible = far || count > 0;
  const appear = useSharedValue(visible ? 1 : 0);
  const dive = useSharedValue(0);
  // Le nombre reste affiché le temps que la pastille se resserre.
  const [shown, setShown] = useState(count);

  useEffect(() => {
    if (count > 0) setShown(count);
  }, [count]);
  useEffect(() => {
    appear.set(withTiming(visible ? 1 : 0, timing(visible ? 260 : 180)));
  }, [visible, appear]);

  const wrap = useAnimatedStyle(() => {
    const amount = appear.get();
    return { opacity: amount, transform: [{ translateY: 12 * (1 - amount) }, { scale: 0.6 + 0.4 * amount }] };
  });
  const arrow = useAnimatedStyle(() => ({ transform: [{ translateY: dive.get() }] }));

  const press = () => {
    haptics.select();
    dive.set(withSequence(withTiming(5, timing(120)), withTiming(0, timing(200))));
    onPress();
  };

  const fresh = count > 0;
  const label = shown === 1 ? t('chat.nouveauMessage') : t('chat.nouveauxMessages', { n: shown });

  return (
    <Reanimated.View pointerEvents={visible ? 'auto' : 'none'} style={[styles.wrap, wrap]}>
      <Reanimated.View layout={RESIZE} style={[styles.button, fresh ? styles.buttonFresh : styles.buttonCalm]}>
        <Pressable onPress={press} hitSlop={6} accessibilityRole="button" accessibilityLabel={fresh ? label : t('chat.revenirEnBas')} style={({ pressed }) => [styles.press, pressed && styles.pressed]}>
          <Reanimated.View style={arrow}>
            <ArrowDown size={20} color={fresh ? colors.onSignature : colors.text} strokeWidth={2.2} />
          </Reanimated.View>
          {fresh && (
            <Reanimated.View entering={FadeIn.duration(200).delay(80)} exiting={FadeOut.duration(120)}>
              <Text style={styles.label} numberOfLines={1}>
                {label}
              </Text>
            </Reanimated.View>
          )}
        </Pressable>
      </Reanimated.View>
    </Reanimated.View>
  );
}

const useStyles = createStyles((colors) => ({
  wrap: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    transformOrigin: 'right bottom',
  },
  button: {
    minWidth: 44,
    height: 44,
    borderRadius: radius.full,
    overflow: 'hidden',
    boxShadow: `0px 6px 18px ${colors.shadow}`,
  },
  buttonCalm: {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonFresh: {
    backgroundColor: colors.signature,
  },
  press: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: '100%',
    minWidth: 44,
    paddingHorizontal: 11,
  },
  pressed: { opacity: 0.85 },
  label: {
    paddingRight: 4,
    fontSize: 14,
    fontWeight: '700',
    color: colors.onSignature,
  },
}));
