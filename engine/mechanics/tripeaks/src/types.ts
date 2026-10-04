import { z } from "zod";

export const CardCode = z
  .string()
  .regex(/^(A|[2-9]|10|J|Q|K)[shdc](:2)?$/, "card codes look like As, 10h, Kd; a :2 suffix marks the second deck");
export type CardCode = z.infer<typeof CardCode>;

export const TriPeaksLevelData = z
  .strictObject({
    rules: z.strictObject({ wrap: z.boolean().describe("King and Ace are adjacent") }),
    layout: z.strictObject({
      name: z.string(),
      slots: z.array(z.strictObject({ x: z.int().nonnegative(), y: z.int().nonnegative() })).min(3).describe("Half-card grid; y = row"),
    }),
    tableau: z.array(CardCode).describe("One card per layout slot"),
    waste: CardCode.describe("Initial face-up waste card"),
    stock: z.array(CardCode).describe("Last element is drawn first"),
    reserve: z.array(CardCode).describe("Cards added to the stock by continues, in order"),
    stars: z.strictObject({ two: z.int().nonnegative(), three: z.int().nonnegative() }).describe("Stock cards left at the win"),
  })
  .meta({ title: "TriPeaksLevelData", description: "Level payload for mechanic 'tripeaks'" });
export type TriPeaksLevelData = z.infer<typeof TriPeaksLevelData>;

export type TriPeaksState = {
  removed: boolean[];
  stock: number[];
  waste: number[];
  reserveUsed: number;
  streak: number;
  bestStreak: number;
  draws: number;
  plays: number;
  score: number;
};

export type TriPeaksAction = { type: "play"; slot: number } | { type: "draw" };
