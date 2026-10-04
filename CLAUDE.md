# Working in the Game Factory repo

Casual game factory: one TypeScript engine, many data-only game packages, one Expo app shell that
produces an iOS and an Android app per game, and a Java backend (Phase 2) that runs the same engine
through GraalJS. Read `docs/01-architecture.md` before changing structure,
`docs/06-ios-android-architecture.md` before touching platform code and `docs/12-backend.md` before
touching anything the server consumes.

## Commands

- `npm run check`: typecheck every package, run all tests, deep-validate every game. Run it before saying work is done.
- `npm test` / `npx vitest run <path>`: unit, content, golden-playthrough and attempt-verification tests.
- `npm run gf -- <command>`: compile, validate, levels, simulate, create-game, assets icons, build, server-engine, schemas (see README).
- `npm run gf -- server-engine`: `build/server-engine/gf-engine.js` (the engine as one ECMAScript-only script for
  GraalJS), its manifest, shipped bundles and contract fixtures for the Java backend's tests.
- `npm run gf -- build <game> --platform ios|android|all --profile development|staging|production --dry-run`:
  release readiness without building. `GAME_ID=<game> PROFILE=<profile> npm run build:ios|build:android|build:all`
  runs EAS Build; only do that when the user asks for a build.
- `GAME_ID=<game> npm run export:web && GAME_ID=<game> npm run e2e`: browser smoke test with screenshots.
- `cd engine/app && GAME_ID=<game> npx expo config --type introspect`: the native config a build would get
  (permissions, Info.plist) without building.

## Rules that keep the factory a factory

1. `engine/core`, `engine/schemas` and `engine/mechanics/*` never import React, React Native, Expo or
   platform APIs. They compile against plain ES2022 so Node runs them (tools, tests) and GraalJS runs them
   inside the Java backend; `gf-engine.js` must keep working in an empty JavaScript context.
   Platform implementations live in `engine/app/src/platform/` behind the `@gf/core` interfaces.
2. `games/*`, `themes/*`, `templates/*`, `content/*`, `deploy/*` contain data only. A new need becomes a
   configurable feature of a shared module or a new mechanic plug-in, never code in a game folder.
   Boards may differ freely between games (rules, 2D or 3D rendering, input); the frame (shell, meta,
   economy, monetization, platform, release, backend) is never forked. See `docs/01-architecture.md` §2.
3. zod schemas in `engine/schemas` are the source of truth. Changing the meaning of a field bumps
   `schemaVersion` and adds a migration in `engine/schemas/src/migrations.ts`. Re-export JSON Schemas
   with `npm run gf -- schemas export`.
4. `levels.json` is generated. Edit `levelgen.json` and run `gf levels generate`, never hand-edit deals.
5. Determinism is a contract: do not change `createRng`/`cyrb128` (pinned by a golden test) and keep
   mechanics pure functions of `(state, action)`. The server replays attempts with the same code, so a
   change that alters any outcome bumps the mechanic's `version`.
6. Economy values, prices, rewards and timers live in configuration. Code holds formulas only.
7. Every UI string is a key in a string table. Every visual is a theme token or a semantic asset key.
8. Store-specific information (bundle ids, packages, EAS project, endpoints, ad unit ids, store SKUs,
   permissions) lives in `games/ID/release.json` over `deploy/PLATFORM/defaults.json`, never in
   `game.json` or code. Listing text lives in `games/ID/store/LOCALE.json`, app icons in `games/ID/assets/`.
9. Purchases are two-phase: verify, grant, save, then `finish()`. Production never runs a mock service:
   flip a flag in `engine/app/src/platform/capabilities.json` only together with the real adapter.

## Adding a mechanic

0. Check the genre against the `CoreMechanic` contract and the extension list in `docs/01-architecture.md`
   §2; land any extension generically in the frame (with migrations) before writing the plug-in.
1. `engine/mechanics/<id>`: level data schema, pure rules implementing `CoreMechanic`, solver,
   generator, bot, tests (rules, determinism, solvability, bot ordering, LevelSession replay).
2. Register it in `tools/src/mechanics.ts` (generate, rebalance, bot, content keys), in
   `engine/app/src/mechanics.ts` and in `tools/src/server-engine/mechanics.ts` (a test enforces the last).
3. Add a board view in `engine/app/src/boards/<id>` and register it in `boards/registry.ts`.
4. Add `templates/<template>/defaults/levelgen.<id>.json` and allow it in `template.json`.
5. `npm run check` (the golden test also replays every attempt through `verifyAttempt`), then create a
   game with it.

## Adding a game or theme

- Game: `npm run gf -- create-game --template … --theme … --mechanic … --name "…" --id … --ios-id … --android-id …`,
  then edit its strings, store listing, progression and economy overrides; tune with `gf simulate` until no
  warnings remain; check `gf build <game> --platform all --profile production --dry-run`.
- Theme: `themes/<id>/theme.json` plus assets; every icon and sound the template requires must exist.

## App notes

- `engine/app/src/generated/` is written by `gf compile <game> --app` (run by `npm run dev`, `web`,
  `export:web` and the `eas-build-post-install` hook). Never edit it.
- `app.config.ts` reads plain JSON (game, theme, release, deploy defaults, assets) and needs `GAME_ID` on EAS.
- The app shell uses state-based screens (map, level) and popups, not Expo Router: a game has no URLs.
  Android's back button goes through `useBackHandler`; popups answer before the screen under them.
- Stay inside the Expo Go module set until Phase 2 introduces a development build.
