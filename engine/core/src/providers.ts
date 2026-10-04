import type { ProductDefinition, PurchaseVerificationResult, StoreDefinition, StorePlatform } from "@gf/schemas";
import { cyrb128 } from "./rng";

/*
 * Platform seams. The runtime depends only on these interfaces; implementations live in the app's
 * platform layer (StoreKit, Play Billing, AdMob, notifications, the game backend) or are the mocks
 * below (tests, simulations, development builds).
 */

export type AdFormat = "rewarded" | "interstitial";
export type AdOutcome = "completed" | "skipped" | "failed";

/** Thin seam over AdMob / AppLovin MAX. Placement ids come from monetization.json, ad unit ids from release.json. */
export interface AdsProvider {
  isReady(format: AdFormat, placement: string): boolean;
  show(format: AdFormat, placement: string): Promise<AdOutcome>;
}

export type ProductInfo = { id: string; price: string };

/** One paid store transaction in a store-neutral shape. */
export type StoreTransaction = {
  /** StoreKit transaction id or Google Play order id. */
  transactionId: string;
  /** The store.json product id; the platform adapter maps store SKUs back. */
  productId: string;
  platform: StorePlatform;
  purchasedAt: number;
  /** Proof for verification: the StoreKit 2 signed transaction (JWS) or the Play purchase token. */
  verificationData: string;
};

export type PurchaseOutcome =
  | { status: "purchased"; transaction: StoreTransaction }
  /** Ask to Buy or a Play pending payment: the transaction arrives later through unfinished(). */
  | { status: "pending" }
  | { status: "cancelled" }
  | { status: "failed"; reason: string };

/**
 * Thin seam over StoreKit 2 and Google Play Billing, used in two phases: the runtime verifies,
 * grants and saves, and only then calls finish(). A transaction that is never finished is
 * delivered again by unfinished(), so a crash between payment and grant loses nothing.
 */
export interface IapProvider {
  products(productIds: string[]): Promise<ProductInfo[]>;
  purchase(productId: string): Promise<PurchaseOutcome>;
  /** Paid but not finished: interrupted purchases, approved Ask to Buy, promoted purchases, retries. */
  unfinished(): Promise<StoreTransaction[]>;
  /** Marks a transaction delivered. Consumables become purchasable again; Android acknowledges or consumes. */
  finish(transaction: StoreTransaction, consumable: boolean): Promise<void>;
  /** User-initiated restore of non-consumables. It may show a store sign-in prompt, so never call it at boot. */
  restore(): Promise<StoreTransaction[]>;
}

export type VerificationResult = PurchaseVerificationResult;

/** Checks a transaction before anything is granted. Production builds verify on the game backend. */
export interface PurchaseVerifier {
  verify(transaction: StoreTransaction, product: ProductDefinition): Promise<VerificationResult>;
}

/** A local notification with its text already localized. */
export type LocalNotification = { id: string; at: number; title: string; body: string };

/** Thin seam over local notifications (expo-notifications). */
export interface NotificationProvider {
  /** Replaces everything this game scheduled before. Without permission it does nothing. */
  replaceScheduled(notifications: LocalNotification[]): Promise<void>;
  requestPermission(): Promise<boolean>;
}

/** Development and simulation stand-in. The app wraps it with a fake ad overlay. */
export class MockAdsProvider implements AdsProvider {
  shown: Array<{ format: AdFormat; placement: string }> = [];
  constructor(
    private readonly outcome: (format: AdFormat, placement: string) => AdOutcome = () => "completed",
    private readonly beforeShow?: (format: AdFormat, placement: string) => Promise<void>,
  ) {}
  isReady(): boolean {
    return true;
  }
  async show(format: AdFormat, placement: string): Promise<AdOutcome> {
    this.shown.push({ format, placement });
    await this.beforeShow?.(format, placement);
    return this.outcome(format, placement);
  }
}

/** The proof a mock transaction carries; MockPurchaseVerifier rejects anything else. */
export function mockProof(transactionId: string, productId: string): string {
  return `mock:${cyrb128(`${transactionId}|${productId}`).map((n) => n.toString(16)).join("")}`;
}

