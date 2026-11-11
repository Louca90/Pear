import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { EllipsisVertical, Search, Timer } from 'lucide-react-native';

import { getContactProfile, getStreakState } from '../../../chat/database';
import { Pear } from '../../../components/Pear';
import { StreakFlame } from '../../../components/StreakFlame';
import { chat } from '../../../chat/manager';
import { isSelf } from '../../../chat/self';
import { Avatar, Header, IconButton } from '../../../components/ui';
import { createStyles, motion, radius, spacing, useColors } from '../../../theme';

import { ROUTE } from '../constants';
import { ephemeralLabel } from '../format';
import { t } from '../../../i18n';

type Props = {
  contactKey: string;
  name: string;
  onBack: () => void;
  onInfo: () => void;
  onCustomize: () => void;
  onSearch: () => void;
  // Minuteur des messages éphémères (secondes), null si le mode est coupé. Un appui ouvre son réglage.
  ephemeral: number | null;
  onEphemeral: () => void;
};

export function ChatHeader({ contactKey, name, onBack, onInfo, onCustomize, onSearch, ephemeral, onEphemeral }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const streak = getStreakState(contactKey);
  const photo = getContactProfile(contactKey).photo_uri;
  const { route, status } = chat.getLink(contactKey);
  const notes = isSelf(contactKey);
  // Mode éphémère : un fin liseré sous l'en-tête, qui apparaît et disparaît en fondu.
  const edge = useRef(new Animated.Value(ephemeral ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(edge, { toValue: ephemeral ? 1 : 0, duration: motion.small, easing: motion.easing, useNativeDriver: true }).start();
  }, [ephemeral, edge]);
  // Connexion en cours avec ce contact : la petite poire en pointillés tourne à côté du nom.
  const connecting = !notes && chat.isOnline() && !chat.isContactOnline(contactKey) && status === 'connecting';
  const subtitle = notes
    ? t('notes.sousTitre')
    : chat.isTyping(contactKey)
    ? t('chat.ecrit')
    : !chat.isOnline()
    ? t('chat.vousHorsLigne')
    : chat.isContactOnline(contactKey)
      ? route ? ROUTE[route] : t('chat.connecte')
      : t('chat.contactHorsLigne');

  return (
    <View style={styles.headerBar}>
      <Header
        title={name}
        subtitle={subtitle}
        onBack={onBack}
        avatar={<Avatar uri={photo} size={36} notes={notes} />}
        onTitlePress={notes ? undefined : onInfo}
        titleAccessory={
          notes ? undefined : (
            <>
              <StreakFlame id={contactKey} count={streak.count} lit={streak.today} size={17} />
              {connecting && (
                <View accessible accessibilityLabel={t('chat.connexionEnCours')}>
                  <Pear height={16} color={colors.textMuted} state="searching" />
                </View>
              )}
              {!!ephemeral && (
                <Pressable onPress={onEphemeral} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('ephemere.minuteur', { duree: ephemeralLabel(ephemeral) })} style={styles.timer}>
                  <Timer size={13} color={colors.text} strokeWidth={2} />
                  <Text style={styles.timerLabel}>{ephemeralLabel(ephemeral, true)}</Text>
                </Pressable>
              )}
            </>
          )
        }
        action={
          <View style={styles.headerActions}>
            <IconButton onPress={onSearch} label={t('recherche.dansConversation')}>
              <Search size={22} color={colors.text} strokeWidth={1.75} />
            </IconButton>
            {!notes && (
              <IconButton onPress={onCustomize} label={t('chat.personnaliser')}>
                <EllipsisVertical size={24} color={colors.text} strokeWidth={1.75} />
              </IconButton>
            )}
          </View>
        }
      />
      <Animated.View pointerEvents="none" style={[styles.edge, { opacity: edge }]} />
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  headerBar: {
    backgroundColor: colors.background,
  },
  edge: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: colors.signatureStrong,
  },
  timer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: colors.signature,
  },
  timerLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.onSignature,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  streakCount: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },

}));
