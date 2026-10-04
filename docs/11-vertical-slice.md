# K. First vertical slice

## Goal

Prove that one shared engine plus a data package yields a complete, playable game, and that a
second game with a different look and a different core mechanic needs no engine changes.

## Game 1: Maplebrook Word Solitaire

- **Template:** `solitaire_adventure`. **Theme:** `cozy_village`. **Mechanic:** `associations`.
- **Premise:** help the villagers of Maplebrook get ready for their seasonal fairs by sorting the
  village's jumbled word cards. Two chapters, ten levels each, a short dialogue at the start and
  end of each chapter.
- **Inspired by** the structure of word-association solitaire games: category cards, word cards,
  limited moves. Names, characters, words, story and visuals are original.

### Core rules (associations mechanic)

1. **Cards.** Each level has K categories. Each category has one **category card** and several
   **word cards**. Word cards do not show their category.
2. **Board.** Tableau columns with face-down cards under a face-up top. A stock and a waste pile.
   F foundation slots, usually fewer than K.
3. **Moves.**
   - *Draw:* tap the stock to turn one card onto the waste. When the stock is empty, tapping
     recycles the waste (configurable limit).
   - *Place a category:* move a category card into an empty foundation slot.
   - *Sort a word:* move the top word card (or a same-category run) onto its category in a slot.
   - *Stack:* move the top run onto a column whose top word belongs to the same category, or into
     an empty column.
4. **Selection.** Tap a card to select it, tap a destination to move it. A wrong association is a
   **mismatch**: the card returns and one move is spent. Impossible taps cost nothing.
5. **Flip.** Whenever a column's top is face down, it turns face up for free.
6. **Complete.** A category with all its words collected clears and frees its slot.
7. **Win:** all categories complete. **Lose:** no moves left, or no legal move remains.
8. **Boosters:** Hint (reveals a good move), Undo (reverts the last action), Joker (sorts the
   selected word into its active category for free). Continue: +5 moves for coins or a rewarded
   ad, with escalating cost.

### Meta

| System | Slice behaviour |
|---|---|
| Map | Vertical journey path, two chapters, nodes locked, current or completed with stars |
| Progression | Linear unlocks, stars from moves left, chapter completion rewards |
| Story | Intro and outro beats per chapter, three original characters |
| Lives | 5 max, one lost per failed or abandoned level, one regenerates every 20 minutes |
| Economy | Coins, gems, lives, three boosters. Rewards by stars, tier multiplier, keystone bonus |
| Shop | Coin offers for boosters and lives, IAP packs and Remove Ads through a mock store |
| Ads | Rewarded continue and an interstitial policy (min level, every N levels, cooldown), mock provider |
| Save | Versioned save document, resume of an interrupted level by move-log replay |
| Analytics | Taxonomy events through console and memory providers, validated in development |
| Remote config | Static and HTTPS providers, overrides and experiments validated before activation |

### Level curve (20 levels)

| Levels | Tier | Categories × words | Columns | Face-down per column | Slots |
|---|---|---|---|---|---|
| 1 | tutorial | 2 × 3 | 3 | 0 | 2 |
| 2–3 | easy | 3 × 3–4 | 3–4 | 1 | 3 |
| 4–9 | easy, medium | 4 × 4 | 4 | 1–2 | 3 |
| 10 | keystone | 4 × 5 | 4 | 2 | 3 |
| 11–15 | medium | 4–5 × 4–5 | 5 | 2 | 3 |
| 16–19 | hard | 5 × 5 | 5 | 2–3 | 3 |
| 20 | keystone, expert | 6 × 5 | 5 | 3 | 3 |

Move budgets come from the solver's solution length multiplied by a slack factor that tightens
over the curve. The bot estimates win rates for casual, average and expert players.

## Game 2: Palm Peaks Solitaire (factory proof)

- **Created with** `gf create-game --template solitaire_adventure --theme tropical_resort --mechanic tripeaks`.
- **Theme:** `tropical_resort` (different palette, fonts, card backs, map decor, sounds).
- **Mechanic:** `tripeaks` with standard playing cards: clear three peaks by playing cards one rank
  above or below the waste card.
- **Modules:** story off, lives on, different economy overrides.
- **Engine changes needed:** none. The new mechanic is a plug-in package plus one board view.

## Acceptance criteria

1. Both games compile and validate, with deep solver checks, from the same commit.
2. Every level of both games is won by its solver solution through `GameRuntime` (golden test).
3. The simulator runs both games and reports progression and economy health.
4. Maplebrook level 1 is won through the real web UI in a Playwright test.
5. Screenshots show the two games are visually distinct.
6. The app runs in Expo Go on a phone and in a desktop browser.
7. Added by the mobile requirements: an iOS and an Android build of each game from the same commit,
   each with its own store identity, icon and minimal native permissions.

## Out of scope for the slice

Real ads, IAP and analytics SDKs, quests, collections, buildings, daily rewards, LiveOps events,
real notifications, the backend service, drag and drop, localization beyond English, AI generation,
store submission.

## Phase 1 results (2026-10-03)

Criteria 1–6 are met. Criterion 7 is met up to the native build itself: identity, icons and
permissions are verified by config introspection, and the builds wait for an EAS project per game.

| Check | Result |
|---|---|
| Compile and deep validation, both games | 0 errors, 0 warnings, every level solved within its budget |
| Golden playthrough through `GameRuntime` | every level of both games won with three stars by the solver's line |
| Unit and content tests | 112 passing (77 at the end of the first slice; then purchases, attempt verification, release readiness, app art, the server engine script) |
| Server-side attempt verification | every golden attempt of both games (40 levels) accepted by `verifyAttempt` with three stars |
| Native configuration | per-game bundle id, package, icons and splash; no background modes, no usage strings; Android keeps `INTERNET`, `VIBRATE`, `MODIFY_AUDIO_SETTINGS` |
| Native builds | not run yet (no EAS project per game) |
| Web smoke test (`npm run e2e`) | level 1 of both games won through real taps; move or stock counter checked against the engine after every step; no console errors |
| Simulation, 500 players for 14 days | no warnings for either game after one data-only tuning pass |
| Expo Go | the app uses only modules bundled in Expo Go (SDK 57) |

Average-bot win rate per level after budget tuning (ADR-0005):

| Levels | 1–5 | 6–10 | 11–15 | 16–20 |
|---|---|---|---|---|
| Maplebrook (associations) | tutorial, 98, 100, 90, 93 | 92, 80, 82, 80, 70 | 78, 78, 75, 85, 75 | 68, 68, 65, 65, 60 |
| Palm Peaks (TriPeaks) | 97, 97, 92, 93, 85 | 80, 80, 47, 65, 82 | 65, 73, 80, 77, 75 | 55, 77, 67, 73, 72 |

The simulator found inflation (coins earned over three times coins spent) and a grinding finale on
the first pass. Halving the coins in the template's chapter chests and raising Maplebrook's finale
target cleared both, with no code change. Remaining finding: lives never run out in a 20-level
slice; that is expected and is revisited with Phase 2 content.

Deviations from the plan:

- TriPeaks draws stock and continues from a second deck, marked `:2`, so the 28-card board still
  gets a full stock.
- Palm Peaks turns the story module off and renames coins to shells through its own strings and the
  theme's coin icon, to show module toggles and per-game wording.

Screenshots of both games are written by the smoke test to `build/screenshots/<game>/`.
