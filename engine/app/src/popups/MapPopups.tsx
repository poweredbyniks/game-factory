import type { StoryBeat } from "@gf/schemas";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { bundle } from "../bundle";
import { useRuntime, useSnapshot, useT } from "../runtime/RuntimeContext";
import { Icon } from "../theme/Icon";
import { useTheme } from "../theme/ThemeContext";
import { Button } from "../ui/Button";
import { formatCountdown } from "../ui/format";
import { Popup } from "../ui/Popup";
import { Stars } from "../ui/Stars";
import { Body, Title } from "../ui/Txt";
import { RewardRow } from "./RewardRow";

export function StartLevelPopup({ levelNumber, onPlay, onClose }: { levelNumber: number; onPlay: () => void; onClose: () => void }) {
  const runtime = useRuntime();
  const snap = useSnapshot();
  const t = useT();
  const theme = useTheme();
  const level = runtime.levelByNumber(levelNumber);
  if (!level) return null;
  const chapter = snap.journey.chapters.find((c) => levelNumber >= c.from && levelNumber <= c.to);
  const keystone = level.tags.includes("keystone");
  const reward = runtime.config.economy.levelRewards.byStars["3"];
  const factor = (runtime.config.economy.levelRewards.tierMultiplier[level.difficulty.tier] ?? 1) * (keystone ? runtime.config.economy.levelRewards.keystoneMultiplier : 1);
  return (
    <Popup title={t("ui.level", { n: levelNumber })} onClose={onClose} accent={keystone ? theme.palette.warning : undefined} testID="start-popup">
      {chapter ? <Body align="center" color={theme.palette.textMuted}>{t(chapter.titleKey)}</Body> : null}
      <View style={{ alignItems: "center", gap: 8 }}>
        {keystone ? <Icon name="chest" size={48} /> : <Stars count={0} size={30} />}
        <RewardRow bag={Object.fromEntries(Object.entries(reward).map(([k, v]) => [k, Math.round(v * factor)]))} />
        {snap.lives.enabled ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="life" size={18} />
            <Body size={13} color={theme.palette.textMuted}>{t("ui.start.cost")}</Body>
          </View>
        ) : null}
      </View>
      <Button label={t("ui.play")} onPress={onPlay} size="lg" testID="start-play" icon={<Icon name="play" size={20} />} />
    </Popup>
  );
}

export function StoryPopup({ beat, onDone }: { beat: StoryBeat; onDone: () => void }) {
  const t = useT();
  const theme = useTheme();
  const [line, setLine] = useState(0);
  useEffect(() => setLine(0), [beat.id]);
  const current = beat.lines[Math.min(line, beat.lines.length - 1)]!;
  const speaker = bundle.characters.find((c) => c.id === current.speaker);
  const last = line >= beat.lines.length - 1;
  return (
    <Popup accent={speaker?.color ?? theme.palette.secondary} testID="story-popup">
      <View style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: speaker?.color ?? theme.palette.secondary, alignItems: "center", justifyContent: "center" }}>
          <Title size={40}>{speaker && "emoji" in speaker.portrait ? speaker.portrait.emoji : "📖"}</Title>
        </View>
        <Title size={22} color={speaker?.color ?? theme.palette.textMuted}>{speaker ? t(speaker.nameKey) : ""}</Title>
      </View>
      <Body size={17} style={{ lineHeight: 24, minHeight: 72 }} testID="story-text">{t(current.textKey)}</Body>
      <Button
        label={last ? t("ui.story.done") : t("ui.story.next")}
        onPress={() => (last ? onDone() : setLine((l) => l + 1))}
        testID="story-next"
        variant={last ? "primary" : "secondary"}
      />
    </Popup>
  );
}

export function LivesPopup({ onClose }: { onClose: () => void }) {
  const runtime = useRuntime();
  const snap = useSnapshot();
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      runtime.tick();
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [runtime]);
  const energy = runtime.config.economy.energy;
  const full = snap.lives.count >= snap.lives.max;
  return (
    <Popup title={full ? t("item.lives") : t("ui.lives.none.title")} onClose={onClose} testID="lives-popup">
      <View style={{ alignItems: "center", gap: 6 }}>
        <View style={{ flexDirection: "row", gap: 4 }}>
          {Array.from({ length: snap.lives.max }, (_, i) => (
            <View key={i} style={{ opacity: i < snap.lives.count ? 1 : 0.25 }}>
              <Icon name="life" size={34} />
            </View>
          ))}
        </View>
        <Body>{full ? t("ui.lives.full") : t("ui.lives.none.body", { time: formatCountdown((snap.lives.nextAt ?? now) - now) })}</Body>
      </View>
      {!full && energy ? (
        <Button
          label={t("ui.lives.refill")}
          icon={<RewardRow bag={energy.refillCost} size={14} />}
          onPress={() => {
            if (runtime.refillLives().ok) onClose();
          }}
          testID="lives-refill"
        />
      ) : null}
      <Button label={t("ui.close")} variant="ghost" onPress={onClose} />
    </Popup>
  );
}
