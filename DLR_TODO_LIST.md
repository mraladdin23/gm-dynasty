# Dynasty Locker Room — Master TODO List
*Updated: May 14, 2026 — Custom Playoffs v4 complete, draft ticker bugs fixed, shared leagueSettings fix, tournament redesign scoped.*
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

*(none currently)*

---

## 🟡 Mobile / UI Polish

*(none currently)*

---

## 🟢 Tournament — Redesign & New Features

### T-REDESIGN — Tournament Creation: Step-by-Step Modal
**Priority:** High — current dropdown-based flow is confusing; hard to know what applies globally vs per-year vs per-round.

**Problem:** The tournament admin panel has grown organically. Settings are scattered across multiple dropdowns, and it's unclear what's a one-time setup (name, platform, structure) vs what changes year-to-year (league batches, playoff config, scoring) vs what's set each week (matchup assignments). New commissioners don't know where to start.

**Goal:** Replace (or supplement) the current flow with a guided step-by-step modal for creating a new tournament, and a cleaner "per-year settings" panel for returning commissioners.

**Proposed steps for creation wizard:**

1. **Tournament Identity** — Name, description, format (public/private), platform(s)
2. **Structure** — Number of divisions/conferences, teams per league, number of leagues total
3. **Scoring & Playoff Mode** — Points-based / H2H bracket / World Cup / Custom; tiebreakers
4. **Season Schedule** — Regular season weeks, playoff start week, weeks per round
5. **Qualification Rules** — How teams qualify (record, points, division winners); bye seeds
6. **Leagues** — Add league batches (existing flow, just reorganized into this step)
7. **Review & Create**

**Per-year settings panel** (for existing tournaments adding a new year):
- Clone prior year config as starting point
- Modify only what changed (new leagues, updated schedule, playoff mode tweaks)

**MFL at scale note:** For tournaments with 1000+ MFL leagues, the weekly matchup scoring fetch must use `/mfl/liveScoringBatch` (already built). The creation wizard should guide commissioners toward the batch endpoint automatically when league count exceeds ~50.

**Files:** `tournament.js`, `tournament.css`, `index.html`
**Note:** Large feature. Scope carefully before coding — keep the existing admin panel working in parallel until the wizard is proven. The wizard should write the same Firebase structure as today (no migration needed).

---

### A2 — Registration Confirmation Email
**Idea:** When a user submits a tournament registration, send a confirmation email acknowledging receipt.
**Files:** `tournament.js`, `worker.js`
**Note:** Resend + `support@dynastylockerroom.com` is fully set up (used for password reset). Add a `/tournament/confirmRegistration` worker endpoint that calls Resend after a successful registration write. No new infrastructure needed.

### F9 — Tournament League Invite Emails
**Idea:** From the tournament admin panel, send email invites to participants to join their specific league on the platform (Sleeper, MFL, Yahoo).
**Files:** `tournament.js`, `worker.js`
**Note:** Resend is already wired. Button in Participants tab per participant row. Scoping needed.

---

## 🟢 Auth & Account

*(none currently — A1 contact email already added)*

---

## 🟢 New Features

### F1 — Dynasty/Keeper League Overview Tab
**Idea:** For dynasty and keeper leagues, add an "Overview" tab consolidating standings and analytics across all years, with a year selector at the top.
**Files:** `standings.js`, `profile.js`, `locker.css`
**Note:** Significant feature — needs scoping session first.

### F4 — Locker Room Visual Redesign + NFL Team Themes
**Idea:** Allow users to choose an NFL team theme for their locker room — team colors applied to the card UI, header, and background tint.
**Files:** `locker.css`, `profile.js`, `app.js`
**Note:** Nice-to-have polish. Low priority.

### F6 — Post-It Trash Talk Wall
**Idea:** A per-league digital "trash talk wall" — sticky notes posted by managers, visible to all league members.
**Files:** `chat.js` (reference), new module
**Note:** Tournament message board (💬 Board tab) already built — same Firebase + chat bubble pattern. Scope for individual leagues.

