import { z } from "zod";
import { Id, JsonObject, SchemaVersion } from "./common";

/** Runtime tunables that are not part of a definition file but may be overridden remotely. */
export const Tuning = z.strictObject({
  difficulty: z.strictObject({
    moveBonus: z.int().min(-10).max(50).default(0).describe("Extra moves added to every level budget"),
    perLevel: z.record(Id, z.strictObject({ moveBonus: z.int().min(-10).max(50) })).default({}),
  }),
  features: z.record(z.string(), z.boolean()).default({}).describe("Kill switches and feature flags"),
});
export type Tuning = z.infer<typeof Tuning>;

/** Roots of the effective configuration that remote payloads may override. */
export const OVERRIDE_ROOTS = ["economy", "monetization", "store", "tuning"] as const;
export type OverrideRoot = (typeof OVERRIDE_ROOTS)[number];

export const Overrides = z.strictObject({
  economy: JsonObject.optional(),
  monetization: JsonObject.optional(),
  store: JsonObject.optional(),
  tuning: JsonObject.optional(),
});
export type Overrides = z.infer<typeof Overrides>;

export const PLATFORMS = ["ios", "android", "web", "node"] as const;
export const Platform = z.enum(PLATFORMS);
export type Platform = z.infer<typeof Platform>;

export const Experiment = z.strictObject({
  id: Id,
  status: z.enum(["running", "paused"]),
  audience: z
    .strictObject({
      minLevel: z.int().positive().optional(),
      platforms: z.array(Platform).optional(),
      newPlayersOnly: z.boolean().optional(),
    })
    .optional(),
  variants: z.array(z.strictObject({ id: Id, weight: z.int().positive(), overrides: Overrides })).min(1),
});
export type Experiment = z.infer<typeof Experiment>;

export const RemotePayload = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: SchemaVersion,
    gameId: Id,
    payloadVersion: z.string().min(1),
    overrides: Overrides.default({}),
    experiments: z.array(Experiment).default([]),
  })
  .meta({ title: "RemotePayload", description: "Remote overrides and experiments, validated before activation" });
export type RemotePayload = z.infer<typeof RemotePayload>;
