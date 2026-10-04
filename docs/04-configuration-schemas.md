# D. Configuration schemas

**Source of truth:** zod schemas in `engine/schemas/src/`. Types are inferred from them
(`z.infer`), so code and data cannot drift. `npm run gf -- schemas export` writes JSON Schema
files to `schemas/` for editor autocompletion (`"$schema"`) and for AI structured outputs.

## Conventions

- Every authoring file has `"schemaVersion"`. The compiler migrates older versions forward.
- `Id`: lowercase `[a-z0-9][a-z0-9_.:-]*`. `LocKey`: a string-table key.
- `ItemBag`: `{ [itemId]: positiveInteger }`, for example `{ "coins": 50, "hint": 1 }`.
- `IconRef`: `{ "emoji": "🪙" }` or `{ "asset": "icon.coin" }`. `Color`: `#RRGGBB` or `#RRGGBBAA`.
- Durations carry their unit in the name (`regenSeconds`), never a bare number.
- Unknown keys are errors. Typos fail the build instead of being ignored.

The shapes below use TypeScript notation. `?` means optional.

## GameDefinition: `games/ID/game.json`

```ts
type GameDefinition = {
  schemaVersion: 2;                   // 1 -> 2 moved platforms and remoteConfig.url to release.json
  gameId: Id;                         // "maplebrook"
  name: string;                       // store and display name
  version: string;                    // content semver, "0.1.0"
  template: Id;                       // "solitaire_adventure"
  theme: Id;                          // "cozy_village"
  mechanic: { id: Id; rules?: Record<string, unknown> };   // rules validated by the mechanic
  modules?: Partial<Modules>;         // overrides the template's defaults
  content: { locales: string[]; defaultLocale: string; packs: Id[] };
  remoteConfig?: { refreshHours: number };     // payload URLs are per environment, in release.json
  meta?: { pitch: string; tags: string[]; audience?: string };
  overrides?: { economy?: DeepPartial<EconomyDefinition>; monetization?: DeepPartial<MonetizationDefinition> };
};
type Modules = {
  map: boolean; story: boolean; lives: boolean; boosters: boolean; shop: boolean; ads: boolean;
  iap: boolean; quests: boolean; collections: boolean; buildings: boolean; dailyReward: boolean;
  events: boolean; notifications: boolean; leaderboards: boolean;
};
```

```json
{
  "schemaVersion": 2,
  "gameId": "maplebrook",
  "name": "Maplebrook Word Solitaire",
  "version": "0.1.0",
  "template": "solitaire_adventure",
  "theme": "cozy_village",
  "mechanic": { "id": "associations" },
  "modules": { "story": true, "collections": false },
  "content": { "locales": ["en"], "defaultLocale": "en", "packs": ["core_en"] }
}
```

## ReleaseDefinition: `games/ID/release.json`

Everything store-specific, merged over `deploy/ios/defaults.json` and `deploy/android/defaults.json`
(`DeployDefaults`: `platform`, `idPrefix`, `release` defaults). Not part of the GameBundle, so one bundle
serves every environment.

```ts
type ReleaseDefinition = {
  schemaVersion: 1;
  ios: {
    bundleId: string;                     // reverse DNS
    ascAppId?: string;                    // App Store Connect app id, for submission
    supportsTablet: boolean;              // default false; true requires iPad screenshots
    usesNonExemptEncryption: boolean;     // default false (export compliance)
    ads?: { appId?: string; placements: Record<Id, string> };   // placement -> ad unit id
    store: { primaryCategory: string; subcategories: string[] };
  };
  android: {
    package: string;                      // lowercase reverse DNS, segments start with a letter
    blockedPermissions: string[];         // stripped from the merged manifest
    ads?: { appId?: string; placements: Record<Id, string> };
    store: { category: string; defaultTrack: "internal" | "alpha" | "beta" | "production" };
  };
  eas: { owner?: string; projectId?: Uuid };          // one EAS project per store app
  iap: { skuPattern: string };                         // default "{appId}.{productId}"
  environments: Record<"development" | "staging" | "production", { backendUrl?: Url; remoteConfigUrl?: Url }>;
};
```

## StoreListing: `games/ID/store/LOCALE.json`

Title 30, subtitle 30 (App Store), short description 80 (Google Play), description 4,000, keywords
joined with commas 100, promotional text 170, release notes 500: the stricter of the two stores' limits.

## LeaderboardsFile: `leaderboards.json`

