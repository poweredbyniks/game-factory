import {
  ATTEMPT_FORMAT,
  type AttemptRecord, type ChapterDefinition, type GameBundle, type ItemBag, type LevelDefinition, type Modules, type Platform,
  type ProductDefinition, type RemotePayload, type StoryBeat,
} from "@gf/schemas";
import { interstitialDue, recordInterstitial, recordLevelEnded, recordRewarded, rewardedAvailable } from "./ads-policy";
import { Analytics, type AnalyticsProvider, type ParamValue } from "./analytics";
import { systemClock, dayKey, type Clock } from "./clock";
import { addEnergy, viewEnergy } from "./energy";
import { resolveAssignments } from "./experiments";
import { LevelSession } from "./level-session";
import { translate } from "./localization";
import {
  attemptStars,
  type AnyMechanic, type BudgetInfo, type Evaluation, type LossReason, type MechanicEvent, type MechanicRegistry, type MoveOutcome,
  type SessionStatus,
} from "./mechanic";
import {
  applyWin, canPlay, chapterCompleted, chapterForLevel, chapterUnlocked, nodeState, totalStars, type LevelNodeState,
} from "./progression";
import type {
  AdsProvider, IapProvider, LocalNotification, NotificationProvider, PurchaseOutcome, PurchaseVerifier, StoreTransaction,
  VerificationResult,
} from "./providers";
import { buildEffectiveConfig, parsePayload, type EffectiveConfig, type RemoteConfigProvider } from "./remote-config";
import { continueCost, levelRewardBag, resolveRewardRef } from "./rewards";
import { loadSave, newSave, outboxKey, remoteKey, saveKey, type SaveDocument, type SaveStore, type SessionRecord } from "./save";
import { beatsForTrigger } from "./story";
import { bagToString } from "./util";
import { balancesOf, balanceOf, canAfford, grant, spend } from "./wallet";

export type RuntimeOptions = {
  bundle: GameBundle;
  mechanics: MechanicRegistry;
  store: SaveStore;
  platform: Platform;
  appVersion: string;
  clock?: Clock;
  analyticsProviders?: AnalyticsProvider[];
  /** Throw on events that do not match the taxonomy (tests, development). */
  strictAnalytics?: boolean;
  ads?: AdsProvider;
  iap?: IapProvider;
  /** Checks store transactions before granting. Without one every transaction counts as verified (development only). */
  purchaseVerifier?: PurchaseVerifier;
  notifications?: NotificationProvider;
  playerId?: string;
  /** "manual" skips writes after each change (simulations). Call flush() to write. */
  persist?: "auto" | "manual";
  log?: (message: string) => void;
};

export type BoosterView = {
  id: string;
  effect: string;
  count: number;
  price: ItemBag;
  allowed: boolean;
  usedThisLevel: number;
  max: number | null;
};

export type ContinueOffer = { extraMoves: number; cost: ItemBag; canAfford: boolean; adAvailable: boolean; kind: BudgetInfo["kind"] };

export type SessionView = {
  levelId: string;
  number: number;
  mechanic: string;
  level: LevelDefinition;
  data: unknown;
  state: unknown;
  status: SessionStatus;
  lossReason: LossReason | null;
  budget: BudgetInfo;
  evaluation: Evaluation;
  lastOutcome: MoveOutcome | null;
  lastEvents: MechanicEvent[];
  hint: unknown | null;
  continues: number;
  continueOffer: ContinueOffer | null;
  boosters: BoosterView[];
  canUndo: boolean;
  moveCount: number;
};

export type LevelNodeView = { number: number; levelId: string; state: LevelNodeState; stars: number; tags: string[] };
export type ChapterView = {
  id: string;
  titleKey: string;
  subtitleKey?: string;
  from: number;
  to: number;
  accent?: string;
  unlocked: boolean;
  completed: boolean;
  stars: number;
  maxStars: number;
  levels: LevelNodeView[];
};

export type LevelResult = {
  levelId: string;
  number: number;
  won: boolean;
  stars: number;
  movesLeft: number;
  reason: LossReason | "abandoned" | null;
  rewards: ItemBag;
  firstWin: boolean;
  chapterCompleted: string | null;
  chapterReward: ItemBag;
  nextLevel: number | null;
  livesLost: number;
  interstitialDue: boolean;
};

export type RuntimeSnapshot = {
  revision: number;
  gameId: string;
  name: string;
  modules: Modules;
  wallet: Record<string, number>;
  lives: { enabled: boolean; count: number; max: number; nextAt: number | null };
  journey: { frontier: number; totalStars: number; completedAll: boolean; chapters: ChapterView[] };
  session: SessionView | null;
  pendingStory: StoryBeat[];
  lastResult: LevelResult | null;
  settings: SaveDocument["settings"];
  entitlements: string[];
  experiments: Record<string, string>;
};

export type StartResult = { ok: true } | { ok: false; reason: "locked" | "completed" | "gated" | "unknown_level" | "no_lives" | "session_active" };
export type ActResult = { outcome: MoveOutcome; events: MechanicEvent[]; status: SessionStatus };
export type BoosterResult =
  | { ok: true; paidWith: "inventory" | "price" }
  | { ok: false; reason: "no_session" | "not_available" | "not_allowed" | "limit" | "no_effect" | "cannot_afford" };
export type SimpleResult = { ok: true } | { ok: false; reason: string };
export type PurchaseResult =
  | { ok: true }
  | {
      ok: false;
      reason: "unknown_product" | "iap_unavailable" | "owned" | "pending" | "cancelled" | "failed" | "verification_pending" | "invalid";
    };

/** Finished attempts kept for the backend when it is unreachable. The oldest are dropped first. */
const OUTBOX_LIMIT = 200;