/**
 * purchased: normal flow. pending: delivered later by unfinished(). interrupted: paid, but the app
 * died before the result arrived, so only unfinished() delivers it. cancelled and failed: no charge.
 */
export type MockPurchaseBehavior = "purchased" | "pending" | "interrupted" | "cancelled" | "failed";

/** A store that behaves like StoreKit and Play Billing, for tests, simulations and development builds. */
export class MockIapProvider implements IapProvider {
  readonly finished: string[] = [];
  private queue: StoreTransaction[] = [];
  private owned = new Map<string, StoreTransaction>();
  private counter = 0;

  constructor(
    private readonly store: StoreDefinition,
    private readonly behavior: (productId: string) => MockPurchaseBehavior = () => "purchased",
    private readonly now: () => number = () => 0,
  ) {}

  /** Prices come from referencePriceUsd only here. Real stores return localized prices. */
  async products(productIds: string[]): Promise<ProductInfo[]> {
    return this.store.products
      .filter((p) => productIds.includes(p.id))
      .map((p) => ({ id: p.id, price: `$${p.referencePriceUsd.toFixed(2)}` }));
  }

  async purchase(productId: string): Promise<PurchaseOutcome> {
    const behavior = this.behavior(productId);
    if (behavior === "cancelled") return { status: "cancelled" };
    if (behavior === "failed") return { status: "failed", reason: "mock" };
    const transaction = this.transaction(productId);
    this.queue.push(transaction);
    if (behavior === "pending") return { status: "pending" };
    if (behavior === "interrupted") return { status: "failed", reason: "interrupted" };
    return { status: "purchased", transaction };
  }

  async unfinished(): Promise<StoreTransaction[]> {
    return [...this.queue];
  }

  async finish(transaction: StoreTransaction, consumable: boolean): Promise<void> {
    this.queue = this.queue.filter((t) => t.transactionId !== transaction.transactionId);
    this.finished.push(transaction.transactionId);
    if (!consumable) this.owned.set(transaction.productId, transaction);
  }

  async restore(): Promise<StoreTransaction[]> {
    return [...this.owned.values()];
  }

  /** Test hook: the store delivers a transaction again, as after a reinstall or a lost finish(). */
  redeliver(transaction: StoreTransaction): void {
    this.queue.push(transaction);
  }

  /** Test hook: what the store would hand over for a product, including its proof. */
  transaction(productId: string): StoreTransaction {
    this.counter += 1;
    const transactionId = `mock-${productId}-${this.counter}`;
    return { transactionId, productId, platform: "mock", purchasedAt: this.now(), verificationData: mockProof(transactionId, productId) };
  }
}

/** Verifies mock proofs, so forged transactions can be tested without a backend. */
export class MockPurchaseVerifier implements PurchaseVerifier {
  readonly verified: string[] = [];
  constructor(private readonly override?: (transaction: StoreTransaction) => VerificationResult | undefined) {}

  async verify(transaction: StoreTransaction, product: ProductDefinition): Promise<VerificationResult> {
    const forced = this.override?.(transaction);
    if (forced) return forced;
    if (transaction.platform !== "mock") return { status: "invalid", reason: "not a mock transaction" };
    if (transaction.productId !== product.id) return { status: "invalid", reason: "product mismatch" };
    if (transaction.verificationData !== mockProof(transaction.transactionId, transaction.productId)) {
      return { status: "invalid", reason: "bad proof" };
    }
    this.verified.push(transaction.transactionId);
    return { status: "verified", environment: "mock" };
  }
}

/** Records what would be scheduled. Tests and development builds without notification support use it. */
export class MemoryNotificationProvider implements NotificationProvider {
  scheduled: LocalNotification[] = [];
  constructor(public granted = true) {}
  async replaceScheduled(notifications: LocalNotification[]): Promise<void> {
    this.scheduled = this.granted ? [...notifications] : [];
  }
  async requestPermission(): Promise<boolean> {
    return this.granted;
  }
}
