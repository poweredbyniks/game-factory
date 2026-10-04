import { Id } from "@gf/schemas";
import { z } from "zod";

export const AssociationRules = z.strictObject({
  foundationSlots: z.int().min(1).max(6).describe("Category slots available at once"),
  drawCount: z.literal(1),
  recycleLimit: z.int().nonnegative().nullable().describe("Stock recycles allowed; null = unlimited"),
  mismatchCostsMove: z.boolean(),
  wordOnWord: z.enum(["same_category", "never"]),
  emptyColumn: z.enum(["any", "category_only", "none"]),
});
export type AssociationRules = z.infer<typeof AssociationRules>;

export const DEFAULT_RULES: AssociationRules = {
  foundationSlots: 3,
  drawCount: 1,
  recycleLimit: null,
  mismatchCostsMove: true,
  wordOnWord: "same_category",
  emptyColumn: "any",
};

export const AssociationCard = z.strictObject({
  id: Id,
  kind: z.enum(["category", "word"]),
  category: Id,
  word: Id.optional(),
});
export type AssociationCard = z.infer<typeof AssociationCard>;

export const AssociationLevelData = z
  .strictObject({
    rules: AssociationRules,
    categories: z.array(z.strictObject({ id: Id, size: z.int().min(1) })).min(1),
    cards: z.array(AssociationCard).min(2),
    tableau: z.array(z.strictObject({ cards: z.array(Id), faceDown: z.int().nonnegative() })).min(1).max(7),
    stock: z.array(Id).describe("Last element is drawn first"),
    moves: z.int().positive(),
    stars: z.strictObject({ two: z.int().nonnegative(), three: z.int().nonnegative() }),
  })
  .meta({ title: "AssociationLevelData", description: "Level payload for mechanic 'associations'" });
export type AssociationLevelData = z.infer<typeof AssociationLevelData>;

/** Cards are referenced by their index in `data.cards` inside the state, for speed. */
export type Column = { cards: number[]; down: number };
export type Slot = { cat: number; placed: number } | null;

export type AssociationState = {
  cols: Column[];
  stock: number[];
  waste: number[];
  slots: Slot[];
  /** Completed category indices, in completion order. */
  done: number[];
  movesLeft: number;
  movesUsed: number;
  mismatches: number;
  recycles: number;
};

export type Source = { pile: "waste" } | { pile: "column"; index: number };
export type Target = { pile: "slot"; index: number } | { pile: "column"; index: number };
export type AssociationAction = { type: "draw" } | { type: "move"; from: Source; to: Target };
