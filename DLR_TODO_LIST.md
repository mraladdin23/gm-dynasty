# Dynasty Locker Room — Master TODO List
*Updated: May 20, 2026 — Decathlon mode built, registration year-scoping, draft ticker snake fix, wizard polish, public site parity.*
*Attach with DLR_PROJECT_SUMMARY.md + specific files per task.*

---

## How to Use This Doc
Each issue is self-contained. For each session: attach this doc + project summary +
only the files listed under that issue. Fix one issue per session where possible.
After completing an issue, move it to the ✅ Completed section at the bottom.

---

## 🔴 Critical — Crashes or Broken Core Features

### REG-BLOCK — Registration "Already a Participant" False Block
**Problem:** People who participated in 2025 or earlier try to register for 2026 and get blocked. Two messages reported: "You've already registered" and "You're already an approved participant."

**Root causes fixed (confirm both are deployed):**
1. `tournament.js` `_submitRegistration` — duplicate check scoped to `currentRegYear` (only checks `r.year === currentRegYear`). Old registrations with no `year` field are excluded entirely.
2. `tournaments/index.html` public page — `participantMap` pre-flight removed. Replaced with year-scoped Firebase fetch that only checks same-year entries.
3. `entry.year = currentRegYear` written on every new registration in both files.
4. "🔧 Tag Registrations with Year" button in Admin → Registrants backfills untagged legacy entries.

**Action required:** Admin must click "🔧 Tag Registrations with Year" once to tag existing 2025 registrations. Until done, those remain untagged and won't interfere (they're excluded from the check by design), but having them tagged is cleaner.

**Files:** `tournament.js`, `tournaments/index.html`

---

### DT-MISSING — Draft Ticker Not Picking Up Active Draft
**Problem:** At least one league currently drafting is not appearing in the draft ticker.

**Diagnostic steps (run in order):**
1. `await DraftTicker.diagnosePickCalc()` — check which leagues are being monitored and their draft status
2. Check `gmd/draftWatchList` (or `gmd/draftWatchIndex/{username}`) — is the missing league present?
3. On Sleeper, confirm the draft status is `"drafting"` or `"paused"` (not `"complete"` or `"pre_draft"`)
4. Check `gmd/draftStatus/{leagueId}` — does the Worker's entry exist? If not, league may not be in watchList
5. Check `GET https://mfl-proxy.mraladdin23.workers.dev/draft/diagnose?username=mraladdin23` for full Worker-side report

**Likely causes:**
- League not in `_buildWatchList` (possibly filtered by `mostRecentSeason` logic — if league is a redraft that shares a chain with a dynasty, it may be excluded)
- Draft type is snake and `slot_to_roster_id` is empty — now fixed (fetches `/draft/{id}` directly), but verify deployed
- League linked to a different Sleeper username than stored

**Files:** `draft-ticker.js`

---

## 🟡 Decathlon Mode — Remaining Items

### DEC-WEEKRANGE — Week Range Not Applying to Standings/Results
**Problem:** Even with `po.startWeek=1`, `po.endWeek=16` confirmed in Firebase, PF-basis and record-basis leagues still show full-season results in the combined standings and by-league view.

**Architecture (as of latest session):**
- Global `po.startWeek`/`po.endWeek` used for record, median, and playoffs basis leagues
- PF-basis leagues have their own per-league `pfStartWeek`/`pfEndWeek` inputs (appear when "🎯 Total Points" selected in the per-league card)
- `_buildDecWeekScoreMap()` is async — fetches Sleeper matchup API for all leagues × weeks, returns `{ pfMap, wlMap, medMap }`
- `hasWeekRange = !!(startWk && endWk && pfMap)` — only true when pfMap is populated
- `_setTabContent(tabId)` shows spinner then awaits the async render

**Known remaining issue:** `pfMap` fetching logic is confirmed working (108 keys in diagnostic) but the rangedPF still isn't being applied. Suspected: `lgId` in `leagueMap` and `lgId` in `_buildDecWeekScoreMap` may still mismatch in edge cases, OR `hasWeekRange` is false because `pfMap` is null when the tab first renders.

