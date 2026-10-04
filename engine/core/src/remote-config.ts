import {
  EconomyDefinition, MonetizationDefinition, OVERRIDE_ROOTS, RemotePayload, StoreDefinition, Tuning,
  type GameBundle, type OverrideRoot, type Overrides,
} from "@gf/schemas";
import type { z } from "zod";
import { deepMerge } from "./util";

/** The part of the configuration that remote config and experiments may change. */
export type EffectiveConfig = {
  economy: EconomyDefinition;
  monetization: MonetizationDefinition;
  store: StoreDefinition;
  tuning: Tuning;
};

const ROOT_SCHEMAS: Record<OverrideRoot, z.ZodType> = {
  economy: EconomyDefinition,
  monetization: MonetizationDefinition,
  store: StoreDefinition,
  tuning: Tuning,
};

export interface RemoteConfigProvider {
  /** Returns the raw payload (unvalidated) or null when nothing is published. */
  fetch(): Promise<unknown>;
}

export class StaticRemoteConfigProvider implements RemoteConfigProvider {
  constructor(private readonly payload: unknown) {}
  async fetch(): Promise<unknown> {
    return this.payload;
  }
}

export type PayloadCheck = { ok: true; payload: RemotePayload } | { ok: false; errors: string[] };

export function parsePayload(raw: unknown, gameId: string): PayloadCheck {
  const parsed = RemotePayload.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  if (parsed.data.gameId !== gameId) return { ok: false, errors: [`payload is for "${parsed.data.gameId}", not "${gameId}"`] };
  return { ok: true, payload: parsed.data };
}

export type EffectiveConfigResult = { config: EffectiveConfig; applied: string[]; rejected: string[] };

/**
 * bundle defaults < payload overrides < experiment variant overrides. Each root is merged and
 * re-validated on its own: an invalid override keeps that root at its previous value.
 */
export function buildEffectiveConfig(
  bundle: Pick<GameBundle, "economy" | "monetization" | "store" | "tuning">,
  payload: RemotePayload | null,
  assignments: Readonly<Record<string, string>>,
): EffectiveConfigResult {
  const config: EffectiveConfig = {
    economy: bundle.economy,
    monetization: bundle.monetization,
    store: bundle.store,
    tuning: bundle.tuning,
  };
  const applied: string[] = [];
  const rejected: string[] = [];
  if (!payload) return { config, applied, rejected };

  const layers: Array<{ label: string; overrides: Overrides }> = [{ label: `payload@${payload.payloadVersion}`, overrides: payload.overrides }];
  for (const experiment of payload.experiments) {
    const variantId = assignments[experiment.id];
    const variant = experiment.variants.find((v) => v.id === variantId);
    if (variant) layers.push({ label: `${experiment.id}:${variant.id}`, overrides: variant.overrides });
  }

  for (const layer of layers) {
    for (const root of OVERRIDE_ROOTS) {
      const override = layer.overrides[root];
      if (!override) continue;
      const merged = deepMerge(config[root] as unknown, override);
      const check = ROOT_SCHEMAS[root].safeParse(merged);
      if (check.success) {
        (config as Record<OverrideRoot, unknown>)[root] = check.data;
        applied.push(`${layer.label}/${root}`);
      } else {
        rejected.push(`${layer.label}/${root}: ${check.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
      }
    }
  }
  return { config, applied, rejected };
}
