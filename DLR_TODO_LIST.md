# Dynasty Locker Room — Master TODO List
*Updated: April 30, 2026 — T1–T4 tournament polish complete. Public Players tab fully parity with internal.*
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

## 🟢 Tournament — Known Tweaks / Future Polish

*(none currently)*

---

## 🟢 New Features

---

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
**Note:** Tournament-level playoff tracking is done (F5-P4). This is for individual league custom brackets.

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
| 1 | F8 | Hallway: H2H Records | Medium | `hallway.js` |
| 2 | F1 | Dynasty Overview Tab | High | `standings.js`, `profile.js`, `locker.css` |
| 3 | F2 | Custom Playoff Tracker (individual leagues) | High | New module + several files |
| 4 | F7 | Custom Trophy Builder | High | `trophy-builder.js`, `trophy-room.js`, `locker.css` |
| 5 | F4 | Locker Room Redesign + Team Theme | Very High | New theme system + CSS refactor |
| 6 | F6 | Post-It Trash Talk Wall | High | `postits.js`, `firebase-db.js`, `locker.css` |

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

---

## ✅ Completed

### April 30, 2026 — T1–T4: Tournament Polish + Public Players Tab Parity

**T1 — Multi-Week Playoff Rounds (`tournament.js`)**
- Added `weeksPerRound` field (default 1) to each Points Rounds config row in the admin UI
- Round display shows "Weeks 14–15" format when `wpr > 1`
- Publish pre-fetch computes cumulative NFL week offsets across all rounds; fetches exactly the right weeks
- `_computedRounds` builder uses `_wsCombined_` + `_roundStartWeeks_` — scores summed across all weeks in the round
- Live `_renderPointsRound` async fetch, prior-round simulation, and current-round scoring all updated to use combined scores
- Fully backward-compatible: rounds without `weeksPerRound` default to 1 (no data migration needed)

**T2 — Public Players Tab Playoff Data (`tournaments/index.html`)**
- `poByYear` now reads `finalRankings` first (same primary path as internal `_buildPoByYear`) — correct `rank`, qualification, and champion status from authoritative published data
- Fallback to `po.standings` array for pre-finalRankings snapshots
- Aggregates `bestRank`, `yearData`, and `streak` the same way the internal tab does
- Sort updated: champions → years → bestRank asc → win%
- Table gains **Best** rank and **year pips** columns (conditionally shown when PO data exists), pip legend, and 🔥 streak badge
- Modal per-year sections restructured to match internal format: `poBlock`/`lchampNote` divs removed; playoff result now appears as a `finishRow` at the bottom of each year's `<tbody>` (gold for champion, green for qualified, grey "Did not qualify")
- Modal totals row: **Leagues** stat tile removed; **Best Rank** always renders as plain number (`p.bestRank ?? "—"`); **Career PF** guarded against zero

**T3 — Custom Rounds `finalRankings` (`tournament.js`)**
- New `custom_rounds` branch in `_buildFinalRankings` simulates PF-based group advancement through each configured round (groups × teamsPerGroup × advPerGroup), with byes passing round 0 automatically
- Builds rankings backwards: final pool survivors (PF-sorted, champion = top) → last-round eliminated → earlier rounds → non-qualifiers
- Analytics tabs (Players Best Rank, ADP vs Finish) now accurate for custom-rounds tournaments

**T4 — H2H Bracket `finalRankings` (`tournament.js`)**
- New `h2h_bracket` branch in `_buildFinalRankings` simulates single-elimination bracket using `_weekScoreCache` scores; falls back to inverse-seed-rank when scores aren't available
- Publish button now pre-fetches all bracket round weeks before computing `finalRankings`
- Seeding uses same record/PF metric as `_renderBracket`; round 1 uses top-vs-bottom pairing; subsequent rounds pair adjacently
- Analytics tabs now accurate for bracket tournaments

---

### April 29, 2026 — F5-P4-ext: Players Tab, Most Rostered, ADP vs Finish, finalRankings

