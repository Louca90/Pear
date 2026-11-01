const { withAppBuildGradle } = require('expo/config-plugins');

// La clé et son mot de passe restent hors du dépôt, dans ~/.gradle/gradle.properties.
// Sans ces réglages, l'APK n'est pas signé : il ne part jamais avec la clé de debug.
// La version de test utilise la même clé : on passe de l'une à l'autre sans désinstaller ni perdre les données.
const RELEASE_CONFIG = `
        release {
            if (project.hasProperty('PEAR_KEYSTORE')) {
                storeFile file(PEAR_KEYSTORE)
                storePassword PEAR_KEYSTORE_PASSWORD
                keyAlias PEAR_KEY_ALIAS
                keyPassword PEAR_KEYSTORE_PASSWORD
            }
        }`;

module.exports = (config) =>
  withAppBuildGradle(config, (result) => {
    result.modResults.contents = result.modResults.contents
      .replace(/signingConfig signingConfigs\.debug/g, 'signingConfig signingConfigs.release')
      .replace(/(signingConfigs \{\s*debug \{[\s\S]*?\n {8}\})/, `$1${RELEASE_CONFIG}`);
    return result;
  });
