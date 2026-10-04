import { AttemptRecord } from "@gf/schemas";
import { describe, expect, it } from "vitest";
import { MemoryAnalyticsProvider } from "./analytics";
import { ManualClock } from "./clock";
import {
  MemoryNotificationProvider, MockIapProvider, MockPurchaseVerifier, mockProof,
  type IapProvider, type MockPurchaseBehavior,
} from "./providers";
import { GameRuntime, type RuntimeOptions } from "./runtime";
import { MemorySaveStore, outboxKey, saveKey, type SaveStore } from "./save";
import { counterMechanic, makeBundle } from "./test-support";

async function boot(over: Partial<RuntimeOptions> = {}) {
  const bundle = over.bundle ?? makeBundle();
  const store = (over.store as MemorySaveStore | undefined) ?? new MemorySaveStore();
  const clock = (over.clock as ManualClock | undefined) ?? new ManualClock();
  const events = new MemoryAnalyticsProvider();
  const runtime = await GameRuntime.create({
    bundle, mechanics: { counter: counterMechanic }, platform: "node", appVersion: "test", playerId: "buyer",
    analyticsProviders: [events], strictAnalytics: true, iap: new MockIapProvider(bundle.store),
    ...over, store, clock,
  });
  return { runtime, store, events, bundle, clock };
}
const coins = (rt: GameRuntime) => rt.getSnapshot().wallet.coins;

describe("purchases", () => {
  it("verifies, grants and saves before it finishes the transaction", async () => {
    const bundle = makeBundle();
    const store = new MemorySaveStore();
    const mock = new MockIapProvider(bundle.store);
    const savedBeforeFinish: boolean[] = [];
    const iap: IapProvider = {
      products: (ids) => mock.products(ids),
      purchase: (id) => mock.purchase(id),
      unfinished: () => mock.unfinished(),
      restore: () => mock.restore(),
      async finish(transaction, consumable) {
        const saved = JSON.parse((await store.get(saveKey("test")))!);
        savedBeforeFinish.push(saved.purchases.processed.includes(transaction.transactionId) && saved.inventory.coins === 600);
        await mock.finish(transaction, consumable);
      },
    };
    const verifier = new MockPurchaseVerifier();
    const { runtime, events } = await boot({ bundle, store, iap, purchaseVerifier: verifier });
    expect(await runtime.purchaseProduct("coins_small")).toEqual({ ok: true });
    expect(coins(runtime)).toBe(600);
    expect(savedBeforeFinish).toEqual([true]);
    expect(verifier.verified).toHaveLength(1);
    expect(await mock.unfinished()).toEqual([]);
    expect(events.last("purchase_completed")!.params).toMatchObject({ product_id: "coins_small", source: "purchase" });
  });

  it("delivers pending and interrupted purchases on a later launch, exactly once", async () => {
    const bundle = makeBundle();
    let behavior: MockPurchaseBehavior = "pending";
    const iap = new MockIapProvider(bundle.store, () => behavior);
    const first = await boot({ bundle, iap });
    expect(await first.runtime.purchaseProduct("coins_small")).toEqual({ ok: false, reason: "pending" });
    expect(first.events.count("purchase_pending")).toBe(1);
    behavior = "interrupted";
    expect(await first.runtime.purchaseProduct("coins_small")).toEqual({ ok: false, reason: "failed" });
    expect(coins(first.runtime)).toBe(100);
    await first.runtime.flush();

    const next = await boot({ bundle, iap, store: first.store });
    expect(await next.runtime.reconcilePurchases()).toEqual(["coins_small", "coins_small"]);
    expect(coins(next.runtime)).toBe(1100);
    expect(next.events.last("purchase_completed")!.params).toMatchObject({ source: "recovered" });
    expect(await next.runtime.reconcilePurchases()).toEqual([]);
    expect(coins(next.runtime)).toBe(1100);
  });

  it("finishes a redelivered transaction without granting it twice", async () => {
    const bundle = makeBundle();
    const iap = new MockIapProvider(bundle.store);
    const { runtime } = await boot({ bundle, iap });
    await runtime.purchaseProduct("coins_small");
    const id = iap.finished[0]!;
    iap.redeliver({ transactionId: id, productId: "coins_small", platform: "mock", purchasedAt: 0, verificationData: mockProof(id, "coins_small") });
    expect(await runtime.reconcilePurchases()).toEqual([]);
    expect(coins(runtime)).toBe(600);
    expect(iap.finished).toEqual([id, id]);
  });

  it("never grants a forged transaction and stops its redelivery", async () => {
    const bundle = makeBundle();
    const iap = new MockIapProvider(bundle.store);
    const { runtime, events } = await boot({ bundle, iap, purchaseVerifier: new MockPurchaseVerifier() });
    iap.redeliver({ transactionId: "forged-1", productId: "coins_large", platform: "mock", purchasedAt: 0, verificationData: "mock:0" });
    iap.redeliver({ transactionId: "forged-2", productId: "coins_small", platform: "mock", purchasedAt: 0, verificationData: "mock:0" });
    expect(await runtime.reconcilePurchases()).toEqual([]);
    expect(coins(runtime)).toBe(100);
    expect((await iap.unfinished()).map((t) => t.transactionId)).toEqual(["forged-1"]); // unknown product: kept for a later catalog
    expect(events.last("purchase_failed")!.params).toMatchObject({ product_id: "coins_small", reason: "verification_invalid" });
  });

  it("keeps a transaction with the store while verification is unreachable", async () => {
    const bundle = makeBundle();
    const iap = new MockIapProvider(bundle.store);
    let online = false;
    const verifier = new MockPurchaseVerifier(() => (online ? undefined : { status: "unavailable", reason: "offline" }));
    const { runtime } = await boot({ bundle, iap, purchaseVerifier: verifier });
    expect(await runtime.purchaseProduct("coins_small")).toEqual({ ok: false, reason: "verification_pending" });
    expect(coins(runtime)).toBe(100);
    expect(await iap.unfinished()).toHaveLength(1);
    online = true;
    expect(await runtime.reconcilePurchases()).toEqual(["coins_small"]);
    expect(coins(runtime)).toBe(600);
  });

  it("leaves a purchase with the store until its grant is on disk", async () => {
    const bundle = makeBundle();
    const disk = new MemorySaveStore();
    let diskFull = false;
    const store: SaveStore = {
      get: (key) => disk.get(key),
      set: async (key, value) => {
        if (diskFull) throw new Error("disk full");
        await disk.set(key, value);
      },
      remove: (key) => disk.remove(key),
    };
    const iap = new MockIapProvider(bundle.store);
    const { runtime } = await boot({ bundle, store: store as MemorySaveStore, iap });
    diskFull = true;
    expect(await runtime.purchaseProduct("coins_small")).toEqual({ ok: true });
    expect(coins(runtime)).toBe(600);
    expect(await iap.unfinished()).toHaveLength(1);
    diskFull = false;
    expect(await runtime.reconcilePurchases()).toEqual([]);
    expect(await iap.unfinished()).toEqual([]);
    expect(JSON.parse((await disk.get(saveKey("test")))!).inventory.coins).toBe(600);
  });

  it("survives store errors without throwing", async () => {
    const bundle = makeBundle();
    const broken: IapProvider = {
      products: async () => [],
      purchase: async () => {
        throw new Error("billing service disconnected");
      },
      unfinished: async () => {
        throw new Error("billing service disconnected");
      },
      finish: async () => undefined,
      restore: async () => {
        throw new Error("not signed in");
      },
    };
    const { runtime } = await boot({ bundle, iap: broken });
    expect(await runtime.purchaseProduct("coins_small")).toEqual({ ok: false, reason: "failed" });
    expect(await runtime.reconcilePurchases()).toEqual([]);
    expect(await runtime.restorePurchases()).toEqual({ ok: false, reason: "failed" });
  });

  it("restores non-consumables on a new install and never consumables", async () => {
    const bundle = makeBundle();
    const iap = new MockIapProvider(bundle.store);
    const first = await boot({ bundle, iap });
    await first.runtime.purchaseProduct("no_ads");
    await first.runtime.purchaseProduct("coins_small");

    const reinstall = await boot({ bundle, iap });
    expect(reinstall.runtime.getSnapshot().entitlements).toEqual([]);
    expect(await reinstall.runtime.restorePurchases()).toEqual({ ok: true, restored: ["no_ads"] });
    expect(reinstall.runtime.getSnapshot().entitlements).toEqual(["no_ads"]);
    expect(coins(reinstall.runtime)).toBe(100);
    expect(await reinstall.runtime.restorePurchases()).toEqual({ ok: true, restored: [] });
    expect(reinstall.events.last("purchase_restored")!.params).toMatchObject({ count: 0 });
  });
});

