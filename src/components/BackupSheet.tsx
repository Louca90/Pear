import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Archive, FileDown, FileUp, LucideIcon, ShieldAlert, User } from 'lucide-react-native';

import { reloadApp } from '../../modules/pear-native';
import { setSetting } from '../chat/database';
import { exportBackup, importBackup, inspectBackup } from '../backup/backup';
import { BackupError, BackupKind } from '../backup/format';
import { t } from '../i18n';
import { log } from '../log';
import { enterUp, timing } from '../motion';
import { createStyles, radius, useColors } from '../theme';
import { showDialog } from './dialog';
import { Sheet, SheetChoice } from './Sheet';
import { Toggle } from './Toggle';

const PASSWORD_MIN = 8;

type Step = 'choose' | 'password' | 'working' | 'done';

function errorText(e: unknown) {
  if (e instanceof BackupError) return e.reason === 'password' ? t('sauvegarde.motDePasseFaux') : e.reason === 'format' ? t('sauvegarde.pasUneSauvegarde') : t('sauvegarde.abimee');
  return String(e);
}

// Exporter (profil seul ou sauvegarde complète) ou charger un fichier de sauvegarde, protégé par un mot de
// passe (feuille du bas commune). Elle remonte au-dessus du clavier et ne se ferme pas pendant le travail.
export function BackupSheet({ mode, onClose }: { mode: 'export' | 'import'; onClose: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const bar = useSharedValue(0);
  const [step, setStep] = useState<Step>(mode === 'export' ? 'choose' : 'password');
  const [kind, setKind] = useState<BackupKind>('profile');
  const [media, setMedia] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  const onProgress = (done: number, total: number) => bar.set(timing(total > 0 ? Math.min(1, done / total) : 0, 200));
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: bar.get() }] }));

  // Import : le fichier d'abord, pour savoir ce qu'il contient avant de demander le mot de passe.
  const pick = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: '*/*' });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    try {
      const header = await inspectBackup(asset.uri);
      setFile(asset.uri);
      setKind(header.kind);
    } catch (e) {
      showDialog(t('sauvegarde.charger'), errorText(e));
    }
  };

  useEffect(() => {
    if (mode === 'import') pick();
    // Une seule fois, à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const share = (uri: string) => Sharing.shareAsync(uri, { mimeType: 'application/octet-stream', dialogTitle: t('sauvegarde.partager') }).catch((e) => log.warn('partage de la sauvegarde', e));

  const runExport = async () => {
    setStep('working');
    bar.set(0);
    try {
      const uri = await exportBackup(kind, password, media, onProgress);
      setExported(uri);
      // Pour la page Sauvegarde : « Dernière sauvegarde : … ».
      setSetting('last_backup', String(Date.now()));
      setStep('done');
      share(uri);
    } catch (e) {
      log.warn('sauvegarde', e);
      setStep('password');
      showDialog(t('sauvegarde.impossible'), errorText(e));
    }
  };

  const runImport = async () => {
    if (!file) return;
    setStep('working');
    bar.set(0);
    try {
      const result = await importBackup(file, password, onProgress);
      if (result.needsReload) {
        // Sauvegarde complète vérifiée (ou nouvelle langue) : l'app redémarre et termine la restauration.
        await reloadApp();
        return;
      }
      setStep('done');
    } catch (e) {
      log.warn('restauration', e);
      setStep('password');
      showDialog(t('sauvegarde.charger'), errorText(e));
    }
  };

  // Une sauvegarde complète remplace tout : on le dit clairement avant.
  const confirmImport = () => {
    if (kind !== 'full') {
      runImport();
      return;
    }
    showDialog(t('sauvegarde.remplacerTitre'), t('sauvegarde.remplacerAide'), [
      { label: t('commun.annuler') },
      { label: t('sauvegarde.remplacer'), style: 'danger', onPress: runImport },
    ]);
  };

  const passwordOk = password.length >= PASSWORD_MIN && (mode === 'import' || password === confirm);
  const kindIcon = (value: BackupKind) => (
    <View style={styles.kindIcon}>{value === 'profile' ? <User size={20} color={colors.text} strokeWidth={1.9} /> : <Archive size={20} color={colors.text} strokeWidth={1.9} />}</View>
  );

  return (
    <Sheet title={mode === 'export' ? t('sauvegarde.exporter') : t('sauvegarde.charger')} onClose={onClose} keyboard locked={step === 'working'}>
      {(close) => (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {mode === 'export' && step === 'choose' && (
            <>
              {(['profile', 'full'] as const).map((value, index) => (
                <SheetChoice
                  key={value}
                  index={index}
                  left={kindIcon(value)}
                  label={value === 'profile' ? t('sauvegarde.profilSeul') : t('sauvegarde.complete')}
                  detail={value === 'profile' ? t('sauvegarde.profilSeulAide') : t('sauvegarde.completeAide')}
                  selected={kind === value}
                  onPress={() => setKind(value)}
                />
              ))}
              {kind === 'full' && (
                <Reanimated.View entering={enterUp(8, 240)} style={styles.group}>
                  <View style={styles.toggleRow}>
                    <Text style={[styles.flex, styles.label]}>{t('sauvegarde.medias')}</Text>
                    <Toggle value={media} onChange={setMedia} label={t('sauvegarde.medias')} />
                  </View>
                  <View style={styles.warning}>
                    <ShieldAlert size={20} color={colors.danger} strokeWidth={1.9} />
                    <Text style={[styles.flex, styles.warningText]}>{t('sauvegarde.avertissement')}</Text>
                  </View>
                </Reanimated.View>
              )}
              <PillButton label={t('priseEnMain.suivant')} onPress={() => setStep('password')} />
            </>
          )}

          {mode === 'import' && !file && step === 'password' && (
            <>
              <Text style={styles.help}>{t('sauvegarde.choisirAide')}</Text>
              <PillButton label={t('sauvegarde.choisirFichier')} icon={FileUp} onPress={pick} />
            </>
          )}

          {step === 'password' && (mode === 'export' || file) && (
            <Reanimated.View entering={enterUp(10, 260)} style={styles.group}>
              {mode === 'import' && (
                <View style={styles.fileCard}>
                  {kindIcon(kind)}
                  <Text style={[styles.flex, styles.label]}>{kind === 'profile' ? t('sauvegarde.profilSeul') : t('sauvegarde.complete')}</Text>
                </View>
              )}
              <Text style={styles.help}>{mode === 'export' ? t('sauvegarde.motDePasseAide') : t('sauvegarde.motDePasseImport')}</Text>
              <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder={t('sauvegarde.motDePasse')} placeholderTextColor={colors.textMuted} secureTextEntry autoFocus />
              {mode === 'export' && (
                <TextInput style={styles.input} value={confirm} onChangeText={setConfirm} placeholder={t('sauvegarde.confirmer')} placeholderTextColor={colors.textMuted} secureTextEntry />
              )}
              {mode === 'export' && confirm.length > 0 && password !== confirm && <Text style={styles.error}>{t('sauvegarde.differents')}</Text>}
              <PillButton
                label={mode === 'export' ? t('sauvegarde.creer') : t('sauvegarde.charger')}
                icon={mode === 'export' ? FileDown : FileUp}
                disabled={!passwordOk}
                onPress={mode === 'export' ? runExport : confirmImport}
              />
            </Reanimated.View>
          )}

          {step === 'working' && (
            <Reanimated.View entering={enterUp(8, 240)} style={styles.group}>
              <Text style={styles.help}>{mode === 'export' ? t('sauvegarde.enCours') : t('sauvegarde.verification')}</Text>
              <View style={styles.track}>
                <Reanimated.View style={[styles.fill, fill]} />
              </View>
            </Reanimated.View>
          )}

          {step === 'done' && (
            <Reanimated.View entering={enterUp(8, 240)} style={styles.group}>
              <Text style={styles.help}>{mode === 'export' ? t('sauvegarde.prete') : t('sauvegarde.profilCharge')}</Text>
              {exported && <PillButton label={t('sauvegarde.partager')} icon={FileDown} secondary onPress={() => share(exported)} />}
              <PillButton label={t('editeur.termine')} onPress={() => close()} />
            </Reanimated.View>
          )}
        </ScrollView>
      )}
    </Sheet>
  );
}

// Le gros bouton des feuilles : pilule claire sur le texte, ou discrète sur la surface.
function PillButton({ label, icon: Icon, onPress, disabled, secondary }: { label: string; icon?: LucideIcon; onPress: () => void; disabled?: boolean; secondary?: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const ink = secondary ? colors.text : colors.background;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.pill, secondary && styles.pillSecondary, disabled && styles.disabled, pressed && styles.pressed]}
    >
      {Icon && <Icon size={18} color={ink} strokeWidth={2} />}
      <Text style={[styles.pillLabel, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

const useStyles = createStyles((colors) => ({
  flex: { flex: 1 },
  content: { gap: 10, paddingBottom: 4 },
  group: { gap: 10 },
  kindIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.elevated },
  label: { fontSize: 15, fontWeight: '600', color: colors.text },
  help: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.surface },
  warning: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.dangerSoft },
  warningText: { fontSize: 13, lineHeight: 19, color: colors.text },
  fileCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16, backgroundColor: colors.surface },
  input: { height: 52, borderRadius: 16, paddingHorizontal: 16, fontSize: 16, color: colors.text, backgroundColor: colors.surface },
  error: { fontSize: 13, color: colors.danger },
  track: { height: 8, borderRadius: radius.full, backgroundColor: colors.surface, overflow: 'hidden' },
  fill: { height: 8, width: '100%', borderRadius: radius.full, backgroundColor: colors.signatureStrong, transformOrigin: 'left' },
  pill: { flexDirection: 'row', gap: 8, height: 52, marginTop: 4, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text },
  pillSecondary: { backgroundColor: colors.surface },
  pillLabel: { fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
}));
