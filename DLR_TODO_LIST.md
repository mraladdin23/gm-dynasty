# Dynasty Locker Room — Master TODO List
*Updated: April 23, 2026 — F5-P3 (Analytics) partially complete. P3 bugs + P4 (Custom Playoffs) are next priority.*
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

## 🟢 New Features

---

### F1 — Dynasty/Keeper League Overview Tab
**Idea:** For dynasty and keeper leagues, add an "Overview" tab consolidating standings
and analytics across all years, with a year selector at the top.
**Files:** `standings.js`, `profile.js`, `locker.css`
**Note:** Significant feature — needs scoping session first.

---

### F2 — Custom Playoff Tracker
**Idea:** Define a custom playoff structure (e.g. Royal Rumble: bottom 4 → winner faces
next 4 → winner faces top 4 → top 2 for championship) that DLR tracks and updates
independent of what the platform reports.
**Files:** New module likely needed + `firebase-db.js`, `standings.js`, `index.html`
**Note:** Large feature. Related to F5-P4 Tournament Playoffs below.

---

### F4 — Locker Room Visual Redesign + Team Customization
**Idea:** Redesign the main locker room UI to look like an actual locker. User can
select their favorite NFL team and the locker theme (colors, logo, textures) updates
to match. Interchangeable visual elements — door style, nameplates, decorations.
Reference design/mockup to be provided by Mike.
**Files:** New CSS theme system + `locker.css`, `base.css`, `profile.js`, `index.html`
**Note:** Needs design mockup attached to session.

---

### F5 — Tournament Mode (Cross-Platform)
**Spec:** `GMDynasty_Tournament_Spec.docx` (v1.0) — attach to any tournament session.
**Files:** `tournament.js`, `tournament.css`, `tournaments/index.html`
**Public URL:** `dynastylockerroom.com/tournaments`

**Phase 1 — Foundation ✅ COMPLETE**
**Phase 2 — Core Views ✅ COMPLETE** (Standings, Info, Rules, Registration, Participants)
**Phase 3 — Analytics ⚠️ IN PROGRESS** (bugs remain — see F5-P3 items below)
**Phase 4 — Custom Playoffs** — next major milestone
**Phase 5 — Advanced** — after Phase 4

---

## ── F5-P3: Analytics Bug Fixes (do before P4) ──────────────────────

### F5-P3-B1 — Draft: team ID collision across leagues 🔴
**What:** Each league has its own namespace of team IDs (roster_id 1–12). When picks
from multiple leagues are combined without prefixing by leagueId, roster_id "3" from
League A overwrites roster_id "3" from League B in the teamMap. Draft boards show
the same teams repeated and matchups count teams more than once.
**Fix:** In `_renderAnalyticsDraft` and `_loadAndRenderMatchups`, key all team lookups
as `{leagueId}:{teamId}` rather than bare `teamId`. Also prefix in the picks array so
each pick carries its qualified team key.
**Files:** `tournament.js`
**Attach:** `tournament.js`

### F5-P3-B2 — Matchups: sorting still wrong 🔴
**What:** Despite the `enriched` recompute fix, matchup sorting for highest/blowouts/
closest remains incorrect. Root cause is likely the team ID collision above causing
duplicated entries that skew both scores and diff values. Fix B1 first, then verify
sort results. Add console.log of the top-3 from each sort to confirm.
**Files:** `tournament.js`
**Attach:** `tournament.js`
**Note:** The debug logs added in the last session (console.log in _loadAndRenderMatchups
and _renderMatchupsContent) should help diagnose — check browser console first.

---

## ── F5-P3: Analytics UX Improvements ──────────────────────────────

### F5-P3-U1 — Draft: use existing DLRDraft board rendering + player cards 🟡
**What:** Replace the custom tournament draft board with the same rendering used in
league detail (round×team grid, position-colored picks, click-to-open player card via
`DLRPlayerCard.show()`). Default to the current user's draft board view rather than
showing all boards combined. Add list view matching league detail list style.
**Files:** `tournament.js`, `draft.js` (reference only — borrow rendering pattern)
**Attach:** `tournament.js`, `draft.js`
**Note:** The draft board in draft.js uses `slot_to_roster_id` from the Sleeper draft
object for column ordering. The worker `/tournament/draft` endpoint needs to also return
`slot_to_roster_id` and `draft_type` alongside picks so the same grid logic works.
Also need: `worker.js` (to add those fields to the Sleeper response).

