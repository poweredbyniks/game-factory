export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** Deterministic clock for tests and simulations. */
export class ManualClock implements Clock {
  constructor(private t: number = Date.UTC(2026, 0, 1)) {}
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  set(ms: number): void {
    this.t = ms;
  }
}

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** UTC calendar day, used for daily caps. */
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
