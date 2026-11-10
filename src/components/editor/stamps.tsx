import { G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { dateLocale, t } from '../../i18n';
import { fixed } from '../../theme';

// Les marques des filtres d'ambiance (Heure, Date, Pellicule, Lieu, Jour, Série, Batterie), dessinées
// en SVG : pareilles dans l'appareil photo, dans l'éditeur et dans le fichier envoyé. Polices du système
// Android (fines, à empattements, chasse fixe), sans dépendance. Chaque marque a 2 ou 3 styles.
export type StampKind = 'time' | 'date' | 'film' | 'place' | 'weekday' | 'streak' | 'battery';

// Combien de styles typographiques a chaque marque.
export const STAMP_VARIANTS: Record<StampKind, number> = { time: 3, date: 3, film: 3, place: 3, weekday: 3, streak: 3, battery: 3 };

// Ce que le téléphone sait au moment de la photo. Lu sur l'appareil, jamais envoyé : voir ambient.ts.
export type Ambient = { place: string | null; battery: { level: number; charging: boolean } | null; streak: number };
export const NO_AMBIENT: Ambient = { place: null, battery: null, streak: 0 };

export type Stamp = { time: string; weekday: string; day: string; dayNumber: string; month: string; long: string; film: string; filmTime: string; place: string | null; battery: Ambient['battery']; streak: number };

export function formatStamp(timestamp: number, ambient: Ambient = NO_AMBIENT): Stamp {
  const date = new Date(timestamp);
  const two = (value: number) => String(value).padStart(2, '0');
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`;
  const film = `'${two(date.getFullYear() % 100)} ${two(date.getMonth() + 1)} ${two(date.getDate())}`;
  return {
    time,
    weekday: date.toLocaleDateString(dateLocale(), { weekday: 'long' }).toUpperCase(),
    day: date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long' }),
    dayNumber: String(date.getDate()),
    month: date.toLocaleDateString(dateLocale(), { month: 'long' }).toUpperCase(),
    long: date.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' }),
    // Comme l'impression des appareils argentiques : 'AA MM JJ.
    film,
    filmTime: `${film}  ${time}`,
    place: ambient.place,
    battery: ambient.battery,
    streak: ambient.streak,
  };
}

const SHADOW = fixed.black;
const LIGHT = fixed.white;
const FILM_ORANGE = fixed.filmOrange;
const FILM_GLOW = fixed.filmGlow;

type Anchor = 'start' | 'middle' | 'end';

// Un texte clair avec une ombre douce (deux couches décalées, plus légères qu'un contour).
function Soft({ x, y, size, family, spacing = 0, anchor = 'middle', weight, italic, children }: { x: number; y: number; size: number; family: string; spacing?: number; anchor?: Anchor; weight?: '700'; italic?: boolean; children: string }) {
  const shared = { fontSize: size, fontFamily: family, letterSpacing: spacing, textAnchor: anchor, ...(weight ? { fontWeight: weight } : {}), ...(italic ? { fontStyle: 'italic' as const } : {}) };
  return (
    <>
      <SvgText {...shared} x={x} y={y + size * 0.03 + 1} fill={SHADOW} opacity={0.22}>{children}</SvgText>
      <SvgText {...shared} x={x} y={y} fill={LIGHT}>{children}</SvgText>
    </>
  );
}

// Une pile avec son niveau, pour le filtre Batterie.
function BatteryIcon({ x, y, width, level, charging }: { x: number; y: number; width: number; level: number; charging: boolean }) {
  const height = width * 0.46;
  const stroke = Math.max(2, width * 0.04);
  const inner = Math.max(0, (width - stroke * 3) * (level / 100));
  const color = level <= 20 && !charging ? fixed.batteryLow : LIGHT;
  return (
    <G>
      <Rect x={x} y={y} width={width} height={height} rx={height * 0.24} fill="none" stroke={SHADOW} strokeOpacity={0.22} strokeWidth={stroke + 1.5} />
      <Rect x={x} y={y} width={width} height={height} rx={height * 0.24} fill="none" stroke={LIGHT} strokeWidth={stroke} />
      <Rect x={x + width + stroke * 0.8} y={y + height * 0.3} width={stroke * 1.4} height={height * 0.4} rx={stroke * 0.5} fill={LIGHT} />
      <Rect x={x + stroke * 1.5} y={y + stroke * 1.5} width={inner} height={height - stroke * 3} rx={height * 0.14} fill={color} />
      {charging && <Path d={`M${x + width * 0.54} ${y + height * 0.14} L${x + width * 0.4} ${y + height * 0.54} H${x + width * 0.52} L${x + width * 0.46} ${y + height * 0.86} L${x + width * 0.62} ${y + height * 0.44} H${x + width * 0.5} Z`} fill={SHADOW} opacity={0.75} />}
    </G>
  );
}

export function StampMarks({ kind, stamp, width, height, variant = 0 }: { kind: StampKind | undefined; stamp: Stamp; width: number; height: number; variant?: number }) {
  if (!kind) return null;
  const unit = Math.min(width, height * 0.6);
  const style = Math.max(0, Math.min(STAMP_VARIANTS[kind] - 1, variant));
  const cx = width / 2;
  const left = unit * 0.1;
  const bottom = height - unit * 0.12;

  if (kind === 'time') {
    // 0 : façon écran de verrouillage, très grande heure au trait fin.
    if (style === 0) return <Soft x={cx} y={height * 0.4} size={unit * 0.3} family="sans-serif-thin" spacing={-1}>{stamp.time}</Soft>;
    // 1 : heure grasse et compacte, la date en dessous.
    if (style === 1) {
      return (
        <G>
          <Soft x={cx} y={height * 0.3} size={unit * 0.16} family="sans-serif-medium" weight="700">{stamp.time}</Soft>
          <Soft x={cx} y={height * 0.3 + unit * 0.07} size={unit * 0.04} family="sans-serif-medium" spacing={unit * 0.01}>{stamp.weekday}</Soft>
        </G>
      );
    }
    // 2 : chiffres à chasse fixe, en bas à gauche.
    return <Soft x={left} y={bottom} size={unit * 0.13} family="monospace" weight="700" anchor="start">{stamp.time}</Soft>;
  }

  if (kind === 'date') {
    // 0 : le jour de la semaine en petites capitales, la date à empattements.
    if (style === 0) {
      return (
        <G>
          <Soft x={cx} y={height * 0.36} size={unit * 0.045} family="sans-serif-medium" spacing={unit * 0.012}>{stamp.weekday}</Soft>
          <Soft x={cx} y={height * 0.36 + unit * 0.14} size={unit * 0.12} family="serif">{stamp.day}</Soft>
        </G>
      );
    }
    // 1 : le quantième en très grand, le mois en dessous, calés à gauche.
    if (style === 1) {
      return (
        <G>
          <Soft x={left} y={height * 0.4} size={unit * 0.3} family="sans-serif-thin" anchor="start">{stamp.dayNumber}</Soft>
          <Soft x={left + unit * 0.01} y={height * 0.4 + unit * 0.07} size={unit * 0.045} family="sans-serif-medium" spacing={unit * 0.012} anchor="start">{stamp.month}</Soft>
        </G>
      );
    }
    // 2 : une ligne italique en bas.
    return <Soft x={cx} y={bottom} size={unit * 0.075} family="serif" italic>{stamp.long}</Soft>;
  }

  if (kind === 'film') {
    // Pellicule : la date orange imprimée, avec un léger halo.
    const size = unit * (style === 2 ? 0.055 : 0.07);
    const anchor: Anchor = style === 1 ? 'start' : 'end';
    const x = style === 1 ? left : width - unit * 0.07;
    const y = style === 2 ? bottom - size * 1.5 : height - unit * 0.1;
    const shared = { fontSize: size, fontFamily: 'monospace', fontWeight: '700' as const, letterSpacing: size * 0.08, textAnchor: anchor };
    // 0 : en bas à droite ; 1 : en bas à gauche ; 2 : la date et l'heure sur deux lignes.
    const lines = style === 2 ? [stamp.film, stamp.time] : [stamp.film];
    return (
      <G>
        {lines.map((line, index) => (
          <G key={line}>
            <SvgText {...shared} x={x + 1} y={y + 1 + index * size * 1.35} fill={FILM_GLOW} opacity={0.55}>{line}</SvgText>
            <SvgText {...shared} x={x} y={y + index * size * 1.35} fill={FILM_ORANGE}>{line}</SvgText>
          </G>
        ))}
      </G>
    );
  }

  if (kind === 'place') {
    // Sans position connue (autorisation refusée, ville inconnue) : rien n'est dessiné.
    if (!stamp.place) return null;
    const place = stamp.place;
    // Les noms longs rétrécissent pour tenir dans la largeur.
    const fit = (base: number, perChar: number) => Math.min(base, (width * 0.86) / (place.length * perChar));
    if (style === 0) return <Soft x={cx} y={height * 0.4} size={fit(unit * 0.1, 0.62)} family="sans-serif-medium" spacing={unit * 0.016}>{place.toUpperCase()}</Soft>;
    if (style === 1) return <Soft x={left} y={bottom} size={fit(unit * 0.14, 0.5)} family="serif" italic anchor="start">{place}</Soft>;
    return <Soft x={cx} y={height * 0.38} size={fit(unit * 0.2, 0.46)} family="sans-serif-condensed" weight="700">{place.toUpperCase()}</Soft>;
  }

  if (kind === 'weekday') {
    const day = stamp.weekday;
    const fit = (base: number, perChar: number) => Math.min(base, (width * 0.88) / (day.length * perChar));
    if (style === 0) return <Soft x={cx} y={height * 0.4} size={fit(unit * 0.2, 0.6)} family="sans-serif-thin" spacing={unit * 0.01}>{day}</Soft>;
    if (style === 1) return <Soft x={cx} y={height * 0.38} size={fit(unit * 0.17, 0.5)} family="serif" italic>{day.charAt(0) + day.slice(1).toLowerCase()}</Soft>;
    return (
      <G>
        <Soft x={left} y={height * 0.38} size={fit(unit * 0.2, 0.5)} family="sans-serif-condensed" weight="700" anchor="start">{day}</Soft>
        <Soft x={left} y={height * 0.38 + unit * 0.07} size={unit * 0.045} family="sans-serif-medium" spacing={unit * 0.012} anchor="start">{stamp.day.toUpperCase()}</Soft>
      </G>
    );
  }

  if (kind === 'streak') {
    // Pas de série en cours : rien n'est dessiné.
    if (stamp.streak < 1) return null;
    const count = String(stamp.streak);
    const label = t('editeur.serieJours', { count });
    if (style === 0) {
      return (
        <G>
          <Soft x={cx} y={height * 0.4} size={unit * 0.3} family="sans-serif-thin">{count}</Soft>
          <Soft x={cx} y={height * 0.4 + unit * 0.07} size={unit * 0.045} family="sans-serif-medium" spacing={unit * 0.01}>{label.toUpperCase()}</Soft>
        </G>
      );
    }
    if (style === 1) return <Soft x={cx} y={height * 0.38} size={unit * 0.14} family="sans-serif-medium" weight="700">{label}</Soft>;
    return (
      <G>
        <Soft x={left} y={bottom} size={unit * 0.2} family="serif" italic anchor="start">{count}</Soft>
        <Soft x={left + unit * (0.09 + 0.08 * count.length)} y={bottom} size={unit * 0.06} family="serif" anchor="start">{label}</Soft>
      </G>
    );
  }

  // Batterie
  const battery = stamp.battery;
  if (!battery) return null;
  const percent = `${battery.level}%`;
  if (style === 0) return <Soft x={cx} y={height * 0.4} size={unit * 0.26} family="sans-serif-thin">{percent}</Soft>;
  if (style === 1) {
    const iconWidth = unit * 0.32;
    return (
      <G>
        <BatteryIcon x={cx - iconWidth / 2 - unit * 0.01} y={height * 0.3} width={iconWidth} level={battery.level} charging={battery.charging} />
        <Soft x={cx} y={height * 0.3 + iconWidth * 0.46 + unit * 0.1} size={unit * 0.075} family="sans-serif-medium" spacing={unit * 0.01}>{percent}</Soft>
      </G>
    );
  }
  return <Soft x={left} y={bottom} size={unit * 0.12} family="monospace" weight="700" anchor="start">{percent}</Soft>;
}
