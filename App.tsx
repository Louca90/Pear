import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, AppState, Easing, BackHandler, PanResponder, StyleSheet, useWindowDimensions, View } from 'react-native';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import notifee from '@notifee/react-native';

import { backHookAvailable, setBackMode } from './modules/pear-native';
import { cleanupCache } from './src/chat/cleanup';
import { handleNotificationEvent } from './src/chat/notificationActions';
import { refreshRemoteConfig } from './src/remoteConfig';
import { deleteMessages, getContactProfile, isBlocked, openDatabase } from './src/chat/database';
import { clearNotificationTarget, REQUESTS_TARGET, setNotificationTarget, useNotificationTarget } from './src/chat/notificationTarget';
import { chat } from './src/chat/manager';
import { BottomBar, Tab } from './src/components/BottomBar';
import { DialogHost, showDialog } from './src/components/dialog';
import { ErrorBoundary, ErrorScreen } from './src/components/ErrorBoundary';
import { deriveSharedSecret, getVerificationCode, Identity, PairingLink, parsePairingLink } from './src/crypto/pairing';
import { ContactsScreen } from './src/screens/ContactsScreen';
import { CameraScreen } from './src/screens/CameraScreen';
import { ChatScreen } from './src/screens/chat/ChatScreen';
import { ContactScreen } from './src/screens/ContactScreen';
import { NotificationSettingsScreen } from './src/screens/NotificationSettingsScreen';
import { CustomizeScreen } from './src/screens/CustomizeScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { OnboardingScreen, OnboardingStep } from './src/onboarding/OnboardingScreen';
import { checkAllPermissions } from './src/onboarding/permissions';
import { isOnboardingDone, loadOnboardingStep, markOnboardingDone } from './src/onboarding/progress';
import { BlockedScreen } from './src/screens/BlockedScreen';
import { DiagnosticScreen } from './src/screens/DiagnosticScreen';
import { RequestsScreen } from './src/screens/RequestsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { runAutoCleanup, StorageScreen } from './src/screens/StorageScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { ScannerScreen } from './src/screens/ScannerScreen';
import { Contact, hasIdentity, loadContacts, loadOrCreateIdentity, saveContacts } from './src/storage';
import { createStyles, loadTheme, Palette, spacing, useColors } from './src/theme';
import { markUpdateSeen, pendingUpdatedInfo, UpdatedInfo } from './src/update/updated';
import { UpdatedPopup } from './src/update/UpdatedPopup';
import { checkForUpdate, isBlocking, useUpdateState } from './src/update/updates';
import { UpdateScreen } from './src/update/UpdateScreen';
import { log } from './src/log';
import { interceptBack } from './src/navigation/backInterceptors';
import { t } from './src/i18n';

type Route =
  | { name: 'home' }
  | { name: 'contacts' }
  | { name: 'camera' }
  | { name: 'scan' }
  | { name: 'profile' }
  | { name: 'diagnostic' }
  | { name: 'storage' }
  | { name: 'settings' }
  | { name: 'blocked' }
  | { name: 'requests' }
  | { name: 'customize'; publicKey: string }
  | { name: 'notifications'; publicKey: string }
  // name : le pseudo lu dans le QR code ou le lien, proposé comme nom du contact.
  | { name: 'contact'; publicKey: string; suggestedName?: string | null }
  | { name: 'chat'; publicKey: string };

// --- Navigation ---
// Animations fixes, sans suivre le doigt. Chaque écran a deux valeurs : enter (0 → 1 à son arrivée)
// et g (0 → 1 quand il part). La page qui part garde la sienne jusqu'à disparaître : rien n'est remis
// en place au changement d'écran, donc pas d'image de l'ancien écran.
const ENTER_MS = 180;
const EXIT_MS = 160;
// Démarre vite et se pose doucement, sans dépasser : jamais de rebond.
const NAV_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
// La page arrive de la droite et repart vers la droite ; l'écran d'en dessous se décale un peu.
const PAGE_SHIFT = 36;
const UNDER_SHIFT = 24;
// Glissement entre onglets : la page et l'onglet voisin suivent le doigt ; au-delà du seuil (ou d'un
// geste rapide), le voisin finit de prendre la place.
const TAB_SWIPE_RATIO = 0.3;
const TAB_SETTLE_MS = 180;
// Les bords restent au retour par geste d'Android.
const TAB_EDGE = 28;
// Dans l'ordre de la barre du bas : le glissement horizontal passe de l'un à l'autre.
const TAB_ROUTES: string[] = ['home', 'camera', 'contacts', 'profile'];
// L'écran parent reste monté sous la page (prêt pour le retour) ; pas la caméra, qui allumerait le capteur.
const NOT_KEPT_UNDER = ['camera', 'scan'];
// Délai avant de monter un parent qui ne l'était pas : la page qui vient d'arriver passe d'abord.
const PARENT_MOUNT_DELAY_MS = 600;

