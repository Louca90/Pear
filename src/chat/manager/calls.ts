import { AppState, AppStateStatus, PermissionsAndroid, Platform } from 'react-native';
import { mediaDevices, MediaStream, MediaStreamTrack } from 'react-native-webrtc';
import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import { sendPush } from '../../network/wake';
import type { CallMedia, PeerStatus } from '../../network/peer';
import { callPushTag, decodeCallPush, encodeCallPush, isCallId } from '../callPayload';
import { getContactProfile, getSetting, isBlocked, setSetting } from '../database';
import { clearCallNotification, showIncomingCall, showMissedCall, showOngoingCall } from '../notifications';
import { addCallHangUpListener, addHeadsetListener, callHeadset, callOutputs, CallOutput, Headset, setCallOutput, setCallAudio, setCallPip, closeCallPip, showOverLock, startCallService, startRinging, stopCallService, stopRinging } from '../../../modules/pear-native';
import { t } from '../../i18n';
import { log } from '../../log';

import { playSound } from '../../screens/chat/sounds';
import { ChatCore } from './core';
import { addSystemMessage } from './outbox';
import { pushKeysFor } from './secure';
import { asPayload, Payload } from './types';
import { resolveToken } from './wake';

// Appels audio et vidéo (vague 5). Tout passe par la connexion directe déjà chiffrée avec le contact :
// l'invitation, la réponse et les pistes (peer.ts). Le push « call » ne fait que réveiller l'autre
// téléphone pour qu'il se connecte. Sans serveur TURN, si la connexion directe est impossible, l'appel
// le dit (« Appel impossible sur ce réseau ») au lieu de sonner dans le vide : l'autre téléphone ne sonne
// qu'à la réception de l'invitation, donc seulement une fois connecté.

export type CallPhase = 'calling' | 'ringing' | 'incoming' | 'connecting' | 'active' | 'ended';
export type CallEnd = 'hungUp' | 'remoteHungUp' | 'declined' | 'busy' | 'noAnswer' | 'network' | 'unreachable' | 'dropped' | 'missed' | 'permission' | 'failed';

export type CallState = {
  id: string;
  contact: string;
  // Appel lancé depuis ce téléphone.
  outgoing: boolean;
  // Appel commencé en vidéo (la caméra peut ensuite être coupée ou allumée).
  video: boolean;
  phase: CallPhase;
  end: CallEnd | null;
  startedAt: number | null;
  // Le même instant sur l'horloge qui ne recule jamais (performance.now) : la durée affichée se calcule
  // toujours « maintenant moins départ », même si l'heure du téléphone change.
  startedMono: number | null;
  // La connexion directe est tombée pendant l'appel : on attend qu'elle revienne.
  reconnecting: boolean;
  muted: boolean;
  speaker: boolean;
  // Casque branché ou connecté : il remplace l'écouteur (le haut-parleur reste au choix).
  headset: Headset;
  // Les sorties audio (écouteur, haut-parleur, casques avec leur nom) et laquelle est active.
  outputs: CallOutput[];
  cameraOn: boolean;
  // Je partage mon écran / l'autre partage le sien.
  sharing: boolean;
  remoteSharing: boolean;
  front: boolean;
  remoteCamera: boolean;
  localUrl: string | null;
  remoteUrl: string | null;
};

// L'appelant attend la connexion et l'accusé « ça sonne » ; ensuite, la réponse.
const CONNECT_MS = 30 * 1000;
const RING_MS = 45 * 1000;
// Invitation partie en direct sans réponse : la connexion était peut-être déjà morte, on envoie le push.
const DIRECT_INVITE_MS = 4000;
// Connexion perdue pendant l'appel : délai pour qu'elle revienne avant de raccrocher.
const DROP_MS = 20 * 1000;
// L'écran de fin reste affiché un instant.
const ENDED_MS = 1800;
// Après un push d'appel, la connexion avec ce contact passe en premier le temps de recevoir l'invitation.
const EXPECT_MS = 45 * 1000;
const VIDEO = { facingMode: 'user', width: 1280, height: 720, frameRate: 30 };

let state: CallState | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let inviteTimer: ReturnType<typeof setTimeout> | undefined;
let dropTimer: ReturnType<typeof setTimeout> | undefined;
// Tonalité d'attente de l'appelant, tant que ça sonne chez l'autre.
let waitingTone: ReturnType<typeof setInterval> | undefined;

