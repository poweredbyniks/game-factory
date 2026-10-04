#!/usr/bin/env tsx
import { existsSync, readdirSync } from "node:fs";
import { parseArgs } from "node:util";
import { AppEnvironment, ThemeDefinition } from "@gf/schemas";
import { writeAppArt } from "./art/app-icons";
import { BUILD_PLATFORMS, planBuild, runBuild, type BuildPlatform } from "./build";
import { compileGame, writeCompiled } from "./compile";
import { Issues } from "./issues";
import { analyzeLevels, generateLevels } from "./levels";
import { readJson, rootPath } from "./paths";
import { exportSchemas } from "./schemas-export";
import { checkUniqueIdentities } from "./validate";

const HELP = `gf: Game Factory command line

  gf compile <game> [--app] [--deep]        validate and write build/bundles/<game>/bundle.json
                                            --app also writes engine/app/src/generated/*
  gf validate <game>|--all [--deep]         validate without writing; --deep solves every level
  gf levels generate <game> [--count N] [--analyze] [--runs N]
  gf levels analyze <game> [--runs N]       bot win rates for the committed levels
  gf simulate <game> [--players N] [--days N] [--seed S] [--json]
  gf create-game --template T --theme TH --name "Name" [--id ID] [--mechanic M]
                 [--ios-id com.studio.game] [--android-id com.studio.game] [--from GAME]
  gf assets icons <game>|--all [--force]    placeholder app icons, splash and favicon from the theme
  gf build <game> --platform ios|android|all --profile development|staging|production [--local] [--dry-run]
                                            release readiness checks, then EAS Build
  gf server-engine                          the engine as one script for the Java backend (GraalJS),
                                            plus shipped bundles and contract fixtures, in build/server-engine
  gf schemas export                         write schemas/*.schema.json
`;

