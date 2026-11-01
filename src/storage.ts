import * as SecureStore from 'expo-secure-store';

import { createIdentity, Identity } from './crypto/pairing';
import type { RatchetState } from './crypto/ratchet';

const IDENTITY_KEY = 'identity';
const CONTACTS_KEY = 'contacts';
const RATCHET_PREFIX = 'ratchet.';

export type Contact = {
  publicKey: string;
  name: string;
};

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

// Lecture et écriture synchrones : deux messages ne peuvent pas repartir du même état, donc de la même clé.
// L'état reste en place si le contact est supprimé : sinon les deux téléphones ne seraient plus d'accord après un nouveau pairing.
export function loadRatchet(contact: string): RatchetState | null {
  const saved = SecureStore.getItem(RATCHET_PREFIX + contact);
  return saved ? JSON.parse(saved) : null;
}

export function saveRatchet(contact: string, state: RatchetState) {
  SecureStore.setItem(RATCHET_PREFIX + contact, JSON.stringify(state));
}
