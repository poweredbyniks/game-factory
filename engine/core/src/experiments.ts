import type { Experiment, Platform } from "@gf/schemas";
import { hash32 } from "./rng";

export type ExperimentContext = { frontier: number; platform: Platform; isNewPlayer: boolean };

export function eligible(experiment: Experiment, ctx: ExperimentContext): boolean {
  if (experiment.status !== "running") return false;
  const audience = experiment.audience;
  if (!audience) return true;
  if (audience.minLevel !== undefined && ctx.frontier < audience.minLevel) return false;
  if (audience.platforms && !audience.platforms.includes(ctx.platform)) return false;
  if (audience.newPlayersOnly && !ctx.isNewPlayer) return false;
  return true;
}

/** Deterministic weighted bucketing on hash(experimentId:playerId). */
export function assignVariant(experiment: Experiment, playerId: string): string {
  const total = experiment.variants.reduce((sum, v) => sum + v.weight, 0);
  let bucket = hash32(`${experiment.id}:${playerId}`) % total;
  for (const variant of experiment.variants) {
    if (bucket < variant.weight) return variant.id;
    bucket -= variant.weight;
  }
  return experiment.variants[experiment.variants.length - 1]!.id;
}

/**
 * Sticky assignment: an existing assignment is kept while its experiment runs and its variant
 * still exists. New eligible experiments get a fresh deterministic assignment.
 */
export function resolveAssignments(
  experiments: readonly Experiment[],
  playerId: string,
  existing: Readonly<Record<string, string>>,
  ctx: ExperimentContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const experiment of experiments) {
    if (experiment.status !== "running") continue;
    const prior = existing[experiment.id];
    if (prior && experiment.variants.some((v) => v.id === prior)) {
      out[experiment.id] = prior;
      continue;
    }
    if (eligible(experiment, ctx)) out[experiment.id] = assignVariant(experiment, playerId);
  }
  return out;
}
