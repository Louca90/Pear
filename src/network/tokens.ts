import { getAuth, getIdToken, signInAnonymously } from '@react-native-firebase/auth';
import { get, getDatabase, ref, remove, serverTimestamp, set } from '@react-native-firebase/database';

import { getSetting, setSetting } from '../chat/database';
import { open, seal } from '../crypto/box';
import { deriveTokenKeys, inboxIdFor, inboxProof } from '../crypto/inbox';
import { deriveSharedSecret, Identity } from '../crypto/pairing';
import { log } from '../log';
import { wakeUrl } from '../remoteConfig';

// Chaque téléphone range son token FCM dans Firebase, chiffré une fois par contact avec une clé tirée
// du secret partagé : tokens/{sa boîte}/{étiquette}. Un contact qui n'a plus le bon token (renouvelé
// pendant qu'il était hors ligne) relit le nouveau sans connexion directe. Firebase ne voit rien.

const CONTEXT = 'pear-token-v1';
const INBOX_SETTING = 'inbox';
const PUBLISHED_SETTING = 'tokens_published';
// Republié de temps en temps : le nettoyage du serveur supprime les entrées de plus de 60 jours.
const REPUBLISH_MS = 30 * 24 * 3600000;

type Inbox = { inboxId: string; uid: string; serverKey: string };

export async function currentUser() {
  const auth = getAuth();
  return auth.currentUser ?? (await signInAnonymously(auth)).user;
}

function readJson<T>(key: string): T | null {
  try {
    const saved = getSetting(key);
    return saved ? (JSON.parse(saved) as T) : null;
  } catch {
    return null;
  }
}

// La boîte est enregistrée auprès du serveur une fois par compte Firebase (refaite après une réinstallation).
export async function registerInbox(identity: Identity): Promise<string> {
  const user = await currentUser();
  const saved = readJson<Inbox>(INBOX_SETTING);
  if (saved && saved.uid === user.uid) return saved.inboxId;

  const url = wakeUrl().replace(/\/wake$/, '/inbox');
  const { serverKey } = await (await fetch(url)).json();
  const at = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await getIdToken(user)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: 1, publicKey: identity.publicKey, at, proof: inboxProof(identity, serverKey, user.uid, at) }),
  });
  if (!response.ok) throw new Error(`Enregistrement de la boîte refusé (${response.status})`);
  const { inboxId } = await response.json();
  setSetting(INBOX_SETTING, JSON.stringify({ inboxId, uid: user.uid, serverKey }));
  log.info('boîte enregistrée');
  return inboxId;
}

// Publie notre token pour chaque contact, seulement s'il a changé ou s'il date un peu.
export async function publishTokens(identity: Identity, contacts: string[], token: string) {
  const inboxId = await registerInbox(identity);
  const published = readJson<Record<string, { token: string; at: number }>>(PUBLISHED_SETTING) ?? {};
  const now = Date.now();
  let changed = false;
  for (const contact of contacts) {
    const previous = published[contact];
    if (previous && previous.token === token && now - previous.at < REPUBLISH_MS) continue;
    const { tag, key } = deriveTokenKeys(deriveSharedSecret(identity, contact));
    await set(ref(getDatabase(), `tokens/${inboxId}/${tag}`), { v: 1, data: seal(token, key, CONTEXT), at: serverTimestamp() });
    published[contact] = { token, at: now };
    changed = true;
  }
  for (const contact of Object.keys(published)) if (!contacts.includes(contact)) delete published[contact];
  if (changed) {
    setSetting(PUBLISHED_SETTING, JSON.stringify(published));
    log.info('token publié');
  }
}

// Le token à jour d'un contact, lu dans sa boîte. null s'il ne l'a pas (encore) publié.
export async function fetchContactToken(identity: Identity, contact: string): Promise<string | null> {
  await currentUser();
  const { tag, key } = deriveTokenKeys(deriveSharedSecret(identity, contact));
  const record = (await get(ref(getDatabase(), `tokens/${inboxIdFor(contact)}/${tag}`))).val();
  if (!record || typeof record.data !== 'string') return null;
  try {
    return open(record.data, key, CONTEXT);
  } catch (e) {
    log.warn('token du contact illisible', e);
    return null;
  }
}

// Contact supprimé : son entrée n'a plus de raison d'exister.
export async function unpublishToken(identity: Identity, contact: string) {
  const saved = readJson<Inbox>(INBOX_SETTING);
  if (!saved) return;
  const { tag } = deriveTokenKeys(deriveSharedSecret(identity, contact));
  await remove(ref(getDatabase(), `tokens/${saved.inboxId}/${tag}`));
}