const MECHANIC_EVENT_ANALYTICS: Record<string, (event: MechanicEvent) => Record<string, ParamValue>> = {
  category_completed: (e) => ({ category_id: String(e.category) }),
};

export class GameRuntime {
  readonly bundle: GameBundle;
  config: EffectiveConfig;
  readonly analytics: Analytics;
  private readonly clock: Clock;
  private readonly mechanics: MechanicRegistry;
  private save: SaveDocument;
  private session: LevelSession<unknown, unknown, unknown> | null = null;
  private hintAction: unknown | null = null;
  private storyQueue: StoryBeat[] = [];
  private lastResult: LevelResult | null = null;
  private listeners = new Set<() => void>();
  private revision = 0;
  private snapshot: RuntimeSnapshot | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  /** Whether the most recent save write reached storage. A purchase is finished only after one did. */
  private lastWriteOk = true;
  private outbox: unknown[] = [];
  private outboxChain: Promise<void> = Promise.resolve();
  private sessionStartedAt: number;
  private sessionId = "";
  private levelDataCache = new Map<string, unknown>();
  private lastLives = -1;
  readonly remote: { payloadVersion: string | null; applied: string[]; rejected: string[] };

  private constructor(
    private readonly opts: RuntimeOptions,
    save: SaveDocument,
    payload: RemotePayload | null,
    readonly loadStatus: string,
  ) {
    this.bundle = opts.bundle;
    this.clock = opts.clock ?? systemClock;
    this.mechanics = opts.mechanics;
    this.save = save;
    const assignments = resolveAssignments(payload?.experiments ?? [], save.playerId, save.experiments, {
      frontier: save.progress.frontier,
      platform: opts.platform,
      isNewPlayer: save.stats.sessions === 0,
    });
    this.save.experiments = assignments;
    const effective = buildEffectiveConfig(this.bundle, payload, assignments);
    this.config = effective.config;
    this.remote = { payloadVersion: payload?.payloadVersion ?? null, applied: effective.applied, rejected: effective.rejected };
    for (const problem of effective.rejected) opts.log?.(`remote config rejected: ${problem}`);
    this.sessionStartedAt = this.clock.now();
    this.analytics = new Analytics(this.bundle.analytics, opts.analyticsProviders ?? [], {
      strict: opts.strictAnalytics ?? false,
      now: () => this.clock.now(),
      common: () => this.commonParams(),
      onInvalid: (problems) => opts.log?.(`analytics: ${problems.join("; ")}`),
    });
  }

  static async create(opts: RuntimeOptions): Promise<GameRuntime> {
    const clock = opts.clock ?? systemClock;
    const gameId = opts.bundle.game.gameId;
    const loaded = loadSave(await opts.store.get(saveKey(gameId)), opts.bundle.economy, gameId, clock.now(), opts.playerId);
    for (const problem of loaded.problems) opts.log?.(`save: ${problem}`);
    let payload: RemotePayload | null = null;
    const cached = await opts.store.get(remoteKey(gameId));
    if (cached) {
      try {
        const check = parsePayload(JSON.parse(cached), gameId);
        if (check.ok) payload = check.payload;
        else opts.log?.(`cached remote payload ignored: ${check.errors.join("; ")}`);
      } catch {
        opts.log?.("cached remote payload is not JSON");
      }
    }
    const runtime = new GameRuntime(opts, loaded.save, payload, loaded.status);
    const storedOutbox = await opts.store.get(outboxKey(gameId));
    if (storedOutbox) {
      try {
        const parsed: unknown = JSON.parse(storedOutbox);
        if (Array.isArray(parsed)) runtime.outbox = parsed;
      } catch {
        opts.log?.("attempt outbox is not JSON; starting empty");
      }
    }
    runtime.analytics.track("game_started", { first_launch: loaded.status === "new", load_status: loaded.status });
    runtime.startSession();
    runtime.restoreSession();
    runtime.persist();
    return runtime;
  }

  // ---------------------------------------------------------------- observation

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot = (): RuntimeSnapshot => {
    if (!this.snapshot) this.snapshot = this.buildSnapshot();
    return this.snapshot;
  };

  get playerId(): string {
    return this.save.playerId;
  }

  get modules(): Modules {
    return this.bundle.game.modules;
  }

  /** Read-only view of the save document, for tools and the debug panel. */
  get saveDocument(): Readonly<SaveDocument> {
    return this.save;
  }

  /** The live session, for bots and tests. UI code should use the snapshot. */
  get activeSession(): LevelSession<unknown, unknown, unknown> | null {
    return this.session;
  }

  t = (key: string, params?: Record<string, string | number>): string =>
    translate(this.bundle.strings, this.save.settings.locale ?? this.bundle.game.defaultLocale, this.bundle.game.defaultLocale, key, params);

  levelByNumber(number: number): LevelDefinition | undefined {
    return this.bundle.levels.find((l) => l.number === number);
  }

  levelById(levelId: string): LevelDefinition | undefined {
    return this.bundle.levels.find((l) => l.levelId === levelId);
  }

  /** Refreshes time-based state (lives). Call periodically from the UI. */
  tick(): void {
    if (!this.livesEnabled()) return;
    const count = balanceOf(this.save, this.config.economy, this.config.economy.energy!.item, this.clock.now());
    if (count !== this.lastLives) this.changed(false);
  }

  // ---------------------------------------------------------------- sessions (app lifecycle)

  startSession(): void {
    this.save.stats.sessions += 1;
    this.sessionStartedAt = this.clock.now();
    this.sessionId = `${this.save.playerId}-${this.save.stats.sessions}`;
    this.analytics.track("session_started", { session_number: this.save.stats.sessions });
    this.changed();
    this.replaceNotifications([]); // nothing fires while the player is in the game
  }

