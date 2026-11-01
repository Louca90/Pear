import { AppState } from 'react-native';

import { loadContacts, loadOrCreateIdentity } from '../storage';
import { chat } from './manager';

// Android laisse environ 20 secondes à l'app réveillée par un push.
const MAX_AWAKE_MS = 18000;
const QUIET_AFTER_ACTIVITY_MS = 4000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Réveillée par un push vide : on se connecte, on récupère les messages, puis on se rendort.
export async function handleWake() {
  if (AppState.currentState === 'active') {
    chat.retryAll();
    return;
  }

  const [identity, contacts] = await Promise.all([loadOrCreateIdentity(), loadContacts()]);
  chat.sync(identity, contacts);

  const start = Date.now();
  while (Date.now() - start < MAX_AWAKE_MS) {
    await sleep(500);
    if (chat.isIdleSince(QUIET_AFTER_ACTIVITY_MS)) break;
  }

  // Si l'utilisateur a ouvert l'app entre-temps, c'est elle qui garde les connexions.
  if (AppState.currentState !== 'active') chat.stopAll();
}
