import { ComponentType, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState, Keyboard, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Reanimated, { cancelAnimation, FadeIn, FadeOut, interpolateColor, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming } from 'react-native-reanimated';
import { BluetoothConnected, ChevronDown, Headphones, Mic, MicOff, Phone, PhoneOff, Smartphone, SwitchCamera, Video, VideoOff, Volume2, LucideIcon, ScreenShare, ScreenShareOff } from 'lucide-react-native';
import { RTCView } from 'react-native-webrtc';
import { StatusBar } from 'expo-status-bar';

import { chat, CallEnd, CallState } from '../chat/manager';
import { getContactProfile } from '../chat/database';
import { formatCallDuration } from '../chat/callText';
import { Avatar, useInsets, usePressFeedback } from '../components/ui';
import { Sheet, SheetChoice } from '../components/Sheet';
import { showDialog } from '../components/dialog';
import type { CallOutput, CallOutputType } from '../../modules/pear-native';
import { useBackInterceptor } from '../navigation/backInterceptors';
import { DURATION, EASE, enterUp, timing } from '../motion';
import { createStyles, fixed, radius, spacing, useColors } from '../theme';
import { t, TextKey } from '../i18n';
import { addPipListener } from '../../modules/pear-native';
import { PearChronometer, PearVideoView } from '../../modules/pear-native/video';
import { SnapDraggable } from './call/SnapDraggable';
import { ZoomableShare } from './call/ZoomableShare';

// L'écran d'un appel (vague 5), par-dessus tout le reste, même l'écran de verrouillage de Pear.
// Audio : fond blanc, photo du contact au centre avec un anneau qui respire tant que ça sonne.
// Vidéo : l'image du contact en plein écran, la nôtre en vignette. On peut réduire l'appel en une
// pastille en haut de l'écran pour continuer à utiliser Pear.

const END_TEXT: Record<CallEnd, TextKey> = {
  hungUp: 'appel.termine',
  remoteHungUp: 'appel.termine',
  failed: 'appel.termine',
  declined: 'appel.refuse',
  busy: 'appel.occupe',
  noAnswer: 'appel.pasDeReponse',
  network: 'appel.reseau',
  unreachable: 'appel.injoignable',
  dropped: 'appel.coupe',
  missed: 'appel.manque',
  permission: 'appel.autorisationMicro',
};

const useCall = () => useSyncExternalStore(chat.subscribeCall, chat.getCall);

// Pear est-il dans la fenêtre flottante d'Android (on a quitté l'app pendant l'appel) ?
function usePip() {
  const [pip, setPip] = useState(false);
  // Chaque événement de la fenêtre flottante force un redessin, même si l'état n'a pas changé.
  const [, redraw] = useState(0);
  const { width } = useWindowDimensions();
  useEffect(() => {
    const subscription = addPipListener((active) => {
      setPip(active);
      redraw((count) => count + 1);
    });
    return () => subscription.remove();
  }, []);
  return pip || width < 300;
}

export function CallLayer({ nameOf }: { nameOf: (contact: string) => string }) {
  const call = useCall();
  const pip = usePip();
  const [minimized, setMinimized] = useState(false);
  const callId = call?.id;
  useEffect(() => setMinimized(false), [callId]);
  // Un appel qui arrive, ou qui se termine, revient toujours en plein écran.
  const forceFull = call?.phase === 'incoming' || call?.phase === 'ended';
  const full = !!call && (!minimized || forceFull);
  useBackInterceptor(full && call?.phase !== 'incoming', () => setMinimized(true));
  if (!call) return null;
  const name = getContactProfile(call.contact).name ?? nameOf(call.contact);
  // Fenêtre flottante : seulement l'image du contact (ou la nôtre), ou sa photo, son nom et la durée.
  if (pip) return <CallPip call={call} name={name} />;
  return full ? (
    <Reanimated.View key="full" entering={FadeIn.duration(DURATION.screen).easing(EASE)} exiting={FadeOut.duration(DURATION.screen).easing(EASE)} style={StyleSheet.absoluteFill}>
      <CallFull call={call} name={name} onMinimize={() => setMinimized(true)} />
    </Reanimated.View>
  ) : (
    <CallPill
      call={call}
      name={name}
      onPress={() => {
        // L'appel revient en plein écran : le clavier d'une conversation se ferme.
        Keyboard.dismiss();
        setMinimized(false);
      }}
    />
  );
}

function statusText(call: CallState) {
  if (call.phase === 'ended') return t(call.end ? END_TEXT[call.end] : 'appel.termine');
  if (call.phase === 'incoming') return t(call.video ? 'appel.entrantVideo' : 'appel.entrantAudio');
  if (call.phase === 'calling') return t('appel.appel');
  if (call.phase === 'ringing') return t('appel.sonne');
  if (call.phase === 'connecting') return t('appel.connexion');
  if (call.reconnecting) return t('appel.reconnexion');
  return null;
}

// Le chronomètre de l'appel, redessiné seul chaque seconde.
// La durée : toujours « maintenant moins le départ », jamais un compteur qui additionne, sur l'horloge
// monotone. Un seul minuteur lié à l'affichage ; il recalcule aussi au retour au premier plan.
function Chrono({ call, style }: { call: CallState; style: object }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((count) => count + 1), 1000);
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && tick((count) => count + 1));
    return () => {
      clearInterval(id);
      subscription.remove();
    };
  }, []);
  const elapsed = call.startedMono !== null ? performance.now() - call.startedMono : Date.now() - (call.startedAt ?? Date.now());
  return <Text style={[style, { fontVariant: ['tabular-nums'] }]}>{formatCallDuration(Math.max(0, Math.floor(elapsed / 1000)))}</Text>;
}

