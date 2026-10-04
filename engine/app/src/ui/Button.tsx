import { useRef, type ReactNode } from "react";
import { Animated, Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { Title } from "./Txt";

type Variant = "primary" | "secondary" | "accent" | "ghost";

export function Button({
  label, onPress, variant = "primary", disabled, icon, testID, style, size = "md",
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  icon?: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  size?: "sm" | "md" | "lg";
}) {
  const t = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const bg = { primary: t.palette.primary, secondary: t.palette.secondary, accent: t.palette.accent, ghost: "transparent" }[variant];
  const fg = variant === "ghost" ? t.palette.text : variant === "accent" ? t.palette.text : t.palette.textOnPrimary;
  const pad = { sm: 8, md: 12, lg: 16 }[size];
  const font = { sm: 15, md: 18, lg: 22 }[size];
  const press = (to: number) => Animated.spring(scale, { toValue: to, useNativeDriver: t.nativeDriver, speed: 40, bounciness: 8 }).start();
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} onPressIn={() => press(0.95)} onPressOut={() => press(1)} style={style}>
      <Animated.View
        style={{
          transform: [{ scale }],
          opacity: disabled ? 0.45 : 1,
          backgroundColor: bg,
          borderRadius: t.shape.buttonRadius,
          paddingVertical: pad,
          paddingHorizontal: pad * 1.6,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          borderWidth: variant === "ghost" ? t.shape.borderWidth : 0,
          borderColor: t.palette.cardBorder,
          boxShadow: variant === "ghost" ? undefined : `0px 3px 0px ${variant === "primary" ? t.palette.primaryDark : "rgba(0,0,0,0.18)"}`,
        }}
      >
        {icon ? <View>{icon}</View> : null}
        <Title size={font} color={fg}>{label}</Title>
      </Animated.View>
    </Pressable>
  );
}

/** Small round icon button for HUDs. */
export function IconButton({ children, onPress, testID, label }: { children: ReactNode; onPress: () => void; testID?: string; label: string }) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: t.palette.surface,
        borderWidth: t.shape.borderWidth,
        borderColor: t.palette.cardBorder,
        transform: [{ scale: pressed ? 0.92 : 1 }],
      })}
    >
      {children}
    </Pressable>
  );
}
