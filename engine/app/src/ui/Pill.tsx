import type { IconName } from "@gf/schemas";
import { Pressable, View } from "react-native";
import { Icon } from "../theme/Icon";
import { useTheme } from "../theme/ThemeContext";
import { Title } from "./Txt";

/** Currency or lives counter with an optional "+" action. */
export function Pill({ icon, value, onPress, plus, testID }: { icon: IconName; value: string; onPress?: () => void; plus?: boolean; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable testID={testID} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "button" : undefined}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingVertical: 5,
          paddingLeft: 6,
          paddingRight: plus ? 6 : 12,
          borderRadius: 20,
          backgroundColor: t.palette.surface,
          borderWidth: t.shape.borderWidth,
          borderColor: t.palette.cardBorder,
          minWidth: 76,
        }}
      >
        <Icon name={icon} size={22} />
        <Title size={16} style={{ flexGrow: 1 }}>{value}</Title>
        {plus ? (
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: t.palette.success, alignItems: "center", justifyContent: "center" }}>
            <Title size={16} color={t.palette.textOnPrimary} style={{ lineHeight: 20 }}>+</Title>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