const OUTPUT_ICONS: Record<CallOutputType, LucideIcon> = {
  earpiece: Smartphone,
  speaker: Volume2,
  bluetooth: BluetoothConnected,
  wired: Headphones,
  usb: Headphones,
};

// Le nom affiché pour une sortie : le vrai nom de l'appareil Bluetooth s'il est connu, sinon son type.
function outputLabel(output: CallOutput) {
  if (output.name) return output.name;
  const key = { earpiece: 'appel.ecouteurTel', speaker: 'appel.hautParleur', bluetooth: 'appel.bluetooth', wired: 'appel.casqueFilaire', usb: 'appel.casqueUsb' }[output.type];
  return t(key as TextKey);
}

function OutputSheet({ outputs, onClose }: { outputs: CallOutput[]; onClose: () => void }) {
  const colors = useColors();
  return (
    <Sheet title={t('appel.sortie')} onClose={onClose}>
      {(close) => (
        <View style={{ gap: 8 }}>
          {outputs.map((output, index) => {
            const Icon = OUTPUT_ICONS[output.type];
            return (
              <SheetChoice
                key={output.id}
                index={index}
                label={outputLabel(output)}
                selected={output.active}
                left={<Icon size={20} color={colors.text} strokeWidth={1.75} />}
                onPress={() => {
                  chat.chooseOutput(output.id);
                  close();
                }}
              />
            );
          })}
        </View>
      )}
    </Sheet>
  );
}

