import { ComponentRef, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, FlatList, Linking, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraType, CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { NavigationBar } from 'expo-navigation-bar';
import { StatusBar } from 'expo-status-bar';
import { Camera, Check, Download, Lock, Send, Settings, Square, SwitchCamera, X, Zap, ZapOff } from 'lucide-react-native';

import { getContactProfile } from '../chat/database';
import { saveToGallery } from '../chat/files';
import { chat } from '../chat/manager';
import { useBottomBarSpace } from '../components/BottomBar';
import { showDialog } from '../components/dialog';
import { MediaEditor, MediaEditorHandle } from '../components/MediaEditor';
import { Avatar, Button, IconButton, RowPressable, useInsets, useNavigationBarHeight } from '../components/ui';
import { Contact } from '../storage';
import { colors, radius, spacing } from '../theme';

// En dessous de ce temps, c'est une photo. Au-delà, le maintien filme.
const HOLD_MS = 250;
// Le cadenas est à cette distance, à gauche du déclencheur. Lâcher assez près de lui verrouille la vidéo.
const LOCK_DISTANCE = 112;
const LOCK_REACH = 28;
const SHUTTER_SIZE = 84;
const PHOTO_QUALITY = 0.9;
// Environ 30 Mo par minute au lieu de 100 Mo ou plus, encore très net sur un téléphone.
const VIDEO_BITRATE = 4_000_000;
const SHEET_OPEN_MS = 260;
const SHEET_CLOSE_MS = 200;
const DOUBLE_TAP_MS = 300;
const FLIP_SWIPE_DISTANCE = 70;
const FLIP_TAP_DISTANCE = 10;
// Place de la barre d'envoi sous les filtres de l'éditeur.
const REVIEW_SEND_SPACE = 52 + spacing.lg + spacing.md;

type Capture = { uri: string; kind: 'image' | 'video'; takenAt: number };

function vibrate() {
  Haptics.selectionAsync().catch((e) => console.warn('Pear vibration :', e));
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
  const { top: topInset } = useInsets();
  const bottom = useNavigationBarHeight();
  const [picking, setPicking] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(600);
  const sheet = useRef(new Animated.Value(0)).current;
  const editor = useRef<MediaEditorHandle>(null);
  const [preparing, setPreparing] = useState(false);

  // La liste monte simplement du bas vers le haut, sans rebond.
  useEffect(() => {
    Animated.timing(sheet, {
      toValue: picking ? 1 : 0,
      duration: picking ? SHEET_OPEN_MS : SHEET_CLOSE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [picking, sheet]);

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
      showDialog('Enregistrement impossible', String(e));
    }
  };

  const send = async (contact: Contact) => {
    try {
      const uri = await finalUri();
      const ending = extension(uri);
      const mime = capture.kind === 'video' ? 'video/mp4' : ending === '.png' ? 'image/png' : 'image/jpeg';
      await chat.sendFile(contact.publicKey, { uri, name: `${capture.kind === 'video' ? 'video' : 'photo'}${ending}`, size: 0, mime, kind: capture.kind });
      onSent(contact.publicKey);
    } catch (e) {
      showDialog('Envoi impossible', String(e));
    }
  };

  return (
    <Modal visible animationType="fade" onRequestClose={() => (picking ? setPicking(false) : onDiscard())} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.review}>
        <MediaEditor ref={editor} uri={capture.uri} kind={capture.kind} takenAt={capture.takenAt} bottomSpace={bottom + REVIEW_SEND_SPACE} />
        <View style={[styles.topControls, { top: topInset + spacing.md }]}>
          <IconButton onPress={onDiscard} label="Jeter" style={styles.roundControl}>
            <X size={24} color={colors.background} strokeWidth={1.75} />
          </IconButton>
          <IconButton onPress={save} disabled={saved} label={saved ? 'Enregistré' : 'Enregistrer dans la galerie'} style={styles.roundControl}>
            {saved ? <Check size={24} color={colors.background} strokeWidth={2} /> : <Download size={24} color={colors.background} strokeWidth={1.75} />}
          </IconButton>
        </View>
        <View style={[styles.reviewSend, { bottom: bottom + spacing.lg }]}>
          <Button label="Envoyer à" icon={Send} variant="secondary" onPress={() => setPicking(true)} />
        </View>

        {picking && <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicking(false)} accessibilityLabel="Fermer" />}
        <Animated.View
          pointerEvents={picking ? 'auto' : 'none'}
          onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}
          style={[
            styles.sheet,
            { paddingBottom: bottom + spacing.md },
            { transform: [{ translateY: sheet.interpolate({ inputRange: [0, 1], outputRange: [sheetHeight, 0] }) }] },
          ]}
        >
          <Text style={styles.sheetTitle}>Envoyer à</Text>
          <FlatList
            data={contacts}
            keyExtractor={(contact) => contact.publicKey}
            renderItem={({ item }) => (
              <RowPressable onPress={() => send(item)} style={styles.contactRow}>
                <Avatar uri={getContactProfile(item.publicKey).photo_uri} size={40} />
                <Text style={styles.contactName} numberOfLines={1}>{item.name}</Text>
              </RowPressable>
            )}
            ListEmptyComponent={<Text style={styles.sheetEmpty}>Ajoutez d'abord un contact.</Text>}
          />
        </Animated.View>
        {preparing && (
          <View style={styles.preparing} accessibilityLiveRegion="polite">
            <ActivityIndicator color={colors.background} size="large" />
            <Text style={styles.preparingText}>{capture.kind === 'video' ? 'Préparation de la vidéo...' : "Préparation de l'image..."}</Text>
          </View>
        )}
      </View>
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
  const { top: topInset } = useInsets();
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [microphonePermission, requestMicrophone] = useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [flashOn, setFlashOn] = useState(false);
  const [filming, setFilming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [locked, setLocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [capture, setCapture] = useState<Capture | null>(null);
  const camera = useRef<ComponentRef<typeof CameraView>>(null);
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
  const flipFade = useRef(new Animated.Value(0)).current;
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

  const animateShutter = (toValue: number) => Animated.spring(shutterScale, { toValue, useNativeDriver: true, damping: 12, stiffness: 300 }).start();

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
    Animated.spring(shutterX, { toValue: 0, useNativeDriver: true, damping: 16, stiffness: 240 }).start();
  };

  const startRecording = () => {
    if (!wantsVideo.current || isRecording.current || !camera.current) return;
    isRecording.current = true;
    setRecording(true);
    camera.current
      .recordAsync()
      .then((video) => {
        if (video?.uri) setCapture({ uri: video.uri, kind: 'video', takenAt: Date.now() });
      })
      .catch((e) => {
        console.warn('Pear vidéo :', e);
        showDialog('Vidéo non enregistrée', "Maintenez le bouton un peu plus longtemps.");
      })
      .finally(resetFilming);
  };

  // Le mode vidéo garde aussi la photo active (patches/expo-camera) : le maintien filme tout de suite.
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
      const photo = await camera.current?.takePictureAsync({ quality: PHOTO_QUALITY });
      if (photo?.uri) setCapture({ uri: photo.uri, kind: 'image', takenAt: Date.now() });
    } catch (e) {
      showDialog('Photo non prise', String(e));
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
      holdTimer.current = setTimeout(beginHold, HOLD_MS);
    },
    move: (dx: number) => {
      if (!wantsVideo.current || isLocked.current) return;
      const distance = Math.min(0, Math.max(-LOCK_DISTANCE, dx));
      shutterX.setValue(distance);
      const reached = distance <= -(LOCK_DISTANCE - LOCK_REACH);
      if (reached !== overLock.current) {
        overLock.current = reached;
        if (reached) vibrate();
        Animated.spring(lockHover, { toValue: reached ? 1.35 : 1, useNativeDriver: true, damping: 12, stiffness: 300 }).start();
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
          Animated.spring(shutterX, { toValue: 0, useNativeDriver: true, damping: 16, stiffness: 240 }),
          Animated.spring(lockProgress, { toValue: 1, useNativeDriver: true, damping: 14, stiffness: 220 }),
        ]).start();
      } else {
        stopFilming();
      }
    },
  };
  const latestGesture = useRef(gesture);
  latestGesture.current = gesture;

  const shutter = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => latestGesture.current.down(),
      onPanResponderMove: (_event, { dx }) => latestGesture.current.move(dx),
      onPanResponderRelease: () => latestGesture.current.up(),
      onPanResponderTerminate: () => latestGesture.current.up(),
    }),
  ).current;

  const flipCamera = () => {
    vibrate();
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
    Animated.sequence([
      Animated.timing(flipFade, { toValue: 1, duration: 110, useNativeDriver: true }),
      Animated.timing(flipFade, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]).start();
  };

  const surfaceRelease = (dx: number, dy: number) => {
    if (filming) return;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > FLIP_SWIPE_DISTANCE) {
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

  // Sur l'image : un double appui ou un glissé change de caméra.
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
        <Text style={styles.deniedText}>Autorisez la caméra pour prendre des photos et des vidéos.</Text>
        <Button
          label={cameraPermission.canAskAgain ? 'Autoriser la caméra' : 'Ouvrir les réglages'}
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
      {cameraPermission?.granted && (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mode="video"
          videoQuality="1080p"
          videoBitrate={VIDEO_BITRATE}
          flash={flashOn ? 'on' : 'off'}
          enableTorch={flashOn && filming}
          mute={!microphonePermission?.granted}
        />
      )}

      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flipFade, { opacity: flipFade }]} />
      <View collapsable={false} style={StyleSheet.absoluteFill} accessibilityLabel="Double appui ou glissé pour changer de caméra" {...surface.panHandlers} />

      {!filming && (
        <View style={[styles.topControls, { top: topInset + spacing.md }]}>
          <IconButton onPress={() => setFlashOn(!flashOn)} label={flashOn ? 'Couper le flash' : 'Activer le flash'} style={styles.roundControl}>
            {flashOn ? <Zap size={24} color={colors.background} fill={colors.background} strokeWidth={1.75} /> : <ZapOff size={24} color={colors.background} strokeWidth={1.75} />}
          </IconButton>
          <IconButton onPress={flipCamera} label="Changer de caméra" style={styles.roundControl}>
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

      {/* La hauteur ne change jamais : le bouton reste sous le doigt quand la barre du bas s'efface. */}
      <View pointerEvents="box-none" style={[styles.shutterRow, { bottom: barSpace }]}>
        <Animated.View
          {...shutter.panHandlers}
          accessibilityRole="button"
          accessibilityLabel={locked ? 'Arrêter la vidéo' : 'Appuyer pour une photo, maintenir pour une vidéo'}
          style={[styles.shutter, filming && styles.shutterFilming, { transform: [{ translateX: shutterX }, { scale: shutterScale }] }]}
        >
          <Animated.View style={[styles.shutterInner, { opacity: lockProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }]} />
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
            accessibilityLabel="Lâcher ici pour verrouiller"
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

const styles = StyleSheet.create({
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
    backgroundColor: colors.background,
  },
  stopIcon: {
    position: 'absolute',
  },
  flipFade: {
    backgroundColor: colors.text,
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
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '60%',
    paddingTop: spacing.lg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.background,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  sheetEmpty: {
    fontSize: 16,
    color: colors.textMuted,
    padding: spacing.lg,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.sm,
    paddingHorizontal: spacing.lg - spacing.sm,
    paddingVertical: spacing.sm + 4,
  },
  contactName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
});
