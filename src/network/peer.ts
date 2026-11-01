import { RTCIceCandidate, RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';
import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import { open, seal } from '../crypto/box';
import { deriveMessageKey } from '../crypto/pairing';
import { Role, SignalingChannel } from './signaling';

// STUN aide chaque téléphone à découvrir son adresse publique. Plusieurs serveurs en cas de panne.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
const CONTEXT = 'pear-message-v1';
// Backpressure : au-delà, on attend que le réseau ait vidé la file avant d'envoyer la suite.
const MAX_BUFFERED_BYTES = 1024 * 1024;
const DRAIN_POLL_MS = 20;
// Battement de coeur : sans signe de l'autre téléphone pendant TIMEOUT_MS, la connexion est morte.
const HEARTBEAT_MS = 4000;
const TIMEOUT_MS = 12000;
// Laisse à une négociation le temps d'aboutir avant d'en relancer une, même sur un réseau lent.
const RETRY_MS = 20000;

export type PeerStatus = 'starting' | 'searching' | 'connecting' | 'connected' | 'error';
// host : même réseau. srflx : direct par internet. relay : passe par un serveur relais.
export type RouteType = 'host' | 'srflx' | 'relay';

type Signal =
  | { kind: 'hello' }
  | { kind: 'offer' | 'answer'; session: string; sdp: { type: string; sdp: string } }
  | { kind: 'candidate'; session: string; candidate: object };

type Callbacks = {
  onStatus: (status: PeerStatus) => void;
  onRoute: (route: RouteType | null) => void;
  onMessage: (message: unknown) => void;
  onBytes: (bytes: Uint8Array) => void;
};

export class PeerLink {
  private signaling: SignalingChannel;
  private messageKey: Uint8Array;
  private pc: RTCPeerConnection | null = null;
  private channel: any = null;
  private session: string | null = null;
  private pendingCandidates: object[] = [];
  private queue: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setInterval>;
  private lastSeen = 0;
  private lastAttempt = 0;
  private stopped = false;
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
    while (this.isCurrent(epoch) && this.channel.bufferedAmount > MAX_BUFFERED_BYTES) {
      await new Promise((resolve) => setTimeout(resolve, DRAIN_POLL_MS));
    }
    if (!this.isCurrent(epoch)) return false;
    this.channel.send(bytes);
    return true;
  }

  isOpen() {
    return this.channel?.readyState === 'open';
  }

  isCurrent(epoch: number) {
    return !this.stopped && this.epoch === epoch && this.channel?.readyState === 'open';
  }

  // Le réseau vient de revenir : inutile d'attendre le prochain essai.
  retryNow() {
    if (this.stopped) return;
    this.lastAttempt = 0;
    this.tick();
  }

  private tick() {
    if (this.channel?.readyState === 'open') {
      if (Date.now() - this.lastSeen > TIMEOUT_MS) {
        // Réseau coupé sans fermeture propre : la connexion semble ouverte mais ne répond plus.
        this.closeConnection();
        this.markOffline();
      } else {
        this.send({ type: 'heartbeat' });
        return;
      }
    }
    if (Date.now() - this.lastAttempt < RETRY_MS) return;
    this.lastAttempt = Date.now();
    if (this.role === 'a') this.enqueue(() => this.call());
    // L'autre rôle prévient qu'il est là, pour que le premier relance la connexion sans attendre.
    else this.signaling.send({ kind: 'hello' });
  }

  private markOffline() {
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
    console.warn('Pear connexion :', error);
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
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;

    pc.addEventListener('icecandidate', (event: any) => {
      if (event.candidate && this.pc === pc) {
        this.signaling.send({ kind: 'candidate', session, candidate: event.candidate.toJSON() });
      }
    });
    pc.addEventListener('connectionstatechange', () => {
      if (this.pc === pc && pc.connectionState === 'failed') this.markOffline();
    });
    pc.addEventListener('datachannel', (event: any) => this.attachChannel(event.channel, pc));
    return pc;
  }

  private attachChannel(channel: any, pc: RTCPeerConnection) {
    this.channel = channel;
    this.epoch += 1;
    channel.addEventListener('open', () => {
      if (this.pc !== pc) return;
      this.lastSeen = Date.now();
      this.callbacks.onStatus('connected');
      this.signaling.clearSent();
      this.reportRoute(pc);
    });
    channel.addEventListener('close', () => {
      if (this.pc === pc && !this.stopped) this.markOffline();
    });
    channel.addEventListener('message', (event: any) => {
      this.lastSeen = Date.now();
      try {
        if (typeof event.data !== 'string') {
          this.callbacks.onBytes(new Uint8Array(event.data));
          return;
        }
        const message = JSON.parse(open(event.data, this.messageKey, CONTEXT));
        if (message.type !== 'heartbeat') this.callbacks.onMessage(message);
      } catch (e) {
        console.warn('Pear message illisible :', e);
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
      if (this.pc.remoteDescription) await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate as any));
      else this.pendingCandidates.push(signal.candidate);
    }
  }

  private async flushCandidates(pc: RTCPeerConnection) {
    const candidates = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of candidates) await pc.addIceCandidate(new RTCIceCandidate(candidate as any));
  }

  // Lit dans les statistiques WebRTC le chemin réellement utilisé, pour l'afficher à l'écran.
  private async reportRoute(pc: RTCPeerConnection) {
    try {
      const stats: any = await pc.getStats();
      const reports: any[] = [];
      stats.forEach((report: any) => reports.push(report));
      const pair = reports.find((r) => r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated);
      const local = reports.find((r) => r.id === pair?.localCandidateId);
      const remote = reports.find((r) => r.id === pair?.remoteCandidateId);
      if (local && remote) {
        const relayed = local.candidateType === 'relay' || remote.candidateType === 'relay';
        const direct = local.candidateType === 'host' && remote.candidateType === 'host';
        this.callbacks.onRoute(relayed ? 'relay' : direct ? 'host' : 'srflx');
      }
    } catch (e) {
      console.warn('Pear statistiques :', e);
    }
  }
}
