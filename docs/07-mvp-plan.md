# G. MVP implementation plan

Small increments, each with tests, each leaving the repo green. Status reflects the code in this
repository.

## Phase 1: Vertical slice (prove the architecture)

**Goal:** one fully playable game built only from shared code plus a data package, and proof that
a second game with a different look and a different core mechanic needs no engine changes.

| # | Increment | Exit criteria | Status |
|---|---|---|---|
| 1.1 | Docs A–J, repo scaffold, workspaces, TypeScript, Vitest | `npm test` and `npm run typecheck` pass on an empty skeleton | done |
| 1.2 | `@gf/schemas`: every schema in D, JSON Schema export | Round-trip tests, unknown keys rejected | done |
| 1.3 | `@gf/core` foundations: PRNG, events, clock, inventory, energy, rewards | Unit tests incl. energy regeneration across restarts | done |
| 1.4 | `@gf/mechanic-associations`: rules, solver, generator, bot | Card conservation property test, solver solves every generated level | done |
| 1.5 | Runtime: level session, progression, story, store, ads policy, analytics, remote config, experiments, save | Golden playthrough of every level through the runtime | done |
| 1.6 | Content: word pack, template, theme, `maplebrook` package | `gf validate maplebrook --deep` passes | done |
| 1.7 | Tools: compile, validate, levels generate and analyze, simulate, schemas export | 20 levels generated, simulator report produced | done |
| 1.8 | App: theme runtime, map, board, result and continue, shop, settings, story | Playable on web and in Expo Go | done |
| 1.9 | Verification: Playwright smoke on the web build, screenshots | Level 1 won through the real UI | done |
| 1.10 | Factory proof: `create-game` + second game with another theme and the TriPeaks mechanic | Both games build from the same commit | done |
| 1.11 | Release configuration: `release.json`, `deploy/ios`, `deploy/android`, store listings, per-game icons and splash, `game.json` v2 with migration | Native config introspection shows per-game identity, no background modes, no unused permissions | done |
| 1.12 | Platform layer: per-environment services, two-phase purchases with recovery and restore, verification and notification seams, Android back | Purchase edge cases tested headlessly; production never mocked | done |
| 1.13 | Backend groundwork: API contracts, `verifyAttempt`, attempt outbox, `gf server-engine` (engine script and fixtures for the Java backend) | Every golden attempt of both games verifies; the script gives identical verdicts in an empty JavaScript context | done |
| 1.14 | Build pipeline: `eas.json` profiles, `gf build` readiness checks, `build:ios`, `build:android`, `build:all` | `gf build --dry-run` reports exactly what blocks each profile | done |
| 1.15 | Native builds: iOS and Android of both games from one commit | Installed and smoke-tested on a simulator and an emulator | **open**: needs an EAS account and one EAS project per game; not run yet by decision |

**Exit criteria for the phase:** two games, two themes, two mechanics, one engine, all tests green, and
an iOS and an Android build of each from the same commit (added by the mobile requirements).
**Result (2026-10-03):** met except 1.15. 112 unit, content, golden-playthrough, purchase and
verification tests pass; both games deep-validate with 0 errors and 0 warnings; the web smoke test wins
level 1 of both games through real taps (before the platform-layer changes; not re-run since).

## Phase 2: Generalize

Findings from Phase 1 that shape Phase 2:

- The simulator reports that lives never run out in a 20-level slice (`lives_slack`). Lives only bite
  once content is longer and harder; retune energy together with the larger level set.
- TriPeaks difficulty is capped by stock size. Tuning beyond that needs a second lever such as fewer
  wild cards or bigger layouts.
- Bot profiles are uncalibrated proxies. Real analytics (attempts per win per level) should calibrate
  knowledge and waste parameters, and `tuning.difficulty.moveBonus` can correct live games remotely.

In order:

1. Close 1.15: EAS project per game, development builds of both games on iOS (simulator) and Android,
   Maestro smoke flow on each.
2. Development build (`expo-dev-client`) with the real platform adapters, each flipping its flag in
   `capabilities.json`: StoreKit 2 / Play Billing (`expo-iap` or `react-native-iap`), AdMob or
   AppLovin MAX with Google UMP and App Tracking Transparency, Firebase Analytics and Crashlytics,
   expo-notifications.
