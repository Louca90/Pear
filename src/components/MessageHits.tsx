import { Text, View } from 'react-native';

import { SearchHit } from '../chat/database';
import { searchExcerpt } from '../chat/search';
import { dateLocale, t } from '../i18n';
import { createStyles, spacing } from '../theme';
import { RowPressable } from './ui';

// La date d'un message trouvé : l'heure s'il est d'aujourd'hui, sinon le jour (et l'année si elle diffère).
function hitDate(at: number) {
  const date = new Date(at);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat(dateLocale(), { hour: '2-digit', minute: '2-digit' }).format(at);
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(dateLocale(), sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(at);
}

// Un message trouvé par la recherche (lot 4.1) : qui l'a écrit, quand, et un extrait autour du mot.
export function MessageHitRow({ hit, name, query, onPress }: { hit: SearchHit; name: string; query: string; onPress: () => void }) {
  const styles = useStyles();
  return (
    <RowPressable onPress={onPress} style={styles.row}>
      <View style={styles.top}>
        <Text style={styles.author} numberOfLines={1}>
          {hit.mine === 1 ? t('recherche.vousA', { nom: name }) : name}
        </Text>
        <Text style={styles.date}>{hitDate(hit.created_at)}</Text>
      </View>
      <Text style={styles.excerpt} numberOfLines={2}>
        {searchExcerpt(hit.text, query)}
      </Text>
    </RowPressable>
  );
}

const useStyles = createStyles((colors) => ({
  row: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 2,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  author: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  date: {
    fontSize: 13,
    color: colors.textMuted,
  },
  excerpt: {
    fontSize: 14,
    lineHeight: 19,
    color: colors.textMuted,
  },
}));