function startWaitingTone() {
  stopWaitingTone();
  playSound('callWaiting');
  waitingTone = setInterval(() => playSound('callWaiting'), 3000);
}

function stopWaitingTone() {
  clearInterval(waitingTone);
  waitingTone = undefined;
}
let expectTimer: ReturnType<typeof setTimeout> | undefined;
let clearTimer: ReturnType<typeof setTimeout> | undefined;
let audioTrack: MediaStreamTrack | null = null;
let videoTrack: MediaStreamTrack | null = null;
// L'écran partagé : il REMPLACE la piste de la caméra tant que le partage dure (replaceTrack, sans renégociation).
let screenTrack: MediaStreamTrack | null = null;
let remoteVideoId: string | null = null;
// L'appelant a vu la signalisation passer (« connecting ») : l'autre téléphone répond, mais le chemin
// direct n'aboutit pas. Sans ça, il est simplement injoignable.
let sawSignal = false;
let appState: { remove: () => void } | null = null;
let headsetWatch: { remove: () => void } | null = null;

// Le son de l'appel commence : on suit les casques qui arrivent ou partent.
function startAudio(speaker: boolean) {
  // Un casque connecté passe avant ; sinon l'écouteur pour l'audio, le haut-parleur pour la vidéo.
  setCallAudio(speaker ? 'auto-speaker' : 'auto-earpiece');
  set({ headset: callHeadset() });
  refreshOutputs();
  askBluetoothOnce();
  headsetWatch?.remove();
  headsetWatch = addHeadsetListener((headset) => {
    set({ headset });
    refreshOutputs();
  });
}

// La liste des sorties relue (l'appareil change de route un instant après la demande).
export function refreshOutputs() {
  const outputs = callOutputs();
  const active = outputs.find((output) => output.active);
  set({ outputs, ...(active ? { speaker: active.type === 'speaker' } : {}) });
}

// Le vrai nom d'un appareil Bluetooth demande BLUETOOTH_CONNECT (Android 12+) : demandé une seule fois, au
// premier appel, sans bloquer ; refusé, le sélecteur affiche simplement « Bluetooth ».
function askBluetoothOnce() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 31 || getSetting('bluetooth_asked') === '1') return;
  setSetting('bluetooth_asked', '1');
  PermissionsAndroid.request('android.permission.BLUETOOTH_CONNECT' as never)
    .then(() => refreshOutputs())
    .catch(() => undefined);
}

// Choix dans la liste : respecté tant que l'appareil reste disponible.
export function chooseOutput(id: number) {
  if (!state) return;
  setCallOutput(id);
  setTimeout(refreshOutputs, 150);
}

export function getCall() {
  return state;
}

