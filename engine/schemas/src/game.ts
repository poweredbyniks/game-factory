import { z } from "zod";
import { Id, JsonObject } from "./common";

export const MODULE_NAMES = [
  "map", "story", "lives", "boosters", "shop", "ads", "iap",
  "quests", "collections", "buildings", "dailyReward", "events", "notifications", "leaderboards",
] as const;
export type ModuleName = (typeof MODULE_NAMES)[number];

export const Modules = z.strictObject({
  map: z.boolean(),
  story: z.boolean(),
  lives: z.boolean(),
  boosters: z.boolean(),
  shop: z.boolean(),
  ads: z.boolean(),
  iap: z.boolean(),
  quests: z.boolean(),
  collections: z.boolean(),
  buildings: z.boolean(),
  dailyReward: z.boolean(),
  events: z.boolean(),
  notifications: z.boolean(),
  leaderboards: z.boolean().describe("Server-side leaderboards from verified attempts (needs a backend)"),
});
export type Modules = z.infer<typeof Modules>;

/**
 * Version 2 moved everything store-specific (bundle ids, packages, endpoints) to release.json, so
 * game.json describes the game and nothing about where it ships. See the 1 -> 2 migration.
 */
export const GAME_SCHEMA_VERSION = 2 as const;

export const GameDefinition = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: z.literal(GAME_SCHEMA_VERSION),
    gameId: Id,
    name: z.string().min(2).max(30).describe("Store and display name (30 chars max for stores)"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/).describe("Marketing version (semver)"),
    template: Id,
    theme: Id,
    mechanic: z.strictObject({
      id: Id,
      rules: JsonObject.optional().describe("Default rule overrides passed to the level generator"),
    }),
    modules: Modules.partial().optional(),
    content: z.strictObject({
      locales: z.array(z.string().min(2)).min(1),
      defaultLocale: z.string().min(2),
      packs: z.array(Id).default([]),
    }),
    remoteConfig: z
      .strictObject({ refreshHours: z.number().positive().default(12) })
      .optional()
      .describe("Payload URLs are per environment, in release.json"),
    meta: z
      .strictObject({
        pitch: z.string().max(300),
        tags: z.array(z.string()).default([]),
        audience: z.string().optional(),
      })
      .optional(),
    overrides: z
      .strictObject({
        economy: JsonObject.optional(),
        monetization: JsonObject.optional(),
        store: JsonObject.optional(),
      })
      .optional(),
  })
  .meta({ title: "GameDefinition", description: "games/ID/game.json: the root of one game package" });
export type GameDefinition = z.infer<typeof GameDefinition>;
