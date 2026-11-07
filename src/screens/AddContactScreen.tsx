import { ScrollView, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { ClipboardPaste, ScanLine, Share2 } from 'lucide-react-native';

import { useBottomBarSpace } from '../components/BottomBar';
import { showDialog } from '../components/dialog';
import { Button, Header, Screen } from '../components/ui';
import { chat } from '../chat/manager';
import { buildPairingLink, PairingLink, parsePairingLink } from '../crypto/pairing';
import { createStyles, radius, spacing } from '../theme';
import { t } from '../i18n';

type Props = {
  publicKey: string;
  onScan: () => void;
  onKeyReceived: (link: PairingLink) => void;
};

export function AddContactScreen({ publicKey, onScan, onKeyReceived }: Props) {
  const styles = useStyles();
  const link = buildPairingLink(publicKey, chat.getMyProfile().name);
  const barSpace = useBottomBarSpace();

  const pasteLink = async () => {
    const key = parsePairingLink(await Clipboard.getStringAsync());
    if (key) onKeyReceived(key);
    else showDialog(t('app.lienNonReconnu'), t('ajout.copierLien'));
  };

  return (
    <Screen>
      <Header title={t('accueil.ajouterContact')} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: barSpace }]}>
        <Text style={styles.text}>{t('ajout.aide')}</Text>
        {/* Le QR code reste noir sur blanc et garde sa marge pour rester lisible. */}
        <View style={styles.qr}>
          <QRCode value={link} size={220} ecl="L" color="#000000" backgroundColor="#FFFFFF" />
        </View>
        <View style={styles.actions}>
          <Button label={t('ajout.scanner')} icon={ScanLine} onPress={onScan} />
          <Button
            label={t('ajout.partager')}
            icon={Share2}
            variant="secondary"
            onPress={() => Share.share({ message: link })}
          />
          <Button label={t('ajout.coller')} icon={ClipboardPaste} variant="secondary" onPress={pasteLink} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  content: {
    alignItems: 'center',
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  text: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  qr: {
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#FFFFFF',
    marginBottom: spacing.lg,
  },
  actions: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
}));
