import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Activity, CircleAlert, CircleCheck, Loader, LucideIcon } from 'lucide-react-native';

import { Button, Header, Screen } from '../components/ui';
import { PeerLink, PeerStatus, RouteType } from '../network/peer';
import { Role } from '../network/signaling';
import { colors, radius, spacing } from '../theme';

type Props = {
  name: string;
  role: Role;
  secret: Uint8Array;
  onBack: () => void;
};

const STATUS: Record<PeerStatus, { label: string; icon: LucideIcon }> = {
  starting: { label: 'Démarrage', icon: Loader },
  searching: { label: 'En attente de votre contact', icon: Loader },
  connecting: { label: 'Connexion en cours', icon: Loader },
  connected: { label: 'Connecté', icon: CircleCheck },
  error: { label: 'Erreur', icon: CircleAlert },
};

const ROUTE: Record<RouteType, string> = {
  host: 'Direct, sur le même réseau',
  srflx: 'Direct, par internet',
  prflx: 'Direct, par internet',
  relay: 'Par un serveur relais',
};

export function ConnectionScreen({ name, role, secret, onBack }: Props) {
  const [status, setStatus] = useState<PeerStatus>('starting');
  const [detail, setDetail] = useState<string | undefined>();
  const [route, setRoute] = useState<RouteType | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const link = useRef<PeerLink | null>(null);

  useEffect(() => {
    const peer = new PeerLink(role, secret, {
      onStatus: (nextStatus, nextDetail) => {
        setStatus(nextStatus);
        setDetail(nextDetail);
      },
      onRoute: setRoute,
      onPong: setPingMs,
    });
    link.current = peer;
    peer.start();
    return () => {
      peer.stop();
    };
  }, [role, secret]);

  const { label, icon: Icon } = STATUS[status];

  return (
    <Screen>
      <Header title={name} onBack={onBack} />
      <View style={styles.content}>
        <View style={styles.card}>
          <Icon size={24} color={colors.text} strokeWidth={1.75} />
          <View style={styles.cardText}>
            <Text style={styles.status}>{label}</Text>
            {route && <Text style={styles.detail}>{ROUTE[route]}</Text>}
            {status === 'error' && detail && <Text style={styles.detail}>{detail}</Text>}
          </View>
        </View>

        {status === 'connected' && (
          <>
            <Button label="Envoyer un ping" icon={Activity} onPress={() => link.current?.ping()} />
            {pingMs !== null && <Text style={styles.ping}>Réponse reçue en {pingMs} ms</Text>}
          </>
        )}

        {status !== 'connected' && (
          <Text style={styles.detail}>Ouvrez aussi cet écran sur l'autre téléphone.</Text>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  cardText: {
    flex: 1,
  },
  status: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  detail: {
    fontSize: 14,
    color: colors.textMuted,
  },
  ping: {
    fontSize: 16,
    color: colors.text,
    textAlign: 'center',
  },
});
