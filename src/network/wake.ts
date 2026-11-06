import { getAuth, getIdToken } from '@react-native-firebase/auth';

import { WAKE_URL } from '../config';
import { log } from '../log';

// Demande à Vercel un push vide vers ce token. Aucun contenu ne part d'ici.
export async function wakeContact(fcmToken: string) {
  const user = getAuth().currentUser;
  if (!user || !WAKE_URL) return;

  const response = await fetch(WAKE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await getIdToken(user)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token: fcmToken }),
  });
  if (!response.ok) log.warn('réveil refusé', response.status);
}
