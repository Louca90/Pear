import { Text, View } from 'react-native';
import { EllipsisVertical, Flame } from 'lucide-react-native';

import { getContactProfile, getStreak } from '../../../chat/database';
import { chat } from '../../../chat/manager';
import { Avatar, Header, IconButton } from '../../../components/ui';
import { createStyles, spacing, useColors } from '../../../theme';

import { ROUTE } from '../constants';
import { t } from '../../../i18n';

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
    ? t('chat.vousHorsLigne')
    : status === 'connected'
      ? route ? ROUTE[route] : t('chat.connecte')
      : t('chat.contactHorsLigne');

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
              <View style={styles.streak} accessibilityLabel={t('accueil.serie', { n: streak })}>
                <Flame size={18} color={colors.text} strokeWidth={1.75} />
                <Text style={styles.streakCount}>{streak}</Text>
              </View>
            )}
            <IconButton onPress={onCustomize} label={t('chat.personnaliser')}>
              <EllipsisVertical size={24} color={colors.text} strokeWidth={1.75} />
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

}));
