import type { MonetizationDefinition } from "@gf/schemas";
import { dayKey } from "./clock";

export type AdCounters = {
  levelsSinceInterstitial: number;
  lastInterstitialAt: number | null;
  rewardedDay: string | null;
  rewardedToday: number;
};

export function initialAdCounters(): AdCounters {
  return { levelsSinceInterstitial: 0, lastInterstitialAt: null, rewardedDay: null, rewardedToday: 0 };
}

export type AdContext = { levelNumber: number; now: number; entitlements: readonly string[]; adsModule: boolean };

function adsAllowed(mon: MonetizationDefinition, ctx: AdContext): boolean {
  return ctx.adsModule && mon.ads.enabled;
}

/** Interstitial after a level: min level, every N levels, cooldown, and never with remove-ads. */
export function interstitialDue(mon: MonetizationDefinition, counters: AdCounters, ctx: AdContext): boolean {
  const cfg = mon.ads.interstitial;
  if (!adsAllowed(mon, ctx) || !cfg.enabled) return false;
  if (ctx.entitlements.includes(mon.removeAdsEntitlement)) return false;
  if (ctx.levelNumber < cfg.minLevel) return false;
  if (counters.levelsSinceInterstitial < cfg.everyNLevels) return false;
  if (counters.lastInterstitialAt !== null && ctx.now - counters.lastInterstitialAt < cfg.cooldownSeconds * 1000) {
    return false;
  }
  return true;
}

/** Rewarded ads stay available with remove-ads (they are opt-in), within the daily cap. */
export function rewardedAvailable(mon: MonetizationDefinition, counters: AdCounters, ctx: AdContext, placement: string): boolean {
  if (!adsAllowed(mon, ctx)) return false;
  if (!mon.ads.rewarded.placements.some((p) => p.id === placement)) return false;
  const today = dayKey(ctx.now);
  const used = counters.rewardedDay === today ? counters.rewardedToday : 0;
  return used < mon.ads.rewarded.dailyCap;
}

export function recordLevelEnded(counters: AdCounters): void {
  counters.levelsSinceInterstitial += 1;
}

export function recordInterstitial(counters: AdCounters, now: number): void {
  counters.levelsSinceInterstitial = 0;
  counters.lastInterstitialAt = now;
}

export function recordRewarded(counters: AdCounters, now: number): void {
  const today = dayKey(now);
  counters.rewardedToday = counters.rewardedDay === today ? counters.rewardedToday + 1 : 1;
  counters.rewardedDay = today;
}
