import { ReactNode, useState, useSyncExternalStore } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { Bell, Check, ChevronRight, ImageMinus, Images, LucideIcon, User } from 'lucide-react-native';

import { getConversationSettings, setConversationSetting } from '../chat/database';
import { chat, PickedFile } from '../chat/manager';
import { showDialog } from '../components/dialog';
import { MediaPicker } from '../components/MediaPicker';
import { resizeImage } from '../../modules/pear-native';
import { log } from '../log';
import { Button, Header, IconButton, Screen } from '../components/ui';
import { BUBBLE_COLORS, bubblePalette, createStyles, radius, spacing, useColors } from '../theme';
import { t } from '../i18n';

// Le fond voyage sur le réseau : une image moins lourde arrive plus vite, sans perte visible en plein écran.
// Un fond n'a pas besoin de plus que la taille d'un écran.
const WALLPAPER_MAX_SIZE = 2048;
const WALLPAPER_QUALITY = 80;

function ColorChoices({ selected, onPick }: { selected: string; onPick: (color: string) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.swatches}>
      {BUBBLE_COLORS.map((color) => (
        <IconButton
          key={color}
          onPress={() => onPick(color)}
          label={t('perso.couleur', { couleur: color })}
          hitSlop={0}
          style={[styles.swatch, { backgroundColor: color }]}
        >
          {selected === color && <Check size={20} color={bubblePalette(color).text} strokeWidth={2} />}
        </IconButton>
      ))}
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function SettingRow({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Icon size={20} color={colors.text} strokeWidth={1.75} />
      <Text style={styles.rowLabel}>{label}</Text>
      <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
    </Pressable>
  );
}

type Props = {
  contactKey: string;
  name: string;
  onBack: () => void;
  onInfo: () => void;
  onNotifications: () => void;
};

export function CustomizeScreen({ contactKey, name, onBack, onInfo, onNotifications }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  useSyncExternalStore(chat.subscribe, chat.getVersion);

  const settings = getConversationSettings(contactKey);
  const mine = bubblePalette(settings.my_bubble ?? colors.bubbleMine);
  const theirs = bubblePalette(settings.their_bubble ?? colors.bubbleTheirs);

  const setColor = (column: 'my_bubble' | 'their_bubble', color: string) => {
    setConversationSetting(contactKey, column, color);
    chat.refresh();
  };

  const pickWallpaper = () => setGalleryOpen(true);

  const applyWallpaper = async ([picked]: PickedFile[]) => {
    setGalleryOpen(false);
    if (!picked) return;
    setBusy(true);
    try {
      const small = new File(Paths.cache, `fond-${Date.now()}.jpg`).uri;
      const uri = await resizeImage(picked.uri, small, WALLPAPER_MAX_SIZE, WALLPAPER_QUALITY).catch((e) => {
        log.warn('réduction du fond', e);
        return picked.uri;
      });
      await chat.setWallpaper(contactKey, {
        uri,
        name: 'fond.jpg',
        size: new File(uri).size ?? 0,
        mime: 'image/jpeg',
        kind: 'wallpaper',
      });
    } catch (e) {
      showDialog(t('perso.fondNonApplique'), String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title={t('perso.titre')} subtitle={name} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.preview}>
          {settings.wallpaper_uri && <Image source={{ uri: settings.wallpaper_uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
          <View style={[styles.previewBubble, styles.previewTheirs, { backgroundColor: theirs.background }]}>
            <Text style={{ color: theirs.text }}>{t('perso.lisible')}</Text>
          </View>
          <View style={[styles.previewBubble, styles.previewMine, { backgroundColor: mine.background }]}>
            <Text style={{ color: mine.text }}>{t('perso.toutesCouleurs')}</Text>
          </View>
        </View>

        <Section title={t('perso.bulles')}>
          <Text style={styles.label}>{t('perso.mesBulles')}</Text>
          <ColorChoices selected={mine.background} onPick={(color) => setColor('my_bubble', color)} />
          <Text style={styles.label}>{t('perso.sesBulles')}</Text>
          <ColorChoices selected={theirs.background} onPick={(color) => setColor('their_bubble', color)} />
          <Text style={styles.hint}>{t('perso.couleursLocales')}</Text>
        </Section>

        <Section title={t('perso.fond')}>
          <Text style={styles.hint}>{t('perso.fondPartage')}</Text>
          <View style={styles.actions}>
            <Button label={busy ? t('perso.preparation') : t('perso.choisirImage')} icon={Images} onPress={pickWallpaper} />
            {settings.wallpaper_uri && (
              <Button label={t('perso.retirerFond')} icon={ImageMinus} variant="secondary" onPress={() => chat.clearWallpaper(contactKey)} />
            )}
          </View>
        </Section>

        <Section title={t('perso.conversation')}>
          <SettingRow icon={User} label={t('perso.infosContact')} onPress={onInfo} />
          <SettingRow icon={Bell} label={t('notifs.titre')} onPress={onNotifications} />
        </Section>
      </ScrollView>
      {galleryOpen && <MediaPicker single onPick={applyWallpaper} onClose={() => setGalleryOpen(false)} />}
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  content: {
    padding: spacing.lg,
    paddingTop: spacing.sm,
  },
  preview: {
    height: 150,
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  previewBubble: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.lg,
  },
  previewMine: {
    alignSelf: 'flex-end',
  },
  previewTheirs: {
    alignSelf: 'flex-start',
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  card: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: 14,
    color: colors.textMuted,
  },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: 48,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    color: colors.text,
  },
  pressed: {
    opacity: 0.6,
  },
}));
