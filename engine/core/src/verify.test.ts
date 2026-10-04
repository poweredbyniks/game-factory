import type { AttemptRecord, GameBundle } from "@gf/schemas";
import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock";
import { GameRuntime } from "./runtime";
import { MemorySaveStore } from "./save";
import { counterMechanic, makeBundle } from "./test-support";
import { verifyAttempt } from "./verify";

const MECHANICS = { counter: counterMechanic };
type Play = (runtime: GameRuntime, step: (fn: () => unknown) => void) => void;

/** Plays level 1 through the real runtime and returns the record it queued for the backend. */
async function played(play: Play, opts: { bundle?: GameBundle; humanPace?: boolean } = {}) {
  const bundle = opts.bundle ?? makeBundle();
  const clock = new ManualClock();
  const runtime = await GameRuntime.create({
    bundle, mechanics: MECHANICS, store: new MemorySaveStore(), clock, platform: "node", appVersion: "test", playerId: "p1",
  });
  expect(runtime.startLevel("test.l1")).toEqual({ ok: true });
  play(runtime, (fn) => {
    if (opts.humanPace !== false) clock.advance(1000);
    fn();
  });
  const result = runtime.activeSession ? runtime.finishLevel() : runtime.getSnapshot().lastResult!;
  const record = runtime.pendingAttempts().at(-1) as AttemptRecord;
  return { bundle, record, result };
}