### F7 — Custom Trophy Builder
**Idea:** Admin can design and award custom trophies to participants. Displayed in the player's profile.
**Files:** `trophy-room.js`, `tournament.js`, `locker.css`
**Note:** Fun feature. Low priority.

---

## 🔧 Console Scripts (for surgical Firebase fixes)

### Diagnose custom playoffs visibility for a league
```js
// While viewing-as another user, open the league detail then run:
await Profile.diagnoseCustomPlayoffs()
// Shows: meta state, firebase personal path, shared leagueSettings path
// If shared_customPlayoff_exists is false: open league as commish → Custom Playoffs tab → re-save once
```

### Diagnose draft ticker pick calculation
```js
// While a draft is live:
await DraftTicker.diagnosePickCalc()
// Or for a specific league:
await DraftTicker.diagnosePickCalc("leagueId")
// Shows: mySlot, myRosterId, tradeMap, slot_to_roster_id, next 30 picks with origRoster/curOwner/isMe
```

### Clear stale draft cache for one league
```js
const tid = "YOUR_TID";
const lid = "YOUR_LEAGUE_ID";
await firebase.database().ref(`gmd/tournaments/${tid}/analyticsCache/drafts/${lid}`).remove();
console.log("Draft cache cleared for", lid);
```

### Clear bundles node (safe)
```js
await firebase.database().ref('gmd/users/mraladdin23/bundles').remove();
console.log("Bundles cleared");
```

### Force-republish public summaries (if playoffMode/createdBy missing)
Open DLR while logged in as admin — `_backfillPublicSummaries()` runs automatically on tournament page load and republishes any stale public nodes.

### Rebuild draftWatchIndex for all users (admin Worker endpoint)
```
GET https://mfl-proxy.mraladdin23.workers.dev/draft/rebuildWatchIndex
```

### Diagnose draft ticker for a specific user (admin Worker endpoint)
```
GET https://mfl-proxy.mraladdin23.workers.dev/draft/diagnose?username=USERNAME
```

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*

---

## ✅ Completed

### May 14, 2026 — Draft Ticker: Two Critical Pick-Calculation Bugs Fixed (`draft-ticker.js`)

**Bug 1 — `totalTeams` from `draft_order` key count:**
`draft_order` only contains entries for human owners — CPU/empty slots are absent. A 12-team league with one unfilled slot showed 11 teams, breaking all round/pick math (e.g. round 5 pick 2 instead of round 4 pick 11).
Fix: `settingsTeams` stored from `draft.settings.teams` in `_checkSleeperDirect`. All round/pick math now uses `settingsTeams || Object.keys(draft_order).length`.

**Bug 2 — `slot_to_roster_id` empty causing wrong `myRosterId`:**
When `slot_to_roster_id` was absent from the cache, `myRosterId` fell back to the slot number (e.g. 11) instead of the correct roster ID (e.g. 1). The ticker was computing "my next pick" for a completely different team.
Fix: `_computeMyNextPick` now returns `null` immediately if `slot_to_roster_id` is empty — shows nothing rather than a wrong pick.

**Traded picks at initial load:**
`_checkSleeperDirect` now fetches `/draft/{id}/traded_picks` in parallel with picks for live/paused drafts. Previously only `_refreshLiveDrafts` (panel-open) did this, so the initial ticker state never had trade data.

**`diagnosePickCalc(leagueId?)` added:**
Full per-pick trace from console — mySlot, myRosterId, tradeMap keys, slot_to_roster_id, next 30 picks with origRoster/curOwner/isMe. Essential for future debugging.

---

### May 14, 2026 — Custom Playoffs Tab Visibility Fix (`profile.js`, `firebase-db.js`)

**Problem:** Custom Playoffs tab only appeared for the commish (the user who enabled it). Other league members couldn't see it even when viewing the same league.

