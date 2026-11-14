import { AppState } from 'react-native';
import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import { lastKnownLocation } from '../../../modules/pear-native';
import { addMessage, getMessage, getSetting, setLocationText, setSetting } from '../database';
import { isSharing, locationText, OPEN_SHARE_WINDOW_S, parseLocation, parseLocationText, SharedLocation } from '../location';
import { log } from '../../log';

import { ChatCore } from './core';
import { notifyMessage } from './notify';
import { sendSecure } from './secure';
import { Payload } from './types';

// Position en direct (lot 4.8). Un partage est un message « location » que chacun garde chez soi ; les
// positions partent par sendSecure, c'est-à-dire seulement quand la connexion directe est ouverte, et
// chiffrées par le ratchet. Rien n'est mis dans la file d'envoi : aucune position ne part par push ni
// par le relais, et aucune n'attend sur un serveur.
// La position vient de lastKnownLocation (position approximative du téléphone), relue à chaque tour
// d'horloge du manager (15 s), tant que Pear est ouvert.

// Tant qu'un partage est en cours, la connexion avec ce contact est gardée (ou rouverte).
const KEEP_MS = 60 * 1000;
const SHARES_KEY = 'location_shares';

// open : « tant que l'app est ouverte » (voir OPEN_SHARE_WINDOW_S).
// once : position envoyée une seule fois, gardée ici jusqu'à ce que la connexion directe l'emporte.
type Share = { id: string; until: number; open?: boolean; once?: boolean };

// Un partage « app ouverte » laissé par un lancement précédent (Pear fermé) s'arrête au premier tour.
const launchedAt = Date.now();
const openSince = new Map<string, number>();

// Mes partages en cours, par contact. Gardés dans les réglages : un partage reprend si Pear est rouvert
// avant sa fin.
let shares: Map<string, Share> | null = null;

function loadShares(): Map<string, Share> {
  if (shares) return shares;
  shares = new Map();
  try {
    const saved = JSON.parse(getSetting(SHARES_KEY) ?? '{}') as Record<string, Share>;
    for (const [contact, share] of Object.entries(saved)) {
      if (typeof share?.id === 'string' && typeof share?.until === 'number') shares.set(contact, { id: share.id, until: share.until, ...(share.open ? { open: true } : {}), ...(share.once ? { once: true } : {}) });
    }
  } catch {
    // Réglage illisible : aucun partage en cours.
  }
  return shares;
}

function saveShares() {
  const all = loadShares();
  setSetting(SHARES_KEY, all.size > 0 ? JSON.stringify(Object.fromEntries(all)) : null);
}

function send(core: ChatCore, contact: string, id: string, location: SharedLocation): boolean {
  try {
    return sendSecure(core, contact, { type: 'location', id, ...location });
  } catch (e) {
    log.warn('position', e);
    return false;
  }
}

export function sharedLocationId(contact: string): string | null {
  const share = loadShares().get(contact);
  return share && !share.once ? share.id : null;
}

// Combien de temps une position ponctuelle attend la connexion directe avant d'être abandonnée.
const ONCE_WAIT_MS = 10 * 60 * 1000;

// « Envoyer seulement ma position actuelle » : un message de position sans suivi. Il part tout de suite
// si la connexion directe est ouverte ; sinon il est réessayé à chaque tour, pendant ONCE_WAIT_MS.
export function sendCurrentLocation(core: ChatCore, contact: string): boolean {
  const position = lastKnownLocation();
  if (!position) return false;
  const now = Date.now();
  const id = to_base64(randombytes_buf(16));
  // Fin une milliseconde après : le message est reçu, puis s'affiche comme une position fixe.
  const location: SharedLocation = { ...position, at: now, until: now + 1, once: true };
  addMessage({ id, contact, mine: 1, text: locationText(location), status: 'read', created_at: now, kind: 'location', conn_session: core.sessionFor(contact) });
  if (!send(core, contact, id, location)) {
    // Le partage en direct éventuel continue : la position ponctuelle attend sous sa propre clé.
    loadShares().set(onceKey(contact), { id, until: now + ONCE_WAIT_MS, once: true });
    saveShares();
    core.keepConnected(contact, KEEP_MS);
  }
  core.notify();
  return true;
}

const ONCE_PREFIX = 'once:';
const onceKey = (contact: string) => ONCE_PREFIX + contact;

