import { Identity } from '../../crypto/pairing';

import { IncomingFile, Link, PRESENCE_MS } from './types';
import { SessionTracker } from '../grouping';
import { SentOnce } from '../sentOnce';

// L'état partagé par les modules du manager. Seule la façade (index.ts) est utilisée par les écrans.
// Une image à 60 Hz.
const NOTIFY_FRAME_MS = 16;

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
  // Messages et événements déjà partis dans la connexion directe en cours (renvoyés à la suivante).
  sentOnce = new SentOnce();
  // Fichiers en cours d'envoi ou de réception par le relais.
  relaying = new Set<string>();
  // « Réessayer » : conversations dont un nouvel essai a été demandé à la main, et heures des essais
  // demandés ainsi qui sont vraiment partis (plafond par heure, src/chat/pending.ts).
  retryRequested = new Set<string>();
  manualRetries = new Map<string, number[]>();
  // Travail lancé par un push (texte à récupérer dans le relais) : le réveil l'attend avant de rendre la main.
  background = new Set<Promise<unknown>>();
  // Dernière proposition de session v2 à chaque contact.
  rekeyAttempts = new Map<string, number>();
  // Jusqu'à quand garder la connexion avec chaque contact (envoi, réception récente).
  keepUntil = new Map<string, number>();
  // Dernière lecture du token publié par chaque contact.
  tokenFetches = new Map<string, number>();
  // Accusés de réception à renvoyer par push, par contact.
  pushAcks = new Map<string, { ids: Set<string>; events: Set<string> }>();
  pushAckTimer?: ReturnType<typeof setTimeout>;
  pushAckFlush: Promise<void> = Promise.resolve();
  wakeTimer?: ReturnType<typeof setInterval>;
  version = 0;
  listeners = new Set<() => void>();
  // Prévenus quand la liste des contacts change sans passer par l'écran (demande acceptée).
  contactsListeners = new Set<() => void>();
  pairingStarted = false;
  online = true;
  offlineTimer?: ReturnType<typeof setTimeout>;
  watching = false;
  myToken: string | null = null;
  openConversation: string | null = null;
  // Contact de l'appel en cours ou attendu (vague 5) : sa connexion passe avant toutes les autres.
  callContact: string | null = null;
  // Rouvre les connexions voulues (strategy.ts), branché par la façade : calls.ts ne peut pas l'importer.
  reconcileNow: () => void = () => undefined;
  // Vrai quand la conversation ouverte est affichée tout en bas : on lit vraiment les derniers messages.
  atBottom = true;
  lastActivity = 0;
  sendingFiles = new Set<string>();
  // Pour chaque fichier en cours d'envoi, le nombre de morceaux que le receveur a confirmé.
  confirmedChunks = new Map<string, number>();
  incomingFiles = new Map<string, IncomingFile>();
  progress = new Map<string, number>();
  // « écrit… » : jusqu'à quand le contact est considéré en train d'écrire, et notre dernier envoi.
  typingUntil = new Map<string, number>();
  // Sessions de connexion (regroupement des bulles, lot 8.13).
  sessions = new SessionTracker();
  typingSentAt = new Map<string, number>();
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

  track(work: Promise<unknown>) {
    this.background.add(work);
    work.finally(() => this.background.delete(work)).catch(() => undefined);
  }

  contactsChanged() {
    this.contactsListeners.forEach((listener) => listener());
    this.notify();
  }

  // Garde (ou fait ouvrir, au prochain tri des connexions) la connexion avec ce contact pendant `ms`.
  keepConnected(contact: string, ms: number) {
    this.keepUntil.set(contact, Math.max(this.keepUntil.get(contact) ?? 0, Date.now() + ms));
  }

  // « En ligne » au sens de la personne : le contact a Pear ouvert, pas seulement une connexion technique.
  isContactOnline(contact: string) {
    const link = this.links.get(contact);
    if (link?.status !== 'connected') return false;
    // Pas encore de battement, ou ancienne version : on garde « connecté = en ligne ».
    if (!link.presence || link.presence.fg === null) return true;
    return link.presence.fg && Date.now() - link.presence.at < PRESENCE_MS;
  }

  // Les messages reçus ne comptent comme lus que si on regarde les derniers, pas en étant remonté.
  isReading(contact: string) {
    return this.openConversation === contact && this.atBottom;
  }

  // La session d'un message qui naît maintenant : connexion directe ouverte, ou à distance.
  sessionFor(contact: string) {
    return this.sessions.current(contact, this.links.get(contact)?.status === 'connected' ? 'direct' : 'remote');
  }

  // Les changements d'une même rafale (connexion qui s'ouvre, accusés de lecture, avancement d'un
  // transfert…) ne réveillent les écrans qu'une fois par image : avant, chaque signal redessinait tous
  // les abonnés tout de suite, des dizaines de fois à l'ouverture d'une conversation.
  // La version, elle, change tout de suite : un écran qui se dessine entre-temps lit déjà la bonne.
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  notify() {
    this.version += 1;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.listeners.forEach((listener) => listener());
    }, NOTIFY_FRAME_MS);
  }
}
