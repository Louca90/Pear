import { ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { Image, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { ChevronRight, ImagePlus, User } from 'lucide-react-native';
import Reanimated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { getConversationSettings, setConversationSetting } from '../chat/database';
import { chat, PickedFile } from '../chat/manager';
import { useMediaUri } from '../chat/media';
import { showDialog } from '../components/dialog';
import { MediaPicker } from '../components/MediaPicker';
import { resizeImage } from '../../modules/pear-native';
import { log } from '../log';
import { Header, Screen, usePressFeedback } from '../components/ui';
import { ColorWheel } from '../components/ColorWheel';
import { EASE, enterUp, timing } from '../motion';
import { NotificationsPanel } from './NotificationSettingsScreen';
import { bubblePalette, createStyles, spacing, useColors } from '../theme';
import { t } from '../i18n';

// Le fond voyage sur le réseau : une image moins lourde arrive plus vite, sans perte visible en plein écran.
// Un fond n'a pas besoin de plus que la taille d'un écran.
const WALLPAPER_MAX_SIZE = 2048;
const WALLPAPER_QUALITY = 80;
// Roue compacte, à côté de son explication.
const WHEEL_SIZE = 150;
const TAB_PADDING = 4;
// Fondu des couleurs (aperçu, onglets, puces) et glissement de la pastille : sous 300 ms, sans rebond.
const FADE_MS = 260;
const FADE = { duration: FADE_MS, easing: EASE, reduceMotion: ReduceMotion.System };
// Le contenu d'un onglet arrive en fondu, avec un léger glissement vers le haut.
const PANE_IN = enterUp(10, 240);
const WALLPAPER_IN = enterUp(0, FADE_MS);

export type CustomizeTab = 'look' | 'notifications';
type Target = 'my_bubble' | 'their_bubble';

// Une couleur qui passe en fondu à chaque changement. `instant` : pendant que le doigt tourne la roue,
// la couleur suit sans délai.
function useFadingColor(color: string, instant = false): SharedValue<string> {
  const value = useSharedValue(color);
  useEffect(() => {
    value.set(instant ? color : withTiming(color, FADE));
  }, [color, instant, value]);
  return value;
}

function PreviewBubble({ background, text, label, mine, instant }: { background: string; text: string; label: string; mine: boolean; instant: boolean }) {
  const styles = useStyles();
  const fill = useFadingColor(background, instant);
  const ink = useFadingColor(text, instant);
  const bubbleStyle = useAnimatedStyle(() => ({ backgroundColor: fill.get() }));
  const textStyle = useAnimatedStyle(() => ({ color: ink.get() }));
  return (
    <Reanimated.View style={[styles.previewBubble, mine ? styles.previewMine : styles.previewTheirs, bubbleStyle]}>
      <Reanimated.Text style={[styles.previewText, textStyle]}>{label}</Reanimated.Text>
    </Reanimated.View>
  );
}

function TabLabel({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const ink = useFadingColor(selected ? colors.onAccent : colors.textMuted);
  const textStyle = useAnimatedStyle(() => ({ color: ink.get() }));
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected }} style={styles.tab}>
      <Reanimated.Text style={[styles.tabLabel, textStyle]}>{label}</Reanimated.Text>
    </Pressable>
  );
}

// Deux onglets : la pastille glisse sous l'onglet actif.
function Tabs({ value, onChange }: { value: CustomizeTab; onChange: (tab: CustomizeTab) => void }) {
  const styles = useStyles();
  const width = useSharedValue(0);
  const position = useSharedValue(value === 'look' ? 0 : 1);

  useEffect(() => {
    position.set(timing(value === 'look' ? 0 : 1, FADE_MS));
  }, [value, position]);

  const pillStyle = useAnimatedStyle(() => {
    const half = Math.max(0, (width.get() - TAB_PADDING * 2) / 2);
    return { width: half, opacity: half > 0 ? 1 : 0, transform: [{ translateX: position.get() * half }] };
  });

  return (
    <View style={styles.tabs} accessibilityRole="tablist" onLayout={(event: LayoutChangeEvent) => width.set(event.nativeEvent.layout.width)}>
      <Reanimated.View pointerEvents="none" style={[styles.tabPill, pillStyle]} />
      <TabLabel label={t('perso.apparence')} selected={value === 'look'} onPress={() => onChange('look')} />
      <TabLabel label={t('perso.notifications')} selected={value === 'notifications'} onPress={() => onChange('notifications')} />
    </View>
  );
}

