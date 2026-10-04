import { createRng } from "@gf/core";
import { z } from "zod";
import { LAYOUTS } from "./layouts";
import { solveLevel } from "./solver";
import type { TriPeaksLevelData } from "./types";

const Range = z.tuple([z.int().nonnegative(), z.int().nonnegative()]);

export const TriPeaksGenParams = z.strictObject({
  layout: z.enum(["tri", "twin", "hill"]),
  stock: Range.describe("[min, max] stock size; rebalancing picks a size in this range"),
  wrap: z.boolean().default(true),
  reserve: z.int().nonnegative().default(15).describe("Cards available to continues"),
  starFractions: z.strictObject({ two: z.number().min(0).max(1), three: z.number().min(0).max(1) }),
  maxAttempts: z.int().positive().default(60),
  maxSolverNodes: z.int().positive().default(200_000),
});
export type TriPeaksGenParams = z.infer<typeof TriPeaksGenParams>;

const SUITS = ["s", "h", "d", "c"] as const;
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export const DECK: string[] = SUITS.flatMap((s) => RANKS.map((r) => `${r}${s}`));

/** Draw order of every non-tableau card after the waste: stock first, then reserve. */
export function drawOrder(data: TriPeaksLevelData): string[] {
  return [...data.stock].reverse().concat(data.reserve);
}

/** Same deal with a different stock size; star thresholds follow the stock left after the solver's draws. */
export function withStockSize(data: TriPeaksLevelData, size: number, draws: number, starFractions: { two: number; three: number }): TriPeaksLevelData {
  const order = drawOrder(data);
  const stock = order.slice(0, size).reverse();
  const reserve = order.slice(size, size + data.reserve.length);
  const left = Math.max(0, size - draws);
  // Always reachable by the solver's own line: perfect play earns three stars.
  const three = Math.round(left * starFractions.three);
  const two = Math.min(three, Math.round(left * starFractions.two));
  return { ...data, stock, reserve, stars: { two, three } };
}

export type GeneratedTriPeaks = {
  data: TriPeaksLevelData;
  draws: number;
  analysis: { solutionLength: number; solverNodes: number; attempts: number };
};

/** Deals until the solver clears the board with the largest allowed stock. */
export function generateTriPeaks(input: { seed: string; params: TriPeaksGenParams }): GeneratedTriPeaks {
  const p = input.params;
  const rng = createRng(input.seed);
  const slots = LAYOUTS[p.layout]!;
  for (let attempt = 1; attempt <= p.maxAttempts; attempt++) {
    const dealer = rng.fork(`deal-${attempt}`);
    const deck = dealer.shuffle(DECK);
    const tableau = deck.slice(0, slots.length);
    const waste = deck[slots.length]!;
    // Stock and continues continue into a second shuffled deck, so big boards still get a full stock.
    const rest = [...deck.slice(slots.length + 1), ...dealer.shuffle(DECK.map((c) => `${c}:2`))];
    const size = Math.min(p.stock[1], rest.length - p.reserve);
    const draft: TriPeaksLevelData = {
      rules: { wrap: p.wrap },
      layout: { name: p.layout, slots },
      tableau,
      waste,
      stock: rest.slice(0, size).reverse(),
      reserve: rest.slice(size, size + p.reserve),
      stars: { two: 0, three: 1 },
    };
    const solution = solveLevel(draft, { maxNodes: p.maxSolverNodes });
    if (!solution.solved) continue;
    const draws = solution.actions.filter((a) => a.type === "draw").length;
    return {
      data: withStockSize(draft, size, draws, p.starFractions),
      draws,
      analysis: { solutionLength: solution.actions.length, solverNodes: solution.nodes, attempts: attempt },
    };
  }
  throw new Error(`no solvable TriPeaks deal after ${p.maxAttempts} attempts (seed ${input.seed})`);
}
