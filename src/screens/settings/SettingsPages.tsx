import { ReactNode, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { BatteryCharging, Bell, Ban, Camera, Download, Eye, FlaskConical, FileDown, FileText, FileUp, ImageIcon, Languages, PhoneIncoming, Link2, LucideIcon, MapPin, RefreshCw, Share2, ShieldCheck, Sparkles, Stethoscope } from 'lucide-react-native';

import { appVersionCode, appVersionName, authenticate } from '../../../modules/pear-native';
import { getBlockedKeys, getSetting, setSetting } from '../../chat/database';
import { linkPreviewsEnabled, setLinkPreviewsEnabled } from '../../chat/linkPreview';
import { BackupSheet } from '../../components/BackupSheet';
import { showDialog } from '../../components/dialog';
import { LanguageSheet } from '../../components/LanguageSheet';
import { Pear } from '../../components/Pear';
import { LockIcon } from '../../components/AnimatedIcons';
import { SegmentedControl } from '../../components/SegmentedControl';
import { SettingRow, SettingsGroup } from '../../components/SettingsGroup';
import { Toggle } from '../../components/Toggle';
import { Header, Screen, usePressFeedback } from '../../components/ui';
import { haptics } from '../../haptics';
import { currentLanguage, languageChoice, LANGUAGES, t } from '../../i18n';
import { enterUp, timing } from '../../motion';
import { checkPermission, checkPermissions, ONBOARDING_PERMISSIONS, PermissionId, PERMISSIONS, PermissionState, requestPermission } from '../../onboarding/permissions';
import { PermissionCard } from '../../onboarding/PermissionCard';
import { setPermissionsMissing } from '../../onboarding/permissionStatus';
import { createStyles, radius, setTextScaleIndex, setThemePreference, spacing, TEXT_SCALES, ThemePreference, useColors, useTextScaleIndex, useThemePreference } from '../../theme';
import { pagesFor } from '../../update/pages';
import { acceptTestUpdate, checkForUpdate, getInstallPermission, isTestBuild, requestInstallPermission, setTesterEnabled, testerEnabled, useUpdateState } from '../../update/updates';
import { WhatsNew } from '../../update/WhatsNew';

export type SettingsPage = 'permissions' | 'appearance' | 'notifications' | 'privacy' | 'backup' | 'updates';

// Les blocs d'une page arrivent l'un après l'autre (fondu et 10 points de montée).
const STEP_MS = 40;

function Page({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  const styles = useStyles();
  return (
    <Screen>
      <Header title={title} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
    </Screen>
  );
}

function Block({ index, children }: { index: number; children: ReactNode }) {
  return <Reanimated.View entering={enterUp(10, 260, index * STEP_MS)}>{children}</Reanimated.View>;
}

// Une permission d'Android relue au retour dans l'app (on la donne dans ses réglages).
function usePermission(id: 'notifications' | 'battery') {
  const [state, setState] = useState<PermissionState | null>(null);
  const refresh = useCallback(() => {
    checkPermission(id).then(setState).catch(() => setState(null));
  }, [id]);
  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (next) => next === 'active' && refresh());
    return () => subscription.remove();
  }, [refresh]);
  return { state, ask: () => state && requestPermission(id, state).then(setState).catch(() => undefined) };
}

// --- Apparence ---

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: 'auto', label: t('profil.themeAuto') },
  { value: 'light', label: t('profil.themeClair') },
  { value: 'dark', label: t('profil.themeSombre') },
];

// La taille du texte : quatre crans sur une piste ; le cran choisi est un rond clair, la piste se remplit.
function TextSizeSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const last = TEXT_SCALES.length - 1;
  const at = useSharedValue(value);
  useEffect(() => {
    at.set(timing(value, 260));
  }, [value, at]);
  const fill = useAnimatedStyle(() => ({ width: (at.get() / last) * width }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: (at.get() / last) * width - 11 }] }));
  return (
    <View style={styles.sliderRow}>
      <Text style={styles.sliderSmall}>A</Text>
      <View style={styles.slider} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        <View style={styles.track} />
        <Reanimated.View style={[styles.trackFill, fill]} />
        {TEXT_SCALES.map((_, index) => (
          <Pressable
            key={index}
            onPress={() => {
              haptics.select();
              onChange(index);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`${t('reglages.tailleTexte')} ${index + 1}`}
            accessibilityState={{ selected: index === value }}
            style={[styles.notch, { left: (index / last) * width - 4 }]}
          />
        ))}
        <Reanimated.View pointerEvents="none" style={[styles.knob, knob]} />
      </View>
      <Text style={styles.sliderBig}>A</Text>
    </View>
  );
}

