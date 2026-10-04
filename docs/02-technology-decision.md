# B. Technology decision (ADR-0001)

**Status:** accepted 2026-10-03; re-evaluated against the mobile requirements (see the end of this document) and confirmed 2026-10-04

## Decision

A **TypeScript monorepo**:

| Concern | Choice |
|---|---|
| Client (iOS, Android, web preview) | **React Native via Expo** (SDK 57, managed workflow, Continuous Native Generation) |
| Engine, mechanics, tools, simulators | **TypeScript on Node**, the same packages the app imports |
| Schemas and validation | **zod v4**, exported to JSON Schema for editors and AI structured outputs |
| Tests | **Vitest** (unit, content, golden playthroughs), **Playwright** on the web build (smoke, screenshots), **Maestro** on devices (Phase 5) |
| AI content pipeline | **Anthropic TypeScript SDK** with zod structured outputs (Phase 3) |
| Builds and releases | **EAS Build / Submit / Update**, one EAS project per game, driven by `gf build` |
| Analytics, remote config, crash reporting | **Firebase** through `@react-native-firebase` adapters (Phase 2/5); remote config also as a plain HTTPS payload |
| Ads | **AdMob with mediation** (`react-native-google-mobile-ads`) or **AppLovin MAX** RN plugin, behind `AdsProvider`; consent through Google UMP and ATT |
| IAP | **StoreKit 2 / Google Play Billing** through an Expo-compatible library (`expo-iap` or `react-native-iap`) behind `IapProvider`, verified by our backend ([ADR-0008](adr/0008-two-phase-purchases.md)) |
| Game feel | **Reanimated** (UI-thread animation), **React Native Skia** (particles, effects), **Rive** (authored animation), in one shared module (Phase 2) |
| Notifications | **expo-notifications** behind `NotificationProvider` |
| Backend | **Java 25 + Spring Boot + PostgreSQL**, running the compiled engine through GraalJS ([L](12-backend.md)) |

## Context

- Solo developer or very small team, AI-assisted (Claude Code) as the default way of working.
- Target cadence of about one game per month, iOS and Android first.
- Genre: solitaire, card and word puzzles with heavy meta UI (map, shop, popups), light rendering.
- The factory needs headless tooling that runs the real game rules: generators, solvers,
  bots, economy simulators, validators, golden tests.
- Existing experience in this workspace: Unity 2022.3 (installed 2023–24), Flutter
  (Linkstone Solitaire, August 2026, 5k lines and 156 tests), Expo with TypeScript
  (1000 for 1, July 2026), Java and Spring on the backend.

## Options compared

Scores are 1 (poor) to 5 (excellent) **for this team and this genre**, not in general.

| Criterion | Unity | Godot 4 | Flutter + Flame | Native Swift + Kotlin | **RN + Expo** | Capacitor + PixiJS | Cocos Creator | Defold |
|---|---|---|---|---|---|---|---|---|
| 2D performance for card games | 5 | 5 | 5 | 5 | 4 | 3 | 5 | 5 |
| Animation, particles and VFX | 5 | 4 | 3 | 3 | 3 | 4 | 4 | 4 |
| Audio (SFX latency, music) | 5 | 4 | 3 | 5 | 3 | 3 | 4 | 4 |
| Notifications (local and push) | 4 | 2 | 5 | 5 | 5 | 4 | 3 | 3 |
| Headless automated tests of game rules | 3 | 3 | 4 | 3 | 5 | 5 | 2 | 2 |
| CI/CD and store deployment | 3 | 3 | 4 | 3 | 5 | 4 | 3 | 4 |
| Asset management, theme swap | 4 | 4 | 3 | 2 | 4 | 5 | 4 | 3 |
| Mobile deployment | 4 | 3 | 4 | 5 | 5 | 4 | 3 | 4 |
| IAP | 5 | 2 | 4 | 5 | 5 | 4 | 3 | 4 |
| Ads with mediation | 5 | 2 | 4 | 5 | 4 | 3 | 3 | 4 |
| Analytics and remote config | 5 | 3 | 5 | 5 | 5 | 4 | 3 | 3 |
| AI-assisted development | 2 | 3 | 4 | 3 | 5 | 5 | 2 | 2 |
| Iteration speed | 3 | 4 | 5 | 2 | 5 | 5 | 3 | 4 |
| Same code in client, tools and server | 3 | 2 | 3 | 1 | 5 | 5 | 4 | 2 |
| Many games from one codebase | 4 | 3 | 3 | 2 | 5 | 3 | 3 | 3 |
| Over-the-air updates | 2 | 1 | 3 | 1 | 5 | 5 | 3 | 2 |
| Maintainability for a solo dev | 3 | 4 | 4 | 2 | 4 | 4 | 3 | 4 |
| Fit with recent experience | 2 | 1 | 5 | 2 | 4 | 3 | 1 | 1 |

Notes behind the scores:

- **Unity** is the industry default for this genre and has the best monetization SDK story.
  It loses on the factory-specific criteria: editor-centric workflow, scene and prefab files that
  AI agents edit poorly, slow iteration, license activation in CI, and tooling that needs a separate
  .NET library to share rules with simulators.
- **Godot** has a lovely 2D workflow and text scene files, but ads mediation and IAP plugins are
  community-maintained. That is the revenue path of this business, so the risk is too high.
- **Flutter** is the strongest alternative and the one with existing code (Linkstone). It loses on
  three factory concerns:
  1. Per-game builds need flavors with hand-maintained native config per game (schemes,
     product flavors, Firebase files, icons). Expo generates the native projects per game from
     `app.config.ts`, so a game stays pure configuration.
  2. Linkstone had to port its rules engine and PRNG to Java with a cross-language vector suite
     for server validation. With TypeScript, the Java backend runs the compiled engine through GraalJS.
  3. The AI pipeline is first-class in TypeScript: the official Anthropic SDK accepts the same zod
     schemas that validate the game configuration. Dart has no official SDK.
