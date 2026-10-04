# ADR-0005: Difficulty is tuned with bots, not by hand

**Status:** accepted · 2026-10-03

## Context

Random deals vary wildly in difficulty. In the first Maplebrook generation pass, sized only by
solution length, an "easy" level won 10% of casual attempts while a "medium" one won all of them.
Hand-tuning hundreds of levels per game does not scale to one game a month.

## Decision

1. Every mechanic ships an imperfect-information bot with three profiles (casual, average, expert).
   Bots see only face-up cards. Associations bots have a per-word knowledge rate. All bots waste moves
   at a profile-specific rate, because humans peek and misplay.
2. `levelgen.json` curve segments declare a target: profile plus win rate. The tools search the budget
   (moves for associations, stock size for TriPeaks) for the smallest one that meets the target. The
   bot never reads the budget, so one batch of runs yields the whole win-rate curve.
3. Deals where experts lose more than average players ("skill inversion") are re-dealt: they punish
   good play.
4. Solvability is always proven by the perfect-information solver; bots only size the budget.

## Consequences

- Generating and tuning 20 levels takes about a second. Curves are smooth by construction.
- Bot profiles are proxies. Phase 2 calibrates them against real attempts-per-win analytics, and the
  remote `tuning.difficulty.moveBonus` corrects live games without a release.
