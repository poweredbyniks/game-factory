import { createRng, type Rng } from "@gf/core";
import { compile, type CompiledLevel } from "./compiled";
import { applyAction, initialState, isStuck, isWon, judgeMove, sources, unitAt } from "./rules";
import type { AssociationAction, AssociationLevelData, AssociationState } from "./types";

/**
 * Imperfect-information player model for difficulty estimation and economy simulation.
 * The bot sees only face-up cards. `knowledge` is the chance it recognises a word's category;
 * unknown words are tried on active categories at random, and each mismatch teaches it.
 * `waste` is the chance per turn of an exploratory draw instead of the best move: humans peek at
 * the deck far more than a solver would, and budgets must leave room for that.
 */
export type BotProfile = { name: "casual" | "average" | "expert"; knowledge: number; waste: number };

export const BOT_PROFILES: Record<BotProfile["name"], BotProfile> = {
  casual: { name: "casual", knowledge: 0.6, waste: 0.2 },
  average: { name: "average", knowledge: 0.78, waste: 0.12 },
  expert: { name: "expert", knowledge: 0.94, waste: 0.04 },
};

export class AssociationBot {
  private readonly lvl: CompiledLevel;
  private readonly known: Uint8Array;
  private readonly ruledOut = new Map<number, Set<number>>();
  private idleDraws = 0;

  constructor(
    data: AssociationLevelData,
    readonly profile: BotProfile,
    private readonly rng: Rng,
  ) {
    this.lvl = compile(data);
    this.known = Uint8Array.from(data.cards, () => (rng.chance(profile.knowledge) ? 1 : 0));
  }

  /** Next action for the visible board, or null when the bot gives up. */
  next(state: AssociationState): AssociationAction | null {
    const lvl = this.lvl;
    const srcs = sources(state);
    const limit = lvl.data.rules.recycleLimit;
    const canDraw = state.stock.length > 0 || (state.waste.length > 0 && (limit === null || state.recycles < limit));
    if (canDraw && this.rng.chance(this.profile.waste)) return { type: "draw" };

    // 1. Sort words onto active categories. Unknown words are guesses among active slots.
    for (const from of srcs) {
      const unit = unitAt(lvl, state, from);
      const first = unit[0]!;
      if (lvl.isCat[first]) continue;
      const trueCat = lvl.catOf[first]!;
      const correct = state.slots.findIndex((s) => s?.cat === trueCat);
      if (correct < 0) continue;
      if (this.known[first]) return { type: "move", from, to: { pile: "slot", index: correct } };
      const ruled = this.ruledOut.get(first) ?? new Set<number>();
      const candidates = state.slots
        .map((s, index) => ({ s, index }))
        .filter(({ s }) => s !== null && !ruled.has(s.cat));
      if (candidates.length > 0) return { type: "move", from, to: { pile: "slot", index: this.rng.pick(candidates).index } };
    }

    // 2. Open a category when a slot is free, preferring the one with the most visible words.
    const emptySlot = state.slots.findIndex((s) => s === null);
    if (emptySlot >= 0) {
      let best: { from: (typeof srcs)[number]; score: number } | null = null;
      for (const from of srcs) {
        const unit = unitAt(lvl, state, from);
        const first = unit[0]!;
        if (!lvl.isCat[first]) continue;
        const score = this.visibleWordsOf(state, lvl.catOf[first]!) + this.rng.next() * 0.5;
        if (!best || score > best.score) best = { from, score };
      }
      if (best) return { type: "move", from: best.from, to: { pile: "slot", index: emptySlot } };
    }

    // 3. Dig: stack a known run onto a known same-category word when that reveals a card.
    for (const from of srcs) {
      if (from.pile !== "column") continue;
      const col = state.cols[from.index]!;
      const unit = unitAt(lvl, state, from);
      if (col.cards.length === unit.length || !unit.every((c) => this.known[c])) continue;
      for (let index = 0; index < state.cols.length; index++) {
        const target = state.cols[index]!;
        const top = target.cards[target.cards.length - 1];
        if (index === from.index || top === undefined || !this.known[top]) continue;
        const to = { pile: "column", index } as const;
        if (judgeMove(lvl, state, from, unit, to).kind === "ok") return { type: "move", from, to };
      }
      if (col.down > 0) {
        const empty = state.cols.findIndex((c) => c.cards.length === 0);
        const to = { pile: "column", index: empty } as const;
        if (empty >= 0 && judgeMove(lvl, state, from, unit, to).kind === "ok") return { type: "move", from, to };
      }
    }

    // 4. Draw, unless the bot has cycled through the whole stock without progress.
    const pile = state.stock.length + state.waste.length;
    if (this.idleDraws > pile * 2 + 2) return null;
    return canDraw ? { type: "draw" } : null;
  }