  endSession(): void {
    const duration = Math.round((this.clock.now() - this.sessionStartedAt) / 1000);
    this.analytics.track("session_finished", { duration_s: duration });
    this.persist();
    this.replaceNotifications(this.planNotifications());
  }

  /** Local notifications to schedule when the app leaves the foreground. */
  planNotifications(): LocalNotification[] {
    if (!this.modules.notifications || !this.livesEnabled()) return [];
    const energy = viewEnergy(this.save.energy, this.config.economy.energy!, this.clock.now());
    if (energy.fullAt === null) return [];
    return [{ id: "lives_full", at: energy.fullAt, title: this.t("notification.lives_full.title"), body: this.t("notification.lives_full.body") }];
  }

  async requestNotificationPermission(): Promise<boolean> {
    if (!this.opts.notifications || !this.modules.notifications) return false;
    return this.opts.notifications.requestPermission();
  }

  // ---------------------------------------------------------------- backend outbox

  /** Finished attempts the backend has not acknowledged yet, oldest first. */
  pendingAttempts(): readonly unknown[] {
    return this.outbox;
  }

  /** Drops attempts the backend has stored (whatever its verdict was). */
  acknowledgeAttempts(attemptIds: readonly string[]): void {
    const done = new Set(attemptIds);
    const before = this.outbox.length;
    this.outbox = this.outbox.filter((a) => !done.has((a as { attemptId?: string }).attemptId ?? ""));
    if (this.outbox.length !== before) this.persistOutbox();
  }

  // ---------------------------------------------------------------- level flow

  startLevel(levelId: string): StartResult {
    if (this.session) return { ok: false, reason: "session_active" };
    const level = this.levelById(levelId);
    if (!level) return { ok: false, reason: "unknown_level" };
    const check = canPlay(this.bundle.progression, this.bundle.levels, this.save.progress, level.number);
    if (!check.ok) return check;
    const mechanic = this.mechanicFor(level);
    const now = this.clock.now();
    let livesCharged = false;
    if (this.livesEnabled()) {
      const energy = this.config.economy.energy!;
      if (balanceOf(this.save, this.config.economy, energy.item, now) < 1) return { ok: false, reason: "no_lives" };
      if (energy.chargeOn === "start") {
        this.spendBag({ [energy.item]: 1 }, "level_start");
        livesCharged = true;
      }
    }
    const attempt = (this.save.stats.attempts[levelId] ?? 0) + 1;
    this.save.stats.attempts[levelId] = attempt;
    this.save.stats.levelsStarted += 1;
    const seed = `${this.save.playerId}:${levelId}:${attempt}`;
    const tuning = this.config.tuning.difficulty;
    const moveBonus = tuning.moveBonus + (tuning.perLevel[levelId]?.moveBonus ?? 0);
    this.session = new LevelSession(mechanic, level, this.levelData(level), seed, moveBonus);
    this.save.session = {
      levelId, seed, attempt, startedAt: now, moveBonus, continues: 0, boostersUsed: {}, livesCharged,
      actions: this.session.log,
    };
    this.hintAction = null;
    this.lastResult = null;
    this.analytics.track("level_started", { level_id: levelId, level_number: level.number, attempt, move_bonus: moveBonus });
    this.changed();
    return { ok: true };
  }

  act(action: unknown): ActResult {
    const session = this.session;
    if (!session || session.status() !== "playing" || !session.mechanic.isAction(action)) {
      return { outcome: "illegal", events: [], status: session?.status() ?? "playing" };
    }
    const result = session.act(action);
    if (result.outcome !== "illegal") this.hintAction = null;
    for (const event of result.events) this.trackMechanicEvent(session, event);
    this.changed(result.outcome !== "illegal");
    return { outcome: result.outcome, events: result.events, status: session.status() };
  }

  useBooster(boosterId: string, arg?: unknown): BoosterResult {
    const session = this.session;
    if (!session || session.status() !== "playing") return { ok: false, reason: "no_session" };
    const def = this.config.economy.boosters.find((b) => b.id === boosterId);
    if (!def || !this.modules.boosters) return { ok: false, reason: "not_available" };
    if (def.effect !== "undo" && !session.mechanic.capabilities.includes(def.effect)) return { ok: false, reason: "not_available" };
    if (!session.level.boosters.allowed.includes(boosterId)) return { ok: false, reason: "not_allowed" };
    const record = this.save.session!;
    const used = record.boostersUsed[boosterId] ?? 0;
    if (def.maxPerLevel !== undefined && used >= def.maxPerLevel) return { ok: false, reason: "limit" };

    let hint: unknown = null;
    switch (def.effect) {
      case "hint":
        hint = session.hint();
        if (hint === null) return { ok: false, reason: "no_effect" };
        break;
      case "undo":
        if (!session.canUndo()) return { ok: false, reason: "no_effect" };
        break;
      case "auto_place": {
        if (arg === undefined || !session.mechanic.isAction(arg) || !session.mechanic.autoPlace) return { ok: false, reason: "no_effect" };
        if (session.mechanic.autoPlace(session.state, arg, session.data).outcome !== "applied") return { ok: false, reason: "no_effect" };
        break;
      }
      case "shuffle":
        if (!session.mechanic.shuffle) return { ok: false, reason: "no_effect" };
        break;
      case "add_moves":
        break;
    }

    const now = this.clock.now();
    let paidWith: "inventory" | "price";
    if (balanceOf(this.save, this.config.economy, boosterId, now) >= 1) {
      this.spendBag({ [boosterId]: 1 }, `booster:${boosterId}`);
      paidWith = "inventory";
    } else if (canAfford(this.save, this.config.economy, def.price, now)) {
      this.spendBag(def.price, `booster:${boosterId}`);
      paidWith = "price";
    } else {
      return { ok: false, reason: "cannot_afford" };
    }

    switch (def.effect) {
      case "hint":
        this.hintAction = hint;
        break;
      case "undo":
        session.undo();
        this.hintAction = null;
        break;
      case "auto_place": {
        const result = session.autoPlace(arg);
        for (const event of result.events) this.trackMechanicEvent(session, event);
        this.hintAction = null;
        break;
      }
      case "add_moves":
        session.addBudget(def.amount ?? this.config.economy.continue.extraMoves, "booster");
        break;
      case "shuffle":
        session.shuffle();
        this.hintAction = null;
        break;
    }
    record.boostersUsed[boosterId] = used + 1;
    this.save.stats.boostersUsed += 1;
    this.analytics.track("booster_used", { booster_id: boosterId, level_id: session.level.levelId, paid_with: paidWith });
    this.changed();
    return { ok: true, paidWith };
  }

