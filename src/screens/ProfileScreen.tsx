import { useEffect, useState } from 'react';
import { AppState, KeyboardAvoidingView, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Bell, Camera, Check, ChevronRight, Download, ImageMinus, RefreshCw, ShieldCheck } from 'lucide-react-native';

import { appVersionCode, appVersionName } from '../../modules/pear-native';

import { chat, MAX_PROFILE_NAME_LENGTH } from '../chat/manager';
import { showDialog } from '../components/dialog';
import { SegmentedControl } from '../components/SegmentedControl';
import { Avatar, Button, Header, IconButton, Screen } from '../components/ui';
import { createStyles, radius, setThemePreference, spacing, ThemePreference, useColors, useThemePreference } from '../theme';
import { checkForUpdate, getInstallPermission, previewUpdateScreen, requestInstallPermission, useUpdateState } from '../update/updates';
import { PROFILE_PHOTO_QUALITY } from '../config';
import { t } from '../i18n';

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'auto', label: t('profil.themeAuto') },
  { value: 'light', label: t('profil.themeClair') },
  { value: 'dark', label: t('profil.themeSombre') },
];

export function ProfileScreen({ onBack }: { onBack: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const theme = useThemePreference();
  const saved = chat.getMyProfile();
  const [name, setName] = useState(saved.name ?? '');
  const [photo, setPhoto] = useState(saved.photo);
  const [saving, setSaving] = useState(false);
  const update = useUpdateState();
  const [canInstall, setCanInstall] = useState(getInstallPermission);

  // L'autorisation se donne dans les réglages d'Android : on la relit au retour dans l'app.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setCanInstall(getInstallPermission());
    });
    return () => subscription.remove();
  }, []);

  const updateStatus =
    update.status === 'checking'
      ? t('profil.recherche')
      : update.status === 'available'
        ? t('profil.versionDispo', { version: update.release?.version ?? '' })
        : update.status === 'upToDate'
          ? t('profil.aJour')
          : update.status === 'offline'
            ? t('profil.githubInjoignable')
            : null;

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: PROFILE_PHOTO_QUALITY, allowsEditing: true, aspect: [1, 1] });
    const asset = result.assets?.[0];
    if (!result.canceled && asset) setPhoto(asset.uri);
  };

  const save = async () => {
    setSaving(true);
    try {
      await chat.saveProfile(name.trim(), photo);
      onBack();
    } catch (e) {
      showDialog(t('commun.enregistrementImpossible'), String(e));
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Header title={t('profil.titre')} onBack={onBack} />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <IconButton onPress={pickPhoto} label={t('profil.choisirPhoto')} hitSlop={0} style={styles.photo}>
            <Avatar uri={photo} size={112} />
            <View style={styles.photoBadge}>
              <Camera size={18} color={colors.onAccent} strokeWidth={1.75} />
            </View>
          </IconButton>
          {photo && (
            <IconButton onPress={() => setPhoto(null)} label={t('profil.retirerPhoto')} hitSlop={8} style={styles.removePhoto}>
              <ImageMinus size={18} color={colors.textMuted} strokeWidth={1.75} />
              <Text style={styles.removeLabel}>{t('profil.retirerPhoto')}</Text>
            </IconButton>
          )}

          <Text style={styles.label}>{t('profil.votreNom')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('profil.commentPresenter')}
            placeholderTextColor={colors.textMuted}
            maxLength={MAX_PROFILE_NAME_LENGTH}
          />
          <Text style={styles.hint}>{t('profil.confidentialite')}</Text>

          <Button label={saving ? 'Enregistrement...' : t('commun.enregistrer')} icon={Check} onPress={save} />

          <Text style={[styles.label, styles.section]}>{t('profil.parametres')}</Text>
          <Pressable onPress={() => Linking.openSettings()} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
            <Bell size={20} color={colors.text} strokeWidth={1.75} />
            <Text style={styles.settingLabel}>{t('commun.notifications')}</Text>
            <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
          </Pressable>

          <Text style={[styles.label, styles.section]}>{t('profil.apparence')}</Text>
          <SegmentedControl options={THEMES} value={theme} onChange={setThemePreference} />

          <Text style={[styles.label, styles.section]}>{t('profil.misesAJour')}</Text>
          <View style={styles.rows}>
            <Pressable onPress={() => checkForUpdate(true)} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
              <RefreshCw size={20} color={colors.text} strokeWidth={1.75} />
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>{t('profil.rechercherMaj')}</Text>
                <Text style={styles.settingDetail}>
                  {t('commun.version')} {appVersionName() ?? '?'} ({appVersionCode() ?? '?'}){updateStatus ? ` · ${updateStatus}` : ''}
                </Text>
              </View>
            </Pressable>
            <Pressable onPress={requestInstallPermission} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
              <ShieldCheck size={20} color={colors.text} strokeWidth={1.75} />
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>{t('profil.installationMaj')}</Text>
                <Text style={styles.settingDetail}>{canInstall ? t('profil.autorisee') : t('profil.aAutoriser')}</Text>
              </View>
              <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
            </Pressable>
            {__DEV__ && update.status === 'available' && (
              <Pressable onPress={() => previewUpdateScreen(true)} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
                <Download size={20} color={colors.text} strokeWidth={1.75} />
                <Text style={styles.settingLabel}>{t('profil.apercuMaj')}</Text>
              </Pressable>
            )}
          </View>
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
  photo: {
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  photoBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePhoto: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  removeLabel: {
    fontSize: 14,
    color: colors.textMuted,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  section: {
    marginTop: spacing.lg,
  },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  setting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  settingLabel: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
  settingText: {
    flex: 1,
  },
  settingDetail: {
    fontSize: 13,
    color: colors.textMuted,
  },
  rows: {
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
}));