type PageMotion = { g: Animated.Value; enter: Animated.Value };

function sameDeps(a: unknown[], b: unknown[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function routeKey(route: Route) {
  return route.name + ('publicKey' in route ? `:${route.publicKey}` : '');
}

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
  const [route, setRouteState] = useState<Route>({ name: 'home' });
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [error, setError] = useState<string | null>(null);
  // « Relancer » sur l'écran d'erreur du démarrage refait tout le chargement.
  const [attempt, setAttempt] = useState(0);
  const [filming, setFilming] = useState(false);
  // Les mouvements de chaque page (par clé d'écran), et les écrans montés à l'image précédente.
  const motions = useRef(new Map<string, PageMotion>()).current;
  const motionFor = (key: string, entering = false) => {
    let motion = motions.get(key);
    if (!motion) {
      motion = { g: new Animated.Value(0), enter: new Animated.Value(entering ? 0 : 1) };
      motions.set(key, motion);
    }
    return motion;
  };
  const currentKey = routeKey(route);
  const mountedKeys = useRef(new Set<string>([currentKey]));
  const [parentReady, setParentReady] = useState(false);
  const exiting = useRef(false);
  // Les valeurs à jour pour les fonctions créées une seule fois (écouteurs, navigation).
  const nav = useRef<{ route: Route; parent: Route | null }>({ route, parent: null });
  const tabDrag = useRef(new Animated.Value(0)).current;
  const { width: screenWidth } = useWindowDimensions();
  const url = Linking.useURL();
  const update = useUpdateState();
  const blocked = isBlocking(update);
  // Le popup « Pear est à jour ! » attend l'accueil, et ne passe jamais devant l'écran de mise à jour.
  const [updatedInfo, setUpdatedInfo] = useState<UpdatedInfo | null>(null);
  const [onboarding, setOnboarding] = useState<{ mode: 'full' | 'permissions'; step: OnboardingStep } | null>(null);
  // Une autorisation retirée depuis la prise en main : un bandeau discret sur l'accueil.
  const [permissionMissing, setPermissionMissing] = useState(false);

  useEffect(() => {
    // La base est ouverte et migrée avant tout : un échec affiche une erreur au lieu de planter en boucle.
    Promise.resolve()
      .then(openDatabase)
      .then(loadTheme)
      .then(() => {
        cleanupCache();
        runAutoCleanup();
      })
      .then(() => {
        refreshRemoteConfig();
      })
      .then(hasIdentity)
      .then(async (existed) => {
        const [savedIdentity, savedContacts] = await Promise.all([loadOrCreateIdentity(), loadContacts()]);
        // Prise en main en entier pour tout le monde, une fois (nouveau téléphone, ou mise à jour depuis une
        // version qui ne l'avait pas) : nom et photo déjà enregistrés sont préremplis.
        if (!isOnboardingDone()) setOnboarding({ mode: 'full', step: loadOnboardingStep() });
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
    if (notificationTarget === REQUESTS_TARGET) {
      setRoute({ name: 'requests' });
      return;
    }
    const known = contacts.some((contact) => contact.publicKey === notificationTarget);
    setRoute(known ? { name: 'chat', publicKey: notificationTarget } : { name: 'home' });
  }, [notificationTarget, identity, contacts]);

  // Au premier plan, l'app garde les connexions ouvertes. En arrière-plan, seul un push la réveille.
  useEffect(() => {
    if (!identity) return;
    if (active) chat.sync(identity, contacts);
    else chat.stopAll();
  }, [identity, contacts, active]);

  const openKey = ({ publicKey, name }: PairingLink) => {
    if (publicKey === identity?.publicKey) {
      showDialog(t('app.codeNonValide'), t('app.codePropre'));
      return;
    }
    setRoute({ name: 'contact', publicKey, suggestedName: name });
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
    if (current.name === 'scan') return { name: 'contacts' };
    if (current.name === 'diagnostic' || current.name === 'blocked' || current.name === 'storage') return { name: 'settings' };
    if (current.name === 'settings') return { name: 'profile' };
    if (current.name === 'customize') return { name: 'chat', publicKey: current.publicKey };
    if (current.name === 'notifications') return { name: 'customize', publicKey: current.publicKey };
    if (current.name === 'contact' && isSaved(current.publicKey)) return { name: 'chat', publicKey: current.publicKey };
    return { name: 'home' };
  };

  nav.current = { route, parent: identity ? parentOf(route) : null };

  // Le bouton retour d'Android revient à l'écran précédent au lieu de quitter l'app.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      // Un élément ouvert dans la page (sélection…) se ferme d'abord.
      if (interceptBack()) return true;
      const parent = parentOf(route);
      if (!parent) return false;
      setRoute(parent);
      return true;
    });
    return () => subscription.remove();
  }, [route, contacts]);

  // Sur l'accueil, Android montre lui-même l'aperçu pour quitter ; ailleurs, le retour est l'animation de Pear.
  useEffect(() => {
    const mode = blocked || onboarding ? 'default' : route.name === 'home' ? 'system' : 'default';
    setBackMode(mode).catch((e) => log.warn('retour', e));
  }, [route.name, blocked, onboarding]);

  // À chaque retour au premier plan, une fois la prise en main finie : les autorisations sont-elles toujours là ?
  useEffect(() => {
    if (!active || onboarding || !identity) return;
    checkAllPermissions()
      .then((states) => setPermissionMissing(Object.values(states).some((state) => state !== 'granted')))
      .catch((e) => log.warn('autorisations', e));
  }, [active, onboarding, identity]);

  // L'onglet voisin affiché pendant le glissement : 1 à droite (suivant), -1 à gauche (précédent).
  const [neighbor, setNeighbor] = useState<{ name: string; side: 1 | -1 } | null>(null);
  const latestRouteName = useRef(route.name);
  latestRouteName.current = route.name;

  const neighborOf = (dx: number) => {
    const index = TAB_ROUTES.indexOf(latestRouteName.current);
    const side: 1 | -1 = dx < 0 ? 1 : -1;
    const name = TAB_ROUTES[index + side];
    return name ? { name, side } : null;
  };

  const isTabSwipe = ({ dx, dy, x0 }: { dx: number; dy: number; x0: number }) =>
    TAB_ROUTES.includes(latestRouteName.current) && x0 > TAB_EDGE && x0 < screenWidth - TAB_EDGE && Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy) * 2;

  const settleTab = (toValue: number, then: () => void) =>
    Animated.timing(tabDrag, { toValue, duration: TAB_SETTLE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(then);

  const tabSwipe = useRef(
    PanResponder.create({
      // Sur la caméra, capturé avant l'image (le glissé vertical y change de caméra) ; ailleurs, les zones
      // qui défilent horizontalement (catégories) gardent la main. Les bords restent au retour d'Android.
      onMoveShouldSetPanResponderCapture: (event, gesture) => latestRouteName.current === 'camera' && isTabSwipe(gesture),
      onMoveShouldSetPanResponder: (event, gesture) => isTabSwipe(gesture),
      onPanResponderMove: (event, { dx }) => {
        const next = neighborOf(dx);
        // Pas d'onglet de ce côté : la page résiste un peu.
        tabDrag.setValue(next ? dx : dx * 0.2);
        setNeighbor((current) => (current?.name === next?.name ? current : next));
      },
      onPanResponderRelease: (event, { dx, vx }) => {
        const next = neighborOf(dx);
        if (next && (Math.abs(dx) > screenWidth * TAB_SWIPE_RATIO || Math.abs(vx) > 0.5)) {
          settleTab(-next.side * screenWidth, () => {
            setRoute({ name: next.name } as Route);
            tabDrag.setValue(0);
            setNeighbor(null);
          });
        } else settleTab(0, () => setNeighbor(null));
      },
      onPanResponderTerminate: () => settleTab(0, () => setNeighbor(null)),
    }),
  ).current;

  // Retour animé vers le parent : la page repart vers la droite en s'effaçant, le parent (déjà monté)
  // reprend sa place.
  const animateBack = useRef(() => {
    const parent = nav.current.parent;
    if (!parent || exiting.current) return;
    exiting.current = true;
    const { g } = motionFor(routeKey(nav.current.route));
    Animated.timing(g, { toValue: 1, duration: EXIT_MS, easing: NAV_EASING, useNativeDriver: true }).start(() => {
      exiting.current = false;
      setRouteState(parent);
    });
  }).current;

  // Toute la navigation passe par ici : revenir au parent déjà monté est animé, aller ailleurs fait
  // entrer la nouvelle page en fondu. Entre deux onglets, rien (la barre du bas a son animation).
  const setRoute = useRef((next: Route) => {
    if (exiting.current) return;
    const current = nav.current.route;
    const nextKey = routeKey(next);
    if (nextKey === routeKey(current)) {
      setRouteState(next);
      return;
    }
    const betweenTabs = TAB_ROUTES.includes(current.name) && TAB_ROUTES.includes(next.name);
    const parent = nav.current.parent;
    if (!betweenTabs && parent && routeKey(parent) === nextKey && mountedKeys.current.has(nextKey)) {
      animateBack();
      return;
    }
    if (!betweenTabs && !mountedKeys.current.has(nextKey)) {
      motions.delete(nextKey);
      motionFor(nextKey, true);
    }
    setRouteState(next);
  }).current;

  // Nouvel écran : l'écran qui arrive fait son entrée, les mouvements des pages parties sont oubliés,
  // et le parent sera monté dessous (prêt pour le retour) après un court délai.
  useEffect(() => {
    const { enter } = motionFor(currentKey);
    Animated.timing(enter, { toValue: 1, duration: ENTER_MS, easing: NAV_EASING, useNativeDriver: true }).start();
    for (const key of [...motions.keys()]) if (!mountedKeys.current.has(key)) motions.delete(key);
    setParentReady(false);
    const timer = setTimeout(() => setParentReady(true), PARENT_MOUNT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [currentKey]);

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

  // Une demande acceptée de l'autre côté (ou des scans croisés) change la liste sans passer par l'écran.
  useEffect(
    () =>
      chat.onContactsChanged(() => {
        loadContacts()
          .then(setContacts)
          .catch((e) => log.warn('contacts', e));
      }),
    [],
  );

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

    if (current.name === 'contacts') {
      return (
        <ContactsScreen
          publicKey={identity.publicKey}
          contacts={contacts}
          onScan={() => setRoute({ name: 'scan' })}
          onKeyReceived={openKey}
          onRequests={() => setRoute({ name: 'requests' })}
          onOpenContact={(contact) => setRoute({ name: 'contact', publicKey: contact.publicKey })}
          onMessage={(contact) => setRoute({ name: 'chat', publicKey: contact.publicKey })}
        />
      );
    }
    if (current.name === 'scan') {
      return <ScannerScreen onBack={() => setRoute({ name: 'contacts' })} onKeyReceived={openKey} />;
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
      return <ProfileScreen onSettings={() => setRoute({ name: 'settings' })} />;
    }
    if (current.name === 'settings') {
      return (
        <SettingsScreen
          onBack={() => setRoute({ name: 'profile' })}
          onDiagnostic={() => setRoute({ name: 'diagnostic' })}
          onBlocked={() => setRoute({ name: 'blocked' })}
          onStorage={() => setRoute({ name: 'storage' })}
          onReplayOnboarding={() => setOnboarding({ mode: 'full', step: 0 })}
        />
      );
    }
    if (current.name === 'storage') {
      return <StorageScreen contacts={contacts} onBack={() => setRoute({ name: 'settings' })} />;
    }
    if (current.name === 'diagnostic') {
      return <DiagnosticScreen onBack={() => setRoute({ name: 'settings' })} />;
    }
    if (current.name === 'blocked') {
      return <BlockedScreen onBack={() => setRoute({ name: 'settings' })} />;
    }
    if (current.name === 'requests') {
      return (
        <RequestsScreen
          identity={identity}
          onBack={() => setRoute({ name: 'home' })}
          onAccept={(publicKey, name) => {
            // Le contact est enregistré d'abord : le message « accepté » part vers un contact connu.
            const others = contacts.filter((contact) => contact.publicKey !== publicKey);
            updateContacts([...others, { publicKey, name }]);
            chat.acceptRequest(publicKey);
          }}
        />
      );
    }
    if (current.name === 'customize') {
      const publicKey = current.publicKey;
      return (
        <CustomizeScreen
          contactKey={publicKey}
          name={contacts.find((contact) => contact.publicKey === publicKey)?.name ?? t('app.contact')}
          onBack={() => setRoute({ name: 'chat', publicKey })}
          onInfo={() => setRoute({ name: 'contact', publicKey })}
          onNotifications={() => setRoute({ name: 'notifications', publicKey })}
        />
      );
    }
    if (current.name === 'notifications') {
      const publicKey = current.publicKey;
      return (
        <NotificationSettingsScreen
          contactKey={publicKey}
          name={contacts.find((contact) => contact.publicKey === publicKey)?.name ?? t('app.contact')}
          onBack={() => setRoute({ name: 'customize', publicKey })}
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
          pending={contacts.find((contact) => contact.publicKey === publicKey)?.pending ?? false}
          onBack={() => setRoute({ name: 'home' })}
          onInfo={() => setRoute({ name: 'contact', publicKey })}
          onCustomize={() => setRoute({ name: 'customize', publicKey })}
          preview={preview}
        />
      );
    }
    // code : la clé scannée est valide (sinon un message et retour à l'accueil, plus haut).
    if (current.name === 'contact' && code?.length) {
      const publicKey = current.publicKey;
      const saved = contacts.find((contact) => contact.publicKey === publicKey);
      const others = contacts.filter((contact) => contact.publicKey !== publicKey);
      return (
        <ContactScreen
          key={publicKey}
          initialName={saved?.name ?? current.suggestedName ?? ''}
          profile={getContactProfile(publicKey)}
          isNew={!saved}
          onBack={() => backFromContact(publicKey)}
          onSave={(name) => {
            // Un nouveau contact attend que l'autre accepte la demande ; un contact connu reste tel quel.
            const pending = saved ? saved.pending : true;
            updateContacts([...others, { publicKey, name, ...(pending ? { pending: true } : {}) }]);
            if (!saved) chat.requestPairing(publicKey);
            setRoute({ name: 'chat', publicKey });
          }}
          contactKey={publicKey}
          blocked={isBlocked(publicKey)}
          onToggleBlock={() => (isBlocked(publicKey) ? chat.unblockContact(publicKey) : chat.blockContact(publicKey))}
          onRemove={() => {
            chat.notifyRemoved(publicKey);
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
        onAdd={() => setRoute({ name: 'contacts' })}
        onOpen={(contact) => setRoute({ name: 'chat', publicKey: contact.publicKey })}
        onRequests={() => setRoute({ name: 'requests' })}
        permissionMissing={permissionMissing}
        onFixPermissions={() => setOnboarding({ mode: 'permissions', step: 1 })}
      />
    );
  };

  // Les écrans montés : la page, son parent (et au-dessus les ancêtres déjà montés), chacun gardé par
  // sa clé pour ne jamais être remonté. Sous un onglet, rien : les onglets glissent entre eux.
  const layers: Route[] = [route];
  if (identity && !TAB_ROUTES.includes(route.name)) {
    let ancestor = parentOf(route);
    while (ancestor && layers.length < 4) {
      const key = routeKey(ancestor);
      const isParent = layers.length === 1;
      if (NOT_KEPT_UNDER.includes(ancestor.name) || !(mountedKeys.current.has(key) || (isParent && parentReady))) break;
      layers.unshift(ancestor);
      if (TAB_ROUTES.includes(ancestor.name)) break;
      ancestor = parentOf(ancestor);
    }
  }
  mountedKeys.current = new Set(layers.map(routeKey));

  // Le contenu des écrans du dessous n'est recalculé que si ses données changent : la conversation sous
  // la personnalisation ne se redessine pas quand on navigue au-dessus.
  const renderDeps = [contacts, identity, error, code, permissionMissing];
  const pageCache = useRef(new Map<string, { deps: unknown[]; preview: boolean; element: ReactNode }>()).current;
  for (const key of [...pageCache.keys()]) if (!mountedKeys.current.has(key)) pageCache.delete(key);
  const renderPage = (layer: Route, isTop: boolean) => {
    const key = routeKey(layer);
    const cached = pageCache.get(key);
    if (!isTop && cached && sameDeps(cached.deps, renderDeps)) return cached.element;
    const preview = isTop ? false : (cached?.preview ?? true);
    const element = <ErrorBoundary name={layer.name}>{render(layer, preview)}</ErrorBoundary>;
    pageCache.set(key, { deps: renderDeps, preview, element });
    return element;
  };
  const top = motionFor(currentKey);

  if (onboarding && identity && !blocked) {
    return (
      <>
        <StatusBar style={barStyle} />
        <NavigationBar style={barStyle} />
        <OnboardingScreen
          mode={onboarding.mode}
          initialStep={onboarding.step}
          onDone={() => {
            markOnboardingDone();
            setOnboarding(null);
            setPermissionMissing(false);
            // Sans contact, on ouvre directement l'onglet Contacts (montrer son code, scanner) : c'est la première chose à faire.
            if (onboarding.mode === 'full') setRoute(contacts.length === 0 ? { name: 'contacts' } : { name: 'home' });
          }}
        />
        <DialogHost />
      </>
    );
  }

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
      {/* Retour en arrière, en fondu : la page se réduit, s'écarte du côté du geste et s'efface ; le parent,
          déjà monté dessous, se rapproche. À l'arrivée d'un écran, il entre en fondu sur l'ancien. */}
      {layers.map((layer, index) => {
        const key = routeKey(layer);
        const isTop = index === layers.length - 1;
        if (!isTop) {
          const isParent = index === layers.length - 2;
          return (
            <Animated.View
              key={key}
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                isParent
                  ? {
                      // Se décale un peu à gauche quand la page arrive, revient quand elle repart.
                      transform: [{ translateX: Animated.multiply(top.enter, top.g.interpolate({ inputRange: [0, 1], outputRange: [-UNDER_SHIFT, 0] })) }],
                    }
                  : styles.hidden,
              ]}
            >
              {renderPage(layer, false)}
              {!TAB_ROUTES.includes(route.name) && TAB_ROUTES.includes(layer.name) && <BottomBar active={layer.name as Tab} onChange={() => {}} />}
            </Animated.View>
          );
        }
        return (
          <Animated.View
            key={key}
            {...tabSwipe.panHandlers}
            style={[
              StyleSheet.absoluteFill,
              {
                // Arrive de la droite en fondu ; au retour, repart vers la droite en s'effaçant.
                opacity: Animated.multiply(top.enter, top.g.interpolate({ inputRange: [0, 1], outputRange: [1, 0] })),
                transform: [
                  {
                    translateX: Animated.add(
                      Animated.add(top.enter.interpolate({ inputRange: [0, 1], outputRange: [PAGE_SHIFT, 0] }), top.g.interpolate({ inputRange: [0, 1], outputRange: [0, PAGE_SHIFT] })),
                      tabDrag,
                    ),
                  },
                ],
              },
            ]}
          >
            {renderPage(layer, true)}
          </Animated.View>
        );
      })}
      {neighbor && (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { transform: [{ translateX: Animated.add(tabDrag, neighbor.side * screenWidth) }] }]}
        >
          {/* La caméra n'est pas allumée pour un simple glissement : un fond noir la représente. */}
          {neighbor.name === 'camera' ? <View style={styles.cameraPlaceholder} /> : render({ name: neighbor.name } as Route, true)}
        </Animated.View>
      )}
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
  cameraPlaceholder: {
    flex: 1,
    backgroundColor: '#000000',
  },
  hidden: {
    opacity: 0,
  },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
}));
