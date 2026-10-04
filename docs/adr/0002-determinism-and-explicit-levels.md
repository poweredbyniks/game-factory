# ADR-0002: Determinism, explicit levels and move-log replay

**Status:** accepted · 2026-10-03

## Context

Levels must be identical on every device, verifiable on a server, and reproducible in tests and
simulations. Linkstone regenerated levels from seeds at runtime, which made every generator change
a breaking change and forced a bit-identical Java port.

## Decision

1. One pinned PRNG: `sfc32`, seeded from a string with `cyrb128`. Changing either is a breaking
   change that requires a new content major version.
2. Generators run **offline** in `tools/`. Their output, the explicit deal of every level, is
   committed to `games/ID/levels.json`. The runtime never generates levels.
3. A level attempt is `{levelId, seed, actions[]}`. Mechanics are pure functions of
   `(state, action)`, so replaying the actions reproduces the attempt exactly.
4. Randomness during play (shuffle boosters) uses a session RNG seeded from the attempt seed.

## Consequences

- Generator improvements never alter shipped levels. Regenerating is an explicit content release.
- Resume after an app kill is a replay. The same payload later serves anti-cheat.
- `levels.json` is larger than a list of seeds. That is acceptable: twenty levels are about 40 KB.