  /** Feed back what happened so the bot learns from mismatches and tracks idle cycling. */
  observe(before: AssociationState, action: AssociationAction, outcome: "applied" | "mismatch" | "illegal"): void {
    if (action.type === "draw") {
      if (outcome === "applied") this.idleDraws += 1;
      return;
    }
    if (outcome === "applied") this.idleDraws = 0;
    if (outcome === "mismatch" && action.to.pile === "slot") {
      const card = unitAt(this.lvl, before, action.from)[0]!;
      const slot = before.slots[action.to.index];
      if (slot) {
        const set = this.ruledOut.get(card) ?? new Set<number>();
        set.add(slot.cat);
        this.ruledOut.set(card, set);
      }
    }
  }

  private visibleWordsOf(state: AssociationState, cat: number): number {
    let n = 0;
    for (const col of state.cols) {
      for (let i = col.down; i < col.cards.length; i++) {
        const c = col.cards[i]!;
        if (!this.lvl.isCat[c] && this.known[c] && this.lvl.catOf[c] === cat) n += 1;
      }
    }
    const top = state.waste[state.waste.length - 1];
    if (top !== undefined && !this.lvl.isCat[top] && this.known[top] && this.lvl.catOf[top] === cat) n += 1;
    return n;
  }
}

export type BotRun = {
  won: boolean;
  reason: "won" | "out_of_moves" | "stuck" | "gave_up";
  movesLeft: number;
  movesUsed: number;
  mismatches: number;
  actions: AssociationAction[];
};

/** Plays one attempt from the start of a level. */
export function playBot(data: AssociationLevelData, profile: BotProfile, seed: string, opts: { moveBonus?: number; maxSteps?: number } = {}): BotRun {
  const lvl = compile(data);
  const bot = new AssociationBot(data, profile, createRng(seed));
  let state = initialState(data, opts.moveBonus ?? 0);
  const actions: AssociationAction[] = [];
  const maxSteps = opts.maxSteps ?? 2000;
  let reason: BotRun["reason"] = "gave_up";
  for (let step = 0; step < maxSteps; step++) {
    if (isWon(lvl, state)) {
      reason = "won";
      break;
    }
    if (state.movesLeft <= 0) {
      reason = "out_of_moves";
      break;
    }
    if (isStuck(lvl, state)) {
      reason = "stuck";
      break;
    }
    const action = bot.next(state);
    if (!action) break;
    const result = applyAction(lvl, state, action);
    bot.observe(state, action, result.outcome);
    if (result.outcome === "illegal") break;
    actions.push(action);
    state = result.state;
  }
  return { won: reason === "won", reason, movesLeft: state.movesLeft, movesUsed: state.movesUsed, mismatches: state.mismatches, actions };
}

/** Win rate of a profile over `runs` seeded attempts. */
export function estimateWinRate(data: AssociationLevelData, profile: BotProfile, runs: number, seed: string, moveBonus = 0): number {
  let wins = 0;
  for (let i = 0; i < runs; i++) if (playBot(data, profile, `${seed}:${profile.name}:${i}`, { moveBonus }).won) wins += 1;
  return wins / runs;
}

/**
 * Moves each seeded run needed to win when the budget is unlimited (Infinity when the bot gets
 * stuck or gives up). The bot never looks at the budget, so win rate at budget B is simply the
 * share of runs that finished within B moves: one pass gives the whole difficulty curve.
 */
export function movesToWin(data: AssociationLevelData, profile: BotProfile, runs: number, seed: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < runs; i++) {
    const run = playBot(data, profile, `${seed}:${profile.name}:${i}`, { moveBonus: 10_000 });
    out.push(run.won ? run.movesUsed : Number.POSITIVE_INFINITY);
  }
  return out;
}

export function winRateAt(distribution: readonly number[], budget: number): number {
  return distribution.filter((m) => m <= budget).length / Math.max(1, distribution.length);
}

/** Same level with a new move budget and star thresholds re-derived from the solution length. */
export function withBudget(
  data: AssociationLevelData,
  moves: number,
  solutionLength: number,
  starFractions: { two: number; three: number },
): AssociationLevelData {
  const slack = Math.max(1, moves - solutionLength);
  const two = Math.max(1, Math.round(slack * starFractions.two));
  const three = Math.min(moves - 1, Math.max(two + 1, Math.round(slack * starFractions.three)));
  return { ...data, moves, stars: { two: Math.min(two, three), three } };
}
