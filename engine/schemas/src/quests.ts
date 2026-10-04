import { z } from "zod";
import { Id, ItemBag, LocKey, SchemaVersion } from "./common";

export const DOMAIN_EVENTS = [
  "level_completed", "level_failed", "category_completed", "booster_used",
  "stars_earned", "coins_spent", "chapter_completed",
] as const;
export const DomainEvent = z.enum(DOMAIN_EVENTS);
export type DomainEvent = z.infer<typeof DomainEvent>;

export const QuestDefinition = z.strictObject({
  id: Id,
  titleKey: LocKey,
  descriptionKey: LocKey,
  type: z.enum(["daily", "weekly", "story", "achievement"]),
  objective: z.strictObject({
    event: DomainEvent,
    count: z.int().positive(),
    filter: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  }),
  reward: z.union([Id, ItemBag]),
  prerequisites: z.array(Id).default([]),
  availableFromLevel: z.int().positive().optional(),
  expiresAfterHours: z.int().positive().optional(),
});
export type QuestDefinition = z.infer<typeof QuestDefinition>;

export const QuestsFile = z
  .strictObject({ $schema: z.string().optional(), schemaVersion: SchemaVersion, quests: z.array(QuestDefinition) })
  .meta({ title: "QuestsFile", description: "games/ID/quests.json (runtime in Phase 2)" });
export type QuestsFile = z.infer<typeof QuestsFile>;
