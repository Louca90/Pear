import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Check, ExternalLink } from 'lucide-react-native';

import { Button } from '../components/ui';
import { createStyles, radius, spacing, useColors } from '../theme';
import { fetchSummary, UpdatedInfo } from './updated';

// Courbe douce, sans rebond.
const SMOOTH = Easing.bezier(0.2, 0.8, 0.2, 1);

// Une fois, au premier lancement après une mise à jour. Le retour d'Android fait comme OK.
export function UpdatedPopup({ info, onClose }: { info: UpdatedInfo; onClose: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const [summary, setSummary] = useState(info.summary);
  const appear = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (info.summary === null) fetchSummary().then(setSummary);
    Animated.sequence([
      Animated.timing(appear, { toValue: 1, duration: 260, easing: SMOOTH, useNativeDriver: true }),
      Animated.timing(check, { toValue: 1, duration: 320, easing: SMOOTH, useNativeDriver: true }),
    ]).start();
  }, [info.summary, appear, check]);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.backdrop}>
        <Animated.View
          style={[styles.card, { opacity: appear, transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}
        >
          <Animated.View style={[styles.check, { transform: [{ scale: check }, { rotate: check.interpolate({ inputRange: [0, 1], outputRange: ['-45deg', '0deg'] }) }] }]}>
            <Check size={30} color={colors.onAccent} strokeWidth={2.5} />
          </Animated.View>
          <Text style={styles.title}>Pear est à jour !</Text>

          <View style={styles.box}>
            <Text style={styles.version}>Version {info.version}</Text>
            {summary && (
              <ScrollView style={styles.summary}>
                <Text style={styles.summaryText}>{summary}</Text>
              </ScrollView>
            )}
          </View>

          <Pressable onPress={() => Linking.openURL(info.pageUrl)} hitSlop={8} style={styles.link}>
            <ExternalLink size={16} color={colors.text} strokeWidth={1.75} />
            <Text style={styles.linkText}>Voir le détail de la mise à jour sur GitHub</Text>
          </Pressable>

          <Button label="OK" icon={Check} onPress={onClose} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const useStyles = createStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: radius.lg,
    backgroundColor: colors.elevated,
    padding: spacing.lg,
    alignItems: 'stretch',
  },
  check: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  box: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  version: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  summary: {
    maxHeight: 200,
  },
  summaryText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  linkText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    textDecorationLine: 'underline',
  },
}));
