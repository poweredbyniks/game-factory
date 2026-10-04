import { z } from "zod";
import { SchemaVersion } from "./common";

export const ParamSpec = z.strictObject({
  type: z.enum(["string", "int", "number", "boolean"]),
  required: z.boolean().default(true),
  description: z.string().optional(),
});
export type ParamSpec = z.infer<typeof ParamSpec>;

export const EventName = z.string().regex(/^[a-z][a-z0-9_]*$/).max(40);

export const AnalyticsTaxonomy = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: SchemaVersion,
    commonParams: z.record(z.string(), ParamSpec),
    events: z.record(
      EventName,
      z.strictObject({ description: z.string(), params: z.record(z.string(), ParamSpec).default({}) }),
    ),
  })
  .meta({ title: "AnalyticsTaxonomy", description: "analytics/events.json: every event every game emits" });
export type AnalyticsTaxonomy = z.infer<typeof AnalyticsTaxonomy>;
