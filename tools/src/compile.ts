import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { LevelSession, cyrb128, deepMerge, stableStringify } from "@gf/core";
import {
  AnalyticsTaxonomy, BUNDLE_FORMAT, CharactersFile, DeployDefaults, EconomyDefinition, EventsFile, GameBundle, GameDefinition,
  LeaderboardsFile, LevelsFile, MonetizationDefinition, ProgressionDefinition, QuestsFile, ReleaseDefinition, StoreDefinition,
  StoreListing, StoryFile, StringTable, TemplateDefinition, ThemeDefinition, Tuning, WordPack, legacyGamePlatforms,
  migrateDocument, wordId, type FileKind, type LegacyGamePlatforms, type ResolvedAsset,
} from "@gf/schemas";
import type { z } from "zod";
import { checkAppArt } from "./art/app-icons";
import { Issues } from "./issues";
import { TOOLING } from "./mechanics";
import { ROOT, readJson, rootPath, writeJson, writeText } from "./paths";
import { crossValidate, validateRelease } from "./validate";

export type AssetModule = { key: string; type: "font" | "audio" | "image"; file: string };
export type CompileOptions = { deep?: boolean; maxSolverNodes?: number };
export type CompileResult = {
  bundle: GameBundle | null;
  assets: AssetModule[];
  issues: Issues;
  template: TemplateDefinition | null;
  game: GameDefinition | null;
  /** Store identity and endpoints: deploy/PLATFORM/defaults.json merged with games/ID/release.json. */
  release: ReleaseDefinition | null;
  listings: StoreListing[];
};

const rel = (path: string) => relative(ROOT, path);

function stripSchemaKey<T extends object>(value: T): T {
  const { $schema: _ignored, ...rest } = value as T & { $schema?: string };
  return rest as T;
}

function readOptional(path: string): Record<string, unknown> | undefined {
  return existsSync(path) ? (readJson(path) as Record<string, unknown>) : undefined;
}

function zodIssues(issues: Issues, where: string, error: z.ZodError): void {
  for (const issue of error.issues) issues.error(`${where}${issue.path.length ? `#${issue.path.join(".")}` : ""}`, issue.message);
}

function load<S extends z.ZodType>(issues: Issues, kind: FileKind, path: string, schema: S, required: boolean): z.infer<S> | undefined {
  if (!existsSync(path)) {
    if (required) issues.error(rel(path), "file is missing");
    return undefined;
  }
  let raw: unknown;
  try {
    raw = migrateDocument(kind, readJson(path));
  } catch (error) {
    issues.error(rel(path), String(error));
    return undefined;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    zodIssues(issues, rel(path), parsed.error);
    return undefined;
  }
  return parsed.data;
}

function parseMerged<S extends z.ZodType>(issues: Issues, where: string, schema: S, layers: unknown[]): z.infer<S> | undefined {
  const merged = layers.reduce<unknown>((acc, layer) => (layer === undefined ? acc : deepMerge(acc, layer)), {});
  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    zodIssues(issues, where, parsed.error);
    return undefined;
  }
  return parsed.data;
}

export function hashHex(text: string): string {
  return cyrb128(text).map((n) => n.toString(16).padStart(8, "0")).join("").slice(0, 16);
}

function resolveAssetFile(themeDir: string, file: string): string {
  return file.startsWith("@shared/") ? rootPath("assets", "shared", file.slice("@shared/".length)) : join(themeDir, file);
}

/**
 * Release configuration: factory-wide store policy (deploy/ios, deploy/android) under the game's
 * release.json. A version 1 game.json without release.json still builds from its old platforms.
 */
function loadRelease(issues: Issues, gameId: string, legacy: LegacyGamePlatforms | null): ReleaseDefinition | undefined {
  const defaults = (["ios", "android"] as const).map((platform) => {
    const path = rootPath("deploy", platform, "defaults.json");
    const file = load(issues, "deploy", path, DeployDefaults, true);
    if (file && file.platform !== platform) issues.error(rel(path), `declares platform "${file.platform}"`);
    return file?.release;
  });
  const path = rootPath("games", gameId, "release.json");
  let layer: unknown = existsSync(path) ? migrateDocument("release", readJson(path)) : undefined;
  if (layer === undefined) {
    if (!legacy?.ios || !legacy.android) {
      issues.error(rel(path), "file is missing: store identity lives in release.json");
      return undefined;
    }
    issues.warn(rel(path), "missing; using the platforms of the version 1 game.json. Move them into release.json");
    const endpoints = legacy.remoteConfigUrl ? { remoteConfigUrl: legacy.remoteConfigUrl } : {};
    layer = {
      schemaVersion: 1,
      ios: legacy.ios,
      android: legacy.android,
      environments: { development: endpoints, staging: endpoints, production: endpoints },
    };
  }
  return parseMerged(issues, `${rel(path)} (deploy defaults + game)`, ReleaseDefinition, [{ ios: defaults[0], android: defaults[1] }, layer]);
}

