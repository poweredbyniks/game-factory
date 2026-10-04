import { createRng, type Rng } from "@gf/core";
import { applyAction, compile, initialState, isStuck, isWon, playable, uncovered, type Compiled } from "./rules";
import type { TriPeaksAction, TriPeaksLevelData, TriPeaksState } from "./types";

/** skill: chance of choosing the play with the best visible follow-up; waste: chance of missing a play. */
export type TriPeaksBotProfile = { name: "casual" | "average" | "expert"; skill: number; waste: number };

export const TRIPEAKS_BOTS: Record<TriPeaksBotProfile["name"], TriPeaksBotProfile> = {
  casual: { name: "casual", skill: 0.35, waste: 0.12 },
  average: { name: "average", skill: 0.6, waste: 0.06 },
  expert: { name: "expert", skill: 0.85, waste: 0.02 },
};

export class TriPeaksBot {
  private readonly c: Compiled;
  constructor(data: TriPeaksLevelData, readonly profile: TriPeaksBotProfile, private readonly rng: Rng) {
    this.c = compile(data);
  }

  next(s: TriPeaksState): TriPeaksAction | null {
    const plays = playable(this.c, s);
    if (plays.length === 0 || (s.stock.length > 0 && this.rng.chance(this.profile.waste))) {
      return s.stock.length > 0 ? { type: "draw" } : null;
    }
    if (plays.length === 1 || !this.rng.chance(this.profile.skill)) return { type: "play", slot: this.rng.pick(plays) };
    // Plan with the cards the player can see: face-down cards are unknown until uncovered.
    const visible = new Set(s.removed.flatMap((removed, slot) => (!removed && uncovered(this.c, s, slot) ? [slot] : [])));
    let best = plays[0]!;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const slot of plays) {
      const after = applyAction(this.c, s, { type: "play", slot }).state;
      const score = 1 + this.reveals(s, after) * 0.6 + this.chain(after, visible, 5);
      if (score > bestScore) {
        best = slot;
        bestScore = score;
      }
    }
    return { type: "play", slot: best };
  }

  /** Longest run of plays among cards that were visible when the bot started planning. */
  private chain(s: TriPeaksState, visible: ReadonlySet<number>, depth: number): number {
    if (depth === 0) return 0;
    let best = 0;
    for (const slot of playable(this.c, s)) {
      if (!visible.has(slot)) continue;
      const after = applyAction(this.c, s, { type: "play", slot }).state;
      best = Math.max(best, 1 + this.reveals(s, after) * 0.6 + this.chain(after, visible, depth - 1));
    }
    return best;
  }

  private reveals(before: TriPeaksState, after: TriPeaksState): number {
    let n = 0;
    for (let slot = 0; slot < after.removed.length; slot++) {
      if (!after.removed[slot] && uncovered(this.c, after, slot) && !uncovered(this.c, before, slot)) n += 1;
    }
    return n;
  }

  observe(): void {}
}

export function playTriPeaksBot(data: TriPeaksLevelData, profile: TriPeaksBotProfile, seed: string): { won: boolean; stockLeft: number } {
  const c = compile(data);
  const bot = new TriPeaksBot(data, profile, createRng(seed));
  let s = initialState(data);
  for (let step = 0; step < 500; step++) {
    if (isWon(s) || isStuck(c, s)) break;
    const action = bot.next(s);
    if (!action) break;
    const r = applyAction(c, s, action);
    if (r.outcome !== "applied") break;
    s = r.state;
  }
  return { won: isWon(s), stockLeft: s.stock.length };
}

export function triPeaksWinRate(data: TriPeaksLevelData, profile: TriPeaksBotProfile, runs: number, seed: string): number {
  let wins = 0;
  for (let i = 0; i < runs; i++) if (playTriPeaksBot(data, profile, `${seed}:${profile.name}:${i}`).won) wins += 1;
  return wins / runs;
}
