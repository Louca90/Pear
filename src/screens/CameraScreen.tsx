import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Linking, useWindowDimensions, Modal, PanResponder, StyleSheet, Text, View } from 'react-native';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { Camera, Check, Download, Lock, Send, Settings, Square, SwitchCamera, X, Zap, ZapOff } from 'lucide-react-native';

import { setScreenBrightness } from '../../modules/pear-native';
import { PearCameraHandle, PearCameraView, wideLens } from '../../modules/pear-native/camera';

import { saveToGallery } from '../chat/files';
import { chat } from '../chat/manager';
import { useBottomBarSpace } from '../components/BottomBar';
import { showDialog } from '../components/dialog';
import { ContactPickerSheet } from '../components/ContactPickerSheet';
import { MediaEditor, MediaEditorHandle } from '../components/MediaEditor';
import { FilteredView } from '../components/editor/FilteredView';
import { FilterStrip, FilterSwatch } from '../components/editor/FilterStrip';
import { FilterId, NO_ADJUSTMENTS, presetOf, stepsOf } from '../components/editor/filters';
import { formatStamp, StampMarks } from '../components/editor/stamps';
import Svg from 'react-native-svg';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Button, IconButton, useInsets, useNavigationBarHeight } from '../components/ui';
import { Contact } from '../storage';
import { createMediaStyles, radius, spacing, useMediaColors } from '../theme';
import { log } from '../log';
import { VIDEO_BITRATE } from '../config';
import { t } from '../i18n';
import { logCameraStep } from './cameraTiming';
import { activeLevel, ZoomBar, zoomLevels } from './camera/ZoomBar';

// En dessous de ce temps, c'est une photo. Au-delà, le maintien filme.
const HOLD_MS = 250;
// Le cadenas est à cette distance, à gauche du déclencheur. Lâcher assez près de lui verrouille la vidéo.
const LOCK_DISTANCE = 112;
const LOCK_REACH = 28;
const SHUTTER_SIZE = 84;
const PHOTO_MAX_SIZE = 2048;
const PHOTO_JPEG_QUALITY = 82;
const DOUBLE_TAP_MS = 300;
const FLIP_SWIPE_DISTANCE = 70;
const FLIP_TAP_DISTANCE = 10;
const REVIEW_CONTROLS_MS = 180;
// Glisser le déclencheur vers le haut en filmant zoome : ×2 tous les ZOOM_SLIDE points.
const ZOOM_SLIDE = 140;
const ZOOM_SLIDE_MAX = 8;
// Après ce mouvement, le geste choisit son axe jusqu'au relâchement : vertical = zoom, horizontal = cadenas.
const AXIS_LOCK_DISTANCE = 14;
// Deux petits appuis d'un second doigt pendant qu'on tient le déclencheur : la caméra se retourne.
const SECOND_TAP_MS = 250;
// La rangée de zoom, au-dessus du déclencheur et du nom du filtre qui s'affiche un instant.
const ZOOM_BAR_SPACE = 64;

// filter : le filtre choisi avant la prise, repris par l'éditeur (il ne touche pas encore au fichier).
// Une fois la caméra autorisée, inutile d'attendre la relecture de la permission (asynchrone) pour
// monter l'aperçu à la prochaine ouverture.
const cameraKnown = { granted: false };
const PREVIEW_FADE_MS = 200;

type Capture = { uri: string; kind: 'image' | 'video'; takenAt: number; filter: FilterId };

function vibrate() {
  Haptics.selectionAsync().catch((e) => log.warn('vibration', e));
}

