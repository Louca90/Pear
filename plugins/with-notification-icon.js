const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Icône de la barre d'état : la poire de src/onboarding/Pear.tsx en blanc sur transparent, sur 20 des
// 24 points de hauteur. ic_launcher_monochrome laisse les marges d'une icône d'app et paraît trop petite.
// Les tracés sont dans le repère 22 6 56 88 de Pear.tsx ; le groupe les ramène sur 24 × 24
// (échelle 0,247 : hauteur du dessin 81 → 20, centré).
const PATHS = [
  'M50 28 C41 28 38 35 38 42 C38 50 33 54 29 60 C24 67 24 78 30 85 C35 91 43 92 50 89 C57 92 65 91 70 85 C76 78 76 67 71 60 C67 54 62 50 62 42 C62 35 59 28 50 28 Z',
  'M52 22 C55 13 63 9 70 10 C68 18 61 23 52 22 Z',
  'M48 23 C45 17 40 15 35 17 C38 22 43 25 48 23 Z',
];

const XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <group android:scaleX="0.247" android:scaleY="0.247" android:translateX="-0.35" android:translateY="-0.45">
${PATHS.map((d) => `        <path android:fillColor="#FFFFFFFF" android:pathData="${d}" />`).join('\n')}
    </group>
</vector>
`;

module.exports = (config) =>
  withDangerousMod(config, [
    'android',
    (result) => {
      const directory = path.join(result.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'drawable');
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'ic_stat_pear.xml'), XML);
      return result;
    },
  ]);
