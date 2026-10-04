/** Test fixtures for @gf/core. Not exported from the package index. */
import type { GameBundle } from "@gf/schemas";
import { AnalyticsTaxonomy } from "@gf/schemas";
import { z } from "zod";
import taxonomy from "../../../analytics/events.json";
import type { CoreMechanic, SessionStatus } from "./mechanic";

const CounterData = z.object({
  target: z.int().positive(),
  moves: z.int().positive(),
  stars: z.object({ two: z.int(), three: z.int() }),
});
type CounterData = z.infer<typeof CounterData>;
export type CounterState = { value: number; movesLeft: number; used: number; mismatches: number };
export type CounterAction = { type: "inc" } | { type: "wrong" } | { type: "noop" };

const status = (s: CounterState, d: CounterData): SessionStatus =>
  s.value >= d.target ? "won" : s.movesLeft <= 0 ? "lost" : "playing";

/** A trivial mechanic: reach `target` increments within the move budget. */
export const counterMechanic: CoreMechanic<CounterData, CounterState, CounterAction> = {
  id: "counter",
  version: "1",
  levelDataSchema: CounterData,
  capabilities: ["hint", "auto_place", "add_moves"],
  createState: (d, o) => ({ value: 0, movesLeft: d.moves + o.moveBonus, used: 0, mismatches: 0 }),
  apply(s, a, d) {
    if (status(s, d) !== "playing") return { outcome: "illegal", state: s, events: [] };
    if (a.type === "inc") {
      const value = s.value + 1;
      return {
        outcome: "applied",
        state: { ...s, value, movesLeft: s.movesLeft - 1, used: s.used + 1 },
        events: value === d.target ? [{ type: "category_completed", category: "all" }] : [],
      };
    }
    if (a.type === "wrong") {
      return { outcome: "mismatch", state: { ...s, movesLeft: s.movesLeft - 1, used: s.used + 1, mismatches: s.mismatches + 1 }, events: [] };
    }
    return { outcome: "illegal", state: s, events: [] };
  },
  status,
  lossReason: (s, d) => (s.value < d.target && s.movesLeft <= 0 ? "out_of_moves" : null),
  budget: (s, d) => ({ kind: "moves", left: s.movesLeft, total: d.moves }),
  addBudget: (s, n) => ({ ...s, movesLeft: s.movesLeft + n }),
  evaluate: (s, d) => ({
    stars: s.value < d.target ? 0 : s.movesLeft >= d.stars.three ? 3 : s.movesLeft >= d.stars.two ? 2 : 1,
    score: s.value * 10,
    movesLeft: s.movesLeft,
    movesUsed: s.used,
    mismatches: s.mismatches,
  }),
  hint: () => ({ type: "inc" }),
  autoPlace: (s, a) =>
    a.type === "inc" ? { outcome: "applied", state: { ...s, value: s.value + 1 }, events: [] } : { outcome: "illegal", state: s, events: [] },
  validateLevel: () => [],
  isAction: (x): x is CounterAction =>
    typeof x === "object" && x !== null && ["inc", "wrong", "noop"].includes(String((x as { type?: unknown }).type)),
};

const level = (n: number, extra: Partial<GameBundle["levels"][number]> = {}): GameBundle["levels"][number] => ({
  levelId: `test.l${n}`,
  number: n,
  mechanic: "counter",
  difficulty: { tier: "easy", score: 0.2 },
  objectives: [{ type: "clear_board" }],
  lose: { outOfMoves: true, stuck: true },
  boosters: { allowed: ["hint", "undo", "joker", "plus5"] },
  tags: [],
  data: { target: 3, moves: 5, stars: { two: 1, three: 2 } },
  ...extra,
});

