import { GameBundle } from "@gf/schemas";
import raw from "./generated/bundle.json";

/** The compiled game this build was made for. Validated once at startup. */
export const bundle: GameBundle = GameBundle.parse(raw);
