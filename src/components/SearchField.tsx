import { Pressable, TextInput, View } from 'react-native';
import { Search, X } from 'lucide-react-native';

import { t } from '../i18n';
import { createStyles, radius, spacing, useColors } from '../theme';

// Champ de recherche compact (conversations, contacts) : loupe, texte, croix pour effacer.
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (text: string) => void; placeholder: string }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Search size={18} color={colors.textMuted} strokeWidth={1.75} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChange('')} hitSlop={8} accessibilityLabel={t('liste.effacer')}>
          <X size={18} color={colors.textMuted} strokeWidth={1.75} />
        </Pressable>
      )}
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 0,
  },
}));
