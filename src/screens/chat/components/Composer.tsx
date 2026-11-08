import { ComponentRef, RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { ArrowUp, Check, ChevronUp, Lock, Mic, Trash2 } from 'lucide-react-native';

import { Message } from '../../../chat/database';
import { MAX_TEXT_LENGTH } from '../../../chat/manager';
import { IconButton, useNavigationBarHeight } from '../../../components/ui';
import { createStyles, radius, spacing, useColors } from '../../../theme';

import { VOICE_CANCEL_DISTANCE, VOICE_LOCK_DISTANCE } from '../constants';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { useChatStyles } from '../styles';
import { ComposerModeCard } from './ComposerModeCard';
import { RecordingRow } from './RecordingRow';
import { ATTACH_CLOSE_EASING, ATTACH_CLOSE_MS, ATTACH_EASING, ATTACH_OPEN_MS, AttachPill } from './AttachMenu';
import { useBackInterceptor } from '../../../navigation/backInterceptors';
import { t } from '../../../i18n';

type Props = {
  name: string;
  draft: string;
  onChangeDraft: (text: string) => void;
  replyingTo: Message | null;
  editing: Message | null;
  onCancelMode: () => void;
  onJump: (id: string) => void;
  onSend: () => void;
  // Appui long sur Envoyer : programmer le message.
  onSchedule: () => void;
  input: RefObject<ComponentRef<typeof TextInput> | null>;
  keyboardOpen: boolean;
  // Pièces jointes : le trombone s'allonge en pilule (Photos, Fichier) sur le champ de texte.
  attachOpen: boolean;
  onToggleAttach: () => void;
  onCloseAttach: () => void;
  onPhotos: () => void;
  onFile: () => void;
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
  onJump,
  onSend,
  onSchedule,
  input,
  keyboardOpen,
  attachOpen,
  onToggleAttach,
  onCloseAttach,
  onPhotos,
  onFile,
  onVoiceRecorded,
  onVoiceTooShort,
}: Props) {
  const styles = useStyles();
  const colors = useColors();
  const bottom = useNavigationBarHeight();
  const voice = useVoiceRecorder(onVoiceRecorded, onVoiceTooShort);
  // La pilule vit dans la barre : elle suit le clavier et la barre sans rien mesurer dans la fenêtre.
  const attachProgress = useRef(new Animated.Value(0)).current;
  const [fieldWidth, setFieldWidth] = useState(0);
  useBackInterceptor(attachOpen, onCloseAttach);
  useEffect(() => {
    Animated.timing(attachProgress, {
      toValue: attachOpen ? 1 : 0,
      duration: attachOpen ? ATTACH_OPEN_MS : ATTACH_CLOSE_MS,
      easing: attachOpen ? ATTACH_EASING : ATTACH_CLOSE_EASING,
      useNativeDriver: false,
    }).start();
  }, [attachOpen, attachProgress]);
  // Le micro devient progressivement une poubelle, au fil du glissé vers la gauche.
  const trashAmount = voice.dragX.interpolate({ inputRange: [-VOICE_CANCEL_DISTANCE, -VOICE_CANCEL_DISTANCE * 0.2], outputRange: [1, 0], extrapolate: 'clamp' });

  const mode = useMemo(
    () => (editing ? { kind: 'edit' as const, message: editing } : replyingTo ? { kind: 'reply' as const, message: replyingTo } : null),
    [editing, replyingTo],
  );

  return (
    <View style={styles.composerArea}>
      {/* Comble l'espace qui peut rester entre la saisie et le clavier (ou le bas de l'écran) : le fond d'écran n'y transparaît plus. */}
      <View pointerEvents="none" style={styles.composerUnderlay} />
      <ComposerModeCard mode={mode} name={name} onCancel={onCancelMode} onJump={onJump} />
      <View style={[styles.composer, { paddingBottom: keyboardOpen ? spacing.sm : bottom + spacing.sm }]}>
        {voice.phase !== 'idle' ? (
          <RecordingRow seconds={voice.seconds} locked={voice.phase === 'locked'} dragX={voice.dragX} onDiscard={voice.discard} />
        ) : (
          <View style={styles.field} onLayout={(event) => setFieldWidth(event.nativeEvent.layout.width)}>
            {/* La place du trombone : c'est la pilule (plus bas) qui le dessine. */}
            <View style={styles.attachSpace} />
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
            <AttachPill progress={attachProgress} width={fieldWidth} open={attachOpen} onToggle={onToggleAttach} onPhotos={onPhotos} onFile={onFile} />
          </View>
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
            onLongPress={editing ? undefined : onSchedule}
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
        {/* Menu ouvert : un appui sur le bouton d'envoi ou le micro referme seulement le menu. */}
        {attachOpen && <Pressable onPress={onCloseAttach} accessibilityLabel={t('commun.fermer')} style={styles.sendCover} />}
      </View>
    </View>
  );
}

const useLocalStyles = createStyles((colors) => ({
  composerArea: {
    backgroundColor: colors.background,
  },
  composerUnderlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    height: 400,
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
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  attachSpace: {
    width: 44,
    height: 44,
  },
  sendCover: {
    position: 'absolute',
    right: spacing.md,
    top: spacing.sm,
    width: 44,
    bottom: 0,
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
