const fs = require('fs');
const path = require('path');
const { withAndroidStyles, withDangerousMod } = require('expo/config-plugins');

// Avant que le JS ne démarre, Android dessine la fenêtre avec les ressources natives : sans version
// « nuit », le téléphone en mode sombre affiche un éclair blanc et des icônes de barre foncées.
// Les couleurs reprennent le fond des palettes de src/theme.ts.
const LIGHT_BACKGROUND = '#FFFFFF';
const DARK_BACKGROUND = '#0B0B0C';

function writeValues(resDir, folder, light) {
  const dir = path.join(resDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'pear_launch.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="pear_window_background">${light ? LIGHT_BACKGROUND : DARK_BACKGROUND}</color>
  <bool name="pear_light_system_bars">${light}</bool>
</resources>
`,
  );
}

function setItem(style, name, value) {
  style.item = (style.item ?? []).filter((item) => item.$.name !== name);
  style.item.push({ $: { name }, _: value });
}

module.exports = (config) => {
  config = withAndroidStyles(config, (result) => {
    for (const style of result.modResults.resources.style ?? []) {
      if (style.$.name === 'AppTheme') {
        setItem(style, 'android:windowBackground', '@color/pear_window_background');
        setItem(style, 'android:windowLightStatusBar', '@bool/pear_light_system_bars');
        setItem(style, 'android:windowLightNavigationBar', '@bool/pear_light_system_bars');
      }
      if (style.$.name === 'Theme.App.SplashScreen') {
        setItem(style, 'android:windowBackground', '@color/pear_window_background');
      }
    }
    return result;
  });
  return withDangerousMod(config, [
    'android',
    (result) => {
      const resDir = path.join(result.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      writeValues(resDir, 'values', true);
      writeValues(resDir, 'values-night', false);
      return result;
    },
  ]);
};