export function subscribeCall(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(patch: Partial<CallState>) {
  if (!state) return;
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
  updatePip();
}

// Quitter Pear pendant un appel (lancé ou en cours, pas quand il sonne chez nous) ouvre la fenêtre
// flottante : en hauteur s'il y a une image à montrer, carrée pour un appel audio.
let pipConfig = '';
function updatePip() {
  const on = !!state && (state.phase === 'calling' || state.phase === 'ringing' || state.phase === 'connecting' || state.phase === 'active');
  const tall = !!state && (state.cameraOn || (state.phase === 'active' && state.remoteCamera && state.video));
  const config = on ? (tall ? '9:16' : '1:1') : 'off';
  if (config === pipConfig) return;
  pipConfig = config;
  const [width, height] = tall ? [9, 16] : [1, 1];
  setCallPip(on, width, height).catch((e) => log.warn('fenêtre flottante', e));
}

const live = () => !!state && state.phase !== 'ended';
const newId = () => to_base64(randombytes_buf(12));

function nameOf(core: ChatCore, contact: string) {
  return getContactProfile(contact).name ?? core.names.get(contact) ?? 'Pear';
}

function sendCall(core: ChatCore, contact: string, message: Payload) {
  return core.links.get(contact)?.peer.send({ type: 'call', ...message }) ?? false;
}

function attachMedia(core: ChatCore) {
  if (!state) return;
  core.links.get(state.contact)?.peer.setMedia({ audio: audioTrack, video: screenTrack ?? videoTrack });
  pullRemote(core);
}

// Va chercher la vidéo reçue (début d'appel, l'autre allume sa caméra) sans attendre un signal de la connexion.
function pullRemote(core: ChatCore) {
  if (!state) return;
  const media = core.links.get(state.contact)?.peer.remoteMedia();
  if (media) callRemoteMedia(state.contact, media);
}

function startTimer(ms: number, action: () => void) {
  clearTimeout(timer);
  timer = setTimeout(action, ms);
}

// --- Micro et caméra ---

async function allowed(permission: (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS]) {
  if (await PermissionsAndroid.check(permission)) return true;
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

// Le micro est indispensable ; sans la caméra, l'appel vidéo continue en audio.
async function openMicrophone() {
  if (!(await allowed(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO))) return false;
  const stream = await mediaDevices.getUserMedia({ audio: true, video: false });
  audioTrack = stream.getAudioTracks()[0] ?? null;
  return !!audioTrack;
}

async function openCamera() {
  if (!(await allowed(PermissionsAndroid.PERMISSIONS.CAMERA))) return false;
  try {
    const stream = await mediaDevices.getUserMedia({ audio: false, video: VIDEO });
    videoTrack = stream.getVideoTracks()[0] ?? null;
    if (videoTrack) set({ cameraOn: true, front: true, localUrl: new MediaStream([videoTrack]).toURL() });
    return !!videoTrack;
  } catch (e) {
    log.warn('caméra de l’appel', e);
    return false;
  }
}

function closeCamera() {
  videoTrack?.stop();
  videoTrack?.release();
  videoTrack = null;
  set({ cameraOn: false, localUrl: null });
}

function releaseMedia() {
  closeScreen();
  audioTrack?.stop();
  audioTrack?.release();
  audioTrack = null;
  closeCamera();
  remoteVideoId = null;
}

// Écran de l'appel par-dessus le verrouillage, et service de premier plan (micro, caméra).
// Notification de l'appel en cours au format appel d'Android (Now Bar de Samsung, puce de la barre
// d'état), par le service natif ; un APK plus ancien garde celle de Notifee.
let hangUpWatch: { remove: () => void } | null = null;
let nativeService = false;

function showActive(core: ChatCore) {
  if (!state) return;
  const name = nameOf(core, state.contact);
  const camera = state.video || state.cameraOn;
  nativeService = startCallService({
    name,
    photo: getContactProfile(state.contact).photo_uri ?? '',
    video: camera,
    startedAt: state.startedAt ?? 0,
    text: state.startedAt ? t(camera ? 'appel.enCoursVideo' : 'appel.enCoursAudio') : t('appel.appel'),
    channelName: t('appel.enCoursAudio'),
    hangUpLabel: t('appel.raccrocher'),
  });
  if (nativeService) {
    hangUpWatch ??= addCallHangUpListener(() => hangUp(core));
    clearCallNotification(state.contact).catch(() => undefined);
  } else {
    showOngoingCall(state.contact, name, state.video, state.startedAt).catch((e) => log.warn('notification d’appel', e));
  }
}

// --- Appeler ---

export async function startCall(core: ChatCore, contact: string, video: boolean) {
  if (live() || isBlocked(contact)) return;
  clearTimeout(clearTimer);
  sawSignal = false;
  state = {
    id: newId(),
    contact,
    outgoing: true,
    video,
    phase: 'calling',
    end: null,
    startedAt: null,
    startedMono: null,
    reconnecting: false,
    muted: false,
    speaker: video,
    headset: '',
    outputs: [],
    cameraOn: false,
    sharing: false,
    remoteSharing: false,
    front: true,
    remoteCamera: video,
    localUrl: null,
    remoteUrl: null,
  };
  listeners.forEach((listener) => listener());
  log.info('appel lancé', video ? 'vidéo' : 'audio');
  core.callContact = contact;
  core.keepConnected(contact, CONNECT_MS + RING_MS);
  core.reconcileNow();
  try {
    if (!(await openMicrophone())) {
      finish(core, 'permission');
      return;
    }
    if (video) await openCamera();
  } catch (e) {
    log.warn('micro de l’appel', e);
    finish(core, 'permission');
    return;
  }
  if (!live()) return;
  startAudio(video);
  showOverLock(true).catch(() => undefined);
  showActive(core);
  invite(core);
  startTimer(CONNECT_MS, () => {
    if (state?.phase !== 'calling') return;
    finish(core, sawSignal ? 'network' : 'unreachable', true);
  });
}

// En direct si la connexion est ouverte ; sinon le push réveille l'autre téléphone, et l'invitation
// repart dès que la connexion s'ouvre (callLinkStatus).
function invite(core: ChatCore) {
  if (!state || state.phase !== 'calling') return;
  const { contact, id, video } = state;
  clearTimeout(inviteTimer);
  if (sendCall(core, contact, { action: 'invite', id, video })) {
    inviteTimer = setTimeout(() => {
      if (state?.id === id && state.phase === 'calling') pushInvite(core, contact, id, video);
    }, DIRECT_INVITE_MS);
  } else pushInvite(core, contact, id, video);
}

const pushedInvites = new Set<string>();

function pushInvite(core: ChatCore, contact: string, id: string, video: boolean) {
  if (pushedInvites.has(id)) return;
  pushedInvites.add(id);
  resolveToken(core, contact)
    .then(async (token) => {
      if (!token || state?.id !== id) return;
      const keys = pushKeysFor(core, contact);
      const result = await sendPush(token, 'call', encodeCallPush(keys.tag, keys.key, { id, video, at: Date.now() }));
      log.info('push d’appel', result);
    })
    .catch((e) => log.warn('push d’appel', e));
}

// --- Répondre ---

export async function acceptCall(core: ChatCore) {
  if (!state || state.outgoing || state.phase !== 'incoming') return;
  const { contact, id, video } = state;
  stopRinging();
  set({ phase: 'connecting' });
  // Depuis la notification, Pear s'ouvre : le micro n'est accessible qu'une fois au premier plan.
  await untilForeground();
  try {
    if (!(await openMicrophone())) {
      sendCall(core, contact, { action: 'decline', id });
      finish(core, 'permission');
      return;
    }
    if (video) await openCamera();
  } catch (e) {
    log.warn('micro de l’appel', e);
    sendCall(core, contact, { action: 'decline', id });
    finish(core, 'permission');
    return;
  }
  if (state?.id !== id) {
    releaseMedia();
    return;
  }
  if (!sendCall(core, contact, { action: 'accept', id, camera: !!videoTrack })) {
    finish(core, 'dropped');
    return;
  }
  startAudio(video);
  begin(core, video);
}

function untilForeground(): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(limit);
      subscription.remove();
      resolve();
    };
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') done();
    });
    const limit = setTimeout(done, 4000);
  });
}

