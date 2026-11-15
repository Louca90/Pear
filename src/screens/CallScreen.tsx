import { ComponentType, useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { FadeIn, FadeOut, interpolateColor, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Bluetooth, ChevronDown, Ear, Headphones, Mic, MicOff, Phone, PhoneOff, SwitchCamera, Video, VideoOff, Volume2 } from 'lucide-react-native';
import { RTCView } from 'react-native-webrtc';
import { StatusBar } from 'expo-status-bar';

import { chat, CallEnd, CallState } from '../chat/manager';
import { getContactProfile } from '../chat/database';
import { formatCallDuration } from '../chat/callText';
import { Avatar, useInsets, usePressFeedback } from '../components/ui';
import { useBackInterceptor } from '../navigation/backInterceptors';
import { DURATION, EASE, timing } from '../motion';
import { createStyles, fixed, radius, spacing, useColors } from '../theme';
import { t, TextKey } from '../i18n';
import { addPipListener } from '../../modules/pear-native';

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
  useEffect(() => {
    const subscription = addPipListener(setPip);
    return () => subscription.remove();
  }, []);
  return pip;
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
    <CallPill call={call} name={name} onPress={() => setMinimized(false)} />
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
function Chrono({ since, style }: { since: number; style: object }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <Text style={style}>{formatCallDuration(Math.max(0, Math.floor((now - since) / 1000)))}</Text>;
}

function CallFull({ call, name, onMinimize }: { call: CallState; name: string; onMinimize: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const { top, bottom } = useInsets();
  const photo = getContactProfile(call.contact).photo_uri;
  const showRemote = call.phase === 'active' && call.remoteCamera && !!call.remoteUrl && !call.reconnecting;
  const showLocalFull = !showRemote && call.cameraOn && !!call.localUrl;
  const onVideo = showRemote || showLocalFull;
  const ended = call.phase === 'ended';
  const waiting = call.phase === 'calling' || call.phase === 'ringing' || call.phase === 'incoming';
  const status = statusText(call);
  const textColor = onVideo ? colors.onMedia : colors.text;
  const mutedColor = onVideo ? colors.onDarkMuted : colors.textMuted;

  return (
    <View style={[styles.root, onVideo && styles.dark]}>
      <StatusBar style={onVideo ? 'light' : 'auto'} />
      {showRemote && <RTCView streamURL={call.remoteUrl!} objectFit="cover" zOrder={0} style={StyleSheet.absoluteFill} />}
      {showLocalFull && <RTCView streamURL={call.localUrl!} objectFit="cover" mirror={call.front} zOrder={0} style={StyleSheet.absoluteFill} />}
      {showRemote && call.cameraOn && call.localUrl && (
        <Reanimated.View entering={FadeIn.duration(DURATION.small).easing(EASE)} style={[styles.pip, { top: top + 56 }]}>
          <RTCView streamURL={call.localUrl} objectFit="cover" mirror={call.front} zOrder={1} style={StyleSheet.absoluteFill} />
        </Reanimated.View>
      )}

      <View style={[styles.topBar, { paddingTop: top + spacing.sm }]}>
        {call.phase !== 'incoming' && !ended ? (
          <Pressable onPress={onMinimize} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('appel.reduire')} style={[styles.minimize, onVideo && styles.minimizeOnVideo]}>
            <ChevronDown size={24} color={textColor} strokeWidth={1.75} />
          </Pressable>
        ) : (
          <View style={styles.minimize} />
        )}
      </View>

      <View style={[styles.head, onVideo && styles.headOnVideo]}>
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
          call.startedAt && <Chrono since={call.startedAt} style={[styles.status, { color: mutedColor }]} />
        )}
        {call.phase === 'active' && !call.remoteCamera && call.video && <Text style={[styles.hint, { color: mutedColor }]}>{t('appel.cameraCoupee')}</Text>}
      </View>

      <View style={[styles.controls, { paddingBottom: bottom + 32 }]}>
        {call.phase === 'incoming' ? (
          <View style={styles.answerRow}>
            <RoundButton icon={PhoneOff} label={t('appel.refuser')} variant="danger" onPress={() => chat.declineCall()} onVideo={onVideo} big />
            <RoundButton icon={call.video ? Video : Phone} label={t('appel.repondre')} variant="accept" onPress={() => chat.acceptCall()} onVideo={onVideo} big />
          </View>
        ) : (
          <View style={[styles.activeControls, ended && styles.disabled]} pointerEvents={ended ? 'none' : 'auto'}>
            <View style={styles.optionRow}>
              <RoundButton icon={call.muted ? MicOff : Mic} label={t(call.muted ? 'appel.microCoupe' : 'appel.micro')} active={call.muted} onPress={chat.toggleMute} onVideo={onVideo} />
              <RoundButton
                icon={call.speaker ? Volume2 : call.headset === 'bluetooth' ? Bluetooth : call.headset === 'wired' ? Headphones : Ear}
                label={t(call.speaker ? 'appel.hautParleur' : call.headset ? 'appel.casque' : 'appel.hautParleurCoupe')}
                active={call.speaker}
                onPress={chat.toggleSpeaker}
                onVideo={onVideo}
              />
              <RoundButton
                icon={call.cameraOn ? Video : VideoOff}
                label={t(call.cameraOn ? 'appel.camera' : 'appel.cameraCoupee')}
                active={call.cameraOn}
                disabled={call.phase !== 'active'}
                onPress={() => chat.toggleCamera()}
                onVideo={onVideo}
              />
              {call.cameraOn && <RoundButton icon={SwitchCamera} label={t('appel.retourner')} onPress={chat.switchCamera} onVideo={onVideo} />}
            </View>
            <RoundButton icon={PhoneOff} label={t('appel.raccrocher')} variant="danger" onPress={() => chat.hangUp()} onVideo={onVideo} big />
          </View>
        )}
      </View>
    </View>
  );
}