### F5-P3-U2 — ADP: flat ranked list with player bio chips 🟡
**What:** Replace the position-grouped ADP layout with a flat list ranked by ADP across
all positions. Each row should look like the draft list view in league detail — player
chip with position badge, name, NFL team, ADP number, draft count. Position filter
dropdown narrows to that group. Currently groups by position first which makes it hard
to see overall draft value.
**Files:** `tournament.js`
**Attach:** `tournament.js`, `draft.js` (reference for list row HTML/CSS patterns)

### F5-P3-U3 — Draft card: two-column shareable image 🟡
**What:** Redesign the share card to two columns (rounds split left/right), showing
round number, pick number, player name, position badge (color-coded), NFL team.
Include tournament name + year in a styled header. Render as a downloadable/copyable
PNG via html2canvas with a fun visual style (gradient header, dark/light theme toggle).
**Files:** `tournament.js`, `tournament.css`
**Attach:** `tournament.js`, `tournament.css`

### F5-P3-U4 — Matchups: card layout + score histogram 🟡
**What:**
- Replace row-per-matchup layout with side-by-side matchup cards (two teams, scores,
  margin, league name dimmed at bottom)
- "Highest Scoring" section shows top 5 individual team scores (not combined), with
  team name, score, league name
- "Closest" and "Biggest Blowout" sections remain but use the card layout
- Weekly recap section: show only to admin (non-admin sees read-only posted recap or nothing)
- Add score distribution chart: histogram or scatter plot of all team scores for the
  selected week across all leagues (shows spread, outliers, median line)
- League name shown dimmed on each card
**Files:** `tournament.js`, `tournament.css`
**Attach:** `tournament.js`, `tournament.css`

### F5-P3-U5 — Rosters: horizontal position-group card layout 🟡
**What:** Reorganize the roster card to show players in horizontal position groups
going across the card (QB | RB | WR | TE | FLEX | K | DEF), starters first then
bench, ordered by rank/name within each group. Currently shows a flat vertical list.
**Files:** `tournament.js`, `tournament.css`
**Attach:** `tournament.js`, `tournament.css`

---

## ── F5-P3: Small Fixes (quick wins) ───────────────────────────────

### F5-P3-S1 — Registration: include tournament name + year in header 🟢
**What:** Register button overlay title should say "Register for [Name] [Year]"
(e.g. "Register for Scott Fish Bowl 2025") to make it unambiguous which year's
registration the user is submitting.
**Files:** `tournament.js`, `tournaments/index.html`
**Attach:** `tournament.js`, `tournaments/index.html`

### F5-P3-S2 — Standings: desktop vs mobile column strategy 🟢
**What:** On desktop (>640px) restore League and Conference as separate columns.
On mobile keep them stacked under display name. Internal and public site should use
identical CSS — public site currently looks better than internal. The issue is
conflicting `standings-team-cell` rules between the stacked mobile fix and the desktop
column restore.
**Files:** `tournament.css`, `tournaments/index.html`
**Attach:** `tournament.css`, `tournaments/index.html`

### F5-P3-S3 — Public site: Twitter handle in standings 🟢
**What:** On desktop (public site), show Twitter handle in parentheses after the
display name as a clickable link. On mobile, make the display name itself the clickable
link to their Twitter profile (if available). Currently public site has no Twitter
links at all.
**Files:** `tournaments/index.html`
**Attach:** `tournaments/index.html`

### F5-P3-S4 — Info page: "Leagues" stat should say "Years" 🟢
**What:** The stat card on the Info tab says "X Leagues" but it actually represents
the number of distinct years the tournament has run. Change label to "Years" and
compute from distinct years in standingsCache rather than league count.
**Files:** `tournament.js`, `tournaments/index.html`
**Attach:** `tournament.js`, `tournaments/index.html`

### F5-P3-S5 — Tournament Overview: clean up admin settings UI 🟢
**What:**
- Standings Ranking options: rename to "H2H Record" and "Points For" (cleaner)
- Median Wins: replace checkbox + description with Yes/No toggle, no description text
- Remove "Twitter Column" setting entirely (now embedded for all participants)
- Standardize all inline controls (selects, inputs) to consistent size/style using
  shared CSS class
