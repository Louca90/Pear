import { useEffect } from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import Reanimated, { ReduceMotion, withDelay, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';
import { Share2 } from 'lucide-react-native';

import { setScreenBrightness } from '../../modules/pear-native';
import { chat } from '../chat/manager';
import { buildPairingLink } from '../crypto/pairing';
import { t } from '../i18n';
import { EASE } from '../motion';
import { createStyles, fixed, radius, useColors } from '../theme';
import { Sheet } from './Sheet';

// La carte du code se pose un peu après la feuille, en grandissant à peine.
const codeIn: EntryExitAnimationFunction = () => {
  'worklet';
  const config = { duration: 320, easing: EASE, reduceMotion: ReduceMotion.System };
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.92 }] },
    animations: { opacity: withDelay(120, withTiming(1, config)), transform: [{ scale: withDelay(120, withTiming(1, config)) }] },
  };
};

// Mon QR code, par-dessus l'écran en cours (feuille du bas commune) : on le montre sans quitter
// « Nouveau contact » (le nom et le code de vérification restent intacts).
export function MyQrSheet({ visible, publicKey, onClose }: { visible: boolean; publicKey: string; onClose: () => void }) {
  if (!visible) return null;
  return <QrSheet publicKey={publicKey} onClose={onClose} />;
}

function QrSheet({ publicKey, onClose }: { publicKey: string; onClose: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const profile = chat.getMyProfile();
  const link = buildPairingLink(publicKey, profile.name);

  // Luminosité au maximum tant que le code est affiché, pour qu'il se scanne bien ; le réglage du téléphone revient à la fermeture.
  useEffect(() => {
    setScreenBrightness(1).catch(() => {});
    return () => {
      setScreenBrightness(-1).catch(() => {});
    };
  }, []);

  return (
    <Sheet title={t('qr.titre')} onClose={onClose}>
      {() => (
        <View style={styles.body}>
          <Text style={styles.text}>{t('qr.aide')}</Text>
          {/* Noir sur blanc quel que soit le thème, avec sa marge : il reste lisible par tous les appareils photo. */}
          <Reanimated.View entering={codeIn} style={styles.card}>
            <QRCode value={link} size={220} ecl="L" color={fixed.black} backgroundColor={fixed.white} />
            {!!profile.name && (
              <Text style={styles.name} numberOfLines={1}>
                {profile.name}
              </Text>
            )}
          </Reanimated.View>
          <Pressable onPress={() => Share.share({ message: link })} accessibilityRole="button" style={({ pressed }) => [styles.share, pressed && styles.pressed]}>
            <Share2 size={18} color={colors.background} strokeWidth={2} />
            <Text style={styles.shareLabel}>{t('ajout.partager')}</Text>
          </Pressable>
        </View>
      )}
    </Sheet>
  );
}

const useStyles = createStyles((colors) => ({
  body: { alignItems: 'center', gap: 16 },
  text: { fontSize: 14, lineHeight: 20, textAlign: 'center', color: colors.textMuted },
  card: { alignItems: 'center', gap: 12, padding: 18, borderRadius: 28, backgroundColor: fixed.white },
  name: { maxWidth: 220, fontSize: 15, fontWeight: '700', color: fixed.black },
  share: { alignSelf: 'stretch', flexDirection: 'row', gap: 8, height: 52, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text },
  shareLabel: { fontSize: 15, fontWeight: '700', color: colors.background },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
}));
