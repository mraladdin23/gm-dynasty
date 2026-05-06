# Dynasty Locker Room — Master TODO List
*Updated: May 5, 2026 — B1, B2, X1, X2 resolved. Draft live polling + cache bypass added.*
*Attach with DLR_PROJECT_SUMMARY.md + specific files per task.*

---

## How to Use This Doc
Each issue is self-contained. For each session: attach this doc + project summary +
only the files listed under that issue. Fix one issue per session where possible.
After completing an issue, move it to the ✅ Completed section at the bottom.

---

## 🔴 Critical — Crashes or Broken Core Features

*(none currently)*

---

## 🔴 Yahoo Platform Bugs

*(none currently)*

---

## 🔴 MFL Platform Bugs

*(none currently)*

---

## 🟡 Cross-Platform Bugs

### X3 — League Champion Detection: H2H Tournament vs PF-Only Division Winner
**Problem:** `lc.champion` is being set based on PF ranking within the division rather than the actual H2H playoff bracket winner. Leagues with H2H playoff structures are showing the wrong champion.
**Files:** `sleeper.js`, `mfl.js`, `standings.js`, `tournament.js`
**Note:** During standings sync, `lc.champion` should prefer the bracket winner from `winners_bracket` (Sleeper) or the playoff bracket (MFL) over the regular season points leader. Audit the sync path to confirm bracket winner is being pulled correctly.

---

## 🟡 Mobile / UI Polish

*(none currently)*

---

## 🟢 Tournament — New Features & Polish

### T5 — Total Points Mode: Single-Round Multi-Week (Highest PF Wins)
**Idea:** Right now `total_points` mode forces separate "start week" and "champion week" fields, treating them like two rounds. For a true total-points playoff (e.g. weeks 15–17, highest cumulative PF is champion), it should be a single configurable window: start week + number of weeks, no separate rounds.
**Files:** `tournament.js`, `tournament.css`
**Note:** Should be a new sub-option within `total_points` mode — not a breaking change to existing config. Add a "Championship window: Wk X through Wk Y" config and a sum-based scoring path in `_renderTotalPointsTab`.

---

### T6 — H2H Bracket: Multi-Week Rounds
**Idea:** H2H bracket rounds currently assume one week per round (disabled). Add `weeksPerRound` support to H2H bracket the same way it was added to Points Rounds (T1). Each round spans N weeks; scores summed.
**Files:** `tournament.js`, `tournament.css`
**Note:** `_renderBracket` uses `_weekScoreCache` for single-week lookups. Extend to `_wsCombined_`-style summing. Config UI: add "Weeks per round" input to the bracket config section. `finalRankings` for `h2h_bracket` already exists — update it to sum correctly too.

---

### T7 — H2H Bracket + Custom Rounds: Tight Bracket Visual (World Cup Format)
**Idea:** The H2H bracket and Custom Rounds bracket views still use the old wide spacing layout. Replace with the same tight absolute-positioning bracket canvas built for World Cup (centreR0/centreOf/topOf math, cardH=44, pairG=8).
**Files:** `tournament.js`, `tournament.css`
**Note:** The World Cup `_renderWCBracketCanvas` function is the reference implementation. Extract it into a shared `_renderBracketCanvas(bracket, options)` helper usable by all bracket modes. The H2H bracket (`_renderBracket`) and the custom rounds final bracket view should both call it.

---

### T8 — Weekly Matchup Drop-Down View (ESPN-Style Matchup Page)
**Idea:** For tournaments, add a Matchups view with a week selector drop-down that shows each matchup in a card format — like an ESPN matchup page. Grouped by conference/division (the same way World Cup groups are shown with a group selector drop-down). Home team vs Away team, scores, W/L result.
**Files:** `tournament.js`, `tournament.css`, `tournaments/index.html`
**Note:** The World Cup standings view already has a week selector + matchup card pattern. Generalize that into a "Weekly Matchups" tab available in all tournament modes, pulling from `standingsCache` matchup data. Group selector drop-down for conference/division, week selector, live score refresh.

---

