import { Identity } from '../../crypto/pairing';

import { IncomingFile, Link } from './types';

// L'état partagé par les modules du manager. Seule la façade (index.ts) est utilisée par les écrans.
export class ChatCore {
  identity: Identity | null = null;
  links = new Map<string, Link>();
  names = new Map<string, string>();
  lastWake = new Map<string, number>();
  wakeTimer?: ReturnType<typeof setInterval>;
  version = 0;
  listeners = new Set<() => void>();
  online = true;
  offlineTimer?: ReturnType<typeof setTimeout>;
  watching = false;
  myToken: string | null = null;
  openConversation: string | null = null;
  lastActivity = 0;
  sendingFiles = new Set<string>();
  // Pour chaque fichier en cours d'envoi, le nombre de morceaux que le receveur a confirmé.
  confirmedChunks = new Map<string, number>();
  incomingFiles = new Map<string, IncomingFile>();
  progress = new Map<string, number>();
  lastProgressNotify = 0;
  // Les écritures sur le disque se font une par une, dans l'ordre d'arrivée des morceaux.
  writeQueue: Promise<void> = Promise.resolve();

  subscribe =(listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this.version;

  notify() {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }
}
