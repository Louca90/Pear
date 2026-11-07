import { useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ban, Check, Trash2 } from 'lucide-react-native';

import { ContactProfile } from '../chat/database';
import { showDialog } from '../components/dialog';
import { Avatar, Button, Header, Screen } from '../components/ui';
import { SegmentedControl } from '../components/SegmentedControl';
import { ContactMedia } from './contact/ContactMedia';
import { createStyles, radius, spacing, useColors } from '../theme';
import { t } from '../i18n';

type Props = {
  initialName: string;
  // Le nom et la photo choisis par le contact lui-même.
  profile: ContactProfile;
  isNew: boolean;
  onBack: () => void;
  onSave: (name: string) => void;
  onRemove: () => void;
  blocked: boolean;
  onToggleBlock: () => void;
  contactKey: string;
};

export function ContactScreen({ initialName, profile, isNew, onBack, onSave, onRemove, blocked, onToggleBlock, contactKey }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const [name, setName] = useState(initialName);
  const [tab, setTab] = useState<'profile' | 'media'>('profile');
  const fade = useRef(new Animated.Value(1)).current;

  // Changement d'onglet : le contenu s'efface puis revient, sans saut.
  const chooseTab = (next: 'profile' | 'media') => {
    if (next === tab) return;
    fade.setValue(0);
    setTab(next);
    Animated.timing(fade, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  };

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
          {!isNew && (
            <View style={styles.tabs}>
              <SegmentedControl
                options={[
                  { value: 'profile', label: t('contact.ongletProfil') },
                  { value: 'media', label: t('contact.ongletMedias') },
                ]}
                value={tab}
                onChange={chooseTab}
              />
            </View>
          )}
          <Animated.View style={{ opacity: fade }}>
          {tab === 'media' ? (
            <ContactMedia contactKey={contactKey} />
          ) : (
          <>
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
          </>
          )}
          </Animated.View>
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
  tabs: {
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
