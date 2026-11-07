import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Easing, BackHandler, Dimensions, StyleSheet, View } from 'react-native';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import notifee from '@notifee/react-native';

import { addBackListener, backHookAvailable, completeBack, setBackMode } from './modules/pear-native';
import { cleanupCache } from './src/chat/cleanup';
import { handleNotificationEvent } from './src/chat/notificationActions';
import { refreshRemoteConfig } from './src/remoteConfig';
import { deleteMessages, getContactProfile, openDatabase } from './src/chat/database';
import { clearNotificationTarget, setNotificationTarget, useNotificationTarget } from './src/chat/notificationTarget';
import { chat } from './src/chat/manager';
import { BottomBar, Tab } from './src/components/BottomBar';
import { DialogHost, showDialog } from './src/components/dialog';
import { ErrorBoundary, ErrorScreen } from './src/components/ErrorBoundary';
import { deriveSharedSecret, getVerificationCode, Identity, parsePairingLink } from './src/crypto/pairing';
import { AddContactScreen } from './src/screens/AddContactScreen';
import { CameraScreen } from './src/screens/CameraScreen';
import { ChatScreen } from './src/screens/chat/ChatScreen';
import { ContactScreen } from './src/screens/ContactScreen';
import { CustomizeScreen } from './src/screens/CustomizeScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { DiagnosticScreen } from './src/screens/DiagnosticScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { Contact, hasIdentity, loadContacts, loadOrCreateIdentity, saveContacts } from './src/storage';
import { createStyles, loadTheme, Palette, radius, spacing, useColors } from './src/theme';
import { markUpdateSeen, pendingUpdatedInfo, UpdatedInfo } from './src/update/updated';
import { UpdatedPopup } from './src/update/UpdatedPopup';
import { checkForUpdate, isBlocking, useUpdateState } from './src/update/updates';
import { UpdateScreen } from './src/update/UpdateScreen';
import { log } from './src/log';
import { t } from './src/i18n';

type Route =
  | { name: 'home' }
  | { name: 'add' }
  | { name: 'camera' }
  | { name: 'scan' }
  | { name: 'profile' }
  | { name: 'diagnostic' }
  | { name: 'customize'; publicKey: string }
  | { name: 'contact'; publicKey: string }
  | { name: 'chat'; publicKey: string };

const BACK_EXIT_MS = 170;
// Si le retour a seulement fermé quelque chose dans la page, celle-ci revient à sa place après ce délai.
const BACK_SETTLE_MS = 250;
const BACK_PAGE_SHIFT = 20;
const TAB_ROUTES: string[] = ['add', 'home', 'camera'];