  continueOffer(): ContinueOffer | null {
    const session = this.session;
    const record = this.save.session;
    if (!session || !record || session.status() !== "lost" || session.lossReason() !== "out_of_moves") return null;
    const cfg = this.config.economy.continue;
    if (record.continues >= cfg.maxContinues) return null;
    const cost = continueCost(this.config.economy, record.continues);
    const now = this.clock.now();
    const adAvailable =
      cfg.rewardedAd &&
      record.continues === 0 &&
      !!this.opts.ads?.isReady("rewarded", "continue_moves") &&
      rewardedAvailable(this.config.monetization, this.save.ads, this.adContext(session.level.number), "continue_moves");
    return { extraMoves: cfg.extraMoves, cost, canAfford: canAfford(this.save, this.config.economy, cost, now), adAvailable, kind: session.budget().kind };
  }

  continueWithCoins(): SimpleResult {
    const offer = this.continueOffer();
    if (!offer) return { ok: false, reason: "no_offer" };
    if (!this.spendBag(offer.cost, "continue")) return { ok: false, reason: "cannot_afford" };
    this.applyContinue(offer, "coins");
    return { ok: true };
  }

  async continueWithAd(): Promise<SimpleResult> {
    const offer = this.continueOffer();
    if (!offer || !offer.adAvailable || !this.opts.ads) return { ok: false, reason: "no_ad" };
    const outcome = await this.showAd("rewarded", "continue_moves");
    if (outcome !== "completed") return { ok: false, reason: outcome };
    this.applyContinue(offer, "ad");
    return { ok: true };
  }

  /** Ends a finished attempt (won or lost) and applies rewards, lives and progression. */
  finishLevel(): LevelResult {
    const session = this.session;
    const record = this.save.session;
    if (!session || !record) throw new Error("finishLevel: no active session");
    const status = session.status();
    if (status === "playing") throw new Error("finishLevel: level still in progress, use abandonLevel");
    return this.endAttempt(session, status === "won", session.lossReason());
  }

  /** Leaves a level. Leaving a live board counts as a loss. */
  abandonLevel(): LevelResult | null {
    const session = this.session;
    if (!session) return null;
    const status = session.status();
    if (status !== "playing") return this.finishLevel();
    return this.endAttempt(session, false, "abandoned");
  }

  async showInterstitialIfDue(): Promise<boolean> {
    const result = this.lastResult;
    if (!result?.interstitialDue || !this.opts.ads?.isReady("interstitial", "level_end")) return false;
    const outcome = await this.showAd("interstitial", "level_end");
    recordInterstitial(this.save.ads, this.clock.now());
    this.lastResult = { ...result, interstitialDue: false };
    this.changed();
    return outcome === "completed";
  }

  // ---------------------------------------------------------------- economy actions

  refillLives(): SimpleResult {
    const energy = this.config.economy.energy;
    if (!energy || !this.livesEnabled()) return { ok: false, reason: "no_lives_system" };
    const now = this.clock.now();
    if (balanceOf(this.save, this.config.economy, energy.item, now) >= energy.max) return { ok: false, reason: "full" };
    if (!this.spendBag(energy.refillCost, "lives_refill")) return { ok: false, reason: "cannot_afford" };
    this.save.energy = { count: energy.max, anchor: null };
    this.analytics.track("lives_refilled", { method: "coins" });
    this.changed();
    return { ok: true };
  }

  buyOffer(offerId: string): SimpleResult {
    const offer = this.config.store.offers.find((o) => o.id === offerId);
    if (!offer) return { ok: false, reason: "unknown_offer" };
    const today = dayKey(this.clock.now());
    if (this.save.offers.day !== today) this.save.offers = { day: today, counts: {} };
    const bought = this.save.offers.counts[offerId] ?? 0;
    if (offer.limitPerDay !== undefined && bought >= offer.limitPerDay) return { ok: false, reason: "limit" };
    if (!this.spendBag(offer.cost, `offer:${offerId}`)) return { ok: false, reason: "cannot_afford" };
    this.grantBag(offer.contents, `offer:${offerId}`);
    this.save.offers.counts[offerId] = bought + 1;
    this.analytics.track("offer_purchased", { offer_id: offerId });
    this.changed();
    return { ok: true };
  }