function CallFull({ call, name, onMinimize }: { call: CallState; name: string; onMinimize: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const { top, bottom } = useInsets();
  const photo = getContactProfile(call.contact).photo_uri;
  const showRemote = call.phase === 'active' && call.remoteCamera && !!call.remoteUrl && !call.reconnecting;
  const showLocal = call.cameraOn && !!call.localUrl;
  const onVideo = showRemote || showLocal;
  const ended = call.phase === 'ended';
  const waiting = call.phase === 'calling' || call.phase === 'ringing' || call.phase === 'incoming';
  const status = statusText(call);
  const textColor = onVideo ? colors.onMedia : colors.text;
  const mutedColor = onVideo ? colors.onDarkMuted : colors.textMuted;
  // La sortie audio : l'icône suit la sortie ACTIVE ; avec plus de deux sorties, un appui ouvre la liste.
  const [outputsOpen, setOutputsOpen] = useState(false);
  // Une courte explication avant la fenêtre d'Android, qui redemande le consentement à chaque partage.
  const askShare = () =>
    showDialog(t('appel.partagerTitre'), t('appel.partagerAide'), [
      { label: t('appel.partager'), onPress: () => chat.toggleShare() },
      { label: t('commun.annuler'), style: 'cancel' },
    ]);
  // Un appui au milieu masque les commandes (pour mieux voir la vidéo ou l'écran partagé), un autre les remet.
  const [chromeHidden, setChromeHidden] = useState(false);
  const canHide = call.phase === 'active';
  useEffect(() => {
    if (!canHide) setChromeHidden(false);
  }, [canHide]);
  const toggleChrome = () => canHide && setChromeHidden((hidden) => !hidden);
  const chrome = useSharedValue(1);
  useEffect(() => {
    chrome.set(timing(chromeHidden ? 0 : 1, DURATION.small));
  }, [chromeHidden, chrome]);
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chrome.get() }));
  const chromeEvents = chromeHidden ? 'none' : 'box-none';
  const activeOutput = call.outputs.find((output) => output.active);
  const OutputIcon = activeOutput ? OUTPUT_ICONS[activeOutput.type] : call.speaker ? Volume2 : Smartphone;

  return (
    <View style={[styles.root, onVideo && styles.dark]}>
      {outputsOpen && <OutputSheet outputs={call.outputs} onClose={() => setOutputsOpen(false)} />}
      <StatusBar style={onVideo ? 'light' : 'auto'} />
      {onVideo ? (
        <VideoStage call={call} showRemote={showRemote} showLocal={showLocal} top={top} bottom={bottom} onTap={toggleChrome} chromeHidden={chromeHidden} />
      ) : (
        <Pressable style={StyleSheet.absoluteFill} onPress={toggleChrome} accessibilityLabel={t('appel.commandes')} />
      )}

      <Reanimated.View pointerEvents={chromeEvents} style={[styles.topBar, { paddingTop: top + spacing.sm }, chromeStyle]}>
        {call.phase !== 'incoming' && !ended ? (
          <Pressable onPress={onMinimize} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('appel.reduire')} style={[styles.minimize, onVideo && styles.minimizeOnVideo]}>
            <ChevronDown size={24} color={textColor} strokeWidth={1.75} />
          </Pressable>
        ) : (
          <View style={styles.minimize} />
        )}
        {/* Partager l'écran : en haut à droite, pour garder la rangée de quatre boutons de la planche. */}
        {call.phase === 'active' && !ended && (
          <Reanimated.View entering={FadeIn.duration(DURATION.small).easing(EASE)}>
            <Pressable
              onPress={() => (call.sharing ? chat.toggleShare() : askShare())}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t(call.sharing ? 'appel.arreterPartage' : 'appel.partager')}
              style={[styles.minimize, onVideo && styles.minimizeOnVideo, call.sharing && styles.shareOn]}
            >
              {call.sharing ? <ScreenShareOff size={22} color={fixed.white} strokeWidth={1.75} /> : <ScreenShare size={22} color={textColor} strokeWidth={1.75} />}
            </Pressable>
          </Reanimated.View>
        )}
      </Reanimated.View>

      <Reanimated.View pointerEvents="none" style={[styles.head, onVideo && styles.headOnVideo, chromeStyle]}>
        {!onVideo && (
          <View style={styles.avatarWrap}>
            {waiting && <Breath />}
            <Avatar uri={photo} size={132} />
          </View>
        )}
        <Text style={[styles.name, { color: textColor }]} numberOfLines={1}>
          {name}
        </Text>
        {status ? (
          <Reanimated.Text key={status} entering={FadeIn.duration(DURATION.small).easing(EASE)} style={[styles.status, { color: call.end === 'network' || call.end === 'missed' ? colors.danger : mutedColor }]}>
            {status}
          </Reanimated.Text>
        ) : (
          call.startedAt && <Chrono call={call} style={[styles.status, { color: mutedColor }]} />
        )}
        {call.phase === 'active' && !call.remoteCamera && call.video && <Text style={[styles.hint, { color: mutedColor }]}>{t('appel.cameraCoupee')}</Text>}
        {call.remoteSharing && <Text style={[styles.hint, { color: mutedColor }]}>{t('appel.ecranDe', { nom: name })}</Text>}
        {call.sharing && <Text style={[styles.hint, { color: colors.danger }]}>{t('appel.partageEnCours')}</Text>}
      </Reanimated.View>

      {/* Pas de proposition d'allumer sa caméra quand l'autre partage son écran (ce n'est pas sa caméra). */}
      {call.phase === 'active' && call.remoteCamera && !call.remoteSharing && !call.cameraOn && !chromeHidden && (
        <Reanimated.View entering={enterUp(10, DURATION.screen)} exiting={FadeOut.duration(DURATION.small).easing(EASE)} style={styles.offerWrap}>
          <Text style={[styles.offerText, { color: textColor }]} numberOfLines={1}>
            {t('appel.cameraAllumee', { nom: name })}
          </Text>
          <Pressable onPress={() => chat.toggleCamera()} accessibilityRole="button" style={({ pressed }) => [styles.offerButton, pressed && styles.offerPressed]}>
            <Video size={16} color={fixed.black} strokeWidth={2} />
            <Text style={styles.offerLabel}>{t('appel.allumerMienne')}</Text>
          </Pressable>
        </Reanimated.View>
      )}

      <Reanimated.View pointerEvents={chromeEvents} style={[styles.controls, { paddingBottom: bottom + 32 }, chromeStyle]}>
        {call.phase === 'incoming' ? (
          <View style={styles.answerRow}>
            <RoundButton icon={PhoneOff} label={t('appel.refuser')} variant="danger" onPress={() => chat.declineCall()} onVideo={onVideo} big delay={0} />
            <RoundButton icon={call.video ? Video : Phone} label={t('appel.repondre')} variant="accept" onPress={() => chat.acceptCall()} onVideo={onVideo} big delay={60} />
          </View>
        ) : (
          <View style={[styles.activeControls, ended && styles.disabled]} pointerEvents={ended ? 'none' : 'auto'}>
            <View style={styles.optionRow}>
              <RoundButton icon={call.muted ? MicOff : Mic} label={t(call.muted ? 'appel.microCoupe' : 'appel.micro')} active={call.muted} onPress={chat.toggleMute} onVideo={onVideo} delay={0} />
              <RoundButton
                icon={OutputIcon}
                label={activeOutput ? outputLabel(activeOutput) : t(call.speaker ? 'appel.hautParleur' : 'appel.ecouteurTel')}
                active={call.speaker}
                onPress={call.outputs.length > 2 ? () => setOutputsOpen(true) : chat.toggleSpeaker}
                onVideo={onVideo}
                delay={40}
              />
              <RoundButton
                icon={call.cameraOn ? Video : VideoOff}
                label={t(call.cameraOn ? 'appel.camera' : 'appel.cameraCoupee')}
                active={call.cameraOn}
                disabled={call.phase !== 'active'}
                onPress={() => chat.toggleCamera()}
                onVideo={onVideo}
                delay={80}
              />
              <RoundButton icon={SwitchCamera} label={t('appel.retourner')} disabled={!call.cameraOn || call.sharing} onPress={chat.switchCamera} onVideo={onVideo} delay={120} />
            </View>
            <RoundButton icon={PhoneOff} label={t('appel.raccrocher')} variant="danger" onPress={() => chat.hangUp()} onVideo={onVideo} big delay={160} />
          </View>
        )}
      </Reanimated.View>
    </View>
  );
}

