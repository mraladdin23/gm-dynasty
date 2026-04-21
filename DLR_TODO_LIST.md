# Dynasty Locker Room — Master TODO List
*Updated: April 20, 2026 (session 7)*
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

### Y4 — Yahoo OAuth Token Not Persisting (Mobile + Browser)
**Status:** Partially fixed. Multiple changes applied this session but token is still
not being saved to Firebase after OAuth callback. The root cause is a deployment
sequencing problem — the uploaded files in each session are several versions behind
the output files, meaning changes are not making it into the repo reliably.

**What has been fixed (confirmed in output files):**
- Worker: `yahooCallback` now uses `?yahoo_token=` query params instead of `#hash`
  (query params survive mobile Safari redirect chains)
- Worker: `yahooLeagueBundle` returns real 401 when Yahoo rejects token instead of
  empty bundle (was causing confusing downstream errors)
- `app.js`: OAuth IIFE reads query params first, hash as fallback
- `app.js`: `dlr_yahoo_pending` flag uses `localStorage` not `sessionStorage`
- `app.js`: `showApp` calls `YahooAPI.setUsername()` and syncs token to Firebase
- `yahoo.js`: `storeTokens` is localStorage-only (no timing issues with GMDB)
- `yahoo.js`: `setUsername()` and `loadTokensFromFirebase()` added
- `yahoo.js`: `_getValidToken` falls back to Firebase if localStorage empty
- `yahoo.js`: Refresh failure falls back to optimistic token use instead of throwing
- `firebase-db.js`: `saveYahooTokens` / `getYahooTokens` added
- `profile.js`: `linkYahoo` now merges with existing league data on reconnect
  (was wiping playoffFinish, myRosterId, teamName, etc. on every reconnect)
- `profile.js`: `_resolveYahooIdentities` waits for token before fetching bundles

**What is still broken:**
- Token is not appearing at `gmd/users/mraladdin23/platforms/yahoo/tokens` in Firebase
- The most likely remaining cause: the deployed files don't include the Firebase
  token sync block in `showApp` — confirm by checking if `YahooAPI.setUsername`
  exists in the live `yahoo.js`

**Files needed for next session:** `app.js`, `yahoo.js`, `firebase-db.js`, `profile.js`

**Key files to verify are deployed (check live source):**
- `yahoo.js` should export `setUsername` and `loadTokensFromFirebase`
- `app.js` `showApp` should call `YahooAPI.setUsername(profile.username)`
- `firebase-db.js` should have `saveYahooTokens` and `getYahooTokens` in return block

---

### Y5 — Yahoo Bundle Instability
**Status:** Partially improved — worker now batches week fetches (3/batch, 300ms delay,
1 retry) instead of firing all weeks in parallel. Yahoo still rate-limits under heavy
load (59 leagues re-importing at once). Bundle reliability for normal single-league
tab opens should be meaningfully better.
**Remaining:** Yahoo still blocks the app token under heavy load. No reliable fix
without caching bundles server-side or reducing re-import frequency.
**Files:** `worker.js`, `yahoo.js`

---

## 🔴 MFL Platform Bugs

*(none currently)*

---

## 🟡 Cross-Platform Bugs

### X2 — Link Leagues Across Platforms
**Problem:** No way to connect a franchise that moved platforms (e.g. MFL → Sleeper,
Yahoo → Sleeper) so it shows as a continuous dynasty history.
**Note:** Needs design decision — manual linking (user picks) or auto-match by name/roster?
**Files:** `profile.js`, `firebase-db.js`, `leaguegroups.js`

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

### F3 — Cross-Platform League Linking (see X2)
Tracked under X2 above.

### F4 — Locker Room Visual Redesign + Team Customization
**Idea:** Redesign the main locker room UI to look like an actual locker. User can
select their favorite NFL team and the locker theme (colors, logo, textures) updates
to match. Interchangeable visual elements — door style, nameplates, decorations.
Reference design/mockup to be provided by Mike.
**Files:** New CSS theme system + `locker.css`, `base.css`, `profile.js`, `index.html`
**Note:** Needs design mockup attached to session.

### F5 — Tournament Mode (Cross-Platform)
**Idea:** A full tournament feature that works across Sleeper, MFL, and Yahoo.
**Files:** New `tournament.js` module + `firebase-db.js`, `index.html`, `locker.css`
**Note:** Very large feature. Needs scoping session.

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
| 1 | Y4 | Yahoo OAuth Token Persistence (finish) | High | `app.js`, `yahoo.js`, `firebase-db.js`, `profile.js` |
| 2 | Y5 | Yahoo Bundle Stability | Medium | `worker.js`, `yahoo.js` |
| 3 | F8 | Hallway: H2H Records in Common Leagues | Medium | `hallway.js` |
| 4 | X2 | Cross-Platform League Link | High | `profile.js`, `firebase-db.js`, `leaguegroups.js` |
| 5 | F1 | Dynasty Overview Tab | High | `standings.js`, `profile.js`, `locker.css` |
| 6 | F2 | Custom Playoff Tracker | Very High | New module + several files |
| 7 | F7 | Custom Trophy Builder | High | `trophy-builder.js`, `trophy-room.js`, `locker.css` |
| 8 | F4 | Locker Room Redesign + Team Theme | Very High | New theme system + CSS refactor |
| 9 | F6 | Post-It Trash Talk Wall | High | `postits.js`, `firebase-db.js`, `locker.css` |
| 10 | F5 | Tournament Mode | Very High | New `tournament.js` + several files |

---

## ✅ Completed

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

---

## ⚠️ Notes for Next Session (Y4 continuation)

**Before starting next session, verify these files are current in the repo:**
1. Open `yahoo.js` in the repo — does it contain `function setUsername`? If not, the Firebase token changes were never deployed.
2. Open `app.js` in the repo — does `showApp` contain `YahooAPI.setUsername`? If not, same problem.
3. Open `firebase-db.js` in the repo — does the return block contain `saveYahooTokens`?

**If any of the above are missing:** attach those files fresh from the repo to the next session — not from local copies — and apply the changes from scratch against the actual live files. The disconnect between output files and deployed files has been the main blocker this session.

**Deployment checklist for Y4 fixes:**
- `firebase-db.js` → git push (no Cloudflare needed)
- `yahoo.js` → git push
- `profile.js` → git push
- `app.js` → git push
- `worker.js` → paste into Cloudflare dashboard (git push alone is not enough)

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*
