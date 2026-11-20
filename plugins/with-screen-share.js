const { withMainApplication } = require('expo/config-plugins');

// Partage d'écran pendant un appel : react-native-webrtc capture l'écran avec MediaProjection, qui
// demande depuis Android 10 un service de premier plan de type « mediaProjection ». La bibliothèque
// déclare ce service, mais ne le démarre que si on l'active ici, avant tout appel à getDisplayMedia.
// La permission FOREGROUND_SERVICE_MEDIA_PROJECTION est dans app.json.
const IMPORT = 'import com.oney.WebRTCModule.WebRTCModuleOptions';
const LINE = '    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true';

module.exports = (config) =>
  withMainApplication(config, (result) => {
    let contents = result.modResults.contents;
    if (!contents.includes(IMPORT)) {
      contents = contents.replace(/^(import android\.app\.Application)$/m, `$1\n${IMPORT}`);
    }
    if (!contents.includes('enableMediaProjectionService')) {
      contents = contents.replace(/(override fun onCreate\(\) \{\n\s*super\.onCreate\(\))/, `$1\n${LINE}`);
    }
    result.modResults.contents = contents;
    return result;
  });
