import type { LevelDefinition } from "@gf/schemas";
import type { BudgetInfo, CoreMechanic, Evaluation, LossReason, MechanicEvent, MoveOutcome, MoveResult, SessionStatus } from "./mechanic";
import { createRng } from "./rng";

/** Why budget was added: a paid continue after running out, or an add-moves booster during play. */
export type BudgetSource = "continue" | "booster";

/** One entry of the replayable move log. */
export type SessionAction<A> =
  | { t: "act"; a: A }
  | { t: "auto"; a: A }
  | { t: "undo" }
  | { t: "budget"; n: number; src?: BudgetSource }
  | { t: "shuffle" };

/**
 * One attempt at one level. Owns undo history and the move log. Mechanic-agnostic: undo,
 * continues and replay work the same for every mechanic.
 */
export class LevelSession<D = unknown, S = unknown, A = unknown> {
  state: S;
  readonly log: SessionAction<A>[] = [];
  lastOutcome: MoveOutcome | null = null;
  lastEvents: MechanicEvent[] = [];
  private history: S[] = [];
  private shuffles = 0;

  constructor(
    readonly mechanic: CoreMechanic<D, S, A>,
    readonly level: LevelDefinition,
    readonly data: D,
    readonly seed: string,
    readonly moveBonus: number,
  ) {
    this.state = mechanic.createState(data, { seed, moveBonus });
  }

  status(): SessionStatus {
    return this.mechanic.status(this.state, this.data);
  }
  lossReason(): LossReason | null {
    return this.mechanic.lossReason(this.state, this.data);
  }
  budget(): BudgetInfo {
    return this.mechanic.budget(this.state, this.data);
  }
  evaluate(): Evaluation {
    return this.mechanic.evaluate(this.state, this.data);
  }
  hint(): A | null {
    return this.status() === "playing" ? this.mechanic.hint(this.state, this.data) : null;
  }
  canUndo(): boolean {
    return this.history.length > 0;
  }

  act(action: A): MoveResult<S> {
    const result = this.mechanic.apply(this.state, action, this.data);
    this.record(result, { t: "act", a: action });
    return result;
  }

  autoPlace(action: A): MoveResult<S> {
    if (!this.mechanic.autoPlace) return { outcome: "illegal", state: this.state, events: [], reason: "unsupported" };
    const result = this.mechanic.autoPlace(this.state, action, this.data);
    if (result.outcome !== "applied") return result;
    this.record(result, { t: "auto", a: action });
    return result;
  }

  undo(): boolean {
    const previous = this.history.pop();
    if (previous === undefined) return false;
    this.state = previous;
    this.log.push({ t: "undo" });
    this.lastOutcome = null;
    this.lastEvents = [];
    return true;
  }

  /** Adds budget to the current state and to the undo history, so undo never takes a paid bonus back. */
  addBudget(amount: number, src?: BudgetSource): void {
    this.state = this.mechanic.addBudget(this.state, amount, this.data);
    this.history = this.history.map((s) => this.mechanic.addBudget(s, amount, this.data));
    this.log.push(src ? { t: "budget", n: amount, src } : { t: "budget", n: amount });
  }

  shuffle(): boolean {
    if (!this.mechanic.shuffle) return false;
    const rng = createRng(`${this.seed}/shuffle/${this.shuffles++}`);
    this.history.push(this.state);
    this.state = this.mechanic.shuffle(this.state, rng, this.data);
    this.log.push({ t: "shuffle" });
    return true;
  }

  private record(result: MoveResult<S>, entry: SessionAction<A>): void {
    this.lastOutcome = result.outcome;
    this.lastEvents = result.events;
    if (result.state === this.state) return; // illegal: nothing changed, nothing logged
    this.history.push(this.state);
    this.state = result.state;
    this.log.push(entry);
  }

  /** Rebuilds a session from its move log. Throws if the log does not replay cleanly. */
  static replay<D, S, A>(
    mechanic: CoreMechanic<D, S, A>,
    level: LevelDefinition,
    data: D,
    seed: string,
    moveBonus: number,
    actions: readonly unknown[],
  ): LevelSession<D, S, A> {
    const session = new LevelSession(mechanic, level, data, seed, moveBonus);
    for (const [index, raw] of actions.entries()) {
      const entry = raw as SessionAction<A>;
      const fail = (why: string) => new Error(`replay failed at action ${index}: ${why}`);
      switch (entry?.t) {
        case "act":
        case "auto": {
          if (!mechanic.isAction(entry.a)) throw fail("not an action");
          const result = entry.t === "act" ? session.act(entry.a) : session.autoPlace(entry.a);
          if (result.outcome === "illegal") throw fail(`illegal ${entry.t}`);
          break;
        }
        case "undo":
          if (!session.undo()) throw fail("nothing to undo");
          break;
        case "budget":
          if (!Number.isInteger(entry.n) || entry.n <= 0) throw fail("budget must be a positive integer");
          session.addBudget(entry.n, entry.src);
          break;
        case "shuffle":
          if (!session.shuffle()) throw fail("shuffle unsupported");
          break;
        default:
          throw fail("unknown entry");
      }
    }
    return session;
  }
}
