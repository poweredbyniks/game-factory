import { DAY, HOUR, MINUTE, GameRuntime, ManualClock, MemorySaveStore, MockAdsProvider, MockIapProvider, createRng, type AnalyticsEvent, type AnalyticsProvider } from "@gf/core";
import type { GameBundle } from "@gf/schemas";
import { compileGame } from "./compile";
import { MECHANICS, TOOLING, type SkillProfile } from "./mechanics";
import { rootPath, writeJson } from "./paths";

/** A slice of the player population. Probabilities are per opportunity. */
export type Archetype = {
  name: string;
  share: number;
  skill: SkillProfile;
  sessionsPerDay: [number, number];
  attemptsPerSession: [number, number];
  continueWithCoins: number;
  watchAds: number;
  useBoosterWhenStuck: number;
  refillWithGems: number;
  purchasePerDay: number;
  products: string[];
};

export const DEFAULT_ARCHETYPES: Archetype[] = [
  { name: "casual_free", share: 0.45, skill: "casual", sessionsPerDay: [1, 2], attemptsPerSession: [3, 6], continueWithCoins: 0.2, watchAds: 0.6, useBoosterWhenStuck: 0.5, refillWithGems: 0.1, purchasePerDay: 0, products: [] },
  { name: "regular_free", share: 0.38, skill: "average", sessionsPerDay: [2, 3], attemptsPerSession: [4, 8], continueWithCoins: 0.5, watchAds: 0.7, useBoosterWhenStuck: 0.7, refillWithGems: 0.3, purchasePerDay: 0, products: [] },
  { name: "payer", share: 0.1, skill: "average", sessionsPerDay: [3, 4], attemptsPerSession: [6, 10], continueWithCoins: 0.85, watchAds: 0.2, useBoosterWhenStuck: 0.9, refillWithGems: 0.8, purchasePerDay: 0.12, products: ["starter_pack", "coins_medium", "no_ads", "coins_small"] },
  { name: "expert", share: 0.07, skill: "expert", sessionsPerDay: [2, 4], attemptsPerSession: [5, 10], continueWithCoins: 0.4, watchAds: 0.4, useBoosterWhenStuck: 0.6, refillWithGems: 0.3, purchasePerDay: 0, products: [] },
];

class CountingProvider implements AnalyticsProvider {
  readonly name = "sim";
  readonly counts: Record<string, number> = {};
  readonly earned: Record<string, Record<string, number>> = {};
  readonly spent: Record<string, Record<string, number>> = {};
  track(event: AnalyticsEvent): void {
    this.counts[event.name] = (this.counts[event.name] ?? 0) + 1;
    if (event.name === "currency_earned" || event.name === "currency_spent") {
      const table = event.name === "currency_earned" ? this.earned : this.spent;
      const item = String(event.params.item_id);
      const label = String(event.params.source ?? event.params.sink).split(":")[0]!;
      table[item] ??= {};
      table[item]![label] = (table[item]![label] ?? 0) + Number(event.params.amount);
    }
  }
}

export type SimFlag = { severity: "error" | "warning" | "info"; code: string; message: string };
export type SimReport = {
  gameId: string;
  players: number;
  days: number;
  archetypes: Array<{ name: string; players: number; finishedShare: number; medianFrontierByDay: number[]; revenuePerPlayer: number }>;
  daily: Array<{ day: number; frontier: { p10: number; p50: number; p90: number }; coins: { p10: number; p50: number; p90: number }; gems: { p50: number }; blockedSessionShare: number }>;
  levels: Array<{ number: number; attempts: number; wins: number; winRate: number; attemptsPerWin: number; continues: number }>;
  economy: { earned: Record<string, Record<string, number>>; spent: Record<string, Record<string, number>> };
  monetization: { revenueUsd: number; arpdau: number; payersShare: number; rewardedAds: number; interstitials: number };
  flags: SimFlag[];
};

const pct = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
};