describe("notifications", () => {
  it("schedules a lives-full reminder for the background and clears it in the foreground", async () => {
    const bundle = makeBundle();
    bundle.game.modules.notifications = true;
    const notifications = new MemoryNotificationProvider();
    const { runtime, clock } = await boot({ bundle, notifications });
    runtime.startLevel("test.l1");
    for (let i = 0; i < 5; i++) runtime.act({ type: "wrong" });
    expect(runtime.finishLevel().livesLost).toBe(1);
    runtime.endSession();
    expect(notifications.scheduled).toEqual([
      { id: "lives_full", at: clock.now() + 1_200_000, title: "[notification.lives_full.title]", body: "[notification.lives_full.body]" },
    ]);
    runtime.startSession();
    expect(notifications.scheduled).toEqual([]);
  });

  it("schedules nothing while the module is off", async () => {
    const notifications = new MemoryNotificationProvider();
    const { runtime } = await boot({ notifications });
    runtime.startLevel("test.l1");
    for (let i = 0; i < 5; i++) runtime.act({ type: "wrong" });
    runtime.finishLevel();
    runtime.endSession();
    expect(notifications.scheduled).toEqual([]);
  });
});

describe("attempt outbox", () => {
  it("keeps finished attempts for the backend until they are acknowledged", async () => {
    const { runtime, store } = await boot();
    runtime.startLevel("test.l1");
    for (let i = 0; i < 3; i++) runtime.act({ type: "inc" });
    runtime.finishLevel();
    const [record] = runtime.pendingAttempts() as AttemptRecord[];
    expect(AttemptRecord.safeParse(record).success).toBe(true);
    expect(record).toMatchObject({ attemptId: "buyer:test.l1:1", levelId: "test.l1", outcome: { won: true, stars: 3 } });
    await runtime.flush();
    expect(JSON.parse((await store.get(outboxKey("test")))!)).toHaveLength(1);
    expect(JSON.parse((await store.get(saveKey("test")))!).outbox).toBeUndefined(); // the per-move save stays small

    const restarted = await boot({ store });
    expect(restarted.runtime.pendingAttempts()).toHaveLength(1);
    restarted.runtime.acknowledgeAttempts([record!.attemptId]);
    expect(restarted.runtime.pendingAttempts()).toEqual([]);
    await restarted.runtime.flush();
    expect(JSON.parse((await store.get(outboxKey("test")))!)).toEqual([]);
  });
});