`boards[]` of `{ id, titleKey, metric: "stars_total" | "stars_earned" | "levels_completed" | "event_points",
period: "all_time" | "weekly" | "daily" | "event", size, minLevel, event? }`. Template defaults, game
overrides. The compiler checks that metric and period fit.

## Backend contracts (`engine/schemas/src/api.ts`)

| Schema | Endpoint |
|---|---|
| `AttemptRecord` | `POST /v1/attempts`: a finished attempt with its full move log |
| `AttemptVerdict` | its response: `accepted`, `rejected` or `unverifiable`, recomputed result, flags |
| `PurchaseVerificationRequest` / `PurchaseVerificationResult` | `POST /v1/purchases/verify` |
| `LeaderboardPage` | `GET /v1/leaderboards/{boardId}` |

The Java backend mirrors these as records, checked against the exported JSON Schemas and the fixtures
`gf server-engine` writes.

## ThemeDefinition: `themes/ID/theme.json`

Today's themes serve card boards, so card tokens (`cards`, card colors in `palette`) sit at the top
level. With the first non-card mechanic, version 2 splits the theme into frame tokens (palette roles,
typography, shapes, icons, sounds, backgrounds, map) and a board skin whose schema the mechanic owns,
like its level data: glass and liquid colors for `sort`, tiles and ball for `maze_paint`, glTF models for
3D boards ([A §2](01-architecture.md)).

```ts
type ThemeDefinition = {
  schemaVersion: 1;
  themeId: Id; name: string; description: string;
  palette: {
    primary: Color; primaryDark: Color; secondary: Color; accent: Color;
    background: Color; backgroundAlt: Color; surface: Color; surfaceAlt: Color;
    text: Color; textMuted: Color; textOnPrimary: Color;
    success: Color; danger: Color; warning: Color; overlay: Color;
    cardFace: Color; cardFaceText: Color; cardBack: Color; cardBackAlt: Color; cardBorder: Color;
    categoryCard: Color; categoryCardText: Color; slotEmpty: Color;
    mapPath: Color; nodeLocked: Color; nodeAvailable: Color; nodeCompleted: Color;
  };
  typography: { display: FontRef; body: FontRef; scale: number };   // FontRef = { asset } | { system }
  shape: { radiusSm: number; radiusMd: number; radiusLg: number; cardRadius: number; buttonRadius: number; borderWidth: number };
  cards: { aspectRatio: number; backPattern: "stripes" | "dots" | "checker" | "plain"; backAsset?: AssetKey;
           categoryStyle: "banner" | "solid"; shadow: "none" | "soft" | "hard" };
  backgrounds: { map: Background; level: Background };   // gradient or asset, plus decor icons
  map: { pathStyle: "dotted" | "dashed" | "solid"; nodeShape: "circle" | "rounded"; decor: IconRef[] };
  icons: Record<IconName, IconRef>;          // coin, gem, life, star, hint, undo, joker, moves, lock, ...
  animation: { cardMoveMs: number; cardFlipMs: number; popupMs: number; mismatchShake: boolean;
               celebration: "confetti" | "leaves" | "bubbles" | "sparkles" };
  vfx: { particleColors: Color[]; particleGlyphs: string[] };
  sounds: Partial<Record<SoundName, AssetKey>>;   // tap, place, mismatch, draw, complete, win, lose, coin
  assets: Record<AssetKey, { type: "svg" | "image" | "font" | "audio"; file: string; family?: string }>;
  artDirection: ArtDirection;                // consumed by the AI asset pipeline, see I
};
```

## LevelDefinition: `games/ID/levels.json`

A generic envelope shared by all mechanics, plus a mechanic-owned `data` payload.

```ts
type LevelsFile = { schemaVersion: 1; levels: LevelDefinition[] };
type LevelDefinition = {
  levelId: Id;                                  // "maplebrook.l007"
  number: number;                               // 1-based journey position
  mechanic: Id;                                 // must match game.mechanic.id
  difficulty: { tier: "tutorial" | "easy" | "medium" | "hard" | "expert"; score: number }; // 0..1
  objectives: Array<{ type: "clear_board" }>;   // win conditions
  lose: { outOfMoves: boolean; stuck: boolean };// lose conditions
  boosters: { allowed: Id[] };
  reward?: ItemBag;                             // overrides economy level rewards
  tags: string[];                               // "keystone", "tutorial"
  tutorial?: { steps: Array<{ trigger: "start" | "first_move" | "first_category"; textKey: LocKey }> };
  data: unknown;                                // validated by the mechanic's schema
  analysis?: { solutionLength: number; solverNodes: number; botWinRate?: Record<"casual"|"average"|"expert", number>;
               generator: { id: string; seed: string } };
};
```

