import type { AnyMechanic, MechanicRegistry } from "@gf/core";
import type { Rng } from "@gf/core";
import {
  associationsMechanic, AssociationBot, AssociationGenParams, generateLevel, BOT_PROFILES, estimateWinRate, movesToWin, winRateAt, withBudget,
  type AssociationAction, type AssociationLevelData, type AssociationState, type PoolCategory,
} from "@gf/mechanic-associations";
import {
  tripeaksMechanic, TriPeaksBot, TriPeaksGenParams, generateTriPeaks, solveLevel as solveTriPeaks, TRIPEAKS_BOTS, triPeaksWinRate, withStockSize,
  type TriPeaksAction, type TriPeaksLevelData, type TriPeaksState,
} from "@gf/mechanic-tripeaks";
import type { DifficultyTarget, WordPack } from "@gf/schemas";

export type WinRates = Record<"casual" | "average" | "expert", number>;
export type Rebalanced = { data: unknown; winRates: WinRates; achieved: number; maxRate: number; budget: number };
export type SkillProfile = "casual" | "average" | "expert";
/** A player model that can drive any session of its mechanic through the runtime. */
export type Bot = { next(state: unknown): unknown | null; observe(before: unknown, action: unknown, outcome: "applied" | "mismatch" | "illegal"): void };

/** Everything the offline tools need to know about a mechanic, beyond the runtime interface. */
export type MechanicTooling = {
  mechanic: AnyMechanic;
  /** Generator params schema for levelgen.json segments. */
  genParams: { parse(value: unknown): unknown };
  /** Generates one level's data. */
  generate(args: { seed: string; params: unknown; packs: WordPack[]; recent: string[] }): {
    data: unknown;
    contentIds: string[];
    analysis: { solutionLength: number; solverNodes: number };
  };
  /** String keys a level needs from content packs. */
  contentKeys(data: unknown): string[];
  /** Bot win rates per profile, for difficulty analysis. */
  winRates?(data: unknown, runs: number, seed: string): WinRates;
  /** Player model for simulations. */
  createBot?(data: unknown, profile: SkillProfile, rng: Rng): Bot;
  /** Re-sizes the budget so the target bot profile wins at the target rate. */
  rebalance?(args: { data: unknown; solutionLength: number; target: DifficultyTarget; params: unknown; runs: number; seed: string }): Rebalanced;
};

function poolFromPacks(packs: WordPack[]): PoolCategory[] {
  return packs.flatMap((p) => p.categories.map((c) => ({ id: c.id, difficulty: c.difficulty, words: c.words })));
}

export const TOOLING: Record<string, MechanicTooling> = {
  associations: {
    mechanic: associationsMechanic,
    genParams: AssociationGenParams,
    generate({ seed, params, packs, recent }) {
      const level = generateLevel({ seed, params: AssociationGenParams.parse(params), pool: poolFromPacks(packs), avoid: new Set(recent) });
      return { data: level.data, contentIds: level.categories, analysis: level.analysis };
    },
    contentKeys(data) {
      const d = data as AssociationLevelData;
      return d.cards.map((c) => (c.kind === "category" ? `content.cat.${c.category}` : `content.word.${c.word}`));
    },
    winRates(data, runs, seed) {
      const d = data as AssociationLevelData;
      return {
        casual: estimateWinRate(d, BOT_PROFILES.casual, runs, seed),
        average: estimateWinRate(d, BOT_PROFILES.average, runs, seed),
        expert: estimateWinRate(d, BOT_PROFILES.expert, runs, seed),
      };
    },
    createBot(data, profile, rng) {
      const bot = new AssociationBot(data as AssociationLevelData, BOT_PROFILES[profile], rng);
      return {
        next: (state) => bot.next(state as AssociationState),
        observe: (before, action, outcome) => bot.observe(before as AssociationState, action as AssociationAction, outcome),
      };
    },
    rebalance({ data, solutionLength, target, params, runs, seed }) {
      const d = data as AssociationLevelData;
      const p = AssociationGenParams.parse(params);
      const dists = {
        casual: movesToWin(d, BOT_PROFILES.casual, runs, seed),
        average: movesToWin(d, BOT_PROFILES.average, runs, seed),
        expert: movesToWin(d, BOT_PROFILES.expert, runs, seed),
      };
      const dist = dists[target.profile];
      const finite = dist.filter(Number.isFinite).sort((a, b) => a - b);
      const maxRate = finite.length / dist.length;
      const needed = Math.ceil(target.winRate * dist.length);
      let budget = maxRate >= target.winRate ? finite[needed - 1]! : (finite.at(-1) ?? Math.ceil(solutionLength * 2));
      budget = Math.min(Math.max(budget, solutionLength + 3), Math.ceil(solutionLength * 3));
      const rebalanced = withBudget(d, budget, solutionLength, p.starFractions);
      const winRates = {
        casual: winRateAt(dists.casual, budget),
        average: winRateAt(dists.average, budget),
        expert: winRateAt(dists.expert, budget),
      };
      return { data: rebalanced, winRates, achieved: winRateAt(dist, budget), maxRate, budget };
    },
  },
};

TOOLING.tripeaks = {
  mechanic: tripeaksMechanic,
  genParams: TriPeaksGenParams,
  generate({ seed, params }) {
    const level = generateTriPeaks({ seed, params: TriPeaksGenParams.parse(params) });
    return { data: level.data, contentIds: [level.data.layout.name], analysis: level.analysis };
  },
  contentKeys: () => [],
  winRates(data, runs, seed) {
    const d = data as TriPeaksLevelData;
    return {
      casual: triPeaksWinRate(d, TRIPEAKS_BOTS.casual, runs, seed),
      average: triPeaksWinRate(d, TRIPEAKS_BOTS.average, runs, seed),
      expert: triPeaksWinRate(d, TRIPEAKS_BOTS.expert, runs, seed),
    };
  },
  createBot(data, profile, rng) {
    const bot = new TriPeaksBot(data as TriPeaksLevelData, TRIPEAKS_BOTS[profile], rng);
    return { next: (state) => bot.next(state as TriPeaksState) as TriPeaksAction | null, observe: () => undefined };
  },
  /** The deal stays fixed; only the stock size moves until the target profile wins at the target rate. */
  rebalance({ data, target, params, runs, seed }) {
    const d = data as TriPeaksLevelData;
    const p = TriPeaksGenParams.parse(params);
    const solution = solveTriPeaks(d);
    const draws = solution.actions.filter((a) => a.type === "draw").length;
    const profile = TRIPEAKS_BOTS[target.profile];
    const available = d.stock.length + d.reserve.length;
    const min = Math.max(p.stock[0], draws + 1);
    const max = Math.max(min, Math.min(p.stock[1], available - 5));
    const rateAt = (size: number) => triPeaksWinRate(withStockSize(d, size, draws, p.starFractions), profile, runs, seed);
    const maxRate = rateAt(max);
    let size = max;
    if (maxRate >= target.winRate) {
      for (let s = min; s <= max; s++) {
        if (rateAt(s) >= target.winRate) {
          size = s;
          break;
        }
      }
    }
    const tuned = withStockSize(d, size, draws, p.starFractions);
    const winRates = this.winRates!(tuned, runs, seed);
    return { data: tuned, winRates, achieved: winRates[target.profile], maxRate, budget: size };
  },
};

export const MECHANICS: MechanicRegistry = Object.fromEntries(Object.entries(TOOLING).map(([id, t]) => [id, t.mechanic]));
