import * as SecureStore from 'expo-secure-store';

import { createIdentity, Identity } from './crypto/pairing';
import type { RatchetState } from './crypto/ratchet';
import { getRatchetRow, setRatchetRow } from './chat/database';
import { openLocal, sealLocal } from './chat/db/localCrypto';
import { CONTACTS_KEY, IDENTITY_KEY, RATCHET_PREFIX } from './config';
import { log } from './log';

export type Contact = {
  publicKey: string;
  name: string;
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

export async function loadContacts(): Promise<Contact[]> {
  const saved = await SecureStore.getItemAsync(CONTACTS_KEY);
  return saved ? JSON.parse(saved) : [];
}

export async function saveContacts(contacts: Contact[]): Promise<void> {
  await SecureStore.setItemAsync(CONTACTS_KEY, JSON.stringify(contacts));
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
  const state = row ? (JSON.parse(openLocal(row, RATCHET_CONTEXT)) as RatchetState) : migrateLegacyRatchet(contact);
  if (state) ratchets.set(contact, state);
  return state;
}

export function saveRatchet(contact: string, state: RatchetState) {
  setRatchetRow(contact, sealLocal(JSON.stringify(state), RATCHET_CONTEXT));
  ratchets.set(contact, state);
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
