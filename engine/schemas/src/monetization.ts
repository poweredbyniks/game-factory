import { z } from "zod";
import { Id, SchemaVersion } from "./common";

export const MonetizationDefinition = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: SchemaVersion,
    ads: z.strictObject({
      enabled: z.boolean(),
      rewarded: z.strictObject({
        placements: z.array(
          z.strictObject({ id: Id, kind: z.enum(["continue", "double_reward", "free_coins", "free_life"]) }),
        ),
        dailyCap: z.int().positive(),
      }),
      interstitial: z.strictObject({
        enabled: z.boolean(),
        minLevel: z.int().positive().describe("No interstitials before this level number"),
        everyNLevels: z.int().positive(),
        cooldownSeconds: z.int().nonnegative(),
      }),
      banner: z.strictObject({ enabled: z.boolean(), screens: z.array(Id).default([]) }),
    }),
    removeAdsEntitlement: Id,
    iap: z.strictObject({ enabled: z.boolean() }),
  })
  .meta({ title: "MonetizationDefinition", description: "monetization.json: ad placements and frequency caps" });
export type MonetizationDefinition = z.infer<typeof MonetizationDefinition>;
