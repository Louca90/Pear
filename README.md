# Pear

Messagerie Android privée, chiffrée de bout en bout. Les messages vont directement d'un téléphone à l'autre (WebRTC) ; les serveurs ne servent qu'à se trouver et à se réveiller, et ne voient jamais que du chiffré.

- Pairing par QR code (clés X25519), code de vérification à comparer de vive voix.
- Double ratchet pour les messages, chaque fichier chiffré avec sa propre clé.
- Photos, vidéos, vocaux, fichiers, réactions, réponses, modification et suppression.
- Mise à jour automatique depuis les releases GitHub.

## Installer une version

Télécharger `pear-X.Y.Z.apk` depuis la [dernière release](https://github.com/Louca90/Pear/releases/latest) et l'ouvrir sur le téléphone (Android demande d'autoriser l'installation d'apps inconnues). Les versions suivantes s'installent ensuite depuis l'app.

## Développer

Prérequis : Node 24, Android Studio (SDK Android et JDK : `C:\Program Files\Android\Android Studio\jbr`), un téléphone Android en débogage USB.

```bash
npm install                  # applique aussi les patches (voir patches/README.md)
npx expo prebuild --platform android
cd android && ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081
npx expo start               # Metro : le code JavaScript arrive sur le téléphone
```

Fichiers à fournir, jamais dans le dépôt :
- `google-services.json` (projet Firebase), à la racine ;
- la clé de signature et ses mots de passe dans `~/.gradle/gradle.properties` (`PEAR_KEYSTORE`, `PEAR_KEYSTORE_PASSWORD`, `PEAR_KEY_ALIAS`), voir `plugins/with-release-signing.js`. Debug et release utilisent la même clé : on passe de l'un à l'autre sans perdre les données.

Vérifications (lancées aussi par GitHub Actions à chaque push) :

```bash
npm run typecheck
npm run lint
npm test
node server/test/wake.test.js
```

La compilation Android n'est pas faite en CI : elle demande `google-services.json` et la clé de signature, gardés hors du dépôt.

## Architecture

- `App.tsx` : navigation, retour prédictif, mise à jour, écrans d'erreur.
- `src/chat/manager/` : moteur des conversations (connexions, envoi et réception, fichiers, réveil).
- `src/chat/database.ts` et `src/chat/db/` : historique SQLite et ses migrations.
- `src/crypto/` : pairing, double ratchet, chiffrement des fichiers.
- `src/network/` : WebRTC, signalisation Firebase, réveil.
- `src/screens/` : écrans ; `src/screens/chat/` : la conversation, découpée en composants et hooks.
- `src/config.ts` : tous les réglages (serveurs, délais, limites).
- `modules/pear-native/` : module Kotlin maison (retour prédictif, marges système, mise à jour, incrustation vidéo).
- `server/` : fonction Vercel de réveil (voir `DOCS_SERVEUR.md`).

Plus de détails pour travailler dans le code : `CLAUDE.md`.

## Publier une version

Voir `RELEASE.md` : `node scripts/release.mjs bump X.Y.Z`, puis `draft`, `build` et `publish`.

## Screenshots

<p align="center">
  <img width="100%" alt="Pear banner" src="https://github.com/user-attachments/assets/6add8e59-2e83-4656-99ce-1f715c02cdd9" />
</p>

<p align="center">
  <img width="32%" alt="Permissions" src="https://github.com/user-attachments/assets/b988b24b-276b-4153-a29e-98444f899792" />
  <img width="32%" alt="Chat" src="https://github.com/user-attachments/assets/331ee050-e213-4c3f-b1c7-2138d1b4b984" />
  <img width="32%" alt="Contact verification" src="https://github.com/user-attachments/assets/d20d1877-10ad-484f-b3da-555916a3a3f2" />
</p>



https://github.com/user-attachments/assets/2dca6454-0534-4647-a62d-48b77e3a12b5








## Licence

MIT, voir `LICENSE`.
