import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  EconomyDefinition, GameDefinition, ItemBag, LeaderboardsFile, ReleaseDefinition, RemotePayload, SCHEMA_REGISTRY,
  StoreListing, ThemeDefinition, legacyGamePlatforms, migrateDocument, placeholdersOf, storeSku, wordId, type Migration,
} from "./index";

const game = {
  schemaVersion: 2,
  gameId: "maplebrook",
  name: "Maplebrook Word Solitaire",
  version: "0.1.0",
  template: "solitaire_adventure",
  theme: "cozy_village",
  mechanic: { id: "associations" },
  content: { locales: ["en"], defaultLocale: "en", packs: ["core_en"] },
};

const release = {
  schemaVersion: 1,
  ios: { bundleId: "com.gamefactory.maplebrook" },
  android: { package: "com.gamefactory.maplebrook" },
};

describe("schemas", () => {
  it("accepts a valid game definition and applies defaults", () => {
    const parsed = GameDefinition.parse({ ...game, content: { locales: ["en"], defaultLocale: "en" } });
    expect(parsed.content.packs).toEqual([]);
  });

  it("rejects unknown keys so typos fail the build", () => {
    const result = GameDefinition.safeParse({ ...game, themee: "x" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  it("rejects uppercase ids and store identity inside game.json", () => {
    expect(GameDefinition.safeParse({ ...game, gameId: "Maple" }).success).toBe(false);
    expect(GameDefinition.safeParse({ ...game, platforms: {} }).success).toBe(false);
  });

  it("release definitions validate store identity and apply store defaults", () => {
    const parsed = ReleaseDefinition.parse(release);
    expect(parsed.ios.supportsTablet).toBe(false);
    expect(parsed.android.store.defaultTrack).toBe("internal");
    expect(parsed.environments.production).toEqual({});
    for (const pkg of ["NoDots", "com.gamefactory.1game", "Com.Game.App"]) {
      expect(ReleaseDefinition.safeParse({ ...release, android: { package: pkg } }).success, pkg).toBe(false);
    }
    expect(storeSku(parsed, "ios", "coins_small")).toBe("com.gamefactory.maplebrook.coins_small");
    expect(storeSku({ ...parsed, iap: { skuPattern: "{productId}_v1" } }, "android", "no_ads")).toBe("no_ads_v1");
  });

  it("store listings enforce the stricter store limits", () => {
    const listing = {
      schemaVersion: 1, locale: "en", title: "Maplebrook Word Solitaire", subtitle: "Sort words, restore the fair",
      shortDescription: "A cozy word-sorting solitaire.", description: "Sort jumbled word cards into categories.",
    };
    expect(StoreListing.safeParse(listing).success).toBe(true);
    expect(StoreListing.safeParse({ ...listing, title: "x".repeat(31) }).success).toBe(false);
    expect(StoreListing.safeParse({ ...listing, keywords: ["k".repeat(60), "w".repeat(60)] }).success).toBe(false);
  });

  it("leaderboards default their size and entry level", () => {
    const file = LeaderboardsFile.parse({
      schemaVersion: 1, boards: [{ id: "journey", titleKey: "leaderboard.journey", metric: "stars_total", period: "all_time" }],
    });
    expect(file.boards[0]).toMatchObject({ size: 100, minLevel: 1 });
  });

  it("item bags only hold positive integers", () => {
    expect(ItemBag.safeParse({ coins: 10, hint: 1 }).success).toBe(true);
    expect(ItemBag.safeParse({ coins: 0 }).success).toBe(false);
    expect(ItemBag.safeParse({ coins: 1.5 }).success).toBe(false);
  });

  it("economy requires all three star reward tiers", () => {
    const economy = {
      schemaVersion: 1,
      items: [{ id: "coins", kind: "soft_currency", nameKey: "item.coins", icon: "coin", initial: 100 }],
      boosters: [],
      levelRewards: { byStars: { "1": { coins: 10 }, "2": { coins: 20 } } },
      continue: { extraMoves: 5, cost: { coins: 100 }, costEscalation: [1], maxContinues: 1, rewardedAd: true },
    };
    expect(EconomyDefinition.safeParse(economy).success).toBe(false);
    const fixed = { ...economy, levelRewards: { byStars: { ...economy.levelRewards.byStars, "3": { coins: 30 } } } };
    const parsed = EconomyDefinition.parse(fixed);
    expect(parsed.levelRewards.keystoneMultiplier).toBe(1);
    expect(parsed.rewardTables).toEqual({});
  });

  it("theme icons and sounds are partial records", () => {
    const icons = ThemeDefinition.shape.icons.safeParse({ coin: { emoji: "🪙" } });
    expect(icons.success).toBe(true);
    expect(ThemeDefinition.shape.icons.safeParse({ dragon: { emoji: "🐉" } }).success).toBe(false);
  });

  it("remote payloads only override whitelisted roots", () => {
    const ok = RemotePayload.safeParse({
      schemaVersion: 1, gameId: "maplebrook", payloadVersion: "1",
      overrides: { economy: { continue: { extraMoves: 7 } } },
    });
    expect(ok.success).toBe(true);
    const bad = RemotePayload.safeParse({
      schemaVersion: 1, gameId: "maplebrook", payloadVersion: "1", overrides: { levels: [] },
    });
    expect(bad.success).toBe(false);
  });

  it("every registered schema exports to JSON Schema", () => {
    for (const entry of SCHEMA_REGISTRY) {
      const json = z.toJSONSchema(entry.schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
      const shape = json.type === "object" || Array.isArray(json.oneOf) || Array.isArray(json.anyOf);
      expect(shape, entry.name).toBe(true);
    }
  });
});

describe("migrations", () => {
  const steps: Migration[] = [
    { kind: "economy", from: 1, to: 2, describe: "rename coinz", migrate: (d) => ({ ...d, renamed: true }) },
    { kind: "economy", from: 2, to: 3, describe: "add field", migrate: (d) => ({ ...d, added: 1 }) },
  ];

  it("is a no-op for current documents", () => {
    const doc = { schemaVersion: 1, a: 1 };
    expect(migrateDocument("economy", doc)).toEqual(doc);
  });

  it("chains migrations forward and stamps the version", () => {
    expect(migrateDocument("economy", { schemaVersion: 1 }, steps, 3)).toEqual({
      schemaVersion: 3, renamed: true, added: 1,
    });
  });

  it("refuses documents from the future", () => {
    expect(() => migrateDocument("economy", { schemaVersion: 9 })).toThrow(/newer/);
  });

  it("moves store identity out of a version 1 game.json", () => {
    const v1 = {
      ...game,
      schemaVersion: 1,
      platforms: { ios: { bundleId: "com.studio.maple" }, android: { package: "com.studio.maple" }, web: { enabled: true } },
      remoteConfig: { url: "https://config.example.com/maple.json", refreshHours: 6 },
    };
    expect(legacyGamePlatforms(v1)).toEqual({
      ios: { bundleId: "com.studio.maple" },
      android: { package: "com.studio.maple" },
      remoteConfigUrl: "https://config.example.com/maple.json",
    });
    const migrated = migrateDocument("game", v1);
    expect(migrated).toMatchObject({ schemaVersion: 2, remoteConfig: { refreshHours: 6 } });
    expect(GameDefinition.safeParse(migrated).success).toBe(true);
    expect(legacyGamePlatforms(migrated)).toBeNull();
  });
});

describe("content helpers", () => {
  it("derives stable word ids", () => {
    expect(wordId("fruits", "Green Apple")).toBe("fruits.green_apple");
    expect(wordId("dances", "Café Tango!")).toBe("dances.cafe_tango");
  });

  it("finds placeholders", () => {
    expect(placeholdersOf("Win {coins} coins and {stars} stars, {coins}!")).toEqual(["coins", "stars"]);
  });
});
