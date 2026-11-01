import { RTCIceCandidate, RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';
import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import { Role, SignalingChannel } from './signaling';

// STUN aide chaque téléphone à découvrir son adresse publique. Plusieurs serveurs en cas de panne.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
const RETRY_MS = 20000;

export type PeerStatus = 'starting' | 'searching' | 'connecting' | 'connected' | 'error';
// host : même réseau. srflx : direct par internet. relay : passe par un serveur relais.
export type RouteType = 'host' | 'srflx' | 'prflx' | 'relay';

type Signal =
  | { kind: 'offer' | 'answer'; session: string; sdp: { type: string; sdp: string } }
  | { kind: 'candidate'; session: string; candidate: object };

type Callbacks = {
  onStatus: (status: PeerStatus, detail?: string) => void;
  onRoute: (route: RouteType | null) => void;
  onPong: (roundTripMs: number) => void;
};

export class PeerLink {
  private signaling: SignalingChannel;
  private pc: RTCPeerConnection | null = null;
  private channel: any = null;
  private session: string | null = null;
  private pendingCandidates: object[] = [];
  private queue: Promise<void> = Promise.resolve();
  private retryTimer?: ReturnType<typeof setInterval>;
  private stopped = false;

  // Les deux téléphones calculent le même rôle : un seul lance l'appel, l'autre répond.
  constructor(private role: Role, secret: Uint8Array, private callbacks: Callbacks) {
    this.signaling = new SignalingChannel(secret, role);
  }

  async start() {
    this.callbacks.onStatus('starting');
    try {
      await this.signaling.open(
        // Les signaux sont traités un par un, dans leur ordre d'arrivée.
        (signal) => {
          this.queue = this.queue.then(() => this.handleSignal(signal as Signal)).catch((e) => this.fail(e));
        },
        (e) => this.fail(e),
      );
      if (this.stopped) return;
      this.callbacks.onStatus('searching');
      if (this.role === 'a') {
        await this.call();
        this.retryTimer = setInterval(() => {
          if (this.channel?.readyState !== 'open') this.call().catch((e) => this.fail(e));
        }, RETRY_MS);
      }
    } catch (e) {
      this.fail(e);
    }
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.retryTimer);
    this.closeConnection();
    await this.signaling.close().catch(() => undefined);
  }

  ping() {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }));
    }
  }

  private fail(error: unknown) {
    if (this.stopped) return;
    console.warn('Pear connexion :', error);
    this.callbacks.onStatus('error', String(error));
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
        this.signaling.send({ kind: 'candidate', session, candidate: event.candidate.toJSON() }).catch((e) => this.fail(e));
      }
    });
    pc.addEventListener('connectionstatechange', () => {
      if (this.pc !== pc) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        this.callbacks.onRoute(null);
        this.callbacks.onStatus('searching', pc.connectionState);
      }
    });
    pc.addEventListener('datachannel', (event: any) => this.attachChannel(event.channel, pc));
    return pc;
  }

  private attachChannel(channel: any, pc: RTCPeerConnection) {
    this.channel = channel;
    channel.addEventListener('open', () => {
      if (this.pc !== pc) return;
      this.callbacks.onStatus('connected');
      this.signaling.clearSent().catch(() => undefined);
      this.reportRoute(pc);
    });
    channel.addEventListener('close', () => {
      if (this.pc !== pc || this.stopped) return;
      this.callbacks.onRoute(null);
      this.callbacks.onStatus('searching');
    });
    channel.addEventListener('message', (event: any) => this.handleMessage(event.data));
  }

  private handleMessage(data: string) {
    const message = JSON.parse(data);
    if (message.type === 'ping') {
      this.channel?.send(JSON.stringify({ type: 'pong', sentAt: message.sentAt }));
    } else if (message.type === 'pong') {
      this.callbacks.onPong(Date.now() - message.sentAt);
    }
  }

  private async call() {
    await this.signaling.clearSent();
    const session = to_base64(randombytes_buf(8));
    const pc = this.newConnection(session);
    this.attachChannel(pc.createDataChannel('pear'), pc);

    const offer = await pc.createOffer({});
    await pc.setLocalDescription(offer);
    await this.signaling.send({ kind: 'offer', session, sdp: { type: offer.type, sdp: offer.sdp } });
  }

  private async handleSignal(signal: Signal) {
    if (this.stopped) return;

    if (signal.kind === 'offer' && this.role === 'b') {
      await this.signaling.clearSent();
      const pc = this.newConnection(signal.session);
      this.callbacks.onStatus('connecting');
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      await this.flushCandidates(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await this.signaling.send({ kind: 'answer', session: signal.session, sdp: { type: answer.type, sdp: answer.sdp } });
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

  // Lit dans les statistiques WebRTC le chemin réellement utilisé, pour le vérifier à l'écran.
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
