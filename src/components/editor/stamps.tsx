import { G, Text as SvgText } from 'react-native-svg';

import { dateLocale } from '../../i18n';

// Les marques des filtres Heure, Date et Pellicule, dessinées en SVG : pareilles dans l'appareil photo,
// dans l'éditeur et dans le fichier envoyé. Polices du système Android (fines, à empattements, chasse
// fixe), sans dépendance.
export type StampKind = 'time' | 'date' | 'film';

export type Stamp = { time: string; weekday: string; day: string; film: string };

export function formatStamp(timestamp: number): Stamp {
  const date = new Date(timestamp);
  const two = (value: number) => String(value).padStart(2, '0');
  return {
    time: `${two(date.getHours())}:${two(date.getMinutes())}`,
    weekday: date.toLocaleDateString(dateLocale(), { weekday: 'long' }).toUpperCase(),
    day: date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' }),
    // Comme l'impression des appareils argentiques : 'AA MM JJ.
    film: `'${two(date.getFullYear() % 100)} ${two(date.getMonth() + 1)} ${two(date.getDate())}`,
  };
}

const SHADOW = '#000000';
const LIGHT = '#FFFFFF';
const FILM_ORANGE = '#FF8A1F';
const FILM_GLOW = '#C8320A';

// Un texte clair avec une ombre douce (deux couches décalées, plus légères qu'un contour).
function Soft({ x, y, size, family, spacing = 0, anchor = 'middle', children }: { x: number; y: number; size: number; family: string; spacing?: number; anchor?: 'middle' | 'end'; children: string }) {
  const shared = { fontSize: size, fontFamily: family, letterSpacing: spacing, textAnchor: anchor };
  return (
    <>
      <SvgText {...shared} x={x} y={y + size * 0.03 + 1} fill={SHADOW} opacity={0.22}>{children}</SvgText>
      <SvgText {...shared} x={x} y={y} fill={LIGHT}>{children}</SvgText>
    </>
  );
}

export function StampMarks({ kind, stamp, width, height }: { kind: StampKind | undefined; stamp: Stamp; width: number; height: number }) {
  if (!kind) return null;
  const unit = Math.min(width, height * 0.6);
  if (kind === 'time') {
    // Façon écran de verrouillage : très grande heure, trait fin.
    return <Soft x={width / 2} y={height * 0.4} size={unit * 0.3} family="sans-serif-thin" spacing={-1}>{stamp.time}</Soft>;
  }
  if (kind === 'date') {
    return (
      <G>
        <Soft x={width / 2} y={height * 0.36} size={unit * 0.045} family="sans-serif-medium" spacing={unit * 0.012}>{stamp.weekday}</Soft>
        <Soft x={width / 2} y={height * 0.36 + unit * 0.14} size={unit * 0.12} family="serif">{stamp.day}</Soft>
      </G>
    );
  }
  // Pellicule : la date orange imprimée en bas à droite, avec un léger halo.
  const size = unit * 0.07;
  const x = width - unit * 0.07;
  const y = height - unit * 0.1;
  const shared = { fontSize: size, fontFamily: 'monospace', fontWeight: '700' as const, letterSpacing: size * 0.08, textAnchor: 'end' as const };
  return (
    <G>
      <SvgText {...shared} x={x + 1} y={y + 1} fill={FILM_GLOW} opacity={0.55}>{stamp.film}</SvgText>
      <SvgText {...shared} x={x} y={y} fill={FILM_ORANGE}>{stamp.film}</SvgText>
    </G>
  );
}
