import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { Archive, FileDown, FileUp, Lock, ShieldAlert, User } from 'lucide-react-native';

import { reloadApp } from '../../modules/pear-native';
import { exportBackup, importBackup, inspectBackup } from '../backup/backup';
import { BackupError, BackupKind } from '../backup/format';
import { t } from '../i18n';
import { log } from '../log';
import { createStyles, radius, spacing, useColors } from '../theme';
import { showDialog } from './dialog';
import { Toggle } from './Toggle';
import { Button, useNavigationBarHeight } from './ui';

const OPEN_MS = 240;
const CLOSE_MS = 180;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const PASSWORD_MIN = 8;

type Step = 'choose' | 'password' | 'working' | 'done';

function errorText(e: unknown) {
  if (e instanceof BackupError) return e.reason === 'password' ? t('sauvegarde.motDePasseFaux') : e.reason === 'format' ? t('sauvegarde.pasUneSauvegarde') : t('sauvegarde.abimee');
  return String(e);
}

// Exporter (profil seul ou sauvegarde complète) ou charger un fichier de sauvegarde, protégé par un mot de
// passe. La feuille monte du bas et suit le thème clair ou sombre.
export function BackupSheet({ mode, onClose }: { mode: 'export' | 'import'; onClose: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const bottom = useNavigationBarHeight();
  const progress = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const [step, setStep] = useState<Step>(mode === 'export' ? 'choose' : 'password');
  const [kind, setKind] = useState<BackupKind>('profile');
  const [media, setMedia] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [file, setFile] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start();
  }, [progress]);

  const close = () => {
    if (closing.current || step === 'working') return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: CLOSE_MS, easing: EASING, useNativeDriver: true }).start(onClose);
  };

  const onProgress = (done: number, total: number) => bar.setValue(total > 0 ? Math.min(1, done / total) : 0);

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
    bar.setValue(0);
    try {
      const uri = await exportBackup(kind, password, media, onProgress);
      setExported(uri);
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
    bar.setValue(0);
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

  return (
    <Modal visible transparent animationType="none" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[styles.backdrop, { opacity: progress }]}>
        <Pressable style={styles.flex} onPress={close} accessibilityLabel={t('commun.fermer')} />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" style={styles.keyboard} pointerEvents="box-none">
        <Animated.View style={[styles.sheet, { paddingBottom: bottom + spacing.lg, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [600, 0] }) }] }]}>
          <View style={styles.handle} />
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{mode === 'export' ? t('sauvegarde.exporter') : t('sauvegarde.charger')}</Text>

            {mode === 'export' && step === 'choose' && (
              <>
                {(['profile', 'full'] as const).map((value) => (
                  <Pressable key={value} onPress={() => setKind(value)} style={[styles.choice, kind === value && styles.choiceOn]} accessibilityState={{ selected: kind === value }}>
                    {value === 'profile' ? <User size={22} color={colors.text} strokeWidth={1.75} /> : <Archive size={22} color={colors.text} strokeWidth={1.75} />}
                    <View style={styles.flex}>
                      <Text style={styles.choiceTitle}>{value === 'profile' ? t('sauvegarde.profilSeul') : t('sauvegarde.complete')}</Text>
                      <Text style={styles.choiceText}>{value === 'profile' ? t('sauvegarde.profilSeulAide') : t('sauvegarde.completeAide')}</Text>
                    </View>
                  </Pressable>
                ))}
                {kind === 'full' && (
                  <>
                    <View style={styles.toggleRow}>
                      <Text style={[styles.flex, styles.choiceTitle]}>{t('sauvegarde.medias')}</Text>
                      <Toggle value={media} onChange={setMedia} label={t('sauvegarde.medias')} />
                    </View>
                    <View style={styles.warning}>
                      <ShieldAlert size={20} color={colors.danger} strokeWidth={1.75} />
                      <Text style={[styles.flex, styles.warningText]}>{t('sauvegarde.avertissement')}</Text>
                    </View>
                  </>
                )}
                <Button label={t('priseEnMain.suivant')} icon={Lock} onPress={() => setStep('password')} />
              </>
            )}

            {mode === 'import' && !file && step === 'password' && (
              <>
                <Text style={styles.choiceText}>{t('sauvegarde.choisirAide')}</Text>
                <Button label={t('sauvegarde.choisirFichier')} icon={FileUp} onPress={pick} />
              </>
            )}

            {step === 'password' && (mode === 'export' || file) && (
              <>
                {mode === 'import' && (
                  <View style={styles.choice}>
                    {kind === 'profile' ? <User size={22} color={colors.text} strokeWidth={1.75} /> : <Archive size={22} color={colors.text} strokeWidth={1.75} />}
                    <Text style={[styles.flex, styles.choiceTitle]}>{kind === 'profile' ? t('sauvegarde.profilSeul') : t('sauvegarde.complete')}</Text>
                  </View>
                )}
                <Text style={styles.choiceText}>{mode === 'export' ? t('sauvegarde.motDePasseAide') : t('sauvegarde.motDePasseImport')}</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t('sauvegarde.motDePasse')}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  autoFocus
                />
                {mode === 'export' && (
                  <TextInput
                    style={styles.input}
                    value={confirm}
                    onChangeText={setConfirm}
                    placeholder={t('sauvegarde.confirmer')}
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry
                  />
                )}
                {mode === 'export' && confirm.length > 0 && password !== confirm && <Text style={styles.error}>{t('sauvegarde.differents')}</Text>}
                <View style={!passwordOk && styles.disabled} pointerEvents={passwordOk ? 'auto' : 'none'}>
                  <Button
                    label={mode === 'export' ? t('sauvegarde.creer') : t('sauvegarde.charger')}
                    icon={mode === 'export' ? FileDown : FileUp}
                    onPress={mode === 'export' ? runExport : confirmImport}
                  />
                </View>
              </>
            )}

            {step === 'working' && (
              <>
                <Text style={styles.choiceText}>{mode === 'export' ? t('sauvegarde.enCours') : t('sauvegarde.verification')}</Text>
                <View style={styles.track}>
                  <Animated.View style={[styles.fill, { transform: [{ scaleX: bar }] }]} />
                </View>
              </>
            )}

            {step === 'done' && (
              <>
                <Text style={styles.choiceText}>{mode === 'export' ? t('sauvegarde.prete') : t('sauvegarde.profilCharge')}</Text>
                {exported && <Button label={t('sauvegarde.partager')} icon={FileDown} variant="secondary" onPress={() => share(exported)} />}
                <Button label={t('editeur.termine')} icon={Lock} onPress={close} />
              </>
            )}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  keyboard: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.elevated,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
    marginTop: spacing.sm,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  choiceOn: {
    borderColor: colors.text,
    backgroundColor: colors.surface,
  },
  choiceTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  choiceText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  warning: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  warningText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  error: {
    fontSize: 14,
    color: colors.danger,
  },
  disabled: {
    opacity: 0.4,
  },
  track: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
    width: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.text,
    transformOrigin: 'left',
  },
}));
