import { useEffect, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { FileText, Images } from 'lucide-react-native';

import { IconButton } from '../../../components/ui';
import { createStyles, radius, spacing, useColors } from '../../../theme';

import { ATTACH_CLOSE_MS } from '../constants';
import { t } from '../../../i18n';

type AttachMenuProps = {
  open: boolean;
  progress: Animated.Value;
  onPhotos: () => void;
  onFile: () => void;
};

// Les deux choix montent depuis le trombone, l'un après l'autre, puis redescendent à la fermeture.
export function AttachMenu({ open, progress, onPhotos, onFile }: AttachMenuProps) {
  const colors = useColors();
  const styles = useStyles();
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, damping: 15, stiffness: 240 }).start();
    } else {
      Animated.timing(progress, { toValue: 0, duration: ATTACH_CLOSE_MS, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
  }, [open, progress]);

  if (!mounted) return null;

  const options = [
    { icon: Images, label: t('chat.photos'), onPress: onPhotos },
    { icon: FileText, label: t('chat.fichier'), onPress: onFile },
  ];

  return (
    <View style={styles.attachMenu}>
      {options.map(({ icon: Icon, label, onPress }, index) => {
        const inputRange = index === 0 ? [0, 0.7] : [0.3, 1];
        const appear = (from: number, to: number) => progress.interpolate({ inputRange, outputRange: [from, to], extrapolateLeft: 'clamp' });
        return (
          <Animated.View key={label} style={{ opacity: appear(0, 1), transform: [{ translateY: appear(16, 0) }, { scale: appear(0.7, 1) }] }}>
            <IconButton onPress={onPress} label={label} hitSlop={0} style={styles.attachOption}>
              <Icon size={18} color={colors.text} strokeWidth={1.75} />
              <Text style={styles.attachLabel}>{label}</Text>
            </IconButton>
          </Animated.View>
        );
      })}
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  attachMenu: {
    position: 'absolute',
    left: spacing.md,
    bottom: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  attachOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.elevated,
    boxShadow: `0px 4px 16px ${colors.shadow}`,
  },
  attachLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
}));
