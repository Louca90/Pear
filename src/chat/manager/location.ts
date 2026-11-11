import { AppState } from 'react-native';
import { randombytes_buf, to_base64 } from 'react-native-libsodium';

import { lastKnownLocation } from '../../../modules/pear-native';
import { addMessage, getMessage, getSetting, setLocationText, setSetting } from '../database';
import { isSharing, locationText, parseLocation, parseLocationText, SharedLocation } from '../location';
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

type Share = { id: string; until: number };

// Mes partages en cours, par contact. Gardés dans les réglages : un partage reprend si Pear est rouvert
// avant sa fin.
let shares: Map<string, Share> | null = null;

function loadShares(): Map<string, Share> {
  if (shares) return shares;
  shares = new Map();
  try {
    const saved = JSON.parse(getSetting(SHARES_KEY) ?? '{}') as Record<string, Share>;
    for (const [contact, share] of Object.entries(saved)) {
      if (typeof share?.id === 'string' && typeof share?.until === 'number') shares.set(contact, share);
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

function send(core: ChatCore, contact: string, id: string, location: SharedLocation) {
  try {
    sendSecure(core, contact, { type: 'location', id, ...location });
  } catch (e) {
    log.warn('position', e);
  }
}

export function sharedLocationId(contact: string): string | null {
  return loadShares().get(contact)?.id ?? null;
}

// Commence à partager ma position avec ce contact pendant `seconds`. false si le téléphone ne donne
// aucune position (autorisation refusée, localisation coupée).
export function startLocation(core: ChatCore, contact: string, seconds: number): boolean {
  const position = lastKnownLocation();
  if (!position) return false;
  // Un seul partage par contact : le précédent s'arrête.
  stopLocation(core, contact);
  const now = Date.now();
  const id = to_base64(randombytes_buf(16));
  const location: SharedLocation = { ...position, at: now, until: now + seconds * 1000 };
  addMessage({ id, contact, mine: 1, text: locationText(location), status: 'read', created_at: now, kind: 'location', conn_session: core.sessionFor(contact) });
  loadShares().set(contact, { id, until: location.until });
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
    const ended: SharedLocation = { ...current, at: now, until: now };
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
  for (const [contact, share] of [...all]) {
    if (now >= share.until || !getMessage(share.id, contact)) {
      // Fini, ou message supprimé : plus rien ne part.
      stopLocation(core, contact);
      continue;
    }
    core.keepConnected(contact, KEEP_MS);
    const position = lastKnownLocation();
    if (!position) continue;
    const location: SharedLocation = { ...position, at: now, until: share.until };
    setLocationText(share.id, contact, 1, locationText(location));
    send(core, contact, share.id, location);
    changed = true;
  }
  if (changed) core.notify();
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
