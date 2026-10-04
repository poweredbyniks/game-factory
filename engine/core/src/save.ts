import type { EconomyDefinition } from "@gf/schemas";
import { z } from "zod";
import { initialAdCounters } from "./ads-policy";
import { initialProgress } from "./progression";
import { initialWallet } from "./wallet";

export const SAVE_VERSION = 1 as const;

export const SessionRecord = z.object({
  levelId: z.string(),
  seed: z.string(),
  attempt: z.int().positive(),
  startedAt: z.number(),
  moveBonus: z.int().default(0),
  continues: z.int().nonnegative().default(0),
  boostersUsed: z.record(z.string(), z.int()).default({}),
  livesCharged: z.boolean().default(false),
  actions: z.array(z.unknown()),
});
export type SessionRecord = z.infer<typeof SessionRecord>;

export const SaveDocument = z.object({
  saveVersion: z.literal(SAVE_VERSION),
  gameId: z.string(),
  playerId: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  inventory: z.record(z.string(), z.int()),
  energy: z.object({ count: z.int().nonnegative(), anchor: z.number().nullable() }),
  progress: z.object({
    frontier: z.int().positive(),
    completed: z.record(z.string(), z.object({ stars: z.int(), bestMovesLeft: z.int(), completedAt: z.number() })),
  }),
  storySeen: z.array(z.string()).default([]),
  chaptersRewarded: z.array(z.string()).default([]),
  settings: z
    .object({
      sound: z.boolean().default(true),
      music: z.boolean().default(true),
      haptics: z.boolean().default(true),
      locale: z.string().nullable().default(null),
    })
    .prefault({}),
  experiments: z.record(z.string(), z.string()).default({}),
  entitlements: z.array(z.string()).default([]),
  stats: z
    .object({
      sessions: z.int().default(0),
      levelsStarted: z.int().default(0),
      wins: z.int().default(0),
      losses: z.int().default(0),
      attempts: z.record(z.string(), z.int()).default({}),
      boostersUsed: z.int().default(0),
      adsWatched: z.int().default(0),
      purchases: z.int().default(0),
    })
    .prefault({}),
  ads: z
    .object({
      levelsSinceInterstitial: z.int().default(0),
      lastInterstitialAt: z.number().nullable().default(null),
      rewardedDay: z.string().nullable().default(null),
      rewardedToday: z.int().default(0),
    })
    .prefault({}),
  offers: z.object({ day: z.string().nullable().default(null), counts: z.record(z.string(), z.int()).default({}) }).prefault({}),
  /** Store transactions already granted. A redelivered transaction is finished, never granted twice. */
  purchases: z.object({ processed: z.array(z.string()).default([]) }).prefault({}),
  session: SessionRecord.nullable().default(null),
});
export type SaveDocument = z.infer<typeof SaveDocument>;

export interface SaveStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemorySaveStore implements SaveStore {
  readonly data = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
}

export const saveKey = (gameId: string) => `gf.save.${gameId}`;
export const remoteKey = (gameId: string) => `gf.remote.${gameId}`;
/**
 * Finished attempts waiting for the backend, kept apart from the save so the save written after every
 * move stays small. Loosely typed: the sync layer validates each record.
 */
export const outboxKey = (gameId: string) => `gf.outbox.${gameId}`;

export function generatePlayerId(now: number): string {
  const random = Math.floor(Math.random() * 2 ** 32).toString(36).padStart(7, "0");
  return `p_${now.toString(36)}_${random}`;
}

export function newSave(economy: EconomyDefinition, gameId: string, playerId: string, now: number): SaveDocument {
  const wallet = initialWallet(economy);
  return SaveDocument.parse({
    saveVersion: SAVE_VERSION,
    gameId,
    playerId,
    createdAt: now,
    updatedAt: now,
    inventory: wallet.inventory,
    energy: wallet.energy,
    progress: initialProgress(),
    ads: initialAdCounters(),
  });
}

/** Forward migrations for save documents, keyed by the version they upgrade from. */
export const SAVE_MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

export type LoadResult = {
  save: SaveDocument;
  status: "new" | "loaded" | "migrated" | "reset";
  problems: string[];
};

/** Parses, migrates and validates a stored save. A corrupt save is reported and replaced. */
export function loadSave(
  raw: string | null,
  economy: EconomyDefinition,
  gameId: string,
  now: number,
  playerId?: string,
): LoadResult {
  if (!raw) return { save: newSave(economy, gameId, playerId ?? generatePlayerId(now), now), status: "new", problems: [] };
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    return { save: newSave(economy, gameId, playerId ?? generatePlayerId(now), now), status: "reset", problems: [`save is not JSON: ${String(error)}`] };
  }
  let migrated = false;
  let version = typeof doc.saveVersion === "number" ? doc.saveVersion : 0;
  while (version < SAVE_VERSION) {
    const step = SAVE_MIGRATIONS[version];
    if (!step) break;
    doc = { ...step(doc), saveVersion: version + 1 };
    version += 1;
    migrated = true;
  }
  const parsed = SaveDocument.safeParse(doc);
  if (!parsed.success || parsed.data.gameId !== gameId) {
    const problems = parsed.success
      ? [`save belongs to "${parsed.data.gameId}"`]
      : parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    const keepId = typeof doc.playerId === "string" ? doc.playerId : undefined;
    return { save: newSave(economy, gameId, keepId ?? playerId ?? generatePlayerId(now), now), status: "reset", problems };
  }
  return { save: parsed.data, status: migrated ? "migrated" : "loaded", problems: [] };
}
