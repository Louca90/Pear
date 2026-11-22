import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, useWindowDimensions, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withTiming, withSpring, withSequence, interpolateColor } from 'react-native-reanimated';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { haptics } from '../haptics';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { Camera, Check, Download, Lock, Settings, SwitchCamera, Zap, ZapOff } from 'lucide-react-native';

import { setScreenBrightness } from '../../modules/pear-native';
import { hasLastCameraFrame, PearCameraHandle, PearCameraView, wideLens } from '../../modules/pear-native/camera';

import { saveToGallery } from '../chat/media';
import { chat } from '../chat/manager';
import { useBottomBarSpace } from '../components/BottomBar';
import { showDialog } from '../components/dialog';
import { ContactPickerSheet } from '../components/ContactPickerSheet';
import { MediaEditor, MediaEditorHandle } from '../components/MediaEditor';
import { FilteredView } from '../components/editor/FilteredView';
import { FilterStrip, PASTILLE_SIZE, PastilleStrip } from '../components/editor/FilterStrip';
import { LensCategories, LensHint, LensPastille, LensRing } from './camera/LensBar';
import { FILTERS_ENABLED, LENSES, LENSES_ENABLED, LensCategory, lensOf, NO_LENS } from './camera/lenses';
import { FilterId, NO_ADJUSTMENTS, presetOf, stepsOf } from '../components/editor/filters';
import { getStampStyle, nextStampStyle, readAmbient } from '../components/editor/ambient';
import { Ambient, formatStamp, NO_AMBIENT, StampMarks } from '../components/editor/stamps';
import Svg from 'react-native-svg';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Button, IconButton, useInsets } from '../components/ui';
import { Contact } from '../storage';
import { createMediaStyles, fixed, radius, spacing, useMediaColors } from '../theme';
import { DURATION, timing } from '../motion';
import { log } from '../log';
import { VIDEO_BITRATE } from '../config';
import { t } from '../i18n';
import { logCameraStep } from './cameraTiming';
import { useCameraLive, useCameraVisible } from './cameraStandby';
import { activeLevel, ZoomBar, zoomLevels } from './camera/ZoomBar';
import { RecordingTimer, SHUTTER_SIZE, ShutterFace } from './camera/Shutter';
import { LastShot, PhotoFlash } from './camera/CaptureFeedback';

// En dessous de ce temps, c'est une photo. Au-delà, le maintien filme.
const HOLD_MS = 250;
// Le cadenas est à cette distance, à gauche du déclencheur. Lâcher assez près de lui verrouille la vidéo.
const LOCK_DISTANCE = 112;
const LOCK_REACH = 28;
const PHOTO_MAX_SIZE = 2048;
const PHOTO_JPEG_QUALITY = 82;
const DOUBLE_TAP_MS = 300;
const FLIP_SWIPE_DISTANCE = 70;
const FLIP_TAP_DISTANCE = 10;
// Glisser le déclencheur vers le haut en filmant zoome : ×2 tous les ZOOM_SLIDE points.
const ZOOM_SLIDE = 140;
const ZOOM_SLIDE_MAX = 8;
// Après ce mouvement, le geste choisit son axe (vertical = zoom, horizontal = cadenas) et le garde tant
// qu'il n'est pas revenu à son point de départ.
const AXIS_LOCK_DISTANCE = 14;
// Deux petits appuis d'un second doigt pendant qu'on tient le déclencheur : la caméra se retourne.
const SECOND_TAP_MS = 250;
// La rangée de zoom, au-dessus du déclencheur et du nom du filtre qui s'affiche un instant.
// Sous l'aperçu : la bande des filtres et les onglets PHOTO / VIDÉO ; à côté du déclencheur, la
// miniature et le bouton caméra. Les pastilles de zoom sont dans l'aperçu, à 18 points du bas.
const FILTER_ROW_HEIGHT = 72;
const MODE_TABS_HEIGHT = 36;
const SIDE_BUTTON = 48;
const ZOOM_INSET = 18;
// Les catégories de lentilles, au-dessus des pastilles de zoom ; le conseil encore au-dessus.
const CATEGORIES_ABOVE_ZOOM = 54;
const HINT_ABOVE_CATEGORIES = 42;
const PREVIEW_RADIUS = 28;

// filter : le filtre choisi avant la prise, repris par l'éditeur (il ne touche pas encore au fichier).
// Une fois la caméra autorisée, inutile d'attendre la relecture de la permission (asynchrone) pour
// monter l'aperçu à la prochaine ouverture.
const cameraKnown = { granted: false };
const PREVIEW_FADE_MS = 200;

type CameraMode = 'photo' | 'video';

