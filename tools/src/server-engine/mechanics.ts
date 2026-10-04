import type { MechanicRegistry } from "@gf/core";
import { associationsMechanic } from "@gf/mechanic-associations";
import { tripeaksMechanic } from "@gf/mechanic-tripeaks";

/** Rules the backend can replay. Every mechanic the apps run must be here; a test enforces it. */
export const SERVER_MECHANICS: MechanicRegistry = {
  associations: associationsMechanic,
  tripeaks: tripeaksMechanic,
};