**Action required:**
1. Deploy latest `tournament.js`
2. For each PF-basis league card: enter Start Week / End Week in the sub-inputs → Save Decathlon Config
3. Run `await DLRTournament.diagnoseDecathlon()` — look at the leagueConfig table for `pfStartWeek`/`pfEndWeek`
4. Check the console for `[decathlon] pfMap MISS` warnings — these show the exact key format mismatch if one exists

**Files:** `tournament.js`

### DEC-ELIM — Elimination Manager Needs Verification
**Status:** Major fixes applied. `_poLocal`/`_activePoYear` scope errors fixed. Player list population fixed (year-prefix key stripping). Rank logic fixed (active players = best ranks). "🎯 Suggest from Sleeper" button added (Phase 1: cumulative PF; Phase 2: single-week lowest scorer).
**Verify:** Open Elimination Manager for the elimination league, record knockouts, save, confirm ranks display correctly in Combined Standings.
**Files:** `tournament.js`

---

## 🟢 Tournament — Redesign & New Features

### T-REDESIGN — Tournament Creation: Step-by-Step Modal
**Priority:** High
**Status:** Wizard fully functional (7 steps). Known issues all fixed. MFL "Fetch All Leagues" UI added but not yet wired (button exists, `display:none`, handler not implemented — deferred).
**Files:** `tournament.js`, `tournament.css`, `index.html`

### A2 — Registration Confirmation Email
**Files:** `tournament.js`, `worker.js`

### F9 — Tournament League Invite Emails
**Files:** `tournament.js`, `worker.js`

---

## 🟢 Auth & Account
*(none currently)*

---

## 🟢 New Features

### F1 — Dynasty/Keeper League Overview Tab
**Files:** `standings.js`, `profile.js`, `locker.css`

### F4 — Locker Room Visual Redesign + NFL Team Themes
**Files:** `locker.css`, `profile.js`, `app.js`

### F6 — Post-It Trash Talk Wall
**Files:** `chat.js`, new module

### F7 — Custom Trophy Builder
**Files:** `trophy-room.js`, `tournament.js`, `locker.css`

---

## 🔧 Console Scripts (for surgical Firebase fixes)

### Diagnose decathlon week range and engine state
```js
await DLRTournament.diagnoseDecathlon()
// Shows: po.startWeek/endWeek, pfMap key count, wlMap key count,
// leagueConfig per-league basis/pfStartWeek/pfEndWeek,
// standingsCache sample, key format check
```

### Diagnose custom playoffs visibility for a league
```js
await Profile.diagnoseCustomPlayoffs()
```

### Diagnose draft ticker pick calculation
```js
await DraftTicker.diagnosePickCalc()
// or: await DraftTicker.diagnosePickCalc("leagueId")
```

### Clear stale draft cache for one league
```js
await firebase.database().ref(`gmd/tournaments/${tid}/analyticsCache/drafts/${lid}`).remove();
```

### Clear bundles node (safe)
```js
await firebase.database().ref('gmd/users/mraladdin23/bundles').remove();
```

### Force-republish public summaries
Open DLR while logged in as admin — `_backfillPublicSummaries()` runs automatically on tournament page load.

### Tag registrations with current year (run once to fix old-participant blocking)
Admin → Registrants tab → click "🔧 Tag Registrations with Year"

### Worker debug endpoints
```
GET https://mfl-proxy.mraladdin23.workers.dev/draft/diagnose?username=USERNAME
GET https://mfl-proxy.mraladdin23.workers.dev/draft/rebuildWatchIndex
GET https://mfl-proxy.mraladdin23.workers.dev/draft/status
```

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*

---

## ✅ Completed

### May 20, 2026 — Decathlon Playoff Mode (`tournament.js`, `tournament.css`, `index.html`)
New playoff mode for multi-league tournaments where the same participants compete across all leagues simultaneously.

