import { z } from "zod";
import { LocKey, SchemaVersion } from "./common";

export const StringTable = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: SchemaVersion,
    locale: z.string().min(2),
    strings: z.record(LocKey, z.string()),
  })
  .meta({ title: "StringTable", description: "localization/LOCALE.json: key to text, {param} placeholders" });
export type StringTable = z.infer<typeof StringTable>;

/** Placeholders like {count} in a string, sorted and de-duplicated. */
export function placeholdersOf(text: string): string[] {
  return [...new Set([...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]!))].sort();
}
