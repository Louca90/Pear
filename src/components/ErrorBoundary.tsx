import { t } from '../i18n';
import { Component, ReactNode } from 'react';
import { Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { FileText, RotateCw } from 'lucide-react-native';

import { exportLog, log } from '../log';
import { createStyles, radius, spacing } from '../theme';
import { Button } from './ui';

// Partage le journal (fichier texte) : il ne contient ni message ni clé.
export async function shareLog() {
  try {
    await Sharing.shareAsync(exportLog(), { mimeType: 'text/plain', dialogTitle: t('erreur.journal') });
  } catch (e) {
    log.warn('export du journal', e);
  }
}

// Ce qu'on affiche quand quelque chose a planté, à la place d'un écran blanc.
export function ErrorScreen({ detail, onRetry }: { detail?: string; onRetry: () => void }) {
  const styles = useStyles();
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{t('erreur.titre')}</Text>
      <Text style={styles.text}>{t('erreur.aide')}</Text>
      {detail && (
        <View style={styles.detail}>
          <Text style={styles.detailText} numberOfLines={6}>{detail}</Text>
        </View>
      )}
      <View style={styles.actions}>
        <Button label={t('erreur.relancer')} icon={RotateCw} onPress={onRetry} />
        <Button label={t('erreur.exporterJournal')} icon={FileText} variant="secondary" onPress={shareLog} />
      </View>
    </View>
  );
}

type Props = { name: string; children: ReactNode };

// Une erreur pendant l'affichage n'emporte que la zone concernée : un écran, ou l'app en dernier recours.
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    log.error(`affichage (${this.props.name})`, error);
  }

  render() {
    if (this.state.error) return <ErrorScreen detail={this.state.error.message} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}

const useStyles = createStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.text,
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
    color: colors.textMuted,
  },
  detail: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  detailText: {
    fontSize: 13,
    color: colors.text,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
}));
