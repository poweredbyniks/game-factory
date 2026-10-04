# L. Backend: identity, attempt verification, leaderboards and purchase verification

> The game stays fully playable offline. The backend decides only what money or other players
> depend on, and it judges the client with the client's own engine.

## 1. Trust boundaries

| Owned by the client (offline-first) | Owned by the server |
|---|---|
| Moment-to-moment play, the board, undo, boosters | Anything other players see: leaderboards, event rankings |
| Soft economy for the player's own progress (coins, boosters, lives) | Anything bought with money: verified purchases, entitlements such as `no_ads`, premium currency ceilings |
| The save document on the device | The verified copy used for leaderboards and restore on a new device |

The client never waits for the server to play. It queues every finished attempt in an outbox
(`AttemptRecord`s under their own storage key, so the save written after every move stays small) and
syncs when online. The server replays each attempt and stores
verified progress. Public results use only verified progress.

Soft-economy cheating on a single-player device hurts only the cheater, and clamping it risks punishing
honest players for bugs, so the server observes and flags it. Premium currency and entitlements are
clamped to what verified purchases and verified rewards explain.

## 2. Lessons from Linkstone

Linkstone's Spring Boot backend (August 2026) implemented anonymous auth, an authoritative economy with
idempotent spends, progress sync and run validation by regenerate-and-replay. It has **no leaderboards
and no purchase verification** (its requirements defer IAP, R-4.5).

