import { z } from "zod";
import { Id, JsonObject, SchemaVersion } from "./common";

/**
 * Store-specific configuration. Gameplay never reads it: it is consumed by app.config.ts (native
 * identity), the platform layer (endpoints, ad unit ids, store SKUs) and the release tooling.
 */

/** Build environments. Each selects its own endpoints and platform-service implementations. */
export const APP_ENVIRONMENTS = ["development", "staging", "production"] as const;
export const AppEnvironment = z.enum(APP_ENVIRONMENTS);
export type AppEnvironment = z.infer<typeof AppEnvironment>;

export const IosBundleId = z
  .string()
  .max(155)
  .regex(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, "reverse-DNS bundle id, e.g. com.studio.game");
export const AndroidPackage = z
  .string()
  .max(150)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "lowercase reverse-DNS package; every segment starts with a letter");
export const IdPrefix = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, "lowercase reverse-DNS prefix, e.g. com.studio");

const AdUnits = z.strictObject({
  appId: z.string().min(1).optional().describe("Ad network app id for this platform"),
  placements: z.record(Id, z.string().min(1)).default({}).describe("monetization.json placement id -> ad unit id"),
});

const Endpoints = z.strictObject({
  backendUrl: z.url().optional().describe("Game backend: identity, sync, attempt verification, leaderboards, purchase verification"),
  remoteConfigUrl: z.url().optional().describe("HTTPS URL of this environment's remote-config payload"),
});
export type Endpoints = z.infer<typeof Endpoints>;

export const IosRelease = z.strictObject({
  bundleId: IosBundleId,
  ascAppId: z.string().regex(/^\d+$/).optional().describe("App Store Connect app id, used by store submission"),
  supportsTablet: z.boolean().default(false).describe("true also requires iPad screenshots for every store locale"),
  usesNonExemptEncryption: z.boolean().default(false).describe("Export compliance answer written into Info.plist"),
  ads: AdUnits.optional(),
  store: z
    .strictObject({
      primaryCategory: z.string().default("GAMES"),
      subcategories: z.array(z.string()).max(2).default([]).describe("e.g. GAMES_CARD, GAMES_PUZZLE, GAMES_WORD"),
    })
    .prefault({}),
});
export type IosRelease = z.infer<typeof IosRelease>;

export const AndroidRelease = z.strictObject({
  package: AndroidPackage,
  blockedPermissions: z
    .array(z.string().regex(/^[A-Za-z0-9_.]+$/))
    .default([])
    .describe("Removed from the merged manifest even when a library adds them"),
  ads: AdUnits.optional(),
  store: z
    .strictObject({
      category: z.string().default("GAME_CARD").describe("Google Play category, e.g. GAME_CARD, GAME_PUZZLE, GAME_WORD"),
      defaultTrack: z.enum(["internal", "alpha", "beta", "production"]).default("internal"),
    })
    .prefault({}),
});
export type AndroidRelease = z.infer<typeof AndroidRelease>;

export const ReleaseDefinition = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: SchemaVersion,
    ios: IosRelease,
    android: AndroidRelease,
    eas: z
      .strictObject({
        owner: z.string().optional(),
        projectId: z.uuid().optional().describe("EAS project of this store app; required for staging and production builds"),
      })
      .prefault({}),
    iap: z
      .strictObject({
        skuPattern: z
          .string()
          .regex(/\{productId\}/, "the pattern must contain {productId}")
          .default("{appId}.{productId}")
          .describe("Store product id of each store.json product. {appId} is the bundle id or package"),
      })
      .prefault({}),
    environments: z
      .strictObject({
        development: Endpoints.prefault({}),
        staging: Endpoints.prefault({}),
        production: Endpoints.prefault({}),
      })
      .prefault({}),
  })
  .meta({
    title: "ReleaseDefinition",
    description: "games/ID/release.json: store identity, native settings and endpoints, merged over deploy/PLATFORM/defaults.json",
  });
export type ReleaseDefinition = z.infer<typeof ReleaseDefinition>;

/** deploy/ios/defaults.json and deploy/android/defaults.json: factory-wide store policy for one platform. */
export const DeployDefaults = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: SchemaVersion,
    platform: z.enum(["ios", "android"]),
    idPrefix: IdPrefix.describe("Prefix create-game uses when --ios-id or --android-id is omitted"),
    release: JsonObject.describe("Defaults merged under every game's release.json section for this platform"),
  })
  .meta({ title: "DeployDefaults", description: "deploy/PLATFORM/defaults.json: shared release policy for one store" });
export type DeployDefaults = z.infer<typeof DeployDefaults>;

/** The store product id of a store.json product on one platform. */
export function storeSku(release: Pick<ReleaseDefinition, "iap" | "ios" | "android">, platform: "ios" | "android", productId: string): string {
  const appId = platform === "ios" ? release.ios.bundleId : release.android.package;
  return release.iap.skuPattern.replaceAll("{appId}", appId).replaceAll("{productId}", productId);
}

/** games/ID/store/LOCALE.json: listing text, checked against the stricter of the two stores' limits. */
export const StoreListing = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: SchemaVersion,
    locale: z.string().min(2),
    title: z.string().min(2).max(30),
    subtitle: z.string().max(30).describe("App Store subtitle"),
    shortDescription: z.string().max(80).describe("Google Play short description"),
    description: z.string().min(10).max(4000),
    keywords: z.array(z.string().min(1)).default([]).describe("App Store keywords; joined with commas they must fit in 100 characters"),
    promotionalText: z.string().max(170).default(""),
    releaseNotes: z.string().max(500).default("").describe("500 characters fits both stores"),
  })
  .refine((listing) => listing.keywords.join(",").length <= 100, {
    message: "keywords joined with commas exceed 100 characters",
    path: ["keywords"],
  })
  .meta({ title: "StoreListing", description: "games/ID/store/LOCALE.json: store listing text for one locale" });
export type StoreListing = z.infer<typeof StoreListing>;
