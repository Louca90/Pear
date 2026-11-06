import { getMessaging, getToken, onMessage, onTokenRefresh } from '@react-native-firebase/messaging';
import { addNetworkStateListener, getNetworkStateAsync, NetworkState } from 'expo-network';

import { deriveSharedSecret, Identity } from '../../crypto/pairing';
import { PeerLink } from '../../network/peer';

import { ChatCore } from './core';
import { receivePush } from './incoming';
import { receive } from './messageIO';
import { flush } from './outbox';
import { receiveChunk } from './transfers';
import { Link, OFFLINE_DELAY_MS } from './types';
import { shareToken } from './wake';
import { log } from '../../log';

export function connect(core: ChatCore, identity: Identity, contact: string) {
  let secret: Uint8Array;
  try {
    secret = deriveSharedSecret(identity, contact);
  } catch (e) {
    log.warn('contact non valide', e);
    return;
  }
  const link: Link = {
    status: 'starting',
    route: null,
    secret,
    peer: new PeerLink(identity.publicKey < contact ? 'a' : 'b', secret, {
      onStatus: (status) => {
        link.status = status;
        if (status === 'connected') {
          core.lastActivity = Date.now();
          shareToken(core, contact);
          flush(core, contact);
        }
        core.notify();
      },
      onRoute: (route) => {
        link.route = route;
        core.notify();
      },
      onMessage: (message) => receive(core, contact, message),
      onBytes: (bytes) => {
        core.writeQueue = core.writeQueue
          .then(() => receiveChunk(core, contact, bytes))
          .catch((e) => log.warn('écriture du fichier', e));
      },
    }),
  };
  core.links.set(contact, link);
  link.peer.start();
}

export function retryAll(core: ChatCore) {
  core.links.forEach((link) => link.peer.retryNow());
}

export function watch(core: ChatCore) {
  if (core.watching) return;
  core.watching = true;

  // Android indique directement si le téléphone a internet : c'est immédiat.
  const update = (state: NetworkState) => setOnline(core, state.isInternetReachable ?? state.isConnected ?? true);
  getNetworkStateAsync().then(update).catch((e) => log.warn('réseau', e));
  addNetworkStateListener(update);

  const messaging = getMessaging();
  getToken(messaging)
    .then((token) => {
      core.myToken = token;
      shareToken(core);
    })
    .catch((e) => log.warn('token FCM', e));
  // App ouverte : les pushs arrivent ici. Un message qui n'a pas pu passer en direct s'affiche quand même.
  onMessage(messaging, (message) => {
    if (message.data?.type === 'msg') receivePush(core, message.data);
    else retryAll(core);
  });
  onTokenRefresh(messaging, (token) => {
    core.myToken = token;
    shareToken(core);
  });
}

function setOnline(core: ChatCore, online: boolean) {
  clearTimeout(core.offlineTimer);
  if (online) {
    const wasOffline = !core.online;
    core.online = true;
    if (wasOffline) retryAll(core);
    core.notify();
  } else {
    core.offlineTimer = setTimeout(() => {
      core.online = false;
      core.notify();
    }, OFFLINE_DELAY_MS);
  }
}
