import { SCHEMA_REGISTRY } from "@gf/schemas";
import { AssociationGenParams, AssociationLevelData } from "@gf/mechanic-associations";
import { TriPeaksGenParams, TriPeaksLevelData } from "@gf/mechanic-tripeaks";
import { z } from "zod";
import { rootPath, writeJson } from "./paths";

/** Writes one JSON Schema per authoring file kind, for editors ("$schema") and AI structured outputs. */
export function exportSchemas(): string[] {
  const written: string[] = [];
  const entries: Array<{ name: string; schema: z.ZodType }> = [
    ...SCHEMA_REGISTRY.map((e) => ({ name: e.name, schema: e.schema })),
    { name: "mechanic-associations.level-data", schema: AssociationLevelData },
    { name: "mechanic-associations.gen-params", schema: AssociationGenParams },
    { name: "mechanic-tripeaks.level-data", schema: TriPeaksLevelData },
    { name: "mechanic-tripeaks.gen-params", schema: TriPeaksGenParams },
  ];
  for (const { name, schema } of entries) {
    const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
    const file = rootPath("schemas", `${name}.schema.json`);
    writeJson(file, json, false);
    written.push(`schemas/${name}.schema.json`);
  }
  return written;
}
