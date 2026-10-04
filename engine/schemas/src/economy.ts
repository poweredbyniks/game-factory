import { z } from "zod";
import { Id, IconName, ItemBag, LocKey, SchemaVersion, Tier } from "./common";

export const ITEM_KINDS = ["soft_currency", "premium_currency", "energy", "booster", "ticket", "collectible"] as const;

export const ItemDefinition = z.strictObject({
  id: Id,
  kind: z.enum(ITEM_KINDS),
  nameKey: LocKey,
  icon: IconName,
  initial: z.int().nonnegative().describe("Balance of a brand-new player"),
  cap: z.int().positive().optional().describe("Hard cap; grants above it are clipped"),
});
export type ItemDefinition = z.infer<typeof ItemDefinition>;

export const BOOSTER_EFFECTS = ["hint", "undo", "auto_place", "add_moves", "shuffle"] as const;
export const BoosterEffect = z.enum(BOOSTER_EFFECTS);
export type BoosterEffect = z.infer<typeof BoosterEffect>;

export const BoosterDefinition = z.strictObject({
  id: Id.describe("Item id of the booster"),
  effect: BoosterEffect,
  amount: z.int().positive().optional().describe("Effect strength, e.g. moves added"),
  price: ItemBag.describe("Price to buy one when the player has none"),
  maxPerLevel: z.int().positive().optional(),
});
export type BoosterDefinition = z.infer<typeof BoosterDefinition>;

export const EconomyDefinition = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: SchemaVersion,
    items: z.array(ItemDefinition).min(1),
    energy: z
      .strictObject({
        item: Id,
        max: z.int().positive(),
        regenSeconds: z.int().positive(),
        chargeOn: z.enum(["start", "loss"]).describe("When a life is consumed"),
        refillCost: ItemBag,
      })
      .optional(),
    boosters: z.array(BoosterDefinition),
    levelRewards: z.strictObject({
      byStars: z.strictObject({ "1": ItemBag, "2": ItemBag, "3": ItemBag }),
      tierMultiplier: z.partialRecord(Tier, z.number().positive()).default({}),
      keystoneMultiplier: z.number().positive().default(1),
    }),
    continue: z.strictObject({
      extraMoves: z.int().positive(),
      cost: ItemBag,
      costEscalation: z.array(z.number().positive()).min(1).describe("Cost multiplier for the 1st, 2nd, ... continue"),
      maxContinues: z.int().nonnegative(),
      rewardedAd: z.boolean().describe("First continue of an attempt may be paid with a rewarded ad"),
    }),
    rewardTables: z.record(Id, ItemBag).default({}),
    dailyReward: z.strictObject({ days: z.array(ItemBag).min(1), resetOnMiss: z.boolean() }).optional(),
  })
  .meta({ title: "EconomyDefinition", description: "economy.json: items, energy, boosters, rewards, continues" });
export type EconomyDefinition = z.infer<typeof EconomyDefinition>;
