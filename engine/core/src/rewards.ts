import type { EconomyDefinition, ItemBag, LevelDefinition } from "@gf/schemas";
import { scaleBag } from "./util";

/** Reward for winning a level: explicit level reward, else star tier x difficulty tier x keystone. */
export function levelRewardBag(economy: EconomyDefinition, level: LevelDefinition, stars: 1 | 2 | 3): ItemBag {
  if (level.reward) return { ...level.reward };
  const base = economy.levelRewards.byStars[String(stars) as "1" | "2" | "3"];
  let factor = economy.levelRewards.tierMultiplier[level.difficulty.tier] ?? 1;
  if (level.tags.includes("keystone")) factor *= economy.levelRewards.keystoneMultiplier;
  return scaleBag(base, factor);
}

export function resolveRewardRef(economy: EconomyDefinition, ref: string | ItemBag | undefined): ItemBag {
  if (ref === undefined) return {};
  if (typeof ref === "string") {
    const table = economy.rewardTables[ref];
    if (!table) throw new Error(`unknown reward table "${ref}"`);
    return { ...table };
  }
  return { ...ref };
}

/** Cost of the n-th continue (0-based) of an attempt, with escalation. */
export function continueCost(economy: EconomyDefinition, index: number): ItemBag {
  const steps = economy.continue.costEscalation;
  const factor = steps[Math.min(index, steps.length - 1)] ?? 1;
  return scaleBag(economy.continue.cost, factor);
}
