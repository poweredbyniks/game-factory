/** Board shapes as data: positions on a half-card grid. A card is covered by the cards one row below at x ± 1. */
export type Slot = { x: number; y: number };

const row = (y: number, xs: number[]): Slot[] => xs.map((x) => ({ x, y }));

export const LAYOUTS: Record<string, Slot[]> = {
  tri: [
    ...row(0, [3, 9, 15]),
    ...row(1, [2, 4, 8, 10, 14, 16]),
    ...row(2, [1, 3, 5, 7, 9, 11, 13, 15, 17]),
    ...row(3, [0, 2, 4, 6, 8, 10, 12, 14, 16, 18]),
  ],
  twin: [
    ...row(0, [3, 9]),
    ...row(1, [2, 4, 8, 10]),
    ...row(2, [1, 3, 5, 7, 9, 11]),
    ...row(3, [0, 2, 4, 6, 8, 10, 12]),
  ],
  hill: [
    ...row(0, [4]),
    ...row(1, [3, 5]),
    ...row(2, [2, 4, 6]),
    ...row(3, [1, 3, 5, 7]),
    ...row(4, [0, 2, 4, 6, 8]),
  ],
};

/** coveredBy[i] = slots that must be removed before slot i is playable. */
export function coverGraph(slots: readonly Slot[]): number[][] {
  return slots.map((s) => slots.flatMap((o, j) => (o.y === s.y + 1 && Math.abs(o.x - s.x) === 1 ? [j] : [])));
}
