import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Share2 } from 'lucide-react-native';

import { setScreenBrightness } from '../../modules/pear-native';
import { chat } from '../chat/manager';
import { buildPairingLink } from '../crypto/pairing';
import { t } from '../i18n';
import { createStyles, fixed, radius, spacing } from '../theme';
import { Button, useNavigationBarHeight } from './ui';

const OPEN_MS = 280;
const CLOSE_MS = 220;
// Démarre vite et se pose doucement, sans dépasser.
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const SHEET_OFFSET = 520;

// Mon QR code, par-dessus l'écran en cours : on le montre sans quitter « Nouveau contact » (le nom et
// le code de vérification restent intacts). Le même composant sert partout où l'on montre son code.
export function MyQrSheet({ visible, publicKey, onClose }: { visible: boolean; publicKey: string; onClose: () => void }) {
  const styles = useStyles();
  const bottom = useNavigationBarHeight();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const link = buildPairingLink(publicKey, chat.getMyProfile().name);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start();
    } else if (mounted) {
      Animated.timing(progress, { toValue: 0, duration: CLOSE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => setMounted(false));
    }
  }, [visible, mounted, progress]);

  // Luminosité au maximum tant que le code est affiché, pour qu'il se scanne bien ; le réglage du téléphone revient à la fermeture.
  useEffect(() => {
    if (!visible) return;
    setScreenBrightness(1).catch(() => {});
    return () => {
      setScreenBrightness(-1).catch(() => {});
    };
  }, [visible]);

  if (!mounted) return null;
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [SHEET_OFFSET, 0] });

  return (
    <Modal transparent visible statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} animationType="none">
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('commun.fermer')} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { paddingBottom: bottom + spacing.lg, transform: [{ translateY }] }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>{t('qr.titre')}</Text>
        <Text style={styles.text}>{t('qr.aide')}</Text>
        {/* Noir sur blanc quel que soit le thème, avec sa marge : il reste lisible par tous les appareils photo. */}
        <View style={styles.qr}>
          <QRCode value={link} size={240} ecl="L" color={fixed.black} backgroundColor={fixed.white} />
        </View>
        <Button label={t('ajout.partager')} icon={Share2} variant="secondary" onPress={() => Share.share({ message: link })} />
      </Animated.View>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  backdrop: {
    backgroundColor: colors.overlay,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.elevated,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  text: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
  },
  qr: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: fixed.white,
  },
}));
