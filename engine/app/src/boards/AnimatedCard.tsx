import { memo, useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet } from "react-native";
import { SvgXml } from "react-native-svg";
import { useTheme } from "../theme/ThemeContext";

export type CardPose = { x: number; y: number; z: number; faceUp: boolean; visible: boolean };

type Props = {
  pose: CardPose;
  index: number;
  width: number;
  height: number;
  selected: boolean;
  hinted: boolean;
  shakeKey: number;
  testID: string;
  label: string;
  faceColor: string;
  borderColor: string;
  onPress: (index: number) => void;
  children: ReactNode;
};

/**
 * Shared animated card shell for every board: moves, flips, lifts when selected, shakes on a
 * wrong move and pulses for hints. Boards only supply the face content.
 */
function AnimatedCardImpl({ pose, index, width, height, selected, hinted, shakeKey, testID, label, faceColor, borderColor, onPress, children }: Props) {
  const t = useTheme();
  const native = t.nativeDriver;
  const pos = useRef(new Animated.ValueXY({ x: pose.x, y: pose.y })).current;
  const opacity = useRef(new Animated.Value(pose.visible ? 1 : 0)).current;
  const flip = useRef(new Animated.Value(pose.faceUp ? 1 : 0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(pos, { toValue: { x: pose.x, y: pose.y }, duration: t.animation.cardMoveMs, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
      Animated.timing(opacity, { toValue: pose.visible ? 1 : 0, duration: t.animation.cardMoveMs, useNativeDriver: native }),
    ]).start();
  }, [pose.x, pose.y, pose.visible, pos, opacity, t.animation.cardMoveMs, native]);

  useEffect(() => {
    Animated.timing(flip, { toValue: pose.faceUp ? 1 : 0, duration: t.animation.cardFlipMs, useNativeDriver: native }).start();
  }, [pose.faceUp, flip, t.animation.cardFlipMs, native]);

  useEffect(() => {
    Animated.spring(lift, { toValue: selected ? -7 : 0, useNativeDriver: native, speed: 30, bounciness: 6 }).start();
  }, [selected, lift, native]);

  useEffect(() => {
    if (!shakeKey || !t.animation.mismatchShake) return;
    const step = (to: number) => Animated.timing(shake, { toValue: to, duration: 45, useNativeDriver: native });
    Animated.sequence([step(-7), step(7), step(-5), step(5), step(0)]).start();
  }, [shakeKey, shake, native, t.animation.mismatchShake]);

  useEffect(() => {
    if (!hinted) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: native }),
        Animated.timing(pulse, { toValue: 0.2, duration: 500, useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [hinted, pulse, native]);

  const scaleX = flip.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 0.02, 1] });
  const faceOpacity = flip.interpolate({ inputRange: [0.49, 0.51], outputRange: [0, 1], extrapolate: "clamp" });
  const backOpacity = flip.interpolate({ inputRange: [0.49, 0.51], outputRange: [1, 0], extrapolate: "clamp" });
  const radius = t.shape.cardRadius * (width < 50 ? 0.6 : 1);
  const back = t.cards.backAsset ? t.assets[t.cards.backAsset] : undefined;
  const shadow = t.cards.shadow === "none" ? undefined : t.cards.shadow === "hard" ? "0px 3px 0px rgba(0,0,0,0.22)" : "0px 2px 6px rgba(0,0,0,0.22)";

  return (
    <Animated.View
      pointerEvents={pose.visible ? "auto" : "none"}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height,
        zIndex: pose.z,
        opacity,
        transform: [{ translateX: Animated.add(pos.x, shake) }, { translateY: Animated.add(pos.y, lift) }, { scaleX }],
      }}
    >
      <Pressable testID={testID} accessibilityLabel={pose.faceUp ? label : "face-down card"} onPress={() => onPress(index)} style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backOpacity, borderRadius: radius, overflow: "hidden", backgroundColor: t.palette.cardBack, boxShadow: shadow }]}>
          {back?.type === "svg" ? <SvgXml xml={back.xml} width={width} height={height} /> : null}
        </Animated.View>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              opacity: faceOpacity,
              borderRadius: radius,
              overflow: "hidden",
              backgroundColor: faceColor,
              borderWidth: selected ? 3 : t.shape.borderWidth,
              borderColor: selected ? t.palette.accent : borderColor,
              boxShadow: shadow,
            },
          ]}
        >
          {children}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 3, borderColor: t.palette.warning, opacity: pulse }]} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

export const AnimatedCard = memo(AnimatedCardImpl);
