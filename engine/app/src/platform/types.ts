import type {
  AdsProvider, AnalyticsProvider, IapProvider, NotificationProvider, PurchaseVerifier, RemoteConfigProvider, SaveStore,
} from "@gf/core";
import type { AppEnvironment } from "@gf/schemas";
import type { MockAdsBridge } from "./mock-ads";

/** What the player agreed to. Gathered before any ad or analytics SDK starts: UMP in the EU and UK, ATT on iOS. */
export type ConsentState = {
  ads: "personalized" | "non_personalized";
  analytics: boolean;
  tracking: "authorized" | "denied" | "not_determined" | "restricted" | "unavailable";
};

export interface ConsentProvider {
  gather(): Promise<ConsentState>;
}

/**
 * Every platform service the shared game uses, chosen per build environment. Gameplay code only
 * sees the @gf/core interfaces, never which implementation runs or on which OS.
 */
export type PlatformServices = {
  environment: AppEnvironment;
  consent: ConsentState;
  store: SaveStore;
  ads: AdsProvider;
  /** The development ad stand-in that AdOverlay renders; null when a real SDK or no ads are used. */
  adsBridge: MockAdsBridge | null;
  iap: IapProvider;
  purchaseVerifier?: PurchaseVerifier;
  notifications?: NotificationProvider;
  analytics: AnalyticsProvider[];
  remoteConfig: RemoteConfigProvider | null;
};
