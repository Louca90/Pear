import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, BackHandler, Dimensions, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import notifee, { EventType } from '@notifee/react-native';
import { getMessaging, onMessage } from '@react-native-firebase/messaging';

import { addBackListener, completeBack, setBackMode } from './modules/pear-native';
import { deleteMessages, getContactProfile } from './src/chat/database';
import { chat } from './src/chat/manager';
import { BottomBar, Tab } from './src/components/BottomBar';
import { DialogHost, showDialog } from './src/components/dialog';
import { deriveSharedSecret, getVerificationCode, Identity, parsePairingLink } from './src/crypto/pairing';
import { AddContactScreen } from './src/screens/AddContactScreen';
import { CameraScreen } from './src/screens/CameraScreen';
import { ChatScreen } from './src/screens/chat/ChatScreen';
import { ContactScreen } from './src/screens/ContactScreen';
import { CustomizeScreen } from './src/screens/CustomizeScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { Contact, loadContacts, loadOrCreateIdentity, saveContacts } from './src/storage';
import { colors, radius, spacing } from './src/theme';

type Route =
  | { name: 'home' }
  | { name: 'add' }
  | { name: 'camera' }
  | { name: 'scan' }
  | { name: 'profile' }
  | { name: 'customize'; publicKey: string }
  | { name: 'contact'; publicKey: string }
  | { name: 'chat'; publicKey: string };

