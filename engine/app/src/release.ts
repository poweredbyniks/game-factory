import { ReleaseDefinition } from "@gf/schemas";
import raw from "./generated/release.json";

/** Store identity and per-environment endpoints of the game this build was made for. */
export const release: ReleaseDefinition = ReleaseDefinition.parse(raw);