// « Mes bulles » / « Ses bulles » : la puce choisie prend le fond d'accent, en fondu.
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const feedback = usePressFeedback();
  const fill = useFadingColor(selected ? colors.accent : colors.surface);
  const ink = useFadingColor(selected ? colors.onAccent : colors.textMuted);
  const chipStyle = useAnimatedStyle(() => ({ backgroundColor: fill.get() }));
  const textStyle = useAnimatedStyle(() => ({ color: ink.get() }));
  return (
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="radio" accessibilityState={{ selected }}>
      <Reanimated.View style={[styles.chip, chipStyle, feedback.style]}>
        <Reanimated.Text style={[styles.chipLabel, textStyle]}>{label}</Reanimated.Text>
      </Reanimated.View>
    </Pressable>
  );
}

// Une vignette de fond : le contour de la vignette choisie s'allume en fondu.
function WallTile({ label, selected, onPress, children }: { label: string; selected: boolean; onPress: () => void; children?: ReactNode }) {
  const colors = useColors();
  const styles = useStyles();
  const feedback = usePressFeedback();
  const ring = useFadingColor(selected ? colors.text : colors.border);
  const ringStyle = useAnimatedStyle(() => ({ borderColor: ring.get() }));
  return (
    <Pressable
      onPress={onPress}
      onPressIn={feedback.onPressIn}
      onPressOut={feedback.onPressOut}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={styles.tileSlot}
    >
      <Reanimated.View style={[styles.tile, feedback.style]}>
        {children}
        <Reanimated.View pointerEvents="none" style={[styles.tileRing, ringStyle]} />
      </Reanimated.View>
    </Pressable>
  );
}

type Props = {
  contactKey: string;
  name: string;
  onBack: () => void;
  onInfo?: () => void;
  initialTab?: CustomizeTab;
};

