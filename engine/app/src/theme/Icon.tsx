import type { IconName } from "@gf/schemas";
import { Image, Text, View } from "react-native";
import { SvgXml } from "react-native-svg";
import { imageModules } from "../generated/assets";
import { useTheme } from "./ThemeContext";

/** Renders a semantic icon from the theme: emoji placeholder, inline SVG or image asset. */
export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const theme = useTheme();
  const ref = theme.icons[name];
  if (!ref) return <Text style={{ fontSize: size * 0.8 }}>?</Text>;
  if ("emoji" in ref) return <Text style={{ fontSize: size * 0.82, lineHeight: size * 1.05, textAlign: "center" }}>{ref.emoji}</Text>;
  const asset = theme.assets[ref.asset];
  if (asset?.type === "svg") return <SvgXml xml={asset.xml} width={size} height={size} />;
  if (asset?.type === "image") return <Image source={imageModules[asset.module]} style={{ width: size, height: size }} />;
  return <View style={{ width: size, height: size }} />;
}
