// Sous Windows, les fichiers du code natif de react-native-gesture-handler dépassent la limite de 260
// caractères dans le dossier de compilation par défaut (android/app/.cxx). On compile le C++ dans un
// dossier court à la racine du disque. Sans effet sur l'APK produit.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// pear: dossier de compilation natif court';

module.exports = function withShortNativeBuild(config) {
  return withAppBuildGradle(config, (gradle) => {
    if (gradle.modResults.contents.includes(MARKER)) return gradle;
    gradle.modResults.contents = gradle.modResults.contents.replace(
      /android\s*\{/,
      `android {
    ${MARKER}
    if (System.getProperty('os.name').toLowerCase().contains('windows')) {
        externalNativeBuild {
            cmake {
                buildStagingDirectory = file('C:/pcx')
                // ninja 1.12 (CMake 3.31) gère les chemins de plus de 260 caractères, si Windows les autorise.
                version = '3.31.6'
            }
        }
    }`,
    );
    return gradle;
  });
};
