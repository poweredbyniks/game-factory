import type { MoveResult } from "@gf/core";
import { coverGraph } from "./layouts";
import type { TriPeaksAction, TriPeaksLevelData, TriPeaksState } from "./types";

const RANKS: Record<string, number> = { A: 1, J: 11, Q: 12, K: 13 };
/** "7h" or "7h:2" (second deck) -> "7h". */
export const faceOf = (code: string) => code.split(":")[0]!;
export const rankOf = (code: string) => {
  const face = faceOf(code);
  return RANKS[face.slice(0, -1)] ?? Number(face.slice(0, -1));
};
export const suitOf = (code: string) => faceOf(code).slice(-1) as "s" | "h" | "d" | "c";

export type Compiled = {
  data: TriPeaksLevelData;
  codes: string[];
  rank: Int8Array;
  coveredBy: number[][];
  /** Card index held by each tableau slot. */
  slotCard: number[];
  wasteCard: number;
  stockCards: number[];
  reserveCards: number[];
};

const cache = new WeakMap<TriPeaksLevelData, Compiled>();

/** Card indices: tableau slots, then the initial waste card, then stock, then reserve. */
export function compile(data: TriPeaksLevelData): Compiled {
  const hit = cache.get(data);
  if (hit) return hit;
  const codes = [...data.tableau, data.waste, ...data.stock, ...data.reserve];
  const n = data.tableau.length;
  const compiled: Compiled = {
    data,
    codes,
    rank: Int8Array.from(codes.map(rankOf)),
    coveredBy: coverGraph(data.layout.slots),
    slotCard: data.tableau.map((_, i) => i),
    wasteCard: n,
    stockCards: data.stock.map((_, i) => n + 1 + i),
    reserveCards: data.reserve.map((_, i) => n + 1 + data.stock.length + i),
  };
  cache.set(data, compiled);
  return compiled;
}

export function initialState(data: TriPeaksLevelData): TriPeaksState {
  const c = compile(data);
  return {
    removed: data.tableau.map(() => false),
    stock: [...c.stockCards],
    waste: [c.wasteCard],
    reserveUsed: 0,
    streak: 0,
    bestStreak: 0,
    draws: 0,
    plays: 0,
    score: 0,
  };
}

export const isWon = (s: TriPeaksState) => s.removed.every(Boolean);

export function uncovered(c: Compiled, s: TriPeaksState, slot: number): boolean {
  return !s.removed[slot] && c.coveredBy[slot]!.every((j) => s.removed[j]);
}

export function adjacent(c: Compiled, a: number, b: number): boolean {
  const d = Math.abs(c.rank[a]! - c.rank[b]!);
  return d === 1 || (c.data.rules.wrap && d === 12);
}

export function playable(c: Compiled, s: TriPeaksState): number[] {
  const top = s.waste[s.waste.length - 1]!;
  const out: number[] = [];
  for (let slot = 0; slot < s.removed.length; slot++) {
    if (uncovered(c, s, slot) && adjacent(c, c.slotCard[slot]!, top)) out.push(slot);
  }
  return out;
}

export function isStuck(c: Compiled, s: TriPeaksState): boolean {
  return !isWon(s) && s.stock.length === 0 && playable(c, s).length === 0;
}

export function applyAction(c: Compiled, s: TriPeaksState, action: TriPeaksAction, opts: { free?: boolean } = {}): MoveResult<TriPeaksState> {
  const illegal = (reason: string): MoveResult<TriPeaksState> => ({ outcome: "illegal", state: s, events: [], reason });
  if (isWon(s)) return illegal("level is over");
  if (action.type === "draw") {
    if (s.stock.length === 0) return illegal("the stock is empty");
    const card = s.stock[s.stock.length - 1]!;
    return {
      outcome: "applied",
      state: { ...s, stock: s.stock.slice(0, -1), waste: [...s.waste, card], streak: 0, draws: s.draws + 1 },
      events: [{ type: "drawn", card }],
    };
  }
  const slot = action.slot;
  if (slot < 0 || slot >= s.removed.length) return illegal("no such slot");
  if (!uncovered(c, s, slot)) return illegal("that card is covered");
  const card = c.slotCard[slot]!;
  if (!opts.free && !adjacent(c, card, s.waste[s.waste.length - 1]!)) return illegal("rank");
  const removed = s.removed.slice();
  removed[slot] = true;
  const streak = s.streak + 1;
  const next: TriPeaksState = {
    ...s,
    removed,
    waste: [...s.waste, card],
    streak,
    bestStreak: Math.max(s.bestStreak, streak),
    plays: s.plays + 1,
    score: s.score + 10 * streak,
  };
  const events: Array<{ type: string } & Record<string, unknown>> = [{ type: "played", card, streak }];
  const peak = c.data.layout.slots[slot]!.y === 0;
  if (peak) events.push({ type: "peak_cleared", slot });
  return { outcome: "applied", state: next, events };
}

export function addStock(c: Compiled, s: TriPeaksState, amount: number): TriPeaksState {
  const extra = c.reserveCards.slice(s.reserveUsed, s.reserveUsed + amount);
  return { ...s, stock: [...extra.reverse(), ...s.stock], reserveUsed: s.reserveUsed + extra.length };
}