export function AppearancePage({ onBack }: { onBack: () => void }) {
  const styles = useStyles();
  const theme = useThemePreference();
  const textSize = useTextScaleIndex();
  const [languageOpen, setLanguageOpen] = useState(false);
  return (
    <Page title={t('profil.apparence')} onBack={onBack}>
      <Block index={0}>
        <View style={styles.preview} accessibilityLabel={t('perso.apercu')}>
          <View style={[styles.bubble, styles.theirs]}>
            <Text style={styles.theirsText}>{t('reglages.apercuQuestion')}</Text>
          </View>
          <View style={[styles.bubble, styles.mine]}>
            <Text style={styles.mineText}>{t('reglages.apercuReponse')}</Text>
          </View>
        </View>
      </Block>
      <Block index={1}>
        <SettingsGroup title={t('reglages.theme')} before={<SegmentedControl options={THEMES} value={theme} onChange={setThemePreference} />} />
        <Text style={styles.note}>{t('reglages.themeAide')}</Text>
      </Block>
      <Block index={2}>
        <SettingsGroup title={t('reglages.tailleTexte')} before={<TextSizeSlider value={textSize} onChange={setTextScaleIndex} />} />
      </Block>
      <Block index={3}>
        <SettingsGroup title={t('langue.titre')}>
          <SettingRow
            icon={Languages}
            label={t('langue.titre')}
            value={languageChoice() === 'auto' ? t('langue.auto') : LANGUAGES.find(({ code }) => code === currentLanguage())?.name}
            onPress={() => setLanguageOpen(true)}
          />
        </SettingsGroup>
      </Block>
      {languageOpen && <LanguageSheet onClose={() => setLanguageOpen(false)} />}
    </Page>
  );
}

// --- Notifications ---

export function NotificationsPage({ onBack }: { onBack: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const notifications = usePermission('notifications');
  const battery = usePermission('battery');
  const allowed = notifications.state === 'granted';
  return (
    <Page title={t('commun.notifications')} onBack={onBack}>
      <Block index={0}>
        <Pressable onPress={allowed ? undefined : notifications.ask} disabled={allowed} accessibilityRole="button" style={[styles.banner, !allowed && styles.bannerWarn]}>
          <View style={styles.bannerIcon}>
            <Bell size={22} color={allowed ? colors.onSignature : colors.text} strokeWidth={1.8} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.bannerTitle, !allowed && styles.bannerTitleWarn]}>{allowed ? t('reglages.notifAutorisees') : t('reglages.notifBloquees')}</Text>
            <Text style={[styles.bannerText, !allowed && styles.bannerTextWarn]}>{allowed ? t('reglages.notifAutoriseesAide') : t('reglages.notifBloqueesAide')}</Text>
          </View>
        </Pressable>
      </Block>
      <Block index={1}>
        <SettingsGroup title="Android">
          <SettingRow icon={Bell} label={t('reglages.notifAndroid')} detail={t('reglages.notifAndroidAide')} onPress={() => Linking.openSettings()} />
          <SettingRow
            icon={BatteryCharging}
            label={t('reglages.batterie')}
            detail={battery.state === 'granted' ? t('reglages.batterieOk') : t('reglages.batterieAFaire')}
            onPress={battery.ask}
          />
        </SettingsGroup>
      </Block>
      <Block index={2}>
        <Text style={styles.note}>{t('reglages.notifParContact')}</Text>
      </Block>
    </Page>
  );
}

// --- Confidentialité ---

// La carte du verrou : en couleur signature quand il est actif.
function LockCard({ on, onChange }: { on: boolean; onChange: (value: boolean) => void }) {
  const colors = useColors();
  const styles = useStyles();
  const lit = useSharedValue(on ? 1 : 0);
  // Le voyant du cadenas s'allume chaque fois que le verrou est activé.
  const [lights, setLights] = useState(0);
  useEffect(() => {
    lit.set(timing(on ? 1 : 0, 260));
    if (on) setLights((count) => count + 1);
  }, [on, lit]);
  const back = useAnimatedStyle(() => ({ opacity: lit.get() }));
  return (
    <View style={styles.lockCard}>
      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.lockLit, back]} />
      <View style={styles.bannerIcon}>
        <LockIcon size={22} color={on ? colors.onSignature : colors.text} strokeWidth={1.8} play={lights} />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.lockTitle, on && { color: colors.onSignature }]}>{t('reglages.verrou')}</Text>
        <Text style={[styles.lockText, on && { color: colors.onSignature }]}>{on ? t('reglages.verrouActif') : t('profil.desactive')}</Text>
      </View>
      <Toggle value={on} onChange={onChange} label={t('reglages.verrou')} />
    </View>
  );
}