Associations mechanic payload (`mechanic: "associations"`):

```ts
type AssociationsLevelData = {
  rules: {
    foundationSlots: number;          // 1..6 active category slots
    drawCount: 1;
    recycleLimit: number | null;      // null = unlimited stock recycles
    mismatchCostsMove: boolean;
    wordOnWord: "same_category" | "never";
    emptyColumn: "any" | "category_only" | "none";
  };
  categories: Array<{ id: Id; size: number }>;          // size = word cards in this level
  cards: Array<{ id: Id; kind: "category" | "word"; category: Id; word?: Id }>;
  tableau: Array<{ cards: Id[]; faceDown: number }>;    // bottom to top
  stock: Id[];                                          // last element is drawn first
  moves: number;                                        // move budget
  stars: { two: number; three: number };                // moves left needed at the win
};
```

TriPeaks payload (`mechanic: "tripeaks"`):

```ts
type TriPeaksLevelData = {
  rules: { wrap: boolean };                                // King and Ace are adjacent
  layout: { name: string; slots: Array<{ x: number; y: number }> };  // half-card grid, covers derived
  tableau: CardCode[];                                     // "7h", "10s"; ":2" marks a second deck
  waste: CardCode;
  stock: CardCode[];                                       // last element is drawn first
  reserve: CardCode[];                                     // cards that continues add
  stars: { two: number; three: number };                  // stock cards left at the win
};
```

Level curve segments in `levelgen.json` may carry a difficulty target. The tools then tune the
budget (moves or stock size) until the bot profile wins at that rate (ADR-0005):

```ts
type CurveSegment = {
  from: number; to: number; tier: Tier;
  params: Record<string, unknown>;   // the mechanic's generator parameters
  target?: { profile: "casual" | "average" | "expert"; winRate: number };
};
```

## EconomyDefinition: `economy.json`

```ts
type EconomyDefinition = {
  schemaVersion: 1;
  items: Array<{ id: Id; kind: "soft_currency" | "premium_currency" | "energy" | "booster" | "ticket" | "collectible";
                 nameKey: LocKey; icon: IconName; initial: number; cap?: number }>;
  energy?: { item: Id; max: number; regenSeconds: number; chargeOn: "start" | "loss"; refillCost: ItemBag };
  boosters: Array<{ id: Id; effect: "hint" | "undo" | "auto_place" | "add_moves" | "shuffle";
                    amount?: number; price: ItemBag; maxPerLevel?: number }>;
  levelRewards: { byStars: { "1": ItemBag; "2": ItemBag; "3": ItemBag };
                  tierMultiplier: Partial<Record<Tier, number>>; keystoneMultiplier: number };
  continue: { extraMoves: number; cost: ItemBag; costEscalation: number[]; maxContinues: number; rewardedAd: boolean };
  rewardTables: Record<Id, ItemBag>;
  dailyReward?: { days: ItemBag[]; resetOnMiss: boolean };          // P2
};
```

## ProgressionDefinition: `games/ID/progression.json`

```ts
type ProgressionDefinition = {
  schemaVersion: 1;
  unlockRule: "linear";
  replayCompleted: boolean;
  chapters: Array<{
    id: Id; titleKey: LocKey; subtitleKey?: LocKey;
    levels: { from: number; to: number };
    accent?: Color;
    unlock: { type: "previous_chapter" } | { type: "stars"; stars: number };
    completionReward?: Id | ItemBag;     // rewardTables id or inline bag
    storyIntro?: Id; storyOutro?: Id;    // story beat ids
  }>;
};
```

## CharacterDefinition: `games/ID/characters.json`

```ts
type CharactersFile = { schemaVersion: 1; characters: CharacterDefinition[] };
type CharacterDefinition = {
  id: Id; nameKey: LocKey; role: string; personality: string[];
  portrait: IconRef; color: Color;
  appearance: string;                 // art brief for the asset pipeline
  voice: string;                      // writing brief for dialogue generation
  relationships?: Array<{ characterId: Id; kind: "friend" | "family" | "rival" | "mentor"; note: string }>;
};
```

Story beats that use characters live in `story.json`:

