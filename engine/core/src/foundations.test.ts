import { describe, expect, it } from "vitest";
import { addEnergy, normalizeEnergy, spendEnergy, viewEnergy } from "./energy";
import { continueCost, levelRewardBag, resolveRewardRef } from "./rewards";
import { createRng, hash32 } from "./rng";
import { makeBundle } from "./test-support";
import { deepMerge, stableStringify } from "./util";
import { balanceOf, canAfford, grant, initialWallet, spend } from "./wallet";

describe("rng", () => {
  it("is pinned: these values are part of the content contract", () => {
    const rng = createRng("gf");
    const values = [rng.next(), rng.next(), rng.next()].map((v) => v.toFixed(10));
    expect(values).toMatchInlineSnapshot(`
      [
        "0.2782289691",
        "0.1910907088",
        "0.6448178256",
      ]
    `);
    expect(hash32("maplebrook")).toMatchInlineSnapshot(`2306792031`);
  });

  it("is deterministic per seed and independent across forks", () => {
    const a = createRng("seed");
    const b = createRng("seed");
    expect(Array.from({ length: 5 }, () => a.int(1000))).toEqual(Array.from({ length: 5 }, () => b.int(1000)));
    const f1 = createRng("seed").fork("deal");
    const f2 = createRng("seed").fork("other");
    expect(f1.next()).not.toEqual(f2.next());
  });

  it("shuffles into a permutation and respects ranges", () => {
    const rng = createRng("shuffle");
    const items = Array.from({ length: 50 }, (_, i) => i);
    const out = rng.shuffle(items);
    expect(out).not.toEqual(items);
    expect([...out].sort((x, y) => x - y)).toEqual(items);
    for (let i = 0; i < 500; i++) {
      const v = rng.range(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
    }
  });
});

describe("energy", () => {
  const cfg = { max: 5, regenSeconds: 60 };
  const t0 = 1_000_000;

  it("regenerates one unit per interval and stops at max", () => {
    const spent = spendEnergy({ count: 5, anchor: null }, cfg, t0, 2)!;
    expect(spent).toEqual({ count: 3, anchor: t0 });
    expect(viewEnergy(spent, cfg, t0 + 59_000).count).toBe(3);
    expect(viewEnergy(spent, cfg, t0 + 60_000).count).toBe(4);
    expect(viewEnergy(spent, cfg, t0 + 60_000).nextAt).toBe(t0 + 120_000);
    expect(viewEnergy(spent, cfg, t0 + 10 * 60_000)).toEqual({ count: 5, max: 5, nextAt: null, fullAt: null });
  });

  it("keeps partial progress when spending mid-regeneration", () => {
    const s = { count: 3, anchor: t0 };
    const later = spendEnergy(s, cfg, t0 + 90_000)!; // one regenerated (4), then spend -> 3
    expect(later.count).toBe(3);
    expect(later.anchor).toBe(t0 + 60_000);
  });

  it("refuses to spend below zero and tolerates clocks going backwards", () => {
    expect(spendEnergy({ count: 0, anchor: t0 }, cfg, t0)).toBeNull();
    expect(normalizeEnergy({ count: 2, anchor: t0 }, cfg, t0 - 5000)).toEqual({ count: 2, anchor: t0 });
  });

  it("adds without exceeding max", () => {
    expect(addEnergy({ count: 4, anchor: t0 }, cfg, t0, 3)).toEqual({ count: 5, anchor: null });
  });
});

describe("wallet and rewards", () => {
  const { economy, levels } = makeBundle();

  it("spends atomically", () => {
    const w = initialWallet(economy);
    expect(spend(w, economy, { coins: 50, gems: 1 }, 0)).toBe(false);
    expect(w.inventory.coins).toBe(100);
    expect(spend(w, economy, { coins: 50, hint: 1 }, 0)).toBe(true);
    expect(w.inventory).toMatchObject({ coins: 50, hint: 0 });
  });

  it("clips grants at caps and treats lives as energy", () => {
    const w = initialWallet(economy);
    expect(grant(w, economy, { joker: 20 }, 0)).toEqual({ joker: 9 });
    expect(canAfford(w, economy, { lives: 5 }, 0)).toBe(true);
    expect(spend(w, economy, { lives: 2 }, 0)).toBe(true);
    expect(balanceOf(w, economy, "lives", 0)).toBe(3);
    expect(balanceOf(w, economy, "lives", 1200_000)).toBe(4);
    expect(() => grant(w, economy, { dragons: 1 }, 0)).toThrow(/unknown item/);
  });

  it("computes level rewards with tier and keystone multipliers", () => {
    expect(levelRewardBag(economy, levels[0]!, 3)).toEqual({ coins: 30 });
    expect(levelRewardBag(economy, levels[3]!, 2)).toEqual({ coins: 120 }); // 20 x hard 2 x keystone 3
    expect(levelRewardBag(economy, { ...levels[0]!, reward: { gems: 1 } }, 1)).toEqual({ gems: 1 });
    expect(resolveRewardRef(economy, "ch1_chest")).toEqual({ coins: 100, hint: 1 });
    expect(() => resolveRewardRef(economy, "missing")).toThrow();
  });

  it("escalates continue costs and holds at the last step", () => {
    expect(continueCost(economy, 0)).toEqual({ coins: 40 });
    expect(continueCost(economy, 1)).toEqual({ coins: 80 });
    expect(continueCost(economy, 5)).toEqual({ coins: 80 });
  });
});

describe("util", () => {
  it("deep merges objects and replaces arrays", () => {
    const base = { a: { b: 1, c: [1, 2] }, d: 1 };
    expect(deepMerge(base, { a: { c: [9] }, e: 2 })).toEqual({ a: { b: 1, c: [9] }, d: 1, e: 2 });
    expect(base.a.c).toEqual([1, 2]);
  });

  it("stringifies with stable key order", () => {
    expect(stableStringify({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}');
  });
});
