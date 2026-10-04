# ADR-0006: Platform services behind interfaces, chosen per environment

**Status:** accepted · 2026-10-03

## Context

The mobile requirements ask for one shared codebase with platform code only where Apple or Google APIs
need it, behind interfaces such as `IPurchaseService` and `INotificationService`. Phase 1 wired mocks
directly in `App.tsx`, so nothing stopped a production build from shipping a mock store that hands out
purchases for free.

## Decision

1. `@gf/core` owns the interfaces the game uses: `IapProvider`, `PurchaseVerifier`, `AdsProvider`,
   `AnalyticsProvider`, `SaveStore`, `NotificationProvider`, `RemoteConfigProvider`.
2. `engine/app/src/platform/index.ts` is the only place that picks implementations, by `APP_ENV`
   (development, staging, production). Consent (UMP, ATT) is gathered before any ad or analytics service
   starts.
3. Production never gets a development stand-in. Without a real adapter, the feature is off.
   `platform/capabilities.json` declares which adapters are real, and `gf build` refuses production
   builds that would fall back.
4. Native code only arrives as SDK packages with config plugins, or as local Expo modules shared by every
   game. Native folders are generated per game, never committed.

## Consequences

- The runtime is tested headlessly against the same interfaces the SDK adapters implement.
- Adding a real adapter is one file plus one capability flag; gameplay code does not change.
