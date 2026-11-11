import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Clock, Timer } from 'lucide-react-native';

import { Message } from '../../../chat/database';
import { isSelf } from '../../../chat/self';
import { motion, useColors } from '../../../theme';

import { formatTime } from '../format';
import { scheduleLabel } from './ScheduleSheet';
import { useChatStyles } from '../styles';
import { MetaTone } from '../types';
import { t } from '../../../i18n';

const AnimatedPath = Animated.createAnimatedComponent(Path);

// Tracés des coches (ceux de Check et CheckCheck de lucide, sur 24 points).
const SINGLE = 'M20 6 9 17l-5-5';
const FIRST = 'M18 6 7 17l-5-5';
// La seconde coche, tracée du petit côté vers le grand pour qu'elle se dessine comme à la main.
const SECOND = 'M13 16l1.5 1.5L22 10';
const SECOND_LENGTH = 13;
const SIZE = 14;

function Ticks({ double, color, draw }: { double: boolean; color: string; draw?: Animated.Value }) {
  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75 * (24 / SIZE)} strokeLinecap="round" strokeLinejoin="round">
      <Path d={double ? FIRST : SINGLE} />
      {double &&
        (draw ? (
          <AnimatedPath d={SECOND} strokeDasharray={SECOND_LENGTH} strokeDashoffset={draw.interpolate({ inputRange: [0, 1], outputRange: [SECOND_LENGTH, 0] })} />
        ) : (
          <Path d={SECOND} />
        ))}
    </Svg>
  );
}

// 1 coche : pas encore reçu. 2 coches grises : reçu. 2 coches poire : lu (conversation ouverte par l'autre).
// Au passage à « lu », la seconde coche se dessine (180 ms), puis les deux prennent la couleur poire en
// fondu (180 ms). Au passage à « reçu », seule la seconde coche se dessine. Rien d'autre ne bouge.
export function StatusTicks({ status, tone }: { status: Message['status']; tone: MetaTone }) {
  const colors = useColors();
  const previous = useRef(status);
  const draw = useRef(new Animated.Value(1)).current;
  const tint = useRef(new Animated.Value(status === 'read' ? 1 : 0)).current;

  useEffect(() => {
    const from = previous.current;
    previous.current = status;
    if (from === status) return;
    const read = status === 'read';
    const steps: Animated.CompositeAnimation[] = [];
    // La seconde coche se dessine quand elle apparaît (envoyé → reçu ou lu), et se redessine au passage
    // de reçu à lu, avant de changer de couleur. Le tracé SVG ne passe pas par le fil natif.
    const appears = status === 'delivered' && from !== 'read';
    if (appears || (read && from !== 'read')) {
      draw.setValue(0);
      steps.push(Animated.timing(draw, { toValue: 1, duration: motion.small, easing: motion.easing, useNativeDriver: false }));
    }
    tint.setValue(0);
    if (read) steps.push(Animated.timing(tint, { toValue: 1, duration: motion.small, easing: motion.easing, useNativeDriver: true }));
    Animated.sequence(steps).start();
  }, [status, draw, tint]);

  if (status === 'scheduled') return <Clock size={SIZE} color={tone.muted} strokeWidth={1.75} accessibilityLabel={t('programme.programme')} />;
  const double = status === 'delivered' || status === 'read';
  const label = status === 'read' ? t('chat.lu') : status === 'delivered' ? t('chat.recu') : t('chat.pasRecu');
  return (
    <View accessible accessibilityLabel={label}>
      <Ticks double={double} color={tone.muted} draw={draw} />
      {status === 'read' && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: tint }]}>
          <Ticks double color={colors.signatureStrong} />
        </Animated.View>
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
