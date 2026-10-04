import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkAppArt } from "./art/app-icons";
import { PLACEHOLDER_MARK, encodePng, pngInfo } from "./art/png";
import { releaseReadiness, type CompiledGame, type PlatformCapabilities } from "./build";
import { compileGame } from "./compile";
import { rootPath } from "./paths";

const none: PlatformCapabilities = { iap: false, ads: false, consent: false, analytics: false, notifications: false, backend: false };
const all: PlatformCapabilities = { iap: true, ads: true, consent: true, analytics: true, notifications: true, backend: true };
const compiled = (gameId: string): CompiledGame => ({ ...compileGame(gameId), gameId });
const errors = (issues: ReturnType<typeof releaseReadiness>) => issues.filter((i) => i.severity === "error").map((i) => i.message);

describe("release readiness", () => {
  const maple = compiled("maplebrook");

  it("lets development builds through with warnings, once the game has an EAS project", () => {
    const issues = releaseReadiness(maple, "development", none);
    expect(errors(issues)).toEqual([expect.stringContaining("eas.projectId")]);
    expect(issues.some((i) => i.severity === "warning" && i.message.includes("in-app purchase"))).toBe(true);
  });

  it("refuses production builds that would ship stand-ins, placeholder ids or unfinished copy", () => {
    const messages = errors(releaseReadiness(maple, "production", none)).join("\n");
    for (const expected of ["eas.projectId", "placeholder prefix", "in-app purchase", "ads adapter", "consent", "backendUrl", "TODO"]) {
      expect(messages).toContain(expected);
    }
  });

  it("passes production once identity, adapters, backend and copy are real", () => {
    const release = maple.release!;
    const ready: CompiledGame = {
      ...maple,
      release: {
        ...release,
        ios: { ...release.ios, bundleId: "com.studio.maplebrook" },
        android: { ...release.android, package: "com.studio.maplebrook" },
        eas: { projectId: "6f1d1c8e-2b7a-4c55-9a52-3f3f5e1d2a10" },
        environments: { ...release.environments, production: { backendUrl: "https://api.studio.example/" } },
      },
      listings: maple.listings.map((l) => ({ ...l, description: "Final store copy for Maplebrook." })),
    };
    expect(errors(releaseReadiness(ready, "production", all))).toEqual([]);
  });

  it("flags reskins: same template, mechanic, rules and modules", () => {
    const twin: CompiledGame = { ...maple, gameId: "maple_twin" };
    expect(errors(releaseReadiness(maple, "production", all, [twin])).some((m) => m.includes("4.3"))).toBe(true);
    expect(releaseReadiness(maple, "production", all, [compiled("palm_peaks")]).some((i) => i.message.includes("4.3"))).toBe(false);
  });
});

describe("app art", () => {
  it("encodes PNGs without alpha for store icons and marks placeholders", () => {
    const pixels = new Uint8Array(4 * 4 * 4).fill(200);
    expect(pngInfo(encodePng(4, 4, pixels, { opaque: true }))).toEqual({ width: 4, height: 4, alpha: false, placeholder: false });
    expect(pngInfo(encodePng(4, 4, pixels, { text: { Software: PLACEHOLDER_MARK } }))).toMatchObject({ alpha: true, placeholder: true });
  });

  it("accepts every game's icons and reports placeholders as warnings only", () => {
    for (const gameId of ["maplebrook", "palm_peaks"]) {
      const problems = checkAppArt(rootPath("games", gameId));
      expect(problems.filter((p) => p.severity === "error")).toEqual([]);
      expect(problems.every((p) => p.problem.includes("placeholder"))).toBe(true);
    }
  });

  it("rejects a transparent store icon and reports missing files", () => {
    const dir = mkdtempSync(join(tmpdir(), "gf-art-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "icon.png"), encodePng(1024, 1024, new Uint8Array(1024 * 1024 * 4)));
    const problems = checkAppArt(dir);
    expect(problems.find((p) => p.file === "icon.png")).toMatchObject({ severity: "error" });
    expect(problems.filter((p) => p.problem.startsWith("missing"))).toHaveLength(4);
  });
});
