import { MediaStreamTrack, RTCIceCandidate, RTCPeerConnection, RTCRtpTransceiver, RTCSessionDescription } from 'react-native-webrtc';
import type RTCDataChannel from 'react-native-webrtc/lib/typescript/RTCDataChannel';
import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import { open, seal } from '../crypto/box';
import { deriveMessageKey } from '../crypto/pairing';
import { Role, SignalingChannel } from './signaling';
import { log } from '../log';
import { CALL_ICE_GRACE_MS, CALL_PEER_TIMEOUT_MS, DRAIN_POLL_MS, HEARTBEAT_MS, MAX_BUFFERED_BYTES, PEER_TIMEOUT_MS, RETRY_MS } from '../config';
import { iceServers } from '../remoteConfig';

const CONTEXT = 'pear-message-v1';

export type PeerStatus = 'starting' | 'searching' | 'connecting' | 'connected' | 'error';
// host : même réseau. srflx : direct par internet. relay : passe par un serveur relais.
export type RouteType = 'host' | 'srflx' | 'relay';

type Signal =
  | { kind: 'hello' }
  | { kind: 'offer' | 'answer'; session: string; sdp: { type: string; sdp: string } }
  | { kind: 'candidate'; session: string; candidate: IceCandidateInit };

// Appels (vague 5) : les pistes du micro et de la caméra passent dans la même connexion que les messages.
export type CallMedia = { audio: MediaStreamTrack | null; video: MediaStreamTrack | null };
// La renégociation des pistes passe par le canal de données, déjà chiffré : seul le rôle « a » propose,
// « b » demande (« need ») ; il n'y a jamais deux propositions croisées.
type RtcMessage = { type: 'rtc'; kind: 'need' } | { type: 'rtc'; kind: 'offer' | 'answer'; sdp: { type: string; sdp: string } };

type IceCandidateInit = { candidate?: string; sdpMLineIndex?: number | null; sdpMid?: string | null };

// Ce que les statistiques WebRTC donnent sur le chemin utilisé.
type StatsReport = { id: string; type: string; state?: string; nominated?: boolean; localCandidateId?: string; remoteCandidateId?: string; candidateType?: string };

type Callbacks = {
  onStatus: (status: PeerStatus) => void;
  onRoute: (route: RouteType | null) => void;
  onMessage: (message: unknown) => void;
  onBytes: (bytes: Uint8Array) => void;
  // Pear est-il au premier plan ? Annoncé dans chaque battement de coeur.
  isForeground: () => boolean;
  // Battement reçu : `fg` vaut null pour un téléphone d'une ancienne version (sans le champ).
  onPresence: (fg: boolean | null) => void;
  // Les pistes reçues de l'autre téléphone pendant un appel (null : pas encore de piste de ce type).
  onRemoteMedia?: (media: CallMedia) => void;
};

export class PeerLink {
  private signaling: SignalingChannel;
  private messageKey: Uint8Array;
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private session: string | null = null;
  private pendingCandidates: IceCandidateInit[] = [];
  private queue: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private lastSeen = 0;
  private lastAttempt = 0;
  private stopped = false;
  // Les pistes à envoyer pendant un appel ; null hors appel. Réappliquées à chaque nouvelle connexion.
  private media: CallMedia | null = null;
  // Change à chaque nouvelle connexion : un envoi de fichier en cours sait alors qu'il doit s'arrêter.
  epoch = 0;

  // Les deux téléphones calculent le même rôle : un seul lance l'appel, l'autre répond.
  constructor(private role: Role, secret: Uint8Array, private callbacks: Callbacks) {
    this.signaling = new SignalingChannel(secret, role);
    this.messageKey = deriveMessageKey(secret);
  }

