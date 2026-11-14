import { Fragment, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ChevronRight, Compass } from 'lucide-react-native';

import { Header, Screen } from '../components/ui';
import { t } from '../i18n';
import { createStyles, spacing, useColors } from '../theme';
import { WhatsNew } from '../update/WhatsNew';
import { DISCOVER_PAGES, pagesByTheme, WhatsNewPage } from '../update/pages';

type Open = { pages: WhatsNewPage[]; index: number; kicker?: string };

// « Découvrir Pear » : la visite guidée s'ouvre tout de suite (même feuille que les Nouveautés) ; derrière,
// la carte pour la rejouer et toutes les nouveautés déjà sorties, rangées par thème.
export function DiscoverScreen({ onBack }: { onBack: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const groups = pagesByTheme();
  const tour: Open = { pages: DISCOVER_PAGES, index: 0, kicker: t('decouvrir.titre') };
  const [open, setOpen] = useState<Open | null>(tour);

  return (
    <Screen>
      <Header title={t('decouvrir.titre')} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => setOpen(tour)} accessibilityRole="button" style={({ pressed }) => [styles.tour, pressed && styles.pressed]}>
          <View style={styles.tourIcon}>
            <Compass size={22} color={colors.onSignature} strokeWidth={1.8} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.tourTitle}>{t('decouvrir.visite')}</Text>
            <Text style={styles.tourText}>{t('decouvrir.visiteAide')}</Text>
          </View>
          <ChevronRight size={20} color={colors.onSignature} strokeWidth={1.75} />
        </Pressable>
        {groups.length > 0 && <Text style={styles.section}>{t('decouvrir.dejaSorties')}</Text>}
        {groups.map((group) => (
          <Fragment key={group.theme}>
            <Text style={styles.theme} accessibilityRole="header">
              {t(`nouveautes.theme_${group.theme}`)}
            </Text>
            <View style={styles.card}>
              {group.pages.map((page, index) => (
                <Pressable
                  key={page.titre}
                  onPress={() => setOpen({ pages: group.pages, index })}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.row, index > 0 && styles.rowDivider, pressed && styles.rowPressed]}
                >
                  <Text style={styles.rowLabel}>{t(page.titre)}</Text>
                  <ChevronRight size={16} color={colors.textMuted} strokeWidth={2} />
                </Pressable>
              ))}
            </View>
          </Fragment>
        ))}
      </ScrollView>
      {open && <WhatsNew pages={open.pages} initial={open.index} kicker={open.kicker} onClose={() => setOpen(null)} />}
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  tour: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: spacing.md,
    borderRadius: 22,
    backgroundColor: colors.signature,
  },
  tourIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tourTitle: { fontSize: 16, fontWeight: '600', color: colors.onSignature },
  tourText: { fontSize: 13, marginTop: 2, color: colors.onSignature, opacity: 0.8 },
  section: { marginTop: spacing.lg, fontSize: 15, fontWeight: '600', color: colors.text },
  theme: {
    marginTop: spacing.sm,
    marginHorizontal: 4,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  card: { borderRadius: 18, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingHorizontal: 14 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowPressed: { backgroundColor: colors.elevatedActive },
  rowLabel: { flex: 1, fontSize: 15, color: colors.text },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
}));

