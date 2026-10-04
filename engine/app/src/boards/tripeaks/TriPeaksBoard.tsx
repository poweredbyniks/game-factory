import { compile, faceOf, isWon, rankOf, suitOf, uncovered, type TriPeaksAction, type TriPeaksLevelData, type TriPeaksState } from "@gf/mechanic-tripeaks";
import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useFeedback } from "../../runtime/FeedbackContext";
import { useT } from "../../runtime/RuntimeContext";
import { Icon } from "../../theme/Icon";
import { useTheme } from "../../theme/ThemeContext";
import { Body, Title } from "../../ui/Txt";
import { AnimatedCard, type CardPose } from "../AnimatedCard";
import type { BoardProps } from "../types";

const SUIT = { s: "♠", h: "♥", d: "♦", c: "♣" } as const;
const RANK = (code: string) => faceOf(code).slice(0, -1);

/** Board for TriPeaks: tap an open card one rank above or below the waste card, or draw. */
export function TriPeaksBoard({ session, width, height, onAct, jokerArmed, onJoker, interactive }: BoardProps) {
  const theme = useTheme();
  const t = useT();
  const feedback = useFeedback();
  const data = session.data as TriPeaksLevelData;
  const state = session.state as TriPeaksState;
  const c = compile(data);
  const [shake, setShake] = useState({ index: -1, key: 0 });

  const m = useMemo(() => {
    const pad = 8;
    const maxX = Math.max(...data.layout.slots.map((s) => s.x));
    const maxY = Math.max(...data.layout.slots.map((s) => s.y));
    const cardW = Math.min(76, ((width - 2 * pad) * 2) / (maxX + 2));
    const cardH = cardW * theme.cards.aspectRatio;
    const rowStep = cardH * 0.52;
    const tableauH = maxY * rowStep + cardH;
    const pilesY = Math.min(height - cardH - 30, tableauH + Math.max(36, (height - tableauH - cardH) * 0.35));
    const left = (width - (maxX + 2) * (cardW / 2)) / 2;
    return { pad, cardW, cardH, rowStep, left, top: 8, pilesY, stockX: width / 2 - cardW - 18, wasteX: width / 2 + 18 };
  }, [data, width, height, theme.cards.aspectRatio]);

  const poses = useMemo(() => {
    const out: CardPose[] = new Array(c.codes.length);
    data.layout.slots.forEach((slot, i) => {
      if (state.removed[i]) return;
      out[c.slotCard[i]!] = { x: m.left + slot.x * (m.cardW / 2), y: m.top + slot.y * m.rowStep, z: 10 + slot.y * 30 + slot.x, faceUp: uncovered(c, state, i), visible: true };
    });
    state.stock.forEach((card, depth) => {
      out[card] = { x: m.stockX, y: m.pilesY - Math.min(depth, 4) * 0.7, z: 100 + depth, faceUp: false, visible: depth >= state.stock.length - 3 };
    });
    state.waste.forEach((card, depth) => {
      out[card] = { x: m.wasteX, y: m.pilesY, z: 200 + depth, faceUp: true, visible: depth >= state.waste.length - 2 };
    });
    for (let i = 0; i < c.codes.length; i++) {
      if (!out[i]) out[i] = { x: m.stockX, y: m.pilesY, z: 1, faceUp: false, visible: false }; // reserve, not dealt yet
    }
    return out;
  }, [c, data, state, m]);

  const hint = session.hint as TriPeaksAction | null;
  const slotOfCard = useMemo(() => new Map(c.slotCard.map((card, slot) => [card, slot] as const)), [c]);

  const press = useCallback(
    (index: number) => {
      if (!interactive) return;
      const slot = slotOfCard.get(index);
      if (slot === undefined || state.removed[slot]) {
        if (state.stock.includes(index)) {
          if (onAct({ type: "draw" } satisfies TriPeaksAction).outcome === "applied") feedback.play("draw");
        }
        return;
      }
      if (jokerArmed) return onJoker({ type: "play", slot } satisfies TriPeaksAction);
      const result = onAct({ type: "play", slot } satisfies TriPeaksAction);
      if (result.outcome === "applied") {
        feedback.play(result.events.some((e) => e.type === "peak_cleared") ? "complete" : "place");
        feedback.haptic("light");
      } else if (uncovered(c, state, slot)) {
        setShake({ index, key: Date.now() });
        feedback.play("mismatch");
        feedback.haptic("error");
      } else feedback.play("tap");
    },
    [interactive, slotOfCard, state, jokerArmed, onJoker, onAct, feedback, c],
  );

  const draw = () => {
    if (interactive && onAct({ type: "draw" } satisfies TriPeaksAction).outcome === "applied") feedback.play("draw");
  };

  const order = useMemo(() => poses.map((p, i) => ({ p, i })).sort((a, b) => a.p.z - b.p.z), [poses]);
  const outline = { borderWidth: 2, borderStyle: "dashed" as const, borderColor: theme.palette.cardBorder, borderRadius: theme.shape.cardRadius };
  const big = m.cardW * 0.42;

  return (
    <View style={{ width, height }}>
      <Pressable
        testID="stock"
        accessibilityLabel={t("ui.stock.draw")}
        onPress={draw}
        style={{ position: "absolute", left: m.stockX, top: m.pilesY, width: m.cardW, height: m.cardH, ...outline, alignItems: "center", justifyContent: "center", zIndex: 1, borderColor: hint?.type === "draw" ? theme.palette.warning : theme.palette.cardBorder, borderWidth: hint?.type === "draw" ? 4 : 2 }}
      >
        <Icon name="stock" size={22} />
      </Pressable>
      <View pointerEvents="none" style={{ position: "absolute", left: m.stockX, top: m.pilesY + m.cardH + 4, width: m.cardW, alignItems: "center" }}>
        <Body size={13} color={theme.palette.textMuted}>{state.stock.length}</Body>
      </View>
      {state.streak >= 2 && !isWon(state) ? (
        <View pointerEvents="none" style={{ position: "absolute", left: m.wasteX - 10, top: m.pilesY - 30, width: m.cardW + 20, alignItems: "center" }}>
          <Title size={18} color={theme.palette.primary}>{`×${state.streak}`}</Title>
        </View>
      ) : null}
      {order.map(({ p, i }) => {
        const code = c.codes[i]!;
        const red = suitOf(code) === "h" || suitOf(code) === "d";
        const color = red ? theme.palette.suitRed : theme.palette.suitBlack;
        const slot = slotOfCard.get(i);
        return (
          <AnimatedCard
            key={i}
            pose={p}
            index={i}
            width={m.cardW}
            height={m.cardH}
            selected={jokerArmed && slot !== undefined && !state.removed[slot] && uncovered(c, state, slot)}
            hinted={hint?.type === "play" && slot === hint.slot}
            shakeKey={shake.index === i ? shake.key : 0}
            testID={`card-${code}`}
            label={`${RANK(code)}${SUIT[suitOf(code)]}`}
            faceColor={theme.palette.cardFace}
            borderColor={theme.palette.cardBorder}
            onPress={press}
          >
            <View style={{ flex: 1, padding: 2 }}>
              <Title size={Math.max(10, m.cardW * 0.3)} color={color} style={{ lineHeight: Math.max(11, m.cardW * 0.32) }}>{RANK(code)}</Title>
              <Body size={Math.max(9, m.cardW * 0.24)} color={color} style={{ lineHeight: Math.max(10, m.cardW * 0.26) }}>{SUIT[suitOf(code)]}</Body>
              <Body size={big} color={color} style={{ position: "absolute", right: 3, bottom: 1, opacity: 0.9 }}>{SUIT[suitOf(code)]}</Body>
              {rankOf(code) > 10 ? <Body size={m.cardW * 0.2} style={{ position: "absolute", right: 4, top: 3, opacity: 0.5 }}>{"♛"}</Body> : null}
            </View>
          </AnimatedCard>
        );
      })}
    </View>
  );
}
