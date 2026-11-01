import { addNetworkStateListener, getNetworkStateAsync, NetworkState } from 'expo-network';
import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import { deriveSharedSecret, Identity } from '../crypto/pairing';
import { PeerLink, PeerStatus, RouteType } from '../network/peer';
import { Contact } from '../storage';
import {
  addMessage,
  getPendingReadReceipts,
  getUndelivered,
  markConversationRead,
  setReadReceiptSent,
  setStatus,
} from './database';

export const MAX_TEXT_LENGTH = 2000;
// Evite d'afficher "hors ligne" pendant une micro-coupure, par exemple en passant du Wi-Fi à la 5G.
const OFFLINE_DELAY_MS = 1000;

type Link = {
  peer: PeerLink;
  status: PeerStatus;
  route: RouteType | null;
};

// Garde une connexion par contact tant que l'app est ouverte, et prévient les écrans à chaque changement.
class ChatManager {
  private links = new Map<string, Link>();
  private version = 0;
  private listeners = new Set<() => void>();
  private online = true;
  private offlineTimer?: ReturnType<typeof setTimeout>;
  private watchingNetwork = false;
  private openConversation: string | null = null;

  subscribe =(listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  private notify() {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }

  // Ouvre les connexions des nouveaux contacts et ferme celles des contacts supprimés.
  sync(identity: Identity, contacts: Contact[]) {
    this.watchNetwork();
    const keys =new Set(contacts.map((contact) => contact.publicKey));
    for (const [key, link] of this.links) {
      if (!keys.has(key)) {
        link.peer.stop();
        this.links.delete(key);
      }
    }
    for (const key of keys) {
      if (!this.links.has(key)) this.connect(identity, key);
    }
    this.notify();
  }

  stopAll() {
    this.links.forEach((link) => link.peer.stop());
    this.links.clear();
    this.notify();
  }

  getLink(contact: string): { status: PeerStatus; route: RouteType | null } {
    return this.links.get(contact) ?? { status: 'searching', route: null };
  }

  isOnline() {
    return this.online;
  }

  // La conversation affichée à l'écran : ses messages comptent comme lus.
  setOpenConversation(contact: string | null) {
    this.openConversation = contact;
    if (!contact) return;
    markConversationRead(contact);
    this.flush(contact);
    this.notify();
  }

  // Android indique directement si le téléphone a internet : c'est immédiat.
  private watchNetwork() {
    if (this.watchingNetwork) return;
    this.watchingNetwork = true;
    const update = (state: NetworkState) => this.setOnline(state.isInternetReachable ?? state.isConnected ?? true);
    getNetworkStateAsync().then(update).catch((e) => console.warn('Pear réseau :', e));
    addNetworkStateListener(update);
  }

  private setOnline(online: boolean) {
    clearTimeout(this.offlineTimer);
    if (online) {
      const wasOffline = !this.online;
      this.online = true;
      if (wasOffline) this.links.forEach((link) => link.peer.retryNow());
      this.notify();
    } else {
      this.offlineTimer = setTimeout(() => {
        this.online = false;
        this.notify();
      }, OFFLINE_DELAY_MS);
    }
  }

  send(contact: string, text: string) {
    addMessage({
      id: to_base64(randombytes_buf(16)),
      contact,
      mine: 1,
      text,
      status: 'sending',
      created_at: Date.now(),
    });
    this.flush(contact);
    this.notify();
  }

  private connect(identity: Identity, contact: string) {
    let secret: Uint8Array;
    try {
      secret = deriveSharedSecret(identity, contact);
    } catch (e) {
      console.warn('Pear contact non valide :', e);
      return;
    }
    const link: Link = {
      status: 'starting',
      route: null,
      peer: new PeerLink(identity.publicKey < contact ? 'a' : 'b', secret, {
        onStatus: (status) => {
          link.status = status;
          if (status === 'connected') this.flush(contact);
          this.notify();
        },
        onRoute: (route) => {
          link.route = route;
          this.notify();
        },
        onMessage: (message) => this.receive(contact, message),
      }),
    };
    this.links.set(contact, link);
    link.peer.start();
  }

  // Tout ce qui n'a pas été confirmé repart : l'autre téléphone ignore les doublons grâce à l'id.
  private flush(contact: string) {
    const peer = this.links.get(contact)?.peer;
    if (!peer) return;
    for (const message of getUndelivered(contact)) {
      if (!peer.send({ type: 'message', id: message.id, text: message.text })) return;
    }
    // Les confirmations de lecture restées en attente pendant une coupure partent aussi.
    for (const message of getPendingReadReceipts(contact)) {
      if (!peer.send({ type: 'read', id: message.id })) return;
      setReadReceiptSent(message.id, contact);
    }
  }

  private receive(contact: string, data: any) {
    if (data?.type === 'message' && typeof data.id === 'string' && typeof data.text === 'string') {
      addMessage({
        id: data.id,
        contact,
        mine: 0,
        text: data.text.slice(0, MAX_TEXT_LENGTH),
        status: this.openConversation === contact ? 'read-pending' : 'delivered',
        created_at: Date.now(),
      });
      this.links.get(contact)?.peer.send({ type: 'ack', id: data.id });
      this.flush(contact);
      this.notify();
    } else if ((data?.type === 'ack' || data?.type === 'read') && typeof data.id === 'string') {
      setStatus(data.id, contact, data.type === 'read' ? 'read' : 'delivered');
      this.notify();
    }
  }
}

export const chat = new ChatManager();
