import { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { createStyles, radius } from '../theme';

const PADDING = 4;
const SLIDE_MS = 260;
// Démarre vite et se pose doucement, sans dépasser.
const SLIDE_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

// Choix exclusif sur une ligne : la pastille glisse jusqu'à l'option choisie.
export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  const styles = useStyles();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const position = useSharedValue(index);
  const itemWidth = width > 0 ? (width - PADDING * 2) / options.length : 0;

  useEffect(() => {
    position.set(withTiming(index, { duration: SLIDE_MS, easing: SLIDE_EASING }));
  }, [index, position]);

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: position.get() * itemWidth }] }));
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  return (
    <View style={styles.track} onLayout={onLayout} accessibilityRole="radiogroup">
      {itemWidth > 0 && (
        <Reanimated.View pointerEvents="none" style={[styles.thumb, { width: itemWidth }, thumbStyle]} />
      )}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={styles.item}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = createStyles((colors) => ({
  track: {
    flexDirection: 'row',
    padding: PADDING,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  thumb: {
    position: 'absolute',
    top: PADDING,
    bottom: PADDING,
    left: PADDING,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  item: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 15,
    color: colors.text,
  },
  labelSelected: {
    color: colors.onAccent,
    fontWeight: '600',
  },
}));
