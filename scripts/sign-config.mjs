// Signe la configuration distante (voir src/remoteConfig/parse.ts et RELEASE.md).
//
//   node scripts/sign-config.mjs init   crée la clé de signature dans ~/.pear/ et affiche la clé publique
//   node scripts/sign-config.mjs        signe config/remote-config.values.json vers config/remote-config.json
//
// La clé privée ne quitte jamais ~/.pear/ : la perdre oblige à publier un APK avec une nouvelle clé publique.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ed25519 } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';

const SIGNING_PREFIX = 'pear-remote-config-v1\n';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const keyFile = join(homedir(), '.pear', 'remote-config-key.hex');
const valuesFile = join(root, 'config', 'remote-config.values.json');
const outputFile = join(root, 'config', 'remote-config.json');

if (process.argv[2] === 'init') {
  if (existsSync(keyFile)) {
    console.error(`La clé existe déjà : ${keyFile}`);
    process.exit(1);
  }
  mkdirSync(dirname(keyFile), { recursive: true });
  const { secretKey, publicKey } = ed25519.keygen();
  writeFileSync(keyFile, bytesToHex(secretKey), { mode: 0o600 });
  console.log(`Clé privée : ${keyFile} (à sauvegarder, jamais dans le dépôt)`);
  console.log(`Clé publique, à mettre dans REMOTE_CONFIG_PUBLIC_KEY (src/config.ts) :\n${bytesToHex(publicKey)}`);
  process.exit(0);
}

const secretKey = hexToBytes(readFileSync(keyFile, 'utf8').trim());
const values = JSON.parse(readFileSync(valuesFile, 'utf8'));
// La version suit l'heure de signature : chaque nouveau fichier remplace le précédent sur les téléphones.
const payload = JSON.stringify({ ...values, version: Math.floor(Date.now() / 1000) });
const signature = bytesToHex(ed25519.sign(new TextEncoder().encode(SIGNING_PREFIX + payload), secretKey));
writeFileSync(outputFile, JSON.stringify({ payload, signature }, null, 2) + '\n');
console.log(`Signé : ${outputFile}\n${payload}`);
console.log(`Clé publique : ${bytesToHex(ed25519.getPublicKey(secretKey))}`);
