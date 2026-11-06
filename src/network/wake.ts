import { getAuth, getIdToken } from '@react-native-firebase/auth';

import { log } from '../log';
import { wakeUrl } from '../remoteConfig';

export type PushType = 'wake' | 'msg';
// expired : le token FCM du destinataire n'existe plus (app désinstallée ou token renouvelé).
export type PushResult = 'sent' | 'expired' | 'limited' | 'failed';

// Demande à Vercel un push vers ce token. Le contenu éventuel est déjà chiffré de bout en bout.
export async function sendPush(fcmToken: string, type: PushType, payload?: string): Promise<PushResult> {
  const user = getAuth().currentUser;
  const url = wakeUrl();
  if (!user || !url) return 'failed';

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await getIdToken(user)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: fcmToken, v: 1, type, ...(payload ? { payload } : {}) }),
    });
    if (response.ok) return 'sent';
    if (response.status === 410) return 'expired';
    if (response.status === 429) return 'limited';
    log.warn('push refusé', response.status);
    return 'failed';
  } catch (e) {
    log.warn('push', e);
    return 'failed';
  }
}
