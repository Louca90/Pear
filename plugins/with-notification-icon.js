const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Icône de la barre d'état : l'icône « Pépins » (poire coupée en deux) en blanc sur transparent, sur 20 des
// 24 points de hauteur. La peau est un trait, la chair reste transparente ; à cette taille le lien en
// pointillés est trop fin : il est plein. Les tracés sont dans le repère 12 4 76 92 de src/components/Pear.tsx ;
// le groupe recadre sur la poire elle-même (feuilles comprises, x 24,5 à 75,5 et y 9 à 92) pour qu'elle
// occupe 23 des 24 points de haut (échelle 0,277, centrée) : à 20 points avec les marges, elle était trop petite. L'équivalent PNG : scripts/make-icons.mjs.
const BODY = 'M50 28 C41 28 38 35 38 42 C38 50 33 54 29 60 C24 67 24 78 30 85 C35 91 43 92 50 89 C57 92 65 91 70 85 C76 78 76 67 71 60 C67 54 62 50 62 42 C62 35 59 28 50 28 Z';
const LEAVES = 'M52 22 C55 13 63 9 70 10 C68 18 61 23 52 22 Z M48 23 C45 17 40 15 35 17 C38 22 43 25 48 23 Z';
// Un pépin : ellipse 4,2 × 6,4 en deux arcs, inclinée autour de son centre.
const seed = (cx, tilt) =>
  `        <group android:rotation="${tilt}" android:pivotX="${cx}" android:pivotY="70">
            <path android:fillColor="#FFFFFFFF" android:pathData="M${cx - 4.2} 70 a4.2 6.4 0 1 0 8.4 0 a4.2 6.4 0 1 0 -8.4 0 Z" />
        </group>`;

const XML = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <group android:scaleX="0.277" android:scaleY="0.277" android:translateX="-1.85" android:translateY="-1.99">
        <path android:strokeColor="#FFFFFFFF" android:strokeWidth="7" android:strokeLineJoin="round" android:pathData="${BODY}" />
        <path android:strokeColor="#FFFFFFFF" android:strokeWidth="3.2" android:strokeLineCap="round" android:pathData="M50 22.5 L50 29" />
        <path android:fillColor="#FFFFFFFF" android:pathData="${LEAVES}" />
${seed(41, -18)}
${seed(59, 18)}
        <path android:strokeColor="#FFFFFFFF" android:strokeWidth="3" android:strokeLineCap="round" android:pathData="M41 70 Q50 62 59 70" />
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