export async function simulateGame(
  gameId: string,
  opts: { players?: number; days?: number; seed?: string; archetypes?: Archetype[]; bundle?: GameBundle; write?: boolean } = {},
): Promise<SimReport> {
  const bundle = opts.bundle ?? (() => {
    const compiled = compileGame(gameId);
    if (!compiled.bundle) throw new Error(`cannot simulate: ${compiled.issues.format()}`);
    return compiled.bundle;
  })();
  const tooling = TOOLING[bundle.game.mechanic];
  if (!tooling?.createBot) throw new Error(`mechanic "${bundle.game.mechanic}" has no simulation bot`);
  const playersTotal = opts.players ?? 400;
  const days = opts.days ?? 14;
  const archetypes = opts.archetypes ?? DEFAULT_ARCHETYPES;
  const master = createRng(opts.seed ?? `sim:${gameId}`);
  const counter = new CountingProvider();
  const startMs = Date.UTC(2026, 9, 1, 8);
  const levelStats = new Map<number, { attempts: number; wins: number; continues: number }>();
  const daily = Array.from({ length: days }, () => ({ frontier: [] as number[], coins: [] as number[], gems: [] as number[], sessions: 0, blocked: 0 }));
  const perArchetype = new Map<string, { players: number; finished: number; frontierByDay: number[][]; revenue: number }>();
  let revenue = 0;
  let payers = 0;
  let rewardedAds = 0;
  let interstitials = 0;

  for (let p = 0; p < playersTotal; p++) {
    const rng = master.fork(`player-${p}`);
    let roll = rng.next();
    const archetype = archetypes.find((a) => (roll -= a.share) < 0) ?? archetypes[archetypes.length - 1]!;
    const clock = new ManualClock(startMs);
    const ads = new MockAdsProvider((format) => (format === "rewarded" ? "completed" : "completed"));
    const runtime = await GameRuntime.create({
      bundle,
      mechanics: MECHANICS,
      store: new MemorySaveStore(),
      clock,
      platform: "node",
      appVersion: "sim",
      analyticsProviders: [counter],
      ads,
      iap: new MockIapProvider(bundle.store),
      playerId: `sim-${p}`,
      persist: "manual",
    });
    const stats = perArchetype.get(archetype.name) ?? { players: 0, finished: 0, frontierByDay: Array.from({ length: days }, () => []), revenue: 0 };
    stats.players += 1;
    perArchetype.set(archetype.name, stats);
    let paid = false;

    for (let day = 0; day < days; day++) {
      const sessions = rng.range(archetype.sessionsPerDay[0], archetype.sessionsPerDay[1]);
      for (let s = 0; s < sessions; s++) {
        clock.set(startMs + day * DAY + s * (14 / sessions) * HOUR + rng.int(60) * MINUTE);
        runtime.startSession();
        daily[day]!.sessions += 1;
        for (const beat of runtime.getSnapshot().pendingStory) runtime.markStorySeen(beat.id);
        if (archetype.purchasePerDay > 0 && rng.chance(archetype.purchasePerDay / sessions)) {
          const productId = rng.pick(archetype.products);
          const before = runtime.saveDocument.stats.purchases;
          await runtime.purchaseProduct(productId);
          if (runtime.saveDocument.stats.purchases > before) {
            const price = bundle.store.products.find((x) => x.id === productId)!.referencePriceUsd;
            revenue += price;
            stats.revenue += price;
            paid = true;
          }
        }
        const attempts = rng.range(archetype.attemptsPerSession[0], archetype.attemptsPerSession[1]);
        for (let a = 0; a < attempts; a++) {
          const snap = runtime.getSnapshot();
          if (snap.journey.completedAll) break;
          const level = runtime.levelByNumber(snap.journey.frontier);
          if (!level) break;
          let start = runtime.startLevel(level.levelId);
          if (!start.ok && start.reason === "no_lives") {
            if (rng.chance(archetype.refillWithGems) && runtime.refillLives().ok) start = runtime.startLevel(level.levelId);
            if (!start.ok) {
              daily[day]!.blocked += 1;
              break;
            }
          }
          if (!start.ok) break;
          const ls = levelStats.get(level.number) ?? { attempts: 0, wins: 0, continues: 0 };
          ls.attempts += 1;
          levelStats.set(level.number, ls);
          const bot = tooling.createBot(level.data, archetype.skill, rng.fork(`bot-${level.number}-${ls.attempts}`));
          for (let step = 0; step < 3000; step++) {
            const session = runtime.activeSession!;
            const status = session.status();
            if (status === "playing") {
              let action = bot.next(session.state);
              if (action === null && rng.chance(archetype.useBoosterWhenStuck) && runtime.useBooster("hint").ok) {
                action = runtime.getSnapshot().session?.hint ?? null;
              }
              if (action === null) {
                runtime.abandonLevel();
                break;
              }
              const before = session.state;
              const result = runtime.act(action);
              bot.observe(before, action, result.outcome);
              if (result.outcome === "illegal") {
                runtime.abandonLevel();
                break;
              }
              continue;
            }
            if (status === "lost") {
              const offer = runtime.continueOffer();
              if (offer?.adAvailable && rng.chance(archetype.watchAds) && (await runtime.continueWithAd()).ok) {
                ls.continues += 1;
                rewardedAds += 1;
                continue;
              }
              if (offer?.canAfford && rng.chance(archetype.continueWithCoins) && runtime.continueWithCoins().ok) {
                ls.continues += 1;
                continue;
              }
            }
            const result = runtime.finishLevel();
            if (result.won) ls.wins += 1;
            if (result.interstitialDue && (await runtime.showInterstitialIfDue())) interstitials += 1;
            break;
          }
          clock.advance(rng.range(2, 5) * MINUTE);
        }
        runtime.endSession();
      }
      const snap = runtime.getSnapshot();
      daily[day]!.frontier.push(snap.journey.frontier);
      daily[day]!.coins.push(snap.wallet.coins ?? 0);
      daily[day]!.gems.push(snap.wallet.gems ?? 0);
      stats.frontierByDay[day]!.push(snap.journey.frontier);
    }
    if (runtime.getSnapshot().journey.completedAll) stats.finished += 1;
    if (paid) payers += 1;
  }

  const levels = [...levelStats.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, s]) => ({
      number,
      attempts: s.attempts,
      wins: s.wins,
      winRate: s.wins / Math.max(1, s.attempts),
      attemptsPerWin: s.attempts / Math.max(1, s.wins),
      continues: s.continues,
    }));
  const report: SimReport = {
    gameId,
    players: playersTotal,
    days,
    archetypes: [...perArchetype.entries()].map(([name, s]) => ({
      name,
      players: s.players,
      finishedShare: s.finished / s.players,
      medianFrontierByDay: s.frontierByDay.map((v) => pct(v, 0.5)),
      revenuePerPlayer: s.revenue / s.players,
    })),
    daily: daily.map((d, day) => ({
      day: day + 1,
      frontier: { p10: pct(d.frontier, 0.1), p50: pct(d.frontier, 0.5), p90: pct(d.frontier, 0.9) },
      coins: { p10: pct(d.coins, 0.1), p50: pct(d.coins, 0.5), p90: pct(d.coins, 0.9) },
      gems: { p50: pct(d.gems, 0.5) },
      blockedSessionShare: d.blocked / Math.max(1, d.sessions),
    })),
    levels,
    economy: { earned: counter.earned, spent: counter.spent },
    monetization: {
      revenueUsd: Math.round(revenue * 100) / 100,
      arpdau: Math.round((revenue / Math.max(1, daily.reduce((n, d) => n + (d.sessions > 0 ? 1 : 0), 0) * playersTotal)) * 1000) / 1000,
      payersShare: payers / playersTotal,
      rewardedAds,
      interstitials,
    },
    flags: [],
  };
  report.flags = assess(report, bundle);
  if (opts.write !== false) writeJson(rootPath("build", "reports", `${gameId}-simulation.json`), report, false);
  return report;
}

