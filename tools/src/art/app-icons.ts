import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ThemeDefinition } from "@gf/schemas";
import { Canvas, circle, hexColor, mix, polygon, roundedRect, star, stroke, type Rgba, type Sdf } from "./canvas";
import { PLACEHOLDER_MARK, encodePng, pngInfo } from "./png";

/**
 * Placeholder app identity art, drawn from the theme palette so every game gets a distinct icon
 * from its first build. Final art from the asset pipeline replaces these files; release checks
 * warn while a placeholder is still in place.
 */
export type AppArtFile = { file: string; size: number; opaque: boolean; minSize: number; purpose: string };
export const APP_ART: AppArtFile[] = [
  { file: "icon.png", size: 1024, opaque: true, minSize: 1024, purpose: "iOS and store icon (no transparency)" },
  { file: "adaptive-icon.png", size: 1024, opaque: false, minSize: 432, purpose: "Android adaptive icon foreground" },
  { file: "adaptive-icon-monochrome.png", size: 1024, opaque: false, minSize: 432, purpose: "Android 13+ themed icon" },
  { file: "splash.png", size: 1024, opaque: false, minSize: 512, purpose: "Splash screen image" },
  { file: "favicon.png", size: 48, opaque: true, minSize: 32, purpose: "Web favicon (development builds)" },
];

type Palette = ThemeDefinition["palette"];
type Emblem = "word" | "peaks" | "star";
type Fan = { cx: number; cy: number; scale: number; mono: boolean };

const emblemFor = (mechanic: string): Emblem => (mechanic === "associations" ? "word" : mechanic === "tripeaks" ? "peaks" : "star");
const WHITE: Rgba = [255, 255, 255, 1];

/** Three fanned cards; all geometry is in a 1024 unit square, scaled by `u` (pixels per unit). */
function drawFan(c: Canvas, u: number, palette: Palette, emblem: Emblem, fan: Fan): void {
  const s = fan.scale * u;
  const color = (hex: string, alpha = 1): Rgba => (fan.mono ? WHITE : hexColor(hex, alpha));
  const w = 340 * s;
  const h = 470 * s;
  const r = 40 * s;
  const box = (x: number, y: number, extent: number) => ({ x0: x - extent, y0: y - extent, x1: x + extent, y1: y + extent });
  const cards = [
    { dx: -150, dy: 40, angle: -0.28, back: true },
    { dx: 150, dy: 40, angle: 0.28, back: true },
    { dx: 0, dy: 0, angle: 0, back: false },
  ];
  for (const card of cards) {
    const x = fan.cx * u + card.dx * s;
    const y = fan.cy * u + card.dy * s;
    const shape = roundedRect(x, y, w, h, r, card.angle);
    const area = box(x, y, 300 * s + 30 * u);
    if (!fan.mono) c.fill(roundedRect(x + 10 * s, y + 18 * s, w, h, r, card.angle), [0, 0, 0, 0.22], area);
    c.fill(shape, color(card.back ? palette.cardBack : palette.cardFace), area);
    if (fan.mono) continue;
    c.fill(stroke(shape, 10 * s), color(palette.cardBorder), area);
    if (card.back) c.fill(stroke(roundedRect(x, y, w - 56 * s, h - 56 * s, r - 16 * s, card.angle), 10 * s), color(palette.cardBackAlt), area);
  }
  if (fan.mono) return;
  const cx = fan.cx * u;
  const cy = fan.cy * u;
  const at = (dx: number, dy: number): readonly [number, number] => [cx + dx * s, cy + dy * s];
  const area = box(cx, cy, 260 * s);
  if (emblem === "word") {
    c.fill(roundedRect(cx, cy - 150 * s, 260 * s, 70 * s, 18 * s), color(palette.categoryCard), area);
    for (const [dy, width] of [[-30, 220], [30, 180], [90, 200]] as const) {
      c.fill(roundedRect(cx, cy + dy * s, width * s, 26 * s, 13 * s), color(palette.cardFaceText, 0.75), area);
    }
    c.fill(star(cx + 105 * s, cy + 165 * s, 34 * s, 15 * s), color(palette.accent), area);
  } else if (emblem === "peaks") {
    c.fill(polygon([at(-150, 130), at(-80, 10), at(-10, 130)]), color(palette.secondary), area);
    c.fill(polygon([at(10, 130), at(80, 10), at(150, 130)]), color(palette.secondary), area);
    c.fill(polygon([at(-90, 130), at(0, -110), at(90, 130)]), color(palette.primary), area);
    c.fill(star(cx, cy - 170 * s, 44 * s, 20 * s), color(palette.accent), area);
  } else {
    c.fill(star(cx, cy, 120 * s, 52 * s), color(palette.accent), area);
  }
}

