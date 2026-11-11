import { ScrollView, Text, View } from 'react-native';

import { Header, Screen } from '../components/ui';
import { t } from '../i18n';
import { createStyles, radius, spacing } from '../theme';

// « Ce que les serveurs voient » : trois serveurs, ce que chacun voit et ne voit jamais. Dit honnêtement,
// y compris que Google voit les métadonnées des réveils.
const SERVERS = ['google', 'firebase', 'vercel'] as const;

export function ServersScreen({ onBack }: { onBack: () => void }) {
  const styles = useStyles();
  return (
    <Screen>
      <Header title={t('voient.titre')} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{t('voient.intro')}</Text>
        {SERVERS.map((server) => (
          <View key={server} style={styles.card}>
            <Text style={styles.name}>{t(`voient.${server}Nom`)}</Text>
            <Text style={styles.label}>{t('voient.voit')}</Text>
            <Text style={styles.text}>{t(`voient.${server}Voit`)}</Text>
            <Text style={styles.label}>{t('voient.jamais')}</Text>
            <Text style={styles.text}>{t(`voient.${server}Jamais`)}</Text>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  content: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.md },
  intro: { fontSize: 15, color: colors.textMuted },
  card: { gap: 4, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  name: { fontSize: 17, fontWeight: '600', color: colors.text },
  label: { fontSize: 13, fontWeight: '500', color: colors.textMuted, marginTop: 4 },
  text: { fontSize: 15, color: colors.text },
}));
