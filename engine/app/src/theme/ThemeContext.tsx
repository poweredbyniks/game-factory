import type { ResolvedTheme } from "@gf/schemas";
import { createContext, useContext, type ReactNode } from "react";
import { Platform } from "react-native";

export type Theme = ResolvedTheme & {
  fonts: { display: string | undefined; body: string | undefined };
  /** Animated driver flag: the native driver is unavailable on web. */
  nativeDriver: boolean;
};

const ThemeContext = createContext<Theme | null>(null);

function familyOf(theme: ResolvedTheme, ref: ResolvedTheme["typography"]["display"]): string | undefined {
  if ("asset" in ref) {
    const asset = theme.assets[ref.asset];
    return asset?.type === "font" ? asset.family : undefined;
  }
  return ref.system === "serif" ? "serif" : ref.system === "monospace" ? "monospace" : undefined;
}

export function buildTheme(theme: ResolvedTheme): Theme {
  return {
    ...theme,
    fonts: { display: familyOf(theme, theme.typography.display), body: familyOf(theme, theme.typography.body) },
    nativeDriver: Platform.OS !== "web",
  };
}

export function ThemeProvider({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("ThemeProvider is missing");
  return theme;
}
