# ADR-0004: The association is the puzzle

**Status:** accepted · 2026-10-03

## Context

In association solitaire the player must work out which category each word belongs to. Many
solitaire apps move a tapped card to the best destination automatically. Doing that here would
reveal every association for free and remove the core challenge.

## Decision

- Interaction is **select, then target**: tap a card or run, then tap a foundation slot or column.
  Drag and drop is a later presentation option with the same semantics.
- A wrong association is a **mismatch**: the card returns and, when `mismatchCostsMove` is on,
  one move is spent. Structurally impossible taps are **illegal** and cost nothing.
- Revealing associations is a paid effect: the **Hint** and **Joker** boosters.

## Consequences

- The rules engine distinguishes `applied`, `mismatch` and `illegal`, and analytics records
  mismatches as a difficulty signal.
- Solvers and bots must model knowledge separately from structure. The solver has perfect
  information. The bot has a per-word knowledge probability.
