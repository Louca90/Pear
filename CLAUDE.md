# Pear

Messagerie Android privée, chiffrée de bout en bout, en pair à pair. Expo 58, React Native 0.88, TypeScript. Package `com.louca.pear`. Interface en français.

## Architecture

- `App.tsx` : navigation maison (`route` / `setRoute`, onglets via `BottomBar`) et retour prédictif.
- `index.ts` : enregistre les gestionnaires d'arrière-plan (push FCM `handleWake`, Notifee).
- `src/chat/manager/` : moteur des conversations. `index.ts` est la façade `chat` utilisée par les écrans ; `core.ts` porte l'état partagé ; les modules (`connections`, `messageIO`, `transfers`, `outbox`, `wake`, `notify`, `profile`, `secure`) sont des fonctions qui prennent ce noyau. Ordre des couches, sans dépendance circulaire : types/core → secure, wake, notify → outbox → transfers → messageIO → connections → profile → index.
- `src/chat/database.ts` : SQLite (messages, file d'envoi, réglages). `src/storage.ts` : SecureStore (identité, contacts, ratchet).
- `src/crypto/` : pairing X25519, double ratchet, chiffrement des fichiers. `src/network/` : WebRTC (`peer.ts`), signalisation Firebase, réveil (`wake.ts`).
- `src/screens/chat/` : conversation. `ChatScreen.tsx` assemble ; `components/` (bulle, saisie, sélection, visionneuse…) ; `hooks/` (gestes, vocal, clavier) ; `constants.ts`, `format.ts`, `types.ts`, `styles.ts` (styles partagés).
- `modules/pear-native` : module Kotlin maison (retour prédictif, barre de navigation, incrustation vidéo). `plugins/` : plugins Expo (signature de release). `server/api/` : fonctions Vercel.

## Commandes

- `npm run typecheck` (tsc) et `npm test` (Jest, fonctions pures). Les deux doivent passer avant chaque commit.
- Dev : APK debug installé sur les téléphones + `npx expo start` (Metro), `adb -s <id> reverse tcp:8081 tcp:8081` pour chaque téléphone.
- Build natif : `npx expo prebuild` régénère `android/` (ignoré par git, `--clean` l'efface), puis Gradle (`JAVA_HOME` = `C:\Program Files\Android\Android Studio\jbr`, absent du PATH ; téléphones arm64 : `-PreactNativeArchitectures=arm64-v8a`). Debug et release sont signés avec la même clé (hors dépôt, `~/.gradle/gradle.properties`).

## Règles

- Lire seulement les fichiers nécessaires à la tâche en cours.
- Ne jamais casser le chiffrement de bout en bout ; aucun secret dans le dépôt.
- Migrations SQLite par `PRAGMA user_version`, sans perte : des testeurs ont déjà des conversations.
- Toute nouvelle dépendance native demande un nouvel APK : la signaler avant.
- Tests Jest : importer `describe`, `it`, `expect` depuis `@jest/globals` (TypeScript 6 ne charge pas les types globaux).
- Cahier des charges complet : `.expo/PROMPT_PEAR_COMPLET.md` (hors git).

## Pièges connus

- La liste de la conversation est une `FlatList` inversée : le bas de la conversation est l'offset 0, le message suivant visuellement est l'index - 1.
- Retour prédictif : `setBackMode('system' | 'default' | 'app')` dans `App.tsx` selon l'écran. Le Kotlin lit par réflexion le champ privé `mBackPressedCallback` de `ReactActivity` : à revérifier à chaque mise à jour de React Native.
- Les `PanResponder` créés une seule fois avec `useRef` gardent les valeurs du premier rendu : passer par des références mises à jour à chaque rendu.
- `patches/` (expo-camera, react-native-libsodium) s'appliquent au `postinstall` ; expo-camera est compilé depuis les sources (`buildFromSource`).
- npm 11 bloque certains scripts d'installation : vérifier que `node_modules/react-native-libsodium/libsodium/build` existe après une installation propre.
