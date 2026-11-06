import { Text, View } from 'react-native';
import { Flame } from 'lucide-react-native';

import { getContactProfile, getStreak } from '../../../chat/database';
import { chat } from '../../../chat/manager';
import { Avatar, Header, IconButton } from '../../../components/ui';
import { createStyles, radius, spacing, useColors } from '../../../theme';

import { ROUTE } from '../constants';

type Props = {
  contactKey: string;
  name: string;
  onBack: () => void;
  onInfo: () => void;
  onCustomize: () => void;
};

export function ChatHeader({ contactKey, name, onBack, onInfo, onCustomize }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const streak = getStreak(contactKey);
  const photo = getContactProfile(contactKey).photo_uri;
  const { status, route } = chat.getLink(contactKey);
  const subtitle = !chat.isOnline()
    ? 'Vous êtes hors ligne'
    : status === 'connected'
      ? route ? ROUTE[route] : 'Connecté'
      : 'Votre contact est hors ligne';

  return (
    <View style={styles.headerBar}>
      <Header
        title={name}
        subtitle={subtitle}
        onBack={onBack}
        avatar={<Avatar uri={photo} size={36} />}
        onTitlePress={onInfo}
        action={
          <View style={styles.headerActions}>
            {streak > 0 && (
              <View style={styles.streak} accessibilityLabel={`Série de ${streak} jours`}>
                <Flame size={18} color={colors.text} strokeWidth={1.75} />
                <Text style={styles.streakCount}>{streak}</Text>
              </View>
            )}
            <IconButton onPress={onCustomize} label="Personnaliser la conversation" style={styles.moreButton}>
              <View style={styles.moreDot} />
              <View style={styles.moreDot} />
            </IconButton>
          </View>
        }
      />
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  headerBar: {
    backgroundColor: colors.background,
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
  moreButton: {
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  moreDot: {
    width: 4,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.text,
  },
}));