- Mobile: settings rows were too verbose — tighten labels
**Files:** `tournament.js`, `tournament.css`
**Attach:** `tournament.js`, `tournament.css`

### F5-P3-S6 — Rules: year-specific versioning 🟢
**What:** Rules should be storable per year so 2023 rules are preserved when 2024
rules are published. Store at `gmd/tournaments/{tid}/rulesByYear/{year}/` instead of
`gmd/tournaments/{tid}/rules/`. Admin can see a year dropdown to view/edit past rules.
Users see the rules for the currently selected year.
**Files:** `tournament.js`
**Attach:** `tournament.js`

### F5-P3-S7 — CSS consistency pass 🟢
**What:** Audit tournament.js / tournament.css / tournaments/index.html for visual
inconsistencies with the main app (locker.css patterns). Specific items:
- View pills should match `.season-pill` / `.season-pill--current` style from locker.css
  (currently rectangular with different border-radius)
- Card component styling should match `.trn-section-card` consistently
- Font sizes, spacing tokens, color variables should reference base.css vars not
  hardcoded values
**Files:** `tournament.css`, `locker.css` (reference), `tournaments/index.html`
**Attach:** `tournament.css`, `tournaments/index.html`

---

## ── F5-P4: Custom Playoffs ─────────────────────────────────────────

**This is the next major milestone after P3 bugs are resolved.**
Scope below represents a full scoping + build session. Read all sub-items before
starting — they are interdependent.

### F5-P4-A — Playoff config: champion determination method 🟡
**What:** Admin configures how the tournament champion is determined. Two modes:
1. **Total Points** — champion is the team with the highest cumulative PF across the
   regular season (no bracket). Admin sets the last week of the season.
2. **Bracket Playoff** — traditional elimination bracket. Admin sets playoff start
   week and format.
**Firebase:** `meta.championMethod: "points" | "bracket"`
**Files:** `tournament.js`
**Attach:** `tournament.js`

### F5-P4-B — Playoff config: qualification rules 🟡
**What:** Admin defines how teams qualify for the bracket (only relevant when
`championMethod === "bracket"`). Options:
- Top X by record (tie-break: PF)
- Top X by points for (regardless of record)
- Top X per conference/division (e.g. top 2 per conference)
- Manual override (admin hand-picks who advances)
**Firebase:** `meta.playoffQualification: { method, count, perGroup? }`
**Files:** `tournament.js`
**Attach:** `tournament.js`

### F5-P4-C — Playoff config: bracket format 🟡
**What:** Admin defines the bracket structure once qualifiers are known:
- Single elimination (standard)
- Double elimination (consolation bracket)
- Custom seeding order (drag-and-drop or numbered input)
**Firebase:** `meta.bracketFormat: "single" | "double" | "custom"`
**Files:** `tournament.js`
**Attach:** `tournament.js`

### F5-P4-D — Playoff bracket rendering (user view) 🟡
**What:** Visual bracket rendered for users showing matchups, results, and advancement.
Reuse bracket rendering patterns from `standings.js` (existing MFL/Sleeper bracket
rendering) where possible. Must handle:
- Byes
- Multiple rounds
- Champion highlight
- In-progress vs completed matchups
**Files:** `tournament.js`, `tournament.css`
**Attach:** `tournament.js`, `tournament.css`, `standings.js` (reference for bracket HTML)

### F5-P4-E — Playoff weekly matchup sync 🟡
**What:** During playoff weeks (week >= `meta.playoffStartWeek`), the Matchups tab
should show playoff bracket matchups separately from (or instead of) regular season
highlights. Playoff matchups are fetched the same way but labeled by round
(Quarterfinals, Semifinals, Championship).
**Files:** `tournament.js`
**Attach:** `tournament.js`

### F5-P4-F — Points-only champion detection 🟡
**What:** When `championMethod === "points"`, the champion is simply the team with
highest total PF in the standings at end of season. No bracket needed. The standings
tab shows a 🏆 next to the top-ranked team by PF. Admin marks the tournament
completed and the champion is auto-detected.
**Files:** `tournament.js`
**Attach:** `tournament.js`

**Open questions before building P4:**
- Double elimination: build now or defer to P5?
- How does the admin input results for matches played on external platforms
  (Sleeper/MFL/Yahoo)? Options: (a) auto-sync from matchup data, (b) manual score
  entry by admin, (c) hybrid. Recommendation: auto-sync first, manual override
  as fallback.
