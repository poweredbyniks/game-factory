import { z } from "zod";
import { Color, Id, IconRef, LocKey, SchemaVersion } from "./common";

export const CharacterDefinition = z.strictObject({
  id: Id,
  nameKey: LocKey,
  role: z.string(),
  personality: z.array(z.string()).min(1),
  portrait: IconRef,
  color: Color,
  appearance: z.string().describe("Art brief for the asset pipeline"),
  voice: z.string().describe("Writing brief for dialogue generation"),
  relationships: z
    .array(
      z.strictObject({
        characterId: Id,
        kind: z.enum(["friend", "family", "rival", "mentor"]),
        note: z.string(),
      }),
    )
    .default([]),
});
export type CharacterDefinition = z.infer<typeof CharacterDefinition>;

export const CharactersFile = z
  .strictObject({ $schema: z.string().optional(), schemaVersion: SchemaVersion, characters: z.array(CharacterDefinition) })
  .meta({ title: "CharactersFile", description: "games/ID/characters.json" });
export type CharactersFile = z.infer<typeof CharactersFile>;

export const StoryTrigger = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("chapter_start"), chapter: Id }),
  z.strictObject({ type: z.literal("chapter_complete"), chapter: Id }),
  z.strictObject({ type: z.literal("level_complete"), level: z.int().positive() }),
]);
export type StoryTrigger = z.infer<typeof StoryTrigger>;

export const StoryBeat = z.strictObject({
  id: Id,
  trigger: StoryTrigger,
  lines: z
    .array(
      z.strictObject({
        speaker: z.union([Id, z.literal("narrator")]),
        textKey: LocKey,
        emotion: z.string().optional(),
      }),
    )
    .min(1),
});
export type StoryBeat = z.infer<typeof StoryBeat>;

export const StoryFile = z
  .strictObject({ $schema: z.string().optional(), schemaVersion: SchemaVersion, beats: z.array(StoryBeat) })
  .meta({ title: "StoryFile", description: "games/ID/story.json: dialogue beats triggered by progression" });
export type StoryFile = z.infer<typeof StoryFile>;
