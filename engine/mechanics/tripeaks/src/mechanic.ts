import type { CoreMechanic, Evaluation } from "@gf/core";
import { addStock, applyAction, compile, initialState, isStuck, isWon, playable } from "./rules";
import { solveFrom } from "./solver";
import { TriPeaksLevelData, type TriPeaksAction, type TriPeaksState } from "./types";

export function validateTriPeaksLevel(data: TriPeaksLevelData): string[] {
  const problems: string[] = [];
  if (data.tableau.length !== data.layout.slots.length) {
    problems.push(`layout has ${data.layout.slots.length} slots but the tableau deals ${data.tableau.length} cards`);
  }
  const seen = new Set<string>();
  for (const code of [...data.tableau, data.waste, ...data.stock, ...data.reserve]) {
    if (seen.has(code)) problems.push(`card ${code} is dealt twice`);
    seen.add(code);
  }
  const positions = new Set(data.layout.slots.map((s) => `${s.x},${s.y}`));
  if (positions.size !== data.layout.slots.length) problems.push("two layout slots share a position");
  if (data.stars.three < data.stars.two) problems.push("stars.three must be >= stars.two");
  if (data.stars.three > data.stock.length) problems.push("stars.three cannot exceed the stock size");
  return problems;
}

export const tripeaksMechanic: CoreMechanic<TriPeaksLevelData, TriPeaksState, TriPeaksAction> = {
  id: "tripeaks",
  version: "1.0.0",
  levelDataSchema: TriPeaksLevelData,
  capabilities: ["hint", "auto_place", "add_moves"],

  /** Remote difficulty tuning (moveBonus) becomes extra stock cards from the reserve. */
  createState: (data, opts) => {
    const state = initialState(data);
    return opts.moveBonus > 0 ? addStock(compile(data), state, opts.moveBonus) : state;
  },
  apply: (state, action, data) => applyAction(compile(data), state, action),
  status: (state, data) => (isWon(state) ? "won" : isStuck(compile(data), state) ? "lost" : "playing"),
  lossReason: (state, data) => (isStuck(compile(data), state) ? "out_of_moves" : null),
  budget: (state, data) => ({ kind: "stock", left: state.stock.length, total: data.stock.length }),
  addBudget: (state, amount, data) => addStock(compile(data), state, amount),

  evaluate(state, data): Evaluation {
    const won = isWon(state);
    const left = state.stock.length;
    return {
      stars: !won ? 0 : left >= data.stars.three ? 3 : left >= data.stars.two ? 2 : 1,
      score: state.score + (won ? left * 25 : 0),
      movesLeft: left,
      movesUsed: state.plays + state.draws,
      mismatches: 0,
    };
  },

  hint(state, data) {
    const solved = solveFrom(data, state, { maxNodes: 20_000 });
    if (solved.solved && solved.actions[0]) return solved.actions[0];
    const plays = playable(compile(data), state);
    if (plays[0] !== undefined) return { type: "play", slot: plays[0] };
    return state.stock.length > 0 ? { type: "draw" } : null;
  },

  /** Joker: any uncovered card goes to the waste regardless of rank, keeping the streak. */
  autoPlace(state, action, data) {
    if (action.type !== "play") return { outcome: "illegal", state, events: [], reason: "joker needs a card" };
    return applyAction(compile(data), state, action, { free: true });
  },

  validateLevel: validateTriPeaksLevel,
  solve: (data, opts) => solveFrom(data, initialState(data), { maxNodes: opts?.maxNodes ?? 300_000 }),

  isAction(value): value is TriPeaksAction {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Record<string, unknown>;
    return v.type === "draw" || (v.type === "play" && Number.isInteger(v.slot));
  },
};