  async purchaseProduct(productId: string): Promise<PurchaseResult> {
    const product = this.config.store.products.find((p) => p.id === productId);
    if (!product) return { ok: false, reason: "unknown_product" };
    if (!this.opts.iap || !this.modules.iap) return { ok: false, reason: "iap_unavailable" };
    if (product.type === "non_consumable" && product.entitlements.every((e) => this.save.entitlements.includes(e))) {
      return { ok: false, reason: "owned" };
    }
    this.analytics.track("purchase_started", { product_id: productId });
    let outcome: PurchaseOutcome;
    try {
      outcome = await this.opts.iap.purchase(productId);
    } catch (error) {
      this.opts.log?.(`purchase ${productId} failed: ${String(error)}`);
      this.analytics.track("purchase_failed", { product_id: productId, reason: "store_error" });
      return { ok: false, reason: "failed" };
    }
    switch (outcome.status) {
      case "purchased":
        return this.deliver(outcome.transaction, "purchase");
      case "pending":
        this.analytics.track("purchase_pending", { product_id: productId });
        return { ok: false, reason: "pending" };
      case "cancelled":
        this.analytics.track("purchase_failed", { product_id: productId, reason: "cancelled" });
        return { ok: false, reason: "cancelled" };
      case "failed":
        this.analytics.track("purchase_failed", { product_id: productId, reason: outcome.reason });
        return { ok: false, reason: "failed" };
    }
  }

  /**
   * Delivers transactions the store still holds: purchases interrupted by an app kill, approved
   * Ask to Buy requests, and verifications that could not reach the backend. Call it at boot and
   * whenever the app returns to the foreground. Returns the products newly granted.
   */
  async reconcilePurchases(): Promise<string[]> {
    if (!this.opts.iap || !this.modules.iap) return [];
    let transactions: StoreTransaction[];
    try {
      transactions = await this.opts.iap.unfinished();
    } catch (error) {
      this.opts.log?.(`store unavailable: ${String(error)}`);
      return [];
    }
    const delivered: string[] = [];
    for (const transaction of transactions) {
      const known = this.save.purchases.processed.includes(transaction.transactionId);
      try {
        const result = await this.deliver(transaction, "recovered");
        if (result.ok && !known) delivered.push(transaction.productId);
      } catch (error) {
        this.opts.log?.(`purchase ${transaction.transactionId}: ${String(error)}`);
      }
    }
    return delivered;
  }

  /**
   * Restores non-consumable entitlements from the store (App Store review requires a restore
   * button). Consumables are never granted again. Only call it from a user action.
   */
  async restorePurchases(): Promise<{ ok: true; restored: string[] } | { ok: false; reason: "iap_unavailable" | "failed" }> {
    const iap = this.opts.iap;
    if (!iap || !this.modules.iap) return { ok: false, reason: "iap_unavailable" };
    let transactions: StoreTransaction[];
    try {
      transactions = await iap.restore();
    } catch (error) {
      this.opts.log?.(`restore failed: ${String(error)}`);
      return { ok: false, reason: "failed" };
    }
    const restored: string[] = [];
    for (const transaction of transactions) {
      const product = this.config.store.products.find((p) => p.id === transaction.productId);
      if (!product || product.type === "consumable") continue;
      const missing = product.entitlements.filter((e) => !this.save.entitlements.includes(e));
      if (missing.length === 0) continue;
      const verdict = await this.verify(transaction, product);
      if (verdict.status !== "verified") continue;
      this.save.entitlements.push(...missing);
      restored.push(product.id);
    }
    this.analytics.track("purchase_restored", { count: restored.length });
    this.changed();
    await this.writeChain;
    return { ok: true, restored };
  }

  // ---------------------------------------------------------------- story, settings, remote config

  markStorySeen(beatId: string): void {
    if (!this.save.storySeen.includes(beatId)) {
      this.save.storySeen.push(beatId);
      this.analytics.track("story_viewed", { beat_id: beatId });
    }
    this.storyQueue = this.storyQueue.filter((b) => b.id !== beatId);
    this.changed();
  }

  setSettings(settings: Partial<SaveDocument["settings"]>): void {
    this.save.settings = { ...this.save.settings, ...settings };
    this.changed();
  }

  /** Fetches a payload and caches it. It activates on the next launch, never mid-session. */
  async refreshRemoteConfig(provider: RemoteConfigProvider): Promise<SimpleResult & { version?: string }> {
    try {
      const raw = await provider.fetch();
      if (raw === null || raw === undefined) return { ok: false, reason: "empty" };
      const check = parsePayload(raw, this.bundle.game.gameId);
      if (!check.ok) return { ok: false, reason: check.errors.join("; ") };
      await this.opts.store.set(remoteKey(this.bundle.game.gameId), JSON.stringify(check.payload));
      return { ok: true, version: check.payload.payloadVersion };
    } catch (error) {
      return { ok: false, reason: String(error) };
    }
  }

  /** Development and simulation helpers. Never called by shipped UI flows. */
  readonly debug = {
    grant: (bag: ItemBag) => {
      this.grantBag(bag, "debug");
      this.changed();
    },
    resetProgress: () => {
      this.session = null;
      this.lastResult = null;
      this.storyQueue = [];
      this.save = newSave(this.bundle.economy, this.bundle.game.gameId, this.save.playerId, this.clock.now());
      this.changed();
    },
    setFrontier: (frontier: number) => {
      this.save.progress.frontier = frontier;
      this.changed();
    },
  };

  async flush(): Promise<void> {
    if (this.opts.persist === "manual") {
      this.write();
      this.writeOutbox();
    }
    await Promise.all([this.writeChain, this.outboxChain]);
    await this.analytics.flush();
  }

  // ---------------------------------------------------------------- internals

