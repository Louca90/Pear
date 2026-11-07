import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, FlatList, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { ArrowUp } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';

import { getContactProfile } from '../../../chat/database';
import { SearchField } from '../../../components/SearchField';
import { Avatar, useNavigationBarHeight } from '../../../components/ui';
import { t } from '../../../i18n';
import { Contact } from '../../../storage';
import { createStyles, radius, spacing, useColors } from '../../../theme';

const OPEN_MS = 260;
const CLOSE_MS = 200;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const CHECK_MS = 220;
// Longueur du tracé de la coche (dans une grille de 24) : il se dessine de 0 à cette longueur.
const CHECK_LENGTH = 16;
const AnimatedPath = Animated.createAnimatedComponent(Path);

// La case d'un contact : le cercle se remplit de la couleur d'accent en fondu et la coche se dessine
// d'un trait, sans changement de taille. Décocher fait l'inverse.
function CheckBox({ checked }: { checked: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const on = useRef(new Animated.Value(checked ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(on, { toValue: checked ? 1 : 0, duration: CHECK_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [checked, on]);
  return (
    <Animated.View
      style={[
        styles.box,
        {
          backgroundColor: on.interpolate({ inputRange: [0, 1], outputRange: [colors.background, colors.accent] }),
          borderColor: on.interpolate({ inputRange: [0, 1], outputRange: [colors.border, colors.accent] }),
        },
      ]}
    >
      <Svg width={16} height={16} viewBox="0 0 24 24">
        <AnimatedPath
          d="M5 12.5l4.5 4.5L19 7.5"
          fill="none"
          stroke={colors.onAccent}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={`${CHECK_LENGTH * 1.5} ${CHECK_LENGTH * 1.5}`}
          strokeDashoffset={on.interpolate({ inputRange: [0.25, 1], outputRange: [CHECK_LENGTH * 1.5, 0], extrapolate: 'clamp' })}
        />
      </Svg>
    </Animated.View>
  );
}

// Feuille « Transférer à » : monte du bas sur la conversation, recherche, un ou plusieurs contacts,
// puis « Envoyer ». Les contacts en attente d'acceptation ne sont pas proposés.
export function ForwardSheet({ contacts, onSend, onClose }: { contacts: Contact[]; onSend: (keys: string[]) => void; onClose: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const bottom = useNavigationBarHeight();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start();
  }, [progress]);

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: CLOSE_MS, easing: EASING, useNativeDriver: true }).start(() => {
      onClose();
      then?.();
    });
  };

  const search = query.trim().toLocaleLowerCase('fr');
  const shown = contacts
    .filter((contact) => !contact.pending)
    .filter((contact) => !search || contact.name.toLocaleLowerCase('fr').includes(search))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const toggle = (key: string) => setSelected((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => close()} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={styles.flex} onPress={() => close()} accessibilityLabel={t('commun.fermer')} />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          { maxHeight: height * 0.75, paddingBottom: bottom + spacing.md },
          { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [height * 0.6, 0] }) }] },
        ]}
      >
        <View style={styles.handle} />
        <Text style={styles.title}>{t('transfert.titre')}</Text>
        <SearchField value={query} onChange={setQuery} placeholder={t('liste.rechercher')} />
        <FlatList
          data={shown}
          keyExtractor={(contact) => contact.publicKey}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>{t('transfert.aucun')}</Text>}
          renderItem={({ item }) => (
            <Pressable onPress={() => toggle(item.publicKey)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityState={{ checked: selected.includes(item.publicKey) }}>
              <Avatar uri={getContactProfile(item.publicKey).photo_uri} size={40} />
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
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
          {selected.length > 0 && <ArrowUp size={18} color={colors.onAccent} strokeWidth={2} />}
        </Pressable>
      </Animated.View>
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
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.sm,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.background,
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
    fontSize: 18,
    fontWeight: '600',
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
    opacity: 0.6,
  },
  name: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    borderWidth: 1.5,
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
    height: 52,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  sendOff: {
    backgroundColor: colors.surface,
  },
  sendLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.onAccent,
  },
  sendLabelOff: {
    color: colors.textMuted,
  },
}));