// L'appel commence : pistes branchées, chronomètre, notification de l'appel en cours.
function begin(core: ChatCore, video: boolean) {
  if (!state) return;
  clearTimeout(timer);
  clearTimeout(inviteTimer);
  set({ phase: 'active', startedAt: Date.now(), startedMono: performance.now(), speaker: video });
  core.keepConnected(state.contact, 4 * 3600 * 1000);
  attachMedia(core);
  showActive(core);
  log.info('appel commencé');
}

export function declineCall(core: ChatCore) {
  if (!state || state.outgoing || state.phase !== 'incoming') return;
  sendCall(core, state.contact, { action: 'decline', id: state.id });
  finish(core, 'declined', true);
}

export function hangUp(core: ChatCore) {
  if (!live() || !state) return;
  if (!state.outgoing && state.phase === 'incoming') {
    declineCall(core);
    return;
  }
  sendCall(core, state.contact, { action: 'end', id: state.id });
  finish(core, 'hungUp', true);
}

// --- Pendant l'appel ---

export function toggleMute() {
  if (!state || !audioTrack) return;
  const muted = !state.muted;
  audioTrack.enabled = !muted;
  set({ muted });
}

export function toggleSpeaker() {
  if (!state) return;
  const speaker = !state.speaker;
  const target = state.outputs.find((output) => output.type === (speaker ? 'speaker' : 'earpiece'));
  if (target) setCallOutput(target.id);
  else setCallAudio(speaker ? 'speaker' : 'earpiece');
  set({ speaker });
  setTimeout(refreshOutputs, 150);
}