- F2 (Custom Playoff Tracker for individual leagues) overlaps significantly with
  F5-P4. Decide before scoping whether to merge or keep separate.

---

## ── F5-P5: Advanced (after P4) ────────────────────────────────────

- Cross-platform identity merging (match Sleeper username to MFL email to Yahoo)
- Weekly summary emails (email provider TBD)
- Message board integration
- MFL/Yahoo authenticated standings sync (admin provides credentials, not user)
- **Open question:** Email provider; fallback for low-confidence auto-match?

---

### F6 — Locker Room Post-It Trash Talk Wall
**Idea:** Post-it style sticky notes on lockers, stored in Firebase.
**Files:** New `postits.js` or extend `hallway.js` + `firebase-db.js`, `locker.css`, `index.html`
**Note:** Depends on F4 being done first.

### F7 — Custom Trophy Builder
**Idea:** SVG-based trophy composer. Saved to Firebase, displayed in Trophy Room.
**Files:** New `trophy-builder.js` + extend `trophy-room.js`, `firebase-db.js`, `locker.css`, `index.html`
**Note:** Standalone feature — no blockers.

### F8 — Hallway: H2H Records in Common Leagues
**Idea:** In the locker modal, show head-to-head record against that manager
for each common league (dynasty/keeper shows combined H2H, redraft shows per-season).
**Files:** `hallway.js`
**Note:** Currently shows combined W-L record. Needs matchup history cross-reference.

---

## Suggested Session Order

| # | ID | Description | Effort | Files Needed |
|---|-----|-------------|--------|--------------|
| 1 | F5-P3-B1 | Draft/matchup team ID collision fix | Medium | `tournament.js` |
| 2 | F5-P3-B2 | Matchups sorting verified after B1 | Small | `tournament.js` |
| 3 | F5-P3-S1–S5 | Small fixes batch (registration, standings, info, overview UI) | Medium | `tournament.js`, `tournament.css`, `tournaments/index.html` |
| 4 | F5-P3-U1 | Draft board: use DLRDraft rendering + player cards | Medium | `tournament.js`, `draft.js`, `worker.js` |
| 5 | F5-P3-U2 | ADP flat ranked list with player bio chips | Small | `tournament.js`, `draft.js` |
| 6 | F5-P3-U3 | Draft card: two-column shareable image | Medium | `tournament.js`, `tournament.css` |
| 7 | F5-P3-U4 | Matchups: card layout + score histogram | Medium | `tournament.js`, `tournament.css` |
| 8 | F5-P3-U5 | Rosters: horizontal position-group layout | Small | `tournament.js`, `tournament.css` |
| 9 | F5-P3-S6 | Rules: year-specific versioning | Small | `tournament.js` |
| 10 | F5-P3-S7 | CSS consistency pass | Medium | `tournament.css`, `tournaments/index.html` |
| 11 | F5-P4 scoping | Custom playoffs scoping session | — | `tournament.js` |
| 12 | F5-P4-A/B/C | Playoff config: method + qualification + format | High | `tournament.js` |
| 13 | F5-P4-D/E/F | Playoff bracket rendering + sync + champion | High | `tournament.js`, `tournament.css`, `standings.js` |
| 14 | F8 | Hallway: H2H Records | Medium | `hallway.js` |
| 15 | F1 | Dynasty Overview Tab | High | `standings.js`, `profile.js`, `locker.css` |
| 16 | F2 | Custom Playoff Tracker (individual leagues) | High | New module + several files |
| 17 | F7 | Custom Trophy Builder | High | `trophy-builder.js`, `trophy-room.js`, `locker.css` |
| 18 | F4 | Locker Room Redesign + Team Theme | Very High | New theme system + CSS refactor |
| 19 | F6 | Post-It Trash Talk Wall | High | `postits.js`, `firebase-db.js`, `locker.css` |

---

## Files Reference: What to Attach for Tournament Sessions

| Scenario | Attach These Files |
|---|---|
| Any tournament.js bug or feature | `tournament.js`, `tournament.css` |
| Public site changes | `tournaments/index.html` |
| Draft board rendering (borrow from league detail) | `tournament.js`, `draft.js` |
| Draft player cards | `tournament.js`, `draft.js`, `playercard.js` |
| Standings improvements | `tournament.js`, `tournament.css`, `standings.js` |
| Bracket rendering | `tournament.js`, `tournament.css`, `standings.js` |
| Worker endpoint changes | `worker.js` |
| CSS consistency pass | `tournament.css`, `locker.css`, `base.css` |
| Analytics charts | `tournament.js`, `tournament.css`, `analytics.js` |

