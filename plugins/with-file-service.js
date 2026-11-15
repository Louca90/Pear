const { withAndroidManifest } = require('expo/config-plugins');

// Notifee déclare son service de premier plan en « shortService » (arrêté par Android après 3 minutes).
// Une réception de fichier app fermée est une synchronisation de données ; un appel utilise le micro et la caméra.
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
        // Appels (vague 5) : micro, et caméra en vidéo.
        'android:foregroundServiceType': 'dataSync|microphone|camera',
        'tools:replace': 'android:foregroundServiceType',
      },
    });
    return result;
  });
