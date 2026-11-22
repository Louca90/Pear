import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Reanimated, { cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Pause } from 'lucide-react-native';

import { Pear } from '../../components/Pear';
import { t } from '../../i18n';
import { EASE } from '../../motion';
import { bubblePalette, createStyles, motion, radius, spacing, useColors } from '../../theme';
import { PhoneFrame } from './PhoneFrame';

// Les démos des pages « Quoi de neuf » de la 1.9 (release-notes.json, clé « 1.9.0 »). Courbes douces,
// sans rebond ; avec « supprimer les animations », chacune montre directement son état final.

// Fait avancer un compteur toutes les `ms`, en boucle sur `count` étapes.
function useStep(count: number, ms: number) {
  const [step, setStep] = useState(motion.reduced ? count - 1 : 0);
  useEffect(() => {
    if (motion.reduced) return;
    const timer = setInterval(() => setStep((current) => (current + 1) % count), ms);
    return () => clearInterval(timer);
  }, [count, ms]);
  return step;
}

const FILL = [0, 0.2, 0.45, 0.7, 0.9, 1, 1, 1];

// Transfert : la poire se remplit au pourcentage du fichier, puis passe à « Vérifié ».
function TransferDemo() {
  const colors = useColors();
  const styles = useStyles();
  const step = useStep(FILL.length, 520);
  const progress = FILL[step];
  const done = step >= FILL.length - 2;
  return (
    <PhoneFrame>
      <View style={styles.centered}>
        <Pear height={70} color={colors.text} state={done ? 'leaf' : 'ripening'} progress={progress} leafColor={colors.signatureStrong} />
        <View style={[styles.tag, done && { backgroundColor: colors.signature }]}>
          <Text style={[styles.tagText, done && { color: colors.onSignature }]}>
            {done ? t('nouveautes.transfertVerifie') : t('nouveautes.transfertEnvoi', { pourcent: Math.round(progress * 100) })}
          </Text>
        </View>
      </View>
    </PhoneFrame>
  );
}

// Partage d'écran : l'écran du contact, qu'on agrandit en pinçant, puis qui revient.
function ScreenShareDemo() {
  const styles = useStyles();
  const zoom = useSharedValue(motion.reduced ? 1 : 0);
  useEffect(() => {
    if (motion.reduced) return;
    const ease = (duration: number) => ({ duration, easing: EASE });
    zoom.set(withRepeat(withSequence(withDelay(700, withTiming(1, ease(600))), withDelay(1300, withTiming(0, ease(500)))), -1));
    return () => cancelAnimation(zoom);
  }, [zoom]);
  const screenStyle = useAnimatedStyle(() => ({ transform: [{ translateX: 22 * zoom.get() }, { translateY: 26 * zoom.get() }, { scale: 1 + 0.9 * zoom.get() }] }));
  const fingerA = useAnimatedStyle(() => ({ transform: [{ translateX: -16 * zoom.get() }, { translateY: 16 * zoom.get() }] }));
  const fingerB = useAnimatedStyle(() => ({ transform: [{ translateX: 16 * zoom.get() }, { translateY: -16 * zoom.get() }] }));
  return (
    <PhoneFrame>
      <View style={styles.shareStage}>
        <Reanimated.View style={[styles.shareScreen, screenStyle]}>
          <View style={styles.line} />
          <View style={[styles.line, styles.lineShort]} />
          <View style={styles.block} />
          <View style={[styles.line, styles.lineShort]} />
        </Reanimated.View>
        <Reanimated.View style={[styles.finger, fingerA]} />
        <Reanimated.View style={[styles.finger, fingerB]} />
      </View>
    </PhoneFrame>
  );
}

const WAVE = [8, 14, 22, 28, 18, 24, 30, 20, 12, 26, 30, 22, 16, 24, 14, 20, 10, 6];

// Vocal : l'onde du message, qu'on met en pause et qu'on réécoute avant d'envoyer.
function VoiceDemo() {
  const colors = useColors();
  const styles = useStyles();
  const played = useStep(WAVE.length + 4, 160);
  return (
    <PhoneFrame>
      <View style={styles.voice}>
        <View style={styles.wave}>
          {WAVE.map((height, index) => (
            <View key={index} style={[styles.bar, { height, backgroundColor: index < played ? colors.text : colors.textMuted }]} />
          ))}
        </View>
        <View style={styles.voiceButton}>
          <Pause size={16} color={colors.onSignature} fill={colors.onSignature} strokeWidth={2} />
        </View>
      </View>
    </PhoneFrame>
  );
}

// Statut d'envoi : « Envoi… » tant que le téléphone du contact n'a rien reçu, puis « Distribué ».
function SendStatusDemo() {
  const colors = useColors();
  const styles = useStyles();
  const step = useStep(3, 1600);
  const palette = bubblePalette(colors.bubbleMine);
  const label = [t('attente.envoi'), t('attente.contactHorsLigne'), t('nouveautes.statutDistribue')][step];
  return (
    <PhoneFrame>
      <View style={[styles.bubble, { backgroundColor: palette.background }]}>
        <Text style={{ color: palette.text, fontSize: 14 }}>{t('nouveautes.statutExemple')}</Text>
      </View>
      <Text key={step} style={[styles.status, step === 2 && { color: colors.signatureStrong }]}>
        {label}
      </Text>
    </PhoneFrame>
  );
}

export const V19_DEMOS = { transfert: TransferDemo, partageEcran: ScreenShareDemo, vocal: VoiceDemo, statutEnvoi: SendStatusDemo };

const useStyles = createStyles((colors) => ({
  centered: {
    alignItems: 'center',
    gap: spacing.md,
  },
  tag: {
    paddingHorizontal: 12,
    height: 26,
    borderRadius: radius.full,
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  shareStage: {
    height: 130,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  shareScreen: {
    width: 86,
    height: 120,
    borderRadius: 10,
    padding: 10,
    gap: 6,
    backgroundColor: colors.surface,
  },
  finger: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.text,
    backgroundColor: colors.overlay,
  },
  line: {
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.border,
  },
  lineShort: {
    width: '60%',
  },
  block: {
    height: 34,
    borderRadius: 6,
    backgroundColor: colors.signature,
  },
  voice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
    paddingLeft: 14,
    paddingRight: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  wave: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  bar: {
    width: 3,
    borderRadius: radius.full,
  },
  voiceButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.signatureStrong,
  },
  bubble: {
    alignSelf: 'flex-end',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  status: {
    alignSelf: 'flex-end',
    marginTop: 4,
    fontSize: 11,
    color: colors.textMuted,
  },
}));
