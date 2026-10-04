# ADR-0010: One frame, variable boards

**Status:** accepted · 2026-10-04

## Context

The portfolio is simple casual puzzles: word-association solitaire (Solitaire Associations Journey),
color sorting (Water Sort, Magic Sort), bird sorting (Jungle Bird Sort), maze painting (Amaze GO!),
TriPeaks. Their boards differ completely: cards, liquids in tubes, birds on branches, a 3D maze; tap,
drag or swipe. Their frame is the same: a journey map, levels with stars, lives, boosters, coins, a shop,
ads, purchases, events.

## Decision

1. The frame is built once and never forked: app shell and UI, meta modules, economy, monetization,
   analytics, save, platform layer, release pipeline, backend, tools.
2. A game may bring its own board: a mechanic plug-in (pure rules, level format, generator, solver,
   bots) and a board view (any rendering inside the stack, 2D or 3D, with its own input handling), plus a
   theme with a board skin. Different boards between games are expected.
3. 3D stays inside the one stack: a board view may host a GL surface (expo-gl with three.js); the frame
   stays React Native. No second engine.
4. Before a new genre's plug-in is written, it is checked against the `CoreMechanic` contract.
   Extensions are generic (budget `none`, booster `add_slot`, mechanic-owned board skins, `model`
   assets, mechanic-declared analytics events) and land in the shared frame, never in one game.

## Consequences

- A new game costs at most one mechanic and one board view; with a reused mechanic it is data only.
- The mechanic contract grows with the portfolio, so each extension needs a schema migration and the
  golden and server-verification tests for every existing game.
- A genre that needs more than a GL board inside React Native (physics-heavy or fully 3D games) is
  outside this factory, and is the trigger to revisit the stack (ADR-0001).
