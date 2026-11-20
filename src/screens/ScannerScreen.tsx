import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming, cancelAnimation, Easing, interpolateColor, useReducedMotion, withRepeat } from 'react-native-reanimated';
import { EASE } from '../motion';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Camera } from 'lucide-react-native';

import { Button } from '../components/ui';
import { PairingLink, parsePairingLink } from '../crypto/pairing';
import { Pear } from '../components/Pear';
import { haptics } from '../haptics';
import { createStyles, motion, radius, spacing, useColors } from '../theme';
import { t } from '../i18n';

type Props = {
  onKeyReceived: (link: PairingLink) => void;
};

type Bounds = { origin: { x: number; y: number }; size: { width: number; height: number } };

// Le cadre fait 70 % de la zone ; il se resserre sur le code lu, puis la poire pousse sa feuille.
const FRAME = 0.7;
const LINGER_MS = 700;

// Le lecteur de QR code, posé dans la feuille « QR code » (onglet Scanner).
export function ScannerPanel({ onKeyReceived }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const [box, setBox] = useState(0);
  const [found, setFound] = useState(false);
  const scale = useSharedValue(1);
  const shiftX = useSharedValue(0);
  const shiftY = useSharedValue(0);
  const pearOpacity = useSharedValue(0);
  // Le cadre respire tant qu'il cherche, une ligne balaie la zone ; au code lu, il se verrouille en vert.
  const reduced = useReducedMotion();
  const breathe = useSharedValue(0);
  const sweep = useSharedValue(0);
  const lock = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    breathe.set(withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.sin) }), -1, true));
    sweep.set(withRepeat(withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => {
      cancelAnimation(breathe);
      cancelAnimation(sweep);
    };
  }, [reduced, breathe, sweep]);
  const frameStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shiftX.get() }, { translateY: shiftY.get() }, { scale: scale.get() * (1 + 0.025 * breathe.get() * (1 - lock.get())) }],
  }));
  const cornerColor = useAnimatedStyle(() => ({ borderColor: interpolateColor(lock.get(), [0, 1], [colors.onMedia, colors.signatureStrong]) }));
  const sweepStyle = useAnimatedStyle(() => ({ opacity: 1 - lock.get(), transform: [{ translateY: sweep.get() * Math.max(0, box * FRAME - 24) }] }));
  const pearStyle = useAnimatedStyle(() => ({ opacity: pearOpacity.get() }));
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
    lock.set(withTiming(1, { duration: 260, easing: EASE }));
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
    const config = { duration: motion.mascot, easing: EASE };
    scale.set(withTiming(target / FRAME, config));
    shiftX.set(withTiming(dx, config));
    shiftY.set(withTiming(dy, config));
    pearOpacity.set(withTiming(1, { duration: motion.small, easing: EASE }));
    timer.current = setTimeout(() => onKeyReceived(key), motion.reduced ? 0 : LINGER_MS);
  };

  if (!permission) return <View style={styles.permission} />;

  if (!permission.granted) {
    return (
      <View style={styles.permission}>
        <Text style={styles.text}>{t('scanner.cameraAide')}</Text>
        <Button label={t('scanner.autoriserCamera')} icon={Camera} onPress={requestPermission} />
      </View>
    );
  }

  return (
    <View>
      <View style={styles.cameraBox} onLayout={(event) => setBox(event.nativeEvent.layout.width)}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleScan}
        />
        <Reanimated.View pointerEvents="none" style={[styles.frame, { width: `${FRAME * 100}%`, height: `${FRAME * 100}%` }, frameStyle]}>
          <Reanimated.View style={[styles.corner, styles.cornerTL, cornerColor]} />
          <Reanimated.View style={[styles.corner, styles.cornerTR, cornerColor]} />
          <Reanimated.View style={[styles.corner, styles.cornerBL, cornerColor]} />
          <Reanimated.View style={[styles.corner, styles.cornerBR, cornerColor]} />
          <Reanimated.View style={[styles.sweep, { backgroundColor: colors.signatureStrong, boxShadow: `0px 0px 12px ${colors.signatureStrong}` }, sweepStyle]} />
        </Reanimated.View>
        {found && (
          <Reanimated.View pointerEvents="none" style={[styles.pear, pearStyle]}>
            <Pear height={64} color={colors.onMedia} state="leaf" leafColor={colors.signatureStrong} />
          </Reanimated.View>
        )}
      </View>
      <Text style={styles.text}>
        {invalid ? t('scanner.pasPear') : t('scanner.viser')}
      </Text>
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  permission: {
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  cameraBox: {
    aspectRatio: 1,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  frame: {
    position: 'absolute',
    alignSelf: 'center',
    top: '15%',
  },
  corner: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderStyle: 'solid',
  },
  cornerTL: { left: 0, top: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 14 },
  cornerTR: { right: 0, top: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 14 },
  cornerBL: { left: 0, bottom: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 14 },
  cornerBR: { right: 0, bottom: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 14 },
  sweep: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12,
    height: 2,
    borderRadius: 1,
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
