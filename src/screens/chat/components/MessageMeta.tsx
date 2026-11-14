import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, { useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { Clock, Timer } from 'lucide-react-native';

import { Message } from '../../../chat/database';
import { isSelf } from '../../../chat/self';
import { motion, useColors } from '../../../theme';
import { EASE } from '../../../motion';

import { formatTime } from '../format';
import { scheduleLabel } from './ScheduleSheet';
import { useChatStyles } from '../styles';
import { MetaTone } from '../types';
import { t } from '../../../i18n';

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

// Tracés des coches (ceux de Check et CheckCheck de lucide, sur 24 points).
const SINGLE = 'M20 6 9 17l-5-5';
const FIRST = 'M18 6 7 17l-5-5';
// La seconde coche, tracée du petit côté vers le grand pour qu'elle se dessine comme à la main.
const SECOND = 'M13 16l1.5 1.5L22 10';
const SECOND_LENGTH = 13;
const SIZE = 14;

function Ticks({ double, color, draw }: { double: boolean; color: string; draw?: SharedValue<number> }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75 * (24 / SIZE)} strokeLinecap="round" strokeLinejoin="round">
      <Path d={double ? FIRST : SINGLE} />
      {double &&
        (draw ? (
          <DrawnPath draw={draw} />
        ) : (
          <Path d={SECOND} />
        ))}
    </Svg>
  );
}

// La seconde coche, tracée sur le fil de l'interface.
function DrawnPath({ draw }: { draw: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: SECOND_LENGTH * (1 - draw.get()) }));
  return <AnimatedPath d={SECOND} strokeDasharray={SECOND_LENGTH} animatedProps={props} />;
}

// 1 coche : pas encore reçu. 2 coches grises : reçu. 2 coches poire : lu (conversation ouverte par l'autre).
// Au passage à « lu », la seconde coche se dessine (180 ms), puis les deux prennent la couleur poire en
// fondu (180 ms). Au passage à « reçu », seule la seconde coche se dessine. Rien d'autre ne bouge.
export function StatusTicks({ status, tone }: { status: Message['status']; tone: MetaTone }) {
  const colors = useColors();
  const previous = useRef(status);
  const draw = useSharedValue(1);
  const tint = useSharedValue(status === 'read' ? 1 : 0);
  const tintStyle = useAnimatedStyle(() => ({ opacity: tint.get() }));

  useEffect(() => {
    const from = previous.current;
    previous.current = status;
    if (from === status) return;
    const read = status === 'read';
    // La seconde coche se dessine quand elle apparaît (envoyé → reçu ou lu), et se redessine au passage
    // de reçu à lu, avant de changer de couleur.
    const appears = status === 'delivered' && from !== 'read';
    const drawn = appears || (read && from !== 'read');
    if (drawn) {
      draw.set(0);
      draw.set(withTiming(1, { duration: motion.small, easing: EASE }));
    }
    tint.set(0);
    if (read) tint.set(withDelay(drawn ? motion.small : 0, withTiming(1, { duration: motion.small, easing: EASE })));
  }, [status, draw, tint]);

  if (status === 'scheduled') return <Clock size={SIZE} color={tone.muted} strokeWidth={1.75} accessibilityLabel={t('programme.programme')} />;
  const double = status === 'delivered' || status === 'read';
  const label = status === 'read' ? t('chat.lu') : status === 'delivered' ? t('chat.recu') : t('chat.pasRecu');
  return (
    <View accessible accessibilityLabel={label}>
      <Ticks double={double} color={tone.muted} draw={draw} />
      {status === 'read' && (
        <Reanimated.View style={[StyleSheet.absoluteFill, tintStyle]}>
          <Ticks double color={colors.signatureStrong} />
        </Reanimated.View>
      )}
    </View>
  );
}

export function MessageMeta({ message, tone, pill }: { message: Message; tone: MetaTone; pill?: boolean }) {
  const styles = useStyles();
  return (
    <View style={[styles.meta, pill && styles.metaPill]}>
      {message.edited === 1 && <Text style={[styles.time, { color: tone.muted }]}>{t('chat.modifie')}</Text>}
      {/* Message éphémère : il s'effacera tout seul. */}
      {!!message.expires_at && <Timer size={11} color={tone.muted} strokeWidth={2} accessibilityLabel={t('ephemere.message')} />}
      <Text style={[styles.time, { color: tone.muted }]}>
        {message.status === 'scheduled' && message.scheduled_at ? t('programme.prevu', { quand: scheduleLabel(message.scheduled_at) }) : formatTime(message.created_at)}
      </Text>
      {/* Notes à moi-même : rien n'est envoyé, donc pas de coches. */}
      {message.mine === 1 && !isSelf(message.contact) && message.kind !== 'location' && <StatusTicks status={message.status} tone={tone} />}
    </View>
  );
}

const localStyles = StyleSheet.create({
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 2,
  },
});

const useStyles = () => useChatStyles(localStyles);