  private endAttempt(session: LevelSession<unknown, unknown, unknown>, won: boolean, reason: LossReason | "abandoned" | null): LevelResult {
    const record = this.save.session!;
    const level = session.level;
    const now = this.clock.now();
    const evaluation = session.evaluate();
    const duration = Math.round((now - record.startedAt) / 1000);
    let stars = 0;
    let rewards: ItemBag = {};
    let chapterReward: ItemBag = {};
    let firstWin = false;
    let chapterDone: ChapterDefinition | null = null;
    let livesLost = 0;
    const energy = this.livesEnabled() ? this.config.economy.energy! : null;

    if (won) {
      stars = attemptStars(true, evaluation);
      const win = applyWin(this.bundle.progression, this.save.progress, level, stars, evaluation.movesLeft, now);
      firstWin = win.firstWin;
      chapterDone = win.chapterCompleted;
      if (firstWin) {
        rewards = this.grantBag(levelRewardBag(this.config.economy, level, stars as 1 | 2 | 3), "level_complete");
        this.analytics.track("reward_claimed", { source: "level", items: bagToString(rewards) });
      }
      if (energy && record.livesCharged) this.save.energy = addEnergy(this.save.energy, energy, now, 1); // refund on win
      this.save.stats.wins += 1;
      this.analytics.track("level_completed", {
        level_id: level.levelId, level_number: level.number, attempt: record.attempt, stars,
        moves_left: evaluation.movesLeft, moves_used: evaluation.movesUsed, mismatches: evaluation.mismatches,
        continues: record.continues, boosters_used: Object.values(record.boostersUsed).reduce((a, b) => a + b, 0),
        duration_s: duration, first_win: firstWin,
      });
      if (firstWin && level.number === 1) this.analytics.track("tutorial_completed", { level_id: level.levelId });
      if (chapterDone && !this.save.chaptersRewarded.includes(chapterDone.id)) {
        chapterReward = this.grantBag(resolveRewardRef(this.config.economy, chapterDone.completionReward), `chapter:${chapterDone.id}`);
        this.save.chaptersRewarded.push(chapterDone.id);
        this.analytics.track("reward_claimed", { source: "chapter", items: bagToString(chapterReward) });
        this.analytics.track("chapter_completed", { chapter_id: chapterDone.id });
      }
      if (this.modules.story) {
        this.enqueueStory({ type: "level_complete", level: level.number });
        if (chapterDone) this.enqueueStory({ type: "chapter_complete", chapter: chapterDone.id });
      }
    } else {
      if (energy && !record.livesCharged && energy.chargeOn === "loss") {
        if (this.spendBag({ [energy.item]: 1 }, "level_loss")) livesLost = 1;
      } else if (record.livesCharged) {
        livesLost = 1;
      }
      this.save.stats.losses += 1;
      this.analytics.track("level_failed", {
        level_id: level.levelId, level_number: level.number, attempt: record.attempt, reason: reason ?? "unknown",
        moves_used: evaluation.movesUsed, mismatches: evaluation.mismatches, continues: record.continues, duration_s: duration,
      });
      if (energy && balanceOf(this.save, this.config.economy, energy.item, now) === 0) this.analytics.track("lives_depleted", {});
    }

    recordLevelEnded(this.save.ads);
    this.recordAttempt(session, record, { won, stars, score: evaluation.score, reason: won ? null : reason }, now);
    const result: LevelResult = {
      levelId: level.levelId,
      number: level.number,
      won,
      stars,
      movesLeft: evaluation.movesLeft,
      reason: won ? null : reason,
      rewards,
      firstWin,
      chapterCompleted: chapterDone?.id ?? null,
      chapterReward,
      nextLevel: this.levelByNumber(this.save.progress.frontier) ? this.save.progress.frontier : null,
      livesLost,
      interstitialDue: interstitialDue(this.config.monetization, this.save.ads, this.adContext(level.number)),
    };
    this.session = null;
    this.save.session = null;
    this.hintAction = null;
    this.lastResult = result;
    this.changed();
    return result;
  }

  /**
   * Grants one paid transaction exactly once: verify, grant, save, and only then finish it with
   * the store. Whatever fails before finish() leaves the transaction with the store, and
   * reconcilePurchases() delivers it later.
   */
  private async deliver(transaction: StoreTransaction, source: "purchase" | "recovered"): Promise<PurchaseResult> {
    const product = this.config.store.products.find((p) => p.id === transaction.productId);
    if (!product) {
      // Left unfinished on purpose: a later catalog may know the product again.
      this.analytics.track("purchase_failed", { product_id: transaction.productId, reason: "unknown_product" });
      return { ok: false, reason: "unknown_product" };
    }
    const consumable = product.type === "consumable";
    if (this.save.purchases.processed.includes(transaction.transactionId)) {
      if (await this.saved()) await this.finish(transaction, consumable); // granted before; the store was never told
      return { ok: true };
    }
    const verdict = await this.verify(transaction, product);
    if (verdict.status === "unavailable") {
      this.analytics.track("purchase_failed", { product_id: product.id, reason: "verification_unavailable" });
      return { ok: false, reason: "verification_pending" };
    }
    if (verdict.status === "invalid") {
      this.analytics.track("purchase_failed", { product_id: product.id, reason: "verification_invalid" });
      this.opts.log?.(`purchase ${transaction.transactionId} rejected: ${verdict.reason}`);
      await this.finish(transaction, consumable); // never granted; stop the store from redelivering it
      return { ok: false, reason: "invalid" };
    }
    this.grantBag(product.contents, `iap:${product.id}`);
    for (const entitlement of product.entitlements) {
      if (!this.save.entitlements.includes(entitlement)) this.save.entitlements.push(entitlement);
    }
    this.save.purchases.processed.push(transaction.transactionId);
    this.save.stats.purchases += 1;
    this.analytics.track("purchase_completed", {
      product_id: product.id,
      price_usd_ref: product.referencePriceUsd,
      transaction_id: transaction.transactionId,
      source,
    });
    this.changed();
    // The store forgets a transaction only once its grant is on disk. If the save failed, the store
    // redelivers it and the ledger decides: granted again if the save was lost, finished if not.
    if (await this.saved()) await this.finish(transaction, consumable);
    return { ok: true };
  }

  /** Waits for the save to reach storage, writing it again after a failure; false when it still fails. */
  private async saved(): Promise<boolean> {
    if (this.opts.persist === "manual") return true;
    if (!this.lastWriteOk) this.write();
    await this.writeChain;
    return this.lastWriteOk;
  }

