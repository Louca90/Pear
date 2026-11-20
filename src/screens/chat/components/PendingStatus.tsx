import { useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated from 'react-native-reanimated';

import { Message } from '../../../chat/database';
import { chat } from '../../../chat/manager';
import { PendingLabel, PendingState, pendingLabel, unreachableAt } from '../../../chat/pending';
import { useColors } from '../../../theme';
import { enterUp, exitFade } from '../../../motion';
import { t } from '../../../i18n';

import { formatTime } from '../format';

// Un envoi qui aboutit tout de suite (contact connecté) n'affiche rien : la ligne n'apparaît qu'après ce délai.
const SHOW_AFTER_MS = 1000;

// Sous un message pas encore distribué : ce qui a été tenté et quand (heure absolue, qui ne se périme
// pas), puis « Réessayer » si rien n'est parti depuis quelques minutes. Rien ne promet la livraison :
// elle dépend du téléphone du contact. Pas de détail technique (serveur, type de push).
//
// La bulle est mémoïsée : l'état de la connexion et l'heure de « Réessayer » sont suivis ici, avec un
// instantané précis (pas chat.getVersion, qui redessinerait à chaque signal).
export function PendingStatus({ message }: { message: Message }) {
  const colors = useColors();
  const snapshot = useSyncExternalStore(chat.subscribe, () => {
    const state = chat.pendingState(message);
    const kind = state ? (state.kind === 'not-sent' ? (state.offline ? 'offline' : 'not-sent') : state.kind) : '';
    return `${kind}|${chat.retryAvailableAt(message) ?? ''}`;
  });
  const [kind, retryText] = snapshot.split('|');
  const retryAt = retryText ? Number(retryText) : null;
  const state: PendingState | null =
    kind === 'sending'
      ? { kind: 'sending' }
      : kind === 'waiting' && message.last_attempt_at
        ? { kind: 'waiting', lastTry: message.last_attempt_at }
        : kind === 'offline' || kind === 'not-sent'
          ? { kind: 'not-sent', offline: kind === 'offline' }
          : null;
  const offAt = state ? unreachableAt(state, message) : Infinity;

  // L'apparition de la ligne, le passage à « pas de connexion » et l'heure de « Réessayer » passent
  // sans aucun signal du moteur : un minuteur redessine à ce moment-là.
  const showAt = message.created_at + SHOW_AFTER_MS;
  const [now, setNow] = useState(Date.now);
  const [showTime, setShowTime] = useState(false);
  useEffect(() => {
    const next = [showAt, retryAt, offAt].filter((at): at is number => at !== null && Number.isFinite(at) && at > now);
    if (next.length === 0) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(...next) - now + 50);
    return () => clearTimeout(timer);
  }, [showAt, retryAt, offAt, now]);

  const retryDue = retryAt !== null && now >= retryAt;
  if (!state || now < showAt) return null;
  // « Envoi… » tant que le téléphone du contact n'a pas reçu le message. L'heure du dernier essai
  // seulement à l'appui, ou après 5 minutes.
  const lastTry = showTime || retryDue ? message.last_attempt_at : null;
  const labels: Record<PendingLabel, string> = {
    sending: lastTry ? t('attente.envoiEssai', { heure: formatTime(lastTry) }) : t('attente.envoi'),
    unreachable: lastTry ? t('attente.contactHorsLigneEssai', { heure: formatTime(lastTry) }) : t('attente.contactHorsLigne'),
    offline: t('attente.pasEnvoyeHorsLigne'),
    'not-sent': t('attente.pasEnvoye'),
  };
  const label = labels[pendingLabel(state, message, now)];
  const retry = retryDue;

  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <Pressable onPress={() => setShowTime((shown) => !shown)} hitSlop={6} accessibilityRole="text">
        <Reanimated.Text key={label} entering={enterUp(4)} style={[styles.line, { color: colors.textMuted }]}>
          {label}
        </Reanimated.Text>
      </Pressable>
      {retry && (
        <Reanimated.View entering={enterUp(4)} exiting={exitFade()} style={styles.retryBlock}>
          <Text style={[styles.line, styles.explain, { color: colors.textMuted }]}>{t('attente.toujours')}</Text>
          <Pressable onPress={() => chat.retry(message.contact)} hitSlop={8} accessibilityRole="button">
            {({ pressed }) => <Text style={[styles.retry, { color: colors.text, opacity: pressed ? 0.5 : 1 }]}>{t('attente.reessayer')}</Text>}
          </Pressable>
        </Reanimated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'flex-end',
    marginTop: 3,
    paddingHorizontal: 4,
    maxWidth: 260,
  },
  line: {
    fontSize: 11,
    textAlign: 'right',
  },
  explain: {
    marginTop: 2,
  },
  retryBlock: {
    alignItems: 'flex-end',
  },
  retry: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 3,
  },
});
