import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { ClipboardPaste, ScanLine, Share2 } from 'lucide-react-native';

import { useBottomBarSpace } from '../components/BottomBar';
import { showDialog } from '../components/dialog';
import { Button, Header, Screen } from '../components/ui';
import { buildPairingLink, parsePairingLink } from '../crypto/pairing';
import { colors, radius, spacing } from '../theme';

type Props = {
  publicKey: string;
  onScan: () => void;
  onKeyReceived: (publicKey: string) => void;
};

export function AddContactScreen({ publicKey, onScan, onKeyReceived }: Props) {
  const link = buildPairingLink(publicKey);
  const barSpace = useBottomBarSpace();

  const pasteLink = async () => {
    const key = parsePairingLink(await Clipboard.getStringAsync());
    if (key) onKeyReceived(key);
    else showDialog('Lien non reconnu', "Copiez d'abord le lien Pear de votre contact.");
  };

  return (
    <Screen>
      <Header title="Ajouter un contact" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: barSpace }]}>
        <Text style={styles.text}>Chacun scanne le code de l'autre, une seule fois.</Text>
        {/* Le QR code reste noir sur blanc et garde sa marge pour rester lisible. */}
        <View style={styles.qr}>
          <QRCode value={link} size={220} color="#000000" backgroundColor="#FFFFFF" />
        </View>
        <View style={styles.actions}>
          <Button label="Scanner son code" icon={ScanLine} onPress={onScan} />
          <Button
            label="Partager mon lien"
            icon={Share2}
            variant="secondary"
            onPress={() => Share.share({ message: link })}
          />
          <Button label="Coller un lien" icon={ClipboardPaste} variant="secondary" onPress={pasteLink} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
});