---

## ✅ Completed

- **Item 2 (Session A):** Options modal gating — commish-only fields hidden from non-commish users; read-only groups/labels display shown to all; `leaguegroups.js` exports `loadCommGroups`
- Yahoo Standings (CSS matches MFL/Sleeper)
- Yahoo Matchups (season-pill week bar, click-to-expand with team stats)
- Yahoo Roster tab (PREFERRED_ORDER position grouping, detailMap fallback)
- Yahoo Players tab (YTD stats via `/yahoo/playerStats`, position dropdown)
- Yahoo Analytics (leagueKey wired)
- Yahoo token fix: optimistic use when `expiresAt` is 0
- MFL `_detectMFLPlayoffFinish`: `isGuillotine` param, skips bracket for guillotine
- MFL guillotine standings rank cap removed
- MFL `resolved` flag: allows guillotine redraft leagues through
- Worker `userLeagues` SINCE= gap-fill
- Mobile stuck panel fix
- Mobile safe area: `viewport-fit=cover`, `env(safe-area-inset-top)`, `100dvh`
- MFL identity matching overhauled to use `franchise_id`/`league_id`
- MFL `myRosterId`/`teamName` Firebase path writes fixed
- MFL transaction parsing rewritten
- MFL matchup cards rebuilt
- MFL playoff bracket rendering, division filter persistence, guillotine/eliminator handling
- MFL auction system: nomination flow, commissioner eligibility, compact badges, multi-draft pills
- DynastyProcess CSV player mappings
- MFL bundle reliability: batch fetches
- Mobile viewport zoom fix, input font-size fix
- Auction CSV export
- Draft multi-selector, aborted draft filter
- `_resolveSleeperIdentities` backfill
- DNS rollback to GoDaddy
- **Y6:** Yahoo redraft resolved flag — `lm.is_finished === 1` now marks resolved
- **Y1 (code):** `_detectYahooPlayoffFinish` rewritten — semi-winner detection, correct 1st/2nd/3rd/4th
- **Y1 (code):** Yahoo bracket finals sorted — championship game identified via semi-winner set
- **X1 (partial):** `_isSeasonComplete(l)` helper — "Missed Playoffs" vs "Season in Progress" cross-platform
- **Bug:** `_updateJumpDropdown` crash on undefined `leagueName` fixed
- **Worker:** Yahoo week fetches batched (3/batch, 300ms delay, 1 retry)
- **M1:** MFL championship detection — `_detectAndSetMFLPlayoffFinish()` added to `profile.js`; handles bracket, eliminator, and guillotine leagues; wired into `syncMFLTeams()`
- **Y1:** Yahoo playoff bracket verified and fully fixed — Championship + 3rd Place only (no 5th/7th), bye teams shown, semi-loser identification corrected, `_detectYahooPlayoffFinish` gated on user appearing in a playoff matchup (fixes false champion badges)
- **Y2:** Yahoo matchup expand — roster-only lineup (starters + bench, slot-ordered QB→RB→WR→TE→FLEX→SF→K→DEF), week pills use `season-pill` CSS, team name apostrophe bug fixed via data-attributes
- **Yahoo sync button** — per-league 🔄 Sync League button in detail panel header; clears resolved/playoffFinish flags and re-fetches bundle; wired in `openLeagueDetail` and `switchDetailSeason`
- **Yahoo Analytics Draft Recap** — now uses `DLRPlayers.getByYahooId` + Sleeper DB + rosterDetails fallback for player names (same chain as `draft.js`); shows pick preview under each team
- **Yahoo Analytics** — MFL Trade Map, Draft Recap, Waivers fixed (correct raw transaction shapes, `MFLAPI.getPlayers()` for names, auction unit path)
- **CSS** — `mu-sbs-row--no-pts` / `mu-sbs-header--no-pts` modifier added to `locker.css`; Yahoo expand uses 3-column grid (name | slot | name) instead of 5-column score grid
- **M2:** MFL Analytics Trade Map, Draft Recap, Waivers — fixed raw MFL transaction/draft shapes (franchise strings, pipe-delimited transaction field, auctionUnit path); added `MFLAPI.getPlayers()` for player name lookup
- Hallway Scroll + Card Grid
- Bottom Safe Area Clipping
- Groups: League Order + Dynasty Collapse
- Hallway pins moved to Firebase (gmd/users/{username}/hallwayPins), localStorage as cache
- Hallway card: leagues removed, 4 stats spread evenly, years played calculated from distinct seasons
- Hallway modal: common leagues only, dynasty/keeper deduplicated to most recent year
- **U4:** Commissioner broadcast message — JSON-in-onclick bug fixed via data attributes + addEventListener in `leaguegroups.js`
- **X1:** Season status audit — `_isSeasonComplete(l)` confirmed correct for all platforms; closed
- **Y3:** Yahoo Transactions team name — confirmed resolved
- **Yahoo playoff finish detection** — fully rewritten: `clinched`/`playoffSeed` gate replaces matchup parsing; `rank` from standings is source of truth; top-3 badges only (🏆🥈🥉); 🏅 removed
- **Bubble tag** — removed from all 3 platforms in `standings.js`; no more dim gold border for last playoff seed
- **`GMDB.saveLeague` singular** — fixed to `GMDB.saveLeagues` in all 6 call sites; was silently failing and preventing sync writes
- **`syncYahooLeague` null myId** — no longer throws; writes cleared flags + marks resolved, shows warning toast
- **`is_finished` gate** — removed from playoff detection; Yahoo returns 0 for many old completed leagues
- **Worker:** `yahooCallback` uses `?yahoo_token=` query params (mobile-safe, not hash)
- **Worker:** `yahooLeagueBundle` returns real 401 when Yahoo rejects token
- **`app.js`:** OAuth IIFE reads query params first, hash as fallback; `dlr_yahoo_pending` uses `localStorage`
- **`yahoo.js`:** Refresh failure falls back to optimistic use; stale refresh token cleared on reconnect
- **`profile.js`:** `linkYahoo` preserves existing league data on reconnect (no more data wipe)
- **`profile.js`:** MFL sync button added to detail panel for all MFL leagues (not just Yahoo)
- **`profile.js`:** `_detectAndSetMFLPlayoffFinish` persists `isGuillotine`/`isEliminator` to Firebase
- **`profile.js`:** Eliminator/guillotine leagues show "No Playoffs Scheduled" not "Missed Playoffs"
- **`profile.js`:** `finishIcon` on league cards top-3 only (🏆🥈🥉), no more 🏅
- **`profile.js`:** MFL sync error messaging — rate-limit suggestion, network error distinction
- **`firebase-db.js`:** `saveYahooTokens` / `getYahooTokens` added for durable token storage
- **Y4 CLOSED:** Yahoo OAuth token persistence fully fixed — root cause was `YAHOO_REDIRECT_URI` Cloudflare env var pointing to frontend (`dynastylockerroom.com`) instead of worker callback (`https://mfl-proxy.mraladdin23.workers.dev/auth/yahoo/callback`); also fixed `linked` gate in `app.js` `showApp` and added `saveYahooTokens` call in `profile.js` `linkYahoo`
- **F5-T1:** Median wins toggle (`meta.medianWins`) — Sleeper weekly scores fetched, median computed, +1W/+1L credited per week. Twitter handle column removed, embedded as inline 𝕏 link on name cell.
- **F5-P2:** Info tab (bio, donation link, social links, rules preview), Rules tab (plain textarea, versioned, admin-authored), admin Info/Rules editor tab.
- **F5-P3 partial:** Draft tab (ADP list, board, share card), Matchups tab (closest/blowouts/highest, weekly recap copy-prompt), Rosters tab (top 10 by standings, Sleeper roster data). Worker endpoints: `/tournament/draft`, `/tournament/recap`.
- **F5-P3 nav:** Tab bar → dropdown everywhere, global year selector in header (view mode only), Manage/View split on cards, admin analytics tabs added, "you" badge across analytics.
- **F5-P3 standings:** League name stacked under display name, Twitter as inline link, `table-layout: fixed` with explicit column widths.
- **Register pill:** Pulled out of tab dropdown into title row button, opens full-screen overlay.
- **Public site (tournaments/index.html):** Year selector in header, tab bar → select, standings mobile fix, rich Info tab (bio/social/donation/rules preview).

