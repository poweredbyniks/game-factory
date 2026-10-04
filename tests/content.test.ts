import { readdirSync } from "node:fs";
import { GameRuntime, ManualClock, MemoryAnalyticsProvider, MemorySaveStore, MockAdsProvider, MockIapProvider, verifyAttempt } from "@gf/core";
import { describe, expect, it } from "vitest";
import { compileGame } from "../tools/src/compile";
import { Issues } from "../tools/src/issues";
import { MECHANICS, TOOLING } from "../tools/src/mechanics";
import { rootPath } from "../tools/src/paths";
import { simulateGame } from "../tools/src/simulate";
import { checkUniqueIdentities } from "../tools/src/validate";

const games = readdirSync(rootPath("games"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe.each(games)("game package %s", (gameId) => {
  const result = compileGame(gameId, { deep: true });

  it("compiles and deep-validates with no errors", () => {
    expect(result.issues.errors, result.issues.format()).toEqual([]);
    expect(result.bundle).not.toBeNull();
  });

  it("wins every level with the solver's solution through the real runtime (golden playthrough)", async () => {
    const bundle = result.bundle!;
    const events = new MemoryAnalyticsProvider();
    const runtime = await GameRuntime.create({
      bundle,
      mechanics: MECHANICS,
      store: new MemorySaveStore(),
      clock: new ManualClock(),
      platform: "node",
      appVersion: "test",
      analyticsProviders: [events],
      strictAnalytics: true,
      ads: new MockAdsProvider(),
      iap: new MockIapProvider(bundle.store),
      playerId: "golden",
    });
    let coins = runtime.getSnapshot().wallet.coins ?? 0;
    for (const level of bundle.levels) {
      expect(runtime.startLevel(level.levelId), level.levelId).toEqual({ ok: true });
      const mechanic = TOOLING[level.mechanic]!.mechanic;
      const solution = mechanic.solve!(mechanic.levelDataSchema.parse(level.data));
      expect(solution.solved, level.levelId).toBe(true);
      for (const action of solution.actions) expect(runtime.act(action).outcome, level.levelId).toBe("applied");
      const outcome = runtime.finishLevel();
      expect(outcome.won, level.levelId).toBe(true);
      expect(outcome.stars, level.levelId).toBe(3); // perfect play earns three stars
      const now = runtime.getSnapshot().wallet.coins ?? 0;
      expect(now, level.levelId).toBeGreaterThan(coins);
      coins = now;
    }
    const snap = runtime.getSnapshot();
    expect(snap.journey.completedAll).toBe(true);
    expect(snap.journey.totalStars).toBe(bundle.levels.length * 3);
    expect(events.count("level_completed")).toBe(bundle.levels.length);
    expect(events.count("chapter_completed")).toBe(bundle.progression.chapters.length);

    // The backend replays every queued attempt with the same engine and reaches the same result.
    const attempts = runtime.pendingAttempts();
    expect(attempts).toHaveLength(bundle.levels.length);
    for (const attempt of attempts) {
      const verdict = verifyAttempt(bundle, MECHANICS, attempt, { minMsPerAction: 0 });
      expect(verdict, verdict.detail).toMatchObject({ status: "accepted", flags: [], result: { won: true, stars: 3 } });
    }
  });

  it("survives a small economy simulation without blocking errors", async () => {
    const report = await simulateGame(gameId, { players: 40, days: 5, bundle: result.bundle!, write: false });
    expect(report.flags.filter((f) => f.severity === "error"), JSON.stringify(report.flags)).toEqual([]);
    expect(report.levels[0]!.winRate).toBeGreaterThan(0.9);
  });
});

describe("factory", () => {
  it("never gives two games the same store identity", () => {
    const issues = new Issues();
    checkUniqueIdentities(games.map((gameId) => ({ gameId, release: compileGame(gameId).release })), issues);
    expect(issues.list).toEqual([]);
  });
});