**Overall scoring:** Admin picks Combined PF (sum of points scored) or Finish Points (shared points table applied to each league's finish position).

**Per-league finish methods (each league configured independently):**
- H2H Record — wins/losses, PF tiebreak. Sub-option: Median Wins checkbox (beat weekly median = +1 win)
- Total Points — sum of PF in a configurable per-league week range (`pfStartWeek`/`pfEndWeek`)
- League Playoffs — post-playoff record (sync after playoffs complete)
- Elimination — manual weekly knockout list. Phase 1 (cumulative PF), Phase 2 (single-week score). "🎯 Suggest from Sleeper" button fetches lowest scorer each week.

**Engine functions:**
- `_buildDecathlonLeaderboard(t, year, po, weekData)` — pure computation from standingsCache + weekData
- `_buildDecWeekScoreMap()` async — fetches Sleeper matchup API for all leagues × weeks. Returns `{ pfMap, wlMap, medMap }`. PF leagues use per-league week ranges; others use global.
- `_decSortByBasis(teams, basis)` — fallback sort when no week-range data
- `_openEliminationManager(tid, t, lgId, lgName, lgCfg, poYear)` — modal for knockout entry

**Display:**
- Combined Standings tab: 🥇🥈🥉 podium cards, full ranked table, hover tooltip per-league breakdown
- By League tab: each league's standings with basis label
- Public site: "🏅 Combined" tab in Tournament History section

**Key gotchas:**
- standingsCache keys are `{year}_{leagueId}` — always strip year prefix before using as Sleeper API parameter: `ck.replace(/^\d{4}_/, "")`
- `_poLocal()` and `_activePoYear` are only in scope inside `_wirePlayoffConfigListeners`. `_openEliminationManager` uses `resolvedPoYear` param + `_tournaments[tid]` cache directly.
- `_setTabContent(tabId)` is async-safe — shows spinner for decathlon tabs while fetching week scores
- `_wcWireBracketButtons` guarded with `typeof` check to avoid temporal dead zone on initial render

---

### May 20, 2026 — Registration Year-Scoping (`tournament.js`, `tournaments/index.html`)
- `_submitRegistration` now checks only `sameYearRegs` (registrations tagged with `currentRegYear`)
- `currentRegYear` resolved from `playoffs[y].registrationOpen`
- `tournaments/index.html` `participantMap` pre-flight removed; replaced with year-scoped check
- `entry.year = currentRegYear` written on every new registration in both files
- "🔧 Tag Registrations with Year" admin button added to Registrants toolbar

---

### May 20, 2026 — Draft Ticker: Snake Draft `slot_to_roster_id` Fix + Linear Fallback (`draft-ticker.js`)
- `_checkSleeperDirect` fetches `/draft/{draft_id}` as a third parallel request when draft is snake and `slot_to_roster_id` is missing from `/league/{id}/drafts` response
- `_refreshLiveDrafts` does the same on panel open
- Linear draft fallback: `slot === rosterId` for linear drafts without `slot_to_roster_id`
- `diagnosePickCalc()` improved: shows `has_draft_order`, `has_slot_to_roster_id`, `diagnoseNull` array, `draft_order_keys`

---

### May 20, 2026 — Tournament Public Site Parity (`tournament.js`, `tournaments/index.html`)
- League dropdown filter added to public Standings tab
- Season Summary card added to public Overview (reads from `seasonConfig` — thin config node)
- `_writePublicSummary` now writes `seasonConfig` separately from `playoffs/` — prevents overwriting published playoff snapshot
- Surgical per-year child updates for `registrationOpen`/`published` flags (never touches rest of snapshot)
- Register tab added as persistent nav item; shows "not open" message when closed
- `renderDecathlonTab` added for public combined leaderboard
- Player Records Best Finish / Titles populated from `finalRankings` in published snapshot

---

### May 20, 2026 — Wizard Polish (`tournament.js`, `tournament.css`)
- `modal-box--lg` applied AFTER `_showModal()` creates the element (was applied before — element didn't exist yet)
- Year pill clicks: full rerender via `_rerenderWizard` with fresh `_tournaments[tid]` data
- `_wireWizardStep5` passes `_wizardYear` as filterYear to `_renderLeaguesTab`
- Show All Years button works from both wizard and admin panel contexts
- Save & Close styling: `btn-secondary` to match Back button
- `_wizardSaveAndClose(tid)` extracted as reusable helper

---

### May 14, 2026 — Draft Ticker: Pick-Calculation Bugs Fixed (`draft-ticker.js`)
*(see previous entries)*

### May 14, 2026 — Custom Playoffs v4, Tab Visibility Fix, players-db.js
*(see previous entries)*

### May 12, 2026 — Draft Ticker Overhaul, Admin Impersonation, Hallway H2H, Tournament Private Flag
*(see previous entries)*

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*
