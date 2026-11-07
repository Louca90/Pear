import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { t, TextKey } from '../../i18n';
import { log } from '../../log';
import { createMediaStyles, radius, spacing } from '../../theme';

const OPEN_MS = 240;
const CLOSE_MS = 180;
const EASING = Easing.bezier(0.2, 0.8, 0.2, 1);
const COLUMNS = 7;

const CATEGORIES: { label: TextKey; emojis: string }[] = [
  { label: 'editeur.stickersVisages', emojis: '😀 😂 🥹 😍 🥰 😘 😎 🤩 🥳 😜 🤪 😇 🙃 😉 😴 🤯 😱 🥶 🥵 😭 😤 🤔 🫠 🤫 🤭 😏 😬 🙄 😮 🤗 😈 👻 💀 🤡 👽 🤖' },
  { label: 'editeur.stickersGestes', emojis: '👍 👎 👏 🙌 🫶 🙏 💪 🤝 ✌️ 🤞 🤟 🤘 👌 🤌 👋 ✋ 👀 💅 🫡 🤙 👉 👈 ☝️ 🫵' },
  { label: 'editeur.stickersCoeurs', emojis: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💖 💘 💝 💕 💞 💓 💗 💔 ❤️‍🔥 💋 💌' },
  { label: 'editeur.stickersNature', emojis: '🐶 🐱 🐻 🐼 🦊 🐸 🐵 🦁 🐯 🐨 🐰 🐧 🦄 🐝 🦋 🐢 🐬 🌸 🌻 🌈 ☀️ 🌙 ⭐ ⚡ 🔥 ❄️ 🌊 🍀 🌴 🌵' },
  { label: 'editeur.stickersNourriture', emojis: '🍕 🍔 🍟 🌮 🍣 🍜 🍩 🍪 🍰 🎂 🍫 🍿 🍓 🍉 🍑 🥑 🍒 ☕ 🧋 🍺 🍷 🥂 🍾 🍦' },
  { label: 'editeur.stickersFete', emojis: '🎉 🎊 🎈 🎁 🏆 🥇 ⚽ 🏀 🎮 🎧 🎤 🎸 📸 🎬 ✈️ 🚗 🏖️ 🏔️ 🌍 💯 ✨ 💥 💤 💬 ✅ ❌ ❓ ❗ 🔒 📍' },
];

type Props = { bottom: number; onPick: (emoji: string) => void; onClose: () => void };

// La feuille des stickers, qui monte du bas : les catégories en haut, les emojis en grille.
// Toucher un emoji le pose au milieu de l'image et referme la feuille.
export function StickerPicker({ bottom, onPick, onClose }: Props) {
  const styles = useStyles();
  const { width, height } = useWindowDimensions();
  const [category, setCategory] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const cell = (width - spacing.md * 2) / COLUMNS;

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: OPEN_MS, easing: EASING, useNativeDriver: true }).start();
  }, [progress]);

  const close = (then?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: CLOSE_MS, easing: EASING, useNativeDriver: true }).start(() => {
      then?.();
      onClose();
    });
  };

  const pick = (emoji: string) => {
    Haptics.selectionAsync().catch((e) => log.warn('vibration', e));
    close(() => onPick(emoji));
  };

  const sheetHeight = height * 0.5;

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close()} accessibilityLabel={t('commun.fermer')} />
      </Animated.View>
      <Animated.View style={[styles.sheet, { height: sheetHeight + bottom, paddingBottom: bottom, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [sheetHeight + bottom, 0] }) }] }]}>
        <View style={styles.handle} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={styles.tabsScroll}>
          {CATEGORIES.map(({ label, emojis }, index) => (
            <Pressable
              key={label}
              onPress={() => setCategory(index)}
              accessibilityLabel={t(label)}
              accessibilityState={{ selected: index === category }}
              style={[styles.tab, index === category && styles.tabOn]}
            >
              <Text style={styles.tabEmoji}>{emojis.split(' ')[0]}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text style={styles.title}>{t(CATEGORIES[category].label)}</Text>
        <ScrollView contentContainerStyle={styles.grid}>
          {CATEGORIES[category].emojis.split(' ').map((emoji) => (
            <Pressable key={emoji} onPress={() => pick(emoji)} style={({ pressed }) => [{ width: cell, height: cell }, styles.cell, pressed && styles.pressed]} accessibilityLabel={emoji}>
              <Text style={styles.emoji}>{emoji}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const useStyles = createMediaStyles((colors) => ({
  backdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: 'rgba(24, 24, 26, 0.96)',
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.onDarkMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  tabsScroll: {
    flexGrow: 0,
  },
  tabs: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  tab: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabOn: {
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  tabEmoji: {
    fontSize: 24,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.onDarkMuted,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: 4,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: 32,
  },
  pressed: {
    opacity: 0.5,
    transform: [{ scale: 0.9 }],
  },
}));
