/**
 * Lives as (count, anchor). The anchor is the moment the next life started regenerating, so the
 * value is correct across restarts and clock jumps without a running timer.
 */
export type EnergyState = { count: number; anchor: number | null };
export type EnergyConfig = { max: number; regenSeconds: number };
export type EnergyView = { count: number; max: number; nextAt: number | null; fullAt: number | null };

export function normalizeEnergy(state: EnergyState, cfg: EnergyConfig, now: number): EnergyState {
  if (state.count >= cfg.max) return { count: state.count, anchor: null };
  if (state.anchor === null) return { count: state.count, anchor: now };
  const regenMs = cfg.regenSeconds * 1000;
  const elapsed = Math.max(0, now - state.anchor);
  const gained = Math.floor(elapsed / regenMs);
  if (gained === 0) return state;
  const count = Math.min(cfg.max, state.count + gained);
  if (count >= cfg.max) return { count, anchor: null };
  return { count, anchor: state.anchor + gained * regenMs };
}

export function viewEnergy(state: EnergyState, cfg: EnergyConfig, now: number): EnergyView {
  const n = normalizeEnergy(state, cfg, now);
  const regenMs = cfg.regenSeconds * 1000;
  if (n.anchor === null) return { count: n.count, max: cfg.max, nextAt: null, fullAt: null };
  return {
    count: n.count,
    max: cfg.max,
    nextAt: n.anchor + regenMs,
    fullAt: n.anchor + (cfg.max - n.count) * regenMs,
  };
}

/** Returns the new state, or null when there is not enough energy. */
export function spendEnergy(state: EnergyState, cfg: EnergyConfig, now: number, amount = 1): EnergyState | null {
  const n = normalizeEnergy(state, cfg, now);
  if (n.count < amount) return null;
  const count = n.count - amount;
  return { count, anchor: count >= cfg.max ? null : (n.anchor ?? now) };
}

export function addEnergy(state: EnergyState, cfg: EnergyConfig, now: number, amount: number): EnergyState {
  const n = normalizeEnergy(state, cfg, now);
  const count = Math.min(cfg.max, n.count + amount);
  return { count, anchor: count >= cfg.max ? null : n.anchor };
}

export function fullEnergy(cfg: EnergyConfig): EnergyState {
  return { count: cfg.max, anchor: null };
}
