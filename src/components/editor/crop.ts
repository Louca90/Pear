// Recadrage et rotation d'une photo. La rotation se fait par quarts de tour ; le cadre est exprimé en
// fractions (0 à 1) de la photo déjà tournée, pour ne pas dépendre de la taille de l'écran.

export type Rotation = 0 | 90 | 180 | 270;
export type Rect = { x: number; y: number; width: number; height: number };
export type Crop = { rotation: Rotation; rect: Rect };
export type Aspect = 'free' | 'square' | 'portrait' | 'story';

export const NO_CROP: Crop = { rotation: 0, rect: { x: 0, y: 0, width: 1, height: 1 } };
export const ASPECTS: { id: Aspect; ratio: number | null }[] = [
  { id: 'free', ratio: null },
  { id: 'square', ratio: 1 },
  { id: 'portrait', ratio: 4 / 5 },
  { id: 'story', ratio: 9 / 16 },
];

type Size = { width: number; height: number };

export function isCropped(crop: Crop) {
  const { rect } = crop;
  return crop.rotation !== 0 || rect.x > 1e-4 || rect.y > 1e-4 || rect.width < 1 - 1e-4 || rect.height < 1 - 1e-4;
}

export function rotatedSize(size: Size, rotation: Rotation): Size {
  return rotation % 180 === 0 ? size : { width: size.height, height: size.width };
}

// L'aperçu (la zone gardée, ajustée à l'écran) et la place de la photo dedans : la photo, à sa taille
// d'origine × fit, est centrée sur le centre de la photo tournée, puis tournée autour de son centre.
export function cropGeometry(image: Size, crop: Crop, screen: Size) {
  const turned = rotatedSize(image, crop.rotation);
  const keptWidth = crop.rect.width * turned.width;
  const keptHeight = crop.rect.height * turned.height;
  const fit = Math.min(screen.width / keptWidth, screen.height / keptHeight);
  const turnedWidth = turned.width * fit;
  const turnedHeight = turned.height * fit;
  const imageWidth = image.width * fit;
  const imageHeight = image.height * fit;
  return {
    width: keptWidth * fit,
    height: keptHeight * fit,
    // Les pixels de la photo par point de l'aperçu : l'échelle d'un enregistrement à pleine taille.
    pixelsPerPoint: 1 / fit,
    image: {
      left: -crop.rect.x * turnedWidth + (turnedWidth - imageWidth) / 2,
      top: -crop.rect.y * turnedHeight + (turnedHeight - imageHeight) / 2,
      width: imageWidth,
      height: imageHeight,
      rotation: crop.rotation,
    },
  };
}

export type ImagePlacement = ReturnType<typeof cropGeometry>['image'];

// Le plus grand cadre centré, à ce format, dans la photo tournée (en fractions).
export function fullRect(image: Size, rotation: Rotation, ratio: number | null): Rect {
  if (!ratio) return { x: 0, y: 0, width: 1, height: 1 };
  const turned = rotatedSize(image, rotation);
  const imageRatio = turned.width / turned.height;
  if (imageRatio > ratio) {
    const width = ratio / imageRatio;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = imageRatio / ratio;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
}

export function nextRotation(rotation: Rotation): Rotation {
  return ((rotation + 90) % 360) as Rotation;
}