```ts
type StoryFile = { schemaVersion: 1; beats: Array<{
  id: Id;
  trigger: { type: "chapter_start" | "chapter_complete"; chapter: Id } | { type: "level_complete"; level: number };
  lines: Array<{ speaker: Id | "narrator"; textKey: LocKey; emotion?: string }>;
}> };
```

## QuestDefinition: `games/ID/quests.json` (runtime in P2)

```ts
type QuestsFile = { schemaVersion: 1; quests: Array<{
  id: Id; titleKey: LocKey; descriptionKey: LocKey;
  type: "daily" | "weekly" | "story" | "achievement";
  objective: { event: DomainEvent; count: number; filter?: Record<string, string | number> };
  reward: Id | ItemBag;
  prerequisites?: Id[]; availableFromLevel?: number; expiresAfterHours?: number;
}> };
type DomainEvent = "level_completed" | "level_failed" | "category_completed" | "booster_used"
                 | "stars_earned" | "coins_spent" | "chapter_completed";
```

## EventDefinition: `games/ID/events.json` (runtime in P2)

```ts
type EventsFile = { schemaVersion: 1; events: Array<{
  id: Id; type: "race" | "collection" | "milestone" | "double_rewards";
  titleKey: LocKey; descriptionKey: LocKey;
  schedule: { start: string; end: string; recurrence: "none" | "weekly" };    // ISO 8601
  eligibility: { minLevel: number };
  points?: Partial<Record<DomainEvent, number>>;
  milestones?: Array<{ points: number; reward: Id | ItemBag }>;
  themeOverlay?: { palette?: Partial<Palette>; bannerAsset?: AssetKey };
  offers?: Id[];
}> };
```

## StoreDefinition: `store.json`

Real-money prices are never in configuration. The store returns localized prices at runtime.
`referencePriceUsd` exists only for the simulator and the development mock.

```ts
type StoreDefinition = {
  schemaVersion: 1;
  products: Array<{
    id: Id; type: "consumable" | "non_consumable" | "subscription";
    storeIds: { ios?: string; android?: string };
    titleKey: LocKey; contents: ItemBag; entitlements: Id[];      // e.g. ["no_ads"]
    referencePriceUsd: number; tags: string[];
  }>;
  offers: Array<{ id: Id; titleKey: LocKey; cost: ItemBag; contents: ItemBag; limitPerDay?: number }>;
  sections: Array<{ id: Id; titleKey: LocKey; entries: Array<{ product: Id } | { offer: Id }> }>;
  specialOffers: Array<{ id: Id; product: Id; trigger: { type: "level_reached"; level: number } | { type: "out_of_lives" };
                         durationHours: number; oncePerPlayer: boolean }>;   // runtime in P2
};
```

## Supporting schemas

| Schema | File | Purpose |
|---|---|---|
| `TemplateDefinition` | `templates/ID/template.json` | Core loop, supported mechanics, module defaults, required icons and sounds. |
| `MonetizationDefinition` | `monetization.json` | Rewarded and interstitial placements, frequency caps, banner screens, remove-ads entitlement. |
| `WordPack` | `content/word-packs/LOCALE/ID.json` | Categories with name, difficulty 1–5, tags and words. |
| `StringTable` | `localization/LOCALE.json` | `{ locale, strings: { key: text } }` with `{param}` placeholders. |
| `AnalyticsTaxonomy` | `analytics/events.json` | Event names, parameter types, required flags, common parameters. |
| `LevelGenConfig` | `games/ID/levelgen.json` | Difficulty curve by level range, content packs, generator parameters. |
| `RemotePayload` | `config/remote/ID.json` or an HTTPS URL | Overrides of `economy`, `monetization`, `store`, `tuning` and experiments, validated before activation. |
| `GameBundle` | generated | The compiled, resolved, validated runtime artifact (`bundleFormat: 1`). |

## Versioning policy

1. Adding an optional field with a default is a minor change. No version bump.
2. Renaming, removing or changing the meaning of a field bumps `schemaVersion` and adds a
   migration in the compiler (`engine/schemas/src/migrations`). Example: `game.json` 1 → 2 moved
   `platforms` out; a version 1 game without `release.json` still builds, with a warning.
3. `bundleFormat` changes only when the runtime contract changes. The app refuses bundles with an
   unknown format.
4. The save document has its own `saveVersion` and migrations, tested with fixtures of every
   shipped version.
