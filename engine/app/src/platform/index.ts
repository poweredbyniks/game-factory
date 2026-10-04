import {
  LoggerAnalyticsProvider, MemoryNotificationProvider, MockIapProvider, MockPurchaseVerifier, type AnalyticsProvider,
  type MemoryAnalyticsProvider,
} from "@gf/core";
import type { GameBundle, ReleaseDefinition } from "@gf/schemas";
import { APP_ENV } from "./environment";
import { MockAdsBridge } from "./mock-ads";
import { HttpRemoteConfigProvider } from "./remote-config";
import { asyncStorageStore } from "./storage";
import type { ConsentProvider, PlatformServices } from "./types";
import { developmentConsent, noAds, noPurchases } from "./unavailable";

export { APP_ENV } from "./environment";
export { useBackHandler } from "./back";
export type { AdRequest, MockAdsBridge } from "./mock-ads";
export type { ConsentState, PlatformServices } from "./types";

/**
 * The only place that decides which implementation backs each platform service.
 *
 * development, staging: development stand-ins: a mock store whose transactions still go through
 * verification, and the mock ad overlay. production: real adapters only; until one exists its
 * feature stays off. gf build refuses production builds in that state (capabilities.json).
 */
export async function createPlatformServices(
  bundle: GameBundle,
  release: ReleaseDefinition,
  events: MemoryAnalyticsProvider,
): Promise<PlatformServices> {
  const environment = APP_ENV;
  const consentProvider: ConsentProvider = developmentConsent; // Phase 2: UMP + ATT adapter
  const consent = await consentProvider.gather(); // before any ad or analytics SDK starts
  const endpoints = release.environments[environment];
  const remoteConfig = endpoints.remoteConfigUrl ? new HttpRemoteConfigProvider(endpoints.remoteConfigUrl) : null;
  const analytics: AnalyticsProvider[] = [events];

  if (environment === "production") {
    return { environment, consent, store: asyncStorageStore, ads: noAds, adsBridge: null, iap: noPurchases, analytics, remoteConfig };
  }
  if (__DEV__) analytics.push(new LoggerAnalyticsProvider((line) => console.log(line)));
  const adsBridge = new MockAdsBridge();
  return {
    environment,
    consent,
    store: asyncStorageStore,
    ads: adsBridge,
    adsBridge,
    iap: new MockIapProvider(bundle.store, () => "purchased", () => Date.now()),
    purchaseVerifier: new MockPurchaseVerifier(),
    notifications: new MemoryNotificationProvider(),
    analytics,
    remoteConfig,
  };
}
