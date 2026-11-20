import { useEffect, useState } from 'react';
import { PermissionsAndroid, Pressable, Text, View } from 'react-native';
import { ArrowUp, MapPin } from 'lucide-react-native';

import { lastKnownLocation } from '../../../../modules/pear-native';
import { Message } from '../../../chat/database';
import { bearing, compassPoint, distanceKm, formatDistance, isSharing, parseLocationText } from '../../../chat/location';
import { MiniMap } from '../../../map/MiniMap';
import { savedRegion } from '../../../map/offlineMap';
import { openMap } from '../../../map/openMap';
import { insideRegion } from '../../../map/region';
import { chat } from '../../../chat/manager';
import { IN_PLACE_KM, nearestPlace } from '../../../components/editor/cities';
import { t } from '../../../i18n';
import { log } from '../../../log';
import { BubblePalette, createStyles, radius, spacing } from '../../../theme';

import { useChatStyles } from '../styles';

// L'heure avance sans nouveau message : « il y a 30 s », « encore 12 min » sont recalculés toutes les 15 s.
const TICK_MS = 15 * 1000;

function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// Ma propre position, seulement si l'autorisation est déjà donnée : recevoir une position ne demande rien.
function useMyPosition(active: boolean, now: number) {
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    if (!active) return;
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION)
      .then((granted) => setPosition(granted ? lastKnownLocation() : null))
      .catch((e) => log.warn('position', e));
  }, [active, now]);
  return position;
}

function ago(ms: number) {
  if (ms < 60_000) return t('position.aLinstant');
  if (ms < 3600_000) return t('position.ilYaMin', { n: Math.floor(ms / 60_000) });
  return t('position.ilYaH', { n: Math.floor(ms / 3600_000) });
}

function remaining(ms: number) {
  if (ms < 3600_000) return t('position.encoreMin', { n: Math.max(1, Math.ceil(ms / 60_000)) });
  return t('position.encoreH', { n: Math.ceil(ms / 3600_000) });
}

// Position en direct dans une bulle (lot 4.8). Une mini-carte hors ligne si la zone est gardée sur le
// téléphone, la ville la plus proche (liste embarquée), la distance et la direction depuis ma position,
// et un bouton qui ouvre la carte de Pear (jamais une app de cartes extérieure).
export function LocationContent({ message, palette }: { message: Message; palette: BubblePalette }) {
  const styles = useStyles();
  const now = useNow();
  const location = parseLocationText(message.text);
  const mine = message.mine === 1;
  const live = !!location && isSharing(location, now);
  const me = useMyPosition(!mine && !!location, now);
  if (!location) return <Text style={[styles.title, { color: palette.text }]}>{t('position.titre')}</Text>;

  // La commune la plus proche (liste embarquée) : « À X » si on y est, « Près de X » sinon.
  const near = nearestPlace(location);
  const away = !mine && me ? distanceKm(me, location) : null;
  const direction = !mine && me && away !== null && away >= 0.3 ? bearing(me, location) : null;
  const place = [near ? t(near.km <= IN_PLACE_KM ? 'position.aVille' : 'position.presDe', { ville: near.name }) : null, away !== null ? t('position.aDistance', { distance: formatDistance(away, t('position.virgule')) }) : null].filter(Boolean).join(' · ');

  const region = savedRegion();
  const mapped = !!region && insideRegion(region.bounds, location);

  return (
    <View style={styles.box}>
      {mapped && (
        <Pressable onPress={() => openMap(message.contact)} accessibilityRole="button" accessibilityLabel={t('carte.voir')}>
          <MiniMap latitude={location.latitude} longitude={location.longitude} width={232} height={130} live={live} />
        </Pressable>
      )}
      <View style={styles.top}>
        <View style={[styles.badge, { backgroundColor: palette.track }]}>
          {direction !== null ? (
            // La flèche pointe vers le contact, le nord étant le haut de l'écran.
            <View style={{ transform: [{ rotate: `${direction}deg` }] }}>
              <ArrowUp size={20} color={palette.text} strokeWidth={2} />
            </View>
          ) : (
            <MapPin size={20} color={palette.text} strokeWidth={1.75} />
          )}
        </View>
        <View style={styles.text}>
          <Text style={[styles.title, { color: palette.text }]}>{mine ? t('position.maPosition') : t('position.titre')}</Text>
          {place !== '' && (
            <Text style={[styles.line, { color: palette.text }]}>
              {place}
              {direction !== null ? ` ${t(`position.cap_${compassPoint(direction)}`)}` : ''}
            </Text>
          )}
          <Text style={[styles.time, { color: palette.muted }]}>
            {location.once ? `${t('position.ponctuelle')} · ${ago(now - location.at)}` : live ? `${ago(now - location.at)} · ${location.open ? t('position.tantQueOuverte') : remaining(location.until - now)}` : t('position.termine')}
          </Text>
        </View>
      </View>
      {mine ? (
        live && (
          <Pressable onPress={() => chat.stopLocation(message.contact)} accessibilityRole="button" style={[styles.button, { backgroundColor: palette.track }]}>
            <Text style={[styles.buttonLabel, { color: palette.text }]}>{t('position.arreter')}</Text>
          </Pressable>
        )
      ) : (
        <Pressable onPress={() => openMap(message.contact)} accessibilityRole="button" style={[styles.button, { backgroundColor: palette.track }]}>
          <Text style={[styles.buttonLabel, { color: palette.text }]}>{t('carte.voir')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const useLocalStyles = createStyles(() => ({
  box: {
    width: 232,
    gap: spacing.sm,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
  },
  line: {
    fontSize: 14,
    lineHeight: 18,
  },
  button: {
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
}));

const useStyles = () => useChatStyles(useLocalStyles());
