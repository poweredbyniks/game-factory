import type { CoreMechanic, Evaluation } from "@gf/core";
import { compile } from "./compiled";
import { applyAction, initialState, isStuck, isWon, legalActions, unitAt } from "./rules";
import { solveFrom, successors } from "./solver";
import { AssociationLevelData, type AssociationAction, type AssociationState } from "./types";

/** Structural validation: every problem that would make a level unplayable or inconsistent. */
export function validateAssociationLevel(data: AssociationLevelData): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const card of data.cards) {
    if (ids.has(card.id)) problems.push(`duplicate card id "${card.id}"`);
    ids.add(card.id);
    if (card.kind === "word" && !card.word) problems.push(`word card "${card.id}" has no word id`);
    if (card.kind === "category" && card.word) problems.push(`category card "${card.id}" must not have a word id`);
  }
  const categoryIds = new Set(data.categories.map((c) => c.id));
  if (categoryIds.size !== data.categories.length) problems.push("duplicate category ids");
  for (const category of data.categories) {
    const cards = data.cards.filter((c) => c.category === category.id);
    const headers = cards.filter((c) => c.kind === "category").length;
    const words = cards.filter((c) => c.kind === "word").length;
    if (headers !== 1) problems.push(`category "${category.id}" has ${headers} category cards (needs 1)`);
    if (words !== category.size) problems.push(`category "${category.id}" declares size ${category.size} but has ${words} words`);
  }
  for (const card of data.cards) if (!categoryIds.has(card.category)) problems.push(`card "${card.id}" references unknown category "${card.category}"`);
  const placed = [...data.tableau.flatMap((c) => c.cards), ...data.stock];
  const seen = new Set<string>();
  for (const id of placed) {
    if (!ids.has(id)) problems.push(`layout references unknown card "${id}"`);
    if (seen.has(id)) problems.push(`card "${id}" is dealt twice`);
    seen.add(id);
  }
  for (const id of ids) if (!seen.has(id)) problems.push(`card "${id}" is never dealt`);
  data.tableau.forEach((col, i) => {
    if (col.cards.length > 0 && col.faceDown >= col.cards.length) problems.push(`column ${i}: the top card must be face up`);
    if (col.cards.length === 0 && col.faceDown > 0) problems.push(`column ${i}: empty column with face-down cards`);
  });
  if (data.stars.three < data.stars.two) problems.push("stars.three must be >= stars.two");
  if (data.stars.three >= data.moves) problems.push("stars.three must be below the move budget");
  return problems;
}

function heuristicHint(data: AssociationLevelData, state: AssociationState): AssociationAction | null {
  const lvl = compile(data);
  const pruned = successors(lvl, state);
  const legal = legalActions(lvl, state);
  return pruned[0] ?? legal[0] ?? null;
}

export const associationsMechanic: CoreMechanic<AssociationLevelData, AssociationState, AssociationAction> = {
  id: "associations",
  version: "1.0.0",
  levelDataSchema: AssociationLevelData,
  capabilities: ["hint", "auto_place", "add_moves"],

  createState: (data, opts) => initialState(data, opts.moveBonus),

  apply: (state, action, data) => applyAction(compile(data), state, action),

  status(state, data) {
    const lvl = compile(data);
    if (isWon(lvl, state)) return "won";
    if (state.movesLeft <= 0 || isStuck(lvl, state)) return "lost";
    return "playing";
  },

  lossReason(state, data) {
    const lvl = compile(data);
    if (isWon(lvl, state)) return null;
    if (state.movesLeft <= 0) return "out_of_moves";
    return isStuck(lvl, state) ? "stuck" : null;
  },

  budget: (state, data) => ({ kind: "moves", left: state.movesLeft, total: data.moves }),

  addBudget: (state, amount) => ({ ...state, movesLeft: state.movesLeft + amount }),

  evaluate(state, data): Evaluation {
    const won = isWon(compile(data), state);
    const stars = !won ? 0 : state.movesLeft >= data.stars.three ? 3 : state.movesLeft >= data.stars.two ? 2 : 1;
    return {
      stars,
      score: state.done.length * 100 + (won ? state.movesLeft * 10 : 0) - state.mismatches * 5,
      movesLeft: state.movesLeft,
      movesUsed: state.movesUsed,
      mismatches: state.mismatches,
    };
  },

  hint(state, data) {
    const solved = solveFrom(data, state, { maxNodes: 12_000 });
    return solved.solved && solved.actions[0] ? solved.actions[0] : heuristicHint(data, state);
  },

  /** Joker: the selected word run goes to its active category, or a category card to a free slot, at no move cost. */
  autoPlace(state, action, data) {
    const lvl = compile(data);
    const illegal = { outcome: "illegal" as const, state, events: [], reason: "joker needs a playable card" };
    if (action.type !== "move") return illegal;
    const unit = unitAt(lvl, state, action.from);
    const first = unit[0];
    if (first === undefined) return illegal;
    const index = lvl.isCat[first]
      ? state.slots.findIndex((s) => s === null)
      : state.slots.findIndex((s) => s !== null && s.cat === lvl.catOf[first]);
    if (index < 0) return { ...illegal, reason: lvl.isCat[first] ? "no free slot" : "its category is not open yet" };
    return applyAction(lvl, state, { type: "move", from: action.from, to: { pile: "slot", index } }, { free: true });
  },

  validateLevel: validateAssociationLevel,

  solve: (data, opts) => solveFrom(data, initialState(data, opts?.moveBonus ?? 0), { maxNodes: opts?.maxNodes ?? 250_000 }),

  isAction(value): value is AssociationAction {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Record<string, unknown>;
    if (v.type === "draw") return true;
    if (v.type !== "move") return false;
    const from = v.from as Record<string, unknown> | undefined;
    const to = v.to as Record<string, unknown> | undefined;
    const fromOk = from?.pile === "waste" || (from?.pile === "column" && Number.isInteger(from.index));
    const toOk = (to?.pile === "slot" || to?.pile === "column") && Number.isInteger(to?.index);
    return !!fromOk && !!toOk;
  },
};