  /** A failed finish is harmless: the store redelivers and the ledger prevents a second grant. */
  private async finish(transaction: StoreTransaction, consumable: boolean): Promise<void> {
    try {
      await this.opts.iap!.finish(transaction, consumable);
    } catch (error) {
      this.opts.log?.(`finish ${transaction.transactionId} failed: ${String(error)}`);
    }
  }

  private async verify(transaction: StoreTransaction, product: ProductDefinition): Promise<VerificationResult> {
    if (!this.opts.purchaseVerifier) return { status: "verified" };
    try {
      return await this.opts.purchaseVerifier.verify(transaction, product);
    } catch (error) {
      return { status: "unavailable", reason: String(error) };
    }
  }

  private recordAttempt(session: LevelSession<unknown, unknown, unknown>, record: SessionRecord, outcome: AttemptRecord["outcome"], now: number): void {
    const attempt: AttemptRecord = {
      format: ATTEMPT_FORMAT,
      attemptId: record.seed,
      gameId: this.bundle.game.gameId,
      playerId: this.save.playerId,
      levelId: record.levelId,
      attempt: record.attempt,
      seed: record.seed,
      contentHash: this.bundle.build.contentHash,
      engineVersion: this.bundle.build.engineVersion,
      mechanic: { id: session.mechanic.id, version: session.mechanic.version },
      moveBonus: record.moveBonus,
      remote: { payloadVersion: this.remote.payloadVersion, experiments: { ...this.save.experiments } },
      startedAt: record.startedAt,
      finishedAt: now,
      actions: [...session.log],
      boostersUsed: { ...record.boostersUsed },
      continues: record.continues,
      outcome,
    };
    this.outbox.push(attempt);
    if (this.outbox.length > OUTBOX_LIMIT) this.outbox.splice(0, this.outbox.length - OUTBOX_LIMIT);
    this.persistOutbox();
  }

  private applyContinue(offer: ContinueOffer, method: "coins" | "ad"): void {
    const session = this.session!;
    const record = this.save.session!;
    session.addBudget(offer.extraMoves, "continue");
    record.continues += 1;
    this.analytics.track("level_continued", { level_id: session.level.levelId, method, continue_index: record.continues });
    this.changed();
  }

  private async showAd(format: "rewarded" | "interstitial", placement: string): Promise<string> {
    if (!this.opts.ads) return "failed";
    this.analytics.track("ad_started", { format, placement });
    const outcome = await this.opts.ads.show(format, placement);
    if (outcome === "completed") {
      this.save.stats.adsWatched += 1;
      if (format === "rewarded") recordRewarded(this.save.ads, this.clock.now());
      this.analytics.track("ad_completed", { format, placement });
    } else {
      this.analytics.track("ad_failed", { format, placement, outcome });
    }
    this.changed();
    return outcome;
  }

  private adContext(levelNumber: number) {
    return { levelNumber, now: this.clock.now(), entitlements: this.save.entitlements, adsModule: this.modules.ads };
  }

  private livesEnabled(): boolean {
    return this.modules.lives && !!this.config.economy.energy;
  }

  private mechanicFor(level: LevelDefinition): AnyMechanic {
    const mechanic = this.mechanics[level.mechanic];
    if (!mechanic) throw new Error(`no mechanic registered for "${level.mechanic}"`);
    return mechanic;
  }

  private levelData(level: LevelDefinition): unknown {
    let data = this.levelDataCache.get(level.levelId);
    if (data === undefined) {
      data = this.mechanicFor(level).levelDataSchema.parse(level.data);
      this.levelDataCache.set(level.levelId, data);
    }
    return data;
  }

  private restoreSession(): void {
    const record = this.save.session;
    if (!record) return;
    const level = this.levelById(record.levelId);
    try {
      if (!level) throw new Error(`level ${record.levelId} no longer exists`);
      const mechanic = this.mechanicFor(level);
      this.session = LevelSession.replay(mechanic, level, this.levelData(level), record.seed, record.moveBonus, record.actions);
      record.actions = this.session.log;
      this.analytics.track("level_resumed", { level_id: level.levelId, actions: record.actions.length });
    } catch (error) {
      this.opts.log?.(`could not resume session: ${String(error)}`);
      this.save.session = null;
      this.session = null;
    }
  }

  private enqueueStory(trigger: Parameters<typeof beatsForTrigger>[1]): void {
    for (const beat of beatsForTrigger(this.bundle.story, trigger, this.save.storySeen)) {
      if (!this.storyQueue.some((b) => b.id === beat.id)) this.storyQueue.push(beat);
    }
  }

  private pendingStory(): StoryBeat[] {
    if (!this.modules.story) return [];
    const out = [...this.storyQueue];
    if (!this.session) {
      const chapter = chapterForLevel(this.bundle.progression, this.save.progress.frontier);
      if (chapter && chapterUnlocked(this.bundle.progression, chapter, this.save.progress)) {
        for (const beat of beatsForTrigger(this.bundle.story, { type: "chapter_start", chapter: chapter.id }, this.save.storySeen)) {
          if (!out.some((b) => b.id === beat.id)) out.push(beat);
        }
      }
    }
    return out;
  }

  private grantBag(bag: ItemBag, source: string): ItemBag {
    const granted = grant(this.save, this.config.economy, bag, this.clock.now());
    for (const [item, amount] of Object.entries(granted)) {
      this.analytics.track("currency_earned", { item_id: item, amount, source });
    }
    return granted;
  }

  private spendBag(cost: ItemBag, sink: string): boolean {
    if (!spend(this.save, this.config.economy, cost, this.clock.now())) return false;
    for (const [item, amount] of Object.entries(cost)) {
      this.analytics.track("currency_spent", { item_id: item, amount, sink });
    }
    return true;
  }

