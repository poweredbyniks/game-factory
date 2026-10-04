import type { ActResult, SessionView } from "@gf/core";

/** Contract between the level screen and a mechanic's board view. */
export type BoardProps = {
  session: SessionView;
  width: number;
  height: number;
  /** Sends an action to the runtime and returns its outcome. */
  onAct: (action: unknown) => ActResult;
  /** Joker armed: the next card tap goes to onJoker instead of selecting. */
  jokerArmed: boolean;
  onJoker: (action: unknown) => void;
  /** Interactive only while the attempt is live. */
  interactive: boolean;
};
