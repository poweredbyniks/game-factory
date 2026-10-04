import { join } from "node:path";
import { deepMerge } from "@gf/core";
import { GameDefinition, LevelGenConfig, LevelsFile, WordPack, type LevelDefinition, type Tier } from "@gf/schemas";
import { TOOLING } from "./mechanics";
import { readJson, rootPath, writeJson } from "./paths";

const TIER_SCORE: Record<Tier, number> = { tutorial: 0.05, easy: 0.25, medium: 0.5, hard: 0.7, expert: 0.85 };
const round2 = (n: number) => Math.round(n * 100) / 100;

export type LevelRow = {
  number: number;
  tier: Tier;
  content: string;
  solution: number;
  budget: number;
  winRates?: Record<string, number>;
};

function loadContext(gameId: string) {
  const gameDir = rootPath("games", gameId);
  const game = GameDefinition.parse(readJson(join(gameDir, "game.json")));
  const cfg = LevelGenConfig.parse(readJson(join(gameDir, "levelgen.json")));
  const tooling = TOOLING[cfg.mechanic];
  if (!tooling) throw new Error(`no tooling registered for mechanic "${cfg.mechanic}"`);
  const packs = game.content.packs.map((id) =>
    WordPack.parse(readJson(rootPath("content", "word-packs", game.content.defaultLocale, `${id}.json`))),
  );
  return { gameDir, game, cfg, tooling, packs };
}

function budgetOf(data: unknown): number {
  const d = data as { moves?: number; stock?: unknown[] };
  return d.moves ?? d.stock?.length ?? 0;
}

/** Generates levels.json from levelgen.json. Deterministic for a given config and content. */
export function generateLevels(
  gameId: string,
  opts: { count?: number; analyze?: boolean; runs?: number; log?: (line: string) => void } = {},
): { levels: LevelDefinition[]; rows: LevelRow[] } {
  const { gameDir, game, cfg, tooling, packs } = loadContext(gameId);
  const count = opts.count ?? cfg.count;
  const levels: LevelDefinition[] = [];
  const rows: LevelRow[] = [];
  const recent: string[][] = [];
  for (let n = 1; n <= count; n++) {
    const segment = cfg.curve.find((s) => n >= s.from && n <= s.to);
    if (!segment) throw new Error(`levelgen.json: no curve segment covers level ${n}`);
    const base = game.mechanic.rules ? deepMerge(cfg.defaults, { rules: game.mechanic.rules }) : cfg.defaults;
    const params = deepMerge(base, segment.params);
    const runs = opts.runs ?? 60;
    let seed = `${cfg.seed}:${n}`;
    let generated = tooling.generate({ seed, params, packs, recent: recent.slice(-2).flat() });
    let rates: Record<string, number> | undefined;
    if (segment.target && tooling.rebalance) {
      // Tune the budget to the target win rate; re-deal when the bot can rarely win at any budget.
      let best: { seed: string; generated: typeof generated; result: NonNullable<ReturnType<NonNullable<typeof tooling.rebalance>>> } | null = null;
      for (let retry = 0; retry < 12; retry++) {
        const trySeed = retry === 0 ? seed : `${cfg.seed}:${n}:r${retry}`;
        const candidate = retry === 0 ? generated : tooling.generate({ seed: trySeed, params, packs, recent: recent.slice(-2).flat() });
        const result = tooling.rebalance({ data: candidate.data, solutionLength: candidate.analysis.solutionLength, target: segment.target, params, runs, seed: trySeed });
        // Skill inversion (experts losing more than average players) means the deal punishes good play.
        const inverted = result.winRates.expert + 0.1 < result.winRates.average;
        const badness = (r: typeof result, inv: boolean) => Math.abs(r.achieved - segment.target!.winRate) + (inv ? 1 : 0);
        if (!best || badness(result, inverted) < badness(best.result, best.result.winRates.expert + 0.1 < best.result.winRates.average)) {
          best = { seed: trySeed, generated: candidate, result };
        }
        if (result.maxRate >= segment.target.winRate && !inverted) break;
      }
      seed = best!.seed;
      generated = { ...best!.generated, data: best!.result.data };
      rates = best!.result.winRates;
    }
    recent.push(generated.contentIds);
    const steps = cfg.tutorials[String(n)];
    const level: LevelDefinition = {
      levelId: `${gameId}.l${String(n).padStart(3, "0")}`,
      number: n,
      mechanic: cfg.mechanic,
      difficulty: { tier: segment.tier, score: TIER_SCORE[segment.tier] },
      objectives: [{ type: "clear_board" }],
      lose: { outOfMoves: true, stuck: true },
      boosters: cfg.boosters,
      tags: [...(cfg.keystones.includes(n) ? ["keystone"] : []), ...(segment.tier === "tutorial" ? ["tutorial"] : [])],
      ...(steps ? { tutorial: { steps } } : {}),
      data: generated.data as Record<string, unknown>,
      analysis: {
        solutionLength: generated.analysis.solutionLength,
        solverNodes: generated.analysis.solverNodes,
        generator: { id: `${cfg.mechanic}@${tooling.mechanic.version}`, seed },
      },
    };
    const row: LevelRow = {
      number: n,
      tier: segment.tier,
      content: generated.contentIds.join(" "),
      solution: generated.analysis.solutionLength,
      budget: budgetOf(generated.data),
    };
    if (!rates && opts.analyze && tooling.winRates) rates = tooling.winRates(generated.data, runs, seed);
    if (rates) {
      level.analysis!.botWinRate = { casual: round2(rates.casual!), average: round2(rates.average!), expert: round2(rates.expert!) };
      level.difficulty.score = round2(1 - rates.average!);
      row.winRates = rates;
    }
    levels.push(level);
    rows.push(row);
    opts.log?.(formatRow(row));
  }
  writeJson(join(gameDir, "levels.json"), { $schema: "../../schemas/levels.schema.json", schemaVersion: 1, levels });
  return { levels, rows };
}

/** Re-estimates bot win rates for the committed levels without changing their deals. */
export function analyzeLevels(gameId: string, opts: { runs?: number; log?: (line: string) => void } = {}): LevelRow[] {
  const { gameDir, tooling } = loadContext(gameId);
  const path = join(gameDir, "levels.json");
  const file = LevelsFile.parse(readJson(path));
  const rows: LevelRow[] = [];
  for (const level of file.levels) {
    if (!tooling.winRates) break;
    const rates = tooling.winRates(level.data, opts.runs ?? 40, level.analysis?.generator.seed ?? level.levelId);
    level.analysis = { ...(level.analysis ?? { solutionLength: 0, solverNodes: 0, generator: { id: "manual", seed: level.levelId } }), botWinRate: rates };
    level.difficulty.score = round2(1 - rates.average);
    const row: LevelRow = {
      number: level.number,
      tier: level.difficulty.tier,
      content: "",
      solution: level.analysis.solutionLength,
      budget: budgetOf(level.data),
      winRates: rates,
    };
    rows.push(row);
    opts.log?.(formatRow(row));
  }
  writeJson(path, file);
  return rows;
}

export function formatRow(row: LevelRow): string {
  const pct = (v?: number) => (v === undefined ? "  - " : `${String(Math.round(v * 100)).padStart(3)}%`);
  const rates = row.winRates ? ` win casual ${pct(row.winRates.casual)} average ${pct(row.winRates.average)} expert ${pct(row.winRates.expert)}` : "";
  return `L${String(row.number).padStart(3, "0")} ${row.tier.padEnd(8)} solution ${String(row.solution).padStart(3)} budget ${String(row.budget).padStart(3)}${rates}  ${row.content}`;
}