export function PrivacyPage({ onBack, onServers, onBlocked }: { onBack: () => void; onServers: () => void; onBlocked: () => void }) {
  const [lock, setLock] = useState(() => getSetting('app_lock') === '1');
  const [relay, setRelay] = useState(() => getSetting('relay_enabled') !== '0');
  const [linkPreviews, setLinkPreviews] = useState(linkPreviewsEnabled);
  const blocked = getBlockedKeys().length;
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
  return (
    <Page title={t('reglages.confidentialite')} onBack={onBack}>
      <Block index={0}>
        <LockCard on={lock} onChange={changeLock} />
      </Block>
      <Block index={1}>
        <SettingsGroup title={t('reglages.reseau')}>
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
        </SettingsGroup>
      </Block>
      <Block index={2}>
        <SettingsGroup title={t('reglages.transparence')}>
          <SettingRow icon={Eye} label={t('reglages.serveurs')} onPress={onServers} />
          <SettingRow icon={Ban} label={t('reglages.bloques')} value={blocked > 0 ? String(blocked) : null} onPress={onBlocked} />
        </SettingsGroup>
      </Block>
    </Page>
  );
}

// --- Sauvegarde ---

function BigButton({ icon: Icon, label, primary, onPress }: { icon: typeof FileDown; label: string; primary?: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const feedback = usePressFeedback();
  return (
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="button" accessibilityLabel={label}>
      <Reanimated.View style={[styles.bigButton, primary && styles.bigButtonPrimary, feedback.style]}>
        <Icon size={20} color={primary ? colors.onSignature : colors.text} strokeWidth={1.9} />
        <Text style={[styles.bigButtonLabel, primary && { color: colors.onSignature }]}>{label}</Text>
      </Reanimated.View>
    </Pressable>
  );
}

export function BackupPage({ onBack }: { onBack: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const [backup, setBackup] = useState<'export' | 'import' | null>(null);
  const [last, setLast] = useState(() => getSetting('last_backup'));
  const lastLabel = last ? new Date(Number(last)).toLocaleDateString(currentLanguage(), { day: 'numeric', month: 'long', year: 'numeric' }) : t('sauvegarde.jamais');
  return (
    <Page title={t('sauvegarde.chiffree')} onBack={onBack}>
      <Block index={0}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <ShieldCheck size={30} color={colors.onSignature} strokeWidth={1.7} />
          </View>
          <Text style={styles.heroTitle}>{t('sauvegarde.heroTitre')}</Text>
          <Text style={styles.heroText}>{t('sauvegarde.heroAide')}</Text>
          <Text style={styles.heroMeta}>{t('sauvegarde.derniere', { quand: lastLabel })}</Text>
        </View>
      </Block>
      <Block index={1}>
        <View style={styles.buttons}>
          <BigButton icon={FileDown} label={t('sauvegarde.creer')} primary onPress={() => setBackup('export')} />
          <BigButton icon={FileUp} label={t('sauvegarde.restaurer')} onPress={() => setBackup('import')} />
        </View>
      </Block>
      <Block index={2}>
        <View style={styles.steps}>
          {[t('sauvegarde.etape1'), t('sauvegarde.etape2'), t('sauvegarde.etape3')].map((text, index) => (
            <View key={index} style={styles.step}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{index + 1}</Text>
              </View>
              <Text style={styles.stepText}>{text}</Text>
            </View>
          ))}
        </View>
      </Block>
      {backup && (
        <BackupSheet
          mode={backup}
          onClose={() => {
            setBackup(null);
            setLast(getSetting('last_backup'));
          }}
        />
      )}
    </Page>
  );
}

// --- Mises à jour ---

export function UpdatesPage({ onBack, onDiscover, onDiagnostic }: { onBack: () => void; onDiscover: () => void; onDiagnostic: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const update = useUpdateState();
  const [canInstall, setCanInstall] = useState(getInstallPermission);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [tester, setTester] = useState(testerEnabled);
  const testBuild = isTestBuild();
  const version = appVersionName() ?? '?';
  const pages = pagesFor(appVersionName() ?? '');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => next === 'active' && setCanInstall(getInstallPermission()));
    return () => subscription.remove();
  }, []);
  const checking = update.status === 'checking';
  const status =
    update.status === 'checking'
      ? t('profil.recherche')
      : update.status === 'available'
        ? t('profil.versionDispo', { version: update.release?.version ?? '' })
        : update.status === 'offline'
          ? t('profil.githubInjoignable')
          : t('profil.aJour');
  const good = update.status !== 'offline' && !checking;
  return (
    <Page title={t('profil.misesAJour')} onBack={onBack}>
      <Block index={0}>
        <View style={styles.hero}>
          <Pear height={60} color={colors.text} />
          <Text style={styles.versionTitle}>{`Pear ${version}`}</Text>
          <View style={styles.statusRow} accessibilityLiveRegion="polite">
            {checking ? <ActivityIndicator size="small" color={colors.signatureStrong} /> : null}
            <Text style={[styles.status, good && { color: colors.signatureStrong }]}>{status}</Text>
          </View>
          <Pressable onPress={() => checkForUpdate(true)} accessibilityRole="button" style={({ pressed }) => [styles.check, pressed && styles.pressed]}>
            <Text style={styles.checkLabel}>{t('profil.rechercherMaj')}</Text>
          </Pressable>
          <Text style={styles.heroMeta}>{`${t('commun.version')} ${version} (${appVersionCode() ?? '?'})${testBuild ? ` · ${t('profil.versionTest')}` : ''}`}</Text>
        </View>
      </Block>
      <Block index={1}>
        <SettingsGroup title={t('reglages.versions')}>
          <SettingRow
            icon={FlaskConical}
            label={t('profil.testeur')}
            detail={t('profil.testeurAide')}
            right={
              <Toggle
                value={tester}
                label={t('profil.testeur')}
                onChange={(value) => {
                  setTester(value);
                  setTesterEnabled(value);
                }}
              />
            }
          />
          {update.status === 'available' && update.release?.prerelease && !update.testAccepted && (
            <SettingRow icon={Download} label={t('profil.installerTest', { version: update.release.version })} detail={t('profil.versionTestAide')} onPress={acceptTestUpdate} />
          )}
          <SettingRow icon={Download} label={t('profil.installationMaj')} detail={canInstall ? t('profil.autorisee') : t('profil.aAutoriser')} onPress={requestInstallPermission} />
          {pages.length > 0 && <SettingRow icon={Sparkles} label={t('nouveautes.version', { version })} onPress={() => setWhatsNewOpen(true)} />}
          <SettingRow icon={RefreshCw} label={t('nouveautes.decouvrir')} onPress={onDiscover} />
          <SettingRow icon={Stethoscope} label={t('diag.ouvrir')} onPress={onDiagnostic} />
          {/* Ce que demande la licence Apache 2.0 des bibliothèques libres embarquées. */}
          <SettingRow
            icon={FileText}
            label={t('licences.titre')}
            onPress={() =>
              showDialog(t('licences.titre'), t('licences.texte'), [
                { label: t('licences.lire'), onPress: () => Linking.openURL('https://www.apache.org/licenses/LICENSE-2.0') },
                { label: 'OK', style: 'cancel' },
              ])
            }
          />
        </SettingsGroup>
      </Block>
      <Block index={2}>
        <Text style={styles.note}>{t('reglages.majSignees')}</Text>
      </Block>
      {whatsNewOpen && <WhatsNew pages={pages} onClose={() => setWhatsNewOpen(false)} />}
    </Page>
  );
}

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    gap: 20,
  },
  permissionList: {
    gap: 10,
  },
  note: {
    marginTop: spacing.sm,
    marginHorizontal: 4,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  // Apparence
  preview: {
    height: 150,
    borderRadius: 22,
    padding: spacing.md,
    justifyContent: 'flex-end',
    gap: 6,
    backgroundColor: colors.surface,
  },
  bubble: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    maxWidth: '80%',
  },
  theirs: {
    alignSelf: 'flex-start',
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    backgroundColor: colors.elevated,
  },
  mine: {
    alignSelf: 'flex-end',
    borderRadius: 18,
    borderBottomRightRadius: 6,
    backgroundColor: colors.text,
  },
  theirsText: {
    fontSize: 15,
    color: colors.text,
  },
  mineText: {
    fontSize: 15,
    color: colors.background,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: spacing.md,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  sliderSmall: {
    fontSize: 13,
    color: colors.textMuted,
  },
  sliderBig: {
    fontSize: 20,
    color: colors.text,
  },
  slider: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
  },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.signatureStrong,
  },
  notch: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textMuted,
  },
  knob: {
    position: 'absolute',
    left: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.text,
    boxShadow: `0px 2px 8px ${colors.shadow}`,
  },
  // Notifications et confidentialité
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: spacing.md,
    borderRadius: 22,
    backgroundColor: colors.signature,
  },
  bannerWarn: {
    backgroundColor: colors.surface,
  },
  bannerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.onSignature,
  },
  bannerTitleWarn: {
    color: colors.text,
  },
  bannerText: {
    fontSize: 13,
    marginTop: 2,
    color: colors.onSignature,
    opacity: 0.8,
  },
  bannerTextWarn: {
    color: colors.textMuted,
    opacity: 1,
  },
  lockCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: spacing.md,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  lockLit: {
    backgroundColor: colors.signature,
  },
  lockTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  lockText: {
    fontSize: 13,
    marginTop: 2,
    color: colors.textMuted,
  },
  // Sauvegarde et mises à jour
  hero: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 26,
    paddingHorizontal: 18,
    borderRadius: 24,
    backgroundColor: colors.surface,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: colors.signature,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
    color: colors.text,
  },
  heroText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    color: colors.textMuted,
  },
  heroMeta: {
    fontSize: 12,
    color: colors.textMuted,
  },
  buttons: {
    gap: 10,
  },
  bigButton: {
    height: 54,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.surface,
  },
  bigButtonPrimary: {
    backgroundColor: colors.signature,
  },
  bigButtonLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  steps: {
    gap: 10,
    paddingHorizontal: 4,
  },
  step: {
    flexDirection: 'row',
    gap: 10,
  },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  stepText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
  versionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  status: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
  check: {
    marginTop: 6,
    height: 46,
    paddingHorizontal: 20,
    borderRadius: radius.full,
    backgroundColor: colors.text,
    justifyContent: 'center',
  },
  checkLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.background,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
}));

