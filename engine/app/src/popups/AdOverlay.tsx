import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { AdRequest } from "../platform";
import { useServices, useT } from "../runtime/RuntimeContext";
import { useTheme } from "../theme/ThemeContext";
import { Button } from "../ui/Button";
import { Body, Title } from "../ui/Txt";

/** Development stand-in for a full-screen ad SDK view. */
export function AdOverlay() {
  const ads = useServices().platform.adsBridge;
  const t = useT();
  const theme = useTheme();
  const [request, setRequest] = useState<AdRequest | null>(null);
  const [left, setLeft] = useState(2);
  useEffect(() => {
    if (!ads) return undefined;
    ads.onRequest(setRequest);
    return () => ads.onRequest(null);
  }, [ads]);
  useEffect(() => {
    if (!request) return;
    setLeft(2);
    const timer = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [request]);
  if (!request) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 1000, backgroundColor: "#111", alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }]} testID="ad-overlay">
      <Title size={28} color="#fff">{t("ui.ad.mock")}</Title>
      <Body color="#ccc" align="center">{`${t("ui.ad.mock.body")} (${request.format} · ${request.placement})`}</Body>
      <Button
        label={left > 0 ? String(left) : request.format === "rewarded" ? t("ui.ad.reward") : t("ui.close")}
        disabled={left > 0}
        variant="accent"
        onPress={() => request.resolve("completed")}
        testID="ad-close"
      />
      <View style={{ position: "absolute", bottom: 40 }}>
        <Body size={12} color={theme.palette.textMuted}>{request.format}</Body>
      </View>
    </View>
  );
}
