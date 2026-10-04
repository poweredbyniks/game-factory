import type { ComponentType } from "react";
import { AssociationsBoard } from "./associations/AssociationsBoard";
import { TriPeaksBoard } from "./tripeaks/TriPeaksBoard";
import type { BoardProps } from "./types";

/** One board view per mechanic id. Everything else on the level screen is shared. */
export const BOARDS: Record<string, ComponentType<BoardProps>> = {
  associations: AssociationsBoard,
  tripeaks: TriPeaksBoard,
};
