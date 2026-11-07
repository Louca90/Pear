import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { Hsv, hexToHsv, hsvToHex } from '../colorMath';
import { createStyles, radius, useColors } from '../theme';

const WEDGES = 90;
const THUMB = 26;
const SLIDER_HEIGHT = 28;

// Une part de la roue, un peu plus large que nécessaire pour ne pas laisser de fil entre deux parts.
function wedge(center: number, index: number) {
  const step = (Math.PI * 2) / WEDGES;
  const start = index * step - Math.PI / 2;
  const end = start + step + 0.01;
  const point = (angle: number) => `${center + center * Math.cos(angle)} ${center + center * Math.sin(angle)}`;
  return `M${center} ${center}L${point(start)}A${center} ${center} 0 0 1 ${point(end)}Z`;
}

// Roue de couleurs : on fait glisser le rond (teinte autour, couleurs plus pâles vers le centre), et la
// barre en dessous assombrit jusqu'au noir. `onPreview` suit le doigt, `onChange` part au relâché.
export function ColorWheel({ value, size, onPreview, onChange }: { value: string; size: number; onPreview: (hex: string) => void; onChange: (hex: string) => void }) {
  const colors = useColors();
  const styles = useStyles();
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const latest = useRef(hsv);
  latest.current = hsv;
  const callbacks = useRef({ onPreview, onChange });
  callbacks.current = { onPreview, onChange };
  const sliderWidth = useRef(size);

  // Une autre couleur choisie ailleurs (l'autre bulle) : la roue s'y place.
  useEffect(() => {
    if (hsvToHex(latest.current) !== value.toUpperCase()) setHsv(hexToHsv(value));
  }, [value]);

  const wedges = useMemo(() => Array.from({ length: WEDGES }, (_, index) => wedge(size / 2, index)), [size]);

  const update = (next: Hsv, done: boolean) => {
    setHsv(next);
    latest.current = next;
    const hex = hsvToHex(next);
    if (done) callbacks.current.onChange(hex);
    else callbacks.current.onPreview(hex);
  };

  const fromWheel = (x: number, y: number, done: boolean) => {
    const dx = x - size / 2;
    const dy = y - size / 2;
    const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360;
    const s = Math.min(1, Math.hypot(dx, dy) / (size / 2));
    // Toucher la roue rend la couleur visible même si elle était très sombre.
    update({ h, s, v: Math.max(latest.current.v, 0.35) }, done);
  };

  const fromSlider = (x: number, done: boolean) => update({ ...latest.current, v: Math.min(1, Math.max(0, x / sliderWidth.current)) }, done);

  const wheelPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: ({ nativeEvent }) => fromWheel(nativeEvent.locationX, nativeEvent.locationY, false),
      onPanResponderMove: ({ nativeEvent }) => fromWheel(nativeEvent.locationX, nativeEvent.locationY, false),
      onPanResponderRelease: ({ nativeEvent }) => fromWheel(nativeEvent.locationX, nativeEvent.locationY, true),
    }),
  ).current;
  const sliderPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: ({ nativeEvent }) => fromSlider(nativeEvent.locationX, false),
      onPanResponderMove: ({ nativeEvent }) => fromSlider(nativeEvent.locationX, false),
      onPanResponderRelease: ({ nativeEvent }) => fromSlider(nativeEvent.locationX, true),
    }),
  ).current;

  const angle = ((hsv.h - 90) * Math.PI) / 180;
  const distance = (hsv.s * size) / 2;
  const hex = hsvToHex(hsv);
  const bright = hsvToHex({ ...hsv, v: 1 });

  return (
    <View style={styles.wrapper}>
      <View style={{ width: size, height: size }} {...wheelPan.panHandlers}>
        <Svg width={size} height={size} pointerEvents="none">
          <Defs>
            <RadialGradient id="pale" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          {wedges.map((d, index) => (
            <Path key={index} d={d} fill={`hsl(${(index * 360) / WEDGES}, 100%, 50%)`} />
          ))}
          <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#pale)" />
          <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="#000000" opacity={1 - hsv.v} />
        </Svg>
        <View
          pointerEvents="none"
          style={[
            styles.thumb,
            { backgroundColor: hex, left: size / 2 + distance * Math.cos(angle) - THUMB / 2, top: size / 2 + distance * Math.sin(angle) - THUMB / 2 },
          ]}
        />
      </View>
      <View
        style={styles.slider}
        onLayout={({ nativeEvent }) => (sliderWidth.current = nativeEvent.layout.width)}
        {...sliderPan.panHandlers}
      >
        <Svg width="100%" height={SLIDER_HEIGHT} pointerEvents="none">
          <Defs>
            <LinearGradient id="dark" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#000000" />
              <Stop offset="1" stopColor={bright} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height={SLIDER_HEIGHT} rx={SLIDER_HEIGHT / 2} fill="url(#dark)" stroke={colors.border} strokeWidth={1} />
        </Svg>
        <View pointerEvents="none" style={[styles.thumb, styles.sliderThumb, { backgroundColor: hex, left: `${hsv.v * 100}%` }]} />
      </View>
    </View>
  );
}

const useStyles = createStyles(() => ({
  wrapper: {
    alignItems: 'center',
    gap: 16,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: radius.full,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    boxShadow: '0px 1px 4px rgba(0, 0, 0, 0.35)',
  },
  slider: {
    alignSelf: 'stretch',
    height: SLIDER_HEIGHT,
    justifyContent: 'center',
  },
  sliderThumb: {
    top: (SLIDER_HEIGHT - THUMB) / 2,
    marginLeft: -THUMB / 2,
  },
}));