function CallPip({ call, name }: { call: CallState; name: string }) {
  const styles = useStyles();
  const colors = useColors();
  const photo = getContactProfile(call.contact).photo_uri;
  const remote = call.phase === 'active' && call.remoteCamera && !!call.remoteUrl && !call.reconnecting;
  const local = call.cameraOn && !!call.localUrl;
  const status = statusText(call);
  return (
    <View style={[StyleSheet.absoluteFill, styles.pip0, (remote || local) && styles.dark]}>
      {remote && local ? (
        <View style={styles.pipStack}>
          <View style={styles.pipHalf}>
            <RoundedVideo url={call.remoteUrl!} mirror={false} radius={6} />
          </View>
          <View style={styles.pipHalf}>
            <RoundedVideo url={call.localUrl!} mirror={call.front} radius={6} />
          </View>
        </View>
      ) : remote ? (
        <RTCView streamURL={call.remoteUrl!} objectFit={call.remoteSharing ? 'contain' : 'cover'} zOrder={0} style={StyleSheet.absoluteFill} />
      ) : local ? (
        <RTCView streamURL={call.localUrl!} objectFit="cover" mirror={call.front} zOrder={0} style={StyleSheet.absoluteFill} />
      ) : null}
      {!remote && !local && (
        <View style={styles.pipAudio}>
          <Avatar uri={photo} size={56} />
          <Text style={[styles.pipName, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          {status ? (
            <Text style={[styles.pipStatus, { color: colors.textMuted }]} numberOfLines={1}>
              {status}
            </Text>
          ) : (
            // Dans la fenêtre flottante, la durée est tenue par le système : un minuteur JavaScript s'y arrête.
            call.startedMono !== null && <PearChronometer elapsedMs={Math.max(0, performance.now() - call.startedMono)} color={colors.textMuted} style={styles.pipChrono} />
          )}
        </View>
      )}
    </View>
  );
}

// Une vidéo aux coins arrondis : dessinée dans une vue ordinaire (PearVideo, TextureView), que les
// coins rognent vraiment, contrairement à la SurfaceView de RTCView.
function RoundedVideo({ url, mirror, radius }: { url: string; mirror: boolean; radius: number }) {
  return <PearVideoView streamURL={url} mirror={mirror} radius={radius} style={StyleSheet.absoluteFill} />;
}

// L'appel vidéo : une image en grand, l'autre en vignette arrondie qu'on déplace et qui se range dans
// le coin le plus proche. Un appui sur la vignette échange les deux (passage par un bref fondu).
const THUMB_W = 108;
const THUMB_H = 160;
const CONTROLS_H = 250;

function VideoStage({ call, showRemote, showLocal, top, bottom, onTap, chromeHidden }: { call: CallState; showRemote: boolean; showLocal: boolean; top: number; bottom: number; onTap: () => void; chromeHidden: boolean }) {
  const styles = useStyles();
  const { width, height } = useWindowDimensions();
  const [localMain, setLocalMain] = useState(false);
  const both = showRemote && showLocal;
  useEffect(() => {
    if (!both) setLocalMain(false);
  }, [both]);
  const veil = useSharedValue(0);
  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.get() }));
  const swap = () => {
    veil.set(1);
    setLocalMain((value) => !value);
    veil.set(timing(0, 240));
  };
  const slots = useMemo(() => {
    const left = 16;
    const right = width - THUMB_W - 16;
    // Commandes masquées : les coins sont les vrais bords du téléphone. Affichées : la vignette reste sous
    // la barre du haut et au-dessus des boutons ; une vignette restée dans un coin du bas remonte en douceur.
    const high = chromeHidden ? top + 12 : top + 64;
    const low = Math.max(high, chromeHidden ? height - bottom - 12 - THUMB_H : height - bottom - CONTROLS_H - THUMB_H);
    return [
      { x: right, y: high },
      { x: left, y: high },
      { x: right, y: low },
      { x: left, y: low },
    ];
  }, [width, height, top, bottom, chromeHidden]);
  const mainLocal = showLocal && (!showRemote || localMain);
  // L'écran partagé du contact en grand : on peut zoomer dedans (pincer, double appui) et s'y déplacer.
  const sharedMain = !mainLocal && call.remoteSharing;
  const main = (
    <RTCView
      streamURL={mainLocal ? call.localUrl! : call.remoteUrl!}
      // Un écran partagé s'affiche en entier (pas rogné) ; une caméra remplit l'écran.
      objectFit={sharedMain ? 'contain' : 'cover'}
      mirror={mainLocal && call.front}
      zOrder={0}
      style={StyleSheet.absoluteFill}
    />
  );
  return (
    <>
      {sharedMain ? <ZoomableShare onTap={onTap}>{main}</ZoomableShare> : main}
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.dark, veilStyle]} />
      {!sharedMain && <Pressable style={StyleSheet.absoluteFill} onPress={onTap} accessibilityLabel={t('appel.commandes')} />}
      {both && (
        <SnapDraggable slots={slots} onTap={swap} style={styles.thumbWrap}>
          <Reanimated.View entering={FadeIn.duration(DURATION.small).easing(EASE)} style={styles.thumb}>
            <RoundedVideo url={localMain ? call.remoteUrl! : call.localUrl!} mirror={!localMain && call.front} radius={18} />
          </Reanimated.View>
        </SnapDraggable>
      )}
    </>
  );
}

