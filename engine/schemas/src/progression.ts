import { z } from "zod";
import { Color, Id, ItemBag, LocKey, SchemaVersion } from "./common";

export const ChapterDefinition = z.strictObject({
  id: Id,
  titleKey: LocKey,
  subtitleKey: LocKey.optional(),
  levels: z.strictObject({ from: z.int().positive(), to: z.int().positive() }),
  accent: Color.optional(),
  unlock: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("previous_chapter") }),
    z.strictObject({ type: z.literal("stars"), stars: z.int().positive() }),
  ]),
  completionReward: z.union([Id, ItemBag]).optional().describe("rewardTables id or an inline item bag"),
  storyIntro: Id.optional(),
  storyOutro: Id.optional(),
});
export type ChapterDefinition = z.infer<typeof ChapterDefinition>;

export const ProgressionDefinition = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: SchemaVersion,
    unlockRule: z.literal("linear"),
    replayCompleted: z.boolean().default(false),
    chapters: z.array(ChapterDefinition).min(1),
  })
  .meta({ title: "ProgressionDefinition", description: "games/ID/progression.json: chapters and unlocks" });
export type ProgressionDefinition = z.infer<typeof ProgressionDefinition>;
