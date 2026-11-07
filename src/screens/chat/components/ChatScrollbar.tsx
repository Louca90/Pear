import { RefObject, useRef, useState } from 'react';
import { dateLocale } from '../../../i18n';
import { Animated, Easing, FlatList, NativeScrollEvent, NativeSyntheticEvent, PanResponder, Text, View } from 'react-native';

import { Message } from '../../../chat/database';
import { createStyles, radius, spacing } from '../../../theme';

const THIN = 4;
const THICK = 8;
const THUMB_MIN = 36;
const GRAB_WIDTH = 24;
const HIDE_AFTER_MS = 1500;
const FADE_MS = 200;

function dateLabel(at: number) {
  return new Date(at).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

// Barre de défilement de la conversation : fine, visible seulement pendant le défilement, puis elle
// s'efface. On peut la saisir : elle s'épaissit, affiche la date de l'endroit visé et fait défiler en
// proportion (la liste est inversée : en bas, l'offset 0 et le message le plus récent).
export function useChatScrollbar(list: RefObject<FlatList<Message> | null>, messages: Message[]) {
  const styles = useStyles();
  const metrics = useRef({ offset: 0, content: 1, layout: 1 });
  const [trackHeight, setTrackHeight] = useState(0);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const shown = useRef(new Animated.Value(0)).current;
  const position = useRef(new Animated.Value(0)).current;
  const thickness = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dragging = useRef(false);
  const visible = useRef(false);
  const latest = useRef({ messages, trackHeight });
  latest.current = { messages, trackHeight };

  const thumbHeight = () => {
    const { content, layout } = metrics.current;
    return Math.max(THUMB_MIN, (layout / Math.max(content, 1)) * latest.current.trackHeight);
  };

  const show = () => {
    clearTimeout(hideTimer.current);
    visible.current = true;
    Animated.timing(shown, { toValue: 1, duration: FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    hideTimer.current = setTimeout(() => {
      if (dragging.current) return;
      visible.current = false;
      Animated.timing(shown, { toValue: 0, duration: FADE_MS * 2, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, HIDE_AFTER_MS);
  };

  // 0 = en bas (le plus récent), 1 = tout en haut de ce qui est chargé.
  const placeThumb = (ratio: number) => {
    const travel = Math.max(0, latest.current.trackHeight - thumbHeight());
    position.setValue((1 - ratio) * travel);
  };

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    metrics.current = { offset: contentOffset.y, content: contentSize.height, layout: layoutMeasurement.height };
    const scrollable = contentSize.height - layoutMeasurement.height;
    if (scrollable <= 0) return;
    if (!dragging.current) placeThumb(Math.min(1, Math.max(0, contentOffset.y / scrollable)));
    show();
  };

  const seek = (y: number) => {
    const { trackHeight: height, messages: current } = latest.current;
    const ratio = 1 - Math.min(1, Math.max(0, (y - thumbHeight() / 2) / Math.max(1, height - thumbHeight())));
    const { content, layout } = metrics.current;
    list.current?.scrollToOffset({ offset: ratio * Math.max(0, content - layout), animated: false });
    placeThumb(ratio);
    const message = current[Math.round(ratio * (current.length - 1))];
    if (message) setDragLabel(dateLabel(message.created_at));
  };

  const grab = useRef(
    PanResponder.create({
      // Seulement quand la barre est visible : ailleurs, le bord reste au geste de réponse.
      onStartShouldSetPanResponder: () => visible.current,
      onPanResponderGrant: (event) => {
        dragging.current = true;
        Animated.timing(thickness, { toValue: 1, duration: FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
        seek(event.nativeEvent.locationY);
      },
      onPanResponderMove: (event) => seek(event.nativeEvent.locationY),
      onPanResponderRelease: () => {
        dragging.current = false;
        setDragLabel(null);
        Animated.timing(thickness, { toValue: 0, duration: FADE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
        show();
      },
      onPanResponderTerminate: () => {
        dragging.current = false;
        setDragLabel(null);
        Animated.timing(thickness, { toValue: 0, duration: FADE_MS, useNativeDriver: false }).start();
      },
    }),
  ).current;

  const scrollbar = (
    <Animated.View
      style={[styles.track, { opacity: shown }]}
      onLayout={(event) => setTrackHeight(event.nativeEvent.layout.height)}
      {...grab.panHandlers}
    >
      <Animated.View style={[styles.thumbArea, { height: thumbHeight(), transform: [{ translateY: position }] }]}>
        {dragLabel && (
          <View style={styles.label}>
            <Text style={styles.labelText}>{dragLabel}</Text>
          </View>
        )}
        <Animated.View style={[styles.thumb, { width: thickness.interpolate({ inputRange: [0, 1], outputRange: [THIN, THICK] }) }]} />
      </Animated.View>
    </Animated.View>
  );

  return { onScroll, scrollbar };
}

const useStyles = createStyles((colors) => ({
  track: {
    position: 'absolute',
    top: spacing.sm,
    bottom: spacing.sm,
    right: 0,
    width: GRAB_WIDTH,
  },
  thumbArea: {
    position: 'absolute',
    right: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  thumb: {
    height: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.textMuted,
  },
  label: {
    position: 'absolute',
    right: THICK + spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.elevated,
    boxShadow: `0px 2px 10px ${colors.shadow}`,
  },
  labelText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
}));
