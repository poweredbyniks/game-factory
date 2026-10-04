import type { BoosterView, LevelResult, SessionView } from "@gf/core";
import type { IconName } from "@gf/schemas";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BOARDS } from "../boards/registry";
import { useBackHandler } from "../platform";
import { ContinuePopup, LeavePopup, LossPopup, WinPopup } from "../popups/LevelPopups";
import { useFeedback } from "../runtime/FeedbackContext";
import { useRuntime, useSnapshot, useT } from "../runtime/RuntimeContext";
import { Icon } from "../theme/Icon";
import { useTheme } from "../theme/ThemeContext";
import { Background } from "../ui/Background";
import { Button, IconButton } from "../ui/Button";
import { useToast } from "../ui/Toast";
import { Body, Title } from "../ui/Txt";

const BOOSTER_ICON: Record<string, IconName> = { hint: "hint", undo: "undo", auto_place: "joker", add_moves: "moves", shuffle: "stock" };

export function LevelScreen({ onExit }: { onExit: () => void }) {
  const runtime = useRuntime();
  const snap = useSnapshot();
  const t = useT();
  const theme = useTheme();
  const feedback = useFeedback();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const last = useRef<SessionView | null>(null);
  if (snap.session) last.current = snap.session;
  const session = snap.session ?? last.current;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [jokerArmed, setJokerArmed] = useState(false);
  const [result, setResult] = useState<LevelResult | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [tutorial, setTutorial] = useState<string | null>(null);
  const shown = useRef(new Set<string>());
  // Android back on the board asks before leaving, like the close button: leaving costs the attempt.
  // Popups register later and answer first.
  useBackHandler(() => {
    setLeaving(true);
    return true;
  });

  const showStep = useCallback(
    (trigger: string) => {
      const step = session?.level.tutorial?.steps.find((s) => s.trigger === trigger);
      const key = `${session?.levelId}:${trigger}`;
      if (step && !shown.current.has(key)) {
        shown.current.add(key);
        setTutorial(step.textKey);
      }
    },
    [session?.level.tutorial, session?.levelId],
  );

  useEffect(() => showStep("start"), [session?.levelId, showStep]);
  useEffect(() => {
    if (!snap.session) return;
    if (snap.session.lastEvents.some((e) => e.type === "category_placed")) showStep("first_category");
    if (snap.session.lastOutcome === "mismatch") showStep("first_mismatch");
  }, [snap.session?.moveCount, snap.session?.lastOutcome, snap.session, showStep]);

  const status = snap.session?.status;
  useEffect(() => {
    if (!snap.session || result) return;
    if (status === "won") {
      feedback.play("win");
      feedback.haptic("success");
      const timer = setTimeout(() => setResult(runtime.finishLevel()), 700);
      return () => clearTimeout(timer);
    }
    if (status === "lost" && !snap.session.continueOffer) {
      feedback.play("lose");
      setResult(runtime.finishLevel());
    }
    return undefined;
  }, [status, snap.session, result, runtime, feedback]);

  const useBooster = (booster: BoosterView) => {
    if (booster.effect === "auto_place") {
      if (booster.count < 1 && (snap.wallet.coins ?? 0) < (booster.price.coins ?? 0)) return toast(t("ui.booster.cannot_afford"));
      setJokerArmed((armed) => !armed);
      if (!jokerArmed) toast(t("ui.booster.joker.select"));
      return;
    }
    const outcome = runtime.useBooster(booster.id);
    if (outcome.ok) feedback.play(booster.effect === "undo" ? "flip" : "select");
    else toast(t(`ui.booster.${outcome.reason === "no_effect" ? "no_effect" : outcome.reason === "cannot_afford" ? "cannot_afford" : outcome.reason === "limit" ? "limit" : "not_allowed"}`));
  };

  const onJoker = (action: unknown) => {
    setJokerArmed(false);
    const outcome = runtime.useBooster("joker", action);
    if (outcome.ok) {
      feedback.play("place");
      feedback.haptic("success");
    } else {
      toast(t(outcome.reason === "no_effect" ? "ui.booster.no_effect" : "ui.booster.cannot_afford"));
    }
  };

  if (!session) return null;
  const Board = BOARDS[session.mechanic];
  const budget = session.budget;
  const lowBudget = budget.kind === "moves" && budget.left <= 5;
  const exitToMap = () => {
    onExit();
    void runtime.showInterstitialIfDue();
  };

  return (
    <View style={{ flex: 1 }}>
      <Background spec={theme.backgrounds.level} seed={session.levelId} />
      <View style={{ flex: 1, paddingTop: insets.top + 6, paddingBottom: insets.bottom + 8, paddingHorizontal: 8, alignSelf: "center", width: "100%", maxWidth: 560 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, marginBottom: 6 }}>
          <IconButton label="Leave level" testID="level-leave" onPress={() => setLeaving(true)}>
            <Icon name="close" size={18} />
          </IconButton>
          <Title size={22} testID="level-title">{t("ui.level", { n: session.number })}</Title>
          <View
            testID="budget"
            style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: lowBudget ? theme.palette.danger : theme.palette.surface, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 4, borderWidth: theme.shape.borderWidth, borderColor: theme.palette.cardBorder }}
          >
            <Icon name={budget.kind === "moves" ? "moves" : "stock"} size={20} />
            <Title size={20} color={lowBudget ? theme.palette.textOnPrimary : theme.palette.text} testID="budget-left">{String(budget.left)}</Title>
          </View>
        </View>

        <View style={{ flex: 1 }} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {size && Board ? (
            <Board
              session={session}
              width={size.w}
              height={size.h}
              onAct={(action) => runtime.act(action)}
              jokerArmed={jokerArmed}
              onJoker={onJoker}
              interactive={snap.session?.status === "playing" && !result}
            />
          ) : null}
        </View>

        {tutorial && snap.session?.status === "playing" && !result ? (
          <Pressable testID="tutorial" onPress={() => setTutorial(null)} style={{ position: "absolute", left: 16, right: 16, bottom: insets.bottom + 92, zIndex: 50 }}>
            <View style={{ backgroundColor: theme.palette.text, borderRadius: theme.shape.radiusMd, padding: 14, flexDirection: "row", gap: 10, alignItems: "center" }}>
              <Icon name="info" size={24} />
              <Body color={theme.palette.surface} style={{ flex: 1 }}>{t(tutorial)}</Body>
              <Title size={15} color={theme.palette.accent}>{t("ui.tutorial.ok")}</Title>
            </View>
          </Pressable>
        ) : null}

        <View style={{ flexDirection: "row", justifyContent: "center", gap: 12, paddingTop: 8 }}>
          {session.boosters.map((b) => (
            <Pressable
              key={b.id}
              testID={`booster-${b.id}`}
              accessibilityLabel={t(`item.${b.id}`)}
              disabled={!b.allowed || snap.session?.status !== "playing"}
              onPress={() => useBooster(b)}
              style={({ pressed }) => ({
                width: 74,
                alignItems: "center",
                paddingVertical: 6,
                borderRadius: theme.shape.radiusMd,
                backgroundColor: b.effect === "auto_place" && jokerArmed ? theme.palette.accent : theme.palette.surface,
                borderWidth: theme.shape.borderWidth,
                borderColor: theme.palette.cardBorder,
                opacity: b.allowed ? 1 : 0.4,
                transform: [{ scale: pressed ? 0.94 : 1 }],
              })}
            >
              <Icon name={BOOSTER_ICON[b.effect] ?? "info"} size={28} />
              <Body size={12}>{t(`item.${b.id}`)}</Body>
              <View style={{ position: "absolute", top: -8, right: -6, minWidth: 24, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: b.count > 0 ? theme.palette.primary : theme.palette.secondary, alignItems: "center", justifyContent: "center" }}>
                <Title size={12} color={theme.palette.textOnPrimary}>{b.count > 0 ? String(b.count) : `🪙${b.price.coins ?? ""}`}</Title>
              </View>
            </Pressable>
          ))}
        </View>
      </View>

      {snap.session?.status === "lost" && snap.session.continueOffer && !result ? (
        <ContinuePopup
          offer={snap.session.continueOffer}
          reason={snap.session.lossReason ?? "out_of_moves"}
          onCoins={() => {
            if (runtime.continueWithCoins().ok) feedback.play("coin");
          }}
          onAd={() => {
            void runtime.continueWithAd();
          }}
          onGiveUp={() => {
            feedback.play("lose");
            setResult(runtime.finishLevel());
          }}
        />
      ) : null}
      {result?.won ? <WinPopup result={result} onContinue={exitToMap} /> : null}
      {result && !result.won ? (
        <LossPopup
          result={result}
          canRetry={!snap.lives.enabled || snap.lives.count > 0}
          onRetry={() => {
            const start = runtime.startLevel(result.levelId);
            if (start.ok) {
              setResult(null);
              shown.current.clear();
            } else exitToMap();
          }}
          onMap={exitToMap}
        />
      ) : null}
      {leaving ? (
        <LeavePopup
          onStay={() => setLeaving(false)}
          onLeave={() => {
            setLeaving(false);
            runtime.abandonLevel();
            onExit();
          }}
        />
      ) : null}
      {jokerArmed ? (
        <View pointerEvents="none" style={{ position: "absolute", top: insets.top + 60, alignSelf: "center" }}>
          <Button label={t("item.joker")} onPress={() => undefined} variant="accent" size="sm" icon={<Icon name="joker" size={18} />} />
        </View>
      ) : null}
    </View>
  );
}
