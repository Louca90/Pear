import { ComponentRef, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { Bell, Camera, Check, Eye, FileDown, HardDrive, KeyRound, Lock, Moon, Pencil, RefreshCw, Settings, ShieldCheck } from 'lucide-react-native';
import { usePermissionsMissing } from '../onboarding/permissionStatus';

import { appVersionName, authenticate } from '../../modules/pear-native';
import { getSetting, setSetting } from '../chat/database';
import { Toggle } from '../components/Toggle';
import { chat, MAX_PROFILE_NAME_LENGTH } from '../chat/manager';
import { MediaPicker } from '../components/MediaPicker';
import { ProfilePhotoCropper } from '../components/ProfilePhotoCropper';
import { useBottomBarSpace } from '../components/BottomBar';
import { showDialog } from '../components/dialog';
import { SettingRow, SettingsGroup } from '../components/SettingsGroup';
import type { SettingsPage } from './settings/SettingsPages';
import { Avatar, Header, Screen, usePressFeedback } from '../components/ui';
import { haptics } from '../haptics';
import { DURATION, enterUp, timing } from '../motion';
import { createStyles, radius, spacing, useColors, useThemePreference } from '../theme';
import { t } from '../i18n';

const AVATAR = 72;
// Les blocs de la page arrivent l'un après l'autre à l'ouverture.
const STEP_MS = 40;

type Props = { onSettings: () => void; onStorage: () => void; onPage: (page: SettingsPage) => void };

// Le bouton rond à droite de la carte : un crayon, qui devient une coche pendant qu'on écrit le nom.
function EditButton({ editing, onPress }: { editing: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const feedback = usePressFeedback();
  const progress = useSharedValue(editing ? 1 : 0);
  useEffect(() => {
    progress.set(timing(editing ? 1 : 0, DURATION.small));
  }, [editing, progress]);
  const pencil = useAnimatedStyle(() => ({ opacity: 1 - progress.get(), transform: [{ rotate: `${-30 * progress.get()}deg` }] }));
  const check = useAnimatedStyle(() => ({ opacity: progress.get(), transform: [{ scale: 0.7 + 0.3 * progress.get() }] }));
  return (
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="button" accessibilityLabel={editing ? t('commun.enregistrer') : t('profil.modifierNom')} hitSlop={6}>
      <Reanimated.View style={[styles.edit, editing && styles.editOn, feedback.style]}>
        <Reanimated.View style={[StyleSheet.absoluteFill, styles.center, pencil]}>
          <Pencil size={18} color={colors.text} strokeWidth={1.8} />
        </Reanimated.View>
        <Reanimated.View style={[StyleSheet.absoluteFill, styles.center, check]}>
          <Check size={20} color={colors.onSignature} strokeWidth={2.2} />
        </Reanimated.View>
      </Reanimated.View>
    </Pressable>
  );
}

// L'onglet Profil : ma carte (photo et nom, tels que mes contacts les voient), puis les réglages
// les plus utiles, rangés par groupes. « Tous les réglages » ouvre le reste.
export function ProfileScreen({ onSettings, onStorage, onPage }: Props) {
  const permissionsMissing = usePermissionsMissing();
  const colors = useColors();
  const styles = useStyles();
  const barSpace = useBottomBarSpace();
  const theme = useThemePreference();
  const saved = chat.getMyProfile();
  const [name, setName] = useState(saved.name ?? '');
  const [photo, setPhoto] = useState(saved.photo);
  const [editingName, setEditingName] = useState(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [lockOn, setLockOn] = useState(() => getSetting('app_lock') === '1');
  // On vérifie que l'empreinte ou le code marche avant d'activer : sinon on s'enfermerait dehors.
  const changeLock = async (value: boolean) => {
    if (value) {
      const result = await authenticate(t('reglages.verrouTitre'));
      if (result === 'unavailable') return showDialog(t('reglages.verrou'), t('reglages.verrouIndisponible'));
      if (result !== 'ok') return;
    }
    setLockOn(value);
    setSetting('app_lock', value ? '1' : null);
  };

  // La galerie de Pear, une seule photo : elle passe par le recadrage en carré, puis est gardée tout de suite.
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [cropping, setCropping] = useState<string | null>(null);

  const save = async (nextName: string, nextPhoto: string | null) => {
    try {
      await chat.saveProfile(nextName.trim(), nextPhoto);
      setPhoto(chat.getMyProfile().photo);
    } catch (e) {
      showDialog(t('commun.enregistrementImpossible'), String(e));
    }
  };

  const toggleName = () => {
    if (!editingName) {
      setEditingName(true);
      setTimeout(() => input.current?.focus(), 50);
      return;
    }
    haptics.action();
    setEditingName(false);
    input.current?.blur();
    if (name.trim() !== (saved.name ?? '')) save(name, photo);
  };

  const choosePhoto = () => {
    if (!photo) return setGalleryOpen(true);
    showDialog(t('profil.choisirPhoto'), undefined, [
      { label: t('profil.choisirPhoto'), onPress: () => setGalleryOpen(true) },
      {
        label: t('profil.retirerPhoto'),
        style: 'danger',
        onPress: () => {
          setPhoto(null);
          save(name, null);
        },
      },
      { label: t('commun.annuler'), style: 'cancel' },
    ]);
  };

  const themeLabel = theme === 'light' ? t('profil.themeClair') : theme === 'dark' ? t('profil.themeSombre') : t('profil.themeAuto');

  return (
    <Screen>
      <Header title={t('profil.titre')} />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: barSpace + spacing.lg }]} keyboardShouldPersistTaps="handled">
          <Reanimated.View entering={enterUp(10, 260)} style={styles.card}>
            <Pressable onPress={choosePhoto} accessibilityRole="button" accessibilityLabel={t('profil.choisirPhoto')}>
              <Avatar uri={photo} size={AVATAR} />
              <View style={styles.photoBadge}>
                <Camera size={14} color={colors.background} strokeWidth={2.2} />
              </View>
            </Pressable>
            <View style={styles.flex}>
              {editingName ? (
                <TextInput
                  ref={input}
                  style={styles.nameInput}
                  value={name}
                  onChangeText={setName}
                  onSubmitEditing={toggleName}
                  placeholder={t('profil.commentPresenter')}
                  placeholderTextColor={colors.textMuted}
                  maxLength={MAX_PROFILE_NAME_LENGTH}
                  returnKeyType="done"
                />
              ) : (
                <Text style={styles.name} numberOfLines={1}>
                  {name || t('profil.commentPresenter')}
                </Text>
              )}
              <Text style={styles.visible}>{t('profil.visibleContacts')}</Text>
            </View>
            <EditButton editing={editingName} onPress={toggleName} />
          </Reanimated.View>

          <Reanimated.View entering={enterUp(10, 260, STEP_MS)} style={styles.secure} accessibilityRole="summary">
            <ShieldCheck size={22} color={colors.onSignature} strokeWidth={1.8} />
            <Text style={styles.secureText}>{t('profil.chiffre')}</Text>
          </Reanimated.View>

          <Reanimated.View entering={enterUp(10, 260, STEP_MS * 2)}>
            <SettingsGroup title={t('profil.groupeGeneral')}>
              <SettingRow icon={Moon} label={t('profil.apparence')} value={themeLabel} onPress={() => onPage('appearance')} />
              <SettingRow icon={Bell} label={t('commun.notifications')} onPress={() => onPage('notifications')} />
              <SettingRow icon={KeyRound} label={t('priseEnMain.pageTitre')} right={permissionsMissing ? <View style={styles.dot} /> : undefined} onPress={() => onPage('permissions')} />
              <SettingRow icon={HardDrive} label={t('stockage.titre')} onPress={onStorage} />
            </SettingsGroup>
          </Reanimated.View>

          <Reanimated.View entering={enterUp(10, 260, STEP_MS * 3)}>
            <SettingsGroup title={t('reglages.confidentialite')}>
              <SettingRow icon={Lock} label={t('reglages.verrou')} detail={lockOn ? t('reglages.verrouActif') : t('profil.desactive')} right={<Toggle value={lockOn} onChange={changeLock} label={t('reglages.verrou')} />} />
              <SettingRow icon={Eye} label={t('reglages.confidentialite')} detail={t('profil.confidentialiteAide')} onPress={() => onPage('privacy')} />
            </SettingsGroup>
          </Reanimated.View>

          <Reanimated.View entering={enterUp(10, 260, STEP_MS * 4)}>
            <SettingsGroup title="Pear">
              <SettingRow icon={FileDown} label={t('sauvegarde.chiffree')} onPress={() => onPage('backup')} />
              <SettingRow icon={RefreshCw} label={t('profil.misesAJour')} value={appVersionName() ?? ''} onPress={() => onPage('updates')} />
              <SettingRow icon={Settings} label={t('profil.tousReglages')} onPress={onSettings} />
            </SettingsGroup>
          </Reanimated.View>
        </ScrollView>
      </KeyboardAvoidingView>
      {galleryOpen && (
        <MediaPicker
          single
          onPick={([picked]) => {
            setGalleryOpen(false);
            if (picked) setCropping(picked.uri);
          }}
          onClose={() => setGalleryOpen(false)}
        />
      )}
      {cropping && (
        <ProfilePhotoCropper
          uri={cropping}
          onDone={(uri) => {
            setPhoto(uri);
            save(name, uri);
          }}
          onClose={() => setCropping(null)}
        />
      )}
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textMuted,
  },
  flex: {
    flex: 1,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: 18,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: 18,
    borderRadius: 22,
    backgroundColor: colors.surface,
  },
  photoBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 30,
    height: 30,
    borderRadius: radius.full,
    borderWidth: 3,
    borderColor: colors.surface,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
  },
  nameInput: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    padding: 0,
    borderBottomWidth: 1.5,
    borderBottomColor: colors.signatureStrong,
  },
  visible: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 3,
  },
  edit: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.elevated,
  },
  editOn: {
    backgroundColor: colors.signature,
  },
  secure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.signature,
  },
  secureText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    color: colors.onSignature,
  },
}));