/** Turns raw numbers into findings: inflation, grind, blocking, impossible levels, imbalance. */
export function assess(report: SimReport, bundle: GameBundle): SimFlag[] {
  const flags: SimFlag[] = [];
  const total = (table: Record<string, number> | undefined) => Object.values(table ?? {}).reduce((a, b) => a + b, 0);
  const coinsIn = total(report.economy.earned.coins);
  const coinsOut = total(report.economy.spent.coins);
  const ratio = coinsIn / Math.max(1, coinsOut);
  if (ratio > 3) flags.push({ severity: "warning", code: "inflation", message: `coins earned ${coinsIn} vs spent ${coinsOut} (x${ratio.toFixed(1)}): sinks are too weak, balances will pile up` });
  if (ratio < 0.6) flags.push({ severity: "warning", code: "deflation", message: `coins spent exceed earnings (x${ratio.toFixed(2)}): free players will run dry` });

  for (const level of report.levels) {
    if (level.attempts >= 20 && level.winRate < 0.15) flags.push({ severity: "error", code: "impossible", message: `level ${level.number}: only ${(level.winRate * 100).toFixed(0)}% of attempts win` });
    else if (level.attemptsPerWin > 4) flags.push({ severity: "warning", code: "grind", message: `level ${level.number}: ${level.attemptsPerWin.toFixed(1)} attempts per win` });
  }
  const levelCount = bundle.levels.length;
  const stalled = report.archetypes.filter((a) => a.medianFrontierByDay.at(-1)! <= Math.min(levelCount, 3));
  for (const a of stalled) flags.push({ severity: "error", code: "progression_blocked", message: `${a.name}: median player is still at level ${a.medianFrontierByDay.at(-1)} after ${report.days} days` });
  const maxBlocked = Math.max(...report.daily.map((d) => d.blockedSessionShare));
  if (maxBlocked > 0.4) flags.push({ severity: "warning", code: "lives_bottleneck", message: `up to ${(maxBlocked * 100).toFixed(0)}% of sessions end out of lives` });
  else if (maxBlocked < 0.02 && bundle.game.modules.lives) flags.push({ severity: "info", code: "lives_slack", message: "lives almost never run out: the energy system adds no pressure" });

  const finished = report.archetypes.map((a) => `${a.name} ${(a.finishedShare * 100).toFixed(0)}%`).join(", ");
  flags.push({ severity: "info", code: "completion", message: `finished all ${levelCount} levels within ${report.days} days: ${finished}` });
  const lastCoins = report.daily.at(-1)!.coins.p50;
  const continueCoins = bundle.economy.continue.cost.coins ?? 0;
  if (continueCoins > 0 && lastCoins > continueCoins * 40) {
    flags.push({ severity: "warning", code: "accumulation", message: `median balance ${lastCoins} coins buys ${Math.floor(lastCoins / continueCoins)} continues: rewards outpace sinks` });
  }
  return flags;
}

