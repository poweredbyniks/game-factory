import type { MechanicEvent, MoveResult } from "@gf/core";
import { compile, type CompiledLevel } from "./compiled";
import type { AssociationAction, AssociationLevelData, AssociationState, Column, Source, Target } from "./types";

export function initialState(data: AssociationLevelData, moveBonus = 0): AssociationState {
  const lvl = compile(data);
  const id = (cardId: string) => {
    const index = lvl.cardIndex.get(cardId);
    if (index === undefined) throw new Error(`unknown card "${cardId}"`);
    return index;
  };
  return {
    cols: data.tableau.map((c) => ({ cards: c.cards.map(id), down: Math.min(c.faceDown, Math.max(0, c.cards.length - 1)) })),
    stock: data.stock.map(id),
    waste: [],
    slots: Array.from({ length: data.rules.foundationSlots }, () => null),
    done: [],
    movesLeft: Math.max(1, data.moves + moveBonus),
    movesUsed: 0,
    mismatches: 0,
    recycles: 0,
  };
}

/** The movable unit at a source: the waste top, or a column's top run of same-category face-up words. */
export function unitAt(lvl: CompiledLevel, state: AssociationState, source: Source): number[] {
  if (source.pile === "waste") {
    const top = state.waste[state.waste.length - 1];
    return top === undefined ? [] : [top];
  }
  const col = state.cols[source.index];
  if (!col || col.cards.length === 0) return [];
  const top = col.cards[col.cards.length - 1]!;
  if (lvl.isCat[top]) return [top];
  const cat = lvl.catOf[top];
  let start = col.cards.length - 1;
  while (start - 1 >= col.down) {
    const below = col.cards[start - 1]!;
    if (lvl.isCat[below] || lvl.catOf[below] !== cat) break;
    start -= 1;
  }
  return col.cards.slice(start);
}

function removeUnit(state: AssociationState, source: Source, count: number): { cols: Column[]; waste: number[]; revealed: boolean } {
  if (source.pile === "waste") return { cols: state.cols, waste: state.waste.slice(0, -count), revealed: false };
  const cols = state.cols.slice();
  const col = cols[source.index]!;
  const cards = col.cards.slice(0, col.cards.length - count);
  let down = col.down;
  let revealed = false;
  if (cards.length > 0 && down >= cards.length) {
    down = cards.length - 1;
    revealed = true;
  }
  if (cards.length === 0) down = 0;
  cols[source.index] = { cards, down };
  return { cols, waste: state.waste, revealed };
}

type Verdict = { kind: "ok" } | { kind: "mismatch" } | { kind: "illegal"; reason: string };

/** Pure legality check of moving `unit` to `target`, without applying it. */
export function judgeMove(lvl: CompiledLevel, state: AssociationState, source: Source, unit: number[], target: Target): Verdict {
  if (unit.length === 0) return { kind: "illegal", reason: "nothing to move" };
  const rules = lvl.data.rules;
  const first = unit[0]!;
  const unitIsCategory = lvl.isCat[first] === 1;
  if (target.pile === "slot") {
    if (target.index < 0 || target.index >= state.slots.length) return { kind: "illegal", reason: "no such slot" };
    const slot = state.slots[target.index];
    if (!slot) return unitIsCategory ? { kind: "ok" } : { kind: "illegal", reason: "an empty slot needs a category card" };
    if (unitIsCategory) return { kind: "illegal", reason: "slot already has a category" };
    return lvl.catOf[first] === slot.cat ? { kind: "ok" } : { kind: "mismatch" };
  }
  if (source.pile === "column" && source.index === target.index) return { kind: "illegal", reason: "same column" };
  const col = state.cols[target.index];
  if (!col) return { kind: "illegal", reason: "no such column" };
  if (col.cards.length === 0) {
    if (rules.emptyColumn === "none") return { kind: "illegal", reason: "empty columns stay empty" };
    if (rules.emptyColumn === "category_only" && !unitIsCategory) return { kind: "illegal", reason: "only a category card may start a column" };
    return { kind: "ok" };
  }
  const top = col.cards[col.cards.length - 1]!;
  if (lvl.isCat[top]) return { kind: "illegal", reason: "nothing stacks on a category card" };
  if (unitIsCategory) return { kind: "illegal", reason: "a category card cannot go on a word" };
  if (rules.wordOnWord === "never") return { kind: "illegal", reason: "words do not stack" };
  return lvl.catOf[first] === lvl.catOf[top] ? { kind: "ok" } : { kind: "mismatch" };
}

function spendMove(state: AssociationState): Pick<AssociationState, "movesLeft" | "movesUsed"> {
  return { movesLeft: state.movesLeft - 1, movesUsed: state.movesUsed + 1 };
}

export function isWon(lvl: CompiledLevel, state: AssociationState): boolean {
  return state.done.length === lvl.data.categories.length;
}

