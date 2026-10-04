# Game Factory

A reusable factory for simple casual puzzle games on iOS and Android, in the vein of Solitaire
Associations Journey, Water Sort, Jungle Bird Sort and Amaze GO!. One shared frame (engine, meta,
economy, monetization, app shell, release pipeline) runs every game; each game brings its board
(rules and a 2D or 3D view) and a small package of configuration, content, theme, store identity and
icons.

> **One codebase. One game stack. Two mobile platforms. Variable content.**
> Code is shared. Content is variable. Theme is variable. Game rules are configurable. Platform code is minimal.

Two games come from the same commit:

| Game | Mechanic | Theme | Package |
|---|---|---|---|
| Maplebrook Word Solitaire | `associations`: sort word cards into categories | `cozy_village` | `games/maplebrook` |
| Palm Peaks Solitaire | `tripeaks`: clear peaks one rank up or down | `tropical_resort` | `games/palm_peaks` (made with `gf create-game`) |

## Quick start

Requires Node 22.12 or newer. Native builds run on EAS (one EAS project per game, see
[docs/10-release-pipeline.md](docs/10-release-pipeline.md)).

```bash
npm install
npm run check                          # typecheck + tests + deep validation of every game
GAME_ID=maplebrook npm run dev         # Expo dev server: scan the QR code with Expo Go
GAME_ID=palm_peaks npm run web         # play in the browser
```

## The `gf` command line

```bash
npm run gf -- validate --all --deep                 # schemas, references, strings, solvable levels, unique store ids
npm run gf -- compile maplebrook --app              # build the bundle and release config the app loads
npm run gf -- levels generate maplebrook            # regenerate levels.json from levelgen.json
npm run gf -- levels analyze maplebrook             # bot win rates for the committed levels
npm run gf -- simulate maplebrook --players 500     # economy and progression simulation
npm run gf -- create-game --template solitaire_adventure --theme tropical_resort \
                          --mechanic tripeaks --name "Palm Peaks Solitaire" --id palm_peaks \
                          --ios-id com.studio.palmpeaks --android-id com.studio.palmpeaks
npm run gf -- assets icons maplebrook               # placeholder icon, adaptive icon, splash, favicon from the theme
npm run gf -- build maplebrook --platform all --profile production --dry-run   # release readiness
npm run gf -- server-engine                         # engine script, bundles and fixtures for the Java backend
npm run gf -- schemas export                        # JSON Schemas for editors, AI and the backend API
```

Builds (EAS; the readiness checks run first and refuse unsafe builds):

```bash
GAME_ID=maplebrook PROFILE=development npm run build:all    # or build:ios, build:android
```

End-to-end smoke test against the web build (plays level 1 through real taps, saves screenshots
to `build/screenshots/<game>`):

```bash
GAME_ID=maplebrook npm run export:web && GAME_ID=maplebrook npm run e2e
```

## Repository map

| Path | What lives there |
|---|---|
| `engine/schemas` | zod schemas for every configuration file and the backend API (single source of truth) |
| `engine/core` | headless runtime: economy, lives, progression, story, shop, two-phase purchases, ads policy, analytics, remote config, experiments, save, attempt verification |
| `engine/mechanics/*` | core gameplay plug-ins with rules, solver, generator and bots |
| `engine/app` | the Expo / React Native shell; `src/platform` is the platform layer |
| `tools` | the `gf` CLI, including the engine build for the Java backend |
| `templates`, `themes`, `content`, `games`, `deploy` | data only |
| `docs` | architecture and decisions (deliverables A–K, plus L: backend) |

Start with [docs/README.md](docs/README.md).

## Status

Phase 1 (vertical slice) is complete except the native builds themselves: see
[docs/07-mvp-plan.md](docs/07-mvp-plan.md). Store identity, icons and native permissions are generated
per game and verified by config introspection; each game needs its EAS project before the first build.
Ads, purchases, consent, analytics and notifications run through development stand-ins behind real
interfaces, and production builds refuse to use them. Server-side attempt verification (`verifyAttempt`)
exists and is tested, compiled into a script the Java backend runs through GraalJS; the Spring Boot
service itself is Phase 2 ([docs/12-backend.md](docs/12-backend.md)).
