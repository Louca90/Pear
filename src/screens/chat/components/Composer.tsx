import { ComponentRef, RefObject } from 'react';
import { Animated, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowUp, Check, ChevronUp, Lock, Mic, Paperclip, Pencil, Reply, Trash2, X } from 'lucide-react-native';

import { describeMessage, Message } from '../../../chat/database';
import { MAX_TEXT_LENGTH } from '../../../chat/manager';
import { IconButton, useNavigationBarHeight } from '../../../components/ui';
import { createStyles, radius, spacing, useColors } from '../../../theme';

import { VOICE_CANCEL_DISTANCE, VOICE_LOCK_DISTANCE } from '../constants';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { useChatStyles } from '../styles';
import { RecordingRow } from './RecordingRow';
import { t } from '../../../i18n';

type Props = {
  name: string;
  draft: string;
  onChangeDraft: (text: string) => void;
  replyingTo: Message | null;
  editing: Message | null;
  onCancelMode: () => void;
  onSend: () => void;
  input: RefObject<ComponentRef<typeof TextInput> | null>;
  keyboardOpen: boolean;
  attachOpen: boolean;
  attachProgress: Animated.Value;
  onToggleAttach: () => void;
  onVoiceRecorded: (uri: string, seconds: number) => void;
  onVoiceTooShort: () => void;
};

// La barre du bas : réponse ou modification en cours, pièce jointe, saisie, envoi et vocal.
export function Composer({
  name,
  draft,
  onChangeDraft,
  replyingTo,
  editing,
  onCancelMode,
  onSend,
  input,
  keyboardOpen,
  attachOpen,
  attachProgress,
  onToggleAttach,
  onVoiceRecorded,
  onVoiceTooShort,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const bottom = useNavigationBarHeight();
  const voice = useVoiceRecorder(onVoiceRecorded, onVoiceTooShort);
  // Le micro devient progressivement une poubelle, au fil du glissé vers la gauche.
  const trashAmount = voice.dragX.interpolate({ inputRange: [-VOICE_CANCEL_DISTANCE, -VOICE_CANCEL_DISTANCE * 0.2], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <View style={styles.composerArea}>
      {(replyingTo || editing) && (
        <View style={styles.composerMode}>
          {editing ? <Pencil size={20} color={colors.text} strokeWidth={1.75} /> : <Reply size={20} color={colors.text} strokeWidth={1.75} />}
          <View style={styles.flex}>
            <Text style={styles.composerModeTitle} numberOfLines={1}>
              {editing ? t('chat.modifierMessage') : t('chat.repondreA', { nom: replyingTo?.mine === 1 ? t('chat.vousMeme') : name })}
            </Text>
            <Text style={styles.composerModeText} numberOfLines={1}>{describeMessage((editing ?? replyingTo)!)}</Text>
          </View>
          <IconButton onPress={onCancelMode} label={t('commun.annuler')}>
            <X size={20} color={colors.text} strokeWidth={1.75} />
          </IconButton>
        </View>
      )}
      <View style={[styles.composer, { paddingBottom: keyboardOpen ? spacing.sm : bottom + spacing.sm }]}>
        {voice.phase !== 'idle' ? (
          <RecordingRow seconds={voice.seconds} locked={voice.phase === 'locked'} dragX={voice.dragX} onDiscard={voice.discard} />
        ) : (
          <>
            <IconButton onPress={onToggleAttach} label={t('chat.joindre')} hitSlop={0} style={styles.attach}>
              <Animated.View style={{ transform: [{ rotate: attachProgress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-45deg'] }) }] }}>
                <Paperclip size={20} color={colors.text} strokeWidth={1.75} />
              </Animated.View>
            </IconButton>
            <TextInput
              ref={input}
              style={styles.input}
              value={draft}
              onChangeText={onChangeDraft}
              placeholder={t('chat.champMessage')}
              placeholderTextColor={colors.textMuted}
              maxLength={MAX_TEXT_LENGTH}
              multiline
            />
          </>
        )}
        {voice.phase === 'holding' && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.voiceLockHint,
              { transform: [{ scale: voice.dragY.interpolate({ inputRange: [-VOICE_LOCK_DISTANCE, 0], outputRange: [1.25, 1], extrapolate: 'clamp' }) }] },
            ]}
          >
            <Lock size={18} color={colors.text} strokeWidth={1.75} />
            <ChevronUp size={16} color={colors.textMuted} strokeWidth={1.75} />
          </Animated.View>
        )}
        {(draft.trim() || editing) && voice.phase === 'idle' ? (
          <IconButton
            onPress={onSend}
            disabled={!draft.trim()}
            label={editing ? t('commun.enregistrer') : t('chat.envoyer')}
            hitSlop={0}
            style={[styles.send, !draft.trim() && styles.sendDisabled]}
          >
            {editing ? <Check size={20} color={colors.onAccent} strokeWidth={2} /> : <ArrowUp size={20} color={colors.onAccent} strokeWidth={2} />}
          </IconButton>
        ) : (
          <Animated.View
            {...voice.panHandlers}
            accessibilityRole="button"
            accessibilityLabel={voice.phase === 'locked' ? t('chat.envoyerVocal') : t('chat.maintenirVocal')}
            style={[styles.send, { transform: [{ translateX: voice.dragX }, { translateY: voice.dragY }, { scale: voice.scale }] }]}
          >
            <Animated.View style={[styles.micLayer, styles.micTrash, { opacity: trashAmount }]}>
              <Trash2 size={20} color={colors.onAccent} strokeWidth={2} />
            </Animated.View>
            <Animated.View style={[styles.micLayer, { opacity: Animated.multiply(Animated.subtract(1, trashAmount), Animated.subtract(1, voice.lockProgress)) }]}>
              <Mic size={20} color={colors.onAccent} strokeWidth={2} />
            </Animated.View>
            <Animated.View style={[styles.micLayer, { opacity: voice.lockProgress }]}>
              <ArrowUp size={20} color={colors.onAccent} strokeWidth={2} />
            </Animated.View>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const useLocalStyles = createStyles((colors) => ({
  composerArea: {
    backgroundColor: colors.background,
  },
  composerMode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
  composerModeTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  composerModeText: {
    fontSize: 13,
    color: colors.textMuted,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: colors.background,
  },
  attach: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
  },
  voiceLockHint: {
    position: 'absolute',
    right: spacing.md,
    bottom: '100%',
    marginBottom: spacing.sm,
    width: 44,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    backgroundColor: colors.elevated,
    boxShadow: `0px 4px 16px ${colors.shadow}`,
    alignItems: 'center',
    gap: 2,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: {
    backgroundColor: colors.disabled,
  },
  micLayer: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micTrash: {
    backgroundColor: colors.danger,
  },
}));

const useStyles = () => useChatStyles(useLocalStyles());
