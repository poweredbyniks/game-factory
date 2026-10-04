import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  AndroidPackage, DeployDefaults, GAME_SCHEMA_VERSION, GameDefinition, IosBundleId, ReleaseDefinition, StoreListing, TemplateDefinition,
  ThemeDefinition, type CharactersFile, type ProgressionDefinition, type StoryFile,
} from "@gf/schemas";
import { writeAppArt } from "./art/app-icons";
import { compileGame, writeCompiled } from "./compile";
import { generateLevels } from "./levels";
import { TOOLING } from "./mechanics";
import { readJson, rootPath, writeJson } from "./paths";

export type CreateGameOptions = {
  template: string;
  theme: string;
  name: string;
  id?: string;
  mechanic?: string;
  /** Store identities. Default: the deploy/PLATFORM/defaults.json prefix plus the game id. */
  iosId?: string;
  androidId?: string;
  /** Copy story, cast and strings from an existing game instead of scaffolding placeholders. */
  from?: string;
  log?: (line: string) => void;
};

export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/**
 * Scaffolds games/ID from a template and a theme, generates its levels, then compiles and deeply
 * validates it. The result is a playable game package with placeholder story text.
 */
export async function createGame(opts: CreateGameOptions): Promise<{ ok: boolean; gameId?: string }> {
  const log = opts.log ?? (() => undefined);
  const fail = (message: string) => {
    log(`✖ ${message}`);
    return { ok: false };
  };
  if (!opts.name || opts.name.length > 30) return fail("--name is required (30 characters at most)");
  const templateDir = rootPath("templates", opts.template);
  const themeDir = rootPath("themes", opts.theme);
  if (!existsSync(join(templateDir, "template.json"))) return fail(`unknown template "${opts.template}"`);
  if (!existsSync(join(themeDir, "theme.json"))) return fail(`unknown theme "${opts.theme}"`);
  const template = TemplateDefinition.parse(readJson(join(templateDir, "template.json")));
  ThemeDefinition.parse(readJson(join(themeDir, "theme.json")));
  const mechanic = opts.mechanic ?? template.mechanics.default;
  if (!template.mechanics.supported.includes(mechanic)) return fail(`template "${opts.template}" does not support mechanic "${mechanic}"`);
  if (!TOOLING[mechanic]) return fail(`mechanic "${mechanic}" is not registered in tools/src/mechanics.ts`);
  const levelgenTemplate = join(templateDir, "defaults", `levelgen.${mechanic}.json`);
  if (!existsSync(levelgenTemplate)) return fail(`template has no default level curve for "${mechanic}" (${levelgenTemplate})`);

  const gameId = opts.id ?? slugify(opts.name);
  const gameDir = rootPath("games", gameId);
  if (existsSync(gameDir)) return fail(`games/${gameId} already exists`);

  // Store identity: explicit flags, else the organisation prefix from deploy/ plus the game id.
  const segment = gameId.replace(/[^a-z0-9]/g, "");
  const appSegment = /^[a-z]/.test(segment) ? segment : `g${segment}`;
  const prefix = (platform: "ios" | "android") => DeployDefaults.parse(readJson(rootPath("deploy", platform, "defaults.json"))).idPrefix;
  const iosId = opts.iosId ?? `${prefix("ios")}.${appSegment}`;
  const androidId = opts.androidId ?? `${prefix("android")}.${appSegment}`;
  if (!IosBundleId.safeParse(iosId).success) return fail(`--ios-id "${iosId}" is not a valid bundle id (reverse DNS, e.g. com.studio.game)`);
  if (!AndroidPackage.safeParse(androidId).success) {
    return fail(`--android-id "${androidId}" is not a valid package (lowercase reverse DNS; every segment starts with a letter)`);
  }
  for (const other of readdirSync(rootPath("games"))) {
    const path = rootPath("games", other, "release.json");
    if (!existsSync(path)) continue;
    const taken = readJson(path) as { ios?: { bundleId?: string }; android?: { package?: string } };
    if (taken.ios?.bundleId === iosId || taken.android?.package === androidId) return fail(`store ids are already used by games/${other}`);
  }

  if (opts.from) {
    const source = rootPath("games", opts.from);
    if (!existsSync(source)) return fail(`unknown source game "${opts.from}"`);
    // Never copy another game's levels, store identity, listing or art.
    const skip = ["levels.json", "levelgen.json", "release.json", "store", "assets"];
    cpSync(source, gameDir, { recursive: true, filter: (src) => !skip.includes(relative(source, src).split(sep)[0] ?? "") });
    log(`copied story, cast and strings from games/${opts.from}`);
  }

  const game: GameDefinition = GameDefinition.parse({
    $schema: "../../schemas/game.schema.json",
    schemaVersion: GAME_SCHEMA_VERSION,
    gameId,
    name: opts.name,
    version: "0.1.0",
    template: opts.template,
    theme: opts.theme,
    mechanic: { id: mechanic },
    modules: {},
    content: { locales: ["en"], defaultLocale: "en", packs: mechanic === "associations" ? ["core_en"] : [] },
    meta: { pitch: `TODO: one-sentence pitch for ${opts.name}.`, tags: [] },
  });
  writeJson(join(gameDir, "game.json"), game, false);
  const release = { $schema: "../../schemas/release.schema.json", schemaVersion: 1, ios: { bundleId: iosId }, android: { package: androidId } };
  ReleaseDefinition.parse(release);
  writeJson(join(gameDir, "release.json"), release, false);
  const listing = StoreListing.parse({
    $schema: "../../../schemas/store-listing.schema.json",
    schemaVersion: 1,
    locale: "en",
    title: opts.name,
    subtitle: "TODO: subtitle",
    shortDescription: "TODO: one line for Google Play",
    description: `TODO: describe ${opts.name} for the stores.`,
    keywords: [],
  });
  writeJson(join(gameDir, "store", "en.json"), listing, false);
  const art = writeAppArt(gameDir, ThemeDefinition.parse(readJson(join(themeDir, "theme.json"))), mechanic);
  log(`store ids: ios ${iosId}, android ${androidId}; placeholder icons: ${art.written.join(", ")}`);

  const levelgen = readJson(levelgenTemplate) as Record<string, unknown>;
  writeJson(join(gameDir, "levelgen.json"), { ...levelgen, $schema: "../../schemas/levelgen.schema.json", seed: `${gameId}-v1` }, false);

  if (!opts.from) {
    const progression = readJson(join(templateDir, "defaults", "progression.json")) as ProgressionDefinition;
    writeJson(join(gameDir, "progression.json"), { ...progression, $schema: "../../schemas/progression.schema.json" }, false);
    const characters: CharactersFile = { schemaVersion: 1, characters: [] };
    writeJson(join(gameDir, "characters.json"), { $schema: "../../schemas/characters.schema.json", ...characters }, false);
    const story: StoryFile = {
      schemaVersion: 1,
      beats: progression.chapters
        .filter((c) => c.storyIntro)
        .map((c) => ({ id: c.storyIntro!, trigger: { type: "chapter_start" as const, chapter: c.id }, lines: [{ speaker: "narrator", textKey: `story.${c.storyIntro}.1` }] })),
    };
    writeJson(join(gameDir, "story.json"), { $schema: "../../schemas/story.schema.json", ...story }, false);
    const strings: Record<string, string> = {};
    progression.chapters.forEach((c, i) => {
      strings[c.titleKey] = `Chapter ${i + 1}`;
      if (c.subtitleKey) strings[c.subtitleKey] = "TODO: chapter subtitle";
      if (c.storyIntro) strings[`story.${c.storyIntro}.1`] = `TODO: opening line for chapter ${i + 1} of ${opts.name}.`;
    });
    writeJson(join(gameDir, "localization", "en.json"), { $schema: "../../../schemas/strings.schema.json", schemaVersion: 1, locale: "en", strings }, false);
  }
  log(`scaffolded games/${gameId}: ${readdirSync(gameDir).sort().join(", ")}`);

  try {
    log("generating levels…");
    const { levels } = generateLevels(gameId, { log: (line) => log(`  ${line}`) });
    log(`generated ${levels.length} levels`);
  } catch (error) {
    rmSync(gameDir, { recursive: true, force: true });
    return fail(`level generation failed, games/${gameId} was removed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = compileGame(gameId, { deep: true });
  if (result.issues.list.length > 0) log(result.issues.format());
  if (!result.bundle || !result.issues.ok) return fail(`games/${gameId} was created but does not validate yet; fix the issues above`);
  for (const file of writeCompiled(result)) log(`wrote ${file}`);
  log(`✔ created ${gameId}. Next: edit games/${gameId}/localization/en.json and store/en.json, replace assets/*.png with final art,`);
  log(`  then run "GAME_ID=${gameId} npm run dev". Release checks: "gf build ${gameId} --platform all --profile production --dry-run".`);
  return { ok: true, gameId };
}
