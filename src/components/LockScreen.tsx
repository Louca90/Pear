import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LockOpen } from 'lucide-react-native';

import { authenticate } from '../../modules/pear-native';
import { t } from '../i18n';
import { Pear } from './Pear';
import { createStyles, spacing, useColors } from '../theme';
import { Button } from './ui';

// Recouvre toute l'app tant que le verrou est fermé. La demande d'empreinte se lance toute seule ;
// « Déverrouiller » la relance si elle a été fermée.
// waiting : on ne sait pas encore si le verrou est activé ; l'écran couvre l'app sans rien demander.
export function LockScreen({ onUnlock, waiting = false }: { onUnlock: () => void; waiting?: boolean }) {
  const colors = useColors();
  const styles = useStyles();
  const asking = useRef(false);

  const ask = useCallback(async () => {
    if (asking.current) return;
    asking.current = true;
    try {
      // Sans verrou d'écran sur le téléphone, rien ne peut être demandé : l'app s'ouvre.
      if ((await authenticate(t('reglages.verrouTitre'))) !== 'cancelled') onUnlock();
    } finally {
      asking.current = false;
    }
  }, [onUnlock]);

  useEffect(() => {
    if (!waiting) ask();
  }, [ask, waiting]);

  if (waiting) return <View style={[StyleSheet.absoluteFill, styles.root]} />;
  return (
    <View style={[StyleSheet.absoluteFill, styles.root]}>
      <Pear height={72} color={colors.text} />
      <Text style={styles.title}>{t('reglages.verrouTitre')}</Text>
      <Button label={t('reglages.deverrouiller')} icon={LockOpen} onPress={ask} />
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  root: {
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    zIndex: 100,
    elevation: 100,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
}));
