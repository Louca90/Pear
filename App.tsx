import { useEffect, useMemo, useState } from 'react';
import { Alert, BackHandler, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';

import { deriveSharedSecret, getVerificationCode, Identity, parsePairingLink } from './src/crypto/pairing';
import { AddContactScreen } from './src/screens/AddContactScreen';
import { ConnectionScreen } from './src/screens/ConnectionScreen';
import { ContactScreen } from './src/screens/ContactScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { Contact, loadContacts, loadOrCreateIdentity, saveContacts } from './src/storage';
import { colors, spacing } from './src/theme';

type Route =
  | { name: 'home' }
  | { name: 'add' }
  | { name: 'scan' }
  | { name: 'contact'; publicKey: string }
  | { name: 'connection'; publicKey: string };

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [error, setError] = useState<string | null>(null);
  const url = Linking.useURL();

  useEffect(() => {
    Promise.all([loadOrCreateIdentity(), loadContacts()])
      .then(([savedIdentity, savedContacts]) => {
        setContacts(savedContacts);
        setIdentity(savedIdentity);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const openKey = (publicKey: string) => {
    if (publicKey === identity?.publicKey) {
      Alert.alert('Code non valide', "C'est votre propre code : scannez celui de votre contact.");
      return;
    }
    setRoute({ name: 'contact', publicKey });
  };

  // Un lien pear://pair ouvert depuis une autre app arrive ici.
  useEffect(() => {
    if (!url || !identity || !url.startsWith('pear://pair')) return;
    const key = parsePairingLink(url);
    if (key) openKey(key);
    else Alert.alert('Lien non reconnu', "Ce lien Pear n'est pas valide.");
  }, [url, identity]);

  // Le bouton retour d'Android revient à l'écran précédent au lieu de quitter l'app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'home') return false;
      if (route.name === 'scan') setRoute({ name: 'add' });
      else if (route.name === 'connection') setRoute({ name: 'contact', publicKey: route.publicKey });
      else setRoute({ name: 'home' });
      return true;
    });
    return () => subscription.remove();
  }, [route]);

  const contactKey = route.name === 'contact' || route.name === 'connection' ? route.publicKey : null;

  // Le secret est recalculé à la demande : seule la clé privée est stockée.
  const pairing = useMemo(() => {
    if (!identity || !contactKey) return null;
    try {
      const secret = deriveSharedSecret(identity, contactKey);
      return { secret, code: getVerificationCode(secret) };
    } catch {
      return { secret: null, code: null };
    }
  }, [identity, contactKey]);

  useEffect(() => {
    if (pairing && !pairing.secret) {
      Alert.alert('Clé non valide', 'Ce code ne permet pas de créer une connexion sûre.');
      setRoute({ name: 'home' });
    }
  }, [pairing]);

  const updateContacts = (next: Contact[]) => {
    setContacts(next);
    saveContacts(next).catch((e) => Alert.alert('Enregistrement impossible', String(e)));
  };

  const body = () => {
    if (error) {
      return (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      );
    }
    if (!identity) return <View style={styles.center} />;

    if (route.name === 'add') {
      return (
        <AddContactScreen
          publicKey={identity.publicKey}
          onBack={() => setRoute({ name: 'home' })}
          onScan={() => setRoute({ name: 'scan' })}
          onKeyReceived={openKey}
        />
      );
    }
    if (route.name === 'scan') {
      return <ScannerScreen onBack={() => setRoute({ name: 'add' })} onKeyReceived={openKey} />;
    }
    if (route.name === 'connection' && pairing?.secret) {
      const publicKey = route.publicKey;
      return (
        <ConnectionScreen
          name={contacts.find((contact) => contact.publicKey === publicKey)?.name ?? 'Contact'}
          role={identity.publicKey < publicKey ? 'a' : 'b'}
          secret={pairing.secret}
          onBack={() => setRoute({ name: 'contact', publicKey })}
        />
      );
    }
    if (route.name === 'contact' && pairing?.code) {
      const publicKey = route.publicKey;
      const saved = contacts.find((contact) => contact.publicKey === publicKey);
      const others = contacts.filter((contact) => contact.publicKey !== publicKey);
      return (
        <ContactScreen
          key={publicKey}
          initialName={saved?.name ?? ''}
          code={pairing.code}
          isNew={!saved}
          onBack={() => setRoute({ name: 'home' })}
          onSave={(name) => {
            updateContacts([...others, { publicKey, name }]);
            setRoute({ name: 'home' });
          }}
          onShowMyCode={() => setRoute({ name: 'add' })}
          onTestConnection={() => setRoute({ name: 'connection', publicKey })}
          onRemove={() => {
            updateContacts(others);
            setRoute({ name: 'home' });
          }}
        />
      );
    }
    return (
      <HomeScreen
        contacts={contacts}
        onAdd={() => setRoute({ name: 'add' })}
        onOpen={(contact) => setRoute({ name: 'contact', publicKey: contact.publicKey })}
      />
    );
  };

  return (
    <>
      <StatusBar style="dark" />
      {body()}
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  error: {
    fontSize: 14,
    color: colors.text,
    textAlign: 'center',
  },
});
