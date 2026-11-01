import {
  crypto_aead_xchacha20poly1305_ietf_decrypt,
  crypto_aead_xchacha20poly1305_ietf_encrypt,
  crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  from_base64,
  randombytes_buf,
  to_base64,
  to_string,
} from 'react-native-libsodium';

// XChaCha20-Poly1305 : chiffre le texte et détecte toute modification.
// Le nonce, tiré au hasard à chaque fois, voyage en clair à côté du texte chiffré : c'est prévu ainsi.
// Le contexte n'est pas chiffré mais vérifié : un texte chiffré pour un usage est refusé pour un autre.
export function seal(text: string, key: Uint8Array, context: string): string {
  const nonce = randombytes_buf(crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const cipher = crypto_aead_xchacha20poly1305_ietf_encrypt(text, context, null, nonce, key);
  return `${to_base64(nonce)}.${to_base64(cipher)}`;
}

// Lance une erreur si le texte a été modifié ou chiffré avec une autre clé.
export function open(sealed: string, key: Uint8Array, context: string): string {
  const [nonce, cipher] = sealed.split('.');
  // Le format de sortie 'text' de la bibliothèque n'est pas implémenté : on convertit les octets nous-mêmes.
  return to_string(
    crypto_aead_xchacha20poly1305_ietf_decrypt(null, from_base64(cipher), context, from_base64(nonce), key),
  );
}
