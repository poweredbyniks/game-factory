# ADR-0003: Compile step and configuration layering

**Status:** accepted · 2026-10-03

## Context

Game configuration is spread across templates, themes, content libraries and the game package.
The app must not depend on authoring formats, and invalid data must never reach a player.

## Decision

1. `gf compile ID` resolves the template, theme, content packs and game overrides into one
   versioned **GameBundle** (`bundleFormat`), validates it, and writes it with an asset registry.
2. Merge semantics: objects deep-merge, arrays replace. Precedence:
   `template defaults` < `theme` < `game files` < `game.json overrides`.
3. Every authoring file carries `schemaVersion`. The compiler migrates old versions forward, so
   old games keep building.
4. At runtime: `bundle defaults` < `remote overrides` < `experiment variant overrides`. Remote
   overrides are restricted to whitelisted roots and re-validated with the same schemas.

## Consequences

- One place to validate everything (`gf validate` = compile without writing).
- The app imports one JSON file and one generated module. Authoring formats can evolve freely.
- A broken remote payload is rejected, and the last known good payload stays active.