3. Backend MVP in `server/`, Java 25 and Spring Boot ([L](12-backend.md)): GraalJS context pool running
   `gf-engine.js`, contract tests on the generated fixtures, install credentials, `POST /v1/attempts`,
   leaderboards, purchase verification for both stores, bundle registry; app adapters for sync,
   verification and a leaderboard screen.
4. Game-feel module `engine/app/src/fx`: Reanimated board animation, Skia particles, Rive, theme-driven.
5. Meta modules behind the existing module flags: daily rewards, quests, collections, buildings
   (restoration meta), LiveOps events with theme overlays.
6. Drag and drop on boards with the same select-and-target semantics.
7. Difficulty rebalancing tool: tune move budgets until the bot win-rate curve matches the target.
8. More mechanics from the reference portfolio ([A §2](01-architecture.md)), each with a board view and
   skin: `sort` (water sort, with bird sort as a rules variant and a second board view) and `maze_paint`
   (swipe input, 3D or isometric board), together with the frame extensions they need (budget `none`,
   booster `add_slot`, mechanic-owned board skins, `model` assets, mechanic-declared analytics events)
   and the `puzzle_adventure` template. Exit criterion: two non-card games, one of them 3D, with no
   frame change beyond that list. Card variants (Pyramid, Klondike-lite, association TriPeaks) follow.

## Phase 3: AI pipeline

1. `ai/` generators for briefs, concepts, characters, story, word packs, quests and localization,
   all through structured outputs bound to the zod schemas (see H).
2. Theme specification generation and the image pipeline for every required asset key (see I).
3. Review UI: a local web page that shows generated content next to validator output.

## Phase 4: Factory

1. `create-game` grows from scaffolding to the full flow: brief, AI content, AI assets, levels,
   economy tuning by simulation, validation, compile, preview build.
2. Template library: Solitaire Adventure, Solitaire Collection, Puzzle Adventure.
3. Store metadata generation and marketing screenshots from the web build.

## Phase 5: Production pipeline

1. CI on every push: typecheck, unit tests, validate every game, compile every bundle, simulator
   smoke, Playwright smoke.
2. `gf submit`: EAS Submit per game (App Store Connect, Google Play internal track), store listing and
   screenshot upload, EAS Update channels per game, release versioning.
3. Maestro flows on device farms, store screenshots, localization of store listings.
4. Release checklist automation (privacy labels and Data safety from the SDKs in use), remote-config
   deployment with rollback, bundle registry upload before every release.
5. Backend operations: store server notifications (refunds), cloud save, rate limits, rejection dashboards.

## Testing strategy

| Layer | What | Tooling |
|---|---|---|
| Rules | Legal and illegal moves, mismatch costs, win and lose, card conservation under random play | Vitest, seeded property loops |
| Solver and generator | Every generated level is solvable within its budget, generation is deterministic | Vitest |
| Systems | Inventory atomicity, energy regeneration across clock jumps, rewards, progression unlocks, ads policy, remote-config rejection, experiment stickiness | Vitest with a fake clock |
| Save | Migrations from every shipped `saveVersion`, resume by replay | Fixtures |
| Content | Every game compiles and validates, including deep solver checks | `tests/content.test.ts` |
| Golden playthrough | Solver solution for every level, played through `GameRuntime`, wins and pays rewards; every attempt then verified by `verifyAttempt` | Vitest |
| Purchases | Verify-grant-save-finish ordering, pending, interrupted, duplicate, forged, offline verification, restore | Vitest (`purchases.test.ts`) |
| Attempt verification | Forged outcomes, budgets, continues, boosters, seeds, versions | Vitest (`verify.test.ts`) |
| Release readiness | Production refuses stand-ins, placeholder ids, TODO copy, reskins; icons meet store rules | Vitest (`tools/src/build.test.ts`), `gf build --dry-run` |
| Native config | Permissions, background modes, identity per game | `npx expo config --type introspect` |
| Economy | Simulator smoke with bounds on inflation, grind and blocking | `gf simulate` in CI |
| UI smoke | Boot, map, play level 1 through clicks, win, next level unlocked | Playwright on the web export |
| Device | Same flows on iOS and Android | Maestro (Phase 5) |

## Definition of done for a new game

1. `gf validate ID --deep` passes with no errors.
2. Simulator report shows no inflation, grind or blocking flags at the target player mix.
3. Playwright smoke passes against the web build of that game.
4. Store metadata, icon and screenshots exist for every shipped locale.
5. `gf build ID --platform all --profile production --dry-run` reports no errors.
