import { createRng, type ChapterView, type LevelNodeView } from "@gf/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { LivesPopup, StartLevelPopup, StoryPopup } from "../popups/MapPopups";
import { useFeedback } from "../runtime/FeedbackContext";
import { useRuntime, useSnapshot, useT } from "../runtime/RuntimeContext";
import { Icon } from "../theme/Icon";
import { useTheme } from "../theme/ThemeContext";
import { Background } from "../ui/Background";
import { Button, IconButton } from "../ui/Button";
import { formatCountdown, formatNumber } from "../ui/format";
import { Pill } from "../ui/Pill";
import { Stars } from "../ui/Stars";
import { useToast } from "../ui/Toast";
import { Body, Title } from "../ui/Txt";

type MapItem =
  | { type: "chapter"; chapter: ChapterView; y: number }
  | { type: "node"; node: LevelNodeView; x: number; y: number; chapter: ChapterView };

const NODE_GAP = 94;

function layoutMap(chapters: ChapterView[], width: number, top: number): { items: MapItem[]; height: number } {
  const items: MapItem[] = [];
  const amp = Math.min(118, width * 0.27);
  let y = top;
  for (const chapter of chapters) {
    items.push({ type: "chapter", chapter, y });
    y += 118;
    for (const node of chapter.levels) {
      items.push({ type: "node", node, x: width / 2 + amp * Math.sin((node.number - 1) * 1.05), y, chapter });
      y += NODE_GAP;
    }
    y += 24;
  }
  return { items, height: y + 140 };
}

function Node({ item, onPress }: { item: Extract<MapItem, { type: "node" }>; onPress: (n: LevelNodeView) => void }) {
  const t = useTheme();
  const pulse = useRef(new Animated.Value(1)).current;
  const { node } = item;
  const keystone = node.tags.includes("keystone");
  const size = keystone ? 70 : 58;
  useEffect(() => {
    if (node.state !== "available") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.1, duration: 650, useNativeDriver: t.nativeDriver }),
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: t.nativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [node.state, pulse, t.nativeDriver]);
  const bg = node.state === "completed" ? t.palette.nodeCompleted : node.state === "available" ? t.palette.nodeAvailable : t.palette.nodeLocked;
  return (
    <View style={{ position: "absolute", left: item.x - size / 2, top: item.y - size / 2, width: size, alignItems: "center" }}>
      <Pressable testID={`node-${node.number}`} accessibilityLabel={`Level ${node.number}`} onPress={() => onPress(node)}>
        <Animated.View
          style={{
            width: size,
            height: size,
            borderRadius: t.map.nodeShape === "circle" ? size / 2 : 18,
            backgroundColor: bg,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 4,
            borderColor: node.state === "available" ? t.palette.surface : "rgba(255,255,255,0.65)",
            transform: [{ scale: pulse }],
            boxShadow: node.state === "available" ? `0px 0px 0px 6px ${t.palette.nodeAvailable}55` : "0px 3px 0px rgba(0,0,0,0.18)",
          }}
        >
          {node.state === "locked" ? <Icon name="lock" size={22} /> : <Title size={keystone ? 26 : 22} color={t.palette.textOnPrimary}>{String(node.number)}</Title>}
        </Animated.View>
      </Pressable>
      {node.state === "completed" ? <Stars count={node.stars} size={15} /> : keystone ? <Icon name="chest" size={20} /> : null}
    </View>
  );
}

