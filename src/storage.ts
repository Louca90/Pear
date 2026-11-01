import * as SecureStore from 'expo-secure-store';

import { createIdentity, Identity } from './crypto/pairing';

const IDENTITY_KEY = 'identity';
const CONTACTS_KEY = 'contacts';

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
