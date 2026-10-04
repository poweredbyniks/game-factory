import { Text, type TextProps, type TextStyle } from "react-native";
import { useTheme } from "../theme/ThemeContext";

type Props = TextProps & { size?: number; color?: string; weight?: TextStyle["fontWeight"]; align?: TextStyle["textAlign"] };

/** Display font: titles, numbers, buttons. */
export function Title({ size = 22, color, align, style, ...rest }: Props) {
  const t = useTheme();
  return (
    <Text
      {...rest}
      style={[{ fontFamily: t.fonts.display, fontSize: size * t.typography.scale, color: color ?? t.palette.text, textAlign: align }, style]}
    />
  );
}

/** Body font: dialogue, descriptions, card words. */
export function Body({ size = 15, color, align, weight, style, ...rest }: Props) {
  const t = useTheme();
  return (
    <Text
      {...rest}
      style={[{ fontFamily: t.fonts.body, fontSize: size * t.typography.scale, color: color ?? t.palette.text, textAlign: align, fontWeight: weight }, style]}
    />
  );
}
