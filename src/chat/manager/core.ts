import { Identity } from '../../crypto/pairing';

import { IncomingFile, Link } from './types';

// L'état partagé par les modules du manager. Seule la façade (index.ts) est utilisée par les écrans.
export class ChatCore {
  identity: Identity | null = null;
  links = new Map<string, Link>();
  names = new Map<string, string>();
  lastWake = new Map<string, number>();
  // Calculés une fois par contact : secret partagé (hors connexion) et clés des pushs.
  secrets = new Map<string, Uint8Array>();
  pushKeys = new Map<string, { tag: string; key: Uint8Array }>();
  // Messages et événements déjà partis par push : on ne les renvoie pas tant que l'app tourne. Ils
  // repartiront en direct à la prochaine connexion (l'autre téléphone ignore les doublons).
  pushed = new Set<string>();
  // Accusés de réception à renvoyer par push, par contact.
  pushAcks = new Map<string, { ids: Set<string>; events: Set<string> }>();
  pushAckTimer?: ReturnType<typeof setTimeout>;
  pushAckFlush: Promise<void> = Promise.resolve();
  wakeTimer?: ReturnType<typeof setInterval>;
  version = 0;
  listeners = new Set<() => void>();
  online = true;
  offlineTimer?: ReturnType<typeof setTimeout>;
  watching = false;
  myToken: string | null = null;
  openConversation: string | null = null;
  // Vrai quand la conversation ouverte est affichée tout en bas : on lit vraiment les derniers messages.
  atBottom = true;
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

  // Les messages reçus ne comptent comme lus que si on regarde les derniers, pas en étant remonté.
  isReading(contact: string) {
    return this.openConversation === contact && this.atBottom;
  }

  notify() {
    this.version += 1;
    this.listeners.forEach((listener) => listener());
  }
}