export function makeBundle(): GameBundle {
  return {
    bundleFormat: 1,
    build: { gameId: "test", gameVersion: "0.1.0", engineVersion: "0.1.0", contentHash: "abc" },
    game: {
      gameId: "test", name: "Test Game", version: "0.1.0", template: "t", theme: "th", mechanic: "counter",
      modules: {
        map: true, story: true, lives: true, boosters: true, shop: true, ads: true, iap: true, quests: false,
        collections: false, buildings: false, dailyReward: false, events: false, notifications: false, leaderboards: false,
      },
      defaultLocale: "en", locales: ["en"],
    },
    template: { templateId: "t", coreLoop: ["play", "win"], ui: { screens: [], mapHud: [], levelHud: [] } },
    theme: {} as GameBundle["theme"],
    economy: {
      schemaVersion: 1,
      items: [
        { id: "coins", kind: "soft_currency", nameKey: "item.coins", icon: "coin", initial: 100 },
        { id: "gems", kind: "premium_currency", nameKey: "item.gems", icon: "gem", initial: 0 },
        { id: "lives", kind: "energy", nameKey: "item.lives", icon: "life", initial: 5 },
        { id: "hint", kind: "booster", nameKey: "item.hint", icon: "hint", initial: 1 },
        { id: "undo", kind: "booster", nameKey: "item.undo", icon: "undo", initial: 1 },
        { id: "joker", kind: "booster", nameKey: "item.joker", icon: "joker", initial: 0, cap: 9 },
        { id: "plus5", kind: "booster", nameKey: "item.plus5", icon: "moves", initial: 0 },
      ],
      energy: { item: "lives", max: 5, regenSeconds: 1200, chargeOn: "loss", refillCost: { coins: 90 } },
      boosters: [
        { id: "hint", effect: "hint", price: { coins: 50 } },
        { id: "undo", effect: "undo", price: { coins: 30 } },
        { id: "joker", effect: "auto_place", price: { coins: 80 }, maxPerLevel: 1 },
        { id: "plus5", effect: "add_moves", amount: 5, price: { coins: 60 } },
      ],
      levelRewards: { byStars: { "1": { coins: 10 }, "2": { coins: 20 }, "3": { coins: 30 } }, tierMultiplier: { hard: 2 }, keystoneMultiplier: 3 },
      continue: { extraMoves: 5, cost: { coins: 40 }, costEscalation: [1, 2], maxContinues: 2, rewardedAd: true },
      rewardTables: { ch1_chest: { coins: 100, hint: 1 } },
    },
    progression: {
      schemaVersion: 1,
      unlockRule: "linear",
      replayCompleted: false,
      chapters: [
        { id: "ch1", titleKey: "ch1.title", levels: { from: 1, to: 2 }, unlock: { type: "previous_chapter" }, completionReward: "ch1_chest", storyIntro: "intro1", storyOutro: "outro1" },
        { id: "ch2", titleKey: "ch2.title", levels: { from: 3, to: 4 }, unlock: { type: "previous_chapter" }, completionReward: { gems: 5 } },
      ],
    },
    levels: [level(1), level(2), level(3), level(4, { tags: ["keystone"], difficulty: { tier: "hard", score: 0.8 } })],
    characters: [],
    story: [
      { id: "intro1", trigger: { type: "chapter_start", chapter: "ch1" }, lines: [{ speaker: "narrator", textKey: "s.1" }] },
      { id: "outro1", trigger: { type: "chapter_complete", chapter: "ch1" }, lines: [{ speaker: "narrator", textKey: "s.2" }] },
      { id: "intro2", trigger: { type: "chapter_start", chapter: "ch2" }, lines: [{ speaker: "narrator", textKey: "s.3" }] },
    ],
    store: {
      schemaVersion: 1,
      products: [
        { id: "coins_small", type: "consumable", storeIds: {}, titleKey: "p.1", contents: { coins: 500 }, entitlements: [], referencePriceUsd: 1.99, tags: [] },
        { id: "no_ads", type: "non_consumable", storeIds: {}, titleKey: "p.2", contents: {}, entitlements: ["no_ads"], referencePriceUsd: 4.99, tags: [] },
      ],
      offers: [{ id: "hint_pack", titleKey: "o.1", cost: { coins: 100 }, contents: { hint: 3 }, limitPerDay: 1 }],
      sections: [],
      specialOffers: [],
    },
    monetization: {
      schemaVersion: 1,
      ads: {
        enabled: true,
        rewarded: { placements: [{ id: "continue_moves", kind: "continue" }], dailyCap: 5 },
        interstitial: { enabled: true, minLevel: 2, everyNLevels: 2, cooldownSeconds: 60 },
        banner: { enabled: false, screens: [] },
      },
      removeAdsEntitlement: "no_ads",
      iap: { enabled: true },
    },
    quests: [],
    events: [],
    leaderboards: [],
    analytics: AnalyticsTaxonomy.parse(taxonomy),
    tuning: { difficulty: { moveBonus: 0, perLevel: {} }, features: {} },
    remote: { refreshHours: 12 },
    strings: { en: { "ch1.title": "Chapter {n}" } },
  };
}
