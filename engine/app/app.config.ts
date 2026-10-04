/// <reference types="node" />
import type { ConfigContext, ExpoConfig } from "expo/config";
import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * One app shell, many store apps. GAME_ID selects the game. Its game.json, theme, release
 * configuration (deploy/PLATFORM/defaults.json under games/ID/release.json) and assets/ drive the
 * native identity; ios/ and android/ are generated from this file and never committed.
 *
 * Reads plain JSON on purpose: EAS evaluates this file before workspace packages are usable.
 * "gf validate" checks the same files against the zod schemas.
 */
const ROOT = join(__dirname, "..", "..");
type Json = Record<string, any>;
const readJson = (...parts: string[]): Json => JSON.parse(readFileSync(join(ROOT, ...parts), "utf8"));
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Objects deep-merge, arrays replace: the compiler's rule. */
function merge(base: unknown, over: unknown): unknown {
  if (!isObject(base) || !isObject(over)) return over === undefined ? base : over;
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(over)) out[key] = merge(base[key], value);
  return out;
}

function selectedGame(): string {
  if (process.env.GAME_ID) return process.env.GAME_ID;
  if (process.env.EAS_BUILD) {
    throw new Error("GAME_ID is not set: define it as an environment variable of this game's EAS project (docs/10-release-pipeline.md)");
  }
  const generated = join(__dirname, "src", "generated", "game.ts");
  const match = existsSync(generated) ? readFileSync(generated, "utf8").match(/GAME_ID = "([^"]+)"/) : null;
  if (match?.[1]) return match[1];
  throw new Error('No game selected: set GAME_ID or run "npm run gf -- compile <game> --app"');
}

const ENVIRONMENTS = ["development", "staging", "production"];

export default ({ config }: ConfigContext): ExpoConfig => {
  const gameId = selectedGame();
  const environment = process.env.APP_ENV ?? "development";
  if (!ENVIRONMENTS.includes(environment)) throw new Error(`APP_ENV must be one of ${ENVIRONMENTS.join(", ")}, got "${environment}"`);
  const game = readJson("games", gameId, "game.json");
  const theme = readJson("themes", game.theme, "theme.json");
  if (!existsSync(join(ROOT, "games", gameId, "release.json"))) throw new Error(`games/${gameId}/release.json is missing`);
  const release = merge(
    { ios: readJson("deploy", "ios", "defaults.json").release, android: readJson("deploy", "android", "defaults.json").release },
    readJson("games", gameId, "release.json"),
  ) as Json;
  const art = (file: string): string => {
    const path = join(ROOT, "games", gameId, "assets", file);
    if (!existsSync(path)) throw new Error(`games/${gameId}/assets/${file} is missing: run "npm run gf -- assets icons ${gameId}"`);
    return relative(__dirname, path);
  };
  const projectId: string | undefined = release.eas?.projectId;

  return {
    ...config,
    name: game.name,
    slug: `gf-${gameId.replace(/_/g, "-")}`,
    ...(release.eas?.owner ? { owner: release.eas.owner } : {}),
    version: game.version,
    orientation: "portrait",
    userInterfaceStyle: "light",
    icon: art("icon.png"),
    backgroundColor: theme.palette.background,
    ios: {
      bundleIdentifier: release.ios.bundleId,
      supportsTablet: release.ios.supportsTablet ?? false,
      config: { usesNonExemptEncryption: release.ios.usesNonExemptEncryption ?? false },
    },
    android: {
      package: release.android.package,
      adaptiveIcon: {
        foregroundImage: art("adaptive-icon.png"),
        monochromeImage: art("adaptive-icon-monochrome.png"),
        backgroundColor: theme.palette.primary,
      },
      blockedPermissions: release.android.blockedPermissions ?? [],
      predictiveBackGestureEnabled: false,
    },
    web: { favicon: art("favicon.png"), name: game.name, backgroundColor: theme.palette.background },
    plugins: [
      "expo-font",
      // Sound effects only. Background audio or a microphone would need justifying to both stores
      // (App Store guideline 2.5.4, Play's foreground-service policy), so both stay off.
      ["expo-audio", { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: false, enableBackgroundRecording: false }],
      ["expo-splash-screen", { image: art("splash.png"), imageWidth: 200, resizeMode: "contain", backgroundColor: theme.palette.background }],
    ],
    extra: { gameId, theme: game.theme, environment, ...(projectId ? { eas: { projectId } } : {}) },
  };
};