function games(): string[] {
  return readdirSync(rootPath("games"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      app: { type: "boolean" },
      "inline-assets": { type: "boolean" },
      deep: { type: "boolean" },
      all: { type: "boolean" },
      count: { type: "string" },
      analyze: { type: "boolean" },
      runs: { type: "string" },
      players: { type: "string" },
      days: { type: "string" },
      seed: { type: "string" },
      json: { type: "boolean" },
      template: { type: "string" },
      theme: { type: "string" },
      name: { type: "string" },
      id: { type: "string" },
      mechanic: { type: "string" },
      from: { type: "string" },
      "ios-id": { type: "string" },
      "android-id": { type: "string" },
      force: { type: "boolean" },
      platform: { type: "string" },
      profile: { type: "string" },
      local: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, sub, arg] = positionals;
  const int = (v: string | undefined) => (v === undefined ? undefined : Number.parseInt(v, 10));

  if (!command || values.help) {
    console.log(HELP);
    return 0;
  }

  if (command === "compile" || command === "validate") {
    const targets = values.all ? games() : sub ? [sub] : [];
    if (targets.length === 0) throw new Error(`usage: gf ${command} <game>|--all`);
    let failed = 0;
    const releases: Array<{ gameId: string; release: ReturnType<typeof compileGame>["release"] }> = [];
    for (const gameId of targets) {
      const started = Date.now();
      const result = compileGame(gameId, { deep: values.deep ?? false });
      releases.push({ gameId, release: result.release });
      if (result.issues.list.length > 0) console.log(result.issues.format());
      const ok = result.issues.ok && result.bundle !== null;
      const stats = result.bundle ? `${result.bundle.levels.length} levels, hash ${result.bundle.build.contentHash}` : "no bundle";
      console.log(`${ok ? "✔" : "✖"} ${gameId}: ${stats}, ${result.issues.errors.length} errors, ${result.issues.warnings.length} warnings (${Date.now() - started} ms)`);
      if (!ok) failed += 1;
      else if (command === "compile") for (const file of writeCompiled(result, { app: values.app ?? false, inlineAssets: values["inline-assets"] ?? false })) console.log(`  wrote ${file}`);
    }
    if (values.all) {
      const identities = new Issues();
      checkUniqueIdentities(releases, identities);
      if (identities.list.length > 0) {
        console.log(identities.format());
        failed += 1;
      }
    }
    return failed > 0 ? 1 : 0;
  }

  if (command === "levels") {
    if (!arg) throw new Error("usage: gf levels generate|analyze <game>");
    const log = (line: string) => console.log(line);
    if (sub === "generate") {
      const { levels } = generateLevels(arg, { count: int(values.count), analyze: values.analyze ?? false, runs: int(values.runs), log });
      console.log(`✔ wrote games/${arg}/levels.json (${levels.length} levels)`);
      return 0;
    }
    if (sub === "analyze") {
      analyzeLevels(arg, { runs: int(values.runs), log });
      console.log(`✔ updated games/${arg}/levels.json analysis`);
      return 0;
    }
  }

  if (command === "simulate") {
    if (!sub) throw new Error("usage: gf simulate <game>");
    const { simulateGame, formatReport } = await import("./simulate");
    const report = await simulateGame(sub, { players: int(values.players), days: int(values.days), seed: values.seed });
    console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
    return report.flags.some((f) => f.severity === "error") ? 1 : 0;
  }

  if (command === "create-game") {
    const { createGame } = await import("./create-game");
    const result = await createGame({
      template: values.template ?? "",
      theme: values.theme ?? "",
      name: values.name ?? "",
      id: values.id,
      mechanic: values.mechanic,
      iosId: values["ios-id"],
      androidId: values["android-id"],
      from: values.from,
      log: (line) => console.log(line),
    });
    return result.ok ? 0 : 1;
  }

  if (command === "assets" && sub === "icons") {
    const targets = values.all ? games() : arg ? [arg] : [];
    if (targets.length === 0) throw new Error("usage: gf assets icons <game>|--all [--force]");
    for (const gameId of targets) {
      const gamePath = rootPath("games", gameId, "game.json");
      if (!existsSync(gamePath)) throw new Error(`unknown game "${gameId}"`);
      const game = readJson(gamePath) as { theme: string; mechanic: { id: string } };
      const theme = ThemeDefinition.parse(readJson(rootPath("themes", game.theme, "theme.json")));
      const { written, kept } = writeAppArt(rootPath("games", gameId), theme, game.mechanic.id, { force: values.force ?? false });
      console.log(`✔ ${gameId}: wrote ${written.join(", ") || "nothing"}${kept.length ? `; kept ${kept.join(", ")} (use --force to replace)` : ""}`);
    }
    return 0;
  }

  if (command === "build") {
    const platform = values.platform as BuildPlatform | undefined;
    const profile = AppEnvironment.safeParse(values.profile);
    if (!sub || !platform || !BUILD_PLATFORMS.includes(platform) || !profile.success) {
      throw new Error("usage: gf build <game> --platform ios|android|all --profile development|staging|production [--local] [--dry-run]");
    }
    const plan = planBuild(sub, platform, profile.data, { local: values.local ?? false, games: games() });
    for (const issue of plan.issues) console.log(`${issue.severity === "error" ? "✖" : "⚠"} ${issue.message}`);
    const env = Object.entries(plan.env).map(([k, v]) => `${k}=${v}`).join(" ");
    console.log(`${plan.issues.some((i) => i.severity === "error") ? "✖ not ready" : "✔ ready"}: (cd engine/app && ${env} ${plan.command.join(" ")})`);
    if (values["dry-run"]) return plan.issues.some((i) => i.severity === "error") ? 1 : 0;
    return runBuild(plan);
  }

  if (command === "server-engine") {
    const { buildServerEngine, writeServerFixtures } = await import("./server-engine/build");
    const manifest = await buildServerEngine();
    console.log(`✔ build/server-engine/${manifest.file}: engine ${manifest.engineVersion}, ${Object.entries(manifest.mechanics).map(([id, v]) => `${id}@${v}`).join(", ")}`);
    for (const file of await writeServerFixtures(games())) console.log(`  wrote ${file.slice(rootPath().length + 1)}`);
    return 0;
  }

  if (command === "schemas" && sub === "export") {
    for (const file of exportSchemas()) console.log(`wrote ${file}`);
    return 0;
  }

  console.log(HELP);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