export function MapScreen({ onPlay, onShop, onSettings }: { onPlay: () => void; onShop: () => void; onSettings: () => void }) {
  const runtime = useRuntime();
  const snap = useSnapshot();
  const t = useT();
  const theme = useTheme();
  const toast = useToast();
  const feedback = useFeedback();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const width = Math.min(windowWidth, 560);
  const scroll = useRef<ScrollView>(null);
  const [start, setStart] = useState<number | null>(null);
  const [livesOpen, setLivesOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const { items, height } = useMemo(() => layoutMap(snap.journey.chapters, width, insets.top + 72), [snap.journey.chapters, width, insets.top]);
  const current = items.find((i) => i.type === "node" && i.node.state === "available") as Extract<MapItem, { type: "node" }> | undefined;
  const story = snap.pendingStory[0];

  useEffect(() => {
    const timer = setInterval(() => {
      runtime.tick();
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [runtime]);

  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, current.y - windowHeight * 0.45), animated: true }), 250);
    return () => clearTimeout(timer);
  }, [current?.node.number, windowHeight, current]);

  const path = useMemo(() => {
    const nodes = items.filter((i): i is Extract<MapItem, { type: "node" }> => i.type === "node");
    return nodes.map((n, i) => {
      if (i === 0) return `M ${n.x} ${n.y}`;
      const prev = nodes[i - 1]!;
      const midY = (prev.y + n.y) / 2;
      return `C ${prev.x} ${midY} ${n.x} ${midY} ${n.x} ${n.y}`;
    }).join(" ");
  }, [items]);

  const decor = useMemo(() => {
    const rng = createRng(`decor:${snap.gameId}`);
    const glyphs = theme.map.decor.flatMap((d) => ("emoji" in d ? [d.emoji] : []));
    if (glyphs.length === 0) return [];
    return items
      .filter((i): i is Extract<MapItem, { type: "node" }> => i.type === "node")
      .filter(() => rng.chance(0.6))
      .map((n) => ({ key: n.node.number, glyph: rng.pick(glyphs), x: n.x > width / 2 ? n.x - rng.range(90, 130) : n.x + rng.range(70, 110), y: n.y - rng.range(10, 40), size: rng.range(26, 38) }));
  }, [items, theme.map.decor, snap.gameId, width]);

  const dash = theme.map.pathStyle === "dotted" ? "2 12" : theme.map.pathStyle === "dashed" ? "14 10" : undefined;
  const frontierLevel = runtime.levelByNumber(snap.journey.frontier);
  const lives = snap.lives;
  const livesLabel = lives.count >= lives.max ? `${lives.count}` : `${lives.count} · ${formatCountdown((lives.nextAt ?? now) - now)}`;

  const openLevel = (node: LevelNodeView) => {
    feedback.play("button");
    if (node.state === "available") setStart(node.number);
    else if (node.state === "completed") toast(t("ui.stars") + ` ${"★".repeat(node.stars)}`);
    else toast(t("ui.start.locked"));
  };

  const play = () => {
    if (start === null) return;
    const level = runtime.levelByNumber(start);
    if (!level) return;
    const outcome = runtime.startLevel(level.levelId);
    if (outcome.ok) {
      setStart(null);
      onPlay();
    } else if (outcome.reason === "no_lives") {
      setStart(null);
      setLivesOpen(true);
    } else toast(t("ui.start.locked"));
  };

  return (
    <View style={{ flex: 1 }}>
      <Background spec={theme.backgrounds.map} seed={snap.gameId} />
      <ScrollView ref={scroll} contentContainerStyle={{ height, width, alignSelf: "center" }} testID="map-scroll">
        <Svg width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
          <Path d={path} stroke={theme.palette.mapPath} strokeWidth={10} strokeLinecap="round" strokeDasharray={dash} fill="none" />
        </Svg>
        {decor.map((d) => (
          <Title key={d.key} size={d.size} style={{ position: "absolute", left: d.x, top: d.y, opacity: 0.9 }}>{d.glyph}</Title>
        ))}
        {items.map((item) =>
          item.type === "chapter" ? (
            <View key={`ch-${item.chapter.id}`} style={{ position: "absolute", top: item.y, left: 24, right: 24, alignItems: "center" }}>
              <View style={{ backgroundColor: item.chapter.accent ?? theme.palette.secondary, borderRadius: theme.shape.radiusLg, paddingVertical: 10, paddingHorizontal: 20, alignItems: "center", opacity: item.chapter.unlocked ? 1 : 0.6, boxShadow: "0px 4px 0px rgba(0,0,0,0.15)" }}>
                <Title size={22} color={theme.palette.textOnPrimary}>{t(item.chapter.titleKey)}</Title>
                {item.chapter.subtitleKey ? <Body size={13} color={theme.palette.textOnPrimary}>{t(item.chapter.subtitleKey)}</Body> : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <Icon name="star" size={14} />
                  <Body size={13} color={theme.palette.textOnPrimary}>{`${item.chapter.stars}/${item.chapter.maxStars}`}</Body>
                </View>
              </View>
            </View>
          ) : (
            <Node key={`n-${item.node.number}`} item={item} onPress={openLevel} />
          ),
        )}
      </ScrollView>

      <View style={{ position: "absolute", top: insets.top + 8, left: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "center", maxWidth: 560 }}>
        {lives.enabled ? <Pill icon="life" value={livesLabel} onPress={() => setLivesOpen(true)} testID="hud-lives" /> : null}
        <Pill icon="coin" value={formatNumber(snap.wallet.coins ?? 0)} plus onPress={onShop} testID="hud-coins" />
        {snap.wallet.gems !== undefined ? <Pill icon="gem" value={formatNumber(snap.wallet.gems)} onPress={onShop} testID="hud-gems" /> : null}
        <View style={{ flex: 1 }} />
        <IconButton label="Settings" onPress={onSettings} testID="hud-settings">
          <Icon name="settings" size={20} />
        </IconButton>
      </View>

      <View style={{ position: "absolute", bottom: insets.bottom + 18, left: 0, right: 0, alignItems: "center", gap: 10 }}>
        {snap.journey.completedAll ? (
          <View style={{ backgroundColor: theme.palette.surface, borderRadius: theme.shape.radiusMd, padding: 12, marginHorizontal: 24 }}>
            <Body align="center">{t("ui.map.all_done")}</Body>
          </View>
        ) : frontierLevel ? (
          <Button label={t("ui.level", { n: frontierLevel.number })} size="lg" onPress={() => openLevel({ number: frontierLevel.number, levelId: frontierLevel.levelId, state: "available", stars: 0, tags: frontierLevel.tags })} testID="map-play" icon={<Icon name="play" size={22} />} />
        ) : null}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button label={t("ui.shop.title")} size="sm" variant="secondary" onPress={onShop} icon={<Icon name="shop" size={18} />} testID="map-shop" />
        </View>
      </View>

      {start !== null ? <StartLevelPopup levelNumber={start} onPlay={play} onClose={() => setStart(null)} /> : null}
      {livesOpen ? <LivesPopup onClose={() => setLivesOpen(false)} /> : null}
      {story && start === null && !livesOpen ? <StoryPopup beat={story} onDone={() => runtime.markStorySeen(story.id)} /> : null}
    </View>
  );
}
