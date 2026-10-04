import type { AdFormat, AdOutcome, AdsProvider } from "@gf/core";

export type AdRequest = { format: AdFormat; placement: string; resolve: (outcome: AdOutcome) => void };

/**
 * Development ads: a full-screen stand-in rendered by AdOverlay instead of an SDK. Never used in
 * production builds.
 */
export class MockAdsBridge implements AdsProvider {
  private listener: ((request: AdRequest | null) => void) | null = null;
  isReady(): boolean {
    return true;
  }
  show(format: AdFormat, placement: string): Promise<AdOutcome> {
    return new Promise((resolve) => {
      if (!this.listener) return resolve("failed");
      this.listener({
        format,
        placement,
        resolve: (outcome) => {
          this.listener?.(null);
          resolve(outcome);
        },
      });
    });
  }
  onRequest(listener: ((request: AdRequest | null) => void) | null): void {
    this.listener = listener;
  }
}
