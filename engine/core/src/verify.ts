import {
  AttemptRecord, type AttemptVerdict, type BoosterEffect, type EconomyDefinition, type GameBundle, type Tuning,
} from "@gf/schemas";
import { LevelSession, type SessionAction } from "./level-session";
import { attemptStars, type MechanicRegistry } from "./mechanic";

export type VerifyOptions = {
  /**
   * The effective economy and tuning the attempt was played with: bundle defaults plus the remote
   * payload and experiment variants the record reports. Defaults to the bundle's own values.
   */
  config?: { economy: EconomyDefinition; tuning: Tuning };
  /** Attempts faster than this many milliseconds per logged action are flagged. Server policy. */
  minMsPerAction?: number;
};

export const DEFAULT_MIN_MS_PER_ACTION = 150;

type Reason = NonNullable<AttemptVerdict["reason"]>;
type CountedEffect = Exclude<BoosterEffect, "hint">;

/**
 * Judges a submitted attempt by replaying it with the same engine the client ran. Pure: the
 * caller chooses the bundle by the record's contentHash and the config by its remote payload and
 * experiment variants. Rewards are not decided here; the server derives them from the verdict's
 * stars and its own record of the player's progress.
 */
export function verifyAttempt(bundle: GameBundle, mechanics: MechanicRegistry, input: unknown, opts: VerifyOptions = {}): AttemptVerdict {
  const parsed = AttemptRecord.safeParse(input);
  const attemptId = parsed.success ? parsed.data.attemptId : String((input as { attemptId?: unknown } | null)?.attemptId ?? "");
  const verdict = (status: "rejected" | "unverifiable", reason: Reason, detail?: string): AttemptVerdict => ({
    attemptId, status, reason, ...(detail ? { detail } : {}), flags: [],
  });
  const reject = (reason: Reason, detail?: string) => verdict("rejected", reason, detail);

  if (!parsed.success) return reject("malformed", parsed.error.issues[0]?.message);
  const record = parsed.data;
  if (record.gameId !== bundle.game.gameId) return reject("wrong_game");
  if (record.contentHash !== bundle.build.contentHash) return verdict("unverifiable", "content_unknown", record.contentHash);
  if (record.finishedAt < record.startedAt) return reject("malformed", "finishedAt is before startedAt");
  const level = bundle.levels.find((l) => l.levelId === record.levelId);
  if (!level) return reject("unknown_level");
  if (record.mechanic.id !== level.mechanic) return reject("mechanic_mismatch");
  const mechanic = mechanics[level.mechanic];
  if (!mechanic) return verdict("unverifiable", "mechanic_unavailable", level.mechanic);
  if (record.mechanic.version !== mechanic.version) {
    return verdict("unverifiable", "mechanic_version", `played on ${record.mechanic.version}, server runs ${mechanic.version}`);
  }
  // The seed drives shuffles. Binding it to player, level and attempt number stops seed shopping.
  if (record.seed !== `${record.playerId}:${record.levelId}:${record.attempt}` || record.attemptId !== record.seed) {
    return reject("seed_mismatch");
  }
  const economy = opts.config?.economy ?? bundle.economy;
  const tuning = opts.config?.tuning ?? bundle.tuning;
  const expectedBonus = tuning.difficulty.moveBonus + (tuning.difficulty.perLevel[level.levelId]?.moveBonus ?? 0);
  if (record.moveBonus !== expectedBonus) return reject("move_bonus_mismatch", `${record.moveBonus} vs ${expectedBonus}`);
  const data = mechanic.levelDataSchema.safeParse(level.data);
  if (!data.success) return verdict("unverifiable", "content_unknown", "level data does not parse");

  const allowed = economy.boosters.filter((b) => level.boosters.allowed.includes(b.id));
  const allows = (effect: BoosterEffect) => allowed.some((b) => b.effect === effect);
  const addMovesAmounts = new Set(allowed.filter((b) => b.effect === "add_moves").map((b) => b.amount ?? economy.continue.extraMoves));
  const used: Record<CountedEffect, number> = { undo: 0, auto_place: 0, add_moves: 0, shuffle: 0 };
  let continues = 0;

  const session = new LevelSession(mechanic, level, data.data, record.seed, record.moveBonus);
  for (const [index, raw] of record.actions.entries()) {
    const entry = raw as SessionAction<unknown> | null;
    const at = `action ${index}`;
    const status = session.status();
    switch (entry?.t) {
      case "act":
      case "auto": {
        if (status !== "playing") return reject("action_after_end", at);
        if (!mechanic.isAction(entry.a)) return reject("malformed", `${at}: not an action`);
        if (entry.t === "auto") {
          if (!mechanic.autoPlace || !allows("auto_place")) return reject("booster_not_allowed", `${at}: auto_place`);
          used.auto_place += 1;
        }
        const result = entry.t === "act" ? session.act(entry.a) : session.autoPlace(entry.a);
        if (result.outcome === "illegal") return reject("illegal_action", at);
        break;
      }
      case "undo":
        if (status !== "playing") return reject("action_after_end", at);
        if (!allows("undo")) return reject("booster_not_allowed", `${at}: undo`);
        if (!session.undo()) return reject("illegal_action", `${at}: nothing to undo`);
        used.undo += 1;
        break;
      case "budget": {
        if (!Number.isInteger(entry.n) || entry.n <= 0) return reject("budget_tampered", at);
        const outOfMoves = status === "lost" && session.lossReason() === "out_of_moves";
        const src = entry.src ?? (outOfMoves ? "continue" : "booster");
        if (src === "continue") {
          if (!outOfMoves) return reject("continue_not_allowed", `${at}: the attempt was not out of moves`);
          if (entry.n !== economy.continue.extraMoves) return reject("budget_tampered", `${at}: a continue adds ${economy.continue.extraMoves}`);
          continues += 1;
          if (continues > economy.continue.maxContinues) return reject("continue_not_allowed", `${at}: more than ${economy.continue.maxContinues} continues`);
        } else {
          if (status !== "playing") return reject("action_after_end", at);
          if (addMovesAmounts.size === 0) return reject("booster_not_allowed", `${at}: add_moves`);
          if (!addMovesAmounts.has(entry.n)) return reject("budget_tampered", `${at}: no booster adds ${entry.n}`);
          used.add_moves += 1;
        }
        session.addBudget(entry.n, src);
        break;
      }
      case "shuffle":
        if (status !== "playing") return reject("action_after_end", at);
        if (!allows("shuffle")) return reject("booster_not_allowed", `${at}: shuffle`);
        if (!session.shuffle()) return reject("illegal_action", `${at}: shuffle unsupported`);
        used.shuffle += 1;
        break;
      default:
        return reject("malformed", `${at}: unknown entry`);
    }
  }

  // Per-effect limits, counted from the log: the client's own counts are claims, not evidence.
  for (const effect of Object.keys(used) as CountedEffect[]) {
    const defs = allowed.filter((b) => b.effect === effect);
    if (defs.length === 0 || defs.some((b) => b.maxPerLevel === undefined)) continue;
    const cap = defs.reduce((sum, b) => sum + b.maxPerLevel!, 0);
    if (used[effect] > cap) return reject("booster_limit", `${effect}: ${used[effect]} uses, limit ${cap}`);
  }
  const claimed: Record<CountedEffect, number> = { undo: 0, auto_place: 0, add_moves: 0, shuffle: 0 };
  for (const [boosterId, count] of Object.entries(record.boostersUsed)) {
    if (count === 0) continue;
    const def = allowed.find((b) => b.id === boosterId);
    if (!def) return reject("booster_not_allowed", boosterId);
    if (def.maxPerLevel !== undefined && count > def.maxPerLevel) return reject("booster_limit", boosterId);
    if (def.effect !== "hint") claimed[def.effect] += count;
  }

  const status = session.status();
  const won = status === "won";
  if (record.outcome.won && !won) return reject("outcome_mismatch", `claimed a win; the replay ends ${status}`);
  const evaluation = session.evaluate();
  const stars = attemptStars(won, evaluation);

  const flags: AttemptVerdict["flags"] = [];
  if (record.outcome.won !== won || record.outcome.stars !== stars) flags.push("claimed_stars_mismatch");
  const usageDiffers = (Object.keys(used) as CountedEffect[]).some((e) => used[e] !== claimed[e]) || record.continues !== continues;
  if (usageDiffers) flags.push("claimed_usage_mismatch");
  const minMs = opts.minMsPerAction ?? DEFAULT_MIN_MS_PER_ACTION;
  if (record.actions.length > 0 && record.finishedAt - record.startedAt < record.actions.length * minMs) flags.push("too_fast");

  return {
    attemptId,
    status: "accepted",
    result: { won, stars, score: evaluation.score, movesUsed: evaluation.movesUsed, continues, boosters: { ...used } },
    flags,
  };
}