function render(palette: Palette, emblem: Emblem, art: AppArtFile): Buffer {
  const size = art.size;
  const u = size / 1024;
  const c = new Canvas(size, size);
  const full: Sdf = () => -1;
  if (art.file === "icon.png" || art.file === "favicon.png") {
    const top = hexColor(palette.primary);
    const bottom = hexColor(palette.primaryDark);
    c.fill(full, (_x, y) => mix(top, bottom, y / size));
    const glow = hexColor(palette.accent);
    c.fill(circle(512 * u, 420 * u, 470 * u), (x, y) => {
      const fade = 1 - Math.min(1, Math.hypot(x - 512 * u, y - 420 * u) / (470 * u));
      return [glow[0], glow[1], glow[2], 0.28 * fade * fade];
    });
    drawFan(c, u, palette, emblem, { cx: 512, cy: 545, scale: 0.92, mono: false });
  } else if (art.file === "adaptive-icon.png") {
    drawFan(c, u, palette, emblem, { cx: 512, cy: 530, scale: 0.74, mono: false });
  } else if (art.file === "adaptive-icon-monochrome.png") {
    drawFan(c, u, palette, emblem, { cx: 512, cy: 530, scale: 0.74, mono: true });
  } else {
    drawFan(c, u, palette, emblem, { cx: 512, cy: 520, scale: 1, mono: false });
  }
  return encodePng(size, size, c.data, { opaque: art.opaque, text: { Software: PLACEHOLDER_MARK } });
}

/** Writes the placeholder art into games/ID/assets; existing files are kept unless `force`. */
export function writeAppArt(gameDir: string, theme: ThemeDefinition, mechanic: string, opts: { force?: boolean } = {}): { written: string[]; kept: string[] } {
  const dir = join(gameDir, "assets");
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const kept: string[] = [];
  for (const art of APP_ART) {
    const path = join(dir, art.file);
    if (existsSync(path) && !opts.force) {
      kept.push(art.file);
      continue;
    }
    writeFileSync(path, render(theme.palette, emblemFor(mechanic), art));
    written.push(art.file);
  }
  return { written, kept };
}

export type AppArtProblem = { file: string; problem: string; severity: "error" | "warning" };

/** Checks games/ID/assets against the stores' icon rules. Placeholder art is reported as a warning. */
export function checkAppArt(gameDir: string): AppArtProblem[] {
  const problems: AppArtProblem[] = [];
  for (const art of APP_ART) {
    const path = join(gameDir, "assets", art.file);
    if (!existsSync(path)) {
      problems.push({ file: art.file, severity: "error", problem: `missing (${art.purpose}); run "gf assets icons"` });
      continue;
    }
    const info = pngInfo(readFileSync(path));
    if (!info) problems.push({ file: art.file, severity: "error", problem: "not a PNG file" });
    else if (info.width !== info.height || info.width < art.minSize) {
      problems.push({ file: art.file, severity: "error", problem: `must be square and at least ${art.minSize}px, found ${info.width}x${info.height}` });
    } else if (art.opaque && art.file === "icon.png" && (info.alpha || info.width !== 1024)) {
      problems.push({ file: art.file, severity: "error", problem: "the App Store icon must be 1024x1024 without transparency" });
    } else if (info.placeholder) {
      problems.push({ file: art.file, severity: "warning", problem: "placeholder art; replace it with final art before release" });
    }
  }
  return problems;
}
