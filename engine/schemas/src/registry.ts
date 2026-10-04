import type { z } from "zod";
import { AnalyticsTaxonomy } from "./analytics";
import { AttemptRecord, AttemptVerdict, LeaderboardPage, PurchaseVerificationRequest, PurchaseVerificationResult } from "./api";
import { GameBundle } from "./bundle";
import { WordPack } from "./content";
import { EconomyDefinition } from "./economy";
import { GameDefinition } from "./game";
import { LeaderboardsFile } from "./leaderboards";
import { LevelGenConfig, LevelsFile } from "./level";
import { EventsFile } from "./liveops";
import { StringTable } from "./localization";
import { MonetizationDefinition } from "./monetization";
import { CharactersFile, StoryFile } from "./narrative";
import { ProgressionDefinition } from "./progression";
import { QuestsFile } from "./quests";
import { DeployDefaults, ReleaseDefinition, StoreListing } from "./release";
import { RemotePayload } from "./remote";
import { StoreDefinition } from "./store";
import { TemplateDefinition } from "./template";
import { ThemeDefinition } from "./theme";
import type { FileKind } from "./migrations";

export type SchemaEntry = { kind: FileKind | "bundle" | "api"; name: string; file: string; schema: z.ZodType };

/** Every authoring file kind and API payload, its schema and its conventional location. */
export const SCHEMA_REGISTRY: SchemaEntry[] = [
  { kind: "game", name: "game", file: "games/ID/game.json", schema: GameDefinition },
  { kind: "template", name: "template", file: "templates/ID/template.json", schema: TemplateDefinition },
  { kind: "theme", name: "theme", file: "themes/ID/theme.json", schema: ThemeDefinition },
  { kind: "levels", name: "levels", file: "games/ID/levels.json", schema: LevelsFile },
  { kind: "levelgen", name: "levelgen", file: "games/ID/levelgen.json", schema: LevelGenConfig },
  { kind: "economy", name: "economy", file: "economy.json", schema: EconomyDefinition },
  { kind: "progression", name: "progression", file: "games/ID/progression.json", schema: ProgressionDefinition },
  { kind: "characters", name: "characters", file: "games/ID/characters.json", schema: CharactersFile },
  { kind: "story", name: "story", file: "games/ID/story.json", schema: StoryFile },
  { kind: "quests", name: "quests", file: "games/ID/quests.json", schema: QuestsFile },
  { kind: "events", name: "events", file: "games/ID/events.json", schema: EventsFile },
  { kind: "store", name: "store", file: "store.json", schema: StoreDefinition },
  { kind: "monetization", name: "monetization", file: "monetization.json", schema: MonetizationDefinition },
  { kind: "leaderboards", name: "leaderboards", file: "leaderboards.json", schema: LeaderboardsFile },
  { kind: "wordpack", name: "wordpack", file: "content/word-packs/LOCALE/ID.json", schema: WordPack },
  { kind: "strings", name: "strings", file: "localization/LOCALE.json", schema: StringTable },
  { kind: "analytics", name: "analytics", file: "analytics/events.json", schema: AnalyticsTaxonomy },
  { kind: "remote", name: "remote", file: "config/remote/ID.json", schema: RemotePayload },
  { kind: "release", name: "release", file: "games/ID/release.json", schema: ReleaseDefinition },
  { kind: "deploy", name: "deploy", file: "deploy/PLATFORM/defaults.json", schema: DeployDefaults },
  { kind: "listing", name: "store-listing", file: "games/ID/store/LOCALE.json", schema: StoreListing },
  { kind: "bundle", name: "bundle", file: "build/bundles/ID/bundle.json", schema: GameBundle },
  { kind: "api", name: "api.attempt-record", file: "POST /v1/attempts", schema: AttemptRecord },
  { kind: "api", name: "api.attempt-verdict", file: "POST /v1/attempts (response)", schema: AttemptVerdict },
  { kind: "api", name: "api.purchase-verification-request", file: "POST /v1/purchases/verify", schema: PurchaseVerificationRequest },
  { kind: "api", name: "api.purchase-verification-result", file: "POST /v1/purchases/verify (response)", schema: PurchaseVerificationResult },
  { kind: "api", name: "api.leaderboard-page", file: "GET /v1/leaderboards/{boardId}", schema: LeaderboardPage },
];