  async start() {
    this.callbacks.onStatus('starting');
    try {
      await this.signaling.open(
        (signal) => this.enqueue(() => this.handleSignal(signal as Signal)),
        (e) => this.fail(e),
      );
      if (this.stopped) return;
      this.callbacks.onStatus('searching');
      this.tick();
      this.timer = setInterval(() => this.tick(), HEARTBEAT_MS);
    } catch (e) {
      this.fail(e);
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.closeConnection();
    this.signaling.close();
  }

  // Renvoie false si la connexion n'est pas ouverte : le message reste alors à envoyer.
  send(message: unknown): boolean {
    if (this.channel?.readyState !== 'open') return false;
    this.channel.send(seal(JSON.stringify(message), this.messageKey, CONTEXT));
    return true;
  }

  // Le morceau est déjà chiffré avec la clé de son fichier.
  // Renvoie false si la connexion a changé : le destinataire redemandera la suite à la reconnexion.
  async sendChunk(epoch: number, bytes: Uint8Array): Promise<boolean> {
    while (this.isCurrent(epoch) && (this.channel?.bufferedAmount ?? 0) > MAX_BUFFERED_BYTES) {
      await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
    }
    if (!this.isCurrent(epoch) || !this.channel) return false;
    this.channel.send(bytes);
    return true;
  }

  // Pistes de l'appel en cours (null : fin de l'appel, plus rien n'est envoyé).
  setMedia(media: CallMedia | null) {
    this.media = media;
    this.enqueue(() => this.applyMedia());
  }

  isOpen() {
    return this.channel?.readyState === 'open';
  }

  isCurrent(epoch: number) {
    return !this.stopped && this.epoch === epoch && this.channel?.readyState === 'open';
  }

  // Annonce tout de suite l'état au premier plan (l'app vient de s'ouvrir ou de passer en arrière-plan).
  beat() {
    if (!this.stopped) this.send({ type: 'heartbeat', fg: this.callbacks.isForeground() });
  }

  // Le réseau vient de revenir : inutile d'attendre le prochain essai.
  retryNow() {
    if (this.stopped) return;
    this.lastAttempt = 0;
    this.tick();
  }

  private tick() {
    if (this.channel?.readyState === 'open') {
      // Pendant un appel, le son et l'image passent par la connexion elle-même : tant qu'elle est
      // « connectée », un silence du canal de données (l'autre téléphone en fenêtre flottante, en plein
      // partage d'écran) ne veut pas dire qu'elle est perdue. La perte réelle passe par l'état ICE.
      const mediaAlive = !!this.media && this.pc?.connectionState === 'connected';
      if (!mediaAlive && Date.now() - this.lastSeen > (this.media ? CALL_PEER_TIMEOUT_MS : PEER_TIMEOUT_MS)) {
        // Réseau coupé sans fermeture propre : la connexion semble ouverte mais ne répond plus.
        this.closeConnection();
        this.markOffline();
      } else {
        this.beat();
        return;
      }
    }
    if (Date.now() - this.lastAttempt < RETRY_MS) return;
    this.lastAttempt = Date.now();
    if (this.role === 'a') this.enqueue(() => this.call());
    // L'autre rôle prévient qu'il est là, pour que le premier relance la connexion sans attendre.
    else this.signaling.send({ kind: 'hello' });
  }

  // Quand la connexion a été perdue (journal de diagnostic : durée de la coupure, sans contenu).
  private lostAt = 0;

  private markOffline() {
    if (!this.lostAt) {
      this.lostAt = Date.now();
      log.info('connexion perdue', this.media ? 'pendant un appel' : '');
    }
    this.callbacks.onRoute(null);
    this.callbacks.onStatus('searching');
    this.lastAttempt = 0;
  }

  // Les actions sont traitées une par une, dans leur ordre d'arrivée.
  private enqueue(action: () => Promise<void>) {
    this.queue = this.queue.then(action).catch((e) => this.fail(e));
  }

  private fail(error: unknown) {
    if (this.stopped) return;
    log.warn('connexion', error);
    this.callbacks.onStatus('error');
  }

  private closeConnection() {
    this.channel?.close();
    this.pc?.close();
    this.channel = null;
    this.pc = null;
    this.pendingCandidates = [];
  }

  private newConnection(session: string) {
    this.closeConnection();
    this.session = session;
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.pc = pc;

    pc.addEventListener('icecandidate', (event) => {
      if (event.candidate && this.pc === pc) {
        this.signaling.send({ kind: 'candidate', session, candidate: event.candidate.toJSON() });
      }
    });
    pc.addEventListener('connectionstatechange', () => {
      if (this.pc !== pc) return;
      log.info('état de la connexion', pc.connectionState);
      if (pc.connectionState === 'failed') this.markOffline();
      // Pendant un appel, une connexion « disconnected » (changement de réseau) qui ne revient pas seule
      // est refaite sans attendre le délai du battement de cœur.
      else if (pc.connectionState === 'disconnected' && this.media) {
        setTimeout(() => {
          if (this.pc === pc && !this.stopped && pc.connectionState !== 'connected') {
            log.info('connexion refaite', 'redémarrage après coupure');
            this.closeConnection();
            this.markOffline();
          }
        }, CALL_ICE_GRACE_MS);
      }
    });
    pc.addEventListener('datachannel', (event) => this.attachChannel(event.channel, pc));
    pc.addEventListener('track', () => {
      if (this.pc === pc) this.reportRemote(pc);
    });
    return pc;
  }

  private attachChannel(channel: RTCDataChannel, pc: RTCPeerConnection) {
    this.channel = channel;
    this.epoch += 1;
    channel.addEventListener('open', () => {
      if (this.pc !== pc) return;
      this.lastSeen = Date.now();
      if (this.lostAt) {
        log.info('connexion rétablie', `après ${Math.round((Date.now() - this.lostAt) / 1000)} s`);
        this.lostAt = 0;
      }
      this.callbacks.onStatus('connected');
      this.beat();
      this.signaling.clearSent();
      this.reportRoute(pc);
      if (this.media) this.enqueue(() => this.applyMedia());
    });
    channel.addEventListener('close', () => {
      if (this.pc === pc && !this.stopped) this.markOffline();
    });
    channel.addEventListener('message', (event) => {
      this.lastSeen = Date.now();
      try {
        if (typeof event.data !== 'string') {
          // react-native-webrtc livre toujours les données binaires en ArrayBuffer, jamais en Blob.
          this.callbacks.onBytes(new Uint8Array(event.data as ArrayBuffer));
          return;
        }
        const message = JSON.parse(open(event.data, this.messageKey, CONTEXT));
        if (message.type === 'rtc') this.enqueue(() => this.handleRtc(message as RtcMessage, pc));
        else if (message.type === 'heartbeat') this.callbacks.onPresence(typeof message.fg === 'boolean' ? message.fg : null);
        else this.callbacks.onMessage(message);
      } catch (e) {
        log.warn('message illisible', e);
      }
    });
  }

  private async call() {
    if (this.stopped) return;
    this.lastAttempt = Date.now();
    this.signaling.clearSent();
    const session = to_base64(randombytes_buf(8));
    const pc = this.newConnection(session);
    this.attachChannel(pc.createDataChannel('pear'), pc);

    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    this.signaling.send({ kind: 'offer', session, sdp: { type: offer.type, sdp: offer.sdp } });
  }

  private async handleSignal(signal: Signal) {
    if (this.stopped) return;

    if (signal.kind === 'hello') {
      // Une négociation récente est peut-être encore en cours : on ne la casse pas.
      const negotiating = this.channel?.readyState !== 'open' && Date.now() - this.lastAttempt < RETRY_MS;
      if (this.role === 'a' && !negotiating) await this.call();
      return;
    }

    if (signal.kind === 'offer' && this.role === 'b') {
      this.lastAttempt = Date.now();
      this.signaling.clearSent();
      const pc = this.newConnection(signal.session);
      this.callbacks.onStatus('connecting');
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      await this.flushCandidates(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.signaling.send({ kind: 'answer', session: signal.session, sdp: { type: answer.type, sdp: answer.sdp } });
      return;
    }

    if (signal.session !== this.session || !this.pc) return;

    if (signal.kind === 'answer' && this.role === 'a') {
      this.callbacks.onStatus('connecting');
      await this.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      await this.flushCandidates(this.pc);
    } else if (signal.kind === 'candidate') {
      // Un candidat peut arriver avant la description de l'autre téléphone : on le garde de côté.
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      else this.pendingCandidates.push(signal.candidate);
    }
  }

  // --- Appels ---

  // Les deux transceivers de l'appel (audio et vidéo), créés une fois par connexion. Ils restent ensuite :
  // allumer ou couper la caméra, finir puis refaire un appel ne demandent qu'un changement de piste.
  private mediaTransceivers(pc: RTCPeerConnection): { audio: RTCRtpTransceiver; video: RTCRtpTransceiver } | null {
    const list = pc.getTransceivers().filter((transceiver) => !transceiver.stopped);
    const audio = list.find((transceiver) => transceiver.receiver.track?.kind === 'audio');
    const video = list.find((transceiver) => transceiver.receiver.track?.kind === 'video');
    return audio && video ? { audio, video } : null;
  }

  private async applyMedia() {
    const pc = this.pc;
    if (this.stopped || !pc || this.channel?.readyState !== 'open') return;
    if (this.mediaTransceivers(pc)) {
      await this.attachTracks(pc);
      return;
    }
    if (!this.media) return;
    if (this.role === 'a') await this.addTransceivers(pc);
    else this.send({ type: 'rtc', kind: 'need' });
  }

  private async addTransceivers(pc: RTCPeerConnection) {
    if (!this.mediaTransceivers(pc)) {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
      pc.addTransceiver('video', { direction: 'sendrecv' });
    }
    await this.attachTracks(pc);
    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    this.send({ type: 'rtc', kind: 'offer', sdp: { type: offer.type, sdp: offer.sdp } });
  }

  private async attachTracks(pc: RTCPeerConnection) {
    const transceivers = this.mediaTransceivers(pc);
    if (!transceivers || this.pc !== pc) return;
    await transceivers.audio.sender.replaceTrack(this.media?.audio ?? null);
    await transceivers.video.sender.replaceTrack(this.media?.video ?? null);
    this.reportRemote(pc);
  }

  private async handleRtc(message: RtcMessage, pc: RTCPeerConnection) {
    if (this.stopped || this.pc !== pc) return;
    if (message.kind === 'need') {
      if (this.role === 'a') await this.addTransceivers(pc);
      return;
    }
    if (typeof message.sdp?.sdp !== 'string' || typeof message.sdp?.type !== 'string') return;
    if (message.kind === 'offer' && this.role === 'b') {
      await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
      const transceivers = this.mediaTransceivers(pc);
      if (transceivers) {
        // Créés par la proposition en réception seule : on envoie aussi.
        transceivers.audio.direction = 'sendrecv';
        transceivers.video.direction = 'sendrecv';
      }
      await this.attachTracks(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send({ type: 'rtc', kind: 'answer', sdp: { type: answer.type, sdp: answer.sdp } });
    } else if (message.kind === 'answer' && this.role === 'a' && pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
      this.reportRemote(pc);
    }
  }

  // Les pistes reçues de l'autre téléphone, lues tout de suite (null tant qu'elles ne sont pas prêtes).
  // Une piste n'est utilisable qu'une fois la réponse de l'autre appliquée : avant, le téléphone qui a
  // ajouté les transceivers la voit déjà, mais la bibliothèque ne la connaît pas encore et une vidéo
  // branchée trop tôt reste noire pour toujours.
  remoteMedia(): CallMedia | null {
    const pc = this.pc;
    if (!pc?.remoteDescription || pc.signalingState !== 'stable') return null;
    const transceivers = this.mediaTransceivers(pc);
    if (!transceivers) return null;
    const receiving = (direction: string | null | undefined) => direction === 'sendrecv' || direction === 'recvonly';
    return {
      audio: receiving(transceivers.audio.currentDirection) ? transceivers.audio.receiver.track ?? null : null,
      video: receiving(transceivers.video.currentDirection) ? transceivers.video.receiver.track ?? null : null,
    };
  }

  private reportRemote(pc: RTCPeerConnection) {
    if (this.pc !== pc) return;
    const media = this.remoteMedia();
    if (media) this.callbacks.onRemoteMedia?.(media);
  }

  private async flushCandidates(pc: RTCPeerConnection) {
    const candidates = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of candidates) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  // Lit dans les statistiques WebRTC le chemin réellement utilisé, pour l'afficher à l'écran.
  private async reportRoute(pc: RTCPeerConnection) {
    try {
      const stats: { forEach: (visit: (report: StatsReport) => void) => void } = await pc.getStats();
      const reports: StatsReport[] = [];
      stats.forEach((report) => reports.push(report));
      const pair = reports.find((r) => r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated);
      const local = reports.find((r) => r.id === pair?.localCandidateId);
      const remote = reports.find((r) => r.id === pair?.remoteCandidateId);
      if (local && remote) {
        const relayed = local.candidateType === 'relay' || remote.candidateType === 'relay';
        const direct = local.candidateType === 'host' && remote.candidateType === 'host';
        this.callbacks.onRoute(relayed ? 'relay' : direct ? 'host' : 'srflx');
      }
    } catch (e) {
      log.warn('statistiques', e);
    }
  }
}