export function compileGame(gameId: string, opts: CompileOptions = {}): CompileResult {
  const issues = new Issues();
  const gameDir = rootPath("games", gameId);
  const fail = (): CompileResult => ({ bundle: null, assets: [], issues, template: null, game: null, release: null, listings: [] });

  const gamePath = join(gameDir, "game.json");
  const legacy = existsSync(gamePath) ? legacyGamePlatforms(readJson(gamePath)) : null;
  if (legacy) issues.warn(rel(gamePath), "schemaVersion 1 is migrated on the fly; move platforms to release.json and set schemaVersion 2");
  const game = load(issues, "game", gamePath, GameDefinition, true);
  if (!game) return fail();
  if (game.gameId !== gameId) issues.error(`games/${gameId}/game.json`, `gameId "${game.gameId}" does not match the folder name`);
  const release = loadRelease(issues, gameId, legacy);
  const listings: StoreListing[] = [];
  for (const locale of game.content.locales) {
    const path = join(gameDir, "store", `${locale}.json`);
    if (!existsSync(path)) {
      issues.warn(rel(path), "no store listing for this locale (required for release)");
      continue;
    }
    const listing = load(issues, "listing", path, StoreListing, true);
    if (listing && listing.locale !== locale) issues.error(rel(path), `declares locale "${listing.locale}"`);
    if (listing) listings.push(listing);
  }
  for (const problem of checkAppArt(gameDir)) {
    const where = `games/${gameId}/assets/${problem.file}`;
    if (problem.severity === "error") issues.error(where, problem.problem);
  }

  const templateDir = rootPath("templates", game.template);
  const themeDir = rootPath("themes", game.theme);
  const template = load(issues, "template", join(templateDir, "template.json"), TemplateDefinition, true);
  const theme = load(issues, "theme", join(themeDir, "theme.json"), ThemeDefinition, true);
  const progression = load(issues, "progression", join(gameDir, "progression.json"), ProgressionDefinition, true);
  const levelsFile = load(issues, "levels", join(gameDir, "levels.json"), LevelsFile, true);
  const characters = load(issues, "characters", join(gameDir, "characters.json"), CharactersFile, false);
  const story = load(issues, "story", join(gameDir, "story.json"), StoryFile, false);
  const quests = load(issues, "quests", join(gameDir, "quests.json"), QuestsFile, false);
  const events = load(issues, "events", join(gameDir, "events.json"), EventsFile, false);
  const analytics = load(issues, "analytics", rootPath("analytics", "events.json"), AnalyticsTaxonomy, true);

  const economy = parseMerged(issues, "economy (template defaults + game)", EconomyDefinition, [
    readOptional(join(templateDir, "defaults", "economy.json")),
    readOptional(join(gameDir, "economy.json")),
    game.overrides?.economy,
  ]);
  const store = parseMerged(issues, "store (template defaults + game)", StoreDefinition, [
    readOptional(join(templateDir, "defaults", "store.json")),
    readOptional(join(gameDir, "store.json")),
    game.overrides?.store,
  ]);
  const monetization = parseMerged(issues, "monetization (shared + template + game)", MonetizationDefinition, [
    readOptional(rootPath("monetization", "defaults.json")),
    readOptional(join(templateDir, "defaults", "monetization.json")),
    readOptional(join(gameDir, "monetization.json")),
    game.overrides?.monetization,
  ]);
  const leaderboardLayers = [readOptional(join(templateDir, "defaults", "leaderboards.json")), readOptional(join(gameDir, "leaderboards.json"))];
  const leaderboards = leaderboardLayers.some((l) => l !== undefined)
    ? parseMerged(issues, "leaderboards (template defaults + game)", LeaderboardsFile, leaderboardLayers)
    : { boards: [] };
  if (!template || !theme || !progression || !levelsFile || !analytics || !economy || !store || !monetization || !leaderboards) {
    return { ...fail(), template: template ?? null, game };
  }
  for (const file of template.requiredGameFiles) {
    if (file === "release.json" && legacy) continue; // reported above
    if (!existsSync(join(gameDir, file))) issues.error(`games/${gameId}/${file}`, `template "${template.templateId}" requires this file`);
  }

  const modules = { ...template.modules, ...game.modules };
  if (modules.story && !story) issues.error(`games/${gameId}/story.json`, "the story module is enabled but story.json is missing");

  // Levels: mechanic payloads, structural validation, optional deep solve.
  const contentKeys = new Set<string>();
  for (const level of levelsFile.levels) {
    const where = `levels.json#${level.levelId}`;
    const tooling = TOOLING[level.mechanic];
    if (!tooling) {
      issues.error(where, `no mechanic named "${level.mechanic}" is registered`);
      continue;
    }
    if (level.mechanic !== game.mechanic.id) issues.error(where, `mechanic "${level.mechanic}" differs from the game's "${game.mechanic.id}"`);
    const parsed = tooling.mechanic.levelDataSchema.safeParse(level.data);
    if (!parsed.success) {
      zodIssues(issues, `${where}.data`, parsed.error);
      continue;
    }
    for (const problem of tooling.mechanic.validateLevel(parsed.data)) issues.error(where, problem);
    for (const key of tooling.contentKeys(parsed.data)) contentKeys.add(key);
    if (opts.deep && tooling.mechanic.solve) {
      const solution = tooling.mechanic.solve(parsed.data, { maxNodes: opts.maxSolverNodes ?? 150_000 });
      if (!solution.solved) {
        issues.error(where, `impossible level: the solver found no solution in ${solution.nodes} nodes`);
      } else {
        const session = new LevelSession(tooling.mechanic, level, parsed.data, "validate", 0);
        for (const action of solution.actions) session.act(action);
        if (session.status() !== "won") issues.error(where, `the solver's solution does not win within the budget (${session.status()})`);
      }
    }
  }

  // Strings: shared < template < game < content packs (only keys the levels use).
  const strings: Record<string, Record<string, string>> = {};
  for (const locale of game.content.locales) {
    const tables = [
      rootPath("localization", `${locale}.json`),
      join(templateDir, "defaults", "localization", `${locale}.json`),
      join(gameDir, "localization", `${locale}.json`),
    ].map((path) => load(issues, "strings", path, StringTable, false));
    const merged: Record<string, string> = {};
    for (const table of tables) {
      if (table && table.locale !== locale) issues.error(`localization ${locale}`, `table declares locale "${table.locale}"`);
      Object.assign(merged, table?.strings ?? {});
    }
    const content: Record<string, string> = {};
    for (const packId of game.content.packs) {
      const pack = load(issues, "wordpack", rootPath("content", "word-packs", locale, `${packId}.json`), WordPack, true);
      for (const category of pack?.categories ?? []) {
        content[`content.cat.${category.id}`] = category.name;
        for (const word of category.words) content[`content.word.${wordId(category.id, word)}`] = word;
      }
    }
    for (const key of [...contentKeys].sort()) {
      const text = content[key];
      if (text === undefined) issues.error(`content ${locale}`, `level content "${key}" has no text in this locale`);
      else merged[key] = text;
    }
    strings[locale] = merged;
  }

  // Theme assets: inline SVG, register binary files for the app's asset registry.
  const assets: AssetModule[] = [];
  const resolvedAssets: Record<string, ResolvedAsset> = {};
  for (const [key, spec] of Object.entries(theme.assets)) {
    const file = resolveAssetFile(themeDir, spec.file);
    if (!existsSync(file)) {
      issues.error(`themes/${game.theme}#assets.${key}`, `missing file ${rel(file)}`);
      continue;
    }
    if (spec.type === "svg") {
      const xml = readFileSync(file, "utf8");
      if (!xml.includes("<svg")) issues.error(`themes/${game.theme}#assets.${key}`, "not an SVG document");
      resolvedAssets[key] = { type: "svg", xml };
    } else {
      assets.push({ key, type: spec.type, file });
      if (spec.type === "font") resolvedAssets[key] = { type: "font", module: key, family: spec.family };
      else if (spec.type === "audio") resolvedAssets[key] = { type: "audio", module: key, volume: spec.volume };
      else resolvedAssets[key] = { type: "image", module: key, ...(spec.width ? { width: spec.width } : {}), ...(spec.height ? { height: spec.height } : {}) };
    }
  }

  const { assets: _authoringAssets, ...themeRest } = stripSchemaKey(theme);
  const engineVersion = (readJson(rootPath("engine", "core", "package.json")) as { version: string }).version;
  const draft = {
    bundleFormat: BUNDLE_FORMAT,
    build: { gameId, gameVersion: game.version, engineVersion, contentHash: "" },
    game: {
      gameId,
      name: game.name,
      version: game.version,
      template: game.template,
      theme: game.theme,
      mechanic: game.mechanic.id,
      modules,
      defaultLocale: game.content.defaultLocale,
      locales: game.content.locales,
    },
    template: { templateId: template.templateId, coreLoop: template.coreLoop, ui: template.ui },
    theme: { ...themeRest, assets: resolvedAssets },
    economy: stripSchemaKey(economy),
    progression: stripSchemaKey(progression),
    levels: levelsFile.levels,
    characters: characters?.characters ?? [],
    story: story?.beats ?? [],
    store: stripSchemaKey(store),
    monetization: stripSchemaKey(monetization),
    quests: quests?.quests ?? [],
    events: events?.events ?? [],
    leaderboards: leaderboards.boards,
    analytics: stripSchemaKey(analytics),
    tuning: Tuning.parse({ difficulty: {}, features: {} }),
    remote: { refreshHours: game.remoteConfig?.refreshHours ?? 12 },
    strings,
  };
  draft.build.contentHash = hashHex(stableStringify(draft));
  const parsed = GameBundle.safeParse(draft);
  if (!parsed.success) {
    zodIssues(issues, "bundle", parsed.error);
    return { bundle: null, assets, issues, template, game, release: release ?? null, listings };
  }
  crossValidate(parsed.data, template, issues);
  if (release) validateRelease(parsed.data, release, issues);
  return { bundle: parsed.data, assets, issues, template, game, release: release ?? null, listings };
}

