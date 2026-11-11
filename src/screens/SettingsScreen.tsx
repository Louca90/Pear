import { useEffect, useState } from 'react';
import { AppState, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { Ban, Bell, ChevronRight, Download, Eye, HardDrive, Languages, Link2, Lock, Sparkles, RefreshCw, Share2, ShieldCheck, Stethoscope, Volume2 } from 'lucide-react-native';
import { linkPreviewsEnabled, setLinkPreviewsEnabled } from '../chat/linkPreview';

import { getSetting, setSetting } from '../chat/database';
import { setSoundsEnabled, soundsEnabled } from './chat/sounds';
import { appVersionCode, appVersionName, authenticate } from '../../modules/pear-native';
import { showDialog } from '../components/dialog';

import { SegmentedControl } from '../components/SegmentedControl';
import { Header, Screen } from '../components/ui';
import { Toggle } from '../components/Toggle';
import { WhatsNew } from '../update/WhatsNew';
import { pagesFor } from '../update/pages';
import { currentLanguage, languageChoice, LANGUAGES, t } from '../i18n';
import { LanguageSheet } from '../components/LanguageSheet';
import { createStyles, radius, setTextScaleIndex, setThemePreference, spacing, TEXT_SCALES, ThemePreference, useColors, useTextScaleIndex, useThemePreference } from '../theme';
import { haptics } from '../haptics';
import { checkForUpdate, getInstallPermission, previewUpdateScreen, requestInstallPermission, useUpdateState } from '../update/updates';

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'auto', label: t('profil.themeAuto') },
  { value: 'light', label: t('profil.themeClair') },
  { value: 'dark', label: t('profil.themeSombre') },
];

type Props = { onBack: () => void; onDiagnostic: () => void; onBlocked: () => void; onStorage: () => void; onServers: () => void; onDiscover: () => void; onReplayOnboarding: () => void };

