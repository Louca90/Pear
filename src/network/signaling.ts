import { getAuth, signInAnonymously } from '@react-native-firebase/auth';
import { DatabaseReference, getDatabase, onChildAdded, onDisconnect, push, ref, remove, set } from '@react-native-firebase/database';
import {
  crypto_aead_xchacha20poly1305_ietf_decrypt,
  crypto_aead_xchacha20poly1305_ietf_encrypt,
  crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  from_base64,
  randombytes_buf,
  to_base64,
  to_string,
} from 'react-native-libsodium';

import { deriveSignalingKeys } from '../crypto/pairing';

// Au-delà, une offre ne sert plus à rien : le téléphone qui l'a envoyée a déjà réessayé.
const MAX_AGE_MS = 2 * 60 * 1000;
// Étiquette vérifiée au déchiffrement : un texte chiffré ailleurs dans l'app sera refusé ici.
const CONTEXT = 'pear-signal-v1';

export type Role = 'a' | 'b';

// Firebase sert seulement de tuyau : il ne voit que du texte chiffré, supprimé après lecture.
export class SignalingChannel {
  private room: DatabaseReference;
  private key: Uint8Array;
  private sent: DatabaseReference[] = [];
  private unsubscribe?: () => void;

  constructor(secret: Uint8Array, private role: Role) {
    const { roomId, key } = deriveSignalingKeys(secret);
    this.key = key;
    this.room = ref(getDatabase(), `signals/${roomId}`);
  }

  // Les règles Firebase exigent un utilisateur connecté : un compte anonyme, sans aucune donnée.
  async open(onSignal: (signal: unknown) => void, onError: (error: Error) => void) {
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
          onSignal(JSON.parse(this.decrypt(record.data)));
        } catch (e) {
          // Message illisible ou modifié : on l'ignore, mais on le signale dans les logs.
          console.warn('Pear signal illisible :', e);
        }
      },
      onError,
    );
  }

  async send(signal: unknown) {
    const message = push(this.room);
    this.sent.push(message);
    // Si l'app est tuée, Firebase efface quand même ce message de lui-même.
    await onDisconnect(message).remove();
    await set(message, {
      from: this.role,
      data: this.encrypt(JSON.stringify(signal)),
      at: Date.now(),
    });
  }

  async clearSent() {
    const messages = this.sent;
    this.sent = [];
    await Promise.all(messages.map((message) => remove(message)));
  }

  async close() {
    this.unsubscribe?.();
    await this.clearSent();
  }

  private encrypt(text: string): string {
    const nonce = randombytes_buf(crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const cipher = crypto_aead_xchacha20poly1305_ietf_encrypt(text, CONTEXT, null, nonce, this.key);
    return `${to_base64(nonce)}.${to_base64(cipher)}`;
  }

  private decrypt(data: string): string {
    const [nonce, cipher] = data.split('.');
    // Le format de sortie 'text' de la bibliothèque n'est pas implémenté : on convertit les octets nous-mêmes.
    return to_string(
      crypto_aead_xchacha20poly1305_ietf_decrypt(null, from_base64(cipher), CONTEXT, from_base64(nonce), this.key),
    );
  }
}