### T9 — Cut Line Without Advance/Eliminate Badges Until Regular Season Finishes (All Modes)
**Idea:** Across ALL tournament modes (not just World Cup), the Standings tab should show the cut line divider at all times but suppress "↑ Advances" and "Eliminated" badges until the regular season is complete. Playoff tab should show "Regular season in progress" state instead of the bracket/round view.
**Files:** `tournament.js`, `tournament.css`, `tournaments/index.html`
**Note:** This was implemented for World Cup mode (`_wcRegSeasonComplete()`). Generalize the pattern: add a `_regSeasonComplete(yr)` helper for all modes that checks the current NFL week against `po.startWeek`. Gate all advance/eliminate badge rendering and the bracket/round tab content behind this check across all modes.

---

## 🟢 Auth & Account

### A1 — Contact Email for Support
**Idea:** Add a visible support contact email somewhere accessible to users — login screen, registration confirmation, or a footer on the public site.
**Files:** `auth.css`, `index.html`, `tournaments/index.html`
**Note:** Support email is `support@dynastylockerroom.com` (Resend-verified, active). Simple text addition.

---

### A2 — Registration Confirmation Email
**Idea:** When a user submits a tournament registration, send a confirmation email acknowledging receipt.
**Files:** `tournament.js`, `worker.js`
**Note:** Resend + `support@dynastylockerroom.com` is now fully set up (used for password reset). Add a `/tournament/confirmRegistration` worker endpoint that calls Resend after a successful registration write. No new infrastructure needed — just a new worker endpoint + call from `_submitRegistration`.

---

## 🟢 UX / Notification

### U1 — Global Draft Ticker (Tournament Drafts)
**Idea:** A global sticky ticker bar (like the auction ticker) that shows: currently active tournament drafts, who is on the clock, what pick number, and how many picks until the logged-in user is up. Notification when it's their turn.
**Files:** `tournament.js`, `draft.js`, `locker.css`
**Note:** The auction module already has a ticker — study that pattern. Tournament draft picks are fetched via `tournament/draft` worker endpoint. Needs polling or Firebase listener on the draft state. On-the-clock notification could use browser `Notification API` (with permission prompt). Draft live polling (15s interval for Sleeper) is already in place from X2 fix — ticker can piggyback on that.

---

## 🟢 New Features

### F1 — Dynasty/Keeper League Overview Tab
**Idea:** For dynasty and keeper leagues, add an "Overview" tab consolidating standings
and analytics across all years, with a year selector at the top.
**Files:** `standings.js`, `profile.js`, `locker.css`
**Note:** Significant feature — needs scoping session first.

---

### F2 — Custom Playoff Tracker (Individual Leagues)
**Idea:** Define a custom playoff structure per league (e.g. Royal Rumble: bottom 4 →
winner faces next 4 → winner faces top 4 → top 2 for championship) tracked inside
DLR independent of what the platform reports. Per-league, not tournament-level.
**Files:** New module likely needed + `firebase-db.js`, `standings.js`, `index.html`
**Note:** Tournament-level playoff tracking is done (F5-P4). This is for individual league custom brackets. T7 (tight bracket canvas) should be built first as it's a shared dependency.

---

### F4 — Locker Room Visual Redesign + Team Customization
**Idea:** Redesign the main locker room UI to look like an actual locker. User can
select their favorite NFL team and the locker theme (colors, logo, textures) updates
to match. Interchangeable visual elements — door style, nameplates, decorations.
**Files:** New CSS theme system + `locker.css`, `base.css`, `profile.js`, `index.html`
**Note:** Needs design mockup attached to session.

---

### F5-P5 — Advanced Tournament (future, if needed)
- Cross-platform identity merging (Sleeper username ↔ MFL email ↔ Yahoo)
- Weekly summary emails
- Message board integration
- MFL/Yahoo authenticated standings sync

---

### F6 — Locker Room Post-It Trash Talk Wall
**Idea:** Post-it style sticky notes on lockers, stored in Firebase.
**Files:** New `postits.js` or extend `hallway.js` + `firebase-db.js`, `locker.css`, `index.html`
**Note:** Depends on F4 being done first.

---

### F7 — Custom Trophy Builder
**Idea:** SVG-based trophy composer. Saved to Firebase, displayed in Trophy Room.
**Files:** New `trophy-builder.js` + extend `trophy-room.js`, `firebase-db.js`, `locker.css`, `index.html`

---

### F8 — Hallway: H2H Records in Common Leagues
**Idea:** In the locker modal, show head-to-head record against that manager
for each common league (dynasty/keeper shows combined H2H, redraft shows per-season).
**Files:** `hallway.js`

---