| Linkstone | Factory backend |
|---|---|
| Replays the move log through a Java port of the Dart engine, held together by cross-language vectors | Still Java, but runs the compiled TypeScript engine (`gf-engine.js`) inside the JVM through GraalJS: the same code the phone ran, no port per mechanic |
| Rejection reasons recorded (`ILLEGAL_MOVE`, `NOT_CLEARED`, `SEED_MISMATCH`, `LEVEL_LOCKED`) | Kept and extended: 13 rejection reasons, 3 "cannot judge" reasons, 3 suspicion flags |
| Idempotency key claimed in the same transaction as the spend | Kept for every write (`attemptId`, store transaction id, request keys) |
| Opaque random tokens stored hashed, rotating refresh tokens | Kept |
| `signInAnonymously(deviceId)` returns the existing player for a known device id, so whoever knows the id gets the account (its own test "signing in twice from one device returns the same player" shows it) | Install credential: a random secret in Keychain / Keystore; the id alone opens nothing |
| `RunService` grants coins for every accepted run: resubmitting one winning log with fresh idempotency keys pays again, and runs are not tied to a spent life | Level rewards on the first verified win only (the runtime's rule); attempts deduplicated by `attemptId`, which binds player, level and attempt number |
| Prices and starting balances are Java constants "kept in step" with the client by hand | The server reads the same compiled `GameBundle` as the client |
| Server-authoritative spends conflict with the offline-first requirement | Offline outbox; the server verifies afterwards |

## 3. API (v1)

All payloads are zod schemas in `engine/schemas/src/api.ts`, exported to JSON Schema (`schemas/api.*`).
The Java service mirrors them as records and tests them against those schemas and against the
fixtures `gf server-engine` writes.

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/auth/install` | `{gameId, installId, installSecret}` → tokens. First sight creates the player; later sign-ins must present the secret. |
| POST | `/v1/auth/refresh` | Rotate tokens (the presented refresh token is revoked). |
| POST | `/v1/attempts` | Up to 50 `AttemptRecord`s → one `AttemptVerdict` each. Idempotent per `(game, player, attemptId)`. The client drops every attempt that got a verdict. |
| GET | `/v1/leaderboards/{boardId}?period=` | `LeaderboardPage`: top entries plus the caller's rank. |
| POST | `/v1/purchases/verify` | `PurchaseVerificationRequest` → `PurchaseVerificationResult` (`verified`, `invalid` or `unavailable`). |
| GET, PUT | `/v1/save` | Cloud copy of the save document, for restore on a new device (Phase 5). |
| POST | `/v1/stores/apple/notifications` | App Store Server Notifications V2: refunds, revocations. |
| POST | `/v1/stores/google/rtdn` | Google real-time developer notifications (Pub/Sub push): voided purchases. |

## 4. Attempt verification (anti-cheat)

```mermaid
sequenceDiagram
  participant App
  participant API as Backend
  participant REG as Bundle registry
  participant V as GfEngine.verifyAttempt (gf-engine.js in GraalJS)
  App->>API: POST /v1/attempts [AttemptRecord…]
  API->>REG: bundle by contentHash, remote payload by version
  API->>V: replay(bundle, effective config, record)
  V-->>API: accepted (stars, score, flags) | rejected (reason) | unverifiable (reason)
  API->>API: store verdict; accepted and unflagged: update verified progress and leaderboards
  API-->>App: verdicts → acknowledgeAttempts()
```

`verifyAttempt` replays the move log with the mechanic's own rules and checks what a client could
forge:

- the record names this game, a level of the bundle the attempt was played on, and the mechanic and
  rules version the server runs;
- the seed is `player:level:attempt`, so shuffle outcomes cannot be shopped for;
- the move bonus matches the effective tuning (bundle defaults plus the reported remote payload and
  experiment variants);
- every action is legal in sequence, and nothing happens after the attempt ended;
- continues happen only when out of moves, add exactly the configured moves, and respect
  `maxContinues`; add-moves boosters add exactly their configured amount;
- boosters are allowed by the level and within their per-level limits, counted from the log rather
  than from the client's own counts;
- a claimed win must be a win in the replay; stars come from the replay.

Verdicts:

| Status | Meaning | Server action |
|---|---|---|
| `accepted` | The attempt is legal; result recomputed | Verified progress, leaderboards (unless flagged) |
| `accepted` + flags | `claimed_stars_mismatch`, `claimed_usage_mismatch`, `too_fast` | Kept off public boards until reviewed; counted per player |
| `rejected` | Provably impossible | Logged with the reason; a spike is an alert |
| `unverifiable` | Unknown content hash or rules version | Stored; judged when the server has that bundle or version. Never a cheating signal |

**Replay compatibility is a contract**, like the pinned PRNG. Every shipped bundle (store build or
over-the-air update) is published to the bundle registry before it goes live. A rules change that
alters any outcome bumps the mechanic's `version`, and the server keeps the previous version while
clients still run it. The golden test replays every level of every game through `verifyAttempt`.

**What replay cannot prove.** It proves the moves were legal, not that a person made them: a client
driven by the solver produces perfect legal logs. Mitigations: the `too_fast` flag, per-player attempt
rates bounded by the lives economy, statistical outliers (three stars on every first attempt), and
leaderboards that reward participation (weekly stars) more than one perfect score.

**Unlock order.** An accepted win on a level whose predecessor is not verified yet is stored but does
not count until the gap closes. Gaps are legitimate: the outbox keeps the latest 200 attempts.

## 5. Leaderboards

- **Configuration** is data: `leaderboards.json` (template defaults, game overrides) behind the
  `leaderboards` module flag. Metrics: `stars_total` and `levels_completed` (all time), `stars_earned`
  (weekly or daily), `event_points` (LiveOps events). The compiler checks that metric and period fit.
- **Storage**: `leaderboard_entry(game_id, board_id, period_key, player_id, value, reached_at)`, keyed by
  the first four, indexed by `(game_id, board_id, period_key, value desc, reached_at)`. Top N is an index
  scan; a player's rank is a count above them. Redis sorted sets only if a board outgrows that.
- **Names**: generated handles (adjective + noun, localized word lists), so there is no free text to
  moderate and no personal data. Game Center and Play Games boards can mirror ours later through the
  platform layer.

## 6. Purchase verification

| Store | Proof from the app | Server check | Credentials |
|---|---|---|---|
| App Store | StoreKit 2 signed transaction (JWS) | Verify the JWS chain to Apple's root with Apple's App Store Server Library for Java; check bundle id, product, environment, revocation; optionally fetch the transaction from the App Store Server API | One In-App Purchase key per developer account, shared by every game |
| Google Play | Purchase token | Play Developer API `purchases.products` lookup: purchase state, acknowledgement, order id | One service account per developer account, shared by every game |

- **Ledger**: `purchase(platform, transaction_id)` is unique, so verification is idempotent. The same
  transaction presented by a second player is `invalid`. A retry by the same player is `verified` again,
  and the client's own ledger prevents a second grant.
- **Refunds**: store notifications mark ledger rows refunded; the next sync removes refunded
  entitlements and flags refunded consumables.
- **No RevenueCat by default.** Apple and Google credentials are per developer account, so one service
  verifies every game, with first-party libraries and no revenue share. RevenueCat remains a drop-in
  `PurchaseVerifier` if running the service is not wanted.

## 7. Identity

1. On first launch the app creates `installId` and a 256-bit `installSecret` in secure storage
   (`expo-secure-store`: Keychain on iOS, Keystore on Android) and registers them.
2. Tokens follow Linkstone: opaque, hashed, 15-minute access, rotating refresh.
3. Players are scoped per game (`game_id` on every row).
4. Linking for reinstall and new devices: Sign in with Apple and Google sign-in, or Game Center and Play
   Games identities. Offering any third-party sign-in on iOS requires Sign in with Apple
   (guideline 4.8).

## 8. Technology

The backend is **Java**: the team's language, and Linkstone's stack.

- **Java 25, Spring Boot 4.1, PostgreSQL, Liquibase, Maven**: one service for every game (`game_id` on
  every row), in the monorepo as `server/` (Phase 2). Linkstone supplies proven pieces: opaque hashed
  tokens with rotation, the idempotent-operation table, the security filter, the Liquibase setup.
- **Engine inside the JVM.** `gf server-engine` compiles `@gf/core`, the mechanics and a small
  JSON-in, JSON-out facade into one script, `build/server-engine/gf-engine.js`, with a manifest of the
  engine and mechanic versions. The script uses ECMAScript built-ins only; a test runs it in an empty
  JavaScript context and requires verdicts identical to the engine's. The service evaluates it with
  GraalJS (the GraalVM Polyglot API, which runs on a standard JDK; optimized on GraalVM):
  - one shared polyglot `Engine` with a pool of `Context`s, since a context is single-threaded;
  - contexts without host access or I/O, so the script can only compute;
  - `loadBundle(json)` once per shipped bundle and context; `verifyAttempt(attempt, payload, options)`
    per attempt; `info()` reports the mechanic versions the server can judge.
- **Contracts**: Java records mirror the zod API schemas. Contract tests validate payloads against
  `schemas/api.*.schema.json` and replay `build/server-engine/fixtures/*.json` (golden and forged
  attempts with their expected verdicts) through GraalJS, so a mismatch fails the build.
- **Store libraries**: Apple's App Store Server Library for Java (signed transactions and
  notifications) and the Google Play Developer API client (`androidpublisher`).
- **Hosting**: one container plus managed PostgreSQL. AWS App Runner or ECS with RDS fits existing AWS
  experience.
- **Bundle registry**: the release pipeline uploads every shipped bundle and remote payload, keyed by
  content hash and payload version, before it reaches players. The service loads them on demand.
- **Fallback**: if GraalJS throughput ever disappoints, the same script runs in a small Node sidecar
  behind the Java service. Still the same code; never a hand port.

Planned layout of `server/`: `api` (controllers, records), `auth`, `attempts` (verification, verified
progress), `engine` (GraalJS context pool), `leaderboards`, `purchases` (App Store, Google Play,
notifications), `players`, `src/main/resources/db/changelog`. The build copies `gf-engine.js` from
`build/server-engine` into the classpath, as Linkstone copied its content.

## 9. Status and phasing

| Piece | State |
|---|---|
| API contracts (`AttemptRecord`, `AttemptVerdict`, purchase verification, `LeaderboardPage`, `LeaderboardsFile`) | done, exported to JSON Schema |
| `verifyAttempt` | done; unit-tested against forged records, golden-tested on all 40 levels of both games |
| Engine script for the JVM (`gf server-engine`): `gf-engine.js`, manifest, shipped bundles, contract fixtures | done; runs in an empty JavaScript context with verdicts identical to the engine; the GraalJS run itself is part of the Java tests (Phase 2) |
| Client outbox (`pendingAttempts`, `acknowledgeAttempts`) and the `PurchaseVerifier` seam | done |
| `server/` (Spring Boot): install auth, attempts, leaderboards, purchase verification, bundle registry | Phase 2 |
| App adapters: backend client, HTTP verifier, leaderboard screen | Phase 2 |
| Store notifications, cloud save, rate limits, rejection dashboards, rewarded-ad server-side verification | Phase 5 |
