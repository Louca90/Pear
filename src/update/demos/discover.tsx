import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import QRCode from 'react-native-qrcode-svg';
import { Camera, HardDriveDownload, Lock, MapPin, Mic } from 'lucide-react-native';

import { t } from '../../i18n';
import { enterUp } from '../../motion';
import { createStyles, fixed, useColors } from '../../theme';

// Les démos de « Découvrir Pear » : ce que fait l'app, en une image qui bouge.

const PHONE_GAP = 120;

// Un message chiffré (un cadenas vert) va d'un téléphone à l'autre, sans passer par le serveur.
function DirectDemo() {
  const colors = useColors();
  const styles = useStyles();
  const reduced = useReducedMotion();
  const trip = useSharedValue(reduced ? 0.5 : 0);
  useEffect(() => {
    if (reduced) return;
    trip.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.cubic) }), -1, false));
  }, [reduced, trip]);
  const packet = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.min(trip.get(), 1 - trip.get()) * 6),
    transform: [{ translateX: (trip.get() - 0.5) * PHONE_GAP }],
  }));
  return (
    <View style={styles.direct}>
      <View style={styles.server}>
        <Text style={styles.serverLabel}>{t('decouvrir.serveur')}</Text>
      </View>
      <View style={styles.phones}>
        <View style={styles.phone}>
          <Text style={styles.phoneLabel}>{t('decouvrir.toi')}</Text>
        </View>
        <View style={[styles.phone, styles.phoneOther]}>
          <Text style={[styles.phoneLabel, { color: colors.signatureStrong }]}>{t('decouvrir.eux')}</Text>
        </View>
        <Reanimated.View style={[styles.packet, packet]}>
          <Lock size={12} color={colors.onSignature} strokeWidth={2.4} />
        </Reanimated.View>
      </View>
    </View>
  );
}

// Le QR code se dessine dans sa carte claire, comme celui qu'on montre à un ami.
function FaceToFaceDemo() {
  const styles = useStyles();
  return (
    <Reanimated.View entering={enterUp(10, 320)} style={styles.qrCard}>
      <QRCode value="pear://decouvrir" size={128} ecl="L" color={fixed.black} backgroundColor={fixed.white} />
    </Reanimated.View>
  );
}

const TILES = [
  { icon: Camera, label: 'decouvrir.tuileAppareil' },
  { icon: Mic, label: 'decouvrir.tuileVocaux' },
  { icon: MapPin, label: 'decouvrir.tuilePosition' },
  { icon: HardDriveDownload, label: 'decouvrir.tuileSauvegarde' },
] as const;

// Quatre tuiles qui se posent l'une après l'autre.
function ToolsDemo() {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={styles.tiles}>
      {TILES.map(({ icon: Icon, label }, index) => (
        <Reanimated.View key={label} entering={enterUp(10, 300, 80 + index * 70)} style={[styles.tile, index === 0 && styles.tileFirst]}>
          <Icon size={26} color={index === 0 ? colors.onSignature : colors.text} strokeWidth={1.7} />
          <Text style={[styles.tileLabel, index === 0 && { color: colors.onSignature }]}>{t(label)}</Text>
        </Reanimated.View>
      ))}
    </View>
  );
}

export const DISCOVER_DEMOS = { direct: DirectDemo, faceAFace: FaceToFaceDemo, outils: ToolsDemo };

const useStyles = createStyles((colors) => ({
  direct: {
    alignItems: 'center',
    gap: 28,
  },
  server: {
    paddingHorizontal: 14,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.border,
    justifyContent: 'center',
  },
  serverLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  phones: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PHONE_GAP - 64,
  },
  phone: {
    width: 64,
    height: 100,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneOther: {
    borderColor: colors.signatureStrong,
  },
  phoneLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  packet: {
    position: 'absolute',
    left: '50%',
    marginLeft: -11,
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: colors.signatureStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrCard: {
    padding: 14,
    borderRadius: 20,
    backgroundColor: fixed.white,
  },
  tiles: {
    width: 240,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    width: 115,
    height: 100,
    borderRadius: 18,
    backgroundColor: colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  tileFirst: {
    backgroundColor: colors.signature,
  },
  tileLabel: {
    fontSize: 12,
    color: colors.text,
  },
}));