export async function toggleCamera(core: ChatCore) {
  if (!state || state.phase !== 'active') return;
  if (videoTrack) {
    // La piste est d'abord retirée de la connexion, puis libérée : libérée alors qu'elle était encore
    // envoyée, l'image restait figée chez l'autre.
    const old = videoTrack;
    videoTrack = null;
    set({ cameraOn: false, localUrl: null });
    attachMedia(core);
    setTimeout(() => {
      old.stop();
      old.release();
    }, 600);
  } else {
    if (!(await openCamera())) return;
    if (!state) return;
    attachMedia(core);
  }
  if (!state) return;
  sendCall(core, state.contact, { action: 'media', id: state.id, camera: !!videoTrack });
  // Caméra allumée : le son passe au haut-parleur, comme pour un appel vidéo.
  if (videoTrack && !state.speaker) toggleSpeaker();
  // Le service doit déclarer la caméra pour qu'elle continue Pear en arrière-plan.
  showActive(core);
}

// --- Partage d'écran ---

function closeScreen() {
  if (!screenTrack) return;
  screenTrack.stop();
  screenTrack.release();
  screenTrack = null;
  set({ sharing: false });
}

// La fenêtre d'Android demande le consentement à CHAQUE partage ; refusé, rien ne change. La piste de
// l'écran remplace celle de la caméra ; l'autre téléphone est prévenu par un message de contrôle.
export async function startShare(core: ChatCore) {
  if (!state || state.phase !== 'active' || screenTrack) return;
  try {
    const stream = await mediaDevices.getDisplayMedia({});
    const track = stream.getVideoTracks()[0] ?? null;
    if (!track || !state) return;
    screenTrack = track;
    track.addEventListener('ended', () => {
      if (screenTrack === track) stopShare(core);
    });
    set({ sharing: true });
    attachMedia(core);
    sendCall(core, state.contact, { action: 'media', id: state.id, camera: true });
    sendCall(core, state.contact, { action: 'screen', id: state.id, on: true });
    log.info('partage d’écran commencé');
  } catch (e) {
    // Consentement refusé : retour à l'appel, rien ne change.
    log.info('partage d’écran refusé', String(e));
  }
}

export function stopShare(core: ChatCore) {
  if (!screenTrack) return;
  closeScreen();
  if (!state) return;
  attachMedia(core);
  sendCall(core, state.contact, { action: 'screen', id: state.id, on: false });
  // La caméra revient si elle était allumée.
  sendCall(core, state.contact, { action: 'media', id: state.id, camera: !!videoTrack });
  log.info('partage d’écran arrêté');
}

export function toggleShare(core: ChatCore) {
  if (screenTrack) stopShare(core);
  else startShare(core).catch((e) => log.warn('partage d’écran', e));
}

export function switchCamera() {
  if (!state || !videoTrack) return;
  videoTrack._switchCamera();
  set({ front: !state.front });
}

// --- Ce qui arrive de l'autre téléphone ---

// Messages « call » reçus par la connexion directe (authentifiés par la clé de la conversation).
export function receiveCall(core: ChatCore, contact: string, raw: unknown) {
  const message = asPayload(raw);
  if (!message || !isCallId(message.id) || isBlocked(contact)) return;
  const id = message.id;
  const mine = state?.contact === contact && state.id === id;

  if (message.action === 'invite') {
    if (mine && state?.phase !== 'ended') {
      // Invitation renvoyée après une reconnexion : on confirme encore qu'on sonne.
      if (state?.phase === 'incoming') sendCall(core, contact, { action: 'ringing', id });
      return;
    }
    if (live()) {
      sendCall(core, contact, { action: 'busy', id });
      return;
    }
    ring(core, contact, id, message.video === true);
    return;
  }
  if (!mine || !state) return;

  if (message.action === 'ringing' && state.phase === 'calling') {
    clearTimeout(inviteTimer);
    set({ phase: 'ringing' });
    startWaitingTone();
    core.keepConnected(contact, RING_MS + 10 * 1000);
    startTimer(RING_MS, () => {
      if (state?.phase !== 'ringing') return;
      sendCall(core, contact, { action: 'end', id });
      finish(core, 'noAnswer', true);
    });
  } else if (message.action === 'accept' && (state.phase === 'calling' || state.phase === 'ringing')) {
    stopWaitingTone();
    set({ remoteCamera: message.camera === true });
    begin(core, state.video);
  } else if (message.action === 'decline' && state.outgoing) {
    finish(core, 'declined', true);
  } else if (message.action === 'busy' && state.outgoing) {
    finish(core, 'busy', true);
  } else if (message.action === 'end') {
    finish(core, state.phase === 'incoming' ? 'missed' : 'remoteHungUp', true);
  } else if (message.action === 'screen' && typeof message.on === 'boolean') {
    set({ remoteSharing: message.on });
    pullRemote(core);
  } else if (message.action === 'media' && typeof message.camera === 'boolean') {
    log.info('caméra du contact', message.camera ? 'allumée' : 'coupée');
    // Caméra rallumée : une vue neuve, pour ne pas rester figé sur la dernière image d'avant.
    if (message.camera) {
      remoteVideoId = null;
      set({ remoteUrl: null });
    }
    set({ remoteCamera: message.camera });
    pullRemote(core);
  }
}

