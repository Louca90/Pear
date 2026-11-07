import { useEffect, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Ban, Bell, ChevronRight, Download, HardDrive, Languages, RefreshCw, ShieldCheck, Stethoscope } from 'lucide-react-native';

import { appVersionCode, appVersionName } from '../../modules/pear-native';

import { SegmentedControl } from '../components/SegmentedControl';
import { Header, Screen } from '../components/ui';
import { currentLanguage, languageChoice, LANGUAGES, t } from '../i18n';
import { LanguageSheet } from '../components/LanguageSheet';
import { createStyles, radius, setThemePreference, spacing, ThemePreference, useColors, useThemePreference } from '../theme';
import { checkForUpdate, getInstallPermission, previewUpdateScreen, requestInstallPermission, useUpdateState } from '../update/updates';

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'auto', label: t('profil.themeAuto') },
  { value: 'light', label: t('profil.themeClair') },
  { value: 'dark', label: t('profil.themeSombre') },
];

type Props = { onBack: () => void; onDiagnostic: () => void; onBlocked: () => void; onStorage: () => void; onReplayOnboarding: () => void };

// Les réglages de l'app, ouverts depuis le bouton en haut à droite du Profil.
export function SettingsScreen({ onBack, onDiagnostic, onBlocked, onStorage, onReplayOnboarding }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const theme = useThemePreference();
  const update = useUpdateState();
  const [canInstall, setCanInstall] = useState(getInstallPermission);
  const [languageOpen, setLanguageOpen] = useState(false);

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

  return (
    <Screen>
      <Header title={t('profil.parametres')} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.label}>{t('profil.apparence')}</Text>
        <SegmentedControl options={THEMES} value={theme} onChange={setThemePreference} />
        <Pressable onPress={() => setLanguageOpen(true)} style={({ pressed }) => [styles.setting, styles.languageRow, pressed && styles.pressed]}>
          <Languages size={20} color={colors.text} strokeWidth={1.75} />
          <View style={styles.settingText}>
            <Text style={styles.settingLabel}>{t('langue.titre')}</Text>
            <Text style={styles.settingDetail}>{languageChoice() === 'auto' ? t('langue.auto') : LANGUAGES.find(({ code }) => code === currentLanguage())?.name}</Text>
          </View>
          <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
        </Pressable>

        <Text style={[styles.label, styles.section]}>{t('reglages.notifications')}</Text>
        <View style={styles.rows}>
          <Pressable onPress={() => Linking.openSettings()} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
            <Bell size={20} color={colors.text} strokeWidth={1.75} />
            <Text style={styles.settingLabel}>{t('commun.notifications')}</Text>
            <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
          </Pressable>
          <Pressable onPress={onStorage} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
            <HardDrive size={20} color={colors.text} strokeWidth={1.75} />
            <Text style={styles.settingLabel}>{t('stockage.titre')}</Text>
            <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
          </Pressable>
          <Pressable onPress={onDiagnostic} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
            <Stethoscope size={20} color={colors.text} strokeWidth={1.75} />
            <Text style={styles.settingLabel}>{t('diag.ouvrir')}</Text>
            <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
          </Pressable>
        </View>

        <Text style={[styles.label, styles.section]}>{t('reglages.confidentialite')}</Text>
        <Pressable onPress={onBlocked} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
          <Ban size={20} color={colors.text} strokeWidth={1.75} />
          <Text style={styles.settingLabel}>{t('reglages.bloques')}</Text>
          <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
        </Pressable>

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
          {__DEV__ && (
            <Pressable onPress={onReplayOnboarding} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
              <RefreshCw size={20} color={colors.text} strokeWidth={1.75} />
              <Text style={styles.settingLabel}>{t('reglages.revoirPriseEnMain')}</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
      {languageOpen && <LanguageSheet onClose={() => setLanguageOpen(false)} />}
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  languageRow: {
    marginTop: spacing.md,
  },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
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
  rows: {
    gap: spacing.sm,
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
  pressed: {
    opacity: 0.6,
  },
}));
