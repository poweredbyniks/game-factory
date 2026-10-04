import type { SolveResult } from "@gf/core";
import { compile, type CompiledLevel } from "./compiled";
import { applyAction, initialState, isWon, judgeMove, sources, unitAt } from "./rules";
import type { AssociationAction, AssociationLevelData, AssociationState, Source } from "./types";

/**
 * Perfect-information solver: weighted A* with dominance pruning. Used to verify that generated
 * levels are solvable, to size move budgets, and to produce hints.
 *
 * Pruning rules (each preserves at least one optimal solution):
 * 1. Sending a word run to its active category slot is always safe, so it becomes the only successor.
 * 2. Slots are interchangeable: a category card is only tried in the first empty slot.
 * 3. Column-to-column moves must reveal or expose something; shuffling a whole column into an
 *    empty column is pointless.
 */
export type SolverOptions = { maxNodes?: number; weight?: number };

type Node = { state: AssociationState; g: number; f: number; parent: Node | null; action: AssociationAction | null };

function stateKey(lvl: CompiledLevel, s: AssociationState): string {
  let key = "";
  for (const c of s.cols) key += `${c.down}:${c.cards.join(",")}|`;
  key += `S${s.stock.join(",")}|W${s.waste.join(",")}|F`;
  const slots = s.slots.map((x) => (x ? `${x.cat}.${x.placed}` : "-")).sort();
  key += slots.join(",");
  key += `|D${s.done.slice().sort((a, b) => a - b).join(",")}`;
  if (lvl.data.rules.recycleLimit !== null) key += `|R${s.recycles}`;
  return key;
}

function heuristic(lvl: CompiledLevel, s: AssociationState): number {
  const active = new Set<number>();
  let placedWords = 0;
  for (const slot of s.slots) {
    if (slot) {
      active.add(slot.cat);
      placedWords += slot.placed;
    }
  }
  let doneWords = 0;
  for (const cat of s.done) doneWords += lvl.size[cat]!;
  const categoriesLeft = lvl.data.categories.length - s.done.length;
  const notActive = categoriesLeft - active.size;
  const wordsLeft = lvl.total - lvl.data.categories.length - placedWords - doneWords;
  let faceDown = 0;
  for (const c of s.cols) faceDown += c.down;
  return notActive + categoriesLeft + wordsLeft * 0.35 + faceDown * 0.25;
}

function safeMove(lvl: CompiledLevel, s: AssociationState): AssociationAction | null {
  for (const from of sources(s)) {
    const unit = unitAt(lvl, s, from);
    const first = unit[0];
    if (first === undefined || lvl.isCat[first]) continue;
    const slotIndex = s.slots.findIndex((slot) => slot !== null && slot.cat === lvl.catOf[first]);
    if (slotIndex >= 0) return { type: "move", from, to: { pile: "slot", index: slotIndex } };
  }
  return null;
}

export function successors(lvl: CompiledLevel, s: AssociationState): AssociationAction[] {
  const safe = safeMove(lvl, s);
  if (safe) return [safe];
  const out: AssociationAction[] = [];
  const emptySlot = s.slots.findIndex((slot) => slot === null);
  const firstEmptyCol = s.cols.findIndex((c) => c.cards.length === 0);
  for (const from of sources(s)) {
    const unit = unitAt(lvl, s, from);
    const first = unit[0]!;
    if (lvl.isCat[first] && emptySlot >= 0) out.push({ type: "move", from, to: { pile: "slot", index: emptySlot } });
    const col = from.pile === "column" ? s.cols[from.index]! : null;
    const exposesSomething = from.pile === "waste" || (col !== null && col.cards.length > unit.length);
    if (!exposesSomething) continue;
    s.cols.forEach((target, index) => {
      if (from.pile === "column" && from.index === index) return;
      if (target.cards.length === 0 && index !== firstEmptyCol) return; // empty columns are interchangeable
      const to = { pile: "column", index } as const;
      if (judgeMove(lvl, s, from as Source, unit, to).kind === "ok") out.push({ type: "move", from, to });
    });
  }
  const limit = lvl.data.rules.recycleLimit;
  if (s.stock.length > 0 || (s.waste.length > 0 && (limit === null || s.recycles < limit))) out.push({ type: "draw" });
  return out;
}

class MinHeap {
  private items: Node[] = [];
  get size() {
    return this.items.length;
  }
  push(node: Node) {
    const a = this.items;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.f <= node.f) break;
      a[i] = a[p]!;
      i = p;
    }
    a[i] = node;
  }
  pop(): Node | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length > 0 && last) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        let best = last.f;
        if (l < a.length && a[l]!.f < best) {
          m = l;
          best = a[l]!.f;
        }
        if (r < a.length && a[r]!.f < best) m = r;
        if (m === i) break;
        a[i] = a[m]!;
        i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

export function solveFrom(
  data: AssociationLevelData,
  start: AssociationState,
  opts: SolverOptions = {},
): SolveResult<AssociationAction> {
  const lvl = compile(data);
  const maxNodes = opts.maxNodes ?? 60_000;
  const weight = opts.weight ?? 2;
  // The solver ignores the move budget: it searches for the shortest path it can find.
  const unlimited: AssociationState = { ...start, movesLeft: Number.MAX_SAFE_INTEGER };
  const open = new MinHeap();
  const best = new Map<string, number>();
  open.push({ state: unlimited, g: 0, f: weight * heuristic(lvl, unlimited), parent: null, action: null });
  best.set(stateKey(lvl, unlimited), 0);
  let nodes = 0;
  while (open.size > 0 && nodes < maxNodes) {
    const node = open.pop()!;
    nodes += 1;
    if (isWon(lvl, node.state)) {
      const actions: AssociationAction[] = [];
      for (let n: Node | null = node; n && n.action; n = n.parent) actions.push(n.action);
      actions.reverse();
      return { solved: true, actions, nodes };
    }
    for (const action of successors(lvl, node.state)) {
      const result = applyAction(lvl, node.state, action);
      if (result.outcome !== "applied") continue;
      const g = node.g + 1;
      const key = stateKey(lvl, result.state);
      const known = best.get(key);
      if (known !== undefined && known <= g) continue;
      best.set(key, g);
      open.push({ state: result.state, g, f: g + weight * heuristic(lvl, result.state), parent: node, action });
    }
  }
  return { solved: false, actions: [], nodes };
}

export function solveLevel(data: AssociationLevelData, opts: SolverOptions = {}): SolveResult<AssociationAction> {
  return solveFrom(data, initialState(data), opts);
}
