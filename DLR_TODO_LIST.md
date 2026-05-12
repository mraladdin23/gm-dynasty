# Dynasty Locker Room — Master TODO List
*Updated: May 12, 2026 — Draft Ticker overhauled (Sleeper-first client), Hallway H2H, Admin Impersonation, tournament private flag.*
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

*(none currently — X3 de-prioritized, may not be a real issue)*

---

## 🟡 Mobile / UI Polish

*(none currently)*

---

## 🟢 Tournament — New Features & Polish

### A2 — Registration Confirmation Email
**Idea:** When a user submits a tournament registration, send a confirmation email acknowledging receipt.
**Files:** `tournament.js`, `worker.js`
**Note:** Resend + `support@dynastylockerroom.com` is fully set up (used for password reset). Add a `/tournament/confirmRegistration` worker endpoint that calls Resend after a successful registration write. No new infrastructure needed — just a new worker endpoint + call from `_submitRegistration`.

---

## 🟢 Auth & Account

*(none currently — A1 contact email already added)*

---

## 🟢 UX / Notification

*(none currently)*

---

## 🟢 New Features

### F1 — Dynasty/Keeper League Overview Tab
**Idea:** For dynasty and keeper leagues, add an "Overview" tab consolidating standings and analytics across all years, with a year selector at the top.
**Files:** `standings.js`, `profile.js`, `locker.css`
**Note:** Significant feature — needs scoping session first.

---

### F2 — Custom Playoff Tracker (Individual Leagues)
**Idea:** Define a custom playoff structure per league (e.g. Royal Rumble format) tracked inside DLR.
**Files:** `standings.js`, `locker.css`
**Note:** Significant feature — needs scoping session first.

---

### F4 — Locker Room Visual Redesign + NFL Team Themes
**Idea:** Allow users to choose an NFL team theme for their locker room — team colors applied to the card UI, header, and background tint.
**Files:** `locker.css`, `profile.js`, `app.js`
**Note:** Nice-to-have polish. Low priority.

---

### F6 — Post-It Trash Talk Wall
**Idea:** A per-league digital "trash talk wall" — sticky notes posted by managers, visible to all league members.
**Files:** `chat.js` (reference), `tournament.js` or new module
**Note:** The tournament message board (💬 Board tab) was just built — can use the same Firebase + chat bubble pattern. Scope for individual leagues, not just tournaments.

---

### F7 — Custom Trophy Builder
**Idea:** Admin can design and award custom trophies to participants (e.g. "Worst Drafter", "Injury Magnet"). Displayed in the player's profile.
**Files:** `trophy-room.js`, `tournament.js`, `locker.css`
**Note:** Fun feature. Low priority.

---

### F9 — Tournament League Invite Emails
**Idea:** From the tournament admin panel, send email invites to participants to join their specific league on the platform (Sleeper, MFL, Yahoo).
**Files:** `tournament.js`, `worker.js`
**Note:** Resend is already wired. Scoping needed — probably a button in the Participants tab per participant row.

---

## 🔧 Console Scripts (for surgical Firebase fixes)

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
Scans all users' Firebase leagues and writes `gmd/draftWatchIndex/{username}` for each. Safe to re-run. Returns JSON with per-user league counts.

### Diagnose draft ticker for a specific user (admin Worker endpoint)
```
GET https://mfl-proxy.mraladdin23.workers.dev/draft/diagnose?username=USERNAME
```
Returns: watchIndex leagues, filter results, draftStatus vs Sleeper cross-check, mismatches, and summary.

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*

---

## ✅ Completed

### May 12, 2026 — Draft Ticker Overhaul: Sleeper-First Client Architecture

**Problem:** Draft ticker was entirely dependent on the Worker cron writing to `gmd/draftStatus` before clients could see anything. Worker's pending queue (15/run) meant newly registered leagues could wait hours. Users like orkneybowl with 66 leagues had 4 live drafts the Worker never processed.

**Solution — Client is now self-sufficient (`draft-ticker.js`):**
- `_initialLoad()` completely rewritten: checks Sleeper directly (`/league/{id}/drafts`) for ALL leagues in parallel on every page load. No Worker dependency for discovery.
- `_checkSleeperDirect(leagueId)` — new helper that fetches draft status from Sleeper, builds a full status object, fetches picks for live/paused drafts. Returns null if no active draft.
- `_pollLeague()` rewritten to call `_checkSleeperDirect` instead of Firebase — client stays fresh with no Worker lag.
- `_initialLoad` supplements from Firebase draftStatus only to enrich live drafts with traded_picks.
- `mostRecentSeason` filter added to `_buildWatchList` — dynasty chains now correctly include only the current-season entry. Drops from 135 → 20 leagues for typical user.
- Tournament section in `_buildWatchList` refactored — no longer adds all 336 BOTS leagues; only annotates leagues already in the user's own league list with tournament name.
- `diagnose()` added to public API — call `DraftTicker.diagnose()` from browser console for full report.
- Verbose `console.log` added throughout `init()` for easy debugging.
- `?tickerDebug=1` URL param shows a visible overlay with all three steps (watchList, Sleeper results, display).

**Worker cron simplified (`worker.js`):**
- Now reads `gmd/draftWatchIndex` (single read) instead of scanning all users' Firebase leagues per run.
- Also reads `gmd/draftStatus` and unions leagues from both sources.
- Pending queue: never-checked leagues (no draftStatus entry) get priority over already-checked ones.
- `PENDING_PER_RUN` raised to 60 (was 15), shuffled to prevent starvation.
- `drafting`/`paused` status checked before null check — client-seeded live drafts go to `urgent` immediately.
- New admin endpoints: `/draft/rebuildWatchIndex` (backfill all users), `/draft/diagnose?username=X` (cross-check Sleeper vs Worker for any user).