## Suggested Session Order

| # | ID | Description | Effort | Files Needed |
|---|-----|-------------|--------|--------------|
| 1 | X3 | League Champion H2H Detection | Small-Med | `sleeper.js`, `standings.js`, `tournament.js` |
| 2 | T7 | Tight Bracket Canvas (H2H + Custom) | Medium | `tournament.js`, `tournament.css` |
| 3 | T6 | H2H Bracket Multi-Week Rounds | Medium | `tournament.js` |
| 4 | T5 | Total Points Multi-Week Single Round | Small-Med | `tournament.js` |
| 5 | T9 | Cut Line Gating — All Modes | Medium | `tournament.js`, `index.html` |
| 6 | T8 | Weekly Matchup Drop-Down View | Medium | `tournament.js`, `index.html` |
| 7 | U1 | Global Draft Ticker | High | `tournament.js`, `draft.js`, `locker.css` |
| 8 | A1 | Support Contact Email | Tiny | `index.html`, `tournaments/index.html` |
| 9 | A2 | Registration Confirmation Email | Small | `worker.js`, `tournament.js` |
| 10 | F8 | Hallway: H2H Records | Medium | `hallway.js` |
| 11 | F1 | Dynasty Overview Tab | High | `standings.js`, `profile.js`, `locker.css` |
| 12 | F2 | Custom Playoff Tracker (individual) | High | New module + several files |
| 13 | F7 | Custom Trophy Builder | High | `trophy-builder.js`, `trophy-room.js` |
| 14 | F4 | Locker Room Redesign + Team Theme | Very High | New theme system + CSS refactor |
| 15 | F6 | Post-It Trash Talk Wall | High | `postits.js`, `firebase-db.js`, `locker.css` |

---

## Files Reference: What to Attach for Tournament Sessions

| Scenario | Attach These Files |
|---|---|
| Any tournament.js bug or feature | `tournament.js`, `tournament.css` |
| Public site changes | `tournaments/index.html` |
| Draft board rendering | `tournament.js`, `draft.js` |
| Standings improvements | `tournament.js`, `tournament.css`, `standings.js` |
| Worker endpoint changes | `worker.js` |
| CSS consistency pass | `tournament.css`, `locker.css`, `base.css` |
| Auth / registration issues | `auth.js`, `firebase-db.js`, `tournament.js` |
| Salary issues | `salary.js`, `firebase-db.js` |

---

## Console Scripts (Safe to Run)

### Diagnose playoff qualification (open Playoffs tab first, then in console)
```js
diagQual("Smith")    // find by any name fragment — shows gender, sleeperUsername, step breakdown
diagQual("")         // dump all teams
```

### Clear public playoffs for a year (then re-publish from admin)
```js
const TID = "YOUR_TOURNAMENT_ID"; // ← replace
const YEAR = 2025;
await firebase.database().ref(`gmd/publicTournaments/${TID}/playoffs/${YEAR}`).remove();
console.log("Cleared — re-publish from admin Playoffs tab");
```

### Clear finalRankings for a year (forces re-publish to regenerate)
```js
const TID = "YOUR_TOURNAMENT_ID"; // ← replace
const YEAR = 2025;
await firebase.database().ref(`gmd/tournaments/${TID}/playoffs/${YEAR}/finalRankings`).remove();
console.log("Cleared — re-publish from admin Playoffs tab to regenerate");
```

### Clear tournament analytics cache
```js
const TID = "YOUR_TOURNAMENT_ID";
await firebase.database().ref(`gmd/tournaments/${TID}/analyticsCache`).remove();
console.log("Analytics cache cleared");
```

### Clear a single draft cache entry (use when draft shows stale pick count)
```js
const TID = "YOUR_TOURNAMENT_ID";
const CACHE_KEY = "2026_LEAGUE_ID"; // e.g. "2026_1351664853462306818"
await firebase.database().ref(`gmd/tournaments/${TID}/analyticsCache/drafts/${CACHE_KEY}`).remove();
console.log("Draft cache entry cleared");
```

### Check Yahoo token in Firebase
```js
const snap = await firebase.database().ref('gmd/users/mraladdin23/platforms/yahoo/tokens').get();
console.log('Yahoo tokens:', snap.val());
```

### Clear bundles node (safe)
```js
await firebase.database().ref('gmd/users/mraladdin23/bundles').remove();
console.log("Bundles cleared");
```

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*

