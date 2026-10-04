import { describe, expect, it } from "vitest";
import { MemoryAnalyticsProvider } from "./analytics";
import { MINUTE, ManualClock } from "./clock";
import { MockAdsProvider, MockIapProvider } from "./providers";
import { StaticRemoteConfigProvider } from "./remote-config";
import { GameRuntime, type RuntimeOptions } from "./runtime";
import { MemorySaveStore } from "./save";
import { counterMechanic, makeBundle } from "./test-support";

async function setup(over: Partial<RuntimeOptions> = {}) {
  const bundle = over.bundle ?? makeBundle();
  const clock = (over.clock as ManualClock) ?? new ManualClock();
  const store = (over.store as MemorySaveStore) ?? new MemorySaveStore();
  const events = new MemoryAnalyticsProvider();
  const ads = new MockAdsProvider();
  const runtime = await GameRuntime.create({
    bundle,
    mechanics: { counter: counterMechanic },
    store,
    clock,
    platform: "node",
    appVersion: "test",
    analyticsProviders: [events],
    strictAnalytics: true,
    ads,
    iap: new MockIapProvider(bundle.store),
    playerId: "player-1",
    ...over,
  });
  return { runtime, clock, store, events, ads, bundle };
}

const win = (rt: GameRuntime, n = 3) => {
  for (let i = 0; i < n; i++) rt.act({ type: "inc" });
};

