import { getAuth, signInAnonymously } from '@react-native-firebase/auth';
import { DatabaseReference, getDatabase, onChildAdded, onDisconnect, push, ref, remove, set } from '@react-native-firebase/database';

import { open, seal } from '../crypto/box';
import { deriveSignalingKeys } from '../crypto/pairing';

// Au-delà, une offre ne sert plus à rien : le téléphone qui l'a envoyée a déjà réessayé.
const MAX_AGE_MS = 2 * 60 * 1000;
const CONTEXT = 'pear-signal-v1';

export type Role = 'a' | 'b';

// Firebase sert seulement de tuyau : il ne voit que du texte chiffré, supprimé après lecture.
export class SignalingChannel {
  private room: DatabaseReference;
  private key: Uint8Array;
  private sent: DatabaseReference[] = [];
  private unsubscribe?: () => void;
  private onError: (error: Error) => void = () => undefined;

  constructor(secret: Uint8Array, private role: Role) {
    const { roomId, key } = deriveSignalingKeys(secret);
    this.key = key;
    this.room = ref(getDatabase(), `signals/${roomId}`);
  }

  // Les règles Firebase exigent un utilisateur connecté : un compte anonyme, sans aucune donnée.
  async open(onSignal: (signal: unknown) => void, onError: (error: Error) => void) {
    this.onError = onError;
    const auth = getAuth();
    if (!auth.currentUser) await signInAnonymously(auth);

    this.unsubscribe = onChildAdded(
      this.room,
      (snapshot) => {
        const record = snapshot.val();
        if (record.from === this.role) return;
        remove(snapshot.ref).catch(onError);
        if (Date.now() - record.at > MAX_AGE_MS) return;
        try {
          onSignal(JSON.parse(open(record.data, this.key, CONTEXT)));
        } catch (e) {
          // Message illisible ou modifié : on l'ignore, mais on le signale dans les logs.
          console.warn('Pear signal illisible :', e);
        }
      },
      onError,
    );
  }

  // On n'attend pas la fin des écritures : hors ligne, elles restent en attente et bloqueraient tout.
  send(signal: unknown) {
    const message = push(this.room);
    this.sent.push(message);
    // Si l'app est tuée, Firebase efface quand même ce message de lui-même.
    onDisconnect(message).remove().catch(this.onError);
    set(message, {
      from: this.role,
      data: seal(JSON.stringify(signal), this.key, CONTEXT),
      at: Date.now(),
    }).catch(this.onError);
  }

  clearSent() {
    const messages = this.sent;
    this.sent = [];
    messages.forEach((message) => remove(message).catch(this.onError));
  }

  close() {
    this.unsubscribe?.();
    this.clearSent();
  }
}
