import { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Reanimated, { ReduceMotion, withDelay, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';

import { Pear } from '../components/Pear';
import { useNavigationBarHeight } from '../components/ui';
import { EASE } from '../motion';
import { createStyles, radius, spacing, useColors } from '../theme';
import { fetchSummary, UpdatedInfo } from './updated';
import { t } from '../i18n';

function config(duration: number) {
  'worklet';
  return { duration, easing: EASE, reduceMotion: ReduceMotion.System };
}

const scrimIn: EntryExitAnimationFunction = () => {
  'worklet';
  return { initialValues: { opacity: 0 }, animations: { opacity: withTiming(1, config(220)) } };
};
// La carte monte de 30 points d'une échelle de 0,96 à 1 ; le texte suit, un peu après.
const cardIn: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: 30 }, { scale: 0.96 }] },
    animations: { opacity: withTiming(1, config(320)), transform: [{ translateY: withTiming(0, config(320)) }, { scale: withTiming(1, config(320)) }] },
  };
};
function textIn(delay: number): EntryExitAnimationFunction {
  return () => {
    'worklet';
    return { initialValues: { opacity: 0, transform: [{ translateY: 8 }] }, animations: { opacity: withDelay(delay, withTiming(1, config(260))), transform: [{ translateY: withDelay(delay, withTiming(0, config(260))) }] } };
  };
}

// Une fois, au premier lancement après une mise à jour (planche « Toasts et mise à jour ») : la poire se
// remplit, la version en vert, ce qui change, puis OK. Le retour d'Android fait comme OK.
export function UpdatedPopup({ info, onClose }: { info: UpdatedInfo; onClose: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const bottom = useNavigationBarHeight();
  const [summary, setSummary] = useState(info.summary);
  const [ripe, setRipe] = useState(0);

  useEffect(() => {
    if (info.summary === null) fetchSummary().then(setSummary);
    const timer = setTimeout(() => setRipe(1), 200);
    return () => clearTimeout(timer);
  }, [info.summary]);

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Reanimated.View entering={scrimIn} style={[StyleSheet.absoluteFill, styles.scrim]} />
      <View style={[styles.center, { paddingBottom: bottom }]}>
        <Reanimated.View entering={cardIn} style={styles.card} accessibilityViewIsModal>
          <Pear height={82} color={colors.text} state="ripening" progress={ripe} />
          <Reanimated.Text entering={textIn(160)} style={styles.kicker}>
            {`${t('commun.version')} ${info.version}`.toUpperCase()}
          </Reanimated.Text>
          <Reanimated.Text entering={textIn(200)} style={styles.title}>
            {t('maj.aJour')}
          </Reanimated.Text>
          {summary && (
            <Reanimated.View entering={textIn(240)} style={styles.summaryBox}>
              <ScrollView style={styles.summary}>
                <Text style={styles.summaryText}>{summary}</Text>
              </ScrollView>
            </Reanimated.View>
          )}
          <View style={styles.buttons}>
            <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
              <Text style={styles.primaryLabel}>OK</Text>
            </Pressable>
            <Pressable onPress={() => Linking.openURL(info.pageUrl)} accessibilityRole="link" style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
              <Text style={styles.secondaryLabel}>{t('maj.detailGithub')}</Text>
            </Pressable>
          </View>
        </Reanimated.View>
      </View>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  scrim: { backgroundColor: colors.overlay },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: {
    width: '100%',
    maxWidth: 420,
    alignItems: 'center',
    gap: 10,
    paddingTop: 28,
    paddingHorizontal: 22,
    paddingBottom: 14,
    borderRadius: 30,
    backgroundColor: colors.elevated,
  },
  kicker: { marginTop: 4, fontSize: 12, fontWeight: '600', letterSpacing: 0.8, color: colors.signatureStrong },
  title: { fontSize: 21, fontWeight: '700', textAlign: 'center', color: colors.text },
  summaryBox: { alignSelf: 'stretch' },
  summary: { maxHeight: 180 },
  summaryText: { fontSize: 14, lineHeight: 21, textAlign: 'center', color: colors.textMuted },
  buttons: { alignSelf: 'stretch', gap: spacing.sm, marginTop: 12 },
  primary: { height: 52, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text },
  primaryLabel: { fontSize: 15, fontWeight: '700', color: colors.background },
  secondary: { height: 48, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  secondaryLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
}));
