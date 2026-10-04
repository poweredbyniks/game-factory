import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { verifyAttempt } from "@gf/core";
import { describe, expect, it } from "vitest";
import { compileGame } from "../compile";
import { goldenAttempts } from "../golden";
import { MECHANICS } from "../mechanics";
import { buildServerEngine } from "./build";
import { SERVER_MECHANICS } from "./mechanics";

type Engine = {
  info(): string;
  loadBundle(bundleJson: string): string;
  verifyAttempt(attemptJson: string, payloadJson: string | null, optionsJson: string | null): string;
};

describe("server engine script (for GraalJS)", () => {
  it("registers every mechanic the tools and apps run", () => {
    expect(Object.keys(SERVER_MECHANICS).sort()).toEqual(Object.keys(MECHANICS).sort());
  });

  it("runs on ECMAScript built-ins alone and judges attempts exactly like the engine", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gf-engine-"));
    const manifest = await buildServerEngine(dir);
    // An empty context has no require, process, Buffer, console or timers, like a bare GraalJS context.
    const context = vm.createContext({});
    vm.runInContext(readFileSync(join(dir, manifest.file), "utf8"), context);
    const engine = (context as { GfEngine: Engine }).GfEngine;
    expect(JSON.parse(engine.info())).toEqual({ engineVersion: manifest.engineVersion, mechanics: manifest.mechanics });

    for (const gameId of ["maplebrook", "palm_peaks"]) {
      const bundle = compileGame(gameId).bundle!;
      expect(engine.loadBundle(JSON.stringify(bundle))).toBe(bundle.build.contentHash);
      const attempts = await goldenAttempts(bundle);
      const cases = [attempts[0]!, attempts.at(-1)!, { ...attempts[1]!, seed: "forged" }, { ...attempts[2]!, contentHash: "unknown" }];
      for (const attempt of cases) {
        const viaScript = JSON.parse(engine.verifyAttempt(JSON.stringify(attempt), null, null));
        const direct = attempt.contentHash === bundle.build.contentHash
          ? verifyAttempt(bundle, MECHANICS, attempt)
          : { attemptId: attempt.attemptId, status: "unverifiable", reason: "content_unknown", flags: [] };
        expect(viaScript, `${gameId} ${attempt.levelId}`).toEqual(direct);
      }
      expect(JSON.parse(engine.verifyAttempt(JSON.stringify(attempts[0]), null, null))).toMatchObject({ status: "accepted", flags: [] });
    }
  });
});
