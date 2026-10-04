import { z } from "zod";
import { Id } from "./common";

/**
 * Contracts between the app and the game backend. The server imports these same schemas, so a
 * payload that validates on one side validates on the other. Exported as JSON Schema for any
 * other consumer.
 */

/** Where a store transaction came from. "mock" exists only in development builds. */
export const StorePlatform = z.enum(["ios", "android", "mock"]);
export type StorePlatform = z.infer<typeof StorePlatform>;

export const ATTEMPT_FORMAT = 1 as const;

/** A finished level attempt: everything the server needs to replay it with the same engine. */
export const AttemptRecord = z
  .strictObject({
    format: z.literal(ATTEMPT_FORMAT),
    attemptId: z.string().min(3).max(240).describe("Unique per player; equals the seed"),
    gameId: Id,
    playerId: z.string().min(1).max(80),
    levelId: Id,
    attempt: z.int().positive(),
    seed: z.string().min(1).max(240),
    contentHash: z.string().min(1).describe("Selects the shipped bundle the attempt was played on"),
    engineVersion: z.string(),
    mechanic: z.strictObject({ id: Id, version: z.string() }),
    moveBonus: z.int(),
    remote: z.strictObject({
      payloadVersion: z.string().nullable(),
      experiments: z.record(z.string(), z.string()),
    }),
    startedAt: z.number(),
    finishedAt: z.number(),
    actions: z.array(z.unknown()).max(10_000),
    boostersUsed: z.record(Id, z.int().nonnegative()),
    continues: z.int().nonnegative(),
    outcome: z.strictObject({
      won: z.boolean(),
      stars: z.int().min(0).max(3),
      score: z.number(),
      reason: z.string().nullable(),
    }),
  })
  .meta({ title: "AttemptRecord", description: "POST /v1/attempts: a finished attempt the server replays" });
export type AttemptRecord = z.infer<typeof AttemptRecord>;

/** Provably invalid: the moves or the claims cannot have happened. */
export const ATTEMPT_REJECTIONS = [
  "malformed", "wrong_game", "unknown_level", "mechanic_mismatch", "seed_mismatch", "move_bonus_mismatch",
  "illegal_action", "action_after_end", "budget_tampered", "continue_not_allowed", "booster_not_allowed",
  "booster_limit", "outcome_mismatch",
] as const;
/** Cannot be judged by this server build: never a cheating signal on its own. */
export const ATTEMPT_UNVERIFIABLE = ["content_unknown", "mechanic_unavailable", "mechanic_version"] as const;
/** Accepted, but suspicious. Flagged attempts stay off public leaderboards until reviewed. */
export const ATTEMPT_FLAGS = ["claimed_stars_mismatch", "claimed_usage_mismatch", "too_fast"] as const;

export const AttemptVerdict = z
  .strictObject({
    attemptId: z.string(),
    status: z.enum(["accepted", "rejected", "unverifiable"]),
    reason: z.enum([...ATTEMPT_REJECTIONS, ...ATTEMPT_UNVERIFIABLE]).optional(),
    detail: z.string().optional(),
    result: z
      .strictObject({
        won: z.boolean(),
        stars: z.int().min(0).max(3),
        score: z.number(),
        movesUsed: z.int(),
        continues: z.int(),
        boosters: z.record(z.string(), z.int()).describe("Booster uses by effect, counted from the move log"),
      })
      .optional(),
    flags: z.array(z.enum(ATTEMPT_FLAGS)).default([]),
  })
  .meta({ title: "AttemptVerdict", description: "The server's judgement of one AttemptRecord" });
export type AttemptVerdict = z.infer<typeof AttemptVerdict>;

export const PurchaseVerificationRequest = z
  .strictObject({
    gameId: Id,
    playerId: z.string().min(1).max(80),
    productId: Id,
    platform: StorePlatform,
    transactionId: z.string().min(1).max(200),
    verificationData: z.string().min(1).max(20_000).describe("StoreKit 2 signed transaction (JWS) on iOS, purchase token on Android"),
  })
  .meta({ title: "PurchaseVerificationRequest", description: "POST /v1/purchases/verify" });
export type PurchaseVerificationRequest = z.infer<typeof PurchaseVerificationRequest>;

/**
 * verified: grant, save, then finish the transaction. invalid: never grant; finish it so the store
 * stops re-delivering it. unavailable: grant nothing and keep it unfinished; it is retried later.
 */
export const PurchaseVerificationResult = z
  .discriminatedUnion("status", [
    z.strictObject({ status: z.literal("verified"), environment: z.enum(["production", "sandbox", "mock"]).optional() }),
    z.strictObject({ status: z.literal("invalid"), reason: z.string() }),
    z.strictObject({ status: z.literal("unavailable"), reason: z.string() }),
  ])
  .meta({ title: "PurchaseVerificationResult", description: "Response of POST /v1/purchases/verify" });
export type PurchaseVerificationResult = z.infer<typeof PurchaseVerificationResult>;

export const LeaderboardPage = z
  .strictObject({
    boardId: Id,
    period: z.string().describe("all, 2026-W40, 2026-10-03 or an event id"),
    generatedAt: z.number(),
    entries: z.array(
      z.strictObject({ rank: z.int().positive(), playerId: z.string(), displayName: z.string(), value: z.int() }),
    ),
    me: z.strictObject({ rank: z.int().positive().nullable(), value: z.int() }).optional(),
  })
  .meta({ title: "LeaderboardPage", description: "GET /v1/leaderboards/{boardId}" });
export type LeaderboardPage = z.infer<typeof LeaderboardPage>;
