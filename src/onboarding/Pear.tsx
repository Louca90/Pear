import Svg, { Path } from 'react-native-svg';

// La poire de Pear en vectoriel : nette à toutes les tailles (l'icône PNG se floute en grand).
// Même dessin que assets/icon.png : corps à deux lobes, tige et deux feuilles.
const VIEW_BOX = '22 6 56 88';
export const PEAR_RATIO = 56 / 88;

const BODY = 'M50 28 C41 28 38 35 38 42 C38 50 33 54 29 60 C24 67 24 78 30 85 C35 91 43 92 50 89 C57 92 65 91 70 85 C76 78 76 67 71 60 C67 54 62 50 62 42 C62 35 59 28 50 28 Z';
const RIGHT_LEAF = 'M52 22 C55 13 63 9 70 10 C68 18 61 23 52 22 Z';
const LEFT_LEAF = 'M48 23 C45 17 40 15 35 17 C38 22 43 25 48 23 Z';

export function Pear({ height, color }: { height: number; color: string }) {
  return (
    <Svg width={height * PEAR_RATIO} height={height} viewBox={VIEW_BOX}>
      <Path d={`${BODY} ${RIGHT_LEAF} ${LEFT_LEAF}`} fill={color} />
    </Svg>
  );
}
