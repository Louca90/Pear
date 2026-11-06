import { ReactNode, useState, useSyncExternalStore } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Bell, Check, ChevronRight, ImageMinus, Images, LucideIcon, User } from 'lucide-react-native';

import { getConversationSettings, setConversationSetting } from '../chat/database';
import { chat } from '../chat/manager';
import { showDialog } from '../components/dialog';
import { Button, Header, IconButton, Screen } from '../components/ui';
import { BUBBLE_COLORS, bubblePalette, createStyles, radius, spacing, useColors } from '../theme';

// Le fond voyage sur le réseau : une image moins lourde arrive plus vite, sans perte visible en plein écran.
const WALLPAPER_QUALITY = 0.8;

function ColorChoices({ selected, onPick }: { selected: string; onPick: (color: string) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.swatches}>
      {BUBBLE_COLORS.map((color) => (
        <IconButton
          key={color}
          onPress={() => onPick(color)}
          label={`Couleur ${color}`}
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
};

export function CustomizeScreen({ contactKey, name, onBack, onInfo }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const [busy, setBusy] = useState(false);
  useSyncExternalStore(chat.subscribe, chat.getVersion);

  const settings = getConversationSettings(contactKey);
  const mine = bubblePalette(settings.my_bubble ?? colors.text);
  const theirs = bubblePalette(settings.their_bubble ?? colors.surface);

  const setColor = (column: 'my_bubble' | 'their_bubble', color: string) => {
    setConversationSetting(contactKey, column, color);
    chat.refresh();
  };

  const pickWallpaper = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: WALLPAPER_QUALITY });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    setBusy(true);
    try {
      await chat.setWallpaper(contactKey, {
        uri: asset.uri,
        name: 'fond.jpg',
        size: asset.fileSize ?? 0,
        mime: asset.mimeType ?? null,
        kind: 'wallpaper',
      });
    } catch (e) {
      showDialog('Fond non appliqué', String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Header title="Personnaliser" subtitle={name} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.preview}>
          {settings.wallpaper_uri && <Image source={{ uri: settings.wallpaper_uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
          <View style={[styles.previewBubble, styles.previewTheirs, { backgroundColor: theirs.background }]}>
            <Text style={{ color: theirs.text }}>Le texte reste lisible</Text>
          </View>
          <View style={[styles.previewBubble, styles.previewMine, { backgroundColor: mine.background }]}>
            <Text style={{ color: mine.text }}>Sur toutes les couleurs</Text>
          </View>
        </View>

        <Section title="Bulles">
          <Text style={styles.label}>Mes bulles</Text>
          <ColorChoices selected={mine.background} onPick={(color) => setColor('my_bubble', color)} />
          <Text style={styles.label}>Ses bulles</Text>
          <ColorChoices selected={theirs.background} onPick={(color) => setColor('their_bubble', color)} />
          <Text style={styles.hint}>Ces couleurs restent propres à ce téléphone.</Text>
        </Section>

        <Section title="Fond de discussion">
          <Text style={styles.hint}>Il change sur vos deux téléphones.</Text>
          <View style={styles.actions}>
            <Button label={busy ? 'Préparation...' : 'Choisir une image'} icon={Images} onPress={pickWallpaper} />
            {settings.wallpaper_uri && (
              <Button label="Retirer le fond" icon={ImageMinus} variant="secondary" onPress={() => chat.clearWallpaper(contactKey)} />
            )}
          </View>
        </Section>

        <Section title="Conversation">
          <SettingRow icon={User} label="Infos du contact" onPress={onInfo} />
          <SettingRow icon={Bell} label="Notifications et autorisations" onPress={() => Linking.openSettings()} />
        </Section>
      </ScrollView>
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
