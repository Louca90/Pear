import { useEffect, useRef, type ComponentRef } from 'react';
import { Keyboard, Pressable, TextInput, View } from 'react-native';
import { Search, X } from 'lucide-react-native';

import { t } from '../i18n';
import { createStyles, radius, spacing, useColors } from '../theme';

// Champ de recherche compact (conversations, contacts) : loupe, texte, croix pour effacer.
export function SearchField({ value, onChange, placeholder, autoFocus }: { value: string; onChange: (text: string) => void; placeholder: string; autoFocus?: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  // Le champ ne prend le focus qu'au toucher (ou s'il est ouvert exprès, autoFocus). Android le lui
  // donne parfois tout seul, par exemple quand on quitte une conversation dont le champ Message avait
  // le clavier : on le rend aussitôt et le clavier se ferme.
  const touched = useRef(!!autoFocus);
  const onFocus = () => {
    if (touched.current) return;
    input.current?.blur();
    Keyboard.dismiss();
  };
  // En quittant l'écran, il rend le focus et le clavier se ferme.
  useEffect(
    () => () => {
      if (input.current?.isFocused()) Keyboard.dismiss();
    },
    [],
  );
  return (
    <View style={styles.field}>
      <Search size={18} color={colors.textMuted} strokeWidth={1.75} />
      <TextInput
        ref={input}
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType="search"
        autoFocus={autoFocus}
        onPressIn={() => {
          touched.current = true;
        }}
        onFocus={onFocus}
        onBlur={() => {
          touched.current = false;
        }}
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
