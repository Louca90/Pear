import { ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { Image, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { ImagePlus, Plus } from 'lucide-react-native';
import Reanimated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { getContactProfile, getConversationSettings, setConversationSetting } from '../chat/database';
import { chat, PickedFile } from '../chat/manager';
import { useMediaUri } from '../chat/media';
import { showDialog } from '../components/dialog';
import { MediaPicker } from '../components/MediaPicker';
import { resizeImage } from '../../modules/pear-native';
import { log } from '../log';
import { Avatar, Header, Screen, usePressFeedback } from '../components/ui';
import { ColorWheel } from '../components/ColorWheel';
import { haptics } from '../haptics';
import { EASE, enterUp, timing } from '../motion';
import { NotificationsPanel } from './NotificationSettingsScreen';
import { bubblePalette, createStyles, radius, spacing, useColors } from '../theme';
import { t } from '../i18n';

// Le fond voyage sur le réseau : une image moins lourde arrive plus vite, sans perte visible en plein écran.
const WALLPAPER_MAX_SIZE = 2048;
const WALLPAPER_QUALITY = 80;
const WHEEL_SIZE = 168;
const TAB_PADDING = 4;
// Fondu des couleurs et glissement de la pastille : sous 300 ms, sans rebond.
const FADE_MS = 260;
const FADE = { duration: FADE_MS, easing: EASE, reduceMotion: ReduceMotion.System };
const PANE_IN = enterUp(10, 240);
const WALLPAPER_IN = enterUp(0, FADE_MS);
// Les teintes proposées d'un appui (en plus des deux couleurs par défaut du thème) ; la roue fait le reste.
const HUES = ['#B4CC68', '#6FB7C9', '#7FA2E0', '#9C8CE0', '#E08CB8', '#E08C8C', '#E0A88C', '#E0C68C'];

export type CustomizeTab = 'look' | 'wall' | 'notifications';
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

// Une bulle de l'aperçu, aux coins de groupe de la vraie conversation (petit coin côté auteur).
function PreviewBubble({ background, text, label, mine, first, instant, index }: { background: string; text: string; label: string; mine: boolean; first: boolean; instant: boolean; index: number }) {
  const styles = useStyles();
  const fill = useFadingColor(background, instant);
  const ink = useFadingColor(text, instant);
  const bubbleStyle = useAnimatedStyle(() => ({ backgroundColor: fill.get() }));
  const textStyle = useAnimatedStyle(() => ({ color: ink.get() }));
  const corners = mine ? (first ? styles.mineFirst : styles.mineNext) : first ? styles.theirsFirst : styles.theirsNext;
  return (
    <Reanimated.View entering={enterUp(8, 300, index * 60)} style={[styles.previewBubble, mine ? styles.previewMine : styles.previewTheirs, corners, bubbleStyle]}>
      <Reanimated.Text style={[styles.previewText, textStyle]}>{label}</Reanimated.Text>
    </Reanimated.View>
  );
}

const TABS: { id: CustomizeTab; label: string }[] = [
  { id: 'look', label: t('perso.bulles') },
  { id: 'wall', label: t('perso.fondCourt') },
  { id: 'notifications', label: t('perso.notifications') },
];

function TabLabel({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const ink = useFadingColor(selected ? colors.background : colors.textMuted);
  const textStyle = useAnimatedStyle(() => ({ color: ink.get() }));
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected }} style={styles.tab}>
      <Reanimated.Text style={[styles.tabLabel, textStyle]} numberOfLines={1}>
        {label}
      </Reanimated.Text>
    </Pressable>
  );
}

// Trois onglets : la pastille claire glisse sous l'onglet actif.
function Tabs({ value, onChange }: { value: CustomizeTab; onChange: (tab: CustomizeTab) => void }) {
  const styles = useStyles();
  const width = useSharedValue(0);
  const index = Math.max(0, TABS.findIndex(({ id }) => id === value));
  const position = useSharedValue(index);
  useEffect(() => {
    position.set(timing(index, FADE_MS));
  }, [index, position]);
  const pillStyle = useAnimatedStyle(() => {
    const slot = Math.max(0, (width.get() - TAB_PADDING * 2) / TABS.length);
    return { width: slot, opacity: slot > 0 ? 1 : 0, transform: [{ translateX: position.get() * slot }] };
  });
  return (
    <View style={styles.tabs} accessibilityRole="tablist" onLayout={(event: LayoutChangeEvent) => width.set(event.nativeEvent.layout.width)}>
      <Reanimated.View pointerEvents="none" style={[styles.tabPill, pillStyle]} />
      {TABS.map((tab) => (
        <TabLabel key={tab.id} label={tab.label} selected={tab.id === value} onPress={() => onChange(tab.id)} />
      ))}
    </View>
  );
}

