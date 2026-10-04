import { useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { bundle } from "../bundle";
import { useRuntime, useServices, useSnapshot, useT } from "../runtime/RuntimeContext";
import { useTheme } from "../theme/ThemeContext";
import { Button } from "../ui/Button";
import { Popup } from "../ui/Popup";
import { Body, Title } from "../ui/Txt";

export function SettingsPopup({ onClose }: { onClose: () => void }) {
  const runtime = useRuntime();
  const { events } = useServices();
  const snap = useSnapshot();
  const t = useT();
  const theme = useTheme();
  const [confirmReset, setConfirmReset] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const toggle = (key: "sound" | "music" | "haptics") => (
    <View key={key} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <Body size={17}>{t(`ui.settings.${key}`)}</Body>
      <Switch testID={`setting-${key}`} value={snap.settings[key]} onValueChange={(value) => runtime.setSettings({ [key]: value })} trackColor={{ true: theme.palette.success, false: theme.palette.nodeLocked }} />
    </View>
  );
  return (
    <Popup title={t("ui.settings.title")} onClose={onClose} testID="settings-popup" maxHeight={760}>
      {toggle("sound")}
      {toggle("haptics")}
      <View style={{ height: 1, backgroundColor: theme.palette.cardBorder, marginVertical: 4 }} />
      <Title size={16} color={theme.palette.textMuted}>{t("ui.settings.debug")}</Title>
      <Body size={12} color={theme.palette.textMuted}>
        {`${bundle.game.gameId} ${bundle.game.version} · engine ${bundle.build.engineVersion} · content ${bundle.build.contentHash}`}
      </Body>
      <Body size={12} color={theme.palette.textMuted}>
        {`player ${runtime.playerId} · remote ${runtime.remote.payloadVersion ?? "none"} · experiments ${Object.entries(snap.experiments).map(([k, v]) => `${k}:${v}`).join(", ") || "none"}`}
      </Body>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="secondary" label={t("ui.settings.grant")} onPress={() => runtime.debug.grant({ coins: 1000 })} testID="debug-grant" />
        <Button size="sm" variant="secondary" label={t("ui.settings.events")} onPress={() => setShowEvents((v) => !v)} testID="debug-events" />
        <Button
          size="sm"
          variant="ghost"
          label={confirmReset ? t("ui.settings.reset.confirm") : t("ui.settings.reset")}
          testID="debug-reset"
          onPress={() => {
            if (!confirmReset) return setConfirmReset(true);
            runtime.debug.resetProgress();
            setConfirmReset(false);
            onClose();
          }}
        />
      </View>
      {showEvents ? (
        <Pressable onPress={() => setShowEvents(false)} style={{ backgroundColor: theme.palette.surfaceAlt, borderRadius: 10, padding: 8, gap: 2 }}>
          {events.events.slice(-14).reverse().map((e, i) => (
            <Body key={`${e.ts}-${i}`} size={11} numberOfLines={1}>{`${e.name} ${JSON.stringify(Object.fromEntries(Object.entries(e.params).filter(([k]) => !["game_id", "player_id", "session_id", "app_version", "platform", "content_hash", "experiments"].includes(k))))}`}</Body>
          ))}
        </Pressable>
      ) : null}
      <Button label={t("ui.close")} variant="ghost" onPress={onClose} testID="settings-close" />
    </Popup>
  );
}