// Commence à partager ma position avec ce contact pendant `seconds`. false si le téléphone ne donne
// aucune position (autorisation refusée, localisation coupée).
export function startLocation(core: ChatCore, contact: string, seconds: number, open = false): boolean {
  const position = lastKnownLocation();
  if (!position) return false;
  // Un seul partage par contact : le précédent s'arrête.
  stopLocation(core, contact);
  const now = Date.now();
  const id = to_base64(randombytes_buf(16));
  const until = now + (open ? OPEN_SHARE_WINDOW_S : seconds) * 1000;
  const location: SharedLocation = { ...position, at: now, until, ...(open ? { open: true as const } : {}) };
  addMessage({ id, contact, mine: 1, text: locationText(location), status: 'read', created_at: now, kind: 'location', conn_session: core.sessionFor(contact) });
  loadShares().set(contact, { id, until, ...(open ? { open: true } : {}) });
  if (open) openSince.set(contact, now);
  saveShares();
  core.keepConnected(contact, KEEP_MS);
  send(core, contact, id, location);
  core.notify();
  return true;
}

// Arrête le partage : le contact reçoit une dernière position dont la fin est « maintenant ».
export function stopLocation(core: ChatCore, contact: string) {
  const share = loadShares().get(contact);
  if (!share) return;
  loadShares().delete(contact);
  saveShares();
  const current = parseLocationText(getMessage(share.id, contact)?.text ?? '');
  if (current) {
    const now = Date.now();
    const { open: _open, ...rest } = current;
    const ended: SharedLocation = { ...rest, at: now, until: now };
    setLocationText(share.id, contact, 1, locationText(ended));
    send(core, contact, share.id, ended);
  }
  core.notify();
}

// À chaque tour d'horloge : la position de chaque partage en cours est relue et envoyée ; un partage
// arrivé à son heure s'arrête.
export function tickLocations(core: ChatCore) {
  const all = loadShares();
  if (all.size === 0) return;
  const now = Date.now();
  let changed = false;
  for (const [key, share] of [...all]) {
    if (share.once) {
      const contact = key.slice(ONCE_PREFIX.length);
      const message = getMessage(share.id, contact);
      const location = message && parseLocationText(message.text);
      if (!location || now >= share.until || send(core, contact, share.id, location)) {
        all.delete(key);
        saveShares();
      } else core.keepConnected(contact, KEEP_MS);
      continue;
    }
    const contact = key;
    // « App ouverte » : arrêté si Pear n'est plus au premier plan, ou s'il vient d'un lancement précédent.
    const staleOpen = share.open && (AppState.currentState !== 'active' || (openSince.get(contact) ?? 0) < launchedAt);
    if (staleOpen || now >= share.until || !getMessage(share.id, contact)) {
      // Fini, ou message supprimé : plus rien ne part.
      stopLocation(core, contact);
      continue;
    }
    core.keepConnected(contact, KEEP_MS);
    const position = lastKnownLocation();
    if (!position) continue;
    if (share.open) {
      share.until = now + OPEN_SHARE_WINDOW_S * 1000;
      saveShares();
    }
    const location: SharedLocation = { ...position, at: now, until: share.until, ...(share.open ? { open: true as const } : {}) };
    setLocationText(share.id, contact, 1, locationText(location));
    send(core, contact, share.id, location);
    changed = true;
  }
  if (changed) core.notify();
}

// Pear passe en arrière-plan : les partages « tant que l'app est ouverte » s'arrêtent tout de suite.
export function stopOpenLocations(core: ChatCore) {
  for (const [contact, share] of [...loadShares()]) if (share.open && !share.once) stopLocation(core, contact);
}

// Une position reçue du contact (première ou mise à jour d'un partage déjà affiché).
export function receiveLocation(core: ChatCore, contact: string, data: Payload) {
  if (typeof data.id !== 'string' || data.id.length > 64) return;
  const location = parseLocation(data);
  if (!location) return;
  const existing = getMessage(data.id, contact);
  if (existing) {
    if (existing.mine !== 0 || existing.kind !== 'location') return;
    // Une position plus ancienne que celle affichée (messages croisés) ne la remplace pas.
    const shown = parseLocationText(existing.text);
    if (shown && shown.at >= location.at) return;
    setLocationText(data.id, contact, 0, locationText(location));
    core.notify();
    return;
  }
  // Un partage inconnu déjà terminé (dernier message d'un partage supprimé ici) : rien à afficher.
  if (!isSharing(location, location.at)) return;
  const foreground = AppState.currentState === 'active';
  addMessage({
    id: data.id,
    contact,
    mine: 0,
    text: locationText(location),
    status: foreground && core.isReading(contact) ? 'read-pending' : 'delivered',
    created_at: Date.now(),
    kind: 'location',
    conn_session: core.sessionFor(contact),
  });
  if (!foreground) notifyMessage(core, contact);
  core.notify();
}