function ring(core: ChatCore, contact: string, id: string, video: boolean) {
  clearTimeout(clearTimer);
  clearTimeout(expectTimer);
  state = {
    id,
    contact,
    outgoing: false,
    video,
    phase: 'incoming',
    end: null,
    startedAt: null,
    startedMono: null,
    reconnecting: false,
    muted: false,
    speaker: video,
    headset: '',
    outputs: [],
    cameraOn: false,
    sharing: false,
    remoteSharing: false,
    front: true,
    remoteCamera: video,
    localUrl: null,
    remoteUrl: null,
  };
  listeners.forEach((listener) => listener());
  log.info('appel reçu', video ? 'vidéo' : 'audio');
  // Pour la page de diagnostic des appels (Profil → Autorisations) : quand la dernière invitation est arrivée.
  setSetting('last_call_invite', String(Date.now()));
  core.callContact = contact;
  core.keepConnected(contact, RING_MS + 10 * 1000);
  sendCall(core, contact, { action: 'ringing', id });
  startRinging();
  showOverLock(true).catch(() => undefined);
  // App ouverte : l'écran de l'appel suffit. Sinon (ou si elle passe en arrière-plan), la notification
  // plein écran prend le relais.
  const notify = () => {
    if (state?.id === id && state.phase === 'incoming') {
      log.info('notification d’appel postée');
      showIncomingCall(contact, nameOf(core, contact), getContactProfile(contact).photo_uri, video).catch((e) => log.warn('notification d’appel', e));
    }
  };
  if (AppState.currentState !== 'active') notify();
  appState?.remove();
  appState = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next !== 'active') notify();
  });
  startTimer(RING_MS + 5000, () => {
    if (state?.id === id && state.phase === 'incoming') finish(core, 'missed', true);
  });
}

// Push « call » : se connecter à l'appelant au plus vite. Rend le contact, ou null (push invalide, vieux,
// d'un inconnu ou d'un contact bloqué).
export function receiveCallPush(core: ChatCore, data: { [key: string]: unknown } | undefined): string | null {
  if (data?.type !== 'call') return null;
  const tag = callPushTag(data.payload);
  if (!tag) return null;
  for (const contact of core.names.keys()) {
    const keys = pushKeysFor(core, contact);
    if (keys.tag !== tag) continue;
    if (isBlocked(contact) || !decodeCallPush(String(data.payload), keys.key, Date.now())) return null;
    if (!live()) {
      core.callContact = contact;
      clearTimeout(expectTimer);
      expectTimer = setTimeout(() => {
        if (!live() && core.callContact === contact) core.callContact = null;
      }, EXPECT_MS);
    }
    core.keepConnected(contact, EXPECT_MS);
    core.reconcileNow();
    log.info('push d’appel reçu');
    return contact;
  }
  return null;
}