// Les réglages de l'app, ouverts depuis le bouton en haut à droite du Profil.
export function SettingsScreen({ onBack, onDiagnostic, onBlocked, onStorage, onServers, onDiscover, onReplayOnboarding }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const currentPages = pagesFor(appVersionName() ?? '');
  const theme = useThemePreference();
  const textSize = useTextScaleIndex();
  const update = useUpdateState();
  const [canInstall, setCanInstall] = useState(getInstallPermission);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [relay, setRelay] = useState(() => getSetting('relay_enabled') !== '0');
  const [linkPreviews, setLinkPreviews] = useState(linkPreviewsEnabled);
  const [sounds, setSounds] = useState(soundsEnabled);

  const [lock, setLock] = useState(() => getSetting('app_lock') === '1');
  // On vérifie que l'empreinte ou le code marche avant d'activer : sinon on s'enfermerait dehors.
  const changeLock = async (value: boolean) => {
    if (value) {
      const result = await authenticate(t('reglages.verrouTitre'));
      if (result === 'unavailable') return showDialog(t('reglages.verrou'), t('reglages.verrouIndisponible'));
      if (result !== 'ok') return;
    }
    setLock(value);
    setSetting('app_lock', value ? '1' : null);
  };

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

        <Text style={[styles.label, styles.section]}>{t('reglages.tailleTexte')}</Text>
        <SegmentedControl
          options={TEXT_SCALES.map((_, i) => ({ value: String(i), label: 'A'.repeat(1) + ['', '+', '++', '+++'][i] }))}
          value={String(textSize)}
          onChange={(value) => {
            haptics.select();
            setTextScaleIndex(Number(value));
          }}
        />
        <Text style={[styles.settingDetail, styles.sizeSample]}>{t('reglages.tailleTexteAide')}</Text>

        <Text style={[styles.label, styles.section]}>{t('reglages.notifications')}</Text>
        <View style={styles.rows}>
          <Pressable onPress={() => Linking.openSettings()} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
            <Bell size={20} color={colors.text} strokeWidth={1.75} />
            <Text style={styles.settingLabel}>{t('commun.notifications')}</Text>
            <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
          </Pressable>
          <View style={styles.setting}>
            <Volume2 size={20} color={colors.text} strokeWidth={1.75} />
            <View style={styles.settingText}>
              <Text style={styles.settingLabel}>{t('reglages.sons')}</Text>
              <Text style={styles.settingDetail}>{t('reglages.sonsAide')}</Text>
            </View>
            <Toggle
              value={sounds}
              label={t('reglages.sons')}
              onChange={(value) => {
                setSounds(value);
                setSoundsEnabled(value);
              }}
            />
          </View>
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
        <View style={[styles.setting, styles.relayRow]}>
          <Share2 size={20} color={colors.text} strokeWidth={1.75} />
          <View style={styles.settingText}>
            <Text style={styles.settingLabel}>{t('reglages.relais')}</Text>
            <Text style={styles.settingDetail}>{t('reglages.relaisAide')}</Text>
          </View>
          <Toggle
            value={relay}
            label={t('reglages.relais')}
            onChange={(value) => {
              setRelay(value);
              setSetting('relay_enabled', value ? null : '0');
            }}
          />
        </View>
        <View style={[styles.setting, styles.relayRow]}>
          <Link2 size={20} color={colors.text} strokeWidth={1.75} />
          <View style={styles.settingText}>
            <Text style={styles.settingLabel}>{t('reglages.apercuLiens')}</Text>
            <Text style={styles.settingDetail}>{t('reglages.apercuLiensAide')}</Text>
          </View>
          <Toggle
            value={linkPreviews}
            label={t('reglages.apercuLiens')}
            onChange={(value) => {
              setLinkPreviews(value);
              setLinkPreviewsEnabled(value);
            }}
          />
        </View>
        <View style={[styles.setting, styles.relayRow]}>
          <Lock size={20} color={colors.text} strokeWidth={1.75} />
          <View style={styles.settingText}>
            <Text style={styles.settingLabel}>{t('reglages.verrou')}</Text>
            <Text style={styles.settingDetail}>{t('reglages.verrouAide')}</Text>
          </View>
          <Toggle value={lock} onChange={changeLock} label={t('reglages.verrou')} />
        </View>
        <Pressable onPress={onServers} style={({ pressed }) => [styles.setting, styles.relayRow, pressed && styles.pressed]}>
          <Eye size={20} color={colors.text} strokeWidth={1.75} />
          <View style={styles.settingText}>
            <Text style={styles.settingLabel}>{t('reglages.serveurs')}</Text>
            <Text style={styles.settingDetail}>{t('reglages.serveursAide')}</Text>
          </View>
          <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
        </Pressable>
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
          {currentPages.length > 0 && (
            <Pressable onPress={() => setWhatsNewOpen(true)} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
              <Sparkles size={20} color={colors.text} strokeWidth={1.75} />
              <Text style={styles.settingLabel}>{t('nouveautes.version', { version: appVersionName() ?? '?' })}</Text>
            </Pressable>
          )}
          <Pressable onPress={onDiscover} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
            <Sparkles size={20} color={colors.text} strokeWidth={1.75} />
            <Text style={styles.settingLabel}>{t('nouveautes.decouvrir')}</Text>
            <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
          </Pressable>
          {__DEV__ && (
            <Pressable onPress={onReplayOnboarding} style={({ pressed }) => [styles.setting, pressed && styles.pressed]}>
              <RefreshCw size={20} color={colors.text} strokeWidth={1.75} />
              <Text style={styles.settingLabel}>{t('reglages.revoirPriseEnMain')}</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
      {whatsNewOpen && <WhatsNew pages={currentPages} onClose={() => setWhatsNewOpen(false)} />}
      {languageOpen && <LanguageSheet onClose={() => setLanguageOpen(false)} />}
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  relayRow: {
    marginBottom: spacing.sm,
  },
  sizeSample: {
    marginTop: spacing.sm,
  },
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
