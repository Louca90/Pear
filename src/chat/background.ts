import { AppState } from 'react-native';

import { loadContacts, loadOrCreateIdentity } from '../storage';
import { chat } from './manager';
import { showUpdateNotification } from './notifications';
import { announcedVersion } from '../update/announce';
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
  // (Jusqu'à la 1.9.0, la version était testée avec /^d+.d+.d+$/, sans les « \ » : aucune annonce ne
  // s'affichait app fermée.)
  if (message.data?.type === 'update') {
    const version = announcedVersion(message.data, appVersionCode());
    if (version) await showUpdateNotification(version);
    return;
  }

  const [identity, contacts] = await Promise.all([loadOrCreateIdentity(), loadContacts()]);
  chat.prepare(identity, contacts);
  if (message.data?.type === 'msg' || message.data?.type === 'pair') {
    await chat.handlePush(message.data);
    return;
  }

  // Appel (vague 5) : se connecter à l'appelant ; son invitation fait sonner. On reste éveillé tant que
  // l'appel sonne ou dure (le service de premier plan de l'appel garde ensuite le processus).
  if (message.data?.type === 'call') {
    if (!chat.receiveCallPush(message.data)) return;
    chat.sync(identity, contacts);
    while (chat.callKeepsAwake() && AppState.currentState !== 'active') await sleep(500);
    if (AppState.currentState !== 'active') chat.stopAll();
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