// L'état de la connexion directe avec un contact a changé.
export function callLinkStatus(core: ChatCore, contact: string, status: PeerStatus) {
  if (!state || state.contact !== contact || state.phase === 'ended') return;
  if (status === 'connecting') sawSignal = true;
  if (status === 'connected') {
    if (state.phase === 'calling') invite(core);
    if (state.reconnecting) {
      clearTimeout(dropTimer);
      set({ reconnecting: false });
      log.info('appel reconnecté');
      playSound('callReconnected');
      // Après une reconnexion, le partage ne reprend jamais tout seul : il faut un nouveau consentement.
      stopShare(core);
    }
    return;
  }
  // Perdue pendant l'appel : peer.ts rebranche les pistes à la reconnexion ; au-delà du délai, c'est fini.
  if (state.phase === 'active' && !state.reconnecting) {
    set({ reconnecting: true });
    clearTimeout(dropTimer);
    dropTimer = setTimeout(() => {
      if (state?.reconnecting) finish(core, 'dropped', true);
    }, DROP_MS);
  } else if (state.phase === 'incoming' || state.phase === 'connecting') {
    // L'appelant n'est plus joignable : sans connexion, pas d'appel.
    clearTimeout(dropTimer);
    dropTimer = setTimeout(() => {
      if (state && (state.phase === 'incoming' || state.phase === 'connecting') && core.links.get(contact)?.status !== 'connected') finish(core, state.phase === 'incoming' ? 'missed' : 'dropped', true);
    }, DROP_MS);
  }
}

// Les pistes reçues : la vidéo s'affiche par un flux à elle (RTCView), l'audio se joue tout seul.
export function callRemoteMedia(contact: string, media: CallMedia) {
  if (!state || state.contact !== contact) return;
  const video = media.video;
  if (!video || (video.id === remoteVideoId && state.remoteUrl)) return;
  remoteVideoId = video.id;
  const remoteUrl = new MediaStream([video]).toURL();
  log.info('vidéo du contact branchée');
  set({ remoteUrl });
}

// --- Fin ---

function systemCode(current: CallState, end: CallEnd) {
  const kind = current.video ? 'v' : 'a';
  if (current.startedAt) return `call:done:${kind}:${Math.round((current.startedMono !== null ? performance.now() - current.startedMono : Date.now() - current.startedAt) / 1000)}`;
  if (end === 'missed') return `call:missed:${kind}`;
  if (end === 'declined') return `call:declined:${kind}`;
  if (end === 'network') return `call:network:${kind}`;
  if (current.outgoing && end === 'hungUp') return `call:cancelled:${kind}`;
  if (current.outgoing) return `call:noanswer:${kind}`;
  return null;
}

function finish(core: ChatCore, end: CallEnd, record = false) {
  const current = state;
  if (!current || current.phase === 'ended') return;
  clearTimeout(timer);
  clearTimeout(inviteTimer);
  clearTimeout(dropTimer);
  stopWaitingTone();
  playSound('callHangup');
  appState?.remove();
  appState = null;
  headsetWatch?.remove();
  headsetWatch = null;
  stopRinging();
  core.links.get(current.contact)?.peer.setMedia(null);
  releaseMedia();
  setCallAudio('off');
  showOverLock(false).catch(() => undefined);
  // La fenêtre flottante se ferme tout de suite à la fin de l'appel.
  closeCallPip().catch(() => undefined);
  clearCallNotification(current.contact).catch((e) => log.warn('notification d’appel', e));
  stopCallService();
  hangUpWatch?.remove();
  hangUpWatch = null;
  if (core.callContact === current.contact) core.callContact = null;
  log.info('appel fini', end);
  // Pear en arrière-plan : la connexion gardée pour l'appel n'a plus de raison de rester ouverte.
  // Petit délai : le message de fin part d'abord.
  setTimeout(() => {
    if (AppState.currentState === 'active' || live()) return;
    const link = core.links.get(current.contact);
    if (link) {
      link.peer.stop();
      core.links.delete(current.contact);
    }
  }, 1500);

  if (record && end !== 'permission') {
    const code = systemCode(current, end);
    if (code) {
      addSystemMessage(current.contact, current.outgoing ? 1 : 0, code, `call:${current.id}`);
      core.notify();
    }
  }
  if (end === 'missed') showMissedCall(current.contact, nameOf(core, current.contact), current.video).catch((e) => log.warn('notification d’appel', e));

  set({ phase: 'ended', end, reconnecting: false });
  updatePip();
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    if (state?.phase !== 'ended') return;
    state = null;
    listeners.forEach((listener) => listener());
  }, ENDED_MS);
}

// Un appel (en cours, qui sonne ou attendu après un push) garde le réveil en arrière-plan éveillé.
export function callKeepsAwake(core: ChatCore) {
  return live() || core.callContact !== null;
}
