import { Fragment, useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { Header, Screen } from '../components/ui';
import { t } from '../i18n';
import { createStyles, radius, spacing, useColors } from '../theme';
import { WhatsNew } from '../update/WhatsNew';
import { pagesByTheme, WhatsNewPage } from '../update/pages';

// « Découvrir Pear » : toutes les pages « Quoi de neuf » déjà sorties, rangées par thème.
// Toucher une page rejoue celles de son thème, à partir d'elle.
export function DiscoverScreen({ onBack }: { onBack: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const groups = pagesByTheme();
  const [open, setOpen] = useState<{ pages: WhatsNewPage[]; index: number } | null>(null);

  return (
    <Screen>
      <Header title={t('nouveautes.decouvrir')} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        {groups.length === 0 && <Text style={styles.empty}>{t('nouveautes.vide')}</Text>}
        {groups.map((group) => (
          <Fragment key={group.theme}>
            <Text style={styles.theme} accessibilityRole="header">
              {t(`nouveautes.theme_${group.theme}`)}
            </Text>
            {group.pages.map((page, index) => (
              <Pressable
                key={page.titre}
                onPress={() => setOpen({ pages: group.pages, index })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <Text style={styles.rowLabel}>{t(page.titre)}</Text>
                <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
              </Pressable>
            ))}
          </Fragment>
        ))}
      </ScrollView>
      {open && <WhatsNew pages={open.pages} initial={open.index} onClose={() => setOpen(null)} />}
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  content: { padding: spacing.lg, gap: spacing.sm },
  empty: { fontSize: 15, color: colors.textMuted },
  theme: { fontSize: 14, fontWeight: '500', color: colors.textMuted, marginTop: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  rowLabel: { flex: 1, fontSize: 16, color: colors.text },
  pressed: { opacity: 0.6 },
}));
