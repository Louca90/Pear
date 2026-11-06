import { Component, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { FileText, RotateCw } from 'lucide-react-native';

import { exportLog, log } from '../log';
import { colors, radius, spacing } from '../theme';
import { Button } from './ui';

// Partage le journal (fichier texte) : il ne contient ni message ni clé.
export async function shareLog() {
  try {
    await Sharing.shareAsync(exportLog(), { mimeType: 'text/plain', dialogTitle: 'Journal de Pear' });
  } catch (e) {
    log.warn('export du journal', e);
  }
}

// Ce qu'on affiche quand quelque chose a planté, à la place d'un écran blanc.
export function ErrorScreen({ detail, onRetry }: { detail?: string; onRetry: () => void }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Pear a rencontré un problème</Text>
      <Text style={styles.text}>Tes messages ne sont pas perdus. Relance l'écran ; si ça recommence, envoie le journal pour qu'on trouve la cause.</Text>
      {detail && (
        <View style={styles.detail}>
          <Text style={styles.detailText} numberOfLines={6}>{detail}</Text>
        </View>
      )}
      <View style={styles.actions}>
        <Button label="Relancer" icon={RotateCw} onPress={onRetry} />
        <Button label="Exporter le journal" icon={FileText} variant="secondary" onPress={shareLog} />
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

const styles = StyleSheet.create({
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
});
