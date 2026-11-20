import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Keyboard, PanResponder, StyleSheet, useWindowDimensions, View } from 'react-native';
import Reanimated, { Easing, makeMutable, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Linking from 'expo-linking';
import notifee from '@notifee/react-native';

import { backHookAvailable, setBackMode, setSecureWindow } from './modules/pear-native';
import { LockScreen } from './src/components/LockScreen';
import { shouldLock } from './src/lockRules';
import { cleanupCache } from './src/chat/cleanup';
import { migrateStoredFiles } from './src/chat/media';
import { handleNotificationEvent } from './src/chat/notificationActions';
import { refreshRemoteConfig } from './src/remoteConfig';
import { deleteMessages, getContactProfile, getSetting, isBlocked, openDatabase, setContactVerified } from './src/chat/database';
import { clearNotificationTarget, REQUESTS_TARGET, setNotificationTarget, useNotificationTarget } from './src/chat/notificationTarget';
import { chat } from './src/chat/manager';
import { BottomBar, Tab } from './src/components/BottomBar';
import { DialogHost, showDialog } from './src/components/dialog';
import { ErrorBoundary, ErrorScreen } from './src/components/ErrorBoundary';
import { deriveSharedSecret, getVerificationCode, Identity, PairingLink, parsePairingLink } from './src/crypto/pairing';
import { PairSheet } from './src/components/PairSheet';
import { CameraScreen } from './src/screens/CameraScreen';
import { ChatScreen } from './src/screens/chat/ChatScreen';
import { isSelf } from './src/chat/self';
import { ContactScreen } from './src/screens/ContactScreen';
import { NotificationSettingsScreen } from './src/screens/NotificationSettingsScreen';
import { CustomizeScreen } from './src/screens/CustomizeScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { OnboardingScreen, OnboardingStep } from './src/onboarding/OnboardingScreen';
import { checkAllPermissions } from './src/onboarding/permissions';
import { setPermissionsMissing } from './src/onboarding/permissionStatus';
import { isOnboardingDone, loadOnboardingStep, markOnboardingDone } from './src/onboarding/progress';
import { BlockedScreen } from './src/screens/BlockedScreen';
import { DiagnosticScreen } from './src/screens/DiagnosticScreen';
import { RequestsScreen } from './src/screens/RequestsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { ServersScreen } from './src/screens/ServersScreen';
import { runAutoCleanup, StorageScreen } from './src/screens/StorageScreen';
import type { ChatIntent } from './src/screens/chat/ChatScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { MapScreen } from './src/screens/MapScreen';
import { onOpenMap } from './src/map/openMap';
import { AppearancePage, BackupPage, NotificationsPage, PermissionsPage, PrivacyPage, SettingsPage, UpdatesPage } from './src/screens/settings/SettingsPages';
import { Contact, hasIdentity, loadContacts, loadOrCreateIdentity, saveContacts } from './src/storage';
import { createStyles, fixed, loadTheme, motion, Palette, spacing, useColors } from './src/theme';
import { markUpdateSeen, pendingUpdatedInfo, UpdatedInfo } from './src/update/updated';
import { UpdatedPopup } from './src/update/UpdatedPopup';
import { WhatsNew } from './src/update/WhatsNew';
import { DiscoverScreen } from './src/screens/DiscoverScreen';
import { checkForUpdate, isBlocking, useUpdateState } from './src/update/updates';
import { UpdateScreen } from './src/update/UpdateScreen';
import { log } from './src/log';
import { interceptBack } from './src/navigation/backInterceptors';
import { isTabSwipeLocked } from './src/components/tabSwipeLock';
import { markCameraRequested } from './src/screens/cameraTiming';
import { isCameraLive, setCameraShown, wakeCamera } from './src/screens/cameraStandby';
import { ShareReceiver } from './src/components/ShareReceiver';
import { CallLayer } from './src/screens/CallScreen';
import { t } from './src/i18n';

type Route =
  | { name: 'home' }
  // to : ouvert depuis une conversation, la photo part directement à ce contact.
  | { name: 'camera'; to?: string }
  | { name: 'profile' }
  | { name: 'diagnostic' }
  | { name: 'storage' }
  | { name: 'servers' }
  | { name: 'discover' }
  | { name: 'settings' }
  // La carte des contacts ; focus : le contact à montrer d'abord.
  | { name: 'map'; focus: string | null }
  // Une catégorie des réglages, ouverte depuis le Profil.
  | { name: 'settingsPage'; page: SettingsPage }
  | { name: 'blocked' }
  | { name: 'requests' }
  | { name: 'customize'; publicKey: string }
  | { name: 'notifications'; publicKey: string }
  // name : le pseudo lu dans le QR code ou le lien, proposé comme nom du contact.
  | { name: 'contact'; publicKey: string; suggestedName?: string | null; tab?: 'profile' | 'media' }
  // jump : message à rejoindre à l'ouverture (résultat de recherche).
  | { name: 'chat'; publicKey: string; jump?: string; intent?: ChatIntent };

// --- Navigation ---
// Animations fixes, sans suivre le doigt. Chaque écran a deux valeurs : enter (0 → 1 à son arrivée)
// et g (0 → 1 quand il part). La page qui part garde la sienne jusqu'à disparaître : rien n'est remis
// en place au changement d'écran, donc pas d'image de l'ancien écran. Durée et courbe : motion.screen
// et SCREEN_EASE (plus bas), 0 si Android a « Supprimer les animations ».
// La page arrive de la droite et repart vers la droite ; l'écran d'en dessous se décale un peu.
const PAGE_SHIFT = 36;
const UNDER_SHIFT = 24;
// Glissement entre onglets : la page et l'onglet voisin suivent le doigt ; au-delà du seuil (ou d'un
// geste rapide), le voisin finit de prendre la place.
const TAB_SWIPE_RATIO = 0.3;
// Les bords restent au retour par geste d'Android.
const TAB_EDGE = 28;
// Dans l'ordre de la barre du bas : le glissement horizontal passe de l'un à l'autre.
const TAB_ROUTES: string[] = ['home', 'camera', 'map', 'profile'];
// L'écran parent reste monté sous la page (prêt pour le retour) ; pas la caméra, qui allumerait le capteur.
const NOT_KEPT_UNDER = ['camera', 'scan'];
// Délai avant de monter un parent qui ne l'était pas : la page qui vient d'arriver passe d'abord.
const PARENT_MOUNT_DELAY_MS = 600;

type PageMotion = { g: SharedValue<number>; enter: SharedValue<number> };

// La courbe des écrans (douce, sans dépassement), sur le fil de l'interface.
const SCREEN_EASE = Easing.bezier(0.2, 0.8, 0.2, 1);
const screenTiming = () => ({ duration: motion.screen, easing: SCREEN_EASE });

type LayerKind = 'top' | 'parent' | 'hidden';

// L'enveloppe de chaque page montée. Toujours le même composant, quelle que soit sa place : une page qui
// passe du dessus au-dessous (ou l'inverse) n'est jamais remontée.
// top : arrive de la droite en fondu ; au retour, repart vers la droite en s'effaçant.
// parent : se décale un peu à gauche quand la page arrive, revient quand elle repart.
function PageLayer({ kind, top, tabDrag, handlers, children }: { kind: LayerKind; top: PageMotion; tabDrag: SharedValue<number>; handlers?: object; children: ReactNode }) {
  const style = useAnimatedStyle(() => {
    if (kind === 'hidden') return { opacity: 0, transform: [{ translateX: 0 }] };
    const enter = top.enter.get();
    const g = top.g.get();
    if (kind === 'parent') return { opacity: 1, transform: [{ translateX: enter * (-UNDER_SHIFT + UNDER_SHIFT * g) }] };
    return { opacity: enter * (1 - g), transform: [{ translateX: PAGE_SHIFT * (1 - enter) + PAGE_SHIFT * g + tabDrag.get() }] };
  });
  return (
    <Reanimated.View pointerEvents={kind === 'top' ? 'auto' : 'none'} {...handlers} style={[StyleSheet.absoluteFill, style]}>
      {children}
    </Reanimated.View>
  );
}

// L'onglet voisin pendant le glissement entre onglets.
function NeighborLayer({ tabDrag, offset, children }: { tabDrag: SharedValue<number>; offset: number; children: ReactNode }) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tabDrag.get() + offset }] }));
  return (
    <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {children}
    </Reanimated.View>
  );
}