**Root cause:** `customPlayoff` config was written only to `gmd/users/{username}/leagueMeta/{leagueKey}` (personal path). The `saveLeagueMetaEntry` shared fields whitelist in `firebase-db.js` did not include `customPlayoff`, so it never reached `gmd/leagueSettings/{leagueId}` — the shared path that all members read via `getSharedLeagueSettings`.

**Fix 1 — `firebase-db.js`:** Added `customPlayoff` to the shared fields written to `leagueSettingsRef(leagueId)` when `meta.isCommissioner` is true.

**Fix 2 — `profile.js`:** The `setMetaCallback` registered in the Custom Playoffs tab handler now calls `saveLeagueMeta(_currentUsername, lk, { customPlayoff: cfg })` in addition to updating memory — routing through `GMDB.saveLeagueMetaEntry` to hit the shared path on every save.

**Fix 3 — Tab visibility:** `_buildDetailTabs` shows the Custom Playoffs tab if `meta.customPlayoffEnabled || meta.customPlayoff` (OR, not AND) — covers view-as scenarios where the flag is in the commish's personal meta but the config is in shared settings.

**Backfill for existing leagues:** Open the league as commish → Custom Playoffs tab → re-save setup once. Triggers the callback and writes to the shared path.

**`Profile.diagnoseCustomPlayoffs()` added:** Call from console to inspect personal meta, shared leagueSettings, and tab visibility state for any league.

---

### May 14, 2026 — Custom Playoffs v4 (`customplayoffs.js`, `locker.css`, `profile.js`)

**Layout rewrite:** Replaced canvas/absolute-positioning bracket with vertical `bracket-section` layout matching the normal Sleeper/MFL playoffs in `standings.js`. Each round is a `bracket-section` with label + `bracket-section-games` grid. Cards use `bracket-match` / `bracket-slot` — same CSS already used by standings. No more cramped horizontal scroll.

**N-team matchups:** Each matchup card supports any number of teams. Teams ranked by score (descending) when scores available. `bracket-slot--win` (green) on top `advanceCount`, `bracket-slot--lose` (faded/strikethrough) on rest. Seed tag shown. "Top N advance" footer for groups > 2.

**Round selector:** Commish always sees "Manage Matchups" panel with tabs for every round — can clear/reassign any round at any time (previously the panel disappeared once all rounds were assigned).

**Standings persistence:** `updateRegStandings` saves `regStandings` and `regSeasonEndWeek` to Firebase immediately on "↺ Update Standings" click — no need to hit Save separately. `init()` restores from `config.regStandings` on reload.

**Duplicate prevention:** `_syncSelects()` disables already-selected teams across all dropdowns in the assignment panel after every change.

**Bug fixes:** `_addAssignMatchup` `insertBefore` crash fixed (was matching nested `.btn-secondary` instead of direct child — now uses `:scope > .btn-secondary`). `− Team` button now uses same `btn-secondary btn-sm` style as `+ Team`.

---

### May 14, 2026 — `players-db.js` Concurrent Load Bug Fixed

**Problem:** When `DLRPlayers.load()` was called concurrently (mobile, multiple components initializing), the early-return path `return _loadingPromise` returned the raw `Promise.all` result — an array — instead of `_sleeperCache`. Player ID lookups against an array always returned `undefined`, giving raw IDs as player names on mobile.

**Fix:** Changed to `await _loadingPromise; return _sleeperCache` with `try/finally` to null out `_loadingPromise`. Concurrent callers now get the actual player dict.

---

### May 12, 2026 — Draft Ticker Overhaul: Sleeper-First Client Architecture
*(see previous entries)*

### May 12, 2026 — Admin Impersonation (`app.js`, `index.html`)
*(see previous entries)*

### May 12, 2026 — Hallway F8: H2H Records in Common Leagues
*(see previous entries)*

### May 12, 2026 — Tournament Private Flag
*(see previous entries)*

### May 12, 2026 — Mobile Draft Ticker / Activity Pills
*(see previous entries)*

### Earlier completed items
*(see previous DLR_TODO_LIST.md versions)*

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*