// Les onglets PHOTO / VIDÉO sous l'aperçu : le choisi passe en clair, l'autre en gris (fondu sur le fil natif).
function ModeTab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = useStyles();
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.set(timing(selected ? 1 : 0, 200));
  }, [selected, on]);
  const style = useAnimatedStyle(() => ({ color: interpolateColor(on.get(), [0, 1], [fixed.cameraIdle, fixed.white]) }));
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="tab" accessibilityState={{ selected }} style={styles.modeTab}>
      <Reanimated.Text style={[styles.modeLabel, style]}>{label}</Reanimated.Text>
    </Pressable>
  );
}

function ModeTabs({ mode, hidden, bottom, onChange }: { mode: CameraMode; hidden: boolean; bottom: number; onChange: (mode: CameraMode) => void }) {
  const styles = useStyles();
  const shown = useSharedValue(hidden ? 0 : 1);
  useEffect(() => {
    shown.set(timing(hidden ? 0 : 1, DURATION.small));
  }, [hidden, shown]);
  const style = useAnimatedStyle(() => ({ opacity: shown.get() }));
  return (
    <Reanimated.View pointerEvents={hidden ? 'none' : 'box-none'} style={[styles.modeTabs, { bottom }, style]} accessibilityRole="tablist">
      <ModeTab label={t('camera.modePhoto')} selected={mode === 'photo'} onPress={() => onChange('photo')} />
      <ModeTab label={t('camera.modeVideo')} selected={mode === 'video'} onPress={() => onChange('video')} />
    </Reanimated.View>
  );
}

type Capture = { uri: string; kind: 'image' | 'video'; takenAt: number; filter: FilterId };

function vibrate() {
  haptics.select();
}

function formatElapsed(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type ReviewProps = {
  capture: Capture;
  contacts: Contact[];
  onDiscard: () => void;
  onSent: (publicKey: string) => void;
  // Ouvert depuis une conversation : « Envoyer » part directement à ce contact.
  to?: string;
};

// Après la prise : on garde, on envoie à un contact, ou on jette. Rien ne part sans un choix.
function CaptureReview({ capture, contacts, onDiscard, onSent, to }: ReviewProps) {
  const colors = useMediaColors();
  const styles = useStyles();
  const [picking, setPicking] = useState(false);
  const [saved, setSaved] = useState(false);
  // Vue unique : le contact ne peut ouvrir la photo (ou la vidéo) qu'une fois. Désactivé à chaque nouvelle prise.
  const [once, setOnce] = useState(false);
  const onceFill = useSharedValue(0);
  const onceStyle = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(onceFill.get(), [0, 1], [colors.overlay, colors.signatureStrong]), transform: [{ scale: 1 + 0.08 * onceFill.get() }] }));
  const toggleOnce = () => {
    haptics.select();
    onceFill.set(timing(once ? 0 : 1, DURATION.small));
    setOnce(!once);
  };
  const editor = useRef<MediaEditorHandle>(null);
  const [preparing, setPreparing] = useState(false);

  const finalUri = async () => {
    setPreparing(true);
    try {
      return editor.current ? await editor.current.flatten() : capture.uri;
    } finally {
      setPreparing(false);
    }
  };

  const extension = (uri: string) => (capture.kind === 'video' ? '.mp4' : uri.endsWith('.png') ? '.png' : '.jpg');

  const save = async () => {
    try {
      const uri = await finalUri();
      await saveToGallery(uri, `Pear-${Date.now()}${extension(uri)}`);
      vibrate();
      setSaved(true);
    } catch (e) {
      showDialog(t('commun.enregistrementImpossible'), String(e));
    }
  };

  // Un ou plusieurs contacts : le média préparé une seule fois, puis envoyé à chacun (chiffré à part).
  // Le fichier est copié pour chaque contact sauf le dernier, qui le reçoit déplacé : avant, le premier
  // envoi le déplaçait et les suivants échouaient (message d'erreur alors que la photo était partie).
  const send = async (keys: string[]) => {
    let uri: string;
    try {
      uri = await finalUri();
    } catch (e) {
      showDialog(t('chat.envoiImpossible'), e instanceof Error ? e.message : String(e));
      return;
    }
    const ending = extension(uri);
    const mime = capture.kind === 'video' ? 'video/mp4' : ending === '.png' ? 'image/png' : 'image/jpeg';
    const failed: string[] = [];
    for (const [index, key] of keys.entries()) {
      try {
        await chat.sendFile(key, {
          uri,
          name: `${capture.kind === 'video' ? 'video' : 'photo'}${ending}`,
          size: 0,
          mime,
          kind: capture.kind,
          fromCamera: true,
          keepSource: index < keys.length - 1,
          ...(once ? { once: true } : {}),
        });
      } catch (e) {
        log.warn('envoi depuis la caméra', e);
        failed.push(key);
      }
    }
    // Seuls les vrais échecs sont signalés, avec le nom des contacts concernés.
    if (failed.length > 0) {
      const names = failed.map((key) => contacts.find((contact) => contact.publicKey === key)?.name || t('app.contact'));
      showDialog(t('chat.envoiImpossible'), t('chat.envoiEchoueA', { noms: names.join(', ') }));
    }
    const sent = keys.find((key) => !failed.includes(key));
    if (sent) onSent(sent);
  };

  return (
    <Modal visible animationType="fade" onRequestClose={() => (picking ? setPicking(false) : onDiscard())} statusBarTranslucent navigationBarTranslucent>
      {/* Sur Android, les gestes d'une fenêtre Modal ne marchent que si son contenu a sa propre racine. */}
      <GestureHandlerRootView style={styles.review}>
        <MediaEditor
          ref={editor}
          uri={capture.uri}
          kind={capture.kind}
          takenAt={capture.takenAt}
          initialFilter={capture.filter}
          actions={{
            onClose: onDiscard,
            onSend: () => (to ? send([to]) : setPicking(true)),
            extra: (
              <>
              <IconButton onPress={toggleOnce} label={t('unique.bouton')} style={styles.roundControl}>
                {/* Même icône que dans le sélecteur de la galerie : un « 1 » dans un anneau en pointillés. */}
                <Reanimated.View style={[styles.onceFill, onceStyle]}>
                  <View style={[styles.onceRing, { borderColor: once ? colors.onSignature : colors.background }]}>
                    <Text style={[styles.onceLabel, { color: once ? colors.onSignature : colors.background }]}>1</Text>
                  </View>
                </Reanimated.View>
              </IconButton>
              <IconButton onPress={save} disabled={saved} label={saved ? t('camera.enregistre') : t('camera.enregistrerGalerie')} style={styles.roundControl}>
                {saved ? <Check size={22} color={colors.background} strokeWidth={2} /> : <Download size={22} color={colors.background} strokeWidth={1.9} />}
              </IconButton>
              </>
            ),
          }}
        />
        {once && (
          <Reanimated.Text entering={FadeIn.duration(180)} style={styles.onceHint}>
            {t('unique.camera')}
          </Reanimated.Text>
        )}

        {picking && (
          <ContactPickerSheet title={t('camera.envoyerA')} contacts={contacts} onSend={send} onClose={() => setPicking(false)} />
        )}
        {preparing && (
          <View style={styles.preparing} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.background} size="large" />
            <Text style={styles.preparingText}>{capture.kind === 'video' ? t('camera.preparationVideo') : t('camera.preparationImage')}</Text>
          </View>
        )}
      </GestureHandlerRootView>
    </Modal>
  );
}