describe("GameRuntime", () => {
  it("boots a new player with starting balances and the first story beat", async () => {
    const { runtime, events } = await setup();
    const snap = runtime.getSnapshot();
    expect(snap.wallet).toMatchObject({ coins: 100, lives: 5, hint: 1 });
    expect(snap.journey.frontier).toBe(1);
    expect(snap.journey.chapters[0]!.levels.map((l) => l.state)).toEqual(["available", "locked"]);
    expect(snap.pendingStory.map((b) => b.id)).toEqual(["intro1"]);
    expect(events.events.map((e) => e.name)).toEqual(["game_started", "session_started"]);
    expect(runtime.getSnapshot()).toBe(snap); // stable until something changes
  });

  it("plays, wins, pays rewards, advances and completes a chapter", async () => {
    const { runtime, events } = await setup();
    expect(runtime.startLevel("test.l2")).toEqual({ ok: false, reason: "locked" });
    expect(runtime.startLevel("test.l1")).toEqual({ ok: true });
    expect(runtime.startLevel("test.l1")).toEqual({ ok: false, reason: "session_active" });
    win(runtime);
    const r1 = runtime.finishLevel();
    // 3 increments leave 2 moves, which meets the 3-star threshold (two moves left).
    expect(r1).toMatchObject({ won: true, stars: 3, rewards: { coins: 30 }, firstWin: true, nextLevel: 2, chapterCompleted: null });
    runtime.startLevel("test.l2");
    win(runtime);
    const r2 = runtime.finishLevel();
    expect(r2.chapterCompleted).toBe("ch1");
    expect(r2.chapterReward).toEqual({ coins: 100, hint: 1 });
    const snap = runtime.getSnapshot();
    expect(snap.wallet.coins).toBe(100 + 30 + 30 + 100);
    expect(snap.journey.frontier).toBe(3);
    expect(snap.journey.chapters[0]!.completed).toBe(true);
    expect(snap.pendingStory.map((b) => b.id)).toEqual(["outro1", "intro2"]);
    expect(events.count("tutorial_completed")).toBe(1);
    expect(events.count("chapter_completed")).toBe(1);
    expect(events.count("category_completed")).toBe(2);
    expect(events.last("level_completed")!.params).toMatchObject({ level_id: "test.l2", stars: 3, first_win: true });
  });

  it("charges a life on loss, regenerates it, and blocks play at zero", async () => {
    const { runtime, clock, events } = await setup();
    for (let i = 0; i < 5; i++) {
      expect(runtime.startLevel("test.l1")).toEqual({ ok: true });
      const result = runtime.abandonLevel()!;
      expect(result).toMatchObject({ won: false, reason: "abandoned", livesLost: 1 });
    }
    expect(runtime.getSnapshot().lives).toMatchObject({ count: 0, max: 5 });
    expect(events.count("lives_depleted")).toBe(1);
    expect(runtime.startLevel("test.l1")).toEqual({ ok: false, reason: "no_lives" });
    clock.advance(20 * MINUTE);
    runtime.tick();
    expect(runtime.getSnapshot().lives.count).toBe(1);
    expect(runtime.refillLives()).toEqual({ ok: true });
    expect(runtime.getSnapshot().wallet).toMatchObject({ lives: 5, coins: 10 });
  });

  it("offers continues with escalating cost and a first rewarded-ad option", async () => {
    const { runtime, ads } = await setup();
    runtime.startLevel("test.l1");
    for (let i = 0; i < 5; i++) runtime.act({ type: "wrong" });
    let snap = runtime.getSnapshot();
    expect(snap.session).toMatchObject({ status: "lost", lossReason: "out_of_moves" });
    expect(snap.session!.continueOffer).toEqual({ extraMoves: 5, cost: { coins: 40 }, canAfford: true, adAvailable: true, kind: "moves" });
    expect(await runtime.continueWithAd()).toEqual({ ok: true });
    expect(ads.shown).toEqual([{ format: "rewarded", placement: "continue_moves" }]);
    for (let i = 0; i < 5; i++) runtime.act({ type: "wrong" });
    snap = runtime.getSnapshot();
    expect(snap.session!.continueOffer).toMatchObject({ cost: { coins: 80 }, adAvailable: false });
    expect(runtime.continueWithCoins()).toEqual({ ok: true });
    for (let i = 0; i < 5; i++) runtime.act({ type: "wrong" });
    expect(runtime.getSnapshot().session!.continueOffer).toBeNull(); // maxContinues reached
    expect(runtime.finishLevel()).toMatchObject({ won: false, reason: "out_of_moves", livesLost: 1 });
    expect(runtime.getSnapshot().wallet.coins).toBe(20);
  });

  it("uses boosters from inventory first, then buys them, and enforces limits", async () => {
    const { runtime } = await setup();
    runtime.debug.grant({ coins: 50 }); // 150 coins: joker (80) + one plus5 (60), not two
    runtime.startLevel("test.l1");
    expect(runtime.useBooster("undo")).toEqual({ ok: false, reason: "no_effect" }); // nothing to undo, not charged
    expect(runtime.useBooster("hint")).toEqual({ ok: true, paidWith: "inventory" });
    expect(runtime.getSnapshot().session!.hint).toEqual({ type: "inc" });
    runtime.act({ type: "wrong" });
    expect(runtime.getSnapshot().session!.hint).toBeNull();
    expect(runtime.useBooster("undo")).toEqual({ ok: true, paidWith: "inventory" });
    expect(runtime.getSnapshot().session!.budget.left).toBe(5);
    expect(runtime.useBooster("joker", { type: "inc" })).toEqual({ ok: true, paidWith: "price" });
    expect(runtime.useBooster("joker", { type: "inc" })).toEqual({ ok: false, reason: "limit" });
    expect(runtime.useBooster("plus5")).toEqual({ ok: true, paidWith: "price" });
    const snap = runtime.getSnapshot();
    expect(snap.session!.budget.left).toBe(10);
    expect(snap.session!.evaluation.movesUsed).toBe(0);
    expect(snap.wallet).toMatchObject({ coins: 150 - 80 - 60, hint: 0, undo: 0 });
    expect(runtime.useBooster("plus5")).toEqual({ ok: false, reason: "cannot_afford" });
  });

  it("resumes an interrupted level after an app kill without charging twice", async () => {
    const first = await setup();
    first.runtime.startLevel("test.l1");
    first.runtime.act({ type: "inc" });
    first.runtime.act({ type: "wrong" });
    await first.runtime.flush();
    const second = await setup({ store: first.store, clock: first.clock });
    const snap = second.runtime.getSnapshot();
    expect(snap.session).toMatchObject({ levelId: "test.l1", status: "playing" });
    expect(snap.session!.state).toEqual({ value: 1, movesLeft: 3, used: 2, mismatches: 1 });
    expect(snap.wallet.lives).toBe(5);
    expect(second.events.count("level_resumed")).toBe(1);
    second.runtime.act({ type: "inc" });
    second.runtime.act({ type: "inc" });
    expect(second.runtime.finishLevel()).toMatchObject({ won: true, stars: 2 });
  });

  it("activates a fetched remote payload on the next launch only", async () => {
    const first = await setup();
    const result = await first.runtime.refreshRemoteConfig(
      new StaticRemoteConfigProvider({
        schemaVersion: 1, gameId: "test", payloadVersion: "42",
        overrides: { tuning: { difficulty: { moveBonus: 3 } }, economy: { continue: { extraMoves: 9 } } },
      }),
    );
    expect(result).toEqual({ ok: true, version: "42" });
    expect(first.runtime.config.tuning.difficulty.moveBonus).toBe(0);
    const second = await setup({ store: first.store });
    expect(second.runtime.remote.payloadVersion).toBe("42");
    second.runtime.startLevel("test.l1");
    expect(second.runtime.getSnapshot().session!.budget.left).toBe(8);
    expect(second.events.last("level_started")!.params.move_bonus).toBe(3);
    expect((await second.runtime.refreshRemoteConfig(new StaticRemoteConfigProvider({ gameId: "test" }))).ok).toBe(false);
  });

  it("sells offers and IAP products, grants entitlements, and suppresses interstitials", async () => {
    const { runtime, events } = await setup();
    expect(runtime.buyOffer("hint_pack")).toEqual({ ok: true });
    expect(runtime.buyOffer("hint_pack")).toEqual({ ok: false, reason: "limit" });
    expect(runtime.getSnapshot().wallet).toMatchObject({ coins: 0, hint: 4 });
    expect(await runtime.purchaseProduct("coins_small")).toEqual({ ok: true });
    expect(runtime.getSnapshot().wallet.coins).toBe(500);
    expect(events.last("purchase_completed")!.params).toMatchObject({ product_id: "coins_small", price_usd_ref: 1.99 });

    runtime.debug.setFrontier(3);
    runtime.startLevel("test.l3");
    win(runtime);
    runtime.finishLevel();
    runtime.startLevel("test.l4");
    win(runtime);
    expect(runtime.finishLevel().interstitialDue).toBe(true);
    expect(await runtime.showInterstitialIfDue()).toBe(true);
    expect(await runtime.purchaseProduct("no_ads")).toEqual({ ok: true });
    expect(await runtime.purchaseProduct("no_ads")).toEqual({ ok: false, reason: "owned" });
    expect(runtime.getSnapshot().entitlements).toEqual(["no_ads"]);
  });

  it("marks story beats as seen", async () => {
    const { runtime, events } = await setup();
    runtime.markStorySeen("intro1");
    expect(runtime.getSnapshot().pendingStory).toEqual([]);
    expect(events.count("story_viewed")).toBe(1);
    expect(runtime.t("ch1.title", { n: 1 })).toBe("Chapter 1");
    expect(runtime.t("missing.key")).toBe("[missing.key]");
  });
});