function formatElapsed(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type ReviewProps = {
  capture: Capture;
  contacts: Contact[];
  onDiscard: () => void;
  onSent: (publicKey: string) => void;
};

// Après la prise : on garde, on envoie à un contact, ou on jette. Rien ne part sans un choix.
function CaptureReview({ capture, contacts, onDiscard, onSent }: ReviewProps) {
  const colors = useMediaColors();
  const styles = useStyles();
  const { top: topInset } = useInsets();
  const bottom = useNavigationBarHeight();
  const [picking, setPicking] = useState(false);
  const [saved, setSaved] = useState(false);
  const editor = useRef<MediaEditorHandle>(null);
  const [preparing, setPreparing] = useState(false);
  // Un outil de l'éditeur ouvert en bas (réglages) : les boutons de l'écran s'effacent.
  const [toolOpen, setToolOpen] = useState(false);
  const controls = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(controls, { toValue: toolOpen ? 0 : 1, duration: REVIEW_CONTROLS_MS, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start();
  }, [toolOpen, controls]);

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
        <MediaEditor ref={editor} uri={capture.uri} kind={capture.kind} takenAt={capture.takenAt} initialFilter={capture.filter} onToolChange={setToolOpen} />
        <Animated.View pointerEvents={toolOpen ? 'none' : 'box-none'} style={[styles.topControls, { top: topInset + spacing.md, opacity: controls }]}>
          <IconButton onPress={onDiscard} label={t('camera.jeter')} style={styles.roundControl}>
            <X size={24} color={colors.background} strokeWidth={1.75} />
          </IconButton>
          <IconButton onPress={save} disabled={saved} label={saved ? t('camera.enregistre') : t('camera.enregistrerGalerie')} style={styles.roundControl}>
            {saved ? <Check size={24} color={colors.background} strokeWidth={2} /> : <Download size={24} color={colors.background} strokeWidth={1.75} />}
          </IconButton>
        </Animated.View>
        <Animated.View pointerEvents={toolOpen ? 'none' : 'box-none'} style={[styles.reviewSend, { bottom: bottom + spacing.lg, opacity: controls }]}>
          <Button label={t('camera.envoyerA')} icon={Send} variant="secondary" onPress={() => setPicking(true)} />
        </Animated.View>

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
  onSent: (publicKey: string) => void;
  onRecordingChange: (recording: boolean) => void;
};

// Comme sur Snap : un appui prend une photo, le maintien filme, et glisser vers le cadenas libère le doigt.
export function CameraScreen({ contacts, onSent, onRecordingChange }: Props) {
  const colors = useMediaColors();
  const styles = useStyles();
  const { top: topInset } = useInsets();
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [microphonePermission, requestMicrophone] = useMicrophonePermissions();
  const cameraAllowed = cameraPermission?.granted ?? cameraKnown.granted;
  useEffect(() => {
    if (cameraPermission) cameraKnown.granted = cameraPermission.granted;
  }, [cameraPermission]);
  // L'aperçu apparaît en fondu à la première image, sur l'interface déjà affichée.
  const previewOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    logCameraStep('écran monté');
  }, []);
  useEffect(() => {
    if (cameraPermission) logCameraStep('permission lue');
  }, [cameraPermission?.granted]);
  const onCameraReady = () => {
    logCameraStep('première image');
    Animated.timing(previewOpacity, { toValue: 1, duration: PREVIEW_FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
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
  // Le filtre en direct, appliqué à l'aperçu ; lu par une référence quand la vidéo se termine.
  const [liveFilter, setLiveFilter] = useState<FilterId>('none');
  const liveFilterRef = useRef(liveFilter);
  liveFilterRef.current = liveFilter;
  // Heure, Date, Pellicule : la marque se voit sur l'aperçu, mise à jour à chaque minute.
  const liveStamp = presetOf(liveFilter).stamp;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!liveStamp) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [liveStamp]);
  const window = useWindowDimensions();
  const camera = useRef<PearCameraHandle>(null);
  const barSpace = useBottomBarSpace();

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantsVideo = useRef(false);
  const isRecording = useRef(false);
  const isLocked = useRef(false);
  const stoppedByTap = useRef(false);

  const shutterX = useRef(new Animated.Value(0)).current;
  const shutterScale = useRef(new Animated.Value(1)).current;
  // 0 : le cadenas attend. 1 : il a disparu, et l'icône d'arrêt a pris sa place au centre.
  const lockProgress = useRef(new Animated.Value(0)).current;
  const lockHover = useRef(new Animated.Value(1)).current;
  const overLock = useRef(false);
  const gestureAxis = useRef<'zoom' | 'lock' | null>(null);
  const flipFade = useRef(new Animated.Value(0)).current;

  // Vidéo avec la caméra avant et le flash : un cadre blanc doux autour de l'image et l'écran à pleine
  // luminosité éclairent le visage (pour une photo, c'est le flash d'écran de CameraX qui s'en charge).
  const frontLight = flashOn && filming && facing === 'front';
  const frontGlow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(frontGlow, { toValue: frontLight ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
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

  const animateShutter = (toValue: number) => Animated.spring(shutterScale, { toValue, useNativeDriver: true, overshootClamping: true, damping: 12, stiffness: 300 }).start();

  const resetFilming = () => {
    wantsVideo.current = false;
    isRecording.current = false;
    isLocked.current = false;
    overLock.current = false;
    lockProgress.setValue(0);
    lockHover.setValue(1);
    setRecording(false);
    setLocked(false);
    setFilming(false);
    animateShutter(1);
    Animated.spring(shutterX, { toValue: 0, useNativeDriver: true, overshootClamping: true, damping: 16, stiffness: 240 }).start();
  };

  const startRecording = () => {
    if (!wantsVideo.current || isRecording.current || !camera.current) return;
    isRecording.current = true;
    setRecording(true);
    camera.current
      .startRecording()
      .then((uri) => {
        if (uri) setCapture({ uri, kind: 'video', takenAt: Date.now(), filter: liveFilterRef.current });
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
    try {
      // Déjà tournée et réduite à 2048 px par la caméra : une image légère part plus vite (et passe le relais).
      const photo = await camera.current?.takePicture(PHOTO_MAX_SIZE, PHOTO_JPEG_QUALITY);
      if (!photo?.uri) return;
      setCapture({ uri: photo.uri, kind: 'image', takenAt: Date.now(), filter: liveFilterRef.current });
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
      animateShutter(0.88);
      zoomStart.current = zoomRef.current;
      gestureAxis.current = null;
      holdTimer.current = setTimeout(beginHold, HOLD_MS);
    },
    move: (dx: number, dy: number, fingers: number) => {
      // Un second doigt posé déplace le centre du geste : on l'ignore pour le cadenas et le zoom.
      if (!wantsVideo.current || isLocked.current || fingers > 1) return;
      // Une diagonale ne fait pas les deux : l'axe dominant des premiers points l'emporte jusqu'au relâchement.
      if (!gestureAxis.current) {
        if (Math.hypot(dx, dy) < AXIS_LOCK_DISTANCE) return;
        gestureAxis.current = Math.abs(dy) > Math.abs(dx) ? 'zoom' : 'lock';
      }
      if (gestureAxis.current === 'zoom') {
        // Vers le haut, le zoom monte (×2 tous les ZOOM_SLIDE points) ; en redescendant, il revient.
        if (dy < 0 || zoomRef.current !== zoomStart.current) {
          const next = Math.max(zoomRange.min, Math.min(Math.min(zoomRange.max, ZOOM_SLIDE_MAX), zoomStart.current * Math.pow(2, -Math.min(0, dy) / ZOOM_SLIDE)));
          if (Math.abs(next - zoomRef.current) > 0.01) setZoom(next);
        }
        return;
      }
      const distance = Math.min(0, Math.max(-LOCK_DISTANCE, dx));
      shutterX.setValue(distance);
      const reached = distance <= -(LOCK_DISTANCE - LOCK_REACH);
      if (reached !== overLock.current) {
        overLock.current = reached;
        if (reached) vibrate();
        Animated.spring(lockHover, { toValue: reached ? 1.35 : 1, useNativeDriver: true, overshootClamping: true, damping: 12, stiffness: 300 }).start();
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
        Animated.parallel([
          Animated.spring(shutterX, { toValue: 0, useNativeDriver: true, overshootClamping: true, damping: 16, stiffness: 240 }),
          Animated.spring(lockProgress, { toValue: 1, useNativeDriver: true, overshootClamping: true, damping: 14, stiffness: 220 }),
        ]).start();
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

  const flipCamera = () => {
    vibrate();
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
    // L'autre caméra repart à ×1 ; une vidéo en cours continue dessus.
    setZoom(1);
    setLensId(null);
    Animated.sequence([
      Animated.timing(flipFade, { toValue: 1, duration: 110, useNativeDriver: true }),
      Animated.timing(flipFade, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
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

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      {/* Sur l'image de la caméra, la barre d'Android passe en clair pour rester visible. */}
      <NavigationBar style="light" />
      {cameraAllowed && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: previewOpacity }]}>
        <FilteredView steps={stepsOf(liveFilter, NO_ADJUSTMENTS)} style={StyleSheet.absoluteFill}>
        <PearCameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
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
          onCameraError={({ nativeEvent }) => log.warn('caméra', nativeEvent.message)}
        />
        </FilteredView>
        </Animated.View>
      )}

      {liveStamp && (
        <Svg pointerEvents="none" style={StyleSheet.absoluteFill} width={window.width} height={window.height}>
          {/* Au-dessus du déclencheur et de la barre du bas, qui cachent le bas de l'écran. */}
          <StampMarks kind={liveStamp} stamp={formatStamp(now)} width={window.width} height={window.height - barSpace - SHUTTER_SIZE} />
        </Svg>
      )}
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.frontGlow, { opacity: frontGlow }]} />
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flipFade, { opacity: flipFade }]} />
      <View collapsable={false} style={StyleSheet.absoluteFill} accessibilityLabel={t('camera.changerAide')} {...surface.panHandlers} />

      {!filming && (
        <View style={[styles.topControls, { top: topInset + spacing.md }]}>
          <IconButton onPress={() => setFlashOn(!flashOn)} label={flashOn ? t('camera.couperFlash') : t('camera.activerFlash')} style={styles.roundControl}>
            {flashOn ? <Zap size={24} color={colors.background} fill={colors.background} strokeWidth={1.75} /> : <ZapOff size={24} color={colors.background} strokeWidth={1.75} />}
          </IconButton>
          <IconButton onPress={flipCamera} label={t('camera.changerCamera')} style={styles.roundControl}>
            <SwitchCamera size={24} color={colors.background} strokeWidth={1.75} />
          </IconButton>
        </View>
      )}

      {recording && (
        <View style={[styles.timer, { top: topInset + spacing.md }]}>
          <View style={styles.timerDot} />
          <Text style={styles.timerText}>{formatElapsed(elapsed)}</Text>
        </View>
      )}

      {facing === 'back' && (
        <ZoomBar
          levels={zoomLevels(wide, lensId ? Math.max(2, zoomRange.max) : zoomRange.max)}
          active={activeLevel(zoomLevels(wide, Math.max(2, zoomRange.max)), wide, zoom, lensId)}
          zoom={zoom}
          lens={lensId}
          bottom={barSpace + SHUTTER_SIZE + ZOOM_BAR_SPACE}
          onChoose={(level) => {
            setLensId(level.lens);
            setZoom(level.zoom);
          }}
        />
      )}

      {/* La hauteur ne change jamais : le bouton reste sous le doigt quand la barre du bas s'efface. */}
      <View pointerEvents="box-none" style={[styles.shutterRow, { bottom: barSpace }]}>
        <FilterStrip value={liveFilter} hidden={filming} onChange={setLiveFilter} />
        <Animated.View
          {...shutter.panHandlers}
          accessibilityRole="button"
          accessibilityLabel={locked ? t('camera.arreterVideo') : t('camera.declencheur')}
          style={[styles.shutter, filming && styles.shutterFilming, { transform: [{ translateX: shutterX }, { scale: shutterScale }] }]}
        >
          <Animated.View style={[styles.shutterInner, { opacity: lockProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]}>
            {/* Le filtre choisi se voit au cœur du déclencheur, comme une lentille sur Snap. */}
            {liveFilter !== 'none' && <FilterSwatch id={liveFilter} size={SHUTTER_SIZE - 22} />}
          </Animated.View>
          {filming && (
            <Animated.View
              style={[
                styles.stopIcon,
                { opacity: lockProgress, transform: [{ scale: lockProgress.interpolate({ inputRange: [0, 1], outputRange: [0.2, 1] }) }] },
              ]}
            >
              <Square size={30} color={colors.danger} fill={colors.danger} strokeWidth={1.75} />
            </Animated.View>
          )}
        </Animated.View>
        {filming && (
          <Animated.View
            pointerEvents="none"
            accessibilityLabel={t('camera.verrouiller')}
            style={[
              styles.lock,
              {
                opacity: lockProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
                transform: [{ scale: Animated.multiply(lockHover, lockProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2] })) }],
              },
            ]}
          >
            <Lock size={20} color={colors.background} strokeWidth={1.75} />
          </Animated.View>
        )}
      </View>

      {capture && (
        <CaptureReview
          capture={capture}
          contacts={contacts}
          onDiscard={() => setCapture(null)}
          onSent={(publicKey) => {
            setCapture(null);
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
  topControls: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  roundControl: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timer: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
  },
  timerDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.danger,
  },
  timerText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.background,
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
    borderWidth: 5,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterFilming: {
    borderColor: colors.danger,
  },
  shutterInner: {
    width: SHUTTER_SIZE - 22,
    height: SHUTTER_SIZE - 22,
    borderRadius: radius.full,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  stopIcon: {
    position: 'absolute',
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
  reviewSend: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
  },
}));
