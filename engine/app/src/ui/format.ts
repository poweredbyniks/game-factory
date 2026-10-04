import type { ItemBag } from "@gf/schemas";

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function bagEntries(bag: ItemBag): Array<[string, number]> {
  return Object.entries(bag).filter(([, v]) => v > 0);
}
