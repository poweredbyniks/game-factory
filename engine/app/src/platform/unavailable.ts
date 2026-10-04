import type { AdsProvider, IapProvider } from "@gf/core";
import type { ConsentProvider } from "./types";

/*
 * What a production build gets until a real adapter exists: the feature is off, never mocked. A
 * mock store in production would hand out purchases for free.
 */

export const noAds: AdsProvider = {
  isReady: () => false,
  show: async () => "failed",
};

export const noPurchases: IapProvider = {
  products: async () => [],
  purchase: async () => ({ status: "failed", reason: "store unavailable" }),
  unfinished: async () => [],
  finish: async () => undefined,
  restore: async () => [],
};

/** Development stand-in for UMP and App Tracking Transparency: the most conservative answer. */
export const developmentConsent: ConsentProvider = {
  gather: async () => ({ ads: "non_personalized", analytics: true, tracking: "unavailable" }),
};
