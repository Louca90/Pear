# Patches de dépendances

Appliqués automatiquement par `patch-package` au `postinstall` (`npm install`). Si un patch ne s'applique plus (après une mise à jour de la dépendance), l'installation échoue (`--error-on-fail`) au lieu de continuer avec une app cassée : il faut alors vérifier si le correctif est toujours nécessaire, puis le refaire (`npx patch-package <paquet>`).

## expo-camera 58.0.14

Fichier : `android/src/main/java/expo/modules/camera/ExpoCameraView.kt`.

- **Pourquoi** : en mode vidéo, expo-camera n'attache pas la capture photo. Pear prend aussi des photos depuis ce mode (appareil photo unique, appui court = photo, appui long = vidéo) : le patch ajoute la capture photo à la session vidéo.
- Certains téléphones refusent photo et vidéo en même temps (`IllegalArgumentException` de CameraX) : le patch se replie alors sur la vidéo seule au lieu de planter.
- Ce code Kotlin modifié doit être compilé : d'où `expo.autolinking.android.buildFromSource: ["expo-camera"]` dans `package.json` (sans ça, Gradle prendrait la version précompilée, sans le patch).
- À revérifier à chaque mise à jour d'expo-camera ; voir aussi le lot 11 (CameraX natif) qui pourrait le rendre inutile.

## react-native-libsodium 1.7.0

Fichier : `android/build.gradle`.

- **Pourquoi** : sous Windows, le chemin de `node_modules` passé à CMake contient des barres obliques inversées (`C:\Users\...`), que CMake interprète comme des échappements : la compilation native de libsodium échoue. Le patch les remplace par des barres obliques.
- Inutile sous macOS et Linux, sans effet sur eux. À revérifier à chaque mise à jour de react-native-libsodium.
