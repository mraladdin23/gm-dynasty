# Dynasty Locker Room — Master TODO List
*Updated: April 22, 2026 — F5-T2, F5-T3, F5-T4 complete. F5-T1 and F5-P2 remaining items are next.*
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

### F1 — Dynasty/Keeper League Overview Tab
**Idea:** For dynasty and keeper leagues, add an "Overview" tab consolidating standings
and analytics across all years, with a year selector at the top.
**Files:** `standings.js`, `profile.js`, `locker.css`
**Note:** Significant feature — needs scoping session first.

### F2 — Custom Playoff Tracker
**Idea:** Define a custom playoff structure (e.g. Royal Rumble: bottom 4 → winner faces
next 4 → winner faces top 4 → top 2 for championship) that DLR tracks and updates
independent of what the platform reports.
**Files:** New module likely needed + `firebase-db.js`, `standings.js`, `index.html`
**Note:** Large feature. Related to F5 Tournament Mode below.

### F4 — Locker Room Visual Redesign + Team Customization
**Idea:** Redesign the main locker room UI to look like an actual locker. User can
select their favorite NFL team and the locker theme (colors, logo, textures) updates
to match. Interchangeable visual elements — door style, nameplates, decorations.
Reference design/mockup to be provided by Mike.
**Files:** New CSS theme system + `locker.css`, `base.css`, `profile.js`, `index.html`
**Note:** Needs design mockup attached to session.

### F5 — Tournament Mode (Cross-Platform)
**Spec:** `GMDynasty_Tournament_Spec.docx` (v1.0) — attach to any tournament session.
**Files:** `tournament.js`, `tournament.css`, `tournaments/index.html`
**Public URL:** `dynastylockerroom.com/tournaments`

**Phase 1 — Foundation ✅ COMPLETE**

**Phase 2 — Core Views (Standings ✅, T2 ✅, T3 ✅, T4 ✅, remaining items below)**

### F5-T1 — Standings column settings + median wins
**What:** Admin settings (on Overview tab or new Settings tab) to:
1. Toggle median wins on/off (`meta.medianWins`). When enabled, any team scoring above
   the weekly median score gets +1 win. Sleeper only: fetch weekly scores per league,
   compute median, add to W/L before caching.
2. Twitter handle column in standings (opt-in toggle) — data is already captured in
   participant records, just needs a settings toggle and render path.
**Files:** `tournament.js`
**Note:** Gender is now a badge inline on team name (not a column). Twitter handle
column deferred to a later session per earlier discussion.

### F5-P2 remaining — Info page + Rules tab rich text
**What:** Phase 2 has two remaining items not yet built:
1. **Tournament Info tab** — rich text bio section (admin can write tournament history,
   embed links), donation link field, social links, status banner
2. **Rules tab** — admin authors a custom rules document (rich text), versioned, users
   see latest version. Tiebreaker config (PF vs H2H).
**Files:** `tournament.js`, `tournament.css`
**Note:** Rich text editor library choice (Quill, TipTap, or plain textarea) needs
to be decided before building. Recommend starting with plain `<textarea>` with
newline-to-`<br>` rendering, then upgrading later.

**Phase 3 — Analytics & Weekly Views**
- Consolidated draft board + ADP, weekly matchup summary, top rosters, AI-assisted recap
- **Open question:** AI recap — Claude API from Cloudflare Worker or Firebase Function?

**Phase 4 — Custom Playoffs**
- Format config (top-X by PF, divisional, H2H bracket, hybrid), list/bracket rendering
- **Open question:** Double elimination in Phase 4 or defer?
- **Note:** F2 (Custom Playoff Tracker) overlaps — decide before scoping.

**Phase 5 — Advanced**
- Cross-platform identity merging, weekly summary emails, message board integration
- **Open question:** Email provider; fallback for low-confidence auto-match?

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

| # | ID | Description | Effort | Files |
|---|-----|-------------|--------|-------|
| 1 | F5-T1 | Median wins toggle + standings column settings | Medium | `tournament.js` |
| 2 | F5-P2b | Info page + Rules tab rich text | Medium | `tournament.js`, `tournament.css` |
| 3 | F5-P3 | Tournament Phase 3 (Analytics) | Very High | `tournament.js`, `firebase-db.js` |
| 4 | F5-P4 | Tournament Phase 4 (Playoffs) | Very High | `tournament.js`, `firebase-db.js` |
| 5 | F5-P5 | Tournament Phase 5 (Advanced) | Very High | `tournament.js`, `firebase-db.js`, worker |
| 6 | F8 | Hallway: H2H Records in Common Leagues | Medium | `hallway.js` |
| 7 | F1 | Dynasty Overview Tab | High | `standings.js`, `profile.js`, `locker.css` |
| 8 | F2 | Custom Playoff Tracker | High | New module + several files |
| 9 | F7 | Custom Trophy Builder | High | `trophy-builder.js`, `trophy-room.js`, `locker.css` |
| 10 | F4 | Locker Room Redesign + Team Theme | Very High | New theme system + CSS refactor |
| 11 | F6 | Post-It Trash Talk Wall | High | `postits.js`, `firebase-db.js`, `locker.css` |