**Players tab (internal + public):**
- Paginated list (25/page), searchable by name
- Sort: Tournament champions → Years played desc → Best finish rank asc → Win% desc
- Columns: # | Player (name, gender, streak badge, twitter) | Yrs | W–L | Win% | PO | Best | Titles | Year pips
- Year pips: gold=champion, green=qualified, red=eliminated, grey=absent (hover for tooltip with rank)
- Gold row highlight for tournament champions; purple for league-only champs
- Streak badge 🔥 for consecutive playoff qualification
- Modal: consolidated table per year with W–L, PF, Lg Champ column + finish/rank summary row
- Uses `_buildPoByYear(t)` — reads `finalRankings` if published, otherwise derives from qual engine

**finalRankings system:**
- Publish button now writes `finalRankings` to BOTH `publicTournaments/{tid}/playoffs/{year}` AND `tournaments/{tid}/playoffs/{year}/finalRankings`
- `finalRankings` = authoritative rank 1→N list; for `points_rounds` mode works backwards from round simulation
- `_buildPoByYear(t)` reads this directly — no re-simulation needed for analytics tabs
- Local `_tournaments[tid]` cache updated immediately after publish so tabs reflect new data without reload

**_computeQualification(t, year):**
- Extracted as shared pure function (no network calls)
- Full qual engine copy: composite steps, wins_threshold, top_record/pf/per_group, scoped byes
- Used by both `_renderPlayoffsTab` (via existing inline logic, unchanged) and `_buildPoByYear` fallback

**Most Rostered tab:**
- Playoff-qualified teams' rosters, players ranked by how many of those teams rostered them
- Sleeper via public API; MFL + Yahoo via new worker `/tournament/rosters` endpoint
- Position filter, ownership %, bar chart, team chip list

**ADP vs Finish tab:**
- Splits drafted players into playoff-team vs eliminated-team buckets
- PO%, Elim%, Swing (PO%−Elim%) per player
- Three sort views: PO-Heavy / Elim-Heavy / By Swing
- `teamQualMap` now built directly from `poYr` keys (all sanitized variants) to correctly identify all playoff teams

**Cross-platform sync warnings (F-X):**
- Dismissible amber banner after standings sync if MFL/Yahoo leagues skipped or failed
- Scoring difference chips when platforms have different scoring settings
- `_showSyncWarningBanner(warnings, diffs)` helper

**Bug fixes applied:**
- Year pip duplication: `lc.year` (number) vs `Object.keys(poByYear)` (strings) → normalized all to `String(yr)`
- `poapprate` tab removed; PO stats merged into Players tab
- ADP vs Finish only showing 1 PO team → fixed by populating `teamQualMap` from `poYr` entries directly

---

### April 29, 2026 — F5-P4: Custom Playoffs — FULLY COMPLETE

Full playoff configuration, display, live scoring, and public site integration
for Tournament Mode. Verified working in production across 2023, 2024, and 2025.

**Admin Configuration:**
- Section-nav dropdown: Playoff Format → Qualification Rules → Seeding & Byes → Round Config → Scoring Settings
- Year-scoped saves: `_wirePlayoffConfigListeners` accepts `initialYear` parameter, passed through `_rerender` — fixes historical year saves always going to current year
- Mode cards: Total Points, Points Rounds, H2H Bracket, Custom Rounds

**Qualification Engine:**
- Composite step builder with Wins Threshold gate, Top N Record/PF/Subgroup per scope
- `_groupKey` falls back to `leagueName` when explicit division/conference fields are empty (BOTS-style: each league = one division)
- **Gender matching:** `sleeperUsername` stored on `lc.teams` during sync (from Sleeper `/users` endpoint). Used as primary key for gender/displayName lookup — survives display name changes across years. Falls back to display-name matching.
- `diagQual("name")` browser console tool for step-by-step qualification diagnosis

**Seeding & Byes:**
- **Bye Eligibility Ranked By:** H2H Record or Points For — independent of seeding method
- `byeMetric` used throughout, `byeSet` computed per-group by division/conference scope
- Key bug fixed: `byeSet` was using PF when config said H2H Record, causing wrong teams to get byes