---

## Console Scripts (Safe to Run)

### Check MFL league data health
```js
const snap = await firebase.database().ref('gmd/users/mraladdin23/leagues').get();
const leagues = snap.val() || {};
const mfl = Object.entries(leagues).filter(([k,v]) => v.platform === 'mfl');
console.log('MFL total:', mfl.length);
console.log('With leagueName:', mfl.filter(([k,v]) => v.leagueName).length);
console.log('With myRosterId:', mfl.filter(([k,v]) => v.myRosterId).length);
console.log('Resolved:', mfl.filter(([k,v]) => v.resolved).length);
```

### Check Yahoo league data health
```js
const snap = await firebase.database().ref('gmd/users/mraladdin23/leagues').get();
const leagues = snap.val() || {};
const yahoo = Object.entries(leagues).filter(([k,v]) => v.platform === 'yahoo');
console.log('Yahoo total:', yahoo.length);
console.log('Resolved:', yahoo.filter(([k,v]) => v.resolved).length);
console.log('With playoffFinish:', yahoo.filter(([k,v]) => v.playoffFinish != null).length);
console.log('Missing teamName:', yahoo.filter(([k,v]) => !v.teamName).length);
```

### Check Yahoo token in Firebase
```js
const snap = await firebase.database().ref('gmd/users/mraladdin23/platforms/yahoo/tokens').get();
console.log('Yahoo tokens:', snap.val());
```

