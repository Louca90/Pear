const { withMainActivity } = require('expo/config-plugins');

// Fenêtre flottante d'un appel (image dans l'image) : Android met l'activité en pause, et React Native
// suspend alors ses minuteurs et son rendu. L'appel restait figé (écran d'appel en grand, rogné, durée et
// vidéo arrêtées) et ne bougeait qu'au toucher ; pendant un partage d'écran, plus de battement de cœur,
// et l'autre téléphone croyait la connexion perdue. On relance React Native tant que la fenêtre flottante
// est affichée, et on le remet en pause quand elle se ferme.
const MARK = 'pear:pip-alive';
const CODE = `
  // ${MARK}
  private var pipKeptAlive = false

  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: android.content.res.Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    if (isInPictureInPictureMode && !pipKeptAlive) {
      pipKeptAlive = true
      reactActivityDelegate.onResume()
    }
  }

  override fun onResume() {
    pipKeptAlive = false
    super.onResume()
  }

  override fun onStop() {
    // Fenêtre flottante fermée : React Native repasse en pause, comme une app en arrière-plan.
    if (pipKeptAlive) {
      pipKeptAlive = false
      reactActivityDelegate.onPause()
    }
    super.onStop()
  }
`;

module.exports = (config) =>
  withMainActivity(config, (result) => {
    let contents = result.modResults.contents;
    if (!contents.includes(MARK)) {
      const end = contents.lastIndexOf('}');
      contents = `${contents.slice(0, end)}${CODE}}\n`;
    }
    result.modResults.contents = contents;
    return result;
  });
