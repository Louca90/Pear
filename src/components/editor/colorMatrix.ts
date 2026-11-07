// Matrices de couleur 4 × 5, ligne par ligne (rouge, vert, bleu, alpha), comme feColorMatrix en SVG :
// chaque canal de sortie = a·R + b·G + c·B + d·A + décalage, les couleurs allant de 0 à 1.
// La même matrice sert à l'aperçu (SVG, photo) et au fichier final (Media3, vidéo) : ce qu'on voit
// est ce qui part.

export type ColorMatrix = readonly number[];

export const IDENTITY: ColorMatrix = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];

// Poids de la luminance (Rec. 709).
const LUMA = [0.2126, 0.7152, 0.0722];

// a ∘ b : applique b, puis a.
export function compose(a: ColorMatrix, b: ColorMatrix): ColorMatrix {
  const out: number[] = [];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      let value = col === 4 ? a[row * 5 + 4] : 0;
      for (let k = 0; k < 4; k++) value += a[row * 5 + k] * b[k * 5 + col];
      out.push(value);
    }
  }
  return out;
}

// Les matrices dans l'ordre où on les applique.
export function chain(...matrices: ColorMatrix[]): ColorMatrix {
  return matrices.reduce((done, next) => compose(next, done), IDENTITY);
}

// Entre l'original (0) et la matrice (1).
export function mix(matrix: ColorMatrix, amount: number): ColorMatrix {
  return matrix.map((value, index) => IDENTITY[index] + (value - IDENTITY[index]) * amount);
}

// Même gain sur les trois canaux, plus un décalage.
function rgb(scale: [number, number, number], offset: [number, number, number] = [0, 0, 0]): ColorMatrix {
  return [scale[0], 0, 0, 0, offset[0], 0, scale[1], 0, 0, offset[1], 0, 0, scale[2], 0, offset[2], 0, 0, 0, 1, 0];
}

// 0 : noir et blanc, 1 : inchangé, au-delà : couleurs plus vives.
export function saturation(amount: number): ColorMatrix {
  const out: number[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) out.push(LUMA[col] * (1 - amount) + (row === col ? amount : 0));
    out.push(0, 0);
  }
  return [...out, 0, 0, 0, 1, 0];
}

// Mêmes formules que les filtres CSS brightness, contrast, saturate et sepia, que React Native sait
// appliquer à une vue : l'aperçu d'une vidéo reprend ainsi la matrice du fichier. 1 ne change rien.
export function brightness(gain: number): ColorMatrix {
  return rgb([gain, gain, gain]);
}

// Autour du gris moyen : les noirs et les blancs s'écartent (ou se rapprochent).
export function contrast(gain: number): ColorMatrix {
  const offset = (1 - gain) / 2;
  return rgb([gain, gain, gain], [offset, offset, offset]);
}

// De -1 à 1 : positif plus chaud (orangé), négatif plus froid (bleuté).
export function temperature(value: number): ColorMatrix {
  return rgb([1 + value * 0.12, 1 + value * 0.02, 1 - value * 0.12], [value * 0.03, 0, -value * 0.03]);
}

// De 0 à 1 : un voile gris clair posé par-dessus (noirs relevés, blancs ternis), comme une vieille
// photo. Sur une vidéo, l'aperçu pose ce même voile : il est exact.
export const FADE_GRAY = 2 / 3;
export const FADE_OPACITY = 0.15;
export function fade(amount: number): ColorMatrix {
  const opacity = amount * FADE_OPACITY;
  const lift = FADE_GRAY * opacity;
  return rgb([1 - opacity, 1 - opacity, 1 - opacity], [lift, lift, lift]);
}

// sepia(1) du CSS ; sepia(x) en est le mélange avec l'original.
export const SEPIA: ColorMatrix = [0.393, 0.769, 0.189, 0, 0, 0.349, 0.686, 0.168, 0, 0, 0.272, 0.534, 0.131, 0, 0, 0, 0, 0, 1, 0];

export function isIdentity(matrix: ColorMatrix) {
  return matrix.every((value, index) => Math.abs(value - IDENTITY[index]) < 1e-6);
}

// Pour Media3 (RgbMatrix) : 4 × 4 par colonnes, appliquée à (R, G, B, 1). L'alpha d'une vidéo vaut 1,
// sa colonne rejoint donc le décalage ; la ligne alpha est ignorée.
export function toMedia3(matrix: ColorMatrix): number[] {
  const out = new Array<number>(16).fill(0);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) out[col * 4 + row] = matrix[row * 5 + col];
    out[12 + row] = matrix[row * 5 + 3] + matrix[row * 5 + 4];
  }
  out[15] = 1;
  return out;
}

// Pour un test, ou pour vérifier une teinte : la couleur (0 à 1) après la matrice, bornée.
export function apply(matrix: ColorMatrix, [r, g, b]: [number, number, number]): [number, number, number] {
  const channel = (row: number) => Math.min(1, Math.max(0, matrix[row * 5] * r + matrix[row * 5 + 1] * g + matrix[row * 5 + 2] * b + matrix[row * 5 + 3] + matrix[row * 5 + 4]));
  return [channel(0), channel(1), channel(2)];
}
