import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, Text, TextInput, View } from 'react-native';
import { Camera, Check, FileDown, FileUp, ImageMinus, Settings } from 'lucide-react-native';

import { chat, MAX_PROFILE_NAME_LENGTH } from '../chat/manager';
import { BackupSheet } from '../components/BackupSheet';
import { MediaPicker } from '../components/MediaPicker';
import { ProfilePhotoCropper } from '../components/ProfilePhotoCropper';
import { useBottomBarSpace } from '../components/BottomBar';
import { showDialog } from '../components/dialog';
import { Avatar, Button, Header, IconButton, Screen } from '../components/ui';
import { createStyles, radius, spacing, useColors } from '../theme';
import { t } from '../i18n';

// Le libellé « Enregistré » reste affiché un instant après l'enregistrement.
const SAVED_MS = 1600;

// L'onglet Profil : ma photo et mon nom, tels que mes contacts les voient. Les réglages sont derrière
// le bouton en haut à droite.
export function ProfileScreen({ onSettings }: { onSettings: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const barSpace = useBottomBarSpace();
  const saved = chat.getMyProfile();
  const [name, setName] = useState(saved.name ?? '');
  const [photo, setPhoto] = useState(saved.photo);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [backup, setBackup] = useState<'export' | 'import' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // La galerie de Pear, une seule photo : elle est réduite à l'enregistrement (saveProfile).
  const [galleryOpen, setGalleryOpen] = useState(false);
  // La photo choisie passe d'abord par le recadrage en carré, avant d'être gardée.
  const [cropping, setCropping] = useState<string | null>(null);
  const pickPhoto = () => setGalleryOpen(true);

  const save = async () => {
    setState('saving');
    try {
      await chat.saveProfile(name.trim(), photo);
      setState('saved');
      timer.current = setTimeout(() => setState('idle'), SAVED_MS);
    } catch (e) {
      showDialog(t('commun.enregistrementImpossible'), String(e));
      setState('idle');
    }
  };

  return (
    <Screen>
      <Header
        title={t('profil.titre')}
        action={
          <IconButton onPress={onSettings} label={t('profil.parametres')}>
            <Settings size={24} color={colors.text} strokeWidth={1.75} />
          </IconButton>
        }
      />
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: barSpace }]} keyboardShouldPersistTaps="handled">
          <IconButton onPress={pickPhoto} label={t('profil.choisirPhoto')} hitSlop={0} style={styles.photo}>
            <Avatar uri={photo} size={112} />
            <View style={styles.photoBadge}>
              <Camera size={18} color={colors.onAccent} strokeWidth={1.75} />
            </View>
          </IconButton>
          {photo && (
            <IconButton onPress={() => setPhoto(null)} label={t('profil.retirerPhoto')} hitSlop={8} style={styles.removePhoto}>
              <ImageMinus size={18} color={colors.textMuted} strokeWidth={1.75} />
              <Text style={styles.removeLabel}>{t('profil.retirerPhoto')}</Text>
            </IconButton>
          )}

          <Text style={styles.label}>{t('profil.votreNom')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={t('profil.commentPresenter')}
            placeholderTextColor={colors.textMuted}
            maxLength={MAX_PROFILE_NAME_LENGTH}
          />
          <Text style={styles.hint}>{t('profil.confidentialite')}</Text>

          <Button
            label={state === 'saving' ? t('profil.enregistrement') : state === 'saved' ? t('profil.enregistre') : t('commun.enregistrer')}
            icon={Check}
            onPress={save}
          />

          <Text style={[styles.label, styles.section]}>{t('sauvegarde.titre')}</Text>
          <View style={styles.backupRow}>
            <View style={styles.flex}>
              <Button label={t('sauvegarde.exporter')} icon={FileDown} variant="secondary" onPress={() => setBackup('export')} />
            </View>
            <View style={styles.flex}>
              <Button label={t('sauvegarde.charger')} icon={FileUp} variant="secondary" onPress={() => setBackup('import')} />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {backup && <BackupSheet mode={backup} onClose={() => setBackup(null)} />}
      {galleryOpen && (
        <MediaPicker
          single
          onPick={([picked]) => {
            setGalleryOpen(false);
            if (picked) setCropping(picked.uri);
          }}
          onClose={() => setGalleryOpen(false)}
        />
      )}
      {cropping && (
        <ProfilePhotoCropper
          uri={cropping}
          onDone={(uri) => {
            setCropping(null);
            setPhoto(uri);
          }}
          onCancel={() => setCropping(null)}
        />
      )}
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  photo: {
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  photoBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removePhoto: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  removeLabel: {
    fontSize: 14,
    color: colors.textMuted,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  section: {
    marginTop: spacing.lg,
  },
  backupRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
}));
