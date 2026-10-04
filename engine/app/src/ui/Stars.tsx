import { View } from "react-native";
import { Icon } from "../theme/Icon";

export function Stars({ count, size = 16, max = 3 }: { count: number; size?: number; max?: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 1 }}>
      {Array.from({ length: max }, (_, i) => (
        <View key={i} style={{ opacity: i < count ? 1 : 0.25 }}>
          <Icon name="star" size={size} />
        </View>
      ))}
    </View>
  );
}
