/**
 * Forward migrations for authoring files. Every file carries `schemaVersion`; the compiler calls
 * `migrateDocument` before validation so old game packages keep building.
 *
 * Add a migration when a field is renamed, removed or changes meaning, and bump the literal in
 * the schema. Never edit a shipped migration.
 */
export type FileKind =
  | "game" | "template" | "theme" | "levels" | "levelgen" | "economy" | "progression" | "characters"
  | "story" | "quests" | "events" | "store" | "monetization" | "wordpack" | "strings" | "analytics" | "remote"
  | "release" | "deploy" | "listing" | "leaderboards";

export type Migration = {
  kind: FileKind;
  from: number;
  to: number;
  describe: string;
  migrate: (doc: Record<string, unknown>) => Record<string, unknown>;
};

export const CURRENT_VERSION: Record<FileKind, number> = {
  game: 2, template: 1, theme: 1, levels: 1, levelgen: 1, economy: 1, progression: 1, characters: 1,
  story: 1, quests: 1, events: 1, store: 1, monetization: 1, wordpack: 1, strings: 1, analytics: 1, remote: 1,
  release: 1, deploy: 1, listing: 1, leaderboards: 1,
};

/**
 * Store-specific fields of a version 1 game.json, read before migration drops them. The compiler
 * turns them into a release definition when the game has no release.json yet.
 */
export type LegacyGamePlatforms = {
  ios?: { bundleId: string };
  android?: { package: string };
  remoteConfigUrl?: string;
};

export function legacyGamePlatforms(doc: unknown): LegacyGamePlatforms | null {
  if (typeof doc !== "object" || doc === null) return null;
  const d = doc as { schemaVersion?: unknown; platforms?: Record<string, unknown>; remoteConfig?: { url?: unknown } };
  if (d.schemaVersion !== 1) return null;
  const out: LegacyGamePlatforms = {};
  const ios = d.platforms?.ios as { bundleId?: unknown } | undefined;
  const android = d.platforms?.android as { package?: unknown } | undefined;
  if (typeof ios?.bundleId === "string") out.ios = { bundleId: ios.bundleId };
  if (typeof android?.package === "string") out.android = { package: android.package };
  if (typeof d.remoteConfig?.url === "string") out.remoteConfigUrl = d.remoteConfig.url;
  return out;
}

export const MIGRATIONS: Migration[] = [
  {
    kind: "game",
    from: 1,
    to: 2,
    describe: "platforms and remoteConfig.url moved to games/ID/release.json",
    migrate: (doc) => {
      const { platforms: _platforms, remoteConfig, ...rest } = doc as Record<string, unknown> & { remoteConfig?: Record<string, unknown> };
      if (!remoteConfig) return rest;
      const { url: _url, ...keep } = remoteConfig;
      return { ...rest, remoteConfig: keep };
    },
  },
];

export function migrateDocument(
  kind: FileKind,
  doc: unknown,
  migrations: readonly Migration[] = MIGRATIONS,
  current: number = CURRENT_VERSION[kind],
): unknown {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return doc;
  let out = doc as Record<string, unknown>;
  let version = typeof out.schemaVersion === "number" ? out.schemaVersion : current;
  if (version > current) {
    throw new Error(`${kind}: schemaVersion ${version} is newer than this engine supports (${current})`);
  }
  while (version < current) {
    const step = migrations.find((m) => m.kind === kind && m.from === version);
    if (!step) throw new Error(`${kind}: no migration from schemaVersion ${version}`);
    out = { ...step.migrate(out), schemaVersion: step.to };
    version = step.to;
  }
  return out;
}
