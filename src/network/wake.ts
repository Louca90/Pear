import { getAuth, getIdToken } from '@react-native-firebase/auth';

import { log } from '../log';
import { wakeUrl } from '../remoteConfig';

// Demande à Vercel un push vide vers ce token. Aucun contenu ne part d'ici.
export async function wakeContact(fcmToken: string) {
  const user = getAuth().currentUser;
  const url = wakeUrl();
  if (!user || !url) return;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await getIdToken(user)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token: fcmToken }),
  });
  if (!response.ok) log.warn('réveil refusé', response.status);
}
