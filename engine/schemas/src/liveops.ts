import { z } from "zod";
import { AssetKey, Id, ItemBag, LocKey, SchemaVersion } from "./common";
import { DomainEvent } from "./quests";
import { Palette } from "./theme";

export const EventDefinition = z.strictObject({
  id: Id,
  type: z.enum(["race", "collection", "milestone", "double_rewards"]),
  titleKey: LocKey,
  descriptionKey: LocKey,
  schedule: z.strictObject({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    recurrence: z.enum(["none", "weekly"]),
  }),
  eligibility: z.strictObject({ minLevel: z.int().positive() }),
  points: z.partialRecord(DomainEvent, z.int().positive()).optional(),
  milestones: z.array(z.strictObject({ points: z.int().positive(), reward: z.union([Id, ItemBag]) })).optional(),
  themeOverlay: z.strictObject({ palette: Palette.partial().optional(), bannerAsset: AssetKey.optional() }).optional(),
  offers: z.array(Id).default([]),
});
export type EventDefinition = z.infer<typeof EventDefinition>;

export const EventsFile = z
  .strictObject({ $schema: z.string().optional(), schemaVersion: SchemaVersion, events: z.array(EventDefinition) })
  .meta({ title: "EventsFile", description: "games/ID/events.json: LiveOps events (runtime in Phase 2)" });
export type EventsFile = z.infer<typeof EventsFile>;
