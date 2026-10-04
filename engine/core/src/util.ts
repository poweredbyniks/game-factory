import type { ItemBag } from "@gf/schemas";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Objects merge recursively, arrays and primitives replace, undefined is ignored. Inputs are not mutated. */
export function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    out[key] = key in out ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

export function addBags(...bags: ReadonlyArray<ItemBag | undefined>): ItemBag {
  const out: ItemBag = {};
  for (const bag of bags) {
    if (!bag) continue;
    for (const [id, amount] of Object.entries(bag)) out[id] = (out[id] ?? 0) + amount;
  }
  return out;
}

/** Multiplies every amount, rounding to the nearest integer, never below 1. */
export function scaleBag(bag: ItemBag, factor: number): ItemBag {
  const out: ItemBag = {};
  for (const [id, amount] of Object.entries(bag)) out[id] = Math.max(1, Math.round(amount * factor));
  return out;
}

export function bagToString(bag: ItemBag): string {
  return Object.keys(bag)
    .sort()
    .map((id) => `${id}:${bag[id]}`)
    .join(",");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** JSON with sorted object keys, for hashing. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