// Menu « 3 points » d'une conversation : un aperçu en direct en haut, puis deux onglets.
// Apparence : couleur de chaque bulle (propre à ce téléphone) et fond (partagé avec le contact).
// Notifications : un interrupteur par type de message, et les autorisations du téléphone.
export function CustomizeScreen({ contactKey, name, onBack, onInfo, initialTab = 'look' }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const [tab, setTab] = useState<CustomizeTab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  // La bulle que la roue colore, et la couleur qui suit le doigt avant d'être enregistrée.
  const [target, setTarget] = useState<Target>('my_bubble');
  const [draft, setDraft] = useState<string | null>(null);
  useSyncExternalStore(chat.subscribe, chat.getVersion);

  const settings = getConversationSettings(contactKey);
  // Fond chiffré sur le disque (lot 2.3) : affiché depuis sa copie déchiffrée.
  const wallpaper = useMediaUri(settings.wallpaper_uri, { scope: 'app' });
  const mine = bubblePalette((target === 'my_bubble' && draft) || (settings.my_bubble ?? colors.bubbleMine));
  const theirs = bubblePalette((target === 'their_bubble' && draft) || (settings.their_bubble ?? colors.bubbleTheirs));
  const dragging = draft !== null;

  const setColor = (column: Target, color: string) => {
    setConversationSetting(contactKey, column, color);
    setDraft(null);
    chat.refresh();
  };

  const chooseTarget = (next: Target) => {
    setDraft(null);
    setTarget(next);
  };

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

  const clearWallpaper = () => {
    if (settings.wallpaper_uri) chat.clearWallpaper(contactKey);
  };

  return (
    <Screen>
      <Header title={t('perso.titre')} subtitle={name} onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content} scrollEnabled={!dragging}>
        <View style={styles.preview} accessibilityLabel={t('perso.apercu')}>
          {wallpaper && (
            <Reanimated.View key={wallpaper} entering={WALLPAPER_IN} style={StyleSheet.absoluteFill}>
              <Image source={{ uri: wallpaper }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            </Reanimated.View>
          )}
          <PreviewBubble background={theirs.background} text={theirs.text} label={t('perso.lisible')} mine={false} instant={dragging} />
          <PreviewBubble background={mine.background} text={mine.text} label={t('perso.toutesCouleurs')} mine instant={dragging} />
        </View>

        <Tabs value={tab} onChange={setTab} />

        {tab === 'look' ? (
          <Reanimated.View key="look" entering={PANE_IN} style={styles.pane}>
            <View style={styles.chips} accessibilityRole="radiogroup">
              <Chip label={t('perso.mesBulles')} selected={target === 'my_bubble'} onPress={() => chooseTarget('my_bubble')} />
              <Chip label={t('perso.sesBulles')} selected={target === 'their_bubble'} onPress={() => chooseTarget('their_bubble')} />
            </View>

            <View style={styles.wheelRow}>
              <View style={styles.wheel}>
                <ColorWheel
                  size={WHEEL_SIZE}
                  value={(target === 'my_bubble' ? mine : theirs).background}
                  onPreview={setDraft}
                  onChange={(color) => setColor(target, color)}
                />
              </View>
              <View style={styles.wheelText}>
                <Text style={styles.hint}>{t('perso.roueAide')}</Text>
                <Text style={styles.hint}>{t('perso.couleursLocales')}</Text>
              </View>
            </View>

            <View>
              <Text style={styles.label}>{t('perso.fond')}</Text>
              <View style={styles.tiles} accessibilityRole="radiogroup">
                <WallTile label={t('perso.aucun')} selected={!settings.wallpaper_uri} onPress={clearWallpaper}>
                  <Text style={styles.tileText}>{t('perso.aucun')}</Text>
                </WallTile>
                {wallpaper && (
                  <WallTile label={t('perso.fondActuel')} selected onPress={() => setGalleryOpen(true)}>
                    <Image source={{ uri: wallpaper }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                  </WallTile>
                )}
                <WallTile label={t('perso.galerie')} selected={false} onPress={() => setGalleryOpen(true)}>
                  <ImagePlus size={18} color={colors.text} strokeWidth={1.75} />
                  <Text style={styles.tileText}>{busy ? t('perso.preparation') : t('perso.galerie')}</Text>
                </WallTile>
              </View>
              <Text style={[styles.hint, styles.hintBelow]}>{t('perso.fondPartage')}</Text>
            </View>

            {onInfo && (
              <View style={styles.card}>
                <Pressable onPress={onInfo} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                  <User size={20} color={colors.text} strokeWidth={1.75} />
                  <Text style={styles.rowLabel}>{t('perso.infosContact')}</Text>
                  <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.75} />
                </Pressable>
              </View>
            )}
          </Reanimated.View>
        ) : (
          <Reanimated.View key="notifications" entering={PANE_IN} style={styles.pane}>
            <NotificationsPanel contactKey={contactKey} />
          </Reanimated.View>
        )}
      </ScrollView>
      {galleryOpen && <MediaPicker single onPick={applyWallpaper} onClose={() => setGalleryOpen(false)} />}
    </Screen>
  );
}

const useStyles = createStyles((colors) => ({
  content: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  preview: {
    height: 168,
    justifyContent: 'flex-end',
    gap: 6,
    padding: 14,
    borderRadius: 22,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  previewBubble: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 18,
    maxWidth: '80%',
  },
  previewMine: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: 6,
  },
  previewTheirs: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: 6,
  },
  previewText: {
    fontSize: 14,
  },
  tabs: {
    flexDirection: 'row',
    marginTop: spacing.md,
    padding: TAB_PADDING,
    borderRadius: 16,
    backgroundColor: colors.surface,
  },
  tabPill: {
    position: 'absolute',
    top: TAB_PADDING,
    bottom: TAB_PADDING,
    left: TAB_PADDING,
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  tab: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  pane: {
    gap: spacing.md,
    paddingTop: 18,
  },
  chips: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    justifyContent: 'center',
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  wheelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  wheel: {
    width: WHEEL_SIZE,
  },
  wheelText: {
    flex: 1,
    gap: spacing.sm,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginBottom: spacing.sm,
    marginLeft: 4,
  },
  hint: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
  },
  hintBelow: {
    marginTop: spacing.sm,
    marginHorizontal: 4,
    fontSize: 12,
    lineHeight: 18,
  },
  tiles: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tileSlot: {
    flex: 1,
  },
  tile: {
    height: 64,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
    paddingBottom: 6,
    backgroundColor: colors.surface,
  },
  tileRing: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 14,
    borderWidth: 2,
  },
  tileText: {
    fontSize: 11,
    color: colors.text,
  },
  card: {
    borderRadius: 18,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
  },
  pressed: {
    backgroundColor: colors.elevatedActive,
  },
}));
