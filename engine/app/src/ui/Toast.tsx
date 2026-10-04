import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, View } from "react-native";
import { useTheme } from "../theme/ThemeContext";
import { Body } from "./Txt";

const ToastContext = createContext<(message: string) => void>(() => undefined);

export function useToast() {
  return useContext(ToastContext);
}

/** Short, non-blocking messages ("That's not in this group"). */
export function ToastHost({ children }: { children: ReactNode }) {
  const t = useTheme();
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const show = useCallback((text: string) => setMessage({ text, id: Date.now() }), []);
  useEffect(() => {
    if (!message) return;
    opacity.setValue(0);
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: t.nativeDriver }),
      Animated.delay(1300),
      Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: t.nativeDriver }),
    ]).start();
  }, [message, opacity, t.nativeDriver]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: "42%", alignItems: "center", zIndex: 200 }}>
        <Animated.View testID="toast" style={{ opacity, backgroundColor: t.palette.text, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 18 }}>
          <Body color={t.palette.surface} size={16}>{message?.text ?? ""}</Body>
        </Animated.View>
      </View>
    </ToastContext.Provider>
  );
}
