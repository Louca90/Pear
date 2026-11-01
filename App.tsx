import { useEffect, useMemo, useState } from 'react';
import { Alert, AppState, BackHandler, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import notifee, { EventType } from '@notifee/react-native';
import { getMessaging, onMessage } from '@react-native-firebase/messaging';

import { deleteMessages } from './src/chat/database';
import { chat } from './src/chat/manager';
import { deriveSharedSecret, getVerificationCode, Identity, parsePairingLink } from './src/crypto/pairing';
import { AddContactScreen } from './src/screens/AddContactScreen';
import { ChatScreen } from './src/screens/ChatScreen';
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
  | { name: 'chat'; publicKey: string };

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [active, setActive] = useState(AppState.currentState === 'active');
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

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    notifee.requestPermission().catch((e) => console.warn('Pear notification :', e));

    // Appuyer sur une notification ouvre directement la conversation.
    const openFrom = (data?: { contact?: unknown }) => {
      if (typeof data?.contact === 'string') setRoute({ name: 'chat', publicKey: data.contact });
    };
    notifee.getInitialNotification().then((initial) => openFrom(initial?.notification.data));
    const stopEvents = notifee.onForegroundEvent(({ type, detail }) => {
      if (type === EventType.PRESS) openFrom(detail.notification?.data);
    });
    // Un push reçu app ouverte : on tente simplement de se reconnecter tout de suite.
    const stopPush = onMessage(getMessaging(), async () => chat.retryAll());
    return () => {
      stopEvents();
      stopPush();
    };
  }, []);

  // Au premier plan, l'app garde les connexions ouvertes. En arrière-plan, seul un push la réveille.
  useEffect(() => {
    if (!identity) return;
    if (active) chat.sync(identity, contacts);
    else chat.stopAll();
  }, [identity, contacts, active]);

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

  const isSaved = (publicKey: string) => contacts.some((contact) => contact.publicKey === publicKey);

  const backFromContact = (publicKey: string) =>
    setRoute(isSaved(publicKey) ? { name: 'chat', publicKey } : { name: 'home' });

  // Le bouton retour d'Android revient à l'écran précédent au lieu de quitter l'app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (route.name === 'home') return false;
      if (route.name === 'scan') setRoute({ name: 'add' });
      else if (route.name === 'contact') backFromContact(route.publicKey);
      else setRoute({ name: 'home' });
      return true;
    });
    return () => subscription.remove();
  }, [route, contacts]);

  const contactKey = route.name === 'contact' ? route.publicKey : null;

  // Le secret est recalculé à la demande : seule la clé privée est stockée.
  const code = useMemo(() => {
    if (!identity || !contactKey) return null;
    try {
      return getVerificationCode(deriveSharedSecret(identity, contactKey));
    } catch {
      return [];
    }
  }, [identity, contactKey]);

  useEffect(() => {
    if (code?.length === 0) {
      Alert.alert('Clé non valide', 'Ce code ne permet pas de créer une connexion sûre.');
      setRoute({ name: 'home' });
    }
  }, [code]);

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
    if (route.name === 'chat') {
      const publicKey = route.publicKey;
      return (
        <ChatScreen
          key={publicKey}
          contactKey={publicKey}
          name={contacts.find((contact) => contact.publicKey === publicKey)?.name ?? 'Contact'}
          onBack={() => setRoute({ name: 'home' })}
          onInfo={() => setRoute({ name: 'contact', publicKey })}
        />
      );
    }
    if (route.name === 'contact' && code?.length) {
      const publicKey = route.publicKey;
      const saved = contacts.find((contact) => contact.publicKey === publicKey);
      const others = contacts.filter((contact) => contact.publicKey !== publicKey);
      return (
        <ContactScreen
          key={publicKey}
          initialName={saved?.name ?? ''}
          code={code}
          isNew={!saved}
          onBack={() => backFromContact(publicKey)}
          onSave={(name) => {
            updateContacts([...others, { publicKey, name }]);
            setRoute({ name: 'chat', publicKey });
          }}
          onShowMyCode={() => setRoute({ name: 'add' })}
          onRemove={() => {
            deleteMessages(publicKey);
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
        onOpen={(contact) => setRoute({ name: 'chat', publicKey: contact.publicKey })}
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
