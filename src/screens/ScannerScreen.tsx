import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Camera } from 'lucide-react-native';

import { Button, Header, Screen } from '../components/ui';
import { PairingLink, parsePairingLink } from '../crypto/pairing';
import { createStyles, radius, spacing } from '../theme';
import { t } from '../i18n';

type Props = {
  onBack: () => void;
  onKeyReceived: (link: PairingLink) => void;
};

export function ScannerScreen({ onBack, onKeyReceived }: Props) {
  const styles = useStyles();
  const [permission, requestPermission] = useCameraPermissions();
  const [invalid, setInvalid] = useState(false);
  // La caméra signale le même QR code plusieurs fois par seconde : on ne garde que le premier.
  const done = useRef(false);

  const handleScan = ({ data }: { data: string }) => {
    if (done.current) return;
    const key = parsePairingLink(data);
    if (!key) {
      setInvalid(true);
      return;
    }
    done.current = true;
    onKeyReceived(key);
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
      <View style={styles.cameraBox}>
        <CameraView
          style={StyleSheet.absoluteFill}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleScan}
        />
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
  text: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    padding: spacing.lg,
  },
}));