function sameDeps(a: unknown[], b: unknown[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function routeKey(route: Route) {
  return route.name + ('publicKey' in route ? `:${route.publicKey}` : '');
}

const rootStyle = StyleSheet.create({ flex: { flex: 1 } });

export default function Root() {
  return (
    // Racine des gestes (gesture-handler) pour toute l'app : bulles, micro, éditeur…
    <GestureHandlerRootView style={rootStyle.flex}>
      <ErrorBoundary name="app">
        <App />
      </ErrorBoundary>
    </GestureHandlerRootView>
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
      motion = { g: makeMutable(0), enter: makeMutable(entering ? 0 : 1) };
      motions.set(key, motion);
    }
    return motion;
  };
  const currentKey = routeKey(route);
  const mountedKeys = useRef(new Set<string>([currentKey]));
  const [parentReady, setParentReady] = useState(false);
  const exiting = useRef(false);
  const [leavingKey, setLeavingKey] = useState<string | null>(null);
  // Les valeurs à jour pour les fonctions créées une seule fois (écouteurs, navigation).
  const nav = useRef<{ route: Route; parent: Route | null }>({ route, parent: null });
  const tabDrag = useSharedValue(0);
  const { width: screenWidth } = useWindowDimensions();
  const url = Linking.useURL();
  const update = useUpdateState();
  const blocked = isBlocking(update);
  // Le popup « Pear est à jour ! » attend l'accueil, et ne passe jamais devant l'écran de mise à jour.
  const [updatedInfo, setUpdatedInfo] = useState<UpdatedInfo | null>(null);
  // Jamais deux fois pour la même version : fermer, passer ou revenir en arrière la marque comme vue.
  const closeUpdated = () => {
    markUpdateSeen();
    setUpdatedInfo(null);
  };
  const [onboarding, setOnboarding] = useState<{ mode: 'full' | 'permissions'; step: OnboardingStep } | null>(null);
  // La feuille « QR code » (mon code, scanner), ouverte depuis l'accueil.
  const [pairOpen, setPairOpen] = useState(false);

  useEffect(() => {
    // La base est ouverte et migrée avant tout : un échec affiche une erreur au lieu de planter en boucle.
    Promise.resolve()
      .then(openDatabase)
      .then(() => setLocked(getSetting('app_lock') === '1'))
      .then(loadTheme)
      .then(() => {
        cleanupCache();
        runAutoCleanup();
        // Lot 2.3 : les fichiers encore en clair sont chiffrés en tâche de fond, après le démarrage.
        setTimeout(() => migrateStoredFiles(), 5000);
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
        setLocked(false);
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

  // Verrou : fermé au lancement, puis après 1 minute en arrière-plan. La fenêtre de demande d'empreinte
  // ne met pas Pear en arrière-plan ; si elle le faisait, le délai d'une minute protège de toute façon.
  // null : réglage pas encore lu (base en cours d'ouverture), l'écran reste couvert sans rien demander.
  const [locked, setLocked] = useState<boolean | null>(null);
  const backgroundedAt = useRef<number | null>(null);
  useEffect(() => {
    // En debug, captures permises pour tester l'interface ; la release reste toujours protégée.
    setSecureWindow(!__DEV__).catch((e) => log.warn('fenêtre protégée', e));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        let enabled = false;
        try {
          enabled = getSetting('app_lock') === '1';
        } catch {}
        if (shouldLock(enabled, backgroundedAt.current, Date.now())) setLocked(true);
        backgroundedAt.current = null;
      } else if (backgroundedAt.current === null) {
        backgroundedAt.current = Date.now();
      }
    });
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
    // Ouverts depuis une page des réglages (ou depuis Tous les réglages, qui y ramène aussi).
    if (current.name === 'servers' || current.name === 'blocked') return { name: 'settingsPage', page: 'privacy' };
    if (current.name === 'diagnostic' || current.name === 'discover') return { name: 'settingsPage', page: 'updates' };
    if (current.name === 'storage' || current.name === 'settings' || current.name === 'settingsPage') return { name: 'profile' };
    if (current.name === 'customize') return { name: 'chat', publicKey: current.publicKey };
    if (current.name === 'camera' && current.to) return { name: 'chat', publicKey: current.to };
    if (current.name === 'notifications') return { name: 'customize', publicKey: current.publicKey };
    if (current.name === 'contact' && isSaved(current.publicKey)) return { name: 'chat', publicKey: current.publicKey };
    return { name: 'home' };
  };

  nav.current = { route, parent: identity ? parentOf(route) : null };

  // Un code scanné ouvre « Nouveau contact » ; revenir sans l'ajouter ramène à la feuille QR code.
  const pairReturn = useRef<string | null>(null);
  useEffect(() => {
    const key = pairReturn.current;
    if (!key) return;
    if (route.name === 'contact' && route.publicKey === key) return;
    pairReturn.current = null;
    if (route.name === 'home' && !isSaved(key)) setPairOpen(true);
  }, [route]);

  // Une bulle de position (ou autre) demande la carte.
  useEffect(() => onOpenMap((focus) => setRoute({ name: 'map', focus })), []);

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
      .then((states) => setPermissionsMissing(Object.values(states).some((state) => state !== 'granted')))
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
    TAB_ROUTES.includes(latestRouteName.current) &&
    // La carte garde tous les glissés (déplacer, zoomer) : on change d'onglet par la barre du bas.
    latestRouteName.current !== 'map' &&
    !isTabSwipeLocked() && x0 > TAB_EDGE && x0 < screenWidth - TAB_EDGE && Math.abs(dx) > 24 && Math.abs(dx) > Math.abs(dy) * 2;

  const settleTab = (toValue: number, then: () => void) =>
    tabDrag.set(
      withTiming(toValue, screenTiming(), (finished) => {
        if (finished) scheduleOnRN(then);
      }),
    );

  const tabSwipe = useRef(
    PanResponder.create({
      // Sur la caméra, capturé avant l'image (le glissé vertical y change de caméra) ; ailleurs, les zones
      // qui défilent horizontalement (catégories) gardent la main. Les bords restent au retour d'Android.
      onMoveShouldSetPanResponderCapture: (event, gesture) => latestRouteName.current === 'camera' && isTabSwipe(gesture),
      onMoveShouldSetPanResponder: (event, gesture) => isTabSwipe(gesture),
      onPanResponderMove: (event, { dx }) => {
        const next = neighborOf(dx);
        // Pas d'onglet de ce côté : la page résiste un peu.
        tabDrag.set(next ? dx : dx * 0.2);
        setNeighbor((current) => (current?.name === next?.name ? current : next));
        // Glissé vers l'appareil photo : la caméra s'allume pendant le geste.
        if (next?.name === 'camera') wakeCamera();
      },
      onPanResponderRelease: (event, { dx, vx }) => {
        const next = neighborOf(dx);
        if (next && (Math.abs(dx) > screenWidth * TAB_SWIPE_RATIO || Math.abs(vx) > 0.5)) {
          settleTab(-next.side * screenWidth, () => {
            setRoute({ name: next.name } as Route);
            tabDrag.set(0);
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
    const leaving = routeKey(nav.current.route);
    // La page partie est d'abord cachée par un style fixe, puis démontée à l'image suivante : elle ne
    // réapparaît pas le temps d'une image (Réglages au retour vers Profil).
    const done = () => {
      setLeavingKey(leaving);
      requestAnimationFrame(() => {
        exiting.current = false;
        setRouteState(parent);
      });
    };
    g.set(
      withTiming(1, screenTiming(), (finished) => {
        if (finished) scheduleOnRN(done);
      }),
    );
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
    // Changer d'écran ferme le clavier (celui d'une conversation ne reste pas ouvert sur l'accueil).
    Keyboard.dismiss();
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
    setLeavingKey(null);
    const { enter } = motionFor(currentKey);
    enter.set(withTiming(1, screenTiming()));
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

    if (current.name === 'camera') {
      return (
        <CameraScreen
          contacts={contacts}
          to={current.to}
          onSent={(publicKey) => setRoute({ name: 'chat', publicKey })}
          onRecordingChange={setFilming}
        />
      );
    }
    if (current.name === 'profile') {
      return <ProfileScreen onSettings={() => setRoute({ name: 'settings' })} onStorage={() => setRoute({ name: 'storage' })} onPage={(page) => setRoute({ name: 'settingsPage', page })} />;
    }
    if (current.name === 'settings') {
      return (
        <SettingsScreen
          onBack={() => setRoute({ name: 'profile' })}
          onDiagnostic={() => setRoute({ name: 'diagnostic' })}
          onBlocked={() => setRoute({ name: 'blocked' })}
          onStorage={() => setRoute({ name: 'storage' })}
          onServers={() => setRoute({ name: 'servers' })}
          onDiscover={() => setRoute({ name: 'discover' })}
          onReplayOnboarding={() => setOnboarding({ mode: 'full', step: 0 })}
        />
      );
    }
    if (current.name === 'map') {
      return <MapScreen contacts={contacts} focus={current.focus} onBack={() => setRoute(parentOf(current) ?? { name: 'home' })} onOpenChat={(publicKey) => setRoute({ name: 'chat', publicKey })} />;
    }
    if (current.name === 'settingsPage') {
      const back = () => setRoute({ name: 'profile' });
      if (current.page === 'permissions') return <PermissionsPage onBack={back} />;
      if (current.page === 'appearance') return <AppearancePage onBack={back} />;
      if (current.page === 'notifications') return <NotificationsPage onBack={back} />;
      if (current.page === 'privacy') return <PrivacyPage onBack={back} onServers={() => setRoute({ name: 'servers' })} onBlocked={() => setRoute({ name: 'blocked' })} />;
      if (current.page === 'backup') return <BackupPage onBack={back} />;
      return <UpdatesPage onBack={back} onDiscover={() => setRoute({ name: 'discover' })} onDiagnostic={() => setRoute({ name: 'diagnostic' })} />;
    }
    if (current.name === 'storage') {
      return <StorageScreen contacts={contacts} onBack={() => setRoute(parentOf(current) ?? { name: 'profile' })} />;
    }
    if (current.name === 'discover') {
      return <DiscoverScreen onBack={() => setRoute(parentOf(current) ?? { name: 'profile' })} />;
    }
    if (current.name === 'servers') {
      return <ServersScreen onBack={() => setRoute(parentOf(current) ?? { name: 'profile' })} />;
    }
    if (current.name === 'diagnostic') {
      return <DiagnosticScreen onBack={() => setRoute(parentOf(current) ?? { name: 'profile' })} />;
    }
    if (current.name === 'blocked') {
      return <BlockedScreen onBack={() => setRoute(parentOf(current) ?? { name: 'profile' })} />;
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
          name={isSelf(publicKey) ? t('notes.titre') : contacts.find((contact) => contact.publicKey === publicKey)?.name ?? t('app.contact')}
          pending={contacts.find((contact) => contact.publicKey === publicKey)?.pending ?? false}
          onBack={() => setRoute({ name: 'home' })}
          onInfo={() => setRoute({ name: 'contact', publicKey })}
          onCustomize={() => setRoute({ name: 'customize', publicKey })}
          preview={preview}
          jump={current.jump}
          intent={current.intent}
          onNotifications={() => setRoute({ name: 'notifications', publicKey })}
          onMedia={() => setRoute({ name: 'contact', publicKey, tab: 'media' })}
          onCamera={() => setRoute({ name: 'camera', to: publicKey })}
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
          initialTab={current.tab}
          onBack={() => backFromContact(publicKey)}
          onOpen={(intent) => setRoute({ name: 'chat', publicKey, intent })}
          onCustomize={() => setRoute({ name: 'customize', publicKey })}
          onNotifications={() => setRoute({ name: 'notifications', publicKey })}
          onSave={(name) => {
            // Un nouveau contact attend que l'autre accepte la demande ; un contact connu reste tel quel.
            const pending = saved ? saved.pending : true;
            updateContacts([...others, { publicKey, name, ...(pending ? { pending: true } : {}), ...(saved?.verified ? { verified: true } : {}) }]);
            if (!saved) chat.requestPairing(publicKey);
            setRoute({ name: 'chat', publicKey });
          }}
          contactKey={publicKey}
          code={code}
          verified={!!saved?.verified}
          onVerify={() => {
            setContactVerified(publicKey);
            setContacts((list) => list.map((contact) => (contact.publicKey === publicKey ? { ...contact, verified: true } : contact)));
          }}
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
        onAdd={() => setPairOpen(true)}
        onQr={() => setPairOpen(true)}
        onOpen={(contact, jump) => setRoute({ name: 'chat', publicKey: contact.publicKey, jump })}
        onRequests={() => setRoute({ name: 'requests' })}
      />
    );
  };

  // L'appareil photo reste monté et allumé un moment après qu'on l'a quitté (caché sous la page) : y
  // revenir est alors instantané. Au-delà, il est démonté et la caméra s'éteint.
  const [cameraWarm, setCameraWarm] = useState(false);
  // L'écran de l'appareil photo est construit une fois, peu après le démarrage, puis gardé caché
  // (caméra éteinte) : l'ouvrir n'a plus qu'à allumer la caméra.
  const [cameraBuilt, setCameraBuilt] = useState(false);
  useEffect(() => {
    if (!identity || cameraBuilt) return;
    const timer = setTimeout(() => setCameraBuilt(true), CAMERA_BUILD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [identity, cameraBuilt]);
  useEffect(() => {
    setCameraShown(route.name === 'camera' || cameraWarm, route.name === 'camera');
  }, [route.name, cameraWarm]);
  const lastRouteName = useRef(route.name);
  const cameraMarked = useRef(false);
  if (route.name !== 'camera') cameraMarked.current = false;
  else if (!cameraMarked.current) {
    cameraMarked.current = true;
    // Déjà allumée (réveillée par le doigt, ou encore chaude) : la mesure est déjà partie.
    if (!cameraWarm && !isCameraLive()) markCameraRequested();
  }
  useEffect(() => {
    const left = lastRouteName.current === 'camera' && route.name !== 'camera';
    lastRouteName.current = route.name;
    if (route.name === 'camera') {
      setCameraWarm(false);
      return;
    }
    if (!left) return;
    setCameraWarm(true);
    const timer = setTimeout(() => setCameraWarm(false), CAMERA_WARM_MS);
    return () => clearTimeout(timer);
  }, [route.name]);

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
  const renderDeps = [contacts, identity, error, code];
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
  const warmCamera = (cameraWarm || cameraBuilt) && !!identity && route.name !== 'camera' && !layers.some((layer) => layer.name === 'camera');

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
            setPermissionsMissing(false);
            // Sans contact, on ouvre directement la feuille QR code (montrer son code, scanner) : c'est la première chose à faire.
            if (onboarding.mode === 'full') {
              setRoute({ name: 'home' });
              if (contacts.length === 0) setPairOpen(true);
            }
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
      {/* L'appareil photo gardé au chaud passe en premier, caché, avec la même clé que l'onglet : en y
          revenant, React garde l'écran et sa caméra déjà prête. */}
      {[...(warmCamera ? [CAMERA_ROUTE] : []), ...layers].map((layer, position) => {
        const key = routeKey(layer);
        if (warmCamera && position === 0) {
          return (
            <PageLayer key={key} kind="hidden" top={top} tabDrag={tabDrag}>
              <View style={StyleSheet.absoluteFill}>{renderPage(layer, false)}</View>
            </PageLayer>
          );
        }
        const index = position - (warmCamera ? 1 : 0);
        const isTop = index === layers.length - 1;
        if (!isTop) {
          const isParent = index === layers.length - 2;
          return (
            <PageLayer key={key} kind={isParent ? 'parent' : 'hidden'} top={top} tabDrag={tabDrag}>
              {/* Même enveloppe que la page du dessus : en devenant la page du dessus, elle n'est pas remontée. */}
              <View style={StyleSheet.absoluteFill}>{renderPage(layer, false)}</View>
              {!TAB_ROUTES.includes(route.name) && TAB_ROUTES.includes(layer.name) && <BottomBar active={layer.name as Tab} onChange={() => {}} />}
            </PageLayer>
          );
        }
        return (
          <PageLayer key={key} kind="top" top={top} tabDrag={tabDrag} handlers={tabSwipe.panHandlers}>
            <View style={[StyleSheet.absoluteFill, leavingKey === key && styles.hidden]}>{renderPage(layer, true)}</View>
          </PageLayer>
        );
      })}
      {neighbor && (
        <NeighborLayer tabDrag={tabDrag} offset={neighbor.side * screenWidth}>
          {/* La caméra n'est pas allumée pour un simple glissement : un fond noir la représente. */}
          {neighbor.name === 'camera' || neighbor.name === 'map' ? <View style={styles.cameraPlaceholder} /> : render({ name: neighbor.name } as Route, true)}
        </NeighborLayer>
      )}
      {identity && !error && (
        <PairSheet
          visible={pairOpen}
          publicKey={identity.publicKey}
          onClose={() => setPairOpen(false)}
          onKeyReceived={(link) => {
            pairReturn.current = link.publicKey;
            openKey(link);
          }}
        />
      )}
      {identity && !error && !filming && TAB_ROUTES.includes(route.name) && (
        <BottomBar active={route.name as Tab} onChange={(tab) => setRoute(tab === 'map' ? { name: 'map', focus: null } : ({ name: tab } as Route))} />
      )}
      {updatedInfo && identity && route.name === 'home' && (
        // Des pages « Quoi de neuf » pour cette version : elles remplacent la popup courte.
        updatedInfo.pages.length > 0 ? <WhatsNew pages={updatedInfo.pages} onClose={closeUpdated} /> : <UpdatedPopup info={updatedInfo} onClose={closeUpdated} />
      )}
      {identity && !error && <ShareReceiver contacts={contacts} ready={!blocked} onSent={(publicKey) => setRoute({ name: 'chat', publicKey })} />}
      <DialogHost />
      {themeFade}
      {locked !== false && <LockScreen waiting={locked === null} onUnlock={() => setLocked(false)} />}
      {/* Appel (vague 5) : au-dessus de tout, même du verrouillage de Pear (il ne montre aucun message). */}
      {identity && <CallLayer nameOf={(publicKey) => contacts.find((contact) => contact.publicKey === publicKey)?.name ?? t('app.contact')} />}
    </>
  );
}

const THEME_FADE_MS = 320;
const CAMERA_WARM_MS = 15_000;
// Après le démarrage, une fois l'accueil affiché : construire l'appareil photo ne retarde rien.
const CAMERA_BUILD_DELAY_MS = 2500;
const CAMERA_ROUTE = { name: 'camera' } as Route;

// Voile de la couleur de l'ancien thème, qui s'efface pendant que le nouveau apparaît dessous.
function useThemeFade(colors: Palette) {
  const [veil, setVeil] = useState<string | null>(null);
  const opacity = useSharedValue(0);
  const veilStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const previous = useRef(colors);

  useEffect(() => {
    if (previous.current === colors) return;
    const from = previous.current.background;
    previous.current = colors;
    setVeil(from);
    opacity.set(1);
    const clear = () => setVeil(null);
    opacity.set(
      withTiming(0, { duration: THEME_FADE_MS, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished) scheduleOnRN(clear);
      }),
    );
  }, [colors, opacity]);

  return veil ? <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: veil }, veilStyle]} /> : null;
}

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
  cameraPlaceholder: {
    flex: 1,
    backgroundColor: fixed.black,
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
