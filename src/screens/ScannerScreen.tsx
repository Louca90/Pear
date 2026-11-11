import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Camera } from 'lucide-react-native';

import { Button, Header, Screen } from '../components/ui';
import { PairingLink, parsePairingLink } from '../crypto/pairing';
import { Pear } from '../components/Pear';
import { haptics } from '../haptics';
import { createStyles, motion, radius, spacing, useColors } from '../theme';
import { t } from '../i18n';

type Props = {
  onBack: () => void;
  onKeyReceived: (link: PairingLink) => void;
};

type Bounds = { origin: { x: number; y: number }; size: { width: number; height: number } };

// Le cadre fait 70 % de la zone ; il se resserre sur le code lu, puis la poire pousse sa feuille.
const FRAME = 0.7;
const LINGER_MS = 700;

export function ScannerScreen({ onBack, onKeyReceived }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [box, setBox] = useState(0);
  const [found, setFound] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const shiftX = useRef(new Animated.Value(0)).current;
  const shiftY = useRef(new Animated.Value(0)).current;
  const pearOpacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const [permission, requestPermission] = useCameraPermissions();
  const [invalid, setInvalid] = useState(false);
  // La caméra signale le même QR code plusieurs fois par seconde : on ne garde que le premier.
  const done = useRef(false);

  const handleScan = ({ data, bounds }: { data: string; bounds?: Bounds }) => {
    if (done.current) return;
    const key = parsePairingLink(data);
    if (!key) {
      setInvalid(true);
      return;
    }
    done.current = true;
    haptics.success();
    setFound(true);
    // Sur le code lu si la caméra donne sa position (et qu'elle tombe dans la zone), sinon resserré au centre.
    let target = FRAME * 0.62;
    let dx = 0;
    let dy = 0;
    if (box > 0 && bounds && bounds.size.width > 0) {
      const cx = bounds.origin.x + bounds.size.width / 2 - box / 2;
      const cy = bounds.origin.y + bounds.size.height / 2 - box / 2;
      if (Math.abs(cx) < box / 2 && Math.abs(cy) < box / 2) {
        target = Math.min(FRAME, Math.max(0.2, bounds.size.width / (box * FRAME)) * FRAME);
        dx = cx;
        dy = cy;
      }
    }
    const config = { duration: motion.mascot, easing: motion.easing, useNativeDriver: true };
    Animated.parallel([
      Animated.timing(scale, { toValue: target / FRAME, ...config }),
      Animated.timing(shiftX, { toValue: dx, ...config }),
      Animated.timing(shiftY, { toValue: dy, ...config }),
      Animated.timing(pearOpacity, { toValue: 1, duration: motion.small, easing: motion.easing, useNativeDriver: true }),
    ]).start();
    timer.current = setTimeout(() => onKeyReceived(key), motion.reduced ? 0 : LINGER_MS);
  };

  if (!permission) return <Screen><Header title={t('scanner.titre')} onBack={onBack} /></Screen>;

  if (!permission.granted) {
    return (
      <Screen>
        <Header title={t('scanner.titre')} onBack={onBack} />
        <View style={styles.permission}>
          <Text style={styles.text}>{t('scanner.cameraAide')}</Text>
          <Button label={t('scanner.autoriserCamera')} icon={Camera} onPress={requestPermission} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title={t('scanner.titre')} onBack={onBack} />
      <View style={styles.cameraBox} onLayout={(event) => setBox(event.nativeEvent.layout.width)}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleScan}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.frame,
            { width: `${FRAME * 100}%`, height: `${FRAME * 100}%`, borderColor: found ? colors.signatureStrong : colors.onMedia },
            { transform: [{ translateX: shiftX }, { translateY: shiftY }, { scale }] },
          ]}
        />
        {found && (
          <Animated.View pointerEvents="none" style={[styles.pear, { opacity: pearOpacity }]}>
            <Pear height={64} color={colors.onMedia} state="leaf" leafColor={colors.signatureStrong} />
          </Animated.View>
        )}
      </View>
      <Text style={styles.text}>
        {invalid ? t('scanner.pasPear') : t('scanner.viser')}
      </Text>
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  permission: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  cameraBox: {
    aspectRatio: 1,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  frame: {
    position: 'absolute',
    alignSelf: 'center',
    top: '15%',
    borderWidth: 2,
    borderRadius: radius.md,
  },
  pear: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    padding: spacing.lg,
  },
}));