const BACK_EXIT_MS = 170;
// Si le retour a seulement fermé quelque chose dans la page, celle-ci revient à sa place après ce délai.
const BACK_SETTLE_MS = 250;
const BACK_PAGE_SHIFT = 20;
const TAB_ROUTES: string[] = ['add', 'home', 'camera'];

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [error, setError] = useState<string | null>(null);
  const [filming, setFilming] = useState(false);
  // L'écran précédent, montré sous la page pendant le geste de retour.
  const [peek, setPeek] = useState<{ route: Route; direction: number } | null>(null);
  const backGesture = useRef(new Animated.Value(0)).current;
  const gestureStarted = useRef(false);
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
      showDialog('Code non valide', "C'est votre propre code : scannez celui de votre contact.");
      return;
    }
    setRoute({ name: 'contact', publicKey });
  };

  // Un lien pear://pair ouvert depuis une autre app arrive ici.
  useEffect(() => {
    if (!url || !identity || !url.startsWith('pear://pair')) return;
    const key = parsePairingLink(url);
    if (key) openKey(key);
    else showDialog('Lien non reconnu', "Ce lien Pear n'est pas valide.");
  }, [url, identity]);

  const isSaved = (publicKey: string) => contacts.some((contact) => contact.publicKey === publicKey);

  const backFromContact = (publicKey: string) =>
    setRoute(isSaved(publicKey) ? { name: 'chat', publicKey } : { name: 'home' });

  const parentOf = (current: Route): Route | null => {
    if (current.name === 'home') return null;
    if (current.name === 'scan') return { name: 'add' };
    if (current.name === 'customize') return { name: 'chat', publicKey: current.publicKey };
    if (current.name === 'contact' && isSaved(current.publicKey)) return { name: 'chat', publicKey: current.publicKey };
    return { name: 'home' };
  };

  // Le bouton retour d'Android revient à l'écran précédent au lieu de quitter l'app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      const parent = parentOf(route);
      if (!parent) return false;
      setRoute(parent);
      return true;
    });
    return () => subscription.remove();
  }, [route, contacts]);

  // Sur l'accueil, Android montre lui-même l'aperçu pour quitter. L'appareil photo n'a pas d'aperçu.
  useEffect(() => {
    setBackMode(route.name === 'home' ? 'system' : route.name === 'camera' ? 'default' : 'app').catch((e) => console.warn('Pear retour :', e));
  }, [route.name]);

  const resetBackGesture = useRef(() => {
    gestureStarted.current = false;
    backGesture.setValue(0);
    setPeek(null);
  }).current;

  // Une fois sur le nouvel écran, on retire la copie posée dessous.
  useEffect(resetBackGesture, [route]);

  const latestParent = useRef(() => parentOf(route));
  latestParent.current = () => parentOf(route);

  useEffect(() => {
    const subscription = addBackListener(({ type, progress, fromRight }) => {
      if (type === 'started') {
        const parent = latestParent.current();
        if (!parent) return;
        gestureStarted.current = true;
        backGesture.setValue(0);
        setPeek({ route: parent, direction: fromRight ? -1 : 1 });
      } else if (type === 'progress') {
        backGesture.setValue(progress);
      } else if (type === 'cancelled') {
        Animated.spring(backGesture, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 260 }).start(resetBackGesture);
      } else if (gestureStarted.current) {
        Animated.timing(backGesture, { toValue: 2, duration: BACK_EXIT_MS, useNativeDriver: true }).start(() => {
          completeBack().catch((e) => console.warn('Pear retour :', e));
          setTimeout(resetBackGesture, BACK_SETTLE_MS);
        });
      } else {
        completeBack().catch((e) => console.warn('Pear retour :', e));
      }
    });
    return () => subscription.remove();
  }, [backGesture, resetBackGesture]);

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
      showDialog('Clé non valide', 'Ce code ne permet pas de créer une connexion sûre.');
      setRoute({ name: 'home' });
    }
  }, [code]);

  const updateContacts = (next: Contact[]) => {
    setContacts(next);
    saveContacts(next).catch((e) => showDialog('Enregistrement impossible', String(e)));
  };

  const render = (current: Route, preview = false) => {
    if (error) {
      return (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      );
    }
    if (!identity) return <View style={styles.center} />;

    if (current.name === 'add') {
      return (
        <AddContactScreen
          publicKey={identity.publicKey}
          onScan={() => setRoute({ name: 'scan' })}
          onKeyReceived={openKey}
        />
      );
    }
    if (current.name === 'scan') {
      return <ScannerScreen onBack={() => setRoute({ name: 'add' })} onKeyReceived={openKey} />;
    }
    if (current.name === 'camera') {
      return (
        <CameraScreen
          contacts={contacts}
          onSent={(publicKey) => setRoute({ name: 'chat', publicKey })}
          onRecordingChange={setFilming}
        />
      );
    }
    if (current.name === 'profile') {
      return <ProfileScreen onBack={() => setRoute({ name: 'home' })} />;
    }
    if (current.name === 'customize') {
      const publicKey = current.publicKey;
      return (
        <CustomizeScreen
          contactKey={publicKey}
          name={contacts.find((contact) => contact.publicKey === publicKey)?.name ?? 'Contact'}
          onBack={() => setRoute({ name: 'chat', publicKey })}
          onInfo={() => setRoute({ name: 'contact', publicKey })}
        />
      );
    }
    if (current.name === 'chat') {
      const publicKey = current.publicKey;
      return (
        <ChatScreen
          key={publicKey}
          contactKey={publicKey}
          name={contacts.find((contact) => contact.publicKey === publicKey)?.name ?? 'Contact'}
          onBack={() => setRoute({ name: 'home' })}
          onInfo={() => setRoute({ name: 'contact', publicKey })}
          onCustomize={() => setRoute({ name: 'customize', publicKey })}
          preview={preview}
        />
      );
    }
    if (current.name === 'contact' && code?.length) {
      const publicKey = current.publicKey;
      const saved = contacts.find((contact) => contact.publicKey === publicKey);
      const others = contacts.filter((contact) => contact.publicKey !== publicKey);
      return (
        <ContactScreen
          key={publicKey}
          initialName={saved?.name ?? ''}
          profile={getContactProfile(publicKey)}
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
        onProfile={() => setRoute({ name: 'profile' })}
      />
    );
  };

  const { width } = Dimensions.get('window');
  const direction = peek?.direction ?? 1;

  return (
    <>
      <StatusBar style="dark" />
      {peek && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {render(peek.route, true)}
          {!TAB_ROUTES.includes(route.name) && TAB_ROUTES.includes(peek.route.name) && (
            <BottomBar active={peek.route.name as Tab} onChange={() => {}} />
          )}
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              styles.backDim,
              { opacity: backGesture.interpolate({ inputRange: [0, 1, 2], outputRange: [0.35, 0.12, 0] }) },
            ]}
          />
        </View>
      )}
      <Animated.View
        style={[
          styles.flex,
          peek && styles.pageDuringBack,
          {
            opacity: backGesture.interpolate({ inputRange: [0, 1, 2], outputRange: [1, 1, 0] }),
            transform: [
              { translateX: backGesture.interpolate({ inputRange: [0, 1, 2], outputRange: [0, BACK_PAGE_SHIFT * direction, width * direction] }) },
              { scale: backGesture.interpolate({ inputRange: [0, 1, 2], outputRange: [1, 0.9, 0.86] }) },
            ],
          },
        ]}
      >
        {render(route)}
      </Animated.View>
      {identity && !error && !filming && TAB_ROUTES.includes(route.name) && (
        <BottomBar active={route.name as Tab} onChange={(tab) => setRoute({ name: tab } as Route)} />
      )}
      <DialogHost />
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  pageDuringBack: {
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  backDim: {
    backgroundColor: colors.text,
  },
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