const MIME: Record<string, string> = {
  ".ttf": "font/ttf", ".otf": "font/otf", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4",
  ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg",
};

/**
 * Writes build/bundles/ID/bundle.json and, for the app, src/generated/{bundle.json, assets.ts, game.ts}.
 * inlineAssets embeds binary assets as data URIs instead of require() calls, for single-file web builds.
 */
export function writeCompiled(result: CompileResult, opts: { app?: boolean; inlineAssets?: boolean } = {}): string[] {
  if (!result.bundle) throw new Error("cannot write a failed compilation");
  const bundle = result.bundle;
  const written: string[] = [];
  const out = rootPath("build", "bundles", bundle.game.gameId, "bundle.json");
  writeText(out, JSON.stringify(bundle));
  written.push(rel(out));
  if (opts.app) {
    const dir = rootPath("engine", "app", "src", "generated");
    writeJson(join(dir, "bundle.json"), bundle, false);
    const req = (file: string) => {
      if (!opts.inlineAssets) return `require(${JSON.stringify(relative(dir, file).split("\\").join("/"))})`;
      const mime = MIME[file.slice(file.lastIndexOf(".")).toLowerCase()] ?? "application/octet-stream";
      return `{ uri: ${JSON.stringify(`data:${mime};base64,${readFileSync(file).toString("base64")}`)} }`;
    };
    const group = (type: AssetModule["type"]) =>
      result.assets
        .filter((a) => a.type === type)
        .map((a) => `  ${JSON.stringify(a.key)}: ${req(a.file)},`)
        .join("\n");
    writeText(
      join(dir, "assets.ts"),
      `// GENERATED by "gf compile ${bundle.game.gameId} --app". Do not edit.\n` +
        `/* eslint-disable @typescript-eslint/no-require-imports */\n` +
        `export type AssetModule = number | { uri: string };\n\n` +
        `export const fontModules: Record<string, AssetModule> = {\n${group("font")}\n};\n\n` +
        `export const audioModules: Record<string, AssetModule> = {\n${group("audio")}\n};\n\n` +
        `export const imageModules: Record<string, AssetModule> = {\n${group("image")}\n};\n`,
    );
    if (result.release) {
      const { $schema: _schema, ...release } = result.release;
      writeJson(join(dir, "release.json"), release, false);
      written.push(rel(join(dir, "release.json")));
    }
    writeText(
      join(dir, "game.ts"),
      `// GENERATED by "gf compile ${bundle.game.gameId} --app". Do not edit.\n` +
        `export const GAME_ID = ${JSON.stringify(bundle.game.gameId)};\n` +
        `export const CONTENT_HASH = ${JSON.stringify(bundle.build.contentHash)};\n`,
    );
    written.push(rel(join(dir, "bundle.json")), rel(join(dir, "assets.ts")), rel(join(dir, "game.ts")));
  }
  return written;
}