type Props = {
  contacts: Contact[];
  to?: string;
  onSent: (publicKey: string) => void;
  onRecordingChange: (recording: boolean) => void;
};

// Comme sur Snap : un appui prend une photo, le maintien filme, et glisser vers le cadenas libère le doigt.
export function CameraScreen({ contacts, to, onSent, onRecordingChange }: Props) {
  const colors = useMediaColors();
  const styles = useStyles();
  const { top: topInset } = useInsets();
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [microphonePermission, requestMicrophone] = useMicrophonePermissions();
  const cameraAllowed = cameraPermission?.granted ?? cameraKnown.granted;
  // Écran construit d'avance et gardé caché : la caméra ne s'allume que quand l'onglet est demandé.
  const live = useCameraLive();
  const onScreen = useCameraVisible();
  useEffect(() => {
    if (cameraPermission) cameraKnown.granted = cameraPermission.granted;
  }, [cameraPermission]);
  // L'aperçu apparaît en fondu à la première image, sur l'interface déjà affichée.
  // Si le natif garde la dernière image, il la montre floue : l'aperçu est visible tout de suite.
  const previewOpacity = useSharedValue(hasLastCameraFrame() ? 1 : 0);
  useEffect(() => {
    logCameraStep('écran monté');
  }, []);
  useEffect(() => {
    if (cameraPermission) logCameraStep('permission lue');
  }, [cameraPermission?.granted]);
  const onCameraReady = () => {
    logCameraStep('caméra ouverte');
    previewOpacity.set(withTiming(1, { duration: PREVIEW_FADE_MS, easing: Easing.out(Easing.cubic) }));
  };
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  // Le zoom : réel (×0,6 sur une caméra multiple), ou un autre objectif (ultra grand-angle séparé).
  const [wide] = useState(() => wideLens());
  const [zoom, setZoom] = useState(1);
  const [lensId, setLensId] = useState<string | null>(null);
  const [zoomRange, setZoomRange] = useState({ min: 1, max: 1 });
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  const zoomStart = useRef(1);
  const [flashOn, setFlashOn] = useState(false);
  const [filming, setFilming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [locked, setLocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [capture, setCapture] = useState<Capture | null>(null);
  // PHOTO : un appui prend une photo, le maintien filme. VIDÉO : un appui lance l'enregistrement, un autre l'arrête.
  const [mode, setMode] = useState<CameraMode>('photo');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // Chaque photo : le cœur du déclencheur se tasse et l'aperçu s'éclaire. La dernière photo reste
  // en miniature (une vidéo l'efface : elle n'a pas d'image à montrer).
  const [shots, setShots] = useState(0);
  const [lastShot, setLastShot] = useState<Capture | null>(null);
  // Le filtre en direct, appliqué à l'aperçu ; lu par une référence quand la vidéo se termine.
  const [liveFilter, setLiveFilter] = useState<FilterId>('none');
  // Lentilles (filtres fun) : la catégorie de la bande, et la lentille posée sur le visage. Une lentille
  // et un filtre de couleur peuvent se combiner.
  const [lensCategory, setLensCategory] = useState<LensCategory>('couleurs');
  const [lens, setLens] = useState(NO_LENS);
  const chooseCategory = (category: LensCategory) => {
    setLensCategory(category);
    if (category !== 'couleurs') setLens(LENSES[category][1].id);
  };
  const liveFilterRef = useRef(liveFilter);
  liveFilterRef.current = liveFilter;
  // Heure, Date, Pellicule : la marque se voit sur l'aperçu, mise à jour à chaque minute.
  const liveStamp = presetOf(liveFilter).stamp;
  const [now, setNow] = useState(Date.now());
  // Lieu et Batterie : lus sur le téléphone quand le filtre est choisi ; la batterie est relue à chaque tic.
  const [ambient, setAmbient] = useState<Ambient>(NO_AMBIENT);
  const [, setStyleTick] = useState(0);
  useEffect(() => {
    if (!liveStamp) return;
    let current = true;
    const read = () => readAmbient(liveStamp).then((found) => current && setAmbient((previous) => ({ ...previous, ...found })));
    setNow(Date.now());
    read();
    const timer = setInterval(() => {
      setNow(Date.now());
      if (liveStamp === 'battery') read();
    }, 15_000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [liveStamp]);
  const window = useWindowDimensions();
  const camera = useRef<PearCameraHandle>(null);
  const barSpace = useBottomBarSpace();

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantsVideo = useRef(false);
  const isRecording = useRef(false);
  const isLocked = useRef(false);
  const stoppedByTap = useRef(false);

  const shutterX = useSharedValue(0);
  const shutterScale = useSharedValue(1);
  // 0 : le cadenas attend. 1 : il a disparu, et l'icône d'arrêt a pris sa place au centre.
  const lockProgress = useSharedValue(0);
  const lockHover = useSharedValue(1);
  const shutterStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shutterX.get() }, { scale: shutterScale.get() }] }));
  const lockStyle = useAnimatedStyle(() => ({ opacity: 1 - lockProgress.get(), transform: [{ scale: lockHover.get() * (1 - 0.8 * lockProgress.get()) }] }));
  const overLock = useRef(false);
  const gestureAxis = useRef<'zoom' | 'lock' | null>(null);
  // Position du doigt (depuis l'appui) où le dernier axe s'est libéré : le suivant se mesure à partir d'elle.
  const gestureAnchor = useRef({ x: 0, y: 0 });
  const flipFade = useSharedValue(0);

  // Vidéo avec la caméra avant et le flash : un cadre blanc doux autour de l'image et l'écran à pleine
  // luminosité éclairent le visage (pour une photo, c'est le flash d'écran de CameraX qui s'en charge).
  const frontLight = flashOn && filming && facing === 'front';
  const frontGlow = useSharedValue(0);
  useEffect(() => {
    frontGlow.set(withTiming(frontLight ? 1 : 0, { duration: 220, easing: Easing.out(Easing.cubic) }));
    setScreenBrightness(frontLight ? 1 : -1).catch((e) => log.warn('luminosité', e));
  }, [frontLight, frontGlow]);
  useEffect(() => () => void setScreenBrightness(-1).catch(() => undefined), []);
  const lastTap = useRef(0);

  useEffect(() => {
    if (!cameraPermission) return;
    if (!cameraPermission.granted && cameraPermission.canAskAgain) requestCamera();
    else if (cameraPermission.granted && microphonePermission && !microphonePermission.granted && microphonePermission.canAskAgain) requestMicrophone();
  }, [cameraPermission?.granted, microphonePermission?.granted]);

  useEffect(() => {
    onRecordingChange(filming);
    if (!recording) return;
    setElapsed(0);
    const timer = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, [filming, recording]);

  useEffect(
    () => () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
      onRecordingChange(false);
    },
    [],
  );

  const animateShutter = (toValue: number) => shutterScale.set(withSpring(toValue, { damping: 12, stiffness: 300, overshootClamping: true }));

  const resetFilming = () => {
    wantsVideo.current = false;
    isRecording.current = false;
    isLocked.current = false;
    overLock.current = false;
    lockProgress.set(0);
    lockHover.set(1);
    setRecording(false);
    setLocked(false);
    setFilming(false);
    animateShutter(1);
    shutterX.set(withSpring(0, { damping: 16, stiffness: 240, overshootClamping: true }));
  };

  const startRecording = () => {
    if (!wantsVideo.current || isRecording.current || !camera.current) return;
    isRecording.current = true;
    setRecording(true);
    camera.current
      .startRecording()
      .then((uri) => {
        if (!uri) return;
        setCapture({ uri, kind: 'video', takenAt: Date.now(), filter: liveFilterRef.current });
        setLastShot(null);
      })
      .catch((e) => {
        log.warn('vidéo', e);
        showDialog(t('camera.videoNonEnregistree'), t('camera.maintenirPlus'));
      })
      .finally(resetFilming);
  };

  // Photo et vidéo sont branchées ensemble (PearCameraView) : le maintien filme tout de suite.
  const beginHold = () => {
    holdTimer.current = null;
    wantsVideo.current = true;
    vibrate();
    setFilming(true);
    animateShutter(1.2);
    startRecording();
  };

  const stopFilming = () => {
    if (isRecording.current) camera.current?.stopRecording();
    else resetFilming();
  };

  const takePhoto = async () => {
    animateShutter(1);
    vibrate();
    setShots((count) => count + 1);
    try {
      // Déjà tournée et réduite à 2048 px par la caméra : une image légère part plus vite (et passe le relais).
      const photo = await camera.current?.takePicture(PHOTO_MAX_SIZE, PHOTO_JPEG_QUALITY);
      if (!photo?.uri) return;
      const taken: Capture = { uri: photo.uri, kind: 'image', takenAt: Date.now(), filter: liveFilterRef.current };
      setCapture(taken);
      setLastShot(taken);
    } catch (e) {
      showDialog(t('camera.photoNonPrise'), String(e));
    }
  };

  const gesture = {
    down: () => {
      stoppedByTap.current = false;
      if (isLocked.current) {
        stoppedByTap.current = true;
        stopFilming();
        return;
      }
      if (modeRef.current === 'video') {
        // Mode vidéo : l'enregistrement part tout de suite, déjà verrouillé ; le prochain appui l'arrête.
        stoppedByTap.current = true;
        wantsVideo.current = true;
        isLocked.current = true;
        setLocked(true);
        lockProgress.set(1);
        vibrate();
        setFilming(true);
        startRecording();
        return;
      }
      animateShutter(0.88);
      zoomStart.current = zoomRef.current;
      gestureAxis.current = null;
      gestureAnchor.current = { x: 0, y: 0 };
      holdTimer.current = setTimeout(beginHold, HOLD_MS);
    },
    move: (dx: number, dy: number, fingers: number) => {
      // Un second doigt posé déplace le centre du geste : on l'ignore pour le cadenas et le zoom.
      if (!wantsVideo.current || isLocked.current || fingers > 1) return;
      // Jamais les deux à la fois : l'axe dominant des premiers points prend la main. Revenu au départ
      // (zoom d'origine, ou déclencheur recentré), le geste se libère et peut repartir dans l'autre axe,
      // mesuré à partir de là.
      const anchor = gestureAnchor.current;
      const x = dx - anchor.x;
      const y = dy - anchor.y;
      if (!gestureAxis.current) {
        if (Math.hypot(x, y) < AXIS_LOCK_DISTANCE) return;
        gestureAxis.current = Math.abs(y) > Math.abs(x) ? 'zoom' : 'lock';
      }
      const release = () => {
        gestureAxis.current = null;
        gestureAnchor.current = { x: dx, y: dy };
      };
      if (gestureAxis.current === 'zoom') {
        // Vers le haut, le zoom monte (×2 tous les ZOOM_SLIDE points) ; en redescendant, il revient.
        const next = Math.max(zoomRange.min, Math.min(Math.min(zoomRange.max, ZOOM_SLIDE_MAX), zoomStart.current * Math.pow(2, -Math.min(0, y) / ZOOM_SLIDE)));
        if (Math.abs(next - zoomRef.current) > 0.01) {
          // Le natif d'abord (fluide), l'état React ensuite, seulement pour la pastille.
          zoomRef.current = next;
          camera.current?.setZoom(next).catch(() => {});
          setZoom(next);
        }
        if (y >= 0) release();
        return;
      }
      const distance = Math.min(0, Math.max(-LOCK_DISTANCE, x));
      if (x >= 0) release();
      shutterX.set(distance);
      const reached = distance <= -(LOCK_DISTANCE - LOCK_REACH);
      if (reached !== overLock.current) {
        overLock.current = reached;
        if (reached) vibrate();
        lockHover.set(withSpring(reached ? 1.35 : 1, { damping: 12, stiffness: 300, overshootClamping: true }));
      }
    },
    up: () => {
      if (stoppedByTap.current) return;
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
        takePhoto();
      } else if (overLock.current) {
        // Lâché sur le cadenas : la vidéo continue seule, le cadenas s'efface et l'arrêt apparaît au centre.
        isLocked.current = true;
        setLocked(true);
        vibrate();
        shutterX.set(withSpring(0, { damping: 16, stiffness: 240, overshootClamping: true }));
        lockProgress.set(withSpring(1, { damping: 14, stiffness: 220, overshootClamping: true }));
      } else {
        stopFilming();
      }
    },
  };
  const secondTaps = useRef({ downAt: 0, lastTap: 0 });
  const gestureWithTaps = {
    ...gesture,
    secondFinger: (fingers: number, down: boolean) => {
      const taps = secondTaps.current;
      const now = Date.now();
      if (down && fingers >= 2) {
        taps.downAt = now;
        return;
      }
      if (down || fingers < 1 || !taps.downAt || now - taps.downAt > SECOND_TAP_MS) return;
      taps.downAt = 0;
      if (now - taps.lastTap < DOUBLE_TAP_MS) {
        taps.lastTap = 0;
        flipCamera();
      } else {
        taps.lastTap = now;
      }
    },
  };
  const latestGesture = useRef(gestureWithTaps);
  latestGesture.current = gestureWithTaps;

  const shutter = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => latestGesture.current.down(),
      onPanResponderMove: (_event, { dx, dy, numberActiveTouches }) => latestGesture.current.move(dx, dy, numberActiveTouches),
      // Les doigts en plus, pendant qu'on tient le déclencheur : deux petits appuis retournent la caméra.
      onPanResponderStart: (_event, { numberActiveTouches }) => latestGesture.current.secondFinger(numberActiveTouches, true),
      onPanResponderEnd: (_event, { numberActiveTouches }) => latestGesture.current.secondFinger(numberActiveTouches, false),
      onPanResponderRelease: () => latestGesture.current.up(),
      onPanResponderTerminate: () => latestGesture.current.up(),
    }),
  ).current;

  const changeMode = (next: CameraMode) => {
    if (next === mode || filming) return;
    haptics.select();
    setMode(next);
  };

  const flipCamera = () => {
    vibrate();
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
    // L'autre caméra repart à ×1 ; une vidéo en cours continue dessus.
    setZoom(1);
    setLensId(null);
    flipFade.set(withSequence(withTiming(1, { duration: 110 }), withTiming(0, { duration: 260 })));
  };

  // Pendant une vidéo verrouillée aussi : elle continue sur l'autre caméra.
  const surfaceRelease = (dx: number, dy: number) => {
    // Glissé vertical seulement : un glissé horizontal change d'onglet.
    if (Math.abs(dy) > FLIP_SWIPE_DISTANCE && Math.abs(dy) > Math.abs(dx)) {
      flipCamera();
    } else if (Math.max(Math.abs(dx), Math.abs(dy)) < FLIP_TAP_DISTANCE) {
      const now = Date.now();
      if (now - lastTap.current < DOUBLE_TAP_MS) {
        lastTap.current = 0;
        flipCamera();
      } else {
        lastTap.current = now;
      }
    }
  };
  const latestSurfaceRelease = useRef(surfaceRelease);
  latestSurfaceRelease.current = surfaceRelease;

  // Sur l'image : un double appui ou un glissé vertical change de caméra.
  const surface = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: (_event, { dx, dy }) => latestSurfaceRelease.current(dx, dy),
    }),
  ).current;

  if (cameraPermission && !cameraPermission.granted) {
    return (
      <View style={styles.denied}>
        <Camera size={28} color={colors.text} strokeWidth={1.75} />
        <Text style={styles.deniedText}>{t('camera.autoriserAide')}</Text>
        <Button
          label={cameraPermission.canAskAgain ? t('scanner.autoriserCamera') : t('commun.ouvrirReglages')}
          icon={cameraPermission.canAskAgain ? Camera : Settings}
          onPress={() => (cameraPermission.canAskAgain ? requestCamera() : Linking.openSettings())}
        />
      </View>
    );
  }

  // La mise en page de la planche, du bas vers le haut : la barre de l'app, la rangée du déclencheur
  // (miniature, déclencheur, caméra), les onglets PHOTO / VIDÉO, la bande des filtres, puis l'aperçu
  // aux coins du bas arrondis. Les hauteurs ne changent jamais, même quand la barre s'efface.
  const rowBottom = barSpace + spacing.sm;
  const tabsBottom = rowBottom + SHUTTER_SIZE + 2;
  const stripBottom = tabsBottom + MODE_TABS_HEIGHT;
  // Sans la bande des filtres, l'aperçu en reprend la place.
  const previewHeight = window.height - (stripBottom + (FILTERS_ENABLED ? FILTER_ROW_HEIGHT : 0) + spacing.sm);
  const previewBottom = window.height - previewHeight;
  const sideInset = (window.width / 2 - SHUTTER_SIZE / 2 - SIDE_BUTTON) / 2;

  return (
    <View style={styles.screen}>
      {/* Seulement à l'écran : caché, l'écran ne doit pas imposer ses barres claires aux autres pages. */}
      {onScreen && <StatusBar style="light" />}
      {onScreen && <NavigationBar style="light" />}
      <View style={[styles.preview, { height: previewHeight }]}>
        {cameraAllowed && (
          <Reanimated.View style={[StyleSheet.absoluteFill, { opacity: previewOpacity }]}>
            <FilteredView steps={stepsOf(liveFilter, NO_ADJUSTMENTS)} style={StyleSheet.absoluteFill}>
              <PearCameraView
                ref={camera}
                style={StyleSheet.absoluteFill}
                active={live}
                lens={LENSES_ENABLED ? lens : NO_LENS}
                facing={facing}
                cameraId={facing === 'back' ? lensId : null}
                zoom={zoom}
                videoBitrate={VIDEO_BITRATE}
                flash={flashOn}
                torch={flashOn && filming}
                mute={!microphonePermission?.granted}
                onReady={({ nativeEvent }) => {
                  setZoomRange({ min: nativeEvent.minZoom, max: nativeEvent.maxZoom });
                  onCameraReady();
                }}
                onFrame={({ nativeEvent }) => logCameraStep(`première image (natif : ${Math.round(nativeEvent.ms)} ms)`)}
                onCameraError={({ nativeEvent }) => log.warn('caméra', nativeEvent.message)}
              />
            </FilteredView>
          </Reanimated.View>
        )}
        {liveStamp && (
          <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={window.width} height={previewHeight}>
            <StampMarks kind={liveStamp} stamp={formatStamp(now, ambient)} width={window.width} height={previewHeight} variant={getStampStyle(liveStamp)} />
          </Svg>
        )}
        <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.frontGlow, { opacity: frontGlow }]} />
        <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flipFade, { opacity: flipFade }]} />
        <PhotoFlash shots={shots} />
        <View collapsable={false} style={StyleSheet.absoluteFill} accessibilityLabel={t('camera.changerAide')} {...surface.panHandlers} />
      </View>

      {!filming && (
        <View pointerEvents="box-none" style={[styles.topControls, { top: topInset + spacing.md }]}>
          <IconButton onPress={() => setFlashOn(!flashOn)} label={flashOn ? t('camera.couperFlash') : t('camera.activerFlash')} style={styles.roundControl}>
            {flashOn ? <Zap size={20} color={colors.signature} fill={colors.signature} strokeWidth={2} /> : <ZapOff size={20} color={colors.onMedia} strokeWidth={2} />}
          </IconButton>
        </View>
      )}

      {recording && <RecordingTimer label={formatElapsed(elapsed)} top={topInset + spacing.md} />}

      {facing === 'back' && (
        <ZoomBar
          levels={zoomLevels(wide, lensId ? Math.max(2, zoomRange.max) : zoomRange.max)}
          active={activeLevel(zoomLevels(wide, Math.max(2, zoomRange.max)), wide, zoom, lensId)}
          zoom={zoom}
          lens={lensId}
          bottom={previewBottom + ZOOM_INSET}
          onChoose={(level) => {
            setLensId(level.lens);
            setZoom(level.zoom);
          }}
        />
      )}

      {/* La bande des filtres, sous l'aperçu : le filtre posé dans l'anneau du milieu s'applique. */}
      {FILTERS_ENABLED && (
      <View pointerEvents="box-none" style={[styles.filterRow, { bottom: stripBottom }]}>
        <LensRing chosen={lensCategory === 'couleurs' ? liveFilter !== 'none' : lens !== NO_LENS} hidden={filming} token={lensCategory === 'couleurs' ? liveFilter : lens} />
        {lensCategory === 'couleurs' ? (
          <FilterStrip
            key="couleurs"
            value={liveFilter}
            hidden={filming}
            onChange={setLiveFilter}
            onRestyle={(stamp) => {
              nextStampStyle(stamp);
              haptics.select();
              setStyleTick((tick) => tick + 1);
            }}
          />
        ) : (
          <PastilleStrip
            key={lensCategory}
            items={LENSES[lensCategory].map((item) => ({ id: item.id, label: t(item.label), node: <LensPastille lens={item} size={PASTILLE_SIZE} /> }))}
            value={lens}
            hidden={filming}
            onChange={setLens}
          />
        )}
      </View>
      )}

      <ModeTabs mode={mode} hidden={filming} bottom={tabsBottom} onChange={changeMode} />
      {LENSES_ENABLED && <LensCategories value={lensCategory} hidden={filming} bottom={previewBottom + ZOOM_INSET + CATEGORIES_ABOVE_ZOOM} onChange={chooseCategory} />}
      {LENSES_ENABLED && !filming && <LensHint text={lensOf(lens)?.hint ? t(lensOf(lens)!.hint!) : null} bottom={previewBottom + ZOOM_INSET + CATEGORIES_ABOVE_ZOOM + HINT_ABOVE_CATEGORIES} />}

      {/* La place de la miniature, puis la dernière photo qui s'y pose. */}
      <View pointerEvents="none" style={[styles.thumbPlace, { left: sideInset, bottom: rowBottom + (SHUTTER_SIZE - SIDE_BUTTON) / 2 }, filming && styles.hidden]} />
      {lastShot && !capture && (
        <LastShot
          uri={lastShot.uri}
          filter={lastShot.filter}
          hidden={filming}
          bottom={rowBottom + (SHUTTER_SIZE - SIDE_BUTTON) / 2}
          left={sideInset}
          onPress={() => setCapture(lastShot)}
        />
      )}

      <View pointerEvents="box-none" style={[styles.shutterRow, { bottom: rowBottom }]}>
        <Reanimated.View
          {...shutter.panHandlers}
          accessibilityRole="button"
          accessibilityLabel={locked ? t('camera.arreterVideo') : mode === 'video' ? t('camera.filmer') : t('camera.declencheur')}
          style={[styles.shutter, shutterStyle]}
        >
          {/* En vidéo, le cœur est rouge ; pendant l'enregistrement, c'est un carré arrondi qui sert d'arrêt. */}
          <ShutterFace filming={filming || mode === 'video'} recording={recording} elapsed={elapsed} filter={liveFilter} shots={shots} />
        </Reanimated.View>
        {filming && !locked && (
          <Reanimated.View
            pointerEvents="none"
            accessibilityLabel={t('camera.verrouiller')}
            style={[styles.lock, lockStyle]}
          >
            <Lock size={20} color={colors.onMedia} strokeWidth={1.75} />
          </Reanimated.View>
        )}
        {/* IconButton pose son style sur la vue intérieure : la place se donne par une vue autour. */}
        <View style={[styles.flipPlace, { right: sideInset }]}>
          <IconButton onPress={flipCamera} label={t('camera.changerCamera')} style={styles.flip}>
            <SwitchCamera size={22} color={colors.onMedia} strokeWidth={1.8} />
          </IconButton>
        </View>
      </View>
      {capture && (
        <CaptureReview
          capture={capture}
          contacts={contacts}
          to={to}
          onDiscard={() => setCapture(null)}
          onSent={(publicKey) => {
            setCapture(null);
            // Le fichier envoyé a été déplacé : plus de miniature à montrer.
            setLastShot(null);
            onSent(publicKey);
          }}
        />
      )}
    </View>
  );
}