---

## ✅ Completed

### May 5, 2026 — B1, B2, X1, X2: Bug Fix Session

**B1 — Password Reset (`auth.js`, `worker.js`)**
- Root cause: `sendPasswordResetEmail` was called with the user's real email, but Firebase Auth only knows the synthetic `username@gmdynasty.app` email. Also, `_restGet` requires an auth token which isn't available pre-login.
- Fix: Moved reset flow entirely to Cloudflare Worker (`/auth/passwordReset`). Worker uses Firebase DB secret to look up real email, mints a Google OAuth token from a service account JWT (scope: `identitytoolkit`), calls Firebase Auth Admin REST API with `returnOobLink: true` to generate the reset link, then sends it to the real email via Resend.
- Infrastructure added: Resend account, `support@dynastylockerroom.com` verified sender on `dynastylockerroom.com` domain, three new Worker secrets: `RESEND_API_KEY`, `FIREBASE_DB_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`.

**B2 — Salary Cap Manual Entry Not Persisting (`salary.js`)**
- Root cause: Firebase SDK local cache was returning stale pre-save data on the next `init()` call, making edits appear lost until the cache expired naturally.
- Fix: Added a fresh read from Firebase immediately after `_saveSalaryData()` writes, so `_salaryData` in memory always reflects the confirmed write.

**X1 — Registration Stickiness (`tournament.js`)**
- Root cause 1: On successful submission, the success message was written to `trn-tab-body` instead of `trn-register-page-body` (the overlay body), leaving the form visible inside the overlay.
- Root cause 2: Duplicate check used the stale `t.registrations` object loaded at page open, missing registrations submitted in the same session.
- Fix: Success message now targets `trn-register-page-body` (overlay) first. Duplicate check now fetches fresh registrations from Firebase via `_tRegsRef(tid).once("value")` before validating.

**X2 — Tournament Draft Not Updating Live (`tournament.js`, `worker.js`)**
- Root cause 1: No live listener — draft tab was fetch-on-demand only with a 24-hour Firebase cache and 5-minute in-memory cache.
- Root cause 2: Worker `tournamentDraft` preferred completed drafts over active ones — a league with both a completed startup draft and an active rookie draft would show the completed one.
- Root cause 3: Firebase cache served stale data (1 pick) even when Sleeper had 27+ picks, because the cache TTL (24h) hadn't expired.
- Fix 1: Worker now selects `"drafting"` draft first, then falls back to most recent completed.
- Fix 2: Worker returns `draft_status` in response; `tournament.js` stores it in cache entries.
- Fix 3: Cache bypass — both the 24h Firebase cache and 5-minute in-memory cache are skipped entirely when `draft_status === "drafting"`.
- Fix 4: Added `_startDraftPoll` / `_stopDraftPoll` — 15-second Sleeper polling during active drafts (Sleeper only; MFL/Yahoo still require manual refresh). Poll stops automatically when navigating away from the draft tab.

---

### May 5, 2026 — World Cup Tournament Mode: Full Implementation

**World Cup bracket + standings + players tab (tournament.js, tournaments/index.html, tournament.css)**

