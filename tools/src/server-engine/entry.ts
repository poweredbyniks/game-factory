/**
 * The engine as the Java backend sees it. esbuild turns this file into one self-contained script
 * (build/server-engine/gf-engine.js) that GraalJS evaluates; it defines globalThis.GfEngine.
 *
 * Rules: only ECMAScript built-ins (no Node, browser or Java APIs), JSON strings in and out, no
 * state other than the parsed bundles. Every mechanic the apps can run must be registered here.
 */
import { buildEffectiveConfig, parsePayload, verifyAttempt } from "@gf/core";
import { GameBundle } from "@gf/schemas";
import { SERVER_MECHANICS } from "./mechanics";

declare const __GF_ENGINE_VERSION__: string;

const bundles = new Map<string, GameBundle>();

export type VerifyRequestOptions = {
  /** Experiment variants the server computed for the player; default: the variants the record reports. */
  experiments?: Record<string, string>;
  minMsPerAction?: number;
};

export const GfEngine = {
  /** Engine and mechanic versions, so the server can tell which attempts it can judge. */
  info(): string {
    const mechanics = Object.fromEntries(Object.entries(SERVER_MECHANICS).map(([id, m]) => [id, m.version]));
    return JSON.stringify({ engineVersion: typeof __GF_ENGINE_VERSION__ === "string" ? __GF_ENGINE_VERSION__ : "dev", mechanics });
  },

  /** Parses a shipped bundle once and keeps it; returns its content hash. */
  loadBundle(bundleJson: string): string {
    const bundle = GameBundle.parse(JSON.parse(bundleJson));
    bundles.set(bundle.build.contentHash, bundle);
    return bundle.build.contentHash;
  },

  hasBundle(contentHash: string): boolean {
    return bundles.has(contentHash);
  },

  /**
   * Judges one AttemptRecord. payloadJson is the remote payload whose version the record reports,
   * or null when it reports none. Returns an AttemptVerdict.
   */
  verifyAttempt(attemptJson: string, payloadJson: string | null, optionsJson: string | null): string {
    const attempt = JSON.parse(attemptJson) as { attemptId?: unknown; contentHash?: unknown; remote?: { experiments?: Record<string, string> } } | null;
    const options = (optionsJson ? JSON.parse(optionsJson) : {}) as VerifyRequestOptions;
    const bundle = typeof attempt?.contentHash === "string" ? bundles.get(attempt.contentHash) : undefined;
    if (!bundle) {
      return JSON.stringify({ attemptId: String(attempt?.attemptId ?? ""), status: "unverifiable", reason: "content_unknown", flags: [] });
    }
    let payload = null;
    if (payloadJson) {
      const check = parsePayload(JSON.parse(payloadJson), bundle.game.gameId);
      if (check.ok) payload = check.payload;
    }
    const experiments = options.experiments ?? attempt?.remote?.experiments ?? {};
    const { config } = buildEffectiveConfig(bundle, payload, experiments);
    const verdict = verifyAttempt(bundle, SERVER_MECHANICS, attempt, {
      config: { economy: config.economy, tuning: config.tuning },
      ...(options.minMsPerAction !== undefined ? { minMsPerAction: options.minMsPerAction } : {}),
    });
    return JSON.stringify(verdict);
  },
};

(globalThis as { GfEngine?: typeof GfEngine }).GfEngine = GfEngine;