export default function Root() {
  return (
    <ErrorBoundary name="app">
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const styles = useStyles();
  // Icônes des barres système : foncées sur le thème clair, claires sur le sombre.
  const colors = useColors();
  const barStyle = colors.scheme === 'dark' ? 'light' : 'dark';
  const themeFade = useThemeFade(colors);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [route, setRoute] = useState<Route>({ name: 'home' });
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [error, setError] = useState<string | null>(null);
  // « Relancer » sur l'écran d'erreur du démarrage refait tout le chargement.
  const [attempt, setAttempt] = useState(0);
  const [filming, setFilming] = useState(false);
  // L'écran précédent, montré sous la page pendant le geste de retour.
  const [peek, setPeek] = useState<{ route: Route; direction: number } | null>(null);
  const backGesture = useRef(new Animated.Value(0)).current;
  const gestureStarted = useRef(false);
  const url = Linking.useURL();
  const update = useUpdateState();
  const blocked = isBlocking(update);
  // Le popup « Pear est à jour ! » attend l'accueil, et ne passe jamais devant l'écran de mise à jour.
  const [updatedInfo, setUpdatedInfo] = useState<UpdatedInfo | null>(null);

  useEffect(() => {
    // La base est ouverte et migrée avant tout : un échec affiche une erreur au lieu de planter en boucle.
    Promise.resolve()
      .then(openDatabase)
      .then(loadTheme)
      .then(cleanupCache)
      .then(() => {
        refreshRemoteConfig();
      })
      .then(hasIdentity)
      .then(async (existed) => {
        const [savedIdentity, savedContacts] = await Promise.all([loadOrCreateIdentity(), loadContacts()]);
        setContacts(savedContacts);
        setIdentity(savedIdentity);
        setUpdatedInfo(pendingUpdatedInfo(existed));
      })
      .catch((e) => {
        log.error('démarrage', e);
        setError(String(e));
      });
  }, [attempt]);

  // Le retour prédictif dépend d'un champ privé de React Native : on le signale s'il a disparu.
  useEffect(() => {
    if (!backHookAvailable()) log.warn('retour prédictif indisponible : mBackPressedCallback introuvable');
  }, []);

  // Au lancement et à chaque retour au premier plan, avec un délai minimum entre deux vérifications.
  useEffect(() => {
    if (active) checkForUpdate();
  }, [active]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    notifee.requestPermission().catch((e) => log.warn('notification', e));

    // Appuyer sur une notification ouvre directement la conversation : app fermée (notification
    // initiale), au premier plan (ici) ou en arrière-plan (index.ts). L'ouverture se fait plus bas.
    notifee.getInitialNotification().then((initial) => setNotificationTarget(initial?.notification.data?.contact));
    const stopEvents = notifee.onForegroundEvent(handleNotificationEvent);
    // Les pushs reçus app ouverte sont traités par le moteur des conversations (connections.ts).
    return stopEvents;
  }, []);

  // On attend l'identité et les contacts. Un contact supprimé depuis ramène simplement à l'accueil.
  const notificationTarget = useNotificationTarget();
  useEffect(() => {
    if (!notificationTarget || !identity) return;
    clearNotificationTarget();
    const known = contacts.some((contact) => contact.publicKey === notificationTarget);
    setRoute(known ? { name: 'chat', publicKey: notificationTarget } : { name: 'home' });
  }, [notificationTarget, identity, contacts]);

  // Au premier plan, l'app garde les connexions ouvertes. En arrière-plan, seul un push la réveille.
  useEffect(() => {
    if (!identity) return;
    if (active) chat.sync(identity, contacts);
    else chat.stopAll();
  }, [identity, contacts, active]);

  const openKey = (publicKey: string) => {
    if (publicKey === identity?.publicKey) {
      showDialog(t('app.codeNonValide'), t('app.codePropre'));
      return;
    }
    setRoute({ name: 'contact', publicKey });
  };

  // Un lien pear://pair ouvert depuis une autre app arrive ici.
  useEffect(() => {
    if (!url || !identity || !url.startsWith('pear://pair')) return;
    const key = parsePairingLink(url);
    if (key) openKey(key);
    else showDialog(t('app.lienNonReconnu'), t('app.lienNonValide'));
  }, [url, identity]);

  const isSaved = (publicKey: string) => contacts.some((contact) => contact.publicKey === publicKey);

  const backFromContact = (publicKey: string) =>
    setRoute(isSaved(publicKey) ? { name: 'chat', publicKey } : { name: 'home' });

  const parentOf = (current: Route): Route | null => {
    if (current.name === 'home') return null;
    if (current.name === 'scan') return { name: 'add' };
    if (current.name === 'diagnostic') return { name: 'profile' };
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
    const mode = blocked ? 'default' : route.name === 'home' ? 'system' : route.name === 'camera' ? 'default' : 'app';
    setBackMode(mode).catch((e) => log.warn('retour', e));
  }, [route.name, blocked]);

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
          completeBack().catch((e) => log.warn('retour', e));
          setTimeout(resetBackGesture, BACK_SETTLE_MS);
        });
      } else {
        completeBack().catch((e) => log.warn('retour', e));
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
      showDialog(t('app.cleNonValide'), t('app.cleNonSure'));
      setRoute({ name: 'home' });
    }
  }, [code]);

  const updateContacts = (next: Contact[]) => {
    setContacts(next);
    saveContacts(next).catch((e) => showDialog(t('app.enregistrementImpossible'), String(e)));
  };

  const render = (current: Route, preview = false) => {
    if (error) {
      return (
        <ErrorScreen
          detail={error}
          onRetry={() => {
            setError(null);
            setAttempt((count) => count + 1);
          }}
        />
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
      return <ProfileScreen onBack={() => setRoute({ name: 'home' })} onDiagnostic={() => setRoute({ name: 'diagnostic' })} />;
    }
    if (current.name === 'diagnostic') {
      return <DiagnosticScreen onBack={() => setRoute({ name: 'profile' })} />;
    }
    if (current.name === 'customize') {
      const publicKey = current.publicKey;
      return (
        <CustomizeScreen
          contactKey={publicKey}
          name={contacts.find((contact) => contact.publicKey === publicKey)?.name ?? t('app.contact')}
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
          name={contacts.find((contact) => contact.publicKey === publicKey)?.name ?? t('app.contact')}
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

  if (blocked && update.release) {
    return (
      <>
        <StatusBar style={barStyle} />
        <NavigationBar style={barStyle} />
        <UpdateScreen release={update.release} />
        <DialogHost />
      </>
    );
  }

  return (
    <>
      <StatusBar style={barStyle} />
      <NavigationBar style={barStyle} />
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
        <ErrorBoundary key={route.name + ('publicKey' in route ? route.publicKey : '')} name={route.name}>
          {render(route)}
        </ErrorBoundary>
      </Animated.View>
      {identity && !error && !filming && TAB_ROUTES.includes(route.name) && (
        <BottomBar active={route.name as Tab} onChange={(tab) => setRoute({ name: tab } as Route)} />
      )}
      {updatedInfo && identity && route.name === 'home' && (
        <UpdatedPopup
          info={updatedInfo}
          onClose={() => {
            markUpdateSeen();
            setUpdatedInfo(null);
          }}
        />
      )}
      <DialogHost />
      {themeFade}
    </>
  );
}

const THEME_FADE_MS = 320;

// Voile de la couleur de l'ancien thème, qui s'efface pendant que le nouveau apparaît dessous.
function useThemeFade(colors: Palette) {
  const [veil, setVeil] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const previous = useRef(colors);

  useEffect(() => {
    if (previous.current === colors) return;
    const from = previous.current.background;
    previous.current = colors;
    setVeil(from);
    opacity.setValue(1);
    Animated.timing(opacity, { toValue: 0, duration: THEME_FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(() => setVeil(null));
  }, [colors, opacity]);

  return veil ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: veil, opacity }]} /> : null;
}

const useStyles = createStyles((colors) => ({
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
}));
