import { GameRuntime, ManualClock, MemorySaveStore } from "@gf/core";
import type { AttemptRecord, GameBundle } from "@gf/schemas";
import { MECHANICS, TOOLING } from "./mechanics";

/**
 * Plays every level with the solver's line through the real runtime, at a human pace, and returns
 * the attempt records the app would send to the backend.
 */
export async function goldenAttempts(bundle: GameBundle, playerId = "golden"): Promise<AttemptRecord[]> {
  const clock = new ManualClock();
  const runtime = await GameRuntime.create({
    bundle, mechanics: MECHANICS, store: new MemorySaveStore(), clock, platform: "node", appVersion: "golden", playerId, persist: "manual",
  });
  for (const level of bundle.levels) {
    const started = runtime.startLevel(level.levelId);
    if (!started.ok) throw new Error(`${level.levelId}: ${started.reason}`);
    const mechanic = TOOLING[level.mechanic]!.mechanic;
    const solution = mechanic.solve!(mechanic.levelDataSchema.parse(level.data));
    if (!solution.solved) throw new Error(`${level.levelId}: the solver found no solution`);
    for (const action of solution.actions) {
      clock.advance(1500);
      runtime.act(action);
    }
    runtime.finishLevel();
    clock.advance(60_000);
  }
  return runtime.pendingAttempts() as AttemptRecord[];
}