/** Applies an action. Illegal actions return the same state object. */
export function applyAction(
  lvl: CompiledLevel,
  state: AssociationState,
  action: AssociationAction,
  opts: { free?: boolean } = {},
): MoveResult<AssociationState> {
  const illegal = (reason: string): MoveResult<AssociationState> => ({ outcome: "illegal", state, events: [], reason });
  if (isWon(lvl, state) || state.movesLeft <= 0) return illegal("level is over");
  const cost = opts.free ? { movesLeft: state.movesLeft, movesUsed: state.movesUsed } : spendMove(state);

  if (action.type === "draw") {
    if (state.stock.length > 0) {
      const card = state.stock[state.stock.length - 1]!;
      return {
        outcome: "applied",
        state: { ...state, ...cost, stock: state.stock.slice(0, -1), waste: [...state.waste, card] },
        events: [{ type: "drawn", card }],
      };
    }
    const limit = lvl.data.rules.recycleLimit;
    if (state.waste.length > 0 && (limit === null || state.recycles < limit)) {
      return {
        outcome: "applied",
        state: { ...state, ...cost, stock: state.waste.slice().reverse(), waste: [], recycles: state.recycles + 1 },
        events: [{ type: "recycled" }],
      };
    }
    return illegal("stock and waste are empty");
  }

  const unit = unitAt(lvl, state, action.from);
  const verdict = judgeMove(lvl, state, action.from, unit, action.to);
  if (verdict.kind === "illegal") return illegal(verdict.reason);
  if (verdict.kind === "mismatch") {
    const charged = lvl.data.rules.mismatchCostsMove && !opts.free;
    return {
      outcome: "mismatch",
      state: { ...state, ...(charged ? spendMove(state) : {}), mismatches: state.mismatches + 1 },
      events: [{ type: "mismatch", card: unit[0]! }],
    };
  }

  const removed = removeUnit(state, action.from, unit.length);
  const events: MechanicEvent[] = [{ type: "moved", cards: unit }];
  if (removed.revealed) events.push({ type: "revealed", column: (action.from as { index: number }).index });
  let next: AssociationState = { ...state, ...cost, cols: removed.cols, waste: removed.waste };

  if (action.to.pile === "slot") {
    const slots = next.slots.slice();
    const slot = slots[action.to.index];
    if (!slot) {
      slots[action.to.index] = { cat: lvl.catOf[unit[0]!]!, placed: 0 };
      events.push({ type: "category_placed", category: lvl.data.categories[lvl.catOf[unit[0]!]!]!.id });
      next = { ...next, slots };
    } else {
      const placed = slot.placed + unit.length;
      if (placed >= lvl.size[slot.cat]!) {
        slots[action.to.index] = null;
        events.push({ type: "category_completed", category: lvl.data.categories[slot.cat]!.id });
        next = { ...next, slots, done: [...next.done, slot.cat] };
      } else {
        slots[action.to.index] = { cat: slot.cat, placed };
        next = { ...next, slots };
      }
    }
  } else {
    const cols = next.cols === state.cols ? next.cols.slice() : next.cols;
    const target = cols[action.to.index]!;
    cols[action.to.index] = { cards: [...target.cards, ...unit], down: target.down };
    next = { ...next, cols };
  }
  return { outcome: "applied", state: next, events };
}

export function sources(state: AssociationState): Source[] {
  const out: Source[] = [];
  if (state.waste.length > 0) out.push({ pile: "waste" });
  state.cols.forEach((c, index) => {
    if (c.cards.length > 0) out.push({ pile: "column", index });
  });
  return out;
}

export function targets(state: AssociationState): Target[] {
  const out: Target[] = [];
  state.slots.forEach((_, index) => out.push({ pile: "slot", index }));
  state.cols.forEach((_, index) => out.push({ pile: "column", index }));
  return out;
}

/** Every action that would be applied (no mismatches, no illegal moves). */
export function legalActions(lvl: CompiledLevel, state: AssociationState): AssociationAction[] {
  if (isWon(lvl, state) || state.movesLeft <= 0) return [];
  const out: AssociationAction[] = [];
  for (const from of sources(state)) {
    const unit = unitAt(lvl, state, from);
    for (const to of targets(state)) {
      if (judgeMove(lvl, state, from, unit, to).kind === "ok") out.push({ type: "move", from, to });
    }
  }
  const limit = lvl.data.rules.recycleLimit;
  if (state.stock.length > 0 || (state.waste.length > 0 && (limit === null || state.recycles < limit))) {
    out.push({ type: "draw" });
  }
  return out;
}

const stuckCache = new WeakMap<AssociationState, boolean>();

/** No applied action exists: nothing to move correctly and nothing to draw. */
export function isStuck(lvl: CompiledLevel, state: AssociationState): boolean {
  let stuck = stuckCache.get(state);
  if (stuck === undefined) {
    stuck = !isWon(lvl, state) && state.movesLeft > 0 && legalActions(lvl, state).length === 0;
    stuckCache.set(state, stuck);
  }
  return stuck;
}

/** Total card count across every location; must always equal the deck size. */
export function countCards(lvl: CompiledLevel, state: AssociationState): number {
  let n = state.stock.length + state.waste.length;
  for (const col of state.cols) n += col.cards.length;
  for (const slot of state.slots) if (slot) n += 1 + slot.placed;
  for (const cat of state.done) n += 1 + lvl.size[cat]!;
  return n;
}
