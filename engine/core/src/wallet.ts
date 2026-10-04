import type { EconomyDefinition, ItemBag } from "@gf/schemas";
import { addEnergy, normalizeEnergy, spendEnergy, type EnergyState } from "./energy";

/** The part of the save document the wallet owns. Lives live in `energy`, everything else in `inventory`. */
export type WalletState = { inventory: Record<string, number>; energy: EnergyState };

function energyItem(economy: EconomyDefinition): string | null {
  return economy.energy?.item ?? null;
}

export function balanceOf(state: WalletState, economy: EconomyDefinition, itemId: string, now: number): number {
  if (economy.energy && itemId === energyItem(economy)) {
    return normalizeEnergy(state.energy, economy.energy, now).count;
  }
  return state.inventory[itemId] ?? 0;
}

export function balancesOf(state: WalletState, economy: EconomyDefinition, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of economy.items) out[item.id] = balanceOf(state, economy, item.id, now);
  return out;
}

export function canAfford(state: WalletState, economy: EconomyDefinition, cost: ItemBag, now: number): boolean {
  return Object.entries(cost).every(([id, amount]) => balanceOf(state, economy, id, now) >= amount);
}

/** All-or-nothing. Returns false and changes nothing when any item is short. */
export function spend(state: WalletState, economy: EconomyDefinition, cost: ItemBag, now: number): boolean {
  if (!canAfford(state, economy, cost, now)) return false;
  for (const [id, amount] of Object.entries(cost)) {
    if (economy.energy && id === energyItem(economy)) {
      const next = spendEnergy(state.energy, economy.energy, now, amount);
      if (!next) throw new Error("energy spend failed after affordability check");
      state.energy = next;
    } else {
      state.inventory[id] = (state.inventory[id] ?? 0) - amount;
    }
  }
  return true;
}

/** Grants a bag, clipping at caps. Returns what was actually granted. Unknown items throw. */
export function grant(state: WalletState, economy: EconomyDefinition, bag: ItemBag, now: number): ItemBag {
  const granted: ItemBag = {};
  for (const [id, amount] of Object.entries(bag)) {
    const def = economy.items.find((i) => i.id === id);
    if (!def) throw new Error(`grant: unknown item "${id}"`);
    if (economy.energy && id === energyItem(economy)) {
      const before = normalizeEnergy(state.energy, economy.energy, now).count;
      state.energy = addEnergy(state.energy, economy.energy, now, amount);
      const delta = state.energy.count - before;
      if (delta > 0) granted[id] = delta;
      continue;
    }
    const current = state.inventory[id] ?? 0;
    const next = def.cap !== undefined ? Math.min(def.cap, current + amount) : current + amount;
    state.inventory[id] = next;
    if (next > current) granted[id] = next - current;
  }
  return granted;
}

export function initialWallet(economy: EconomyDefinition): WalletState {
  const inventory: Record<string, number> = {};
  for (const item of economy.items) {
    if (economy.energy && item.id === economy.energy.item) continue;
    inventory[item.id] = item.initial;
  }
  const lives = economy.energy ? economy.items.find((i) => i.id === economy.energy!.item)?.initial ?? economy.energy.max : 0;
  return { inventory, energy: { count: lives, anchor: null } };
}
