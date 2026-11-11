import { useEffect } from 'react';
import { AppState, BackHandler, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { ArrowRight, Download, ExternalLink, LogOut, RotateCw, Settings } from 'lucide-react-native';

import { formatSize } from '../chat/files';
import { Pear } from '../components/Pear';
import { Button, Screen, useNavigationBarHeight } from '../components/ui';
import { createStyles, radius, spacing, useColors } from '../theme';
import { Release } from './release';
import { canSkipUpdate, getInstallPermission, previewUpdateScreen, requestInstallPermission, skipUpdateOnce, startUpdate, useUpdateState } from './updates';
import { t } from '../i18n';

// Plein écran et bloquant : ni le bouton retour ni le geste ne le ferment. On met à jour, ou on quitte.
export function UpdateScreen({ release }: { release: Release }) {
  const colors = useColors();
  const styles = useStyles();
  const update = useUpdateState();
  const { phase, progress, error, preview } = update;
  const bottom = useNavigationBarHeight();
  const busy = phase === 'downloading' || phase === 'verifying';

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => back.remove();
  }, []);

  // Au retour des réglages d'Android, la mise à jour reprend toute seule si l'autorisation est donnée.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && phase === 'permission' && getInstallPermission()) startUpdate();
    });
    return () => subscription.remove();
  }, [phase]);

  const status =
    phase === 'downloading'
      ? t('maj.telechargement', { pourcent: Math.round(progress * 100) })
      : phase === 'verifying'
        ? t('maj.verification')
        : phase === 'installing'
          ? t('maj.confirmer')
          : phase === 'permission'
            ? t('maj.autoriser')
            : phase === 'failed'
              ? t('maj.echec', { erreur: error ?? '' })
              : null;

  return (
    <Screen>
      <View style={[styles.content, { paddingBottom: bottom }]}>
        {/* La poire mûrit avec le téléchargement : pâle au départ, pleine quand tout est arrivé. */}
        <View style={styles.icon} accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}>
          <Pear height={72} color={colors.text} state={busy || phase === 'installing' ? 'ripening' : 'idle'} progress={phase === 'downloading' ? progress : 1} />
        </View>
        <Text style={styles.title}>{t('maj.disponible')}</Text>
        <Text style={styles.version}>{t('commun.version')} {release.version} · {formatSize(release.apkSize)}</Text>

        <ScrollView style={styles.notes} contentContainerStyle={styles.notesContent}>
          <Text style={styles.notesText}>{release.summary || t('maj.prete')}</Text>
        </ScrollView>
        <Pressable onPress={() => Linking.openURL(release.pageUrl)} hitSlop={8} style={styles.link}>
          <ExternalLink size={16} color={colors.text} strokeWidth={1.75} />
          <Text style={styles.linkText}>{t('maj.toutLeDetail')}</Text>
        </Pressable>

        {status && <Text style={[styles.status, phase === 'failed' && styles.statusError]}>{status}</Text>}


        <View style={styles.actions}>
          {phase === 'permission' ? (
            <Button label={t('commun.ouvrirReglages')} icon={Settings} onPress={requestInstallPermission} />
          ) : phase === 'failed' ? (
            <Button label={t('maj.reessayer')} icon={RotateCw} onPress={startUpdate} />
          ) : (
            <Button label={busy ? t('maj.enCours') : phase === 'installing' ? t('maj.installer') : t('maj.mettreAJour')} icon={Download} onPress={startUpdate} />
          )}
          {phase === 'failed' && canSkipUpdate(update) && (
            <Button label={t('maj.continuer')} icon={ArrowRight} variant="secondary" onPress={skipUpdateOnce} />
          )}
          <Button label={t('maj.quitter')} icon={LogOut} variant="secondary" onPress={() => BackHandler.exitApp()} />
          {preview && (
            <Pressable onPress={() => previewUpdateScreen(false)} style={styles.link}>
              <Text style={styles.linkText}>{t('maj.fermerApercu')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg * 2,
  },
  icon: {
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.text,
  },
  version: {
    fontSize: 15,
    color: colors.textMuted,
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  notes: {
    flexGrow: 0,
    maxHeight: 280,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  notesContent: {
    padding: spacing.md,
  },
  notesText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    textDecorationLine: 'underline',
  },
  status: {
    fontSize: 15,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  statusError: {
    color: colors.danger,
  },

  actions: {
    marginTop: 'auto',
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
}));
