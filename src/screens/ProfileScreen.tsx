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

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'auto', label: 'Automatique' },
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
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
      ? 'Recherche en cours…'
      : update.status === 'available'
        ? `Version ${update.release?.version} disponible`
        : update.status === 'upToDate'
          ? 'Pear est à jour'
          : update.status === 'offline'
            ? 'Impossible de joindre GitHub'
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
      showDialog('Enregistrement impossible', String(e));
      setSaving(false);
    }
  };

  return (
    <Screen>
      <Header title="Profil" onBack={onBack} />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <IconButton onPress={pickPhoto} label="Choisir une photo de profil" hitSlop={0} style={styles.photo}>
            <Avatar uri={photo} size={112} />
            <View style={styles.photoBadge}>
              <Camera size={18} color={colors.onAccent} strokeWidth={1.75} />
            </View>
          </IconButton>
          {photo && (
            <IconButton onPress={() => setPhoto(null)} label="Retirer la photo" hitSlop={8} style={styles.removePhoto}>
              <ImageMinus size={18} color={colors.textMuted} strokeWidth={1.75} />
              <Text style={styles.removeLabel}>Retirer la photo</Text>
            </IconButton>
          )}

          <Text style={styles.label}>Votre nom</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Comment vous présenter"
            placeholderTextColor={colors.textMuted}
            maxLength={MAX_PROFILE_NAME_LENGTH}
          />
          <Text style={styles.hint}>Votre photo et votre nom ne sont envoyés qu'à vos contacts, directement sur leur téléphone.</Text>

          <Button label={saving ? 'Enregistrement...' : 'Enregistrer'} icon={Check} onPress={save} />

          <Text style={[styles.label, styles.section]}>Paramètres</Text>
          <Pressable onPress={() => Linking.openSettings()} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
            <Bell size={20} color={colors.text} strokeWidth={1.75} />
            <Text style={styles.settingLabel}>Notifications et autorisations</Text>
            <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
          </Pressable>

          <Text style={[styles.label, styles.section]}>Apparence</Text>
          <SegmentedControl options={THEMES} value={theme} onChange={setThemePreference} />

          <Text style={[styles.label, styles.section]}>Mises à jour</Text>
          <View style={styles.rows}>
            <Pressable onPress={() => checkForUpdate(true)} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
              <RefreshCw size={20} color={colors.text} strokeWidth={1.75} />
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Rechercher une mise à jour</Text>
                <Text style={styles.settingDetail}>
                  Version {appVersionName() ?? '?'} ({appVersionCode() ?? '?'}){updateStatus ? ` · ${updateStatus}` : ''}
                </Text>
              </View>
            </Pressable>
            <Pressable onPress={requestInstallPermission} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
              <ShieldCheck size={20} color={colors.text} strokeWidth={1.75} />
              <View style={styles.settingText}>
                <Text style={styles.settingLabel}>Installation des mises à jour</Text>
                <Text style={styles.settingDetail}>{canInstall ? 'Autorisée' : 'À autoriser dans les réglages'}</Text>
              </View>
              <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
            </Pressable>
            {__DEV__ && update.status === 'available' && (
              <Pressable onPress={() => previewUpdateScreen(true)} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
                <Download size={20} color={colors.text} strokeWidth={1.75} />
                <Text style={styles.settingLabel}>Voir l'écran de mise à jour (debug)</Text>
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