export function formatReport(r: SimReport): string {
  const lines: string[] = [];
  lines.push(`Simulation: ${r.gameId}, ${r.players} players, ${r.days} days`);
  lines.push("");
  lines.push("Archetype        players  finished  median level by day                    revenue/player");
  for (const a of r.archetypes) {
    lines.push(`${a.name.padEnd(16)} ${String(a.players).padStart(7)}  ${`${(a.finishedShare * 100).toFixed(0)}%`.padStart(8)}  ${a.medianFrontierByDay.join(" ").padEnd(38)} $${a.revenuePerPlayer.toFixed(2)}`);
  }
  lines.push("");
  lines.push("Day  level p10/p50/p90   coins p10/p50/p90     gems p50  sessions out of lives");
  for (const d of r.daily) {
    lines.push(`${String(d.day).padStart(3)}  ${`${d.frontier.p10}/${d.frontier.p50}/${d.frontier.p90}`.padEnd(18)}  ${`${d.coins.p10}/${d.coins.p50}/${d.coins.p90}`.padEnd(20)}  ${String(d.gems.p50).padStart(8)}  ${(d.blockedSessionShare * 100).toFixed(1).padStart(6)}%`);
  }
  lines.push("");
  lines.push("Level  attempts  win rate  attempts/win  continues");
  for (const l of r.levels) {
    lines.push(`${String(l.number).padStart(5)}  ${String(l.attempts).padStart(8)}  ${`${(l.winRate * 100).toFixed(0)}%`.padStart(8)}  ${l.attemptsPerWin.toFixed(2).padStart(12)}  ${String(l.continues).padStart(9)}`);
  }
  lines.push("");
  const fmt = (t: Record<string, Record<string, number>>) =>
    Object.entries(t).map(([item, by]) => `  ${item}: ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  lines.push("Sources", ...fmt(r.economy.earned), "Sinks", ...fmt(r.economy.spent));
  lines.push("");
  lines.push(`Revenue $${r.monetization.revenueUsd} (reference prices), ARPDAU $${r.monetization.arpdau}, payers ${(r.monetization.payersShare * 100).toFixed(1)}%, rewarded ads ${r.monetization.rewardedAds}, interstitials ${r.monetization.interstitials}`);
  lines.push("");
  lines.push("Findings");
  for (const f of r.flags) lines.push(`  ${f.severity === "error" ? "✖" : f.severity === "warning" ? "⚠" : "•"} [${f.code}] ${f.message}`);
  return lines.join("\n");
}
