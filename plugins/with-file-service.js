const { withAndroidManifest } = require('expo/config-plugins');

// Notifee déclare son service de premier plan en « shortService » (arrêté par Android après 3 minutes).
// Une réception de fichier app fermée est une synchronisation de données : on remplace le type.
module.exports = (config) =>
  withAndroidManifest(config, (result) => {
    const manifest = result.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    const app = manifest.application[0];
    app.service = (app.service ?? []).filter((service) => service.$['android:name'] !== 'app.notifee.core.ForegroundService');
    app.service.push({
      $: {
        'android:name': 'app.notifee.core.ForegroundService',
        'android:exported': 'false',
        'android:foregroundServiceType': 'dataSync',
        'tools:replace': 'android:foregroundServiceType',
      },
    });
    return result;
  });
