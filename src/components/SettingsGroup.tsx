import { Children, Fragment, isValidElement, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, LucideIcon } from 'lucide-react-native';

import { createStyles, radius, spacing, useColors } from '../theme';

// Un groupe de réglages : un petit titre en capitales, puis une carte arrondie dont les lignes sont
// séparées par un filet. Sert au Profil et aux Paramètres.
export function SettingsGroup({ title, children, before }: { title: string; children?: ReactNode; before?: ReactNode }) {
  const styles = useStyles();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={styles.group}>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {before}
      {rows.length > 0 && (
        <View style={styles.card}>
          {rows.map((row, index) => (
            <Fragment key={row.key ?? index}>
              {index > 0 && <View style={styles.separator} />}
              {row}
            </Fragment>
          ))}
        </View>
      )}
    </View>
  );
}

type RowProps = {
  icon: LucideIcon;
  label: string;
  // Sous le libellé (explication, version…).
  detail?: string | null;
  // À droite, en gris (valeur choisie).
  value?: string | null;
  onPress?: () => void;
  // Par défaut, une ligne qui ouvre quelque chose a une flèche.
  chevron?: boolean;
  // À droite, à la place de la flèche (interrupteur).
  right?: ReactNode;
};

export function SettingRow({ icon: Icon, label, detail, value, onPress, chevron = !!onPress, right }: RowProps) {
  const colors = useColors();
  const styles = useStyles();
  const content = (
    <>
      <View style={styles.icon}>
        <Icon size={18} color={colors.text} strokeWidth={1.8} />
      </View>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        {!!detail && <Text style={styles.detail}>{detail}</Text>}
      </View>
      {!!value && <Text style={styles.value}>{value}</Text>}
      {right}
      {chevron && <ChevronRight size={16} color={colors.textMuted} strokeWidth={2} />}
    </>
  );
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const useStyles = createStyles((colors) => ({
  group: {
    gap: spacing.sm,
  },
  title: {
    marginHorizontal: 4,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  card: {
    borderRadius: 18,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 14 + 34 + 12,
    backgroundColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 54,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  pressed: {
    backgroundColor: colors.elevatedActive,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  label: {
    fontSize: 15,
    color: colors.text,
  },
  detail: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  value: {
    fontSize: 14,
    color: colors.textMuted,
  },
}));
