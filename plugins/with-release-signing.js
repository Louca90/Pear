const { withAppBuildGradle } = require('expo/config-plugins');

// La clé et son mot de passe restent hors du dépôt, dans ~/.gradle/gradle.properties.
// Sans ces réglages, l'APK de release n'est pas signé : il ne part jamais avec la clé de debug.
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
      .replace(/(release \{[\s\S]*?signingConfig signingConfigs\.)debug/, '$1release')
      .replace(/(signingConfigs \{\s*debug \{[\s\S]*?\n {8}\})/, `$1${RELEASE_CONFIG}`);
    return result;
  });