**`gmd/draftWatchIndex` architecture:**
- Client writes `gmd/draftWatchIndex/{username}` on `init()` — flat `{leagueId: leagueName}`, pre-filtered.
- Worker reads this as a single node to know what leagues exist across all users.
- Run `/draft/rebuildWatchIndex` once to backfill all existing users.
- Firebase rules: `.read: auth != null, .write: auth != null`

**Cache busting:**
- `draft-ticker.js` bumped to `?v=5` in `index.html`.
- `no-cache` meta tags added to `index.html` so all browsers pick up new JS on next normal load.

---

### May 12, 2026 — Admin Impersonation (`app.js`, `index.html`)

**Feature:** Admins can view DLR as any user for debugging without touching their Firebase Auth session.
- `AdminImpersonate` module added to `app.js`. `ADMINS = ["mraladdin23"]`.
- 👁 button added to nav (hidden for non-admins). Click → prompt for username → loads their Firebase profile data and re-renders the full app as them.
- Purple banner at top of screen: "Viewing as {username} — read only". Exit button restores your own profile.
- DraftTicker re-inits as the target user so you see their exact ticker state.
- Firebase Auth session unchanged — nothing writes under their account.
- `DraftTicker.diagnose()` runnable from console while impersonating.

---

### May 12, 2026 — Hallway F8: H2H Records in Common Leagues (`hallway.js`, `locker.css`)

**Feature:** In the Hallway manager modal, shows head-to-head record per common league and a combined overall H2H at the top.

**Implementation:**
- `chainLeagueMap` built when opening modal — maps each displayed league row to all its seasons (dynasty chains aggregated by leagueName).
- `_computeH2HForChain(seasons)` — async, checks all seasons in parallel, aggregates W/L/PF/PA.
- `_checkSleeperDirect` equivalent per platform:
  - **Sleeper:** parallel `getMatchups` for all regular-season weeks, match on shared `matchup_id`.
  - **MFL:** parallel `getLiveScoring` calls, match on franchise ID pairs.
  - **Yahoo:** scans `allMatchups` from existing bundle — zero extra API calls.
- Missing `myRosterId` on Sleeper: auto-resolved via `SleeperAPI.getRosters` + `owner_id` lookup.
- Modal renders immediately with spinner placeholders; H2H cells patch in place as results arrive.
- Combined "Overall H2H" shown in the common leagues header (e.g. `7–4` in green/red).
- `↻ Sync needed` shown when roster IDs can't be resolved (user needs to re-sync).
- `.hl-h2h` and `.spinner--sm` CSS added to `locker.css`.

---

### May 12, 2026 — Tournament Private Flag (`tournament.js`)

**Feature:** Tournament admins can mark a tournament as private to hide it from the public tournament list.
- Checkbox added to Info & Rules admin section: "Keep tournament private (hide from public tournament list)".
- Saves `meta.isPrivate = true` to Firebase on save.
- `_writePublicSummary` checks `meta.isPrivate` — removes the `gmd/publicTournaments/{tid}` node instead of writing.
- Saving with box unchecked re-publishes normally.

---

### May 12, 2026 — Mobile Draft Ticker / Activity Pills

**Changes:**
- Mobile `nav-actions` (`display: none !important`) replaced with icon-only pill display — same pills as desktop, labels hidden on mobile, compact padding.
- Separate mobile activity button (pulsing red dot) removed — unified with desktop pills.
- `drawer-draft-btn` in hamburger: `e.preventDefault()` + `e.stopPropagation()` added; opens `_openGlobalDraftModal()` with live data refresh via `DraftTicker.refreshForModal()`.
- `_openGlobalActivityModal()` added — combined modal showing live drafts + auctions + notifications, opened from mobile activity button.
- `_renderGlobalDraftBody()` extracted as shared helper used by both draft modal and activity modal.
- `setTimeout(0)` defers panel open past click-event bubbling to prevent immediate close.

---

### May 9, 2026 — Global Draft Ticker (U1): Cloudflare Worker Cron + Firebase Architecture
*(see previous entries)*

### May 7, 2026 — Tournament Landing Page Overhaul, Participant Sync, Mobile Fixes
*(see previous entries)*

### May 6, 2026 — Tournament Message Board, Matchups Tab, Form Builder, H2H Bracket, Registration Import
*(see previous entries)*

### May 5, 2026 — B1, B2, X1, X2: Bug Fix Session
*(see previous entries)*

### May 5, 2026 — World Cup Tournament Mode: Full Implementation
*(see previous entries)*

### April 30, 2026 — T1–T4: Tournament Polish + Public Players Tab Parity
*(see previous entries)*

### April 29, 2026 — F5-P4-ext / F5-P4: Custom Playoffs, Players Tab, finalRankings
*(see previous entries)*

### Earlier completed items
- Yahoo OAuth, standings, matchups, playoffs, roster, players, draft, transactions, analytics
- MFL playoff detection, identity matching, bundle reliability
- Auth, mobile scroll, DNS, Cloudflare Worker, Firebase token storage
- Hallway: Firebase pins, pagination, common-league modals
- F5 Phases 1–3: foundation, standings sync, public site, registration, participants, analytics

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*
