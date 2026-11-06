import { AppState } from 'react-native';

import { loadContacts, loadOrCreateIdentity } from '../storage';
import { chat } from './manager';
import { BACKGROUND_MAX_AWAKE_MS, BACKGROUND_QUIET_MS } from '../config';
import { log } from '../log';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Appelée par Android quand un push arrive, app fermée ou en arrière-plan.
// - « msg » : le message chiffré est dans le push. On le déchiffre, on l'enregistre, on notifie tout
//   de suite et on confirme par push : aucune connexion directe n'est nécessaire.
// - « wake » : il y a autre chose à récupérer (fichier, texte trop long). On se connecte au seul
//   contact concerné (à tous pour un réveil d'une ancienne version), puis on se rendort.
export async function handleWake(message: { data?: { [key: string]: unknown } }) {
  log.info('push reçu', message.data?.type ?? 'wake');
  if (AppState.currentState === 'active') return;

  const [identity, contacts] = await Promise.all([loadOrCreateIdentity(), loadContacts()]);
  chat.prepare(identity, contacts);
  if (message.data?.type === 'msg') {
    await chat.handlePush(message.data);
    return;
  }

  const target = chat.contactForWake(message.data);
  chat.sync(identity, target ? contacts.filter((contact) => contact.publicKey === target) : contacts);

  const start = Date.now();
  while (Date.now() - start < BACKGROUND_MAX_AWAKE_MS) {
    await sleep(500);
    if (chat.isIdleSince(BACKGROUND_QUIET_MS)) break;
  }

  // Si l'utilisateur a ouvert l'app entre-temps, c'est elle qui garde les connexions.
  if (AppState.currentState !== 'active') chat.stopAll();
}
