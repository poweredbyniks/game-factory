import { createRng } from "@gf/core";
import { wordId } from "@gf/schemas";
import { z } from "zod";
import { solveLevel } from "./solver";
import { AssociationRules, DEFAULT_RULES, type AssociationCard, type AssociationLevelData } from "./types";

const Range = z.tuple([z.int().nonnegative(), z.int().nonnegative()]);

export const AssociationGenParams = z.strictObject({
  categories: Range.describe("[min, max] categories per level"),
  wordsPerCategory: Range,
  columns: z.int().min(2).max(7),
  columnHeight: Range,
  faceDown: Range.describe("[min, max] face-down cards per column (always below the top)"),
  categoryDifficulty: Range.describe("[min, max] content difficulty 1..5"),
  moveSlack: z.strictObject({ factor: z.number().min(1), flat: z.int().nonnegative() }),
  starFractions: z.strictObject({ two: z.number().min(0).max(1), three: z.number().min(0).max(1) }),
  minStock: z.int().nonnegative().default(3),
  minSolutionLength: z.int().nonnegative().default(0),
  maxAttempts: z.int().positive().default(40),
  maxSolverNodes: z.int().positive().default(60_000),
  rules: AssociationRules.partial().default({}),
});
export type AssociationGenParams = z.infer<typeof AssociationGenParams>;

/** A category from a word pack, as the generator needs it. */
export type PoolCategory = { id: string; difficulty: number; words: string[] };

export type GeneratedLevel = {
  data: AssociationLevelData;
  categories: string[];
  analysis: { solutionLength: number; solverNodes: number; attempts: number };
};

function pickCategories(rng: ReturnType<typeof createRng>, pool: PoolCategory[], count: number, minWords: number, avoid: ReadonlySet<string>) {
  const fresh = rng.shuffle(pool.filter((c) => !avoid.has(c.id) && c.words.length >= minWords));
  const stale = rng.shuffle(pool.filter((c) => avoid.has(c.id) && c.words.length >= minWords));
  const picked: PoolCategory[] = [];
  const usedWords = new Set<string>();
  for (const candidate of [...fresh, ...stale]) {
    if (picked.length === count) break;
    const words = candidate.words.map((w) => w.toLowerCase());
    if (words.some((w) => usedWords.has(w))) continue; // a word must not belong to two categories in one level
    picked.push(candidate);
    words.forEach((w) => usedWords.add(w));
  }
  if (picked.length < count) throw new Error(`not enough compatible categories: wanted ${count}, found ${picked.length}`);
  return picked;
}

/**
 * Deals random boards until the solver proves one solvable, then sizes the move budget from the
 * solution length. Deterministic for a given seed, params and pool.
 */
export function generateLevel(input: {
  seed: string;
  params: AssociationGenParams;
  pool: PoolCategory[];
  avoid?: ReadonlySet<string>;
}): GeneratedLevel {
  const p = input.params;
  const rng = createRng(input.seed);
  const rules: AssociationRules = { ...DEFAULT_RULES, ...p.rules };
  const [dMin, dMax] = p.categoryDifficulty;
  const eligible = input.pool.filter((c) => c.difficulty >= dMin && c.difficulty <= dMax);
  const count = rng.range(p.categories[0], p.categories[1]);
  const chosen = pickCategories(rng, eligible, count, p.wordsPerCategory[0], input.avoid ?? new Set());

  const cards: AssociationCard[] = [];
  const categories = chosen.map((category) => {
    const size = rng.range(p.wordsPerCategory[0], Math.min(p.wordsPerCategory[1], category.words.length));
    cards.push({ id: `c.${category.id}`, kind: "category", category: category.id });
    for (const word of rng.shuffle(category.words).slice(0, size)) {
      const id = wordId(category.id, word);
      cards.push({ id: `w.${id}`, kind: "word", category: category.id, word: id });
    }
    return { id: category.id, size };
  });

  for (let attempt = 1; attempt <= p.maxAttempts; attempt++) {
    const deal = rng.fork(`deal-${attempt}`);
    const order = deal.shuffle(cards.map((c) => c.id));
    const heights = Array.from({ length: p.columns }, () => deal.range(p.columnHeight[0], p.columnHeight[1]));
    const maxTableau = Math.max(p.columns, order.length - p.minStock);
    for (let i = 0; heights.reduce((a, b) => a + b, 0) > maxTableau; i = (i + 1) % heights.length) {
      if (heights[i]! > 1) heights[i]! -= 1;
    }
    let cursor = 0;
    const tableau = heights.map((h) => {
      const column = order.slice(cursor, cursor + h);
      cursor += h;
      const faceDown = Math.min(deal.range(p.faceDown[0], p.faceDown[1]), Math.max(0, h - 1));
      return { cards: column, faceDown };
    });
    const stock = order.slice(cursor);

    // Make sure the player can start: at least one category card on top of a column.
    const isCategory = (id: string) => id.startsWith("c.");
    if (!tableau.some((col) => isCategory(col.cards[col.cards.length - 1] ?? ""))) {
      const col = tableau[deal.int(tableau.length)]!;
      const topIndex = col.cards.length - 1;
      const inStock = stock.findIndex(isCategory);
      if (inStock >= 0) {
        [col.cards[topIndex], stock[inStock]] = [stock[inStock]!, col.cards[topIndex]!];
      } else {
        for (const other of tableau) {
          const at = other.cards.findIndex(isCategory);
          if (at >= 0) {
            [col.cards[topIndex], other.cards[at]] = [other.cards[at]!, col.cards[topIndex]!];
            break;
          }
        }
      }
    }

    const draft: AssociationLevelData = { rules, categories, cards, tableau, stock, moves: 999, stars: { two: 0, three: 0 } };
    const solution = solveLevel(draft, { maxNodes: p.maxSolverNodes });
    if (!solution.solved || solution.actions.length < p.minSolutionLength) continue;

    const length = solution.actions.length;
    const moves = Math.ceil(length * p.moveSlack.factor + p.moveSlack.flat);
    const slack = moves - length;
    const two = Math.max(1, Math.round(slack * p.starFractions.two));
    const three = Math.max(two + 1, Math.round(slack * p.starFractions.three));
    return {
      data: { ...draft, moves, stars: { two, three } },
      categories: categories.map((c) => c.id),
      analysis: { solutionLength: length, solverNodes: solution.nodes, attempts: attempt },
    };
  }
  throw new Error(`no solvable deal after ${p.maxAttempts} attempts (seed ${input.seed})`);
}
