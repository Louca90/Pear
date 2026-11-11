import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';

import { searchMessages } from '../../../chat/database';
import { MessageHitRow } from '../../../components/MessageHits';
import { SearchField } from '../../../components/SearchField';
import { IconButton, useInsets } from '../../../components/ui';
import { t } from '../../../i18n';
import { useBackInterceptor } from '../../../navigation/backInterceptors';
import { createStyles, motion, spacing, useColors } from '../../../theme';

type Props = {
  contactKey: string;
  name: string;
  onClose: () => void;
  // Le message choisi : la conversation s'y rend.
  onPick: (id: string) => void;
};

// Recherche dans la conversation (lot 4.1) : par-dessus l'écran, en fondu. Un appui sur un résultat
// referme la recherche et rejoint le message.
export function ChatSearch({ contactKey, name, onClose, onPick }: Props) {
  const styles = useStyles();
  const colors = useColors();
  const { top } = useInsets();
  const [query, setQuery] = useState('');
  const opacity = useRef(new Animated.Value(0)).current;
  const hits = useMemo(() => searchMessages(query, contactKey), [query, contactKey]);

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: motion.small, easing: motion.easing, useNativeDriver: true }).start();
  }, [opacity]);

  const close = (then?: () => void) =>
    Animated.timing(opacity, { toValue: 0, duration: motion.small, easing: motion.easing, useNativeDriver: true }).start(() => {
      onClose();
      then?.();
    });
  useBackInterceptor(true, () => close());

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { paddingTop: top, opacity }]}>
      <View style={styles.bar}>
        <IconButton onPress={() => close()} label={t('commun.retour')}>
          <ArrowLeft size={24} color={colors.text} strokeWidth={1.75} />
        </IconButton>
        <View style={styles.field}>
          <SearchField value={query} onChange={setQuery} placeholder={t('recherche.dansConversation')} autoFocus />
        </View>
      </View>
      <FlatList
        data={hits}
        keyExtractor={(hit) => hit.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={query.trim() ? <Text style={styles.empty}>{t('recherche.aucun')}</Text> : undefined}
        renderItem={({ item }) => <MessageHitRow hit={item} name={name} query={query} onPress={() => close(() => onPick(item.id))} />}
      />
    </Animated.View>
  );
}

const useStyles = createStyles((colors) => ({
  overlay: {
    backgroundColor: colors.background,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    paddingLeft: spacing.md,
  },
  field: {
    flex: 1,
    marginLeft: -spacing.sm,
  },
  empty: {
    padding: spacing.lg,
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
  },
}));