- **Groups + schedule:** Admin-defined groups with custom names, member assignment, advance count. Round-robin schedule builder per group, stored as `worldcupSchedule[gi][wi] = [{home, away}]`. Week selector + live Sleeper score fetch per group.
- **Group standings:** Schedule-computed W/L/PF/H2H records (not Sleeper league records). Full tiebreaker chain: 3+-way tie → overall pt diff; 2-way tie → H2H record, H2H pt diff, overall pt diff, overall PF (configurable). Cut line shown always; advance/eliminate badges only after regular season complete.
- **Bracket setup:** Tight absolute-position bracket canvas (cardH=44, pairG=8, centreR0/centreOf/topOf math) — identical on admin and public sites. Bracket hidden until all regular season weeks are scored. Qualified teams (group advancers) sorted by in-group W/L/PF/tiebreaker, not raw member order.
- **Bracket play:** Manual or random seeding for Round 1. After scores are fetched, completed rounds lock (static results). "Set [Round N] Matchups" panel appears below canvas with free-pick dropdowns populated only from winners of the completed round. ✕ Clear This Round wipes that round + all downstream for reassignment.
- **Score refresh:** `↺ Update Scores` uses `_wcTeamInfoMap` for direct cross-league score lookup (teams from different Sleeper leagues). Sums across `weeksPerRound`. Auto-fills next round slots with winners but doesn't override manual assignments.
- **Tab layout:** Playoffs tab = bracket only. Standings tab = group dropdown selector (both admin + public) with standings table + week matchup cards inline.
- **Players tab:** Group-stage W/L/PF (not Sleeper league records) used for career stats. `groupWins`/`groupLosses`/`groupPF`/`isGroupWinner` stored in `finalRankings`. Year pips: gold=bracket champion, green=won group, red=didn't win group. Titles = won group. PO appearances, rank, titles, and pips all gated behind bracket complete (champion in finalRankings). Name-matching fallback uses teamName variants in case bracket names differ from displayNames.
- **finalRankings worldcup:** Reads actual `{a,b,scoreA,scoreB}` bracket matchup objects (not flat name arrays). Champion = winner of final round. Bracket eliminated: deepest round first, same-round tie broken by score. Group-stage eliminated: ordered by group standings. Non-qualifiers: by avg group PF.
- **Custom rounds matchup assignment:** `customRounds.matchups[roundIdx][groupIdx] = [teamName, ...]` stored in Firebase. "📋 Set Matchups" button in admin. After a round is scored, inline "Set Round N+1 Matchups" panel appears with winners-only dropdowns.

---

### April 30, 2026 — T1–T4: Tournament Polish + Public Players Tab Parity

**T1 — Multi-Week Playoff Rounds (`tournament.js`)**
- Added `weeksPerRound` field (default 1) to each Points Rounds config row in the admin UI
- Round display shows "Weeks 14–15" format when `wpr > 1`
- Publish pre-fetch computes cumulative NFL week offsets across all rounds; fetches exactly the right weeks
- `_computedRounds` builder uses `_wsCombined_` + `_roundStartWeeks_` — scores summed across all weeks in the round
- Live `_renderPointsRound` async fetch, prior-round simulation, and current-round scoring all updated to use combined scores
- Fully backward-compatible: rounds without `weeksPerRound` default to 1 (no data migration needed)

**T2 — Public Players Tab Playoff Data (`tournaments/index.html`)**
- `poByYear` now reads `finalRankings` first — correct rank, qualification, and champion status
- Fallback to `po.standings` array for pre-finalRankings snapshots
- Sort: champions → years → bestRank asc → win%
- Table: Best rank and year pips columns, pip legend, 🔥 streak badge
- Modal: finishRow at bottom of each year's tbody (gold champion, green qualified, grey did not qualify)

**T3 — Custom Rounds `finalRankings` (`tournament.js`)**
- New `custom_rounds` branch in `_buildFinalRankings` simulates PF-based group advancement

**T4 — H2H Bracket `finalRankings` (`tournament.js`)**
- New `h2h_bracket` branch in `_buildFinalRankings` using `_weekScoreCache` scores

---

### April 29, 2026 — F5-P4-ext: Players Tab, Most Rostered, ADP vs Finish, finalRankings

- Players tab (internal + public): paginated, searchable, career stats, year pips, modal
- finalRankings: authoritative rank 1→N written at publish
- Most Rostered tab: cross-platform roster fetch, position filter, ownership bars
- ADP vs Finish tab: PO% vs Elim%, Swing metric, three sort views
- Cross-platform sync warnings

---

### April 29, 2026 — F5-P4: Custom Playoffs — FULLY COMPLETE

Full playoff configuration, display, live scoring, and public site integration for Tournament Mode.

---

### April 25, 2026 — UI Polish Pass (Mobile + Draft Cards + Standings)

- Roster tab mobile 2-per-row; PA column removed; standings mobile tightening
- Draft card redesign: position-colored tint, abbreviated name

### April 24, 2026 — Auth, Profile, Tournament

- Password reset (A1), delete league/platform (A2)
- Duplicate registration prevention, Rosters tab layout overhaul

### Earlier completed items

- Yahoo OAuth, standings, matchups, playoffs, roster, players, draft, transactions, analytics
- MFL playoff detection, identity matching, bundle reliability
- Auth, mobile scroll, DNS, Cloudflare Worker, Firebase token storage
- Hallway: Firebase pins, pagination, common-league modals
- F5 Phases 1–3: foundation, standings sync, public site, registration, participants, analytics

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*