// « Mes bulles » / « Ses bulles » : une carte avec un échantillon « Aa » dans la couleur de la bulle ;
// la carte choisie est cerclée de vert.
function TargetCard({ label, palette, selected, onPress }: { label: string; palette: { background: string; text: string }; selected: boolean; onPress: () => void }) {
  const colors = useColors();
  const styles = useStyles();
  const feedback = usePressFeedback();
  const ring = useFadingColor(selected ? colors.signatureStrong : 'rgba(0, 0, 0, 0)');
  const fill = useFadingColor(palette.background);
  const ink = useFadingColor(palette.text);
  const ringStyle = useAnimatedStyle(() => ({ borderColor: ring.get() }));
  const sampleStyle = useAnimatedStyle(() => ({ backgroundColor: fill.get() }));
  const sampleText = useAnimatedStyle(() => ({ color: ink.get() }));
  return (
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label} style={styles.flex}>
      <Reanimated.View style={[styles.target, feedback.style]}>
        <Reanimated.View style={[styles.sample, sampleStyle]}>
          <Reanimated.Text style={[styles.sampleText, sampleText]}>Aa</Reanimated.Text>
        </Reanimated.View>
        <Text style={styles.targetLabel}>{label}</Text>
        <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.targetRing, ringStyle]} />
      </Reanimated.View>
    </Pressable>
  );
}

// Une pastille de couleur : la choisie grossit un peu et prend un anneau vert.
function Swatch({ color, selected, onPress }: { color: string; selected: boolean; onPress: () => void }) {
  const styles = useStyles();
  const on = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    on.set(timing(selected ? 1 : 0, 200));
  }, [selected, on]);
  const grow = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.12 * on.get() }] }));
  const ring = useAnimatedStyle(() => ({ opacity: on.get() }));
  return (
    <Pressable onPress={onPress} hitSlop={4} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={t('perso.couleur', { couleur: color })}>
      <Reanimated.View style={grow}>
        <Reanimated.View pointerEvents="none" style={[styles.swatchRing, ring]} />
        <View style={[styles.swatch, { backgroundColor: color }]} />
      </Reanimated.View>
    </Pressable>
  );
}

// Une vignette de fond : le contour de la vignette choisie s'allume en vert.
function WallTile({ label, selected, onPress, children }: { label: string; selected: boolean; onPress: () => void; children?: ReactNode }) {
  const colors = useColors();
  const styles = useStyles();
  const feedback = usePressFeedback();
  const ring = useFadingColor(selected ? colors.signatureStrong : colors.border);
  const ringStyle = useAnimatedStyle(() => ({ borderColor: ring.get() }));
  return (
    <Pressable onPress={onPress} onPressIn={feedback.onPressIn} onPressOut={feedback.onPressOut} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected }} style={styles.flex}>
      <Reanimated.View style={[styles.tile, feedback.style]}>
        {children}
        <Text style={styles.tileText} numberOfLines={1}>
          {label}
        </Text>
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