  private trackMechanicEvent(session: LevelSession<unknown, unknown, unknown>, event: MechanicEvent): void {
    const toParams = MECHANIC_EVENT_ANALYTICS[event.type];
    if (toParams) this.analytics.track(event.type, { level_id: session.level.levelId, ...toParams(event) });
  }

  private commonParams(): Record<string, ParamValue> {
    return {
      game_id: this.bundle.game.gameId,
      player_id: this.save.playerId,
      session_id: this.sessionId,
      app_version: this.opts.appVersion,
      platform: this.opts.platform,
      content_hash: this.bundle.build.contentHash,
      frontier: this.save.progress.frontier,
      experiments: Object.entries(this.save.experiments).map(([e, v]) => `${e}:${v}`).sort().join("|"),
    };
  }

  private replaceNotifications(notifications: LocalNotification[]): void {
    if (!this.opts.notifications || !this.modules.notifications) return;
    this.opts.notifications.replaceScheduled(notifications).catch((error: unknown) => this.opts.log?.(`notifications: ${String(error)}`));
  }

  private changed(persist = true): void {
    this.revision += 1;
    this.snapshot = null;
    if (persist) this.persist();
    for (const listener of this.listeners) listener();
  }

  private persist(): void {
    if (this.opts.persist === "manual") return;
    this.write();
  }

  private write(): void {
    this.save.updatedAt = this.clock.now();
    const key = saveKey(this.bundle.game.gameId);
    const json = JSON.stringify(this.save);
    this.writeChain = this.writeChain
      .then(() => this.opts.store.set(key, json))
      .then(
        () => {
          this.lastWriteOk = true;
        },
        (error: unknown) => {
          this.lastWriteOk = false;
          this.opts.log?.(`save failed: ${String(error)}`);
        },
      );
  }

  private persistOutbox(): void {
    if (this.opts.persist === "manual") return;
    this.writeOutbox();
  }

  private writeOutbox(): void {
    const key = outboxKey(this.bundle.game.gameId);
    const json = JSON.stringify(this.outbox);
    this.outboxChain = this.outboxChain
      .then(() => this.opts.store.set(key, json))
      .catch((error: unknown) => this.opts.log?.(`outbox save failed: ${String(error)}`));
  }

  private buildSnapshot(): RuntimeSnapshot {
    const now = this.clock.now();
    const economy = this.config.economy;
    const progression = this.bundle.progression;
    const progress = this.save.progress;
    const energy = this.livesEnabled() ? viewEnergy(this.save.energy, economy.energy!, now) : null;
    this.lastLives = energy?.count ?? -1;

    const chapters: ChapterView[] = progression.chapters.map((chapter) => {
      const levels: LevelNodeView[] = [];
      let stars = 0;
      for (let n = chapter.levels.from; n <= chapter.levels.to; n++) {
        const level = this.levelByNumber(n);
        if (!level) continue;
        const done = progress.completed[level.levelId];
        stars += done?.stars ?? 0;
        levels.push({ number: n, levelId: level.levelId, state: nodeState(progression, progress, n), stars: done?.stars ?? 0, tags: level.tags });
      }
      return {
        id: chapter.id,
        titleKey: chapter.titleKey,
        ...(chapter.subtitleKey ? { subtitleKey: chapter.subtitleKey } : {}),
        from: chapter.levels.from,
        to: chapter.levels.to,
        ...(chapter.accent ? { accent: chapter.accent } : {}),
        unlocked: chapterUnlocked(progression, chapter, progress),
        completed: chapterCompleted(chapter, progress),
        stars,
        maxStars: levels.length * 3,
        levels,
      };
    });

    let sessionView: SessionView | null = null;
    const session = this.session;
    const record = this.save.session;
    if (session && record) {
      const boosters: BoosterView[] = this.modules.boosters
        ? economy.boosters
            .filter((b) => b.effect === "undo" || session.mechanic.capabilities.includes(b.effect))
            .map((b) => ({
              id: b.id,
              effect: b.effect,
              count: balanceOf(this.save, economy, b.id, now),
              price: b.price,
              allowed: session.level.boosters.allowed.includes(b.id),
              usedThisLevel: record.boostersUsed[b.id] ?? 0,
              max: b.maxPerLevel ?? null,
            }))
        : [];
      sessionView = {
        levelId: session.level.levelId,
        number: session.level.number,
        mechanic: session.level.mechanic,
        level: session.level,
        data: session.data,
        state: session.state,
        status: session.status(),
        lossReason: session.lossReason(),
        budget: session.budget(),
        evaluation: session.evaluate(),
        lastOutcome: session.lastOutcome,
        lastEvents: session.lastEvents,
        hint: this.hintAction,
        continues: record.continues,
        continueOffer: this.continueOffer(),
        boosters,
        canUndo: session.canUndo(),
        moveCount: session.log.length,
      };
    }

    return {
      revision: this.revision,
      gameId: this.bundle.game.gameId,
      name: this.bundle.game.name,
      modules: this.modules,
      wallet: balancesOf(this.save, economy, now),
      lives: energy ? { enabled: true, count: energy.count, max: energy.max, nextAt: energy.nextAt } : { enabled: false, count: 0, max: 0, nextAt: null },
      journey: {
        frontier: progress.frontier,
        totalStars: totalStars(progress),
        completedAll: progress.frontier > this.bundle.levels.length,
        chapters,
      },
      session: sessionView,
      pendingStory: this.pendingStory(),
      lastResult: this.lastResult,
      settings: this.save.settings,
      entitlements: [...this.save.entitlements],
      experiments: { ...this.save.experiments },
    };
  }
}