function CallPip({ call, name }: { call: CallState; name: string }) {
  const styles = useStyles();
  const colors = useColors();
  const photo = getContactProfile(call.contact).photo_uri;
  const remote = call.phase === 'active' && call.remoteCamera && !!call.remoteUrl && !call.reconnecting;
  const local = !remote && call.cameraOn && !!call.localUrl;
  const status = statusText(call);
  return (
    <View style={[StyleSheet.absoluteFill, styles.pip0, (remote || local) && styles.dark]}>
      {remote && <RTCView streamURL={call.remoteUrl!} objectFit="cover" zOrder={0} style={StyleSheet.absoluteFill} />}
      {local && <RTCView streamURL={call.localUrl!} objectFit="cover" mirror={call.front} zOrder={0} style={StyleSheet.absoluteFill} />}
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
            call.startedAt && <Chrono since={call.startedAt} style={[styles.pipStatus, { color: colors.textMuted }]} />
          )}
        </View>
      )}
    </View>
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
}: {
  icon: IconComponent;
  label: string;
  onPress: () => void;
  active?: boolean;
  variant?: 'neutral' | 'danger' | 'accept';
  big?: boolean;
  disabled?: boolean;
  onVideo: boolean;
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
  return (
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} disabled={disabled} accessibilityRole="button" accessibilityLabel={label} style={[styles.buttonWrap, disabled && styles.disabled]}>
      <Reanimated.View style={[{ width: size, height: size, borderRadius: size / 2 }, styles.button, solid ? { backgroundColor: solid } : fill, feedback.style]}>
        <Icon size={big ? 30 : 24} color={iconColor} strokeWidth={1.75} />
      </Reanimated.View>
      <Text style={[styles.buttonLabel, { color: onVideo ? colors.onMedia : colors.textMuted }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// Appel réduit : une pastille en haut de l'écran, nom et durée ; un appui ramène l'appel.
function CallPill({ call, name, onPress }: { call: CallState; name: string; onPress: () => void }) {
  const styles = useStyles();
  const colors = useColors();
  const { top } = useInsets();
  const status = statusText(call);
  return (
    <Reanimated.View entering={FadeIn.duration(DURATION.small).easing(EASE)} exiting={FadeOut.duration(DURATION.small).easing(EASE)} style={[styles.pillWrap, { top: top + 4 }]} pointerEvents="box-none">
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={t('appel.revenir')} style={styles.pill}>
        <View style={[styles.pillDot, { backgroundColor: call.reconnecting ? colors.textMuted : colors.signatureStrong }]} />
        <Text style={styles.pillText} numberOfLines={1}>
          {name}
        </Text>
        {status ? <Text style={styles.pillText}>· {status}</Text> : call.startedAt ? <Chrono since={call.startedAt} style={styles.pillText} /> : null}
      </Pressable>
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
    flexDirection: 'row',
  },
  minimize: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
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
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  disabled: {
    opacity: 0.4,
  },
  buttonWrap: {
    alignItems: 'center',
    gap: 6,
    minWidth: 72,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 12,
  },
  pip: {
    position: 'absolute',
    right: spacing.md,
    width: 108,
    height: 160,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: fixed.black,
    zIndex: 2,
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
  pipStatus: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  pillWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    shadowColor: colors.shadow,
    elevation: 6,
  },
  pillDot: {
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
