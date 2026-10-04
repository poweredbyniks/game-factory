import { describe, expect, it } from "vitest";
import { interstitialDue, initialAdCounters, recordInterstitial, recordLevelEnded, recordRewarded, rewardedAvailable } from "./ads-policy";
import { validateEvent } from "./analytics";
import { DAY } from "./clock";
import { assignVariant, resolveAssignments } from "./experiments";
import { LevelSession } from "./level-session";
import { applyWin, canPlay, initialProgress, nodeState } from "./progression";
import { buildEffectiveConfig, parsePayload } from "./remote-config";
import { loadSave, newSave } from "./save";
import { counterMechanic, makeBundle, type CounterAction } from "./test-support";

const bundle = makeBundle();

describe("progression", () => {
  it("unlocks linearly and completes chapters", () => {
    const p = initialProgress();
    expect(nodeState(bundle.progression, p, 1)).toBe("available");
    expect(nodeState(bundle.progression, p, 2)).toBe("locked");
    expect(canPlay(bundle.progression, bundle.levels, p, 2)).toEqual({ ok: false, reason: "locked" });
    expect(applyWin(bundle.progression, p, bundle.levels[0]!, 2, 3, 10).chapterCompleted).toBeNull();
    const second = applyWin(bundle.progression, p, bundle.levels[1]!, 3, 4, 20);
    expect(second.chapterCompleted?.id).toBe("ch1");
    expect(p.frontier).toBe(3);
    expect(canPlay(bundle.progression, bundle.levels, p, 1)).toEqual({ ok: false, reason: "completed" });
    expect(canPlay(bundle.progression, bundle.levels, p, 9)).toEqual({ ok: false, reason: "unknown_level" });
  });

  it("gates a chapter behind stars", () => {
    const prog: typeof bundle.progression = JSON.parse(JSON.stringify(bundle.progression));
    prog.chapters[1]!.unlock = { type: "stars", stars: 6 };
    const p = initialProgress();
    applyWin(prog, p, bundle.levels[0]!, 2, 0, 0);
    applyWin(prog, p, bundle.levels[1]!, 2, 0, 0);
    expect(canPlay(prog, bundle.levels, p, 3)).toEqual({ ok: false, reason: "gated" });
    p.completed["test.l1"]!.stars = 3;
    p.completed["test.l2"]!.stars = 3;
    expect(canPlay(prog, bundle.levels, p, 3)).toEqual({ ok: true });
  });
});

describe("ads policy", () => {
  const ctx = (levelNumber: number, now = 0, entitlements: string[] = []) => ({ levelNumber, now, entitlements, adsModule: true });

  it("respects min level, frequency, cooldown and remove-ads", () => {
    const c = initialAdCounters();
    recordLevelEnded(c);
    expect(interstitialDue(bundle.monetization, c, ctx(2))).toBe(false); // every 2 levels
    recordLevelEnded(c);
    expect(interstitialDue(bundle.monetization, c, ctx(1))).toBe(false); // below min level
    expect(interstitialDue(bundle.monetization, c, ctx(2))).toBe(true);
    expect(interstitialDue(bundle.monetization, c, ctx(2, 0, ["no_ads"]))).toBe(false);
    recordInterstitial(c, 1000);
    recordLevelEnded(c);
    recordLevelEnded(c);
    expect(interstitialDue(bundle.monetization, c, ctx(3, 30_000))).toBe(false); // cooldown
    expect(interstitialDue(bundle.monetization, c, ctx(3, 61_000))).toBe(true);
  });

  it("caps rewarded ads per day", () => {
    const c = initialAdCounters();
    for (let i = 0; i < 5; i++) recordRewarded(c, 0);
    expect(rewardedAvailable(bundle.monetization, c, ctx(3), "continue_moves")).toBe(false);
    expect(rewardedAvailable(bundle.monetization, c, ctx(3, DAY), "continue_moves")).toBe(true);
    expect(rewardedAvailable(bundle.monetization, c, ctx(3, DAY), "unknown")).toBe(false);
  });
});

describe("analytics validation", () => {
  const common = {
    game_id: "g", player_id: "p", session_id: "s", app_version: "1", platform: "node", content_hash: "h", frontier: 1, experiments: "",
  };
  it("accepts valid events and reports problems precisely", () => {
    expect(validateEvent(bundle.analytics, "shop_opened", { ...common, placement: "map" })).toEqual([]);
    expect(validateEvent(bundle.analytics, "nope", common)).toEqual(['unknown event "nope"']);
    const problems = validateEvent(bundle.analytics, "level_started", { ...common, level_id: 3, attempt: 1.5, extra: true });
    expect(problems).toEqual([
      'level_started: param "level_id" should be string, got 3',
      'level_started: missing param "level_number"',
      'level_started: param "attempt" should be int, got 1.5',
      'level_started: missing param "move_bonus"',
      'level_started: undeclared param "extra"',
    ]);
  });
});

