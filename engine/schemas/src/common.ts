import { z } from "zod";

/** Lowercase identifier: games, themes, items, levels, categories, cards. Stable once shipped. */
export const Id = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_.:-]*$/, "ids are lowercase: [a-z0-9][a-z0-9_.:-]*")
  .max(80)
  .describe("Lowercase stable identifier");
export type Id = z.infer<typeof Id>;

/** Key into a string table, e.g. "ui.map.play" or "content.word.fruits.apple". */
export const LocKey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_.-]*$/, "string keys are lowercase dotted paths")
  .describe("Localization string key");
export type LocKey = z.infer<typeof LocKey>;

export const Color = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "colors are #RRGGBB or #RRGGBBAA")
  .describe("Hex color");
export type Color = z.infer<typeof Color>;

export const AssetKey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_.-]*$/)
  .describe("Semantic asset key, e.g. card.back or sfx.place");
export type AssetKey = z.infer<typeof AssetKey>;

/** A bag of item amounts: { "coins": 50, "hint": 1 }. */
export const ItemBag = z.record(Id, z.int().positive()).describe("Item id to positive amount");
export type ItemBag = z.infer<typeof ItemBag>;

export const SchemaVersion = z.literal(1).describe("Schema version of this file");

export const TIERS = ["tutorial", "easy", "medium", "hard", "expert"] as const;
export const Tier = z.enum(TIERS);
export type Tier = z.infer<typeof Tier>;

/** Every icon the UI may ask a theme for. Templates declare which ones they need. */
export const ICON_NAMES = [
  "coin", "gem", "life", "star", "hint", "undo", "joker", "moves", "stock", "lock", "shop",
  "settings", "play", "close", "back", "sound", "music", "haptics", "chest", "ad", "check", "info",
] as const;
export const IconName = z.enum(ICON_NAMES);
export type IconName = z.infer<typeof IconName>;

/** Every sound cue the runtime may emit. Missing cues are silent. */
export const SOUND_NAMES = [
  "tap", "select", "place", "mismatch", "draw", "flip", "complete", "win", "lose", "coin", "button", "popup",
] as const;
export const SoundName = z.enum(SOUND_NAMES);
export type SoundName = z.infer<typeof SoundName>;

/** An icon is either an emoji (great for placeholders) or a theme asset. */
export const IconRef = z.union([
  z.strictObject({ emoji: z.string().min(1).max(16) }),
  z.strictObject({ asset: AssetKey }),
]);
export type IconRef = z.infer<typeof IconRef>;

/** Arbitrary JSON object used for partial overrides; validated after merging. */
export const JsonObject = z.record(z.string(), z.unknown());
export type JsonObject = z.infer<typeof JsonObject>;
