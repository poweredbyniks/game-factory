import { z } from "zod";
import { AssetKey, Id } from "./common";
import { AnalyticsTaxonomy } from "./analytics";
import { EconomyDefinition } from "./economy";
import { Modules } from "./game";
import { LeaderboardDefinition } from "./leaderboards";
import { LevelDefinition } from "./level";
import { EventDefinition } from "./liveops";
import { MonetizationDefinition } from "./monetization";
import { CharacterDefinition, StoryBeat } from "./narrative";
import { ProgressionDefinition } from "./progression";
import { QuestDefinition } from "./quests";
import { Tuning } from "./remote";
import { StoreDefinition } from "./store";
import { ThemeDefinition } from "./theme";

export const BUNDLE_FORMAT = 1 as const;

/** Assets after compilation: SVG inlined, binary files referenced by a module key of the app's asset registry. */
export const ResolvedAsset = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("svg"), xml: z.string() }),
  z.strictObject({ type: z.literal("image"), module: z.string(), width: z.int().optional(), height: z.int().optional() }),
  z.strictObject({ type: z.literal("font"), module: z.string(), family: z.string() }),
  z.strictObject({ type: z.literal("audio"), module: z.string(), volume: z.number() }),
]);
export type ResolvedAsset = z.infer<typeof ResolvedAsset>;

export const ResolvedTheme = ThemeDefinition.omit({ $schema: true, assets: true }).extend({
  assets: z.record(AssetKey, ResolvedAsset),
});
export type ResolvedTheme = z.infer<typeof ResolvedTheme>;

export const GameBundle = z
  .strictObject({
    bundleFormat: z.literal(BUNDLE_FORMAT),
    build: z.strictObject({
      gameId: Id,
      gameVersion: z.string(),
      engineVersion: z.string(),
      contentHash: z.string(),
    }),
    game: z.strictObject({
      gameId: Id,
      name: z.string(),
      version: z.string(),
      template: Id,
      theme: Id,
      mechanic: Id,
      modules: Modules,
      defaultLocale: z.string(),
      locales: z.array(z.string()),
    }),
    template: z.strictObject({
      templateId: Id,
      coreLoop: z.array(z.string()),
      ui: z.strictObject({ screens: z.array(Id), mapHud: z.array(Id), levelHud: z.array(Id) }),
    }),
    theme: ResolvedTheme,
    economy: EconomyDefinition,
    progression: ProgressionDefinition,
    levels: z.array(LevelDefinition),
    characters: z.array(CharacterDefinition),
    story: z.array(StoryBeat),
    store: StoreDefinition,
    monetization: MonetizationDefinition,
    quests: z.array(QuestDefinition),
    events: z.array(EventDefinition),
    leaderboards: z.array(LeaderboardDefinition).default([]),
    analytics: AnalyticsTaxonomy,
    tuning: Tuning,
    remote: z
      .strictObject({ url: z.string().optional(), refreshHours: z.number() })
      .describe("url is deprecated: endpoints are per environment in the release configuration"),
    strings: z.record(z.string(), z.record(z.string(), z.string())).describe("locale -> key -> text"),
  })
  .meta({ title: "GameBundle", description: "Compiled, validated runtime artifact consumed by the app" });
export type GameBundle = z.infer<typeof GameBundle>;
