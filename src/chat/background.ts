import { AppState } from 'react-native';

import { loadContacts, loadOrCreateIdentity } from '../storage';
import { chat } from './manager';
import { showUpdateNotification } from './notifications';
import { appVersionCode } from '../../modules/pear-native';
import { BACKGROUND_MAX_AWAKE_MS, BACKGROUND_QUIET_MS } from '../config';
import { recordPush } from '../diagnostics';
import { log } from '../log';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Appelée par Android quand un push arrive, app fermée ou en arrière-plan.
// - « msg » : le message chiffré est dans le push. On le déchiffre, on l'enregistre, on notifie tout
//   de suite et on confirme par push : aucune connexion directe n'est nécessaire.
// - « wake » : il y a autre chose à récupérer (fichier, texte trop long). On se connecte au seul
//   contact concerné (à tous pour un réveil d'une ancienne version), puis on se rendort.
export async function handleWake(message: { data?: { [key: string]: unknown } }) {
  log.info('push reçu', message.data?.type ?? 'wake');
  recordPush(String(message.data?.type ?? 'wake'));
  if (AppState.currentState === 'active') return;

  // Annonce d'une version (topic « updates », envoyée par /api/announce) : aucun contact à réveiller.
  if (message.data?.type === 'update') {
    const versionCode = Number(message.data.versionCode);
    const version = String(message.data.version ?? '');
    if (/^d+.d+.d+$/.test(version) && versionCode > (appVersionCode() ?? 0)) await showUpdateNotification(version);
    return;
  }

  const [identity, contacts] = await Promise.all([loadOrCreateIdentity(), loadContacts()]);
  chat.prepare(identity, contacts);
  if (message.data?.type === 'msg' || message.data?.type === 'pair') {
    await chat.handlePush(message.data);
    return;
  }

  const target = chat.contactForWake(message.data);
  chat.sync(identity, contacts);
  chat.connectForWake(target ? [target] : contacts.map((contact) => contact.publicKey));

  const start = Date.now();
  while (Date.now() - start < BACKGROUND_MAX_AWAKE_MS) {
    await sleep(500);
    if (chat.isIdleSince(BACKGROUND_QUIET_MS)) break;
  }

  // Si l'utilisateur a ouvert l'app entre-temps, c'est elle qui garde les connexions.
  if (AppState.currentState !== 'active') chat.stopAll();
}
