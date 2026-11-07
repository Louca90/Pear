import { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';

import { reloadApp } from '../../modules/pear-native';
import { LanguageChoice, languageChoice, LANGUAGES, saveLanguageChoice, t } from '../i18n';
import { log } from '../log';
import { createStyles, radius, spacing, useColors } from '../theme';
import { showDialog } from './dialog';
import { useNavigationBarHeight } from './ui';

const OPEN_MS = 240;
const CLOSE_MS = 180;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

// Choix de la langue : celle du téléphone par défaut, ou l'une des 7 langues de Pear. L'app se
// recharge pour l'appliquer partout.
export function LanguageSheet({ onClose }: { onClose: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const bottom = useNavigationBarHeight();
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const current = languageChoice();

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

  const choose = (choice: LanguageChoice) => {
    if (choice === current) return close();
    close(() => {
      saveLanguageChoice(choice)
        .then(() => reloadApp())
        .catch((e) => {
          log.warn('langue', e);
          showDialog(t('langue.titre'), t('langue.redemarrer'));
        });
    });
  };

  const options: { code: LanguageChoice; name: string }[] = [{ code: 'auto', name: t('langue.auto') }, ...LANGUAGES];

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => close()} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={styles.flex} onPress={() => close()} accessibilityLabel={t('commun.fermer')} />
      </Animated.View>
      <Animated.View
        style={[styles.sheet, { paddingBottom: bottom + spacing.md }, { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [560, 0] }) }] }]}
      >
        <Pressable onPress={() => close()} style={styles.header} accessibilityLabel={t('commun.fermer')}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t('langue.titre')}</Text>
        </Pressable>
        {options.map((option) => (
          <Pressable
            key={option.code}
            onPress={() => choose(option.code)}
            accessibilityState={{ selected: option.code === current }}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text style={styles.name}>{option.name}</Text>
            {option.code === current && <Check size={20} color={colors.text} strokeWidth={2} />}
          </Pressable>
        ))}
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.background,
  },
  header: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
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
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    height: 52,
  },
  pressed: {
    opacity: 0.6,
  },
  name: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
}));
