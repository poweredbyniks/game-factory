import { applyAction, compile, initialState, solveLevel, type TriPeaksLevelData } from "@gf/mechanic-tripeaks";
import type { Page } from "playwright";

/** Plays the solver's solution through real taps on card faces and the stock. */
export async function playLevelTriPeaks(
  page: Page,
  data: TriPeaksLevelData,
  tap: (testId: string) => Promise<void>,
  onStep: (index: number) => Promise<void>,
): Promise<void> {
  const c = compile(data);
  const solution = solveLevel(data);
  if (!solution.solved) throw new Error("level has no solution");
  let state = initialState(data);
  for (const [i, action] of solution.actions.entries()) {
    await tap(action.type === "draw" ? "stock" : `card-${c.codes[c.slotCard[action.slot]!]}`);
    state = applyAction(c, state, action).state;
    await page.waitForTimeout(200);
    const left = (await page.getByTestId("budget-left").first().innerText()).trim();
    if (Number(left) !== state.stock.length) throw new Error(`after step ${i}: UI shows ${left} cards, engine expects ${state.stock.length}`);
    await onStep(i);
  }
}
