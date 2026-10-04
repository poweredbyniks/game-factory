import type { IconName, ItemBag } from "@gf/schemas";
import { View } from "react-native";
import { bundle } from "../bundle";
import { Icon } from "../theme/Icon";
import { useTheme } from "../theme/ThemeContext";
import { Title } from "../ui/Txt";

export function iconOfItem(itemId: string): IconName {
  return (bundle.economy.items.find((i) => i.id === itemId)?.icon ?? "chest") as IconName;
}

/** Item bag as icon + amount chips. */
export function RewardRow({ bag, size = 18 }: { bag: ItemBag; size?: number }) {
  const t = useTheme();
  const entries = Object.entries(bag).filter(([, v]) => v > 0);
  if (entries.length === 0) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 }}>
      {entries.map(([id, amount]) => (
        <View key={id} style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: t.palette.surfaceAlt, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
          <Icon name={iconOfItem(id)} size={size + 4} />
          <Title size={size}>{amount.toLocaleString("en-US")}</Title>
        </View>
      ))}
    </View>
  );
}
