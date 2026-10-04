import type { BoosterEffect } from "@gf/schemas";
import type { z } from "zod";
import type { Rng } from "./rng";

/** applied: the board changed. mismatch: a wrong association, may cost a move. illegal: impossible, costs nothing. */
export type MoveOutcome = "applied" | "mismatch" | "illegal";

export type MechanicEvent = { type: string } & Record<string, unknown>;

export interface MoveResult<S> {
  outcome: MoveOutcome;
  state: S;
  events: MechanicEvent[];
  reason?: string;
}

export type SessionStatus = "playing" | "won" | "lost";
export type LossReason = "out_of_moves" | "stuck";

/** What limits the attempt: a move counter or a stock of cards. Drives the HUD and the continue offer. */
export interface BudgetInfo {
  kind: "moves" | "stock";
  left: number;
  total: number;
}

export interface Evaluation {
  stars: 0 | 1 | 2 | 3;
  score: number;
  movesLeft: number;
  movesUsed: number;
  mismatches: number;
}

export interface SolveResult<A> {
  solved: boolean;
  actions: A[];
  nodes: number;
}

/**
 * A core gameplay module. Pure and deterministic: no I/O, no clocks, no globals.
 * D = level data (validated by levelDataSchema), S = immutable state, A = action.
 */
export interface CoreMechanic<D = unknown, S = unknown, A = unknown> {
  readonly id: string;
  readonly version: string;
  readonly levelDataSchema: z.ZodType<D>;
  /** Booster effects this mechanic implements. "undo" is generic and always available. */
  readonly capabilities: readonly BoosterEffect[];

  createState(data: D, opts: { seed: string; moveBonus: number }): S;
  apply(state: S, action: A, data: D): MoveResult<S>;
  status(state: S, data: D): SessionStatus;
  lossReason(state: S, data: D): LossReason | null;
  budget(state: S, data: D): BudgetInfo;
  addBudget(state: S, amount: number, data: D): S;
  evaluate(state: S, data: D): Evaluation;
  hint(state: S, data: D): A | null;
  /** Joker: performs the correct placement for the given action's source at no move cost. */
  autoPlace?(state: S, action: A, data: D): MoveResult<S>;
  shuffle?(state: S, rng: Rng, data: D): S;
  /** Structural problems with a level (empty means valid). */
  validateLevel(data: D): string[];
  solve?(data: D, opts?: { maxNodes?: number; moveBonus?: number }): SolveResult<A>;
  isAction(value: unknown): value is A;
}

/** Stars an attempt earns. A win always earns at least one star; the server applies the same rule. */
export function attemptStars(won: boolean, evaluation: Pick<Evaluation, "stars">): 0 | 1 | 2 | 3 {
  return won ? (Math.max(1, evaluation.stars) as 1 | 2 | 3) : 0;
}

export type AnyMechanic = CoreMechanic<any, any, any>;
export type MechanicRegistry = Record<string, AnyMechanic>;
