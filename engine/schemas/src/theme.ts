import { z } from "zod";
import { AssetKey, Color, Id, IconName, IconRef, SchemaVersion, SoundName } from "./common";

export const Palette = z.strictObject({
  primary: Color,
  primaryDark: Color,
  secondary: Color,
  accent: Color,
  background: Color,
  backgroundAlt: Color,
  surface: Color,
  surfaceAlt: Color,
  text: Color,
  textMuted: Color,
  textOnPrimary: Color,
  success: Color,
  danger: Color,
  warning: Color,
  overlay: Color,
  cardFace: Color,
  cardFaceText: Color,
  cardBack: Color,
  cardBackAlt: Color,
  cardBorder: Color,
  categoryCard: Color,
  categoryCardText: Color,
  slotEmpty: Color,
  suitRed: Color,
  suitBlack: Color,
  mapPath: Color,
  nodeLocked: Color,
  nodeAvailable: Color,
  nodeCompleted: Color,
});
export type Palette = z.infer<typeof Palette>;

export const FontRef = z.union([
  z.strictObject({ asset: AssetKey }),
  z.strictObject({ system: z.enum(["default", "serif", "rounded", "monospace"]) }),
]);
export type FontRef = z.infer<typeof FontRef>;

export const Background = z.strictObject({
  type: z.enum(["gradient", "asset"]),
  colors: z.array(Color).min(1).max(4).describe("Gradient stops (top to bottom), or fallback color"),
  asset: AssetKey.optional(),
  decor: z.array(IconRef).default([]).describe("Decorative glyphs scattered over the background"),
  decorOpacity: z.number().min(0).max(1).default(0.35),
});
export type Background = z.infer<typeof Background>;

export const AssetSpec = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("svg"), file: z.string() }),
  z.strictObject({ type: z.literal("image"), file: z.string(), width: z.int().optional(), height: z.int().optional() }),
  z.strictObject({ type: z.literal("font"), file: z.string(), family: z.string() }),
  z.strictObject({ type: z.literal("audio"), file: z.string(), volume: z.number().min(0).max(1).default(1) }),
]);
export type AssetSpec = z.infer<typeof AssetSpec>;

export const ArtDirection = z.strictObject({
  styleKeywords: z.array(z.string()).min(1),
  rendering: z.string(),
  lineWork: z.string(),
  lighting: z.string(),
  texture: z.string(),
  perspective: z.string(),
  mood: z.array(z.string()),
  colorNotes: z.string(),
  characterStyle: z.string(),
  negative: z.array(z.string()),
  referenceDescriptors: z.array(z.string()).describe("Descriptive references only, never existing IP"),
});
export type ArtDirection = z.infer<typeof ArtDirection>;

export const ThemeDefinition = z
  .strictObject({
    $schema: z.string().optional(),
    schemaVersion: SchemaVersion,
    themeId: Id,
    name: z.string(),
    description: z.string(),
    palette: Palette,
    typography: z.strictObject({
      display: FontRef,
      body: FontRef,
      scale: z.number().min(0.75).max(1.5).default(1),
    }),
    shape: z.strictObject({
      radiusSm: z.number().nonnegative(),
      radiusMd: z.number().nonnegative(),
      radiusLg: z.number().nonnegative(),
      cardRadius: z.number().nonnegative(),
      buttonRadius: z.number().nonnegative(),
      borderWidth: z.number().nonnegative(),
    }),
    cards: z.strictObject({
      aspectRatio: z.number().min(1).max(2).describe("Card height divided by width"),
      backPattern: z.enum(["stripes", "dots", "checker", "plain"]),
      backAsset: AssetKey.optional(),
      categoryStyle: z.enum(["banner", "solid"]),
      shadow: z.enum(["none", "soft", "hard"]),
      wordCase: z.enum(["as_is", "upper"]).default("as_is"),
    }),
    backgrounds: z.strictObject({ map: Background, level: Background }),
    map: z.strictObject({
      pathStyle: z.enum(["dotted", "dashed", "solid"]),
      nodeShape: z.enum(["circle", "rounded"]),
      decor: z.array(IconRef).default([]),
    }),
    icons: z.partialRecord(IconName, IconRef),
    animation: z.strictObject({
      cardMoveMs: z.int().min(60).max(1000),
      cardFlipMs: z.int().min(60).max(1000),
      popupMs: z.int().min(60).max(1000),
      mismatchShake: z.boolean(),
      celebration: z.enum(["confetti", "leaves", "bubbles", "sparkles"]),
    }),
    vfx: z.strictObject({
      particleColors: z.array(Color).min(1),
      particleGlyphs: z.array(z.string()).default([]),
    }),
    sounds: z.partialRecord(SoundName, AssetKey),
    assets: z.record(AssetKey, AssetSpec),
    artDirection: ArtDirection,
  })
  .meta({ title: "ThemeDefinition", description: "themes/ID/theme.json: complete visual and audio identity" });
export type ThemeDefinition = z.infer<typeof ThemeDefinition>;
