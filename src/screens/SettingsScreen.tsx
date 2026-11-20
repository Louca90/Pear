import { useEffect, useState } from 'react';
import { AppState, Linking, ScrollView, Text } from 'react-native';
import { Ban, Bell, Download, Eye, HardDrive, Languages, Link2, Lock, Sparkles, RefreshCw, Share2, ShieldCheck, Stethoscope } from 'lucide-react-native';
import { linkPreviewsEnabled, setLinkPreviewsEnabled } from '../chat/linkPreview';

import { getSetting, setSetting } from '../chat/database';
import { appVersionCode, appVersionName, authenticate } from '../../modules/pear-native';
import { showDialog } from '../components/dialog';

import { SegmentedControl } from '../components/SegmentedControl';
import { SettingRow, SettingsGroup } from '../components/SettingsGroup';
import { Header, Screen } from '../components/ui';
import { Toggle } from '../components/Toggle';
import { WhatsNew } from '../update/WhatsNew';
import { pagesFor } from '../update/pages';
import { currentLanguage, languageChoice, LANGUAGES, t } from '../i18n';
import { LanguageSheet } from '../components/LanguageSheet';
import { createStyles, setTextScaleIndex, setThemePreference, spacing, TEXT_SCALES, ThemePreference, useTextScaleIndex, useThemePreference } from '../theme';
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
        <SettingsGroup title={t('profil.apparence')} before={<SegmentedControl options={THEMES} value={theme} onChange={setThemePreference} />}>
          <SettingRow
            icon={Languages}
            label={t('langue.titre')}
            value={languageChoice() === 'auto' ? t('langue.auto') : LANGUAGES.find(({ code }) => code === currentLanguage())?.name}
            onPress={() => setLanguageOpen(true)}
          />
        </SettingsGroup>

        <SettingsGroup
          title={t('reglages.tailleTexte')}
          before={
            <>
              <SegmentedControl
                options={TEXT_SCALES.map((_, i) => ({ value: String(i), label: 'A' + ['', '+', '++', '+++'][i] }))}
                value={String(textSize)}
                onChange={(value) => {
                  haptics.select();
                  setTextScaleIndex(Number(value));
                }}
              />
              <Text style={styles.sizeSample}>{t('reglages.tailleTexteAide')}</Text>
            </>
          }
        />

        <SettingsGroup title={t('reglages.notifications')}>
          <SettingRow icon={Bell} label={t('commun.notifications')} onPress={() => Linking.openSettings()} />
          <SettingRow icon={HardDrive} label={t('stockage.titre')} onPress={onStorage} />
          <SettingRow icon={Stethoscope} label={t('diag.ouvrir')} onPress={onDiagnostic} />
        </SettingsGroup>

        <SettingsGroup title={t('reglages.confidentialite')}>
          <SettingRow
            icon={Share2}
            label={t('reglages.relais')}
            detail={t('reglages.relaisAide')}
            right={
              <Toggle
                value={relay}
                label={t('reglages.relais')}
                onChange={(value) => {
                  setRelay(value);
                  setSetting('relay_enabled', value ? null : '0');
                }}
              />
            }
          />
          <SettingRow
            icon={Link2}
            label={t('reglages.apercuLiens')}
            detail={t('reglages.apercuLiensAide')}
            right={
              <Toggle
                value={linkPreviews}
                label={t('reglages.apercuLiens')}
                onChange={(value) => {
                  setLinkPreviews(value);
                  setLinkPreviewsEnabled(value);
                }}
              />
            }
          />
          <SettingRow icon={Lock} label={t('reglages.verrou')} detail={t('reglages.verrouAide')} right={<Toggle value={lock} onChange={changeLock} label={t('reglages.verrou')} />} />
          <SettingRow icon={Eye} label={t('reglages.serveurs')} detail={t('reglages.serveursAide')} onPress={onServers} />
          <SettingRow icon={Ban} label={t('reglages.bloques')} onPress={onBlocked} />
        </SettingsGroup>

        <SettingsGroup title={t('profil.misesAJour')}>
          <SettingRow
            icon={RefreshCw}
            label={t('profil.rechercherMaj')}
            detail={`${t('commun.version')} ${appVersionName() ?? '?'} (${appVersionCode() ?? '?'})${updateStatus ? ` · ${updateStatus}` : ''}`}
            onPress={() => checkForUpdate(true)}
            chevron={false}
          />
          <SettingRow icon={ShieldCheck} label={t('profil.installationMaj')} detail={canInstall ? t('profil.autorisee') : t('profil.aAutoriser')} onPress={requestInstallPermission} />
          {__DEV__ && update.status === 'available' && <SettingRow icon={Download} label={t('profil.apercuMaj')} onPress={() => previewUpdateScreen(true)} chevron={false} />}
          {currentPages.length > 0 && <SettingRow icon={Sparkles} label={t('nouveautes.version', { version: appVersionName() ?? '?' })} onPress={() => setWhatsNewOpen(true)} chevron={false} />}
          <SettingRow icon={Sparkles} label={t('nouveautes.decouvrir')} onPress={onDiscover} />
          {__DEV__ && <SettingRow icon={RefreshCw} label={t('reglages.revoirPriseEnMain')} onPress={onReplayOnboarding} chevron={false} />}
        </SettingsGroup>
      </ScrollView>
      {whatsNewOpen && <WhatsNew pages={currentPages} onClose={() => setWhatsNewOpen(false)} />}
      {languageOpen && <LanguageSheet onClose={() => setLanguageOpen(false)} />}
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  content: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    gap: 22,
  },
  sizeSample: {
    marginHorizontal: 4,
    fontSize: 13,
    color: colors.textMuted,
  },
}));