import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Check, QrCode, Trash2 } from 'lucide-react-native';

import { ContactProfile } from '../chat/database';
import { showDialog } from '../components/dialog';
import { Avatar, Button, Header, Screen } from '../components/ui';
import { createStyles, radius, spacing, useColors } from '../theme';

type Props = {
  initialName: string;
  // Le nom et la photo choisis par le contact lui-même.
  profile: ContactProfile;
  code: string[];
  isNew: boolean;
  onBack: () => void;
  onSave: (name: string) => void;
  onShowMyCode: () => void;
  onRemove: () => void;
};

export function ContactScreen({ initialName, profile, code, isNew, onBack, onSave, onShowMyCode, onRemove }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const [name, setName] = useState(initialName);

  const confirmRemove = () => {
    showDialog('Supprimer ce contact ?', 'Vos messages avec lui seront effacés de ce téléphone, et il faudra refaire le pairing.', [
      { label: 'Supprimer', style: 'danger', onPress: onRemove },
      { label: 'Annuler', style: 'cancel' },
    ]);
  };

  return (
    <Screen>
      <Header title={isNew ? 'Nouveau contact' : initialName} onBack={onBack} />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!isNew && (
            <View style={styles.profile}>
              <Avatar uri={profile.photo_uri} size={96} />
              {profile.name && <Text style={styles.profileName}>{profile.name}</Text>}
            </View>
          )}
          <Text style={styles.label}>Code de vérification</Text>
          <View style={styles.code}>
            {code.map((group, index) => (
              <Text key={index} style={styles.codeGroup}>{group}</Text>
            ))}
          </View>
          <Text style={styles.text}>
            Ce code doit être identique sur les deux téléphones. S'il est différent, ne continuez pas.
          </Text>

          <Text style={styles.label}>Nom</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Nom du contact"
            placeholderTextColor={colors.textMuted}
            maxLength={40}
          />

          <View style={styles.actions}>
            <Button label="Enregistrer" icon={Check} onPress={() => onSave(name.trim() || 'Contact')} />
            <Button label="Montrer mon code" icon={QrCode} variant="secondary" onPress={onShowMyCode} />
          </View>

          {!isNew && (
            <Pressable onPress={confirmRemove} style={styles.remove} hitSlop={8}>
              <Trash2 size={18} color={colors.textMuted} strokeWidth={1.75} />
              <Text style={styles.removeLabel}>Supprimer ce contact</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  profile: {
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  code: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  codeGroup: {
    fontSize: 20,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    color: colors.text,
  },
  text: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  actions: {
    gap: spacing.sm,
  },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.sm,
  },
  removeLabel: {
    fontSize: 14,
    color: colors.textMuted,
  },
}));
