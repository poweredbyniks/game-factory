# ADR-0008: Two-phase purchases, verified before granting

**Status:** accepted · 2026-10-03

## Context

Phase 1's `IapProvider` had `products()` and `purchase()`. Real stores also deliver transactions outside
that call (interrupted purchases, Ask to Buy, pending payments, promoted purchases). They require a
restore path for non-consumables (App Store review) and acknowledgement within three days (Google Play
refunds otherwise). The runtime granted after the provider returned, so a crash could lose a paid
purchase, and a redelivery could grant it twice.

## Decision

1. `IapProvider` gains `unfinished()`, `finish(transaction, consumable)` and `restore()`. `purchase()`
   returns `purchased` with a transaction, or `pending`, `cancelled` or `failed`.
2. The runtime processes every transaction the same way: verify with the `PurchaseVerifier`, grant, record
   the transaction id in the save, write the save, and only then `finish()`.
3. `invalid` transactions are finished without a grant. `unavailable` ones stay with the store and are
   retried by `reconcilePurchases()` at launch and on foreground.
4. `restorePurchases()` is user-initiated and only restores entitlements.
5. Production verification runs on our backend with Apple's and Google's first-party libraries; one set
   of credentials per developer account covers every game. RevenueCat is not used by default.

## Consequences

- Exactly-once delivery is tested: interrupted, pending, duplicate, forged, offline and restore cases.
- Production purchases depend on the backend being reachable; the store keeps unverified transactions,
  so an outage delays grants and never loses them.
