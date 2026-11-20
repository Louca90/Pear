// Génère les icônes de l'app depuis l'icône « Pépins » (poire coupée en deux, deux pépins reliés).
// Usage : node scripts/make-icons.mjs   (écrit assets/icon-pepins*.svg puis les PNG, avec sharp)
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

const BODY = 'M50 28 C41 28 38 35 38 42 C38 50 33 54 29 60 C24 67 24 78 30 85 C35 91 43 92 50 89 C57 92 65 91 70 85 C76 78 76 67 71 60 C67 54 62 50 62 42 C62 35 59 28 50 28 Z';
const RIGHT_LEAF = 'M52 22 C55 13 63 9 70 10 C68 18 61 23 52 22 Z';
const LEFT_LEAF = 'M48 23 C45 17 40 15 35 17 C38 22 43 25 48 23 Z';
const SKIN = '#9DB84A';
const FLESH = '#F1F6DE';
const INK = '#000000';

// La poire dans son repère d'origine (12 4 76 92). mode : 'color' | 'mono' (une couleur, chair transparente) | 'small' (lien plein, peau épaisse).
function pear(mode, ink = INK) {
  const mono = mode !== 'color';
  const skin = mono ? ink : SKIN;
  const skinWidth = mode === 'small' ? 11 : 7;
  const link =
    mode === 'small'
      ? `<path d="M41 70 Q50 62 59 70" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`
      : `<path d="M41 70 Q50 62 59 70" fill="none" stroke="${ink}" stroke-width="2.1" stroke-linecap="round" stroke-dasharray="0.01 3.4"/>`;
  return `
  <defs><clipPath id="b"><path d="${BODY}"/></clipPath></defs>
  ${mono ? '' : `<path d="${BODY}" fill="${FLESH}"/>`}
  <g clip-path="url(#b)"><path d="${BODY}" fill="none" stroke="${skin}" stroke-width="${skinWidth}"/></g>
  <path d="M50 22.5 L50 29" stroke="${ink}" stroke-width="3.2" stroke-linecap="round"/>
  <path d="${RIGHT_LEAF} ${LEFT_LEAF}" fill="${ink}"/>
  <ellipse cx="41" cy="70" rx="4.2" ry="6.4" fill="${ink}" transform="rotate(-18 41 70)"/>
  <ellipse cx="59" cy="70" rx="4.2" ry="6.4" fill="${ink}" transform="rotate(18 59 70)"/>
  ${link}`;
}

// size : côté du carré ; share : part de la hauteur du carré occupée par la poire.
function canvas(size, share, background, inner) {
  const scale = (size * share) / 92;
  const x = (size - 76 * scale) / 2 - 12 * scale;
  const y = (size - 92 * scale) / 2 - 4 * scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ''}<g transform="translate(${x} ${y}) scale(${scale})">${inner}</g></svg>`;
}

const files = {
  // Icône de l'app, fond blanc.
  'icon-pepins.svg': canvas(1024, 0.72, '#FFFFFF', pear('color')),
  // Icône adaptative : la poire seule dans la zone de sécurité (66 dp centraux sur 108 : 61 %).
  'icon-pepins-foreground.svg': canvas(1024, 0.5, null, pear('color')),
  // Icônes à thème (Android 13+) : une seule couleur, chair transparente pour garder la coupe.
  'icon-pepins-monochrome.svg': canvas(1024, 0.5, null, pear('mono')),
  // Notification : silhouette blanche, lien plein, peau épaisse.
  'icon-pepins-notification.svg': canvas(96, 0.84, null, pear('small', '#FFFFFF')),
  'icon-pepins-splash.svg': canvas(1024, 0.8, null, pear('color')),
  'icon-pepins-favicon.svg': canvas(48, 0.92, '#FFFFFF', pear('small')),
};

for (const [name, svg] of Object.entries(files)) writeFileSync(join(assets, name), svg);

const png = (from, to, size) => sharp(join(assets, from)).resize(size, size).png().toFile(join(assets, to));
await Promise.all([
  png('icon-pepins.svg', 'icon.png', 1024),
  png('icon-pepins-foreground.svg', 'android-icon-foreground.png', 1024),
  png('icon-pepins-monochrome.svg', 'android-icon-monochrome.png', 1024),
  png('icon-pepins-splash.svg', 'splash-icon.png', 1024),
  png('icon-pepins-favicon.svg', 'favicon.png', 48),
  png('icon-pepins-notification.svg', 'icon-pepins-notification-preview.png', 96),
]);
console.log('Icônes générées dans assets/');
