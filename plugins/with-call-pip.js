const { withAndroidManifest } = require('expo/config-plugins');

// Appels (vague 5) : en quittant Pear pendant un appel, l'écran de l'appel continue dans une petite
// fenêtre flottante (mode « image dans l'image » d'Android), en vidéo comme en audio.
module.exports = (config) =>
  withAndroidManifest(config, (result) => {
    const activity = result.modResults.manifest.application[0].activity.find((item) => item.$['android:name'] === '.MainActivity');
    if (activity) activity.$['android:supportsPictureInPicture'] = 'true';
    return result;
  });
