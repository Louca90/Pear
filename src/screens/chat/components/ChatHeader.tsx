import { View } from 'react-native';
import { EllipsisVertical } from 'lucide-react-native';

import { getContactProfile, getStreakState } from '../../../chat/database';
import { StreakFlame } from '../../../components/StreakFlame';
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
  const streak = getStreakState(contactKey);
  const photo = getContactProfile(contactKey).photo_uri;
  const { status, route } = chat.getLink(contactKey);
  const subtitle = chat.isTyping(contactKey)
    ? t('chat.ecrit')
    : !chat.isOnline()
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
        titleAccessory={<StreakFlame id={contactKey} count={streak.count} lit={streak.today} size={17} />}
        action={
          <View style={styles.headerActions}>
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
