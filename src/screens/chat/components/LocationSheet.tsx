import { useEffect, useState } from 'react';
import { PermissionsAndroid, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Reanimated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming, Easing, type EntryExitAnimationFunction } from 'react-native-reanimated';

import { lastKnownLocation } from '../../../../modules/pear-native';
import { LOCATION_DURATIONS } from '../../../chat/location';
import { useNavigationBarHeight, usePressFeedback } from '../../../components/ui';
import { haptics } from '../../../haptics';
import { t } from '../../../i18n';
import { log } from '../../../log';
import { MiniMap } from '../../../map/MiniMap';
import { savedRegion } from '../../../map/offlineMap';
import { insideRegion } from '../../../map/region';
import { DURATION, exitFade, timing } from '../../../motion';
import { useBackInterceptor } from '../../../navigation/backInterceptors';
import { createStyles, radius, spacing, useColors } from '../../../theme';

// Le choix : une durée (en secondes), « tant que l'app est ouverte », ou seulement la position actuelle.
export type ShareChoice = { seconds: number; open: boolean; once?: boolean };

const CHOICES: { id: string; choice: ShareChoice; label: string; sub: string }[] = [
  { id: '15', choice: { seconds: LOCATION_DURATIONS[0], open: false }, label: t('position.min15'), sub: t('position.sArrete') },
  { id: '60', choice: { seconds: LOCATION_DURATIONS[1], open: false }, label: t('position.h1'), sub: t('position.sArrete') },
  { id: '480', choice: { seconds: LOCATION_DURATIONS[2], open: false }, label: t('position.h8'), sub: t('position.uneJournee') },
  { id: 'open', choice: { seconds: 0, open: true }, label: t('position.tantQueOuverte'), sub: t('position.tantQueOuverteAide') },
];

// La feuille monte du bas (340 ms, sans rebond), le voile apparaît en fondu.
const SHEET_START = 640;
const sheetIn: EntryExitAnimationFunction = () => {
  'worklet';
  const config = { duration: 340, easing: Easing.bezier(0.32, 0.72, 0, 1), reduceMotion: ReduceMotion.System };
  return { initialValues: { transform: [{ translateY: SHEET_START }] }, animations: { transform: [{ translateY: withTiming(0, config) }] } };
};
const scrimIn: EntryExitAnimationFunction = () => {
  'worklet';
  return { initialValues: { opacity: 0 }, animations: { opacity: withTiming(1, { duration: 220, reduceMotion: ReduceMotion.System }) } };
};

// Une ligne de durée : le rond se remplit (bordure épaisse en couleur signature) quand elle est choisie.
function ChoiceRow({ label, sub, selected, onPress }: { label: string; sub: string; selected: boolean; onPress: () => void }) {
  const styles = useStyles();
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.set(timing(selected ? 1 : 0, DURATION.small));
  }, [selected, on]);
  const ring = useAnimatedStyle(() => ({ borderWidth: 2 + 5 * on.get() }));
  const back = useAnimatedStyle(() => ({ opacity: on.get() }));
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${label}, ${sub}`} style={styles.choice}>
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.choiceOn, back]} />
      <View style={styles.flex}>
        <Text style={styles.choiceLabel}>{label}</Text>
        <Text style={styles.choiceSub}>{sub}</Text>
      </View>
      <Reanimated.View style={[styles.radio, selected && styles.radioOn, ring]} />
    </Pressable>
  );
}

type Props = { name: string; onShare: (choice: ShareChoice) => void; onClose: () => void };

// « Partager ma position » (planche Position) : la mini-carte de l'endroit où je suis (si la zone est
// téléchargée), le choix de la durée, puis « Partager en direct ».
export function LocationSheet({ name, onShare, onClose }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const bottom = useNavigationBarHeight();
  const window = useWindowDimensions();
  const feedback = usePressFeedback();
  useBackInterceptor(true, onClose);
  const [chosen, setChosen] = useState('60');
  const [me, setMe] = useState<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION)
      .then((granted) => granted && setMe(lastKnownLocation()))
      .catch((e) => log.warn('position', e));
  }, []);
  const region = savedRegion();
  const mapped = !!me && !!region && insideRegion(region.bounds, me);
  const pick = (id: string) => {
    if (id === chosen) return;
    haptics.select();
    setChosen(id);
  };
  const share = () => {
    const choice = CHOICES.find(({ id }) => id === chosen)?.choice;
    if (choice) onShare(choice);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Reanimated.View entering={scrimIn} exiting={exitFade(DURATION.small)} style={[StyleSheet.absoluteFill, styles.scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t('commun.fermer')} />
      </Reanimated.View>
      <Reanimated.View entering={sheetIn} exiting={exitFade(DURATION.small)} style={[styles.sheet, { paddingBottom: bottom + spacing.lg }]} accessibilityViewIsModal>
        <View style={styles.handle} />
        <Text style={styles.title}>{t('position.partager')}</Text>
        {mapped && me && (
          <View style={styles.map}>
            <MiniMap latitude={me.latitude} longitude={me.longitude} width={window.width - 36} height={130} live />
          </View>
        )}
        <View style={styles.choices} accessibilityRole="radiogroup">
          {CHOICES.map(({ id, label, sub }) => (
            <ChoiceRow key={id} label={label} sub={sub} selected={id === chosen} onPress={() => pick(id)} />
          ))}
        </View>
        <Pressable onPress={share} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="button">
          <Reanimated.View style={[styles.primary, feedback.style]}>
            <Text style={styles.primaryLabel}>{t('position.partagerDirect')}</Text>
          </Reanimated.View>
        </Pressable>
        <Pressable onPress={() => onShare({ seconds: 0, open: false, once: true })} accessibilityRole="button" hitSlop={6} style={({ pressed }) => [styles.once, pressed && styles.oncePressed]}>
          <Text style={styles.onceLabel}>{t('position.seulementActuelle')}</Text>
        </Pressable>
        <Text style={styles.note}>{t('position.seulVoit', { nom: name })}</Text>
      </Reanimated.View>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  flex: { flex: 1 },
  scrim: { backgroundColor: colors.overlay },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 10,
    paddingHorizontal: 18,
    gap: 14,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.elevated,
  },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  map: { height: 130, borderRadius: 18, overflow: 'hidden' },
  choices: { gap: 8 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  choiceOn: { backgroundColor: colors.signature },
  choiceLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  choiceSub: { fontSize: 12, marginTop: 2, color: colors.textMuted },
  radio: { width: 22, height: 22, borderRadius: radius.full, borderColor: colors.border },
  radioOn: { borderColor: colors.signatureStrong },
  primary: { height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text },
  primaryLabel: { fontSize: 16, fontWeight: '600', color: colors.background },
  note: { textAlign: 'center', fontSize: 12, color: colors.textMuted },
  once: { alignSelf: 'center', marginTop: -4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.full },
  oncePressed: { backgroundColor: colors.surface },
  onceLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
}));