// L'anneau qui respire autour de la photo tant que ça sonne : il grandit en s'effaçant, sans rebond.
function Breath() {
  const styles = useStyles();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withRepeat(withTiming(1, { duration: 1600, easing: EASE }), -1, false));
  }, [progress]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - progress.get()), transform: [{ scale: 1 + 0.32 * progress.get() }] }));
  return <Reanimated.View pointerEvents="none" style={[styles.breath, ring]} />;
}

type IconComponent = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

// Bouton rond de l'appel. Allumé (micro coupé, haut-parleur, caméra) : il se remplit, en fondu.
function RoundButton({
  icon: Icon,
  label,
  onPress,
  active = false,
  variant = 'neutral',
  big = false,
  disabled = false,
  onVideo,
  delay,
}: {
  icon: IconComponent;
  label: string;
  onPress: () => void;
  active?: boolean;
  variant?: 'neutral' | 'danger' | 'accept';
  big?: boolean;
  disabled?: boolean;
  onVideo: boolean;
  // Arrivée en cascade (ms) ; sans valeur, pas d'animation d'entrée.
  delay?: number;
}) {
  const styles = useStyles();
  const colors = useColors();
  const feedback = usePressFeedback();
  const on = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    on.set(timing(active ? 1 : 0, DURATION.small));
  }, [active, on]);
  const idle = onVideo ? 'rgba(255,255,255,0.18)' : colors.surface;
  const lit = onVideo ? fixed.white : colors.text;
  const fill = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(on.get(), [0, 1], [idle, lit]) }));
  const size = big ? 72 : 60;
  const solid = variant === 'danger' ? colors.danger : variant === 'accept' ? colors.signatureStrong : null;
  const iconColor = solid ? fixed.white : active ? (onVideo ? fixed.black : colors.background) : onVideo ? colors.onMedia : colors.text;
  // L'arrivée en cascade est une valeur animée qui finit toujours à 1, pas une animation d'entrée de
  // Reanimated : interrompue (appel réduit, appel suivant), celle-ci laissait parfois un bouton
  // invisible, souvent le micro, le premier de la rangée.
  const shown = useSharedValue(delay === undefined ? 1 : 0);
  useEffect(() => {
    if (delay === undefined) return;
    shown.set(withDelay(delay, timing(1, DURATION.screen)));
    return () => cancelAnimation(shown);
  }, [delay, shown]);
  const arrive = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ translateY: 14 * (1 - shown.get()) }] }));
  return (
    <Reanimated.View style={arrive}>
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={[styles.buttonWrap, disabled && styles.disabled]}>
      <Reanimated.View style={[{ width: size, height: size, borderRadius: size / 2 }, styles.button, solid ? { backgroundColor: solid } : fill, feedback.style]}>
        <Icon size={big ? 30 : 24} color={iconColor} strokeWidth={1.75} />
      </Reanimated.View>
      <Text style={[styles.buttonLabel, { color: onVideo ? colors.onMedia : colors.textMuted }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {label}
      </Text>
    </Pressable>
    </Reanimated.View>
  );
}

// Appel réduit : une pastille en haut de l'écran, nom et durée ; un appui ramène l'appel.
// La pastille se déplace au doigt et se range en haut ou en bas de l'écran, à gauche, au milieu ou à
// droite ; un appui ramène l'appel.
const PILL_HEIGHT = 36;

function CallPill({ call, name, onPress }: { call: CallState; name: string; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const { top, bottom } = useInsets();
  const { width, height } = useWindowDimensions();
  const status = statusText(call);
  const [pillWidth, setPillWidth] = useState(0);
  const slots = useMemo(() => {
    const w = pillWidth || 200;
    const xs = [12, (width - w) / 2, width - w - 12];
    // En bas : au-dessus de la barre des onglets.
    const ys = [top + 4, height - bottom - PILL_HEIGHT - 84];
    return ys.flatMap((y) => xs.map((x) => ({ x, y })));
  }, [pillWidth, width, height, top, bottom]);
  return (
    <Reanimated.View entering={FadeIn.duration(DURATION.small).easing(EASE)} exiting={FadeOut.duration(DURATION.small).easing(EASE)} style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <SnapDraggable slots={slots} initial={1} onTap={onPress}>
      <View onLayout={(event) => setPillWidth(event.nativeEvent.layout.width)} accessibilityRole="button" accessibilityLabel={t('appel.revenir')} style={[styles.pill, { maxWidth: width - 24 }]}>
        <View style={[styles.pillDot, { backgroundColor: call.reconnecting ? colors.textMuted : colors.signatureStrong }]} />
        <Text style={[styles.pillText, styles.pillName]} numberOfLines={1}>
          {name}
        </Text>
        {status ? <Text style={styles.pillText}>· {status}</Text> : call.startedAt ? <Chrono call={call} style={styles.pillText} /> : null}
      </View>
      </SnapDraggable>
    </Reanimated.View>
  );
}

const useStyles = createStyles((colors) => ({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  dark: {
    backgroundColor: fixed.black,
  },
  topBar: {
    paddingHorizontal: spacing.md,
    justifyContent: 'space-between',
    flexDirection: 'row',
  },
  minimize: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareOn: {
    backgroundColor: colors.danger,
  },
  minimizeOnVideo: {
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  head: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  headOnVideo: {
    justifyContent: 'flex-start',
    paddingTop: spacing.md,
  },
  avatarWrap: {
    width: 132,
    height: 132,
    marginBottom: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breath: {
    position: 'absolute',
    width: 132,
    height: 132,
    borderRadius: radius.full,
    borderWidth: 3,
    borderColor: colors.signatureStrong,
  },
  name: {
    fontSize: 28,
    fontWeight: '600',
    textAlign: 'center',
  },
  status: {
    fontSize: 15,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  hint: {
    fontSize: 13,
  },
  offerWrap: {
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  offerText: {
    fontSize: 14,
    fontWeight: '500',
  },
  offerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.full,
    backgroundColor: fixed.white,
  },
  offerPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  offerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: fixed.black,
  },
  controls: {
    paddingHorizontal: spacing.lg,
  },
  answerRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  activeControls: {
    alignItems: 'center',
    gap: 32,
  },
  optionRow: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  disabled: {
    opacity: 0.4,
  },
  buttonWrap: {
    alignItems: 'center',
    gap: 6,
    width: 72,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 12,
  },
  thumbWrap: {
    zIndex: 2,
    shadowColor: fixed.black,
    shadowRadius: 12,
    elevation: 0,
  },
  thumb: {
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: 18,
    overflow: 'hidden',
  },
  pipStack: {
    flex: 1,
    gap: 2,
  },
  pipHalf: {
    flex: 1,
  },
  pip0: {
    backgroundColor: colors.background,
  },
  pipAudio: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 8,
  },
  pipName: {
    fontSize: 14,
    fontWeight: '600',
  },
  pipChrono: {
    width: 80,
    height: 20,
  },
  pipStatus: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    shadowColor: colors.shadow,
    elevation: 6,
  },
  pillName: {
    flexShrink: 1,
  },
  pillDot: {
    flexShrink: 0,
    width: 8,
    height: 8,
    borderRadius: radius.full,
  },
  pillText: {
    color: colors.onAccent,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
}));