// Personnaliser une conversation (planche « Personnaliser ») : un grand aperçu vivant (en-tête, bulles
// groupées, fond), puis trois onglets. Bulles : couleur de chaque côté (propre à ce téléphone). Fond :
// partagé avec le contact. Notifications : un interrupteur par type de message.
export function CustomizeScreen({ contactKey, name, onBack, initialTab = 'look' }: Props) {
  const colors = useColors();
  const styles = useStyles();
  const [tab, setTab] = useState<CustomizeTab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [target, setTarget] = useState<Target>('my_bubble');
  const [draft, setDraft] = useState<string | null>(null);
  useSyncExternalStore(chat.subscribe, chat.getVersion);

  const settings = getConversationSettings(contactKey);
  // Fond chiffré sur le disque (lot 2.3) : affiché depuis sa copie déchiffrée.
  const wallpaper = useMediaUri(settings.wallpaper_uri, { scope: 'app' });
  const mine = bubblePalette((target === 'my_bubble' && draft) || (settings.my_bubble ?? colors.bubbleMine));
  const theirs = bubblePalette((target === 'their_bubble' && draft) || (settings.their_bubble ?? colors.bubbleTheirs));
  const dragging = draft !== null;
  const current = (target === 'my_bubble' ? mine : theirs).background;
  const swatches = [colors.bubbleMine, colors.bubbleTheirs, ...HUES];

  const setColor = (column: Target, color: string | null) => {
    setConversationSetting(contactKey, column, color);
    setDraft(null);
    chat.refresh();
  };

  const pickSwatch = (color: string) => {
    haptics.select();
    // La couleur par défaut du thème : on efface le réglage (elle suivra le thème clair ou sombre).
    const isDefault = color === (target === 'my_bubble' ? colors.bubbleMine : colors.bubbleTheirs);
    setColor(target, isDefault ? null : color);
  };

  const reset = () => {
    haptics.action();
    setConversationSetting(contactKey, 'my_bubble', null);
    setConversationSetting(contactKey, 'their_bubble', null);
    setDraft(null);
    chat.refresh();
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
      await chat.setWallpaper(contactKey, { uri, name: 'fond.jpg', size: new File(uri).size ?? 0, mime: 'image/jpeg', kind: 'wallpaper' });
    } catch (e) {
      showDialog(t('perso.fondNonApplique'), String(e));
    } finally {
      setBusy(false);
    }
  };

  const clearWallpaper = () => {
    if (settings.wallpaper_uri) chat.clearWallpaper(contactKey);
  };

  const resetButton = (
    <Pressable onPress={reset} accessibilityRole="button" hitSlop={6} style={({ pressed }) => [styles.reset, pressed && styles.pressed]}>
      <Text style={styles.resetLabel}>{t('perso.parDefaut')}</Text>
    </Pressable>
  );

  return (
    <Screen>
      <Header title={t('perso.titre')} subtitle={name} onBack={onBack} action={resetButton} />
      <ScrollView contentContainerStyle={styles.content} scrollEnabled={!dragging}>
        <View style={styles.preview} accessibilityLabel={t('perso.apercu')}>
          {wallpaper && (
            <Reanimated.View key={wallpaper} entering={WALLPAPER_IN} style={StyleSheet.absoluteFill}>
              <Image source={{ uri: wallpaper }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            </Reanimated.View>
          )}
          <View style={styles.previewHeader}>
            <Avatar uri={getContactProfile(contactKey).photo_uri} size={26} />
            <Text style={styles.previewName} numberOfLines={1}>
              {name}
            </Text>
          </View>
          <View style={styles.previewBody}>
            <View style={styles.dayPill}>
              <Text style={styles.dayText}>{t('perso.aujourdhui')}</Text>
            </View>
            <PreviewBubble index={0} background={theirs.background} text={theirs.text} label={t('perso.apercu1')} mine={false} first instant={dragging} />
            <PreviewBubble index={1} background={theirs.background} text={theirs.text} label={t('perso.apercu2')} mine={false} first={false} instant={dragging} />
            <PreviewBubble index={2} background={mine.background} text={mine.text} label={t('perso.apercu3')} mine first instant={dragging} />
            <PreviewBubble index={3} background={mine.background} text={mine.text} label={t('perso.apercu4')} mine first={false} instant={dragging} />
          </View>
        </View>

        <Tabs value={tab} onChange={setTab} />

        {tab === 'look' && (
          <Reanimated.View key="look" entering={PANE_IN} style={styles.pane}>
            <View style={styles.targets} accessibilityRole="radiogroup">
              <TargetCard label={t('perso.mesBulles')} palette={mine} selected={target === 'my_bubble'} onPress={() => setTarget('my_bubble')} />
              <TargetCard label={t('perso.sesBulles')} palette={theirs} selected={target === 'their_bubble'} onPress={() => setTarget('their_bubble')} />
            </View>
            <View style={styles.swatches} accessibilityRole="radiogroup">
              {swatches.map((color) => (
                <Swatch key={color} color={color} selected={color.toLowerCase() === current.toLowerCase()} onPress={() => pickSwatch(color)} />
              ))}
              <Pressable onPress={() => setWheelOpen((open) => !open)} accessibilityRole="button" accessibilityState={{ expanded: wheelOpen }} accessibilityLabel={t('perso.couleurExacte')} style={[styles.more, wheelOpen && styles.moreOn]}>
                <Plus size={18} color={wheelOpen ? colors.background : colors.text} strokeWidth={2} />
              </Pressable>
            </View>
            {wheelOpen && (
              <Reanimated.View entering={enterUp(10, 240)} style={styles.wheel}>
                <ColorWheel size={WHEEL_SIZE} value={current} onPreview={setDraft} onChange={(color) => setColor(target, color)} />
              </Reanimated.View>
            )}
            <Text style={styles.hint}>{t('perso.lisibleAide')}</Text>
          </Reanimated.View>
        )}

        {tab === 'wall' && (
          <Reanimated.View key="wall" entering={PANE_IN} style={styles.pane}>
            <View style={styles.tiles} accessibilityRole="radiogroup">
              <WallTile label={t('perso.aucun')} selected={!settings.wallpaper_uri} onPress={clearWallpaper} />
              {wallpaper && (
                <WallTile label={t('perso.fondActuel')} selected onPress={() => setGalleryOpen(true)}>
                  <Image source={{ uri: wallpaper }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                </WallTile>
              )}
              <WallTile label={busy ? t('perso.preparation') : t('perso.galerie')} selected={false} onPress={() => setGalleryOpen(true)}>
                <View style={styles.tileIcon}>
                  <ImagePlus size={22} color={colors.text} strokeWidth={1.75} />
                </View>
              </WallTile>
            </View>
            <Text style={styles.hint}>{t('perso.fondPartage')}</Text>
          </Reanimated.View>
        )}

        {tab === 'notifications' && (
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
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingTop: 4, paddingBottom: spacing.lg },
  preview: {
    height: 300,
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.elevated,
    opacity: 0.94,
  },
  previewName: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.text },
  previewBody: { flex: 1, justifyContent: 'flex-end', gap: 3, padding: 12 },
  dayPill: { alignSelf: 'center', marginBottom: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, backgroundColor: colors.elevated },
  dayText: { fontSize: 10, color: colors.textMuted },
  previewBubble: { paddingHorizontal: 12, paddingVertical: 8, maxWidth: '72%', borderRadius: 18 },
  previewMine: { alignSelf: 'flex-end' },
  previewTheirs: { alignSelf: 'flex-start' },
  theirsFirst: { borderBottomLeftRadius: 6 },
  theirsNext: { borderTopLeftRadius: 6 },
  mineFirst: { borderBottomRightRadius: 6 },
  mineNext: { borderTopRightRadius: 6 },
  previewText: { fontSize: 13 },
  tabs: { flexDirection: 'row', marginTop: 14, padding: TAB_PADDING, borderRadius: 16, backgroundColor: colors.surface },
  tabPill: { position: 'absolute', top: TAB_PADDING, bottom: TAB_PADDING, left: TAB_PADDING, borderRadius: 12, backgroundColor: colors.text },
  tab: { flex: 1, height: 40, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { fontSize: 13, fontWeight: '600' },
  pane: { paddingTop: spacing.md, gap: 14 },
  targets: { flexDirection: 'row', gap: 10 },
  target: { height: 92, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.surface },
  targetRing: { borderRadius: 18, borderWidth: 2 },
  sample: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14 },
  sampleText: { fontSize: 14, fontWeight: '600' },
  targetLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  swatchRing: { position: 'absolute', top: -5, left: -5, right: -5, bottom: -5, borderRadius: 23, borderWidth: 2, borderColor: colors.signatureStrong },
  more: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  moreOn: { backgroundColor: colors.text },
  wheel: { alignItems: 'center', paddingVertical: spacing.sm },
  hint: { marginHorizontal: 2, fontSize: 12, lineHeight: 18, color: colors.textMuted },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { height: 120, borderRadius: 16, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 10, backgroundColor: colors.surface },
  tileIcon: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontSize: 12, fontWeight: '600', color: colors.text },
  tileRing: { ...StyleSheet.absoluteFill, borderRadius: 16, borderWidth: 2 },
  reset: { height: 34, paddingHorizontal: 12, borderRadius: radius.full, justifyContent: 'center', backgroundColor: colors.surface },
  resetLabel: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
}));
