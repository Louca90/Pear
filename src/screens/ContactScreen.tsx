import { useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ban, Check, Trash2 } from 'lucide-react-native';

import { ContactProfile } from '../chat/database';
import { Pear } from '../components/Pear';
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
  // 4 groupes de 4 chiffres, identiques sur les deux téléphones.
  code: string[];
  verified: boolean;
  onVerify: () => void;
};

export function ContactScreen({ initialName, profile, isNew, onBack, onSave, onRemove, blocked, onToggleBlock, contactKey, code, verified, onVerify }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const [name, setName] = useState(initialName);
  const [tab, setTab] = useState<'profile' | 'media'>('profile');
  const fade = useRef(new Animated.Value(1)).current;
  const tick = useRef(new Animated.Value(verified ? 1 : 0)).current;

  // Validation : la coche apparaît en fondu.
  const confirmCode = () => {
    onVerify();
    Animated.timing(tick, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  };

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
              {verified && (
                <Animated.View style={[styles.verified, { opacity: tick }]}>
                  {/* Contact vérifié : la feuille de la poire pousse, en couleur signature. */}
                  <Pear height={20} color={colors.text} state="leaf" leafColor={colors.signatureStrong} />
                  <Text style={styles.verifiedLabel}>{t('contact.verifie')}</Text>
                </Animated.View>
              )}
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
          <Text style={styles.label}>{t('contact.codeVerification')}</Text>
          <View style={styles.codeBox}>
            <View style={styles.codeRow}>
              {code.map((group, index) => (
                <Text key={index} style={styles.codeGroup}>
                  {group}
                </Text>
              ))}
            </View>
            <Text style={styles.codeHelp}>{verified ? t('contact.verifie') : t('contact.codeAide')}</Text>
            {!isNew && !verified && <Button label={t('contact.codesIdentiques')} icon={Check} onPress={confirmCode} />}
          </View>

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
  verified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  verifiedLabel: {
    fontSize: 13,
    color: colors.textMuted,
  },
  codeBox: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  codeGroup: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  codeHelp: {
    fontSize: 13,
    color: colors.textMuted,
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