**Round Config:**
- Points rounds: advance method, blend (Weighted/Additive with weight %)
- Custom rounds: groups × teams-per-group × advance-per-group
- Per-round byes removed from round config (byes handled globally in Seeding & Byes)

**Scoring Settings:**
- Year-scoped sync, SCORING_KEY_META label map, inline editing, Clear & Re-sync

**Playoffs Tab:**
- Standings: qualified-first sort, single cut line, correct BYE badges, champion banner for total_points mode
- Points Rounds: live Sleeper score fetch, blend columns (Wk / Avg / Blend), bye rows hidden with toggle
- Pool simulation: bye-first ordering ensures `pool.slice(0, byeCount)` always contains actual bye teams; uses actual weekly scores for advancement simulation across rounds
- League Champs: grouped by playoff winner vs regular season leader, 4-per-row grid, derived from `lc.champion` (set during standings sync from Sleeper winners bracket)
- Mobile: `<select>` dropdown for sub-tabs

**Public Site:**
- Year-keyed: publish writes to `publicTournaments/{tid}/playoffs/{year}` — years independent
- `renderPlayoffsTab` async re-fetches year-specific node on every tab open
- `renderTab` awaits `renderPlayoffsTab` — no stale cache shown
- Publish button: fetches all playoff weeks before building snapshot, computes `computedRounds` with pre-sorted results + blend scores per team per round — public site reads directly, no re-derivation
- Display names throughout, bye toggle, League Champs section

**Firebase paths added:**
- `gmd/tournaments/{tid}/playoffs/{year}/` — year-keyed playoff config
- `gmd/publicTournaments/{tid}/playoffs/{year}` — year-keyed published snapshot with `computedRounds`
- `gmd/tournaments/{tid}/playoffs/{year}/finalRankings` — authoritative ranked list written at publish time
- `lc.teams[].sleeperUsername` — now stored on every team entry during standings sync
- `lc.teams[].userId` — Sleeper numeric owner_id also stored

---

### April 25, 2026 — UI Polish Pass (Mobile + Draft Cards + Standings)

- Roster tab mobile 2-per-row; PA column removed from standings; standings mobile tightening
- Draft card redesign: position-colored tint, abbreviated name, pos·team inline
- Tournament draft board mobile 4-col fit

### April 25, 2026 — F5-P3 Completion

- Rules year-specific versioning (`rulesByYear/{year}/`), CSS consistency pass
- Public bio and rules, registrant/participant template CSV downloads, registrant delete

### April 25, 2026 — Tournament Small Fixes Batch

- Registration year in header, standings desktop/mobile column strategy
- Public standings Twitter handle pill, Info page "Years" stat
- `_writePublicSummary` bug fixes, Re-publish button

### April 24, 2026 — Auth, Profile, Tournament

- Password reset (A1), delete league/platform (A2)
- Duplicate registration prevention (F5-P3-S8), Rosters tab layout overhaul (F5-P3-U5)

### F5-P3 — Analytics — completed April 2026

- Draft board, ADP, Matchups UX, Admin settings UI, Public ADP by year
- Worker fix (pick_no), snake/3RR direction, DraftCard PNG download

### Earlier completed items

- Yahoo OAuth, standings, matchups, playoffs, roster, players, draft, transactions, analytics
- MFL playoff detection, identity matching, bundle reliability
- Auth, mobile scroll, DNS, Cloudflare Worker, Firebase token storage
- Hallway: Firebase pins, pagination, common-league modals
- F5 Phases 1–3: foundation, standings sync, public site, registration, participants, analytics

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

### Check Yahoo token in Firebase
```js
const snap = await firebase.database().ref('gmd/users/mraladdin23/platforms/yahoo/tokens').get();
console.log('Yahoo tokens:', snap.val());
```

### Surgical fix for a single wrong league
```js
const key = "yahoo_2024_123456"; // replace with actual key
await firebase.database().ref(`gmd/users/mraladdin23/leagues/${key}`).update({
  playoffFinish: null, isChampion: false, resolved: null
});
console.log("Fixed", key);
```

### Clear bundles node (safe)
```js
await firebase.database().ref('gmd/users/mraladdin23/bundles').remove();
console.log("Bundles cleared");
```

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*