- **Native** doubles the code. Not viable for one developer and twelve games a year.
- **Capacitor + PixiJS** maximises web reach and AI friendliness, but renders in a WebView and
  AppLovin MAX would need a custom native bridge. Rejected: the stores are the product.
- **Cocos Creator** and **Defold** are capable 2D engines with smaller Western ecosystems,
  editor-centric workflows and weaker AI support.

## Why React Native via Expo

1. **One engine everywhere.** Rules, generators, solvers, bots, simulators, validators, AI generators
   and the app share one TypeScript codebase and one set of schemas. The Java backend runs the same
   compiled engine through GraalJS and mirrors the schemas through JSON Schema.
2. **A game is configuration.** `app.config.ts` reads `GAME_ID`, and the native iOS and Android
   projects are generated from it. Twelve games do not mean twelve native projects to maintain.
3. **Release automation exists.** EAS Build, Submit and Update cover signing, store upload and
   over-the-air JavaScript and content updates per game channel.
4. **Native rendering, not a WebView.** Text-heavy word cards use the platform's text engine,
   which matters for localization. Animations run on the native driver.
5. **Mature SDKs.** Firebase, AdMob, AppLovin MAX, RevenueCat and Sentry all ship maintained
   React Native packages with Expo config plugins.
6. **The best language for AI pair programming.** Everything is text, every check runs headless.

## What we give up

- Flutter's rendering headroom and the existing Linkstone client code. Mitigation: card games are
  light. Linkstone's principles carry over (pure rules engine, solution-verified levels, pinned
  PRNG, move-log replay, lives as count plus anchor timestamp).
- Unity's VFX tooling and editor. Mitigation: Reanimated, Skia and Rive cover the effects this genre
  needs, in one shared game-feel module rather than per game.

## Architectural consequences

1. `engine/core` and `engine/mechanics/*` are pure TypeScript with no React Native imports, so
   Node runs them for tools, tests and simulation.
2. A single Expo app in `engine/app` hosts every game. `GAME_ID` selects the compiled bundle and
   the native identity at build time. Native folders are generated, not committed.
3. Phase 1 stays inside the Expo Go module set: no custom native code. Any phone with Expo Go can
   run the vertical slice. Ads, IAP and Firebase arrive with a development build in Phase 2.
4. Performance rules for board views: animate only `transform` and `opacity` with the native
   driver, memoize cards by id, never re-layout the whole tree on each move.
5. Over-the-air policy: `runtimeVersion` follows the native dependency set. Rules fixes, UI changes
   and content ship over the air per game channel. Tuning ships through remote config.
6. The web build is a development and test target only (Playwright smoke tests, screenshots,
   shareable playtests). The products are the iOS and Android apps.
7. Backend: a Java (Spring Boot) service that runs the compiled engine (`gf server-engine`) through GraalJS
   to replay attempts, never a port ([ADR-0007](adr/0007-backend-trust-boundaries.md)).
8. The stack is standardized for the whole factory: one client technology, no second front end.

## Revisit when

- A game needs particle-heavy effects or 3D that Skia and Rive cannot deliver at 60 fps on a
  mid-range Android phone.
- Ad revenue measurably lags a Unity control game with the same content.

## Re-evaluation against the mobile requirements (2026-10-03)

The mobile requirements ask for a stack that "must prioritize mobile game production … rather than
general-purpose app development". React Native is a general-purpose app framework, so Unity was
re-examined as the closest fit to that wording.

Unity is better at what a game engine does: particles, timeline animation, audio mixing, and
monetization SDKs that every ad network ships first. This factory, though, makes games that are mostly
interface: map, popups, shop, events, collections, around a board of cards with short tweens and a
celebration effect. The factory-specific needs also favour TypeScript and Expo:

- **Headless rules**: generators, solvers, bots, the economy simulator, golden tests and now
  server-side attempt verification run the exact client code in Node.
- **AI-driven development**: everything is text that tests can check; Unity scenes and prefabs are not.
- **Per-game native projects**: Expo generates them from configuration; Unity needs scripted
  per-game build setup.
- **Over-the-air updates**: fixes and content ship without a store review.

Decision: keep React Native with Expo as the single stack, on three conditions:

1. **Game feel is a shared module, not an afterthought.** Phase 2 builds `engine/app/src/fx`:
   Reanimated for board animation on the UI thread, Skia for particles (win bursts, coin flights),
   Rive for authored character and UI animation, all driven by theme tokens. The Phase 1 app still uses
   React Native's built-in `Animated`.
2. **Native builds early.** The first EAS builds of both games come before any SDK work, so problems
   with native configuration or the New Architecture surface early. Native configuration is already
   checked by introspection.
3. **Mobile platform features through first-party seams.** StoreKit 2 / Play Billing, UMP + ATT,
   expo-notifications and the ads SDKs sit behind `@gf/core` interfaces
   ([F](06-ios-android-architecture.md)).

**2D and 3D boards stay in the one stack.** The reference portfolio ([A §2](01-architecture.md))
mixes card boards, liquid and sprite boards, and a 3D-looking maze. Card boards use React Native views
and SVG; liquids, particles and 2.5D use Skia; characters use Rive or Lottie; a 3D board renders a GL
surface with three.js (expo-gl, react-three-fiber) inside the React Native frame. These are rendering
libraries within the stack, not a second engine ([ADR-0010](adr/0010-unified-frame-variable-boards.md)).

Confirmed by the product owner on 2026-10-04.