// --- Autorisations ---

const PERMISSION_ICONS: Record<PermissionId, LucideIcon> = {
  notifications: Bell,
  battery: BatteryCharging,
  camera: Camera,
  media: ImageIcon,
  location: MapPin,
  install: Download,
  fullScreen: PhoneIncoming,
};
const PERMISSION_LIST: PermissionId[] = [...ONBOARDING_PERMISSIONS, 'install', 'fullScreen'];

// L'état de chaque autorisation, relu au retour des réglages d'Android. Rien n'est imposé : chacune
// s'active ici, quand on veut.
export function PermissionsPage({ onBack }: { onBack: () => void }) {
  const styles = useStyles();
  const [states, setStates] = useState<Partial<Record<PermissionId, PermissionState>> | null>(null);
  const lastInvite = Number(getSetting('last_call_invite') ?? 0);
  const refresh = useCallback(() => {
    checkPermissions(PERMISSION_LIST)
      .then((next) => {
        setStates(next);
        setPermissionsMissing(PERMISSIONS.some((id) => next[id] !== 'granted'));
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener('change', (next) => next === 'active' && refresh());
    return () => subscription.remove();
  }, [refresh]);
  const ask = (id: PermissionId) => {
    if (!states) return;
    requestPermission(id, states[id] ?? 'missing')
      .then((next) => {
        setStates((current) => ({ ...current, [id]: next }));
        refresh();
      })
      .catch(() => undefined);
  };
  return (
    <Page title={t('priseEnMain.pageTitre')} onBack={onBack}>
      <Block index={0}>
        <Text style={styles.note}>{t('priseEnMain.pageAide')}</Text>
      </Block>
      <View style={styles.permissionList}>
        {states &&
          PERMISSION_LIST.map((id, index) => (
            <PermissionCard
              key={id}
              index={index}
              icon={PERMISSION_ICONS[id]}
              title={t(`priseEnMain.${id}`)}
              why={t(`priseEnMain.${id}Aide`)}
              state={states[id] ?? 'missing'}
              onPress={() => ask(id)}
            />
          ))}
      </View>
      {lastInvite && (
        <Block index={1}>
          <Text style={styles.note}>{t('priseEnMain.dernierAppel', { date: new Date(lastInvite).toLocaleString() })}</Text>
        </Block>
      )}
      {states && states.notifications !== 'granted' && (
        <Block index={1}>
          <Text style={styles.note}>{t('priseEnMain.sansNotifications')}</Text>
        </Block>
      )}
    </Page>
  );
}
