import { z } from "zod";
import { Id, IconName, SchemaVersion, SoundName } from "./common";
import { Modules } from "./game";

export const TemplateDefinition = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: SchemaVersion,
    templateId: Id,
    name: z.string(),
    description: z.string(),
    coreLoop: z.array(z.string()).min(2).describe("Ordered steps of the core loop"),
    mechanics: z.strictObject({ default: Id, supported: z.array(Id).min(1) }),
    modules: Modules.describe("Default module switches; games override individual modules"),
    ui: z.strictObject({
      screens: z.array(Id),
      mapHud: z.array(Id),
      levelHud: z.array(Id),
    }),
    requiredIcons: z.array(IconName),
    requiredSounds: z.array(SoundName).default([]),
    requiredGameFiles: z.array(z.string()).describe("Files every game package of this template must contain"),
  })
  .meta({ title: "TemplateDefinition", description: "templates/ID/template.json" });
export type TemplateDefinition = z.infer<typeof TemplateDefinition>;
