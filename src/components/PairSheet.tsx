import { useEffect, useState } from 'react';
import { Pressable, Share, Text, useWindowDimensions, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Reanimated, { Easing, FadeIn, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';
import { Copy, Link2, Share2 } from 'lucide-react-native';

import { setScreenBrightness } from '../../modules/pear-native';
import { chat } from '../chat/manager';
import { buildPairingLink, PairingLink, parsePairingLink } from '../crypto/pairing';
import { haptics } from '../haptics';
import { t } from '../i18n';
import { EASE } from '../motion';
import { ScannerPanel } from '../screens/ScannerScreen';
import { createStyles, fixed, radius, useColors } from '../theme';
import { Pear } from './Pear';
import { SegmentedControl } from './SegmentedControl';
import { Sheet } from './Sheet';
import { showDialog } from './dialog';

type Mode = 'code' | 'scan';

const QR_SIZE = 210;
const DRAW_MS = 600;

// La carte du code se pose un peu après la feuille, en grandissant à peine.
const codeIn: EntryExitAnimationFunction = () => {
  'worklet';
  const config = { duration: 320, easing: EASE, reduceMotion: ReduceMotion.System };
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.92 }] },
    animations: { opacity: withDelay(120, withTiming(1, config)), transform: [{ scale: withDelay(120, withTiming(1, config)) }] },
  };
};

// La feuille « QR code » : « Mon code » et « Scanner » dans la même feuille, avec un sélecteur dont la
// pastille glisse. Le contenu du code reste pear://pair?k=<clé>&n=<pseudo>. Un code lu ferme la feuille
// et ouvre « Nouveau contact » (onKeyReceived).
export function PairSheet({ visible, publicKey, onClose, onKeyReceived }: { visible: boolean; publicKey: string; onClose: () => void; onKeyReceived: (link: PairingLink) => void }) {
  if (!visible) return null;
  return <Pair publicKey={publicKey} onClose={onClose} onKeyReceived={onKeyReceived} />;
}

function Pair({ publicKey, onClose, onKeyReceived }: { publicKey: string; onClose: () => void; onKeyReceived: (link: PairingLink) => void }) {
  const [mode, setMode] = useState<Mode>('code');
  const { height } = useWindowDimensions();
  const options = [
    { value: 'code' as const, label: t('qr.monCode') },
    { value: 'scan' as const, label: t('qr.scanner') },
  ];
  return (
    <Sheet title={t('qr.titre')} onClose={onClose} height={Math.round(height * 0.78)}>
      {(close) => (
        <View style={{ flex: 1, gap: 16 }}>
          <SegmentedControl options={options} value={mode} onChange={setMode} />
          {mode === 'code' ? <CodePane key="code" publicKey={publicKey} /> : <ScanPane key="scan" close={close} onKeyReceived={onKeyReceived} />}
        </View>
      )}
    </Sheet>
  );
}