---

## ✅ Completed

- **Item 2 (Session A):** Options modal gating — commish-only fields hidden from non-commish users; read-only groups/labels display shown to all; `leaguegroups.js` exports `loadCommGroups`
- **Item 1 (Session B):** Group filter — unified 🗂 My Groups button + panel with "My Labels" / "Commissioner Groups" subsections loaded async from Firebase; count badge on active filters. Bug fixes: old HTML IDs replaced (`filter-groups-btn` → `filter-mygroups-btn`); `_franchiseMatchesFilter` now uses `_groupsCache.leagueKeys` arrays instead of legacy `commishGroup` text; `commUsername` check ensures group creators always see their groups
- **X2 / Item 3 (Session C):** Cross-platform merge — auto-detects same-name commish leagues (emoji stripped by `_normalizeName`); Merge folds older chain into newer; Unlink is soft undo (`suppressMerge`); `_buildFranchises()` applies merge links transparently; `firebase-db.js` gets `saveMergeLinks`/`removeMergeLinks`. Bug fixes: detail panel/overview/history use `_resolveEffectiveFid` + `_getAllSeasonsForFranchise` so merged seasons show in season pills; commish requirement relaxed to current league only
- **F5-P1 COMPLETE:** Tournament Mode Phase 1 — admin create/edit, league batches, roles, lifecycle,
  registration form builder, registrant review, participant DB + DLR matching, auto-discovery,
  CSV export/import, view persistence, public tournament directory at /tournaments
- **F5-P2 Standings COMPLETE:** Sync from Sleeper/MFL/Yahoo, year_leagueId cache keys (dedup fix),
  year dropdown, ranking methods, playoff start week with Sleeper regular-season-only W/L recompute,
  gender column + filter, CSS match to locker.css, admin preview-as-user toggle, public page standings
- **Y5 CLOSED:** Yahoo bundle instability — batching + per-league Sync button declared best achievable
- **F5-T3 COMPLETE:** Standings/UI fixes — playoff start week field added to admin Overview (saves on blur/Enter); "Preview as User" button restored in admin tools section; standings toolbar cleaned up (year above search, conference/division as single grouped select, gender filter removed from toolbar); mobile card overflow fixed; tab bar replaced with `<select>` dropdown on mobile (≤640px); `#view-tournament.active` scroll override added to `tournament.css` matching `#view-hallway` pattern
- **F5-T2 COMPLETE:** Twitter handle shown as clickable `𝕏 @handle` link in participant list rows and detail modal (leading @ stripped); Sleeper DLR identity matching broadened to try `sleeperUsername`, `username`, `displayName`, `display_name` fields; participant detail modal shows Twitter as clickable link
- **F5-T4 COMPLETE:** Public page (`tournaments/index.html`) fully synced with internal app — standings table uses same CSS classes (`standings-table`, `standings-rank`, `standings-team-cell`, `st-av`); tab bar has mobile `<select>` dropdown; year select moved into standings toolbar above search; last synced info dimmed and small; gender badges (blue M / pink F) shown inline on team names on both internal and public pages
- **F5 Display Name + Gender Badges COMPLETE:** Internal standings now show participant `displayName` from the participants list instead of the raw Sleeper `display_name`; gender badge (🔵 M / 🩷 F) appears inline in team name cell on both internal and public standings; `_writePublicSummary` now includes a `participantMap` (sanitized keys → `{displayName, gender}`) so the public page has the data without needing auth; Firebase key sanitization (`_sk`) strips illegal chars (`.#$/[]`) from all participant map keys — fixes the "nora/maeve/aelish strafford" write error; draft tournaments with standings data now visible in internal "All Tournaments" list
- Yahoo Draft tab: endpoint fixed, multi-shape parser (Shapes 1–5), grid/list/auction views, 25/page pagination, DEF fallback
- Yahoo Keeper detection: `players;status=K` cross-reference, `isKeeper` on picks, K badge in list+grid, KEEPER badge in toggle bar
- Yahoo League type detection: `leagueTypeConfirmed` flag prevents re-fetch spam
- `allMatchups` fetch capped to `current_week`
- Career Stats modal: `_renderCSPlatform` + `_renderCSPlatformYear` implemented
- `leagueTypeConfirmed: true` bulk-set in Firebase for all past Yahoo seasons
- Yahoo OAuth flow
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

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*
