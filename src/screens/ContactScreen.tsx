import { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ban, Check, QrCode, Trash2 } from 'lucide-react-native';

import { ContactProfile } from '../chat/database';
import { showDialog } from '../components/dialog';
import { MyQrSheet } from '../components/MyQrSheet';
import { Avatar, Button, Header, Screen } from '../components/ui';
import { createStyles, radius, spacing, useColors } from '../theme';
import { t } from '../i18n';

type Props = {
  initialName: string;
  // Le nom et la photo choisis par le contact lui-même.
  profile: ContactProfile;
  code: string[];
  isNew: boolean;
  onBack: () => void;
  onSave: (name: string) => void;
  // Notre clé, pour montrer notre QR code sans quitter l'écran.
  myPublicKey: string;
  onRemove: () => void;
  blocked: boolean;
  onToggleBlock: () => void;
};

export function ContactScreen({ initialName, profile, code, isNew, onBack, onSave, myPublicKey, onRemove, blocked, onToggleBlock }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const [name, setName] = useState(initialName);
  const [showingCode, setShowingCode] = useState(false);

  const confirmBlock = () => {
    showDialog(t('statut.bloquerQuestion'), t('statut.bloquerAide'), [
      { label: t('demandes.bloquer'), style: 'danger', onPress: onToggleBlock },
      { label: t('commun.annuler'), style: 'cancel' },
    ]);
  };

  const confirmRemove = () => {
    showDialog(t('contact.supprimerQuestion'), t('contact.supprimerAide'), [
      { label: t('commun.supprimer'), style: 'danger', onPress: onRemove },
      { label: t('commun.annuler'), style: 'cancel' },
    ]);
  };

  return (
    <Screen>
      <Header title={isNew ? t('contact.nouveau') : initialName} onBack={onBack} />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {!isNew && (
            <View style={styles.profile}>
              <Avatar uri={profile.photo_uri} size={96} />
              {profile.name && <Text style={styles.profileName}>{profile.name}</Text>}
            </View>
          )}
          <Text style={styles.label}>{t('contact.codeVerification')}</Text>
          <View style={styles.code}>
            {code.map((group, index) => (
              <Text key={index} style={styles.codeGroup}>{group}</Text>
            ))}
          </View>
          <Text style={styles.text}>
            {t('contact.codeVerificationAide')}
          </Text>

          <Text style={styles.label}>{t('contact.nom')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('contact.nomContact')}
            placeholderTextColor={colors.textMuted}
            maxLength={40}
          />

          <View style={styles.actions}>
            <Button label={t('commun.enregistrer')} icon={Check} onPress={() => onSave(name.trim() || t('app.contact'))} />
            <Button label={t('contact.montrerCode')} icon={QrCode} variant="secondary" onPress={() => setShowingCode(true)} />
          </View>

          {!isNew && (
            <Pressable onPress={blocked ? onToggleBlock : confirmBlock} style={styles.remove} hitSlop={8}>
              <Ban size={18} color={colors.textMuted} strokeWidth={1.75} />
              <Text style={styles.removeLabel}>{blocked ? t('statut.debloquerContact') : t('statut.bloquerContact')}</Text>
            </Pressable>
          )}
          {!isNew && (
            <Pressable onPress={confirmRemove} style={styles.remove} hitSlop={8}>
              <Trash2 size={18} color={colors.textMuted} strokeWidth={1.75} />
              <Text style={styles.removeLabel}>{t('contact.supprimer')}</Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <MyQrSheet visible={showingCode} publicKey={myPublicKey} onClose={() => setShowingCode(false)} />
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