function CodePane({ publicKey }: { publicKey: string }) {
  const styles = useStyles();
  const colors = useColors();
  const profile = chat.getMyProfile();
  const link = buildPairingLink(publicKey, profile.name);
  const [copied, setCopied] = useState(false);
  // Un éclat passe une fois sur le code, après son apparition.
  const shine = useSharedValue(0);
  useEffect(() => {
    shine.set(withDelay(DRAW_MS, withSequence(withTiming(1, { duration: 700, easing: Easing.inOut(Easing.cubic), reduceMotion: ReduceMotion.System }), withTiming(0, { duration: 0 }))));
  }, [shine]);
  // Le QR se dessine depuis le centre : un disque qui grandit le révèle, en 600 ms.
  const draw = useSharedValue(0);
  useEffect(() => {
    draw.set(withDelay(100, withTiming(1, { duration: DRAW_MS, easing: EASE, reduceMotion: ReduceMotion.System })));
  }, [draw]);
  const reveal = useAnimatedStyle(() => {
    const size = QR_SIZE * 1.5 * draw.get();
    return { width: Math.min(QR_SIZE, size), height: Math.min(QR_SIZE, size), borderRadius: size >= QR_SIZE ? 8 : size / 2 };
  });
  const qrInner = useAnimatedStyle(() => {
    const size = Math.min(QR_SIZE, QR_SIZE * 1.5 * draw.get());
    return { left: -(QR_SIZE - size) / 2, top: -(QR_SIZE - size) / 2, opacity: Math.min(1, draw.get() * 3) };
  });
  const shineStyle = useAnimatedStyle(() => ({ opacity: shine.get() > 0 ? 0.55 : 0, transform: [{ translateX: -260 + 520 * shine.get() }, { rotate: '18deg' }] }));

  // Luminosité au maximum tant que le code est affiché ; le réglage du téléphone revient ensuite.
  useEffect(() => {
    setScreenBrightness(1).catch(() => {});
    return () => {
      setScreenBrightness(-1).catch(() => {});
    };
  }, []);

  return (
    <Reanimated.View entering={FadeIn.duration(200)} style={styles.pane}>
      <Reanimated.View entering={codeIn} style={styles.card}>
        <View style={styles.cardHead}>
          <Pear height={22} color={fixed.black} />
          {!!profile.name && (
            <Text style={styles.name} numberOfLines={1}>
              {profile.name}
            </Text>
          )}
        </View>
        {/* Noir sur blanc quel que soit le thème : lisible par tous les appareils photo. */}
        <View style={styles.qr}>
          <Reanimated.View style={[styles.reveal, reveal]}>
            <Reanimated.View style={[styles.qrInner, qrInner]}>
              <QRCode value={link} size={QR_SIZE} ecl="L" color={fixed.black} backgroundColor={fixed.white} />
            </Reanimated.View>
          </Reanimated.View>
          <Reanimated.View pointerEvents="none" style={[styles.shine, shineStyle]} />
        </View>
      </Reanimated.View>
      <Text style={styles.text}>{t('qr.aide')}</Text>
      <Pressable onPress={() => Share.share({ message: link })} accessibilityRole="button" style={({ pressed }) => [styles.share, pressed && styles.pressed]}>
        <Share2 size={18} color={colors.background} strokeWidth={2} />
        <Text style={styles.shareLabel}>{t('ajout.partager')}</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          Clipboard.setStringAsync(link).catch(() => {});
          haptics.select();
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        accessibilityRole="button"
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
      >
        <Copy size={18} color={colors.text} strokeWidth={1.9} />
        <Text style={styles.secondaryLabel}>{copied ? t('ajout.copie') : t('ajout.copier')}</Text>
      </Pressable>
    </Reanimated.View>
  );
}

function ScanPane({ close, onKeyReceived }: { close: (after?: () => void) => void; onKeyReceived: (link: PairingLink) => void }) {
  const styles = useStyles();
  const colors = useColors();
  const found = (link: PairingLink) => close(() => onKeyReceived(link));
  const paste = async () => {
    const link = parsePairingLink(await Clipboard.getStringAsync());
    if (link) found(link);
    else showDialog(t('app.lienNonReconnu'), t('ajout.copierLien'));
  };
  return (
    <Reanimated.View entering={FadeIn.duration(200)} style={styles.pane}>
      <ScannerPanel onKeyReceived={found} />
      <Pressable onPress={paste} accessibilityRole="button" style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
        <Link2 size={18} color={colors.text} strokeWidth={1.9} />
        <Text style={styles.secondaryLabel}>{t('ajout.coller')}</Text>
      </Pressable>
    </Reanimated.View>
  );
}

const useStyles = createStyles((colors) => ({
  pane: { gap: 14 },
  card: { alignSelf: 'center', alignItems: 'center', gap: 12, padding: 18, borderRadius: 28, backgroundColor: fixed.white },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { maxWidth: 180, fontSize: 15, fontWeight: '700', color: fixed.black },
  qr: { width: QR_SIZE, height: QR_SIZE, overflow: 'hidden', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  reveal: { overflow: 'hidden' },
  qrInner: { position: 'absolute', width: QR_SIZE, height: QR_SIZE },
  shine: { position: 'absolute', top: -40, bottom: -40, width: 60, backgroundColor: fixed.white },
  text: { fontSize: 14, lineHeight: 20, textAlign: 'center', color: colors.textMuted },
  share: { flexDirection: 'row', gap: 8, height: 52, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text },
  shareLabel: { fontSize: 15, fontWeight: '700', color: colors.background },
  secondary: { flexDirection: 'row', gap: 8, height: 48, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  secondaryLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
}));
