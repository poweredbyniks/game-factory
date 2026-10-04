import type { MechanicRegistry } from "@gf/core";
import { associationsMechanic } from "@gf/mechanic-associations";
import { tripeaksMechanic } from "@gf/mechanic-tripeaks";

/** Every mechanic this app shell can run. Board views are registered in boards/registry.ts. */
export const MECHANICS: MechanicRegistry = {
  associations: associationsMechanic,
  tripeaks: tripeaksMechanic,
};
