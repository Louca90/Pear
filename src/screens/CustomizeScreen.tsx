import { ReactNode, useState, useSyncExternalStore } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { Bell, ChevronRight, ImageMinus, Images, LucideIcon, User } from 'lucide-react-native';

import { getConversationSettings, setConversationSetting } from '../chat/database';
import { chat, PickedFile } from '../chat/manager';
import { useMediaUri } from '../chat/media';
import { showDialog } from '../components/dialog';
import { MediaPicker } from '../components/MediaPicker';
import { resizeImage } from '../../modules/pear-native';
import { log } from '../log';
import { Button, Header, Screen } from '../components/ui';
import { ColorWheel } from '../components/ColorWheel';
import { SegmentedControl } from '../components/SegmentedControl';
import { bubblePalette, createStyles, radius, spacing, useColors } from '../theme';
import { t } from '../i18n';

// Le fond voyage sur le réseau : une image moins lourde arrive plus vite, sans perte visible en plein écran.
// Un fond n'a pas besoin de plus que la taille d'un écran.
const WALLPAPER_MAX_SIZE = 2048;
const WALLPAPER_QUALITY = 80;
const WHEEL_SIZE = 200;

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
  // La bulle que la roue colore, et la couleur qui suit le doigt avant d'être enregistrée.
  const [target, setTarget] = useState<'my_bubble' | 'their_bubble'>('my_bubble');
  const [draft, setDraft] = useState<string | null>(null);
  useSyncExternalStore(chat.subscribe, chat.getVersion);

  const settings = getConversationSettings(contactKey);
  // Fond chiffré sur le disque (lot 2.3) : affiché depuis sa copie déchiffrée.
  const wallpaper = useMediaUri(settings.wallpaper_uri, { scope: 'app' });
  const mine = bubblePalette((target === 'my_bubble' && draft) || (settings.my_bubble ?? colors.bubbleMine));
  const theirs = bubblePalette((target === 'their_bubble' && draft) || (settings.their_bubble ?? colors.bubbleTheirs));

  const setColor = (column: 'my_bubble' | 'their_bubble', color: string) => {
    setConversationSetting(contactKey, column, color);
    setDraft(null);
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
      <ScrollView contentContainerStyle={styles.content} scrollEnabled={draft === null}>
        <View style={styles.preview}>
          {wallpaper && <Image source={{ uri: wallpaper }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
          <View style={[styles.previewBubble, styles.previewTheirs, { backgroundColor: theirs.background }]}>
            <Text style={{ color: theirs.text }}>{t('perso.lisible')}</Text>
          </View>
          <View style={[styles.previewBubble, styles.previewMine, { backgroundColor: mine.background }]}>
            <Text style={{ color: mine.text }}>{t('perso.toutesCouleurs')}</Text>
          </View>
        </View>

        <Section title={t('perso.bulles')}>
          <SegmentedControl
            options={[
              { value: 'my_bubble', label: t('perso.mesBulles') },
              { value: 'their_bubble', label: t('perso.sesBulles') },
            ]}
            value={target}
            onChange={setTarget}
          />
          <View style={styles.wheel}>
            <ColorWheel
              size={WHEEL_SIZE}
              value={(target === 'my_bubble' ? mine : theirs).background}
              onPreview={setDraft}
              onChange={(color) => setColor(target, color)}
            />
          </View>
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
  wheel: {
    marginVertical: spacing.md,
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
