import { memo } from "react";
import { View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { Body, Title } from "../../ui/Txt";
import { AnimatedCard } from "../AnimatedCard";
import { wordFontSize, type Placement } from "./layout";

export type CardFace =
  | { kind: "word"; label: string }
  | { kind: "category"; label: string; counter: string };

type Props = {
  placement: Placement;
  face: CardFace;
  width: number;
  height: number;
  selected: boolean;
  hinted: boolean;
  shakeKey: number;
  testID: string;
  onPress: (index: number) => void;
};

/** Word and category card faces on the shared animated shell. */
function CardImpl({ placement, face, width, height, selected, hinted, shakeKey, testID, onPress }: Props) {
  const t = useTheme();
  const label = t.cards.wordCase === "upper" ? face.label.toUpperCase() : face.label;
  const size = wordFontSize(label, width);
  return (
    <AnimatedCard
      pose={placement}
      index={placement.index}
      width={width}
      height={height}
      selected={selected}
      hinted={hinted}
      shakeKey={shakeKey}
      testID={testID}
      label={label}
      faceColor={face.kind === "category" ? t.palette.categoryCard : t.palette.cardFace}
      borderColor={face.kind === "category" ? t.palette.categoryCard : t.palette.cardBorder}
      onPress={onPress}
    >
      <View style={{ flex: 1, paddingHorizontal: 3, paddingTop: 4, alignItems: "center" }}>
        {face.kind === "word" ? (
          <>
            <Body size={size} align="center" color={t.palette.cardFaceText} numberOfLines={2} style={{ lineHeight: size * 1.15 }}>
              {label}
            </Body>
            {t.vfx.particleGlyphs[0] ? (
              <Body size={width * 0.34} style={{ position: "absolute", bottom: height * 0.12, opacity: 0.13 }}>{t.vfx.particleGlyphs[0]}</Body>
            ) : null}
          </>
        ) : (
          <View style={{ alignItems: "center", gap: 2, width: "100%" }}>
            <View style={{ backgroundColor: t.cards.categoryStyle === "banner" ? "rgba(255,255,255,0.18)" : "transparent", borderRadius: 4, paddingHorizontal: 2, width: "100%" }}>
              <Title size={Math.max(8, size - 1)} align="center" color={t.palette.categoryCardText} numberOfLines={2}>
                {label}
              </Title>
            </View>
            <Title size={Math.max(11, width * 0.2)} color={t.palette.categoryCardText} style={{ opacity: 0.95 }}>
              {face.counter}
            </Title>
          </View>
        )}
      </View>
    </AnimatedCard>
  );
}

export const Card = memo(CardImpl);
