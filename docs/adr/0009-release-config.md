# ADR-0009: Store-specific configuration lives in release config

**Status:** accepted · 2026-10-03

## Context

The mobile requirements isolate store-specific information in deployment configuration (`/deploy/ios`,
`/deploy/android`) while gameplay stays shared, and want a game package to carry its own store metadata.
Phase 1 kept bundle ids in `game.json`, used the same default icon for every game, and let library
defaults decide native permissions.

## Decision

1. `game.json` schemaVersion 2 drops `platforms` and `remoteConfig.url`. Migration 1 → 2 removes them,
   and the compiler turns a version 1 file's platforms into a release definition with a warning.
2. `games/ID/release.json` holds store identity, EAS project, per-environment endpoints, ad unit ids and
   the store SKU pattern. It is merged over `deploy/ios/defaults.json` and `deploy/android/defaults.json`,
   which hold the shared policy (id prefix, iPad support, blocked permissions, store categories).
3. `games/ID/store/LOCALE.json` holds listing text, validated against the stricter limit of the two
   stores. `games/ID/assets/` holds the app icons and splash; `gf assets icons` draws placeholders from
   the theme, and release checks warn while they remain.
4. `app.config.ts` reads only these files. The compiled `GameBundle` and its content hash do not include
   release configuration, so one bundle serves every environment.

## Consequences

- A new game is still a small data package: game files, `release.json`, a listing and icons.
- Bundle ids are now checked for uniqueness across games, and store SKUs against both stores' rules.
