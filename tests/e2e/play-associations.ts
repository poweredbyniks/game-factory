import { applyAction, compile, initialState, solveLevel, unitAt, type AssociationLevelData } from "@gf/mechanic-associations";
import type { Page } from "playwright";

/** Plays the solver's solution through real taps: select the source card, then tap the target. */
export async function playLevelAssociations(
  page: Page,
  data: AssociationLevelData,
  tap: (testId: string) => Promise<void>,
  onStep: (index: number) => Promise<void>,
): Promise<void> {
  const lvl = compile(data);
  const solution = solveLevel(data);
  if (!solution.solved) throw new Error("level has no solution");
  let state = initialState(data);
  for (const [i, action] of solution.actions.entries()) {
    if (action.type === "draw") {
      await tap("stock");
    } else {
      const unit = unitAt(lvl, state, action.from);
      await tap(`card-${data.cards[unit[unit.length - 1]!]!.id}`);
      await page.waitForTimeout(60);
      await tap(action.to.pile === "slot" ? `slot-${action.to.index}` : `column-${action.to.index}`);
    }
    state = applyAction(lvl, state, action).state;
    await page.waitForTimeout(260);
    const left = (await page.getByTestId("budget-left").first().innerText()).trim();
    if (Number(left) !== state.movesLeft) throw new Error(`after step ${i}: UI shows ${left} moves, engine expects ${state.movesLeft}`);
    await onStep(i);
  }
}
