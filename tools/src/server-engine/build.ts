import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifyAttempt } from "@gf/core";
import type { AttemptRecord } from "@gf/schemas";
import { build } from "esbuild";
import { compileGame } from "../compile";
import { goldenAttempts } from "../golden";
import { readJson, rootPath } from "../paths";
import { SERVER_MECHANICS } from "./mechanics";

export type ServerEngineManifest = {
  engineVersion: string;
  mechanics: Record<string, string>;
  file: string;
  sha256: string;
};

/** Bundles the engine into one script for GraalJS: ECMAScript only, no imports at runtime. */
export async function buildServerEngine(outDir = rootPath("build", "server-engine")): Promise<ServerEngineManifest> {
  mkdirSync(outDir, { recursive: true });
  const engineVersion = (readJson(rootPath("engine", "core", "package.json")) as { version: string }).version;
  const file = join(outDir, "gf-engine.js");
  await build({
    entryPoints: [rootPath("tools", "src", "server-engine", "entry.ts")],
    outfile: file,
    bundle: true,
    format: "iife",
    platform: "neutral",
    mainFields: ["module", "main"],
    target: "es2022",
    legalComments: "none",
    logLevel: "silent",
    define: { __GF_ENGINE_VERSION__: JSON.stringify(engineVersion) },
  });
  const manifest: ServerEngineManifest = {
    engineVersion,
    mechanics: Object.fromEntries(Object.entries(SERVER_MECHANICS).map(([id, m]) => [id, m.version])),
    file: "gf-engine.js",
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
  };
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export type FixtureCase = { name: string; attempt: unknown; payload: unknown; verdict: unknown };

/**
 * Contract fixtures for the Java backend's tests: real attempts from the golden playthrough plus
 * forged ones, each with the verdict the TypeScript engine gives. The Java test suite evaluates the
 * same cases through GraalJS and must get identical verdicts.
 */
export async function writeServerFixtures(gameIds: string[], outDir = rootPath("build", "server-engine")): Promise<string[]> {
  const written: string[] = [];
  mkdirSync(join(outDir, "bundles"), { recursive: true });
  mkdirSync(join(outDir, "fixtures"), { recursive: true });
  for (const gameId of gameIds) {
    const { bundle } = compileGame(gameId);
    if (!bundle) throw new Error(`${gameId} does not compile`);
    const bundlePath = join(outDir, "bundles", `${bundle.build.contentHash}.json`);
    writeFileSync(bundlePath, JSON.stringify(bundle));
    const attempts = await goldenAttempts(bundle);
    const forged = (name: string, change: (a: AttemptRecord) => void): [string, AttemptRecord] => {
      const copy = JSON.parse(JSON.stringify(attempts[0])) as AttemptRecord;
      change(copy);
      return [name, copy];
    };
    const inputs: Array<[string, AttemptRecord]> = [
      ...attempts.map((a): [string, AttemptRecord] => [`golden ${a.levelId}`, a]),
      forged("move after the end", (a) => a.actions.push(a.actions[0])),
      forged("seed shopping", (a) => (a.seed = `${a.playerId}:${a.levelId}:99`)),
      forged("claimed stars", (a) => (a.outcome.stars = 1)),
      forged("unknown content", (a) => (a.contentHash = "0000000000000000")),
    ];
    const cases: FixtureCase[] = inputs.map(([name, attempt]) => ({
      name,
      attempt,
      payload: null,
      verdict: attempt.contentHash === bundle.build.contentHash
        ? verifyAttempt(bundle, SERVER_MECHANICS, attempt)
        : { attemptId: attempt.attemptId, status: "unverifiable", reason: "content_unknown", flags: [] },
    }));
    const fixturePath = join(outDir, "fixtures", `${gameId}.json`);
    writeFileSync(fixturePath, `${JSON.stringify({ gameId, contentHash: bundle.build.contentHash, cases }, null, 1)}\n`);
    written.push(bundlePath, fixturePath);
  }
  return written;
}