### Find resolved Yahoo leagues with no playoff finish (Yahoo had no data)
```js
const snap = await firebase.database().ref('gmd/users/mraladdin23/leagues').get();
const all = snap.val() || {};
Object.entries(all)
  .filter(([k,v]) => v.platform === 'yahoo' && v.resolved && v.playoffFinish == null)
  .forEach(([k,v]) => console.log(k, '|', v.leagueName, '|', v.season));
```

### Surgical fix for a single wrong league
```js
// Only use for one specific league, never bulk
const key = "yahoo_2024_123456"; // replace with actual key
await firebase.database().ref(`gmd/users/mraladdin23/leagues/${key}`).update({
  playoffFinish: null,  // or correct value: 1, 2, 3, 4, 5...
  isChampion: false,    // or true if champion
  resolved: null        // clear so it re-detects; omit if setting manually
});
console.log("Fixed", key);
```

### Reset a SINGLE MFL league (surgical — safe)
```js
const key = "mfl_2024_XXXXX"; // replace with actual key
await firebase.database().ref(`gmd/users/mraladdin23/leagues/${key}`).update({
  playoffFinish: null, isChampion: false, resolved: null
});
console.log("Reset", key, "— click Sync to re-detect");
```

### Clear bundles node (safe — only clears cached bundles, not league data)
```js
await firebase.database().ref('gmd/users/mraladdin23/bundles').remove();
console.log("Bundles cleared");
```

### Check tournament participantMap for a given tournament (verify gender/displayName sync)
```js
const TID = "YOUR_TOURNAMENT_ID"; // ← replace
const snap = await firebase.database().ref(`gmd/publicTournaments/${TID}/participantMap`).get();
const map = snap.val() || {};
const entries = Object.entries(map);
console.log(`participantMap: ${entries.length} keys`);
entries.slice(0, 10).forEach(([k, v]) =>
  console.log(`  "${k}" → displayName:"${v.displayName}" gender:"${v.gender}"`)
);
```

### Diagnose tournament draft data in Firebase
```js
const TID = "YOUR_TOURNAMENT_ID"; // ← replace
const snap = await firebase.database().ref(`gmd/tournaments/${TID}/analyticsCache/drafts`).get();
const drafts = snap.val() || {};
const keys = Object.keys(drafts);
console.log(`Draft cache: ${keys.length} leagues`);
keys.forEach(k => {
  const d = drafts[k];
  console.log(`  ${k}: ${d.picks?.length || 0} picks, platform=${d.platform}, year=${d.year}`);
  if (d.picks?.length) console.log(`    sample pick:`, d.picks[0]);
});
```

### Clear tournament analytics cache (force re-fetch)
```js
const TID = "YOUR_TOURNAMENT_ID"; // ← replace
await firebase.database().ref(`gmd/tournaments/${TID}/analyticsCache`).remove();
console.log("Analytics cache cleared — draft and matchups will re-fetch on next view");
```

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*