describe("remote config and experiments", () => {
  const payload = {
    schemaVersion: 1,
    gameId: "test",
    payloadVersion: "7",
    overrides: { economy: { continue: { extraMoves: 8 } }, tuning: { difficulty: { moveBonus: 2 } } },
    experiments: [
      {
        id: "price_test",
        status: "running",
        variants: [
          { id: "control", weight: 1, overrides: {} },
          { id: "cheap", weight: 1, overrides: { economy: { continue: { cost: { coins: 10 } } } } },
        ],
      },
      { id: "broken", status: "running", variants: [{ id: "bad", weight: 1, overrides: { economy: { continue: { extraMoves: -3 } } } }] },
    ],
  };

  it("rejects payloads for other games or with bad shape", () => {
    expect(parsePayload({ ...payload, gameId: "other" }, "test").ok).toBe(false);
    expect(parsePayload({ ...payload, overrides: { levels: [] } }, "test").ok).toBe(false);
  });

  it("layers overrides and rejects invalid roots without breaking valid ones", () => {
    const check = parsePayload(payload, "test");
    if (!check.ok) throw new Error(check.errors.join());
    const result = buildEffectiveConfig(bundle, check.payload, { price_test: "cheap", broken: "bad" });
    expect(result.config.economy.continue.extraMoves).toBe(8);
    expect(result.config.economy.continue.cost).toEqual({ coins: 10 });
    expect(result.config.tuning.difficulty.moveBonus).toBe(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatch(/^broken:bad\/economy/);
    expect(bundle.economy.continue.extraMoves).toBe(5); // bundle untouched
  });

  it("assigns deterministically and keeps assignments sticky", () => {
    const check = parsePayload(payload, "test");
    if (!check.ok) throw new Error();
    const exp = check.payload.experiments[0]!;
    const counts = { control: 0, cheap: 0 } as Record<string, number>;
    for (let i = 0; i < 2000; i++) counts[assignVariant(exp, `player-${i}`)]! += 1;
    expect(counts.control).toBeGreaterThan(850);
    expect(counts.cheap).toBeGreaterThan(850);
    const ctx = { frontier: 1, platform: "ios" as const, isNewPlayer: true };
    const first = resolveAssignments(check.payload.experiments, "p1", {}, ctx);
    expect(resolveAssignments(check.payload.experiments, "p1", {}, ctx)).toEqual(first);
    expect(resolveAssignments(check.payload.experiments, "p1", { price_test: "control" }, ctx).price_test).toBe("control");
    const paused = check.payload.experiments.map((e) => ({ ...e, status: "paused" as const }));
    expect(resolveAssignments(paused, "p1", first, ctx)).toEqual({});
  });
});

describe("save documents", () => {
  it("creates, round-trips and fills defaults for partial documents", () => {
    const save = newSave(bundle.economy, "test", "p1", 5);
    expect(save.inventory).toMatchObject({ coins: 100, hint: 1 });
    expect(save.energy).toEqual({ count: 5, anchor: null });
    const loaded = loadSave(JSON.stringify(save), bundle.economy, "test", 10);
    expect(loaded.status).toBe("loaded");
    expect(loaded.save).toEqual(save);
    const { settings: _s, stats: _t, ...partial } = save;
    const filled = loadSave(JSON.stringify(partial), bundle.economy, "test", 10);
    expect(filled.save.settings).toEqual({ sound: true, music: true, haptics: true, locale: null });
    expect(filled.save.stats.wins).toBe(0);
  });

  it("replaces corrupt saves and keeps the player id when possible", () => {
    expect(loadSave("{nope", bundle.economy, "test", 0).status).toBe("reset");
    const wrong = loadSave(JSON.stringify({ saveVersion: 1, playerId: "keep-me" }), bundle.economy, "test", 0);
    expect(wrong.status).toBe("reset");
    expect(wrong.save.playerId).toBe("keep-me");
  });
});

describe("level session", () => {
  const level = bundle.levels[0]!;
  const data = counterMechanic.levelDataSchema.parse(level.data);

  it("logs only state changes and replays to the identical state", () => {
    const s = new LevelSession(counterMechanic, level, data, "seed", 0);
    s.act({ type: "inc" });
    s.act({ type: "noop" });
    s.act({ type: "wrong" });
    s.undo();
    s.act({ type: "inc" });
    s.addBudget(3);
    expect(s.log.map((e) => e.t)).toEqual(["act", "act", "undo", "act", "budget"]);
    const replayed = LevelSession.replay(counterMechanic, level, data, "seed", 0, JSON.parse(JSON.stringify(s.log)));
    expect(replayed.state).toEqual(s.state);
    expect(replayed.state).toEqual({ value: 2, movesLeft: 6, used: 2, mismatches: 0 });
  });

  it("keeps paid budget across undo", () => {
    const s = new LevelSession(counterMechanic, level, data, "seed", 0);
    s.act({ type: "inc" });
    s.addBudget(5);
    s.undo();
    expect(s.state).toEqual({ value: 0, movesLeft: 10, used: 0, mismatches: 0 });
  });

  it("refuses corrupt logs", () => {
    const bad: unknown[] = [{ t: "act", a: { type: "noop" } }];
    expect(() => LevelSession.replay<unknown, unknown, CounterAction>(counterMechanic as never, level, data, "s", 0, bad)).toThrow(/illegal/);
    expect(() => LevelSession.replay(counterMechanic, level, data, "s", 0, [{ t: "undo" }])).toThrow(/nothing to undo/);
  });
});
