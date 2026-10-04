import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import type { AppEnvironment } from "@gf/schemas";
import { z } from "zod";
import { checkAppArt } from "./art/app-icons";
import { compileGame, writeCompiled, type CompileResult } from "./compile";
import { readJson, rootPath } from "./paths";

/**
 * gf build: release readiness checks, then EAS Build for one game. The selected game reaches the
 * build worker through GAME_ID (an EAS environment variable of the game's own EAS project) and the
 * app's eas-build-post-install hook, which compiles the bundle there; see docs/10-release-pipeline.md.
 */

export const BUILD_PLATFORMS = ["ios", "android", "all"] as const;
export type BuildPlatform = (typeof BUILD_PLATFORMS)[number];

/** Which platform services have real store or SDK implementations: engine/app/src/platform/capabilities.json. */
export const PlatformCapabilities = z.strictObject({
  $comment: z.string().optional(),
  iap: z.boolean(),
  ads: z.boolean(),
  consent: z.boolean(),
  analytics: z.boolean(),
  notifications: z.boolean(),
  backend: z.boolean(),
});
export type PlatformCapabilities = z.infer<typeof PlatformCapabilities>;

export function readCapabilities(): PlatformCapabilities {
  return PlatformCapabilities.parse(readJson(rootPath("engine", "app", "src", "platform", "capabilities.json")));
}

/** Store ids that can never ship: com.example is refused by Google Play, com.gamefactory is this repo's placeholder. */
const PLACEHOLDER_ID_PREFIXES = ["com.gamefactory.", "com.example."];

export type ReadinessIssue = { severity: "error" | "warning"; message: string };
export type CompiledGame = CompileResult & { gameId: string };

export function releaseReadiness(
  target: CompiledGame,
  profile: AppEnvironment,
  capabilities: PlatformCapabilities,
  others: readonly CompiledGame[] = [],
): ReadinessIssue[] {
  const out: ReadinessIssue[] = [];
  const strict = profile === "production";
  const add = (severity: ReadinessIssue["severity"], message: string) => out.push({ severity, message });
  const strictly = (message: string) => add(strict ? "error" : "warning", message);
  const { bundle, release, game } = target;
  if (!bundle || !release || !game || !target.issues.ok) {
    add("error", `${target.gameId} does not compile; run "gf validate ${target.gameId}"`);
    return out;
  }
  const modules = bundle.game.modules;

  if (!release.eas.projectId) {
    add("error", `release.json eas.projectId is missing: run "GAME_ID=${target.gameId} npx eas-cli init" in engine/app and copy the project id`);
  }
  for (const id of new Set([release.ios.bundleId, release.android.package])) {
    if (PLACEHOLDER_ID_PREFIXES.some((p) => id.startsWith(p))) {
      strictly(`store id "${id}" uses a placeholder prefix: set your organisation's prefix in deploy/*/defaults.json and release.json`);
    }
  }

  const services: Array<[boolean, keyof PlatformCapabilities, string]> = [
    [modules.iap, "iap", "in-app purchase adapter (StoreKit 2 / Play Billing)"],
    [modules.ads, "ads", "ads adapter (AdMob or AppLovin MAX)"],
    [modules.ads, "consent", "consent flow (UMP and App Tracking Transparency)"],
    [modules.notifications, "notifications", "notifications adapter"],
    [true, "analytics", "analytics adapter"],
  ];
  for (const [needed, capability, label] of services) {
    if (needed && !capabilities[capability]) strictly(`no real ${label} yet: a ${profile} build would use the development stand-in`);
  }
  const backendUrl = release.environments[profile].backendUrl;
  if (modules.leaderboards && profile !== "development" && !backendUrl) add("error", `leaderboards need environments.${profile}.backendUrl`);
  if (modules.iap && strict && !backendUrl) add("error", "production purchases are verified by the backend: set environments.production.backendUrl");
  if ((modules.leaderboards || (modules.iap && strict)) && !capabilities.backend) strictly("the backend client is not implemented yet");

  if (strict) {
    for (const locale of bundle.game.locales) {
      const listing = target.listings.find((l) => l.locale === locale);
      if (!listing) add("error", `no store listing for "${locale}": games/${target.gameId}/store/${locale}.json`);
      else if (JSON.stringify(listing).includes("TODO")) add("error", `the ${locale} store listing still contains TODO text`);
    }
    if (game.meta?.pitch.includes("TODO")) add("warning", "game.json meta.pitch still contains TODO text");
    if (!release.ios.ascAppId) add("warning", "ios.ascAppId is not set; store submission needs it");
  }
  for (const problem of checkAppArt(rootPath("games", target.gameId))) {
    if (problem.severity === "warning") add("warning", `assets/${problem.file}: ${problem.problem}`);
  }

  // Store spam rules (App Store 4.3, Google Play repetitive content) reject reskins of one app.
  for (const other of others) {
    if (other.gameId === target.gameId || !other.bundle || !other.game) continue;
    const reskin =
      other.bundle.template.templateId === bundle.template.templateId &&
      other.game.mechanic.id === game.mechanic.id &&
      isDeepStrictEqual(other.game.mechanic.rules ?? {}, game.mechanic.rules ?? {}) &&
      isDeepStrictEqual(other.bundle.game.modules, modules);
    if (reskin) {
      strictly(
        `differs from "${other.gameId}" only by theme and content. App Store guideline 4.3 and Google Play's repetitive-content ` +
          "policy reject reskins: change the mechanic or its rules, or the meta modules",
      );
    }
  }
  return out;
}

export type BuildPlan = {
  gameId: string;
  target: CompiledGame;
  platform: BuildPlatform;
  profile: AppEnvironment;
  issues: ReadinessIssue[];
  cwd: string;
  env: Record<string, string>;
  command: string[];
};

export function planBuild(gameId: string, platform: BuildPlatform, profile: AppEnvironment, opts: { local?: boolean; games?: string[] } = {}): BuildPlan {
  const compile = (id: string): CompiledGame => ({ ...compileGame(id, { deep: id === gameId }), gameId: id });
  const target = compile(gameId);
  const others = (opts.games ?? []).filter((id) => id !== gameId).map(compile);
  const issues = [
    ...target.issues.errors.map((i): ReadinessIssue => ({ severity: "error", message: `${i.where}: ${i.message}` })),
    ...releaseReadiness(target, profile, readCapabilities(), others),
  ];
  return {
    gameId,
    target,
    platform,
    profile,
    issues,
    cwd: rootPath("engine", "app"),
    env: { GAME_ID: gameId, APP_ENV: profile },
    command: ["npx", "--yes", "eas-cli@latest", "build", "--platform", platform, "--profile", profile, "--non-interactive", ...(opts.local ? ["--local"] : [])],
  };
}

/** Compiles the app bundle locally and runs the planned EAS build. Refuses when readiness reported errors. */
export function runBuild(plan: BuildPlan): number {
  if (plan.issues.some((i) => i.severity === "error")) return 1;
  writeCompiled(plan.target, { app: true });
  const [cmd, ...args] = plan.command;
  const result = spawnSync(cmd!, args, { cwd: plan.cwd, env: { ...process.env, ...plan.env }, stdio: "inherit" });
  return result.status ?? 1;
}
