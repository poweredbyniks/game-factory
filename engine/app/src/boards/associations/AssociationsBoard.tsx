import { compile, unitAt, type AssociationAction, type AssociationLevelData, type AssociationState, type Source, type Target } from "@gf/mechanic-associations";
import { categoryLabelKey, wordLabelKey } from "@gf/schemas";
import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useFeedback } from "../../runtime/FeedbackContext";
import { useT } from "../../runtime/RuntimeContext";
import { Icon } from "../../theme/Icon";
import { useTheme } from "../../theme/ThemeContext";
import { useToast } from "../../ui/Toast";
import { Body, Title } from "../../ui/Txt";
import type { BoardProps } from "../types";
import { Card, type CardFace } from "./Card";
import { computeMetrics, layoutCards } from "./layout";

const sameSource = (a: Source | null, b: Source | null) =>
  !!a && !!b && a.pile === b.pile && (a.pile === "waste" || (b.pile === "column" && a.index === b.index));

/**
 * Board for the associations mechanic. Interaction is select-then-target (ADR-0004): the player
 * decides where a word belongs; the board never routes a card automatically.
 */
export function AssociationsBoard({ session, width, height, onAct, jokerArmed, onJoker, interactive }: BoardProps) {
  const theme = useTheme();
  const t = useT();
  const feedback = useFeedback();
  const toast = useToast();
  const data = session.data as AssociationLevelData;
  const state = session.state as AssociationState;
  const lvl = compile(data);
  const [selection, setSelection] = useState<Source | null>(null);
  const [shake, setShake] = useState<{ cards: number[]; key: number }>({ cards: [], key: 0 });

  const m = useMemo(() => computeMetrics(width, height, data, state, theme.cards.aspectRatio), [width, height, data, state, theme.cards.aspectRatio]);
  const placements = useMemo(() => layoutCards(data, state, m), [data, state, m]);
  const selectedUnit = useMemo(() => new Set(selection ? unitAt(lvl, state, selection) : []), [selection, lvl, state]);

  const hint = session.hint as AssociationAction | null;
  const hinted = useMemo(() => {
    if (!hint || hint.type !== "move") return new Set<number>();
    const cards = new Set(unitAt(lvl, state, hint.from));
    if (hint.to.pile === "slot") {
      const slot = state.slots[hint.to.index];
      if (slot) cards.add(lvl.catCard[slot.cat]!);
    } else {
      const col = state.cols[hint.to.index];
      const top = col?.cards[col.cards.length - 1];
      if (top !== undefined) cards.add(top);
    }
    return cards;
  }, [hint, lvl, state]);

  const faces = useMemo(
    () =>
      data.cards.map((card, index): CardFace => {
        if (card.kind === "word") return { kind: "word", label: t(wordLabelKey(card.word ?? "")) };
        const cat = lvl.catOf[index]!;
        const slot = state.slots.find((s) => s?.cat === cat);
        return { kind: "category", label: t(categoryLabelKey(card.category)), counter: slot ? `${slot.placed}/${lvl.size[cat]}` : `${lvl.size[cat]}` };
      }),
    [data, lvl, state.slots, t],
  );

  const sourceOf = useCallback(
    (index: number): Source | null => {
      const p = placements[index]!;
      if (p.where === "waste" && state.waste[state.waste.length - 1] === index) return { pile: "waste" };
      if (p.where === "column" && p.column !== undefined) {
        const source: Source = { pile: "column", index: p.column };
        return unitAt(lvl, state, source).includes(index) ? source : null;
      }
      return null;
    },
    [placements, state, lvl],
  );

  const attempt = useCallback(
    (to: Target, tappedSource: Source | null) => {
      if (!selection) return;
      const unit = unitAt(lvl, state, selection);
      const result = onAct({ type: "move", from: selection, to } satisfies AssociationAction);
      if (result.outcome === "applied") {
        setSelection(null);
        const completed = result.events.some((e) => e.type === "category_completed");
        feedback.play(completed ? "complete" : "place");
        feedback.haptic(completed ? "success" : "light");
      } else if (result.outcome === "mismatch") {
        setSelection(null);
        setShake({ cards: unit, key: Date.now() });
        feedback.play("mismatch");
        feedback.haptic("error");
        toast(t("ui.mismatch"));
      } else {
        setSelection(tappedSource && !sameSource(tappedSource, selection) ? tappedSource : null);
        feedback.play("tap");
      }
    },
    [selection, lvl, state, onAct, feedback, toast, t],
  );

  const draw = useCallback(() => {
    if (!interactive) return;
    setSelection(null);
    const result = onAct({ type: "draw" } satisfies AssociationAction);
    if (result.outcome === "applied") feedback.play("draw");
  }, [interactive, onAct, feedback]);

  const onCardPress = useCallback(
    (index: number) => {
      if (!interactive) return;
      const p = placements[index]!;
      if (p.where === "stock") return draw();
      if (p.where === "slot" || p.where === "slot-under") {
        if (selection) attempt({ pile: "slot", index: p.slot! }, null);
        return;
      }
      const source = sourceOf(index);
      if (jokerArmed) {
        if (source) onJoker({ type: "move", from: source, to: { pile: "slot", index: 0 } } satisfies AssociationAction);
        return;
      }
      if (selection) {
        if (source && sameSource(source, selection)) {
          setSelection(null);
          return;
        }
        if (p.where === "column") return attempt({ pile: "column", index: p.column! }, source);
        if (source) {
          setSelection(source);
          feedback.play("select");
        }
        return;
      }
      if (source) {
        setSelection(source);
        feedback.play("select");
      }
    },
    [interactive, placements, draw, selection, attempt, sourceOf, jokerArmed, onJoker, feedback],
  );

  const outline = { borderWidth: 2, borderStyle: "dashed" as const, borderColor: theme.palette.cardBorder, borderRadius: theme.shape.cardRadius };
  const limit = data.rules.recycleLimit;
  const canRecycle = state.stock.length === 0 && state.waste.length > 0 && (limit === null || state.recycles < limit);
  const order = useMemo(() => [...placements].sort((a, b) => a.z - b.z), [placements]);

  return (
    <View style={{ width, height }}>
      {state.slots.map((_, s) => (
        <Pressable
          key={`slot-${s}`}
          testID={`slot-${s}`}
          accessibilityLabel={t("ui.slot.empty")}
          onPress={() => (selection ? attempt({ pile: "slot", index: s }, null) : undefined)}
          style={{ position: "absolute", left: m.slotX[s], top: m.topY, width: m.cardW, height: m.cardH, ...outline, backgroundColor: theme.palette.slotEmpty, alignItems: "center", justifyContent: "center", padding: 4 }}
        >
          <Body size={10} align="center" color={theme.palette.textMuted}>{t("ui.slot.empty")}</Body>
        </Pressable>
      ))}
      <View style={{ position: "absolute", left: m.wasteX, top: m.topY, width: m.cardW, height: m.cardH, ...outline, opacity: 0.6 }} />
      <Pressable
        testID="stock"
        accessibilityLabel={canRecycle ? t("ui.stock.recycle") : t("ui.stock.draw")}
        onPress={draw}
        style={{ position: "absolute", left: m.stockX, top: m.topY, width: m.cardW, height: m.cardH, ...outline, alignItems: "center", justifyContent: "center", zIndex: 1 }}
      >
        {canRecycle ? <Title size={26} color={theme.palette.textMuted}>↻</Title> : <Icon name="stock" size={24} />}
      </Pressable>
      <View pointerEvents="none" style={{ position: "absolute", left: m.stockX, top: m.topY + m.cardH + 2, width: m.cardW, alignItems: "center", zIndex: 500 }}>
        <Body size={12} color={theme.palette.textMuted}>{state.stock.length}</Body>
      </View>
      {state.cols.map((col, c) => (
        <Pressable
          key={`col-${c}`}
          testID={`column-${c}`}
          onPress={() => (selection ? attempt({ pile: "column", index: c }, null) : undefined)}
          style={{ position: "absolute", left: m.colX[c], top: m.tableauY, width: m.cardW, height: Math.max(m.cardH, height - m.tableauY - 4), zIndex: 0 }}
        >
          {col.cards.length === 0 ? <View style={{ width: m.cardW, height: m.cardH, ...outline }} /> : null}
        </Pressable>
      ))}
      {order.map((p) => (
        <Card
          key={p.index}
          placement={p}
          face={faces[p.index]!}
          width={m.cardW}
          height={m.cardH}
          selected={selectedUnit.has(p.index) || (jokerArmed && sourceOf(p.index) !== null)}
          hinted={hinted.has(p.index)}
          shakeKey={shake.cards.includes(p.index) ? shake.key : 0}
          testID={`card-${data.cards[p.index]!.id}`}
          onPress={onCardPress}
        />
      ))}
    </View>
  );
}
