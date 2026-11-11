import * as SecureStore from 'expo-secure-store';

import { createIdentity, Identity } from './crypto/pairing';
import type { RatchetState } from './crypto/ratchet';
import type { EphemeralKeys } from './crypto/rekey';
import { deleteRatchetRow, getContactRows, getRatchetRow, replaceContactRows, setRatchetRow } from './chat/database';
import { openLocal, sealLocal } from './chat/db/localCrypto';
import { CONTACTS_KEY, IDENTITY_KEY, RATCHET_PREFIX } from './config';
import { log } from './log';

export type Contact = {
  publicKey: string;
  name: string;
  // Notre demande n'a pas encore été acceptée : on ne peut pas encore lui écrire.
  pending?: boolean;
  // Code de vérification confirmé (ou scans croisés). Propre à ce téléphone, jamais envoyé.
  verified?: boolean;
};

// Vrai si une identité existait déjà avant ce lancement.
export async function hasIdentity() {
  return (await SecureStore.getItemAsync(IDENTITY_KEY)) !== null;
}

// SecureStore chiffre les valeurs avec le Keystore Android : c'est la bonne place pour la clé privée.
export async function loadOrCreateIdentity(): Promise<Identity> {
  const saved = await SecureStore.getItemAsync(IDENTITY_KEY);
  if (saved) return JSON.parse(saved);

  const identity = createIdentity();
  await SecureStore.setItemAsync(IDENTITY_KEY, JSON.stringify(identity));
  return identity;
}

// Contacts : dans pear.db. Les anciennes versions les gardaient en un seul bloc JSON dans le SecureStore.
export async function loadContacts(): Promise<Contact[]> {
  await migrateLegacyContacts();
  return getContactRows().map((row) => ({ publicKey: row.public_key, name: row.name, ...(row.state === 'pending' ? { pending: true } : {}), ...(row.verified ? { verified: true } : {}) }));
}

export async function saveContacts(contacts: Contact[]): Promise<void> {
  replaceContactRows(contacts.map((contact) => ({ public_key: contact.publicKey, name: contact.name, state: contact.pending ? 'pending' : 'active' })));
}

// Recopie l'ancienne liste, relit pour vérifier, et ne supprime l'ancienne copie qu'ensuite. Si l'app
// est tuée entre les deux, la recopie recommence au lancement suivant sans doublon (clé primaire).
async function migrateLegacyContacts() {
  const legacy = await SecureStore.getItemAsync(CONTACTS_KEY);
  if (!legacy) return;
  const contacts = JSON.parse(legacy) as Contact[];
  const known = new Set(getContactRows().map((row) => row.public_key));
  replaceContactRows([
    ...getContactRows(),
    ...contacts.filter((contact) => !known.has(contact.publicKey)).map((contact) => ({ public_key: contact.publicKey, name: contact.name })),
  ]);
  const saved = new Set(getContactRows().map((row) => row.public_key));
  if (contacts.every((contact) => saved.has(contact.publicKey))) {
    await SecureStore.deleteItemAsync(CONTACTS_KEY);
    log.info('contacts recopiés dans pear.db', contacts.length);
  } else {
    log.warn('copie des contacts non vérifiée : ancienne copie gardée');
  }
}

// États du double ratchet : gardés en mémoire, et écrits dans pear.db (chiffrés avec la clé locale)
// de façon synchrone avant chaque envoi : deux messages ne peuvent pas repartir du même état, donc de
// la même clé. L'état reste en place si le contact est supprimé : sinon les deux téléphones ne seraient
// plus d'accord après un nouveau pairing.
const RATCHET_CONTEXT = 'pear-ratchet-store-v1';
const ratchets = new Map<string, RatchetState>();

export function loadRatchet(contact: string): RatchetState | null {
  const cached = ratchets.get(contact);
  if (cached) return cached;
  const row = getRatchetRow(contact);
  // Les sessions de secours (`contact.pending`, `contact.previous`) n'ont jamais existé dans le SecureStore.
  const legacy = () => (contact.includes('.') ? null : migrateLegacyRatchet(contact));
  const state = row ? (JSON.parse(openLocal(row, RATCHET_CONTEXT)) as RatchetState) : legacy();
  if (state) ratchets.set(contact, state);
  return state;
}

export function saveRatchet(contact: string, state: RatchetState) {
  setRatchetRow(contact, sealLocal(JSON.stringify(state), RATCHET_CONTEXT));
  ratchets.set(contact, state);
}

export function deleteRatchet(key: string) {
  deleteRatchetRow(key);
  ratchets.delete(key);
}

// Clé éphémère proposée à un contact, en attendant sa réponse (passage en session v2).
const EPHEMERAL_CONTEXT = 'pear-ephemeral-store-v1';

export function loadEphemeral(contact: string): EphemeralKeys | null {
  const row = getRatchetRow(`${contact}.eph`);
  return row ? (JSON.parse(openLocal(row, EPHEMERAL_CONTEXT)) as EphemeralKeys) : null;
}

export function saveEphemeral(contact: string, keys: EphemeralKeys | null) {
  if (keys) setRatchetRow(`${contact}.eph`, sealLocal(JSON.stringify(keys), EPHEMERAL_CONTEXT));
  else deleteRatchetRow(`${contact}.eph`);
}

// Les anciennes versions gardaient l'état dans le SecureStore : il est recopié dans pear.db, relu pour
// vérifier, et l'ancienne copie n'est supprimée qu'une fois la nouvelle vérifiée.
function migrateLegacyRatchet(contact: string): RatchetState | null {
  const legacy = SecureStore.getItem(RATCHET_PREFIX + contact);
  if (!legacy) return null;
  const state = JSON.parse(legacy) as RatchetState;
  saveRatchet(contact, state);
  const copy = getRatchetRow(contact);
  if (copy && openLocal(copy, RATCHET_CONTEXT) === JSON.stringify(state)) {
    SecureStore.deleteItemAsync(RATCHET_PREFIX + contact).catch((e) => log.warn('ancien état du ratchet', e));
  } else {
    log.warn('copie de l\'état du ratchet non vérifiée : ancienne copie gardée');
  }
  return state;
}
