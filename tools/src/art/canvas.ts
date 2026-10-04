/** A tiny anti-aliased rasterizer: shapes are signed distance functions, negative inside. */

export type Rgba = readonly [number, number, number, number];
export type Sdf = (x: number, y: number) => number;
export type Box = { x0: number; y0: number; x1: number; y1: number };

export function hexColor(hex: string, alpha = 1): Rgba {
  const h = hex.replace("#", "");
  const a = h.length === 8 ? Number.parseInt(h.slice(6, 8), 16) / 255 : 1;
  return [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(2, 4), 16), Number.parseInt(h.slice(4, 6), 16), a * alpha];
}

export function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

export class Canvas {
  readonly data: Uint8Array;
  constructor(readonly width: number, readonly height: number) {
    this.data = new Uint8Array(width * height * 4);
  }

  /** Fills a shape. `paint` may vary per pixel (gradients); `box` limits the work to the shape's bounds. */
  fill(sdf: Sdf, paint: Rgba | ((x: number, y: number) => Rgba), box?: Box): void {
    const x0 = Math.max(0, Math.floor(box?.x0 ?? 0));
    const y0 = Math.max(0, Math.floor(box?.y0 ?? 0));
    const x1 = Math.min(this.width, Math.ceil(box?.x1 ?? this.width));
    const y1 = Math.min(this.height, Math.ceil(box?.y1 ?? this.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const coverage = Math.min(1, Math.max(0, 0.5 - sdf(x + 0.5, y + 0.5)));
        if (coverage <= 0) continue;
        const color = typeof paint === "function" ? paint(x + 0.5, y + 0.5) : paint;
        this.blend((y * this.width + x) * 4, color, coverage);
      }
    }
  }

  private blend(i: number, [r, g, b, a]: Rgba, coverage: number): void {
    const src = a * coverage;
    if (src <= 0) return;
    const dst = this.data[i + 3]! / 255;
    const out = src + dst * (1 - src);
    const channel = (s: number, d: number) => Math.round((s * src + d * dst * (1 - src)) / out);
    this.data[i] = channel(r, this.data[i]!);
    this.data[i + 1] = channel(g, this.data[i + 1]!);
    this.data[i + 2] = channel(b, this.data[i + 2]!);
    this.data[i + 3] = Math.round(out * 255);
  }
}

export const circle = (cx: number, cy: number, r: number): Sdf => (x, y) => Math.hypot(x - cx, y - cy) - r;

/** Rounded rectangle centred on (cx, cy), rotated by `angle` radians. */
export function roundedRect(cx: number, cy: number, w: number, h: number, r: number, angle = 0): Sdf {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const lx = Math.abs(dx * cos + dy * sin) - (w / 2 - r);
    const ly = Math.abs(-dx * sin + dy * cos) - (h / 2 - r);
    return Math.hypot(Math.max(lx, 0), Math.max(ly, 0)) + Math.min(Math.max(lx, ly), 0) - r;
  };
}

/** Any simple polygon (convex or not). */
export function polygon(points: ReadonlyArray<readonly [number, number]>): Sdf {
  return (px, py) => {
    let best = Infinity;
    let sign = 1;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i++) {
      const [ix, iy] = points[i]!;
      const [jx, jy] = points[j]!;
      const ex = jx - ix;
      const ey = jy - iy;
      const wx = px - ix;
      const wy = py - iy;
      const t = Math.min(1, Math.max(0, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
      best = Math.min(best, (wx - ex * t) ** 2 + (wy - ey * t) ** 2);
      const a = py >= iy;
      const b = py < jy;
      const c = ex * wy > ey * wx;
      if ((a && b && c) || (!a && !b && !c)) sign = -sign;
    }
    return sign * Math.sqrt(best);
  };
}

export function star(cx: number, cy: number, outer: number, inner: number, points = 5): Sdf {
  const vertices: Array<[number, number]> = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    vertices.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return polygon(vertices);
}

/** A shape's edge band: |sdf| - width / 2. */
export const stroke = (sdf: Sdf, width: number): Sdf => (x, y) => Math.abs(sdf(x, y)) - width / 2;
export const offset = (sdf: Sdf, dx: number, dy: number): Sdf => (x, y) => sdf(x - dx, y - dy);
export const expand = (sdf: Sdf, by: number): Sdf => (x, y) => sdf(x, y) - by;
