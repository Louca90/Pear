import { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, PanResponder, Pressable, Text, View, useWindowDimensions } from 'react-native';
import Reanimated, { Easing, interpolate, interpolateColor, useAnimatedProps, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ArrowUp } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';

import { getContactProfile } from '../chat/database';
import { SearchField } from './SearchField';
import { Avatar, useNavigationBarHeight } from './ui';
import { dateLocale, t } from '../i18n';
import { Contact } from '../storage';
import { createStyles, radius, spacing, useColors } from '../theme';

const OPEN_MS = 260;
const CLOSE_MS = 200;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const CHECK_MS = 220;
// Tirée vers le bas au-delà de cette distance (ou lâchée vite), la feuille finit de se fermer.
const DRAG_CLOSE_DISTANCE = 110;
const DRAG_CLOSE_SPEED = 0.8;
const TAP_SLOP = 6;
// Longueur du tracé de la coche (dans une grille de 24) : il se dessine de 0 à cette longueur.
const CHECK_LENGTH = 16;
const AnimatedPath = Reanimated.createAnimatedComponent(Path);

// La case d'un contact : le cercle se remplit de la couleur d'accent en fondu et la coche se dessine
// d'un trait, sans changement de taille. Décocher fait l'inverse.
function CheckBox({ checked }: { checked: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const on = useSharedValue(checked ? 1 : 0);
  useEffect(() => {
    on.set(withTiming(checked ? 1 : 0, { duration: CHECK_MS, easing: Easing.out(Easing.cubic) }));
  }, [checked, on]);
  const { elevated, signatureStrong, border } = colors;
  const boxStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.get(), [0, 1], [elevated, signatureStrong]),
    borderColor: interpolateColor(on.get(), [0, 1], [border, signatureStrong]),
  }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: interpolate(on.get(), [0.25, 1], [CHECK_LENGTH * 1.5, 0], 'clamp') }));
  return (
    <Reanimated.View style={[styles.box, boxStyle]}>
      <Svg width={16} height={16} viewBox="0 0 24 24">
        <AnimatedPath
          d="M5 12.5l4.5 4.5L19 7.5"
          fill="none"
          stroke={colors.onSignature}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={`${CHECK_LENGTH * 1.5} ${CHECK_LENGTH * 1.5}`}
          animatedProps={checkProps}
        />
      </Svg>
    </Reanimated.View>
  );
}

// Feuille de choix de contacts (transfert, envoi depuis la caméra) : monte du bas, recherche, un ou
// plusieurs contacts, puis « Envoyer ». Les contacts en attente d'acceptation ne sont pas proposés.
// La barre du haut se touche pour fermer, ou se tire vers le bas : au-delà d'un seuil la feuille
// finit de se fermer, sinon elle remonte. Couleurs du thème (clair ou sombre).
type Props = { title: string; contacts: Contact[]; onSend: (keys: string[]) => void; onClose: () => void };

export function ContactPickerSheet({ title, contacts, onSend, onClose }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const bottom = useNavigationBarHeight();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const closing = useRef(false);
  // Hauteur réelle de la feuille : fermée, elle descend entièrement sous l'écran.
  const [sheetHeight, setSheetHeight] = useState(height);

  useEffect(() => {
    progress.set(withTiming(1, { duration: OPEN_MS, easing: EASING }));
  }, [progress]);

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    progress.set(withTiming(0, { duration: CLOSE_MS, easing: EASING }));
    setTimeout(() => {
      onClose();
      then?.();
    }, CLOSE_MS);
  };
  const latestClose = useRef(close);
  latestClose.current = close;

  const handlePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > TAP_SLOP,
      onPanResponderMove: (_event, gesture) => drag.set(Math.max(0, gesture.dy)),
      onPanResponderRelease: (_event, gesture) => {
        if (Math.abs(gesture.dy) < TAP_SLOP || gesture.dy > DRAG_CLOSE_DISTANCE || gesture.vy > DRAG_CLOSE_SPEED) latestClose.current();
        else drag.set(withTiming(0, { duration: CLOSE_MS, easing: EASING }));
      },
      onPanResponderTerminate: () => drag.set(withTiming(0, { duration: CLOSE_MS, easing: EASING })),
    }),
  ).current;

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (sheetHeight + spacing.lg) * (1 - progress.get()) + drag.get() }] }));

  const search = query.trim().toLocaleLowerCase(dateLocale());
  const shown = contacts
    .filter((contact) => !contact.pending)
    .filter((contact) => !search || contact.name.toLocaleLowerCase(dateLocale()).includes(search))
    .sort((a, b) => a.name.localeCompare(b.name, dateLocale()));

  const toggle = (key: string) => setSelected((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => close()} statusBarTranslucent navigationBarTranslucent>
      <Reanimated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={styles.flex} onPress={() => close()} accessibilityLabel={t('commun.fermer')} />
      </Reanimated.View>
      <Reanimated.View
        style={[styles.sheet, { maxHeight: height * 0.75, paddingBottom: bottom + spacing.md }, sheetStyle]}
        onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
      >
        <View {...handlePan.panHandlers} style={styles.header} accessibilityRole="button" accessibilityLabel={t('commun.fermer')}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>
        </View>
        <SearchField value={query} onChange={setQuery} placeholder={t('liste.rechercher')} />
        <FlatList
          data={shown}
          keyExtractor={(contact) => contact.publicKey}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          style={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>{t('transfert.aucun')}</Text>}
          renderItem={({ item }) => (
            <Pressable onPress={() => toggle(item.publicKey)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityState={{ checked: selected.includes(item.publicKey) }}>
              <Avatar uri={getContactProfile(item.publicKey).photo_uri} size={40} />
              <View style={styles.nameLine}>
                <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              </View>
              <CheckBox checked={selected.includes(item.publicKey)} />
            </Pressable>
          )}
        />
        <Pressable
          disabled={selected.length === 0}
          onPress={() => close(() => onSend(selected))}
          style={({ pressed }) => [styles.send, selected.length === 0 && styles.sendOff, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={[styles.sendLabel, selected.length === 0 && styles.sendLabelOff]}>
            {selected.length > 0 ? t('transfert.envoyerN', { n: selected.length }) : t('transfert.choisir')}
          </Text>
          {selected.length > 0 && <ArrowUp size={18} color={colors.background} strokeWidth={2} />}
        </Pressable>
      </Reanimated.View>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.overlay,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    backgroundColor: colors.elevated,
  },
  header: {
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  nameLine: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    flexShrink: 1,
    fontSize: 16,
    color: colors.text,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    textAlign: 'center',
    fontSize: 15,
    color: colors.textMuted,
    marginVertical: spacing.lg,
  },
  send: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 54,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.text,
  },
  sendOff: {
    backgroundColor: colors.surface,
  },
  sendLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.background,
  },
  sendLabelOff: {
    color: colors.textMuted,
  },
}));