const winning: Play = (rt, step) => {
  for (let i = 0; i < 3; i++) step(() => rt.act({ type: "inc" }));
};
const losing: Play = (rt, step) => {
  for (let i = 0; i < 5; i++) step(() => rt.act({ type: "wrong" }));
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const tamper = (record: AttemptRecord, change: (r: AttemptRecord) => void): AttemptRecord => {
  const copy = clone(record);
  change(copy);
  return copy;
};

describe("verifyAttempt", () => {
  it("accepts the records the runtime writes, with the stars the player saw", async () => {
    const { bundle, record, result } = await played(winning);
    expect(verifyAttempt(bundle, MECHANICS, record)).toEqual({
      attemptId: "p1:test.l1:1",
      status: "accepted",
      result: { won: true, stars: result.stars, score: 30, movesUsed: 3, continues: 0, boosters: { undo: 0, auto_place: 0, add_moves: 0, shuffle: 0 } },
      flags: [],
    });
  });

  it("accepts continues and boosters used by the rules", async () => {
    const { bundle, record, result } = await played((rt, step) => {
      losing(rt, step);
      step(() => expect(rt.continueWithCoins()).toEqual({ ok: true }));
      step(() => expect(rt.useBooster("plus5")).toMatchObject({ ok: true }));
      winning(rt, step);
    });
    expect(result.won).toBe(true);
    const verdict = verifyAttempt(bundle, MECHANICS, record);
    expect(verdict).toMatchObject({ status: "accepted", flags: [], result: { won: true, continues: 1, boosters: { add_moves: 1 } } });
  });

  it("rejects a win the moves do not produce", async () => {
    const { bundle, record } = await played(losing);
    const forged = tamper(record, (r) => (r.outcome = { won: true, stars: 3, score: 30, reason: null }));
    expect(verifyAttempt(bundle, MECHANICS, forged)).toMatchObject({ status: "rejected", reason: "outcome_mismatch" });
  });

  it("rejects moves after the end, illegal moves and unknown entries", async () => {
    const { bundle, record } = await played(winning);
    const extra = tamper(record, (r) => r.actions.push({ t: "act", a: { type: "inc" } }));
    expect(verifyAttempt(bundle, MECHANICS, extra)).toMatchObject({ status: "rejected", reason: "action_after_end" });
    const illegal = tamper(record, (r) => (r.actions[0] = { t: "act", a: { type: "noop" } }));
    expect(verifyAttempt(bundle, MECHANICS, illegal)).toMatchObject({ status: "rejected", reason: "illegal_action" });
    const unknown = tamper(record, (r) => r.actions.unshift({ t: "teleport" }));
    expect(verifyAttempt(bundle, MECHANICS, unknown)).toMatchObject({ status: "rejected", reason: "malformed" });
  });

  it("rejects forged budget: oversized boosts, continues while playing, too many continues", async () => {
    const won = await played(winning);
    const boost = tamper(won.record, (r) => r.actions.unshift({ t: "budget", n: 50, src: "booster" }));
    expect(verifyAttempt(won.bundle, MECHANICS, boost)).toMatchObject({ reason: "budget_tampered" });
    const early = tamper(won.record, (r) => r.actions.unshift({ t: "budget", n: 5, src: "continue" }));
    expect(verifyAttempt(won.bundle, MECHANICS, early)).toMatchObject({ reason: "continue_not_allowed" });

    const lost = await played(losing);
    const bigContinue = tamper(lost.record, (r) => r.actions.push({ t: "budget", n: 9 }));
    expect(verifyAttempt(lost.bundle, MECHANICS, bigContinue)).toMatchObject({ reason: "budget_tampered" });
    const wrongs = Array.from({ length: 5 }, () => ({ t: "act", a: { type: "wrong" } }));
    const endless = tamper(lost.record, (r) =>
      r.actions.push({ t: "budget", n: 5 }, ...wrongs, { t: "budget", n: 5 }, ...wrongs, { t: "budget", n: 5 }),
    );
    expect(verifyAttempt(lost.bundle, MECHANICS, endless)).toMatchObject({ reason: "continue_not_allowed" });
  });

  it("enforces booster rules from the move log, not from the client's counts", async () => {
    const { bundle, record } = await played((rt, step) => {
      step(() => expect(rt.useBooster("joker", { type: "inc" })).toMatchObject({ ok: true }));
      step(() => rt.act({ type: "inc" }));
      step(() => rt.act({ type: "inc" }));
    });
    expect(verifyAttempt(bundle, MECHANICS, record)).toMatchObject({ status: "accepted", flags: [] });
    const hidden = tamper(record, (r) => (r.boostersUsed = {}));
    expect(verifyAttempt(bundle, MECHANICS, hidden)).toMatchObject({ status: "accepted", flags: ["claimed_usage_mismatch"] });
    const twice = tamper(record, (r) => (r.actions[1] = { t: "auto", a: { type: "inc" } }));
    expect(verifyAttempt(bundle, MECHANICS, twice)).toMatchObject({ status: "rejected", reason: "booster_limit" });
    const noJoker = clone(bundle);
    noJoker.levels[0]!.boosters.allowed = ["hint"];
    expect(verifyAttempt(noJoker, MECHANICS, record)).toMatchObject({ status: "rejected", reason: "booster_not_allowed" });
  });

  it("binds the seed to the attempt and the move bonus to the effective config", async () => {
    const { bundle, record } = await played(winning);
    expect(verifyAttempt(bundle, MECHANICS, tamper(record, (r) => (r.seed = "p1:test.l1:7")))).toMatchObject({ reason: "seed_mismatch" });
    const bonus = tamper(record, (r) => (r.moveBonus = 3));
    expect(verifyAttempt(bundle, MECHANICS, bonus)).toMatchObject({ reason: "move_bonus_mismatch" });
    const tuning = { ...bundle.tuning, difficulty: { moveBonus: 3, perLevel: {} } };
    expect(verifyAttempt(bundle, MECHANICS, bonus, { config: { economy: bundle.economy, tuning } })).toMatchObject({ status: "accepted" });
  });

  it("refuses to judge other content or rules versions instead of calling them cheats", async () => {
    const { bundle, record } = await played(winning);
    expect(verifyAttempt(bundle, MECHANICS, tamper(record, (r) => (r.contentHash = "other")))).toMatchObject({
      status: "unverifiable", reason: "content_unknown",
    });
    expect(verifyAttempt(bundle, MECHANICS, tamper(record, (r) => (r.mechanic.version = "0")))).toMatchObject({
      status: "unverifiable", reason: "mechanic_version",
    });
    expect(verifyAttempt(bundle, {}, record)).toMatchObject({ status: "unverifiable", reason: "mechanic_unavailable" });
  });

  it("trusts the replay over claimed stars and flags superhuman pace", async () => {
    const { bundle, record } = await played(winning);
    const boasted = tamper(record, (r) => (r.outcome.stars = 2));
    expect(verifyAttempt(bundle, MECHANICS, boasted)).toMatchObject({ status: "accepted", result: { stars: 3 }, flags: ["claimed_stars_mismatch"] });
    const instant = await played(winning, { humanPace: false });
    expect(verifyAttempt(instant.bundle, MECHANICS, instant.record).flags).toEqual(["too_fast"]);
    expect(verifyAttempt(instant.bundle, MECHANICS, instant.record, { minMsPerAction: 0 }).flags).toEqual([]);
  });

  it("rejects malformed payloads and records of other games", async () => {
    const { bundle, record } = await played(winning);
    expect(verifyAttempt(bundle, MECHANICS, { nope: true })).toMatchObject({ status: "rejected", reason: "malformed" });
    expect(verifyAttempt(bundle, MECHANICS, tamper(record, (r) => (r.gameId = "other")))).toMatchObject({ reason: "wrong_game" });
    expect(verifyAttempt(bundle, MECHANICS, tamper(record, (r) => (r.levelId = "test.l9")))).toMatchObject({ reason: "unknown_level" });
  });
});
