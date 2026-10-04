import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useBackHandler } from "../platform";
import { useTheme } from "../theme/ThemeContext";
import { Title } from "./Txt";

/**
 * Centered modal panel with a dimmed backdrop and a spring entrance. Android's back button runs
 * onBack, else onClose; a popup with neither swallows it, so back never leaves the app from a modal.
 */
export function Popup({
  title, children, onClose, onBack, testID, accent, maxHeight = 640,
}: {
  title?: string;
  children: ReactNode;
  onClose?: () => void;
  onBack?: () => void;
  testID?: string;
  accent?: string;
  maxHeight?: number;
}) {
  const t = useTheme();
  const appear = useRef(new Animated.Value(0)).current;
  useBackHandler(() => {
    (onBack ?? onClose)?.();
    return true;
  });
  useEffect(() => {
    Animated.spring(appear, { toValue: 1, useNativeDriver: t.nativeDriver, speed: 14, bounciness: 7 }).start();
  }, [appear, t.nativeDriver]);
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]} testID={testID}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.palette.overlay }]} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.center} pointerEvents="box-none">
        <Animated.View
          style={{
            width: "100%",
            maxWidth: 400,
            maxHeight,
            opacity: appear,
            transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
            backgroundColor: t.palette.surface,
            borderRadius: t.shape.radiusLg,
            borderWidth: t.shape.borderWidth,
            borderColor: accent ?? t.palette.cardBorder,
            overflow: "hidden",
            boxShadow: "0px 10px 30px rgba(0,0,0,0.25)",
          }}
        >
          {title ? (
            <View style={{ backgroundColor: accent ?? t.palette.primary, paddingVertical: 12, paddingHorizontal: 16 }}>
              <Title size={22} color={t.palette.textOnPrimary} align="center">{title}</Title>
            </View>
          ) : null}
          <ScrollView contentContainerStyle={{ padding: 18, gap: 12 }}>{children}</ScrollView>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 } });