const useStyles = createMediaStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.text,
  },
  denied: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  deniedText: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
  },
  preview: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    borderBottomLeftRadius: PREVIEW_RADIUS,
    borderBottomRightRadius: PREVIEW_RADIUS,
    overflow: 'hidden',
    backgroundColor: fixed.cameraSurface,
  },
  topControls: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  filterRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: FILTER_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // L'anneau fixe du milieu : le filtre qui s'y pose est celui de l'aperçu.
  filterRing: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: radius.full,
    borderWidth: 2,
    borderColor: colors.signature,
  },
  hidden: {
    opacity: 0,
  },
  modeTabs: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: MODE_TABS_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 26,
  },
  modeTab: {
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  modeLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.8,
  },
  thumbPlace: {
    position: 'absolute',
    width: SIDE_BUTTON,
    height: SIDE_BUTTON,
    borderRadius: 12,
    backgroundColor: fixed.cameraSurface,
  },
  flipPlace: {
    position: 'absolute',
    top: (SHUTTER_SIZE - SIDE_BUTTON) / 2,
  },
  flip: {
    width: SIDE_BUTTON,
    height: SIDE_BUTTON,
    borderRadius: radius.full,
    backgroundColor: fixed.cameraSurface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onceFill: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onceRing: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    borderWidth: 1.75,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  onceLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  onceHint: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 120,
    fontSize: 13,
    color: colors.background,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  roundControl: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: SHUTTER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutter: {
    width: SHUTTER_SIZE,
    height: SHUTTER_SIZE,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipFade: {
    backgroundColor: colors.text,
  },
  frontGlow: {
    borderWidth: 44,
    borderRadius: 32,
    borderColor: 'rgba(255, 255, 255, 0.94)',
  },
  lock: {
    position: 'absolute',
    left: '50%',
    marginLeft: -LOCK_DISTANCE - 22,
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preparing: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.overlay,
  },
  preparingText: {
    fontSize: 16,
    color: colors.background,
  },
  review: {
    flex: 1,
    backgroundColor: colors.text,
  },
}));
