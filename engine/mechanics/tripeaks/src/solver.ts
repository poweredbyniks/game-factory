import type { SolveResult } from "@gf/core";
import { applyAction, compile, initialState, isWon, playable, type Compiled } from "./rules";
import type { TriPeaksAction, TriPeaksLevelData, TriPeaksState } from "./types";

const key = (s: TriPeaksState) => `${s.removed.map((r) => (r ? 1 : 0)).join("")}:${s.stock.length}:${s.waste[s.waste.length - 1]}`;

/**
 * Perfect-information depth-first search, plays before draws, memoising dead states. Prefers
 * plays that uncover the most cards so solutions keep stock in hand.
 */
function search(c: Compiled, start: TriPeaksState, maxNodes: number, drawLimit: number): SolveResult<TriPeaksAction> {
  const dead = new Set<string>();
  const path: TriPeaksAction[] = [];
  const startDraws = start.draws;
  let nodes = 0;
  const order = (s: TriPeaksState, slots: number[]) =>
    slots
      .map((slot) => ({ slot, score: unlocks(c, s, slot) * 10 - c.data.layout.slots[slot]!.y }))
      .sort((a, b) => b.score - a.score || a.slot - b.slot)
      .map((x) => x.slot);
  const dfs = (s: TriPeaksState): boolean => {
    if (isWon(s)) return true;
    if (++nodes > maxNodes) return false;
    const k = key(s);
    if (dead.has(k)) return false;
    for (const slot of order(s, playable(c, s))) {
      const action: TriPeaksAction = { type: "play", slot };
      path.push(action);
      if (dfs(applyAction(c, s, action).state)) return true;
      path.pop();
    }
    if (s.stock.length > 0 && s.draws - startDraws < drawLimit) {
      const action: TriPeaksAction = { type: "draw" };
      path.push(action);
      if (dfs(applyAction(c, s, action).state)) return true;
      path.pop();
    }
    if (nodes <= maxNodes) dead.add(k);
    return false;
  };
  const solved = dfs(start);
  return { solved, actions: solved ? [...path] : [], nodes };
}

/**
 * Perfect-information depth-first search, plays before draws, memoising dead states. Then tightens
 * the draw limit until it fails, so the result uses as few stock cards as the node budget can find:
 * star thresholds derived from it reflect strong play.
 */
export function solveFrom(data: TriPeaksLevelData, start: TriPeaksState, opts: { maxNodes?: number } = {}): SolveResult<TriPeaksAction> {
  const c = compile(data);
  const maxNodes = opts.maxNodes ?? 200_000;
  let best = search(c, start, maxNodes, Number.POSITIVE_INFINITY);
  let nodes = best.nodes;
  if (!best.solved) return best;
  for (let limit = best.actions.filter((a) => a.type === "draw").length - 1; limit >= 0; limit--) {
    const attempt = search(c, start, Math.min(maxNodes, 40_000), limit);
    nodes += attempt.nodes;
    if (!attempt.solved) break;
    best = attempt;
  }
  return { ...best, nodes };
}

function unlocks(c: Compiled, s: TriPeaksState, slot: number): number {
  let n = 0;
  c.coveredBy.forEach((covers, i) => {
    if (!s.removed[i] && covers.includes(slot) && covers.every((j) => j === slot || s.removed[j])) n += 1;
  });
  return n;
}

export function solveLevel(data: TriPeaksLevelData, opts: { maxNodes?: number } = {}) {
  return solveFrom(data, initialState(data), opts);
}
