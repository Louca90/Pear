import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ban, Check, ShieldQuestion, X } from 'lucide-react-native';

import { Pear } from '../components/Pear';

import { getPendingRequests, PairingRequest } from '../chat/database';
import { chat, MAX_PROFILE_NAME_LENGTH } from '../chat/manager';
import { Header, Screen } from '../components/ui';
import { deriveSharedSecret, getVerificationCode, Identity } from '../crypto/pairing';
import { t } from '../i18n';
import { createStyles, radius, spacing, useColors } from '../theme';

const ENTER_MS = 260;
const LEAVE_MS = 200;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

type Props = {
  identity: Identity;
  onBack: () => void;
  onAccept: (publicKey: string, name: string) => void;
};

function ago(at: number) {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return t('diag.aLinstant');
  if (minutes < 60) return t('diag.ilYaMinutes', { n: minutes });
  const hours = Math.round(minutes / 60);
  return hours < 48 ? t('diag.ilYaHeures', { n: hours }) : t('diag.ilYaJours', { n: Math.round(hours / 24) });
}

function initials(name: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((word) => [...word][0] ?? '')
    .join('');
  return [...letters].slice(0, 2).join('').toUpperCase() || '?';
}

function RequestCard({ request, onAccept, identity }: { request: PairingRequest; onAccept: Props['onAccept']; identity: Identity }) {
  const colors = useColors();
  const styles = useStyles();
  const [name, setName] = useState(request.name);
  const progress = useRef(new Animated.Value(0)).current;
  const [showCode, setShowCode] = useState(false);
  // Recalculé à la demande : seule la clé privée est stockée. Une clé invalide n'affiche rien.
  const code = useMemo(() => {
    try {
      return getVerificationCode(deriveSharedSecret(identity, request.from_key));
    } catch {
      return [];
    }
  }, [identity, request.from_key]);

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: ENTER_MS, easing: EASING, useNativeDriver: true }).start();
  }, [progress]);

  // La carte s'efface avant que la demande quitte la liste.
  const leave = (action: () => void) =>
    Animated.timing(progress, { toValue: 0, duration: LEAVE_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(action);

  const style = {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  };

  return (
    <Animated.View style={[styles.card, style]}>
      <View style={styles.top}>
        <View style={styles.initials}>
          <Text style={styles.initialsText}>{initials(request.name)}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.name} numberOfLines={1}>
            {request.name || t('demandes.quelquun')}
          </Text>
          <Text style={styles.muted}>{ago(request.at)}</Text>
        </View>
      </View>
      {code.length > 0 && (
        <Pressable onPress={() => setShowCode((value) => !value)} style={styles.unverified} hitSlop={6}>
          <ShieldQuestion size={16} color={colors.textMuted} strokeWidth={1.75} />
          <Text style={styles.muted}>{t('contact.nonVerifieComparer')}</Text>
        </Pressable>
      )}
      {showCode && code.length > 0 && (
        <View style={styles.codeBox}>
          <View style={styles.codeRow}>
            {code.map((group, index) => (
              <Text key={index} style={styles.codeGroup}>
                {group}
              </Text>
            ))}
          </View>
          <Text style={styles.muted}>{t('contact.codeAide')}</Text>
        </View>
      )}
      <Text style={styles.label}>{t('contact.nom')}</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder={t('contact.nomContact')}
        placeholderTextColor={colors.textMuted}
        maxLength={MAX_PROFILE_NAME_LENGTH}
      />
      <View style={styles.actions}>
        <Pressable
          onPress={() => leave(() => onAccept(request.from_key, name.trim() || request.name || t('app.contact')))}
          style={({ pressed }) => [styles.action, styles.accept, pressed && styles.pressed]}
        >
          <Check size={18} color={colors.onAccent} strokeWidth={2} />
          <Text style={[styles.actionLabel, styles.acceptLabel]}>{t('demandes.accepter')}</Text>
        </Pressable>
        <Pressable onPress={() => leave(() => chat.declineRequest(request.from_key))} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <X size={18} color={colors.text} strokeWidth={2} />
          <Text style={styles.actionLabel}>{t('demandes.refuser')}</Text>
        </Pressable>
        <Pressable onPress={() => leave(() => chat.blockRequest(request.from_key))} style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
          <Ban size={18} color={colors.danger} strokeWidth={2} />
          <Text style={[styles.actionLabel, styles.danger]}>{t('demandes.bloquer')}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// Les demandes d'ajout reçues : rien ne se fait sans un « Accepter ».
export function RequestsScreen({ identity, onBack, onAccept }: Props) {
  const colors = useColors();
  const styles = useStyles();
  useSyncExternalStore(chat.subscribe, chat.getVersion);
  const requests = getPendingRequests();

  return (
    <Screen>
      <Header title={t('demandes.titre')} onBack={onBack} />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        {requests.length === 0 ? (
          <View style={styles.empty}>
            <Pear height={56} color={colors.textMuted} state="resting" />
            <Text style={styles.emptyTitle}>{t('demandes.aucune')}</Text>
            <Text style={styles.emptyText}>{t('demandes.aucuneAide')}</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {requests.map((request) => (
              <RequestCard key={request.id} request={request} onAccept={onAccept} identity={identity} />
            ))}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  unverified: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing.sm,
  },
  codeBox: {
    borderRadius: radius.md,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  codeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  codeGroup: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  card: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  initials: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.elevatedActive,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  name: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
  },
  muted: {
    fontSize: 13,
    color: colors.textMuted,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
    marginBottom: 4,
  },
  input: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.elevated,
  },
  accept: {
    backgroundColor: colors.accent,
  },
  actionLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  acceptLabel: {
    color: colors.onAccent,
  },
  danger: {
    color: colors.danger,
  },
  pressed: {
    opacity: 0.6,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },

  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  emptyText: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
  },
}));
