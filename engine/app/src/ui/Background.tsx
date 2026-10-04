import { createRng } from "@gf/core";
import type { Background as BackgroundSpec } from "@gf/schemas";
import { LinearGradient } from "expo-linear-gradient";
import { useMemo, type ReactNode } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { imageModules } from "../generated/assets";
import { useTheme } from "../theme/ThemeContext";

/** Theme background: gradient or image, with decor glyphs scattered deterministically. */
export function Background({ spec, children, seed = "bg" }: { spec: BackgroundSpec; children?: ReactNode; seed?: string }) {
  const t = useTheme();
  const colors = (spec.colors.length >= 2 ? spec.colors : [spec.colors[0]!, spec.colors[0]!]) as [string, string, ...string[]];
  const decor = useMemo(() => {
    const rng = createRng(seed);
    const glyphs = spec.decor.flatMap((d) => ("emoji" in d ? [d.emoji] : []));
    if (glyphs.length === 0) return [];
    return Array.from({ length: 14 }, (_, i) => ({ key: i, glyph: rng.pick(glyphs), left: rng.range(2, 92), top: rng.range(2, 94), size: rng.range(18, 34), rotate: rng.range(-25, 25) }));
  }, [spec, seed]);
  const asset = spec.type === "asset" && spec.asset ? t.assets[spec.asset] : undefined;
  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient colors={colors} style={StyleSheet.absoluteFill} />
      {asset?.type === "image" ? <Image source={imageModules[asset.module]} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {decor.map((d) => (
          <Text key={d.key} style={{ position: "absolute", left: `${d.left}%`, top: `${d.top}%`, fontSize: d.size, opacity: spec.decorOpacity, transform: [{ rotate: `${d.rotate}deg` }] }}>
            {d.glyph}
          </Text>
        ))}
      </View>
      {children}
    </View>
  );
}
