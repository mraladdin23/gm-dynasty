# Dynasty Locker Room — Master TODO List
*Updated: April 18, 2026 (session 3)*
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

### Y1 — Yahoo Playoff Tab + Championship Detection
**Status:** Code fixed April 18 — needs verification once Yahoo API stabilizes.
Detection logic rewritten to identify championship game via semi-winner set.
3rd/4th place correctly distinguished. Some old leagues (2002–2011) may have
no matchup data from Yahoo's API and will show "Missed Playoffs" by default.

**Remaining verification needed:**
- Confirm bracket display correctly labels Championship vs 3rd Place games
- Confirm finish detection is correct across multiple leagues once re-import completes
- Manual surgical fixes still needed for any leagues Yahoo API can't provide data for

**Files:** `profile.js`, `standings.js`

---

### Y2 — Yahoo Matchup Pills + Player Score Expand
**Problem:** Expanded matchup should show lineup with individual player scores,
not just team totals.
**Note:** Worker needs `/yahoo/matchupDetail` endpoint confirmed and deployed.
**Files:** `standings.js`, `worker.js`

---

### Y3 — Yahoo Transactions Team Name Blank
**Root cause:** `roster_ids[0]` comes from `tx.teamId` which may be null when worker
can't find the team key. For adds, team is `destination_team_key` at transaction level
(not player level). For drops, it's `source_team_key`.
- Verify `t.id` in `bundle.teams` matches `teamId` strings (both bare numeric like `"3"`)
- If `_teamName()` returns `Team ${id}`, check if the `initiator` logic fires for Yahoo FA moves
**Files:** `transactions.js`, `worker.js`

---

### Y4 — Yahoo Token Expired on Mobile
**Problem:** Yahoo leagues work in browser but on mobile every tab says "token expired"
with no way to refresh. Reconnecting Yahoo does not always fix it.
**Files:** `yahoo.js`, `worker.js`, `app.js`

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

### Y6 — Yahoo Completed Redraft Leagues Not Marked Resolved ✅
**Fixed April 18.** `_resolveYahooIdentities` now sets `resolved: true` when
`lm.is_finished === 1` regardless of `leagueType`. Resolved leagues are also
skipped in the filter to prevent re-fetching.
**Files:** `profile.js`

---

## 🔴 MFL Platform Bugs

### M1 — MFL Championship Detection (All League Types)
**Problem:** Eliminator/guillotine leagues not capturing 1st/2nd/3rd finish correctly.
Regular bracket leagues also not capturing championships from playoff bracket results.
**Files:** `profile.js`, `mfl.js`

### M2 — MFL Analytics Tab Empty (Trade Map, Draft Recap, Waivers)
**Problem:** All three analytics sections show nothing for MFL leagues.
**Files:** `analytics.js`, `mfl.js`

---

## 🟡 Cross-Platform Bugs

### X1 — Leagues Show "Season in Progress" After Completion
**Status:** Partially fixed April 18. `_isSeasonComplete(l)` helper added to
`profile.js` — correctly shows "Missed Playoffs" for past-season Yahoo/MFL leagues
using `resolved` flag and `season < currentYear`. Sleeper uses `status === "complete"`.
**Remaining:** League card grid and other places that show status badges may still
need audit for non-Sleeper platforms.
**Files:** `profile.js`, `standings.js`

### X2 — Link Leagues Across Platforms
**Problem:** No way to connect a franchise that moved platforms (e.g. MFL → Sleeper,
Yahoo → Sleeper) so it shows as a continuous dynasty history.
**Note:** Needs design decision — manual linking (user picks) or auto-match by name/roster?
**Files:** `profile.js`, `firebase-db.js`, `leaguegroups.js`

---

## 🟡 Mobile / UI Polish

### U1 — Hallway Scroll + Card Grid
**Problem:** Hallway won't scroll on mobile. Cards are too large.
**Fix:** 3-across grid, 4 rows per page, pagination for remaining cards.
**Files:** `hallway.js`, `locker.css`

### U2 — Bottom Safe Area Clipping
**Fix:** Add `padding-bottom: env(safe-area-inset-bottom)` to:
- `.league-detail-body`
- `.app-view.active`
**Files:** `locker.css`

### U3 — Groups: League Order + Dynasty Collapse
**Problem:** When creating/editing groups, leagues should be ordered year descending
then alphabetically. Dynasty/keeper chains should show only the most recent year.
**Files:** `leaguegroups.js`

### U4 — Groups: Broadcast Message Not Working
**Problem:** Commissioner broadcast message button does nothing.
**Files:** `leaguegroups.js`

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

---

## Suggested Session Order

| # | ID | Description | Effort | Files |
|---|-----|-------------|--------|-------|
| 1 | Y1 | Yahoo Playoff/Championship (verify) | Low | `profile.js`, `standings.js` |
| 2 | M1 | MFL Championship Detection | Medium | `profile.js`, `mfl.js` |
| 3 | M2 | MFL Analytics Tab | Medium | `analytics.js`, `mfl.js` |
| 4 | Y2 | Yahoo Matchup Pills + Scores | Medium | `standings.js`, `worker.js` |
| 5 | Y4 | Yahoo Mobile Token | High | `yahoo.js`, `worker.js`, `app.js` |
| 6 | Y3 | Yahoo Transactions Team Name | Low | `transactions.js`, `worker.js` |
| 7 | U1 | Hallway Grid + Scroll | Low | `hallway.js`, `locker.css` |
| 8 | U2 | Bottom Safe Area | Trivial | `locker.css` |
| 9 | U3 | Groups League Order | Low | `leaguegroups.js` |
| 10 | U4 | Broadcast Message | Low | `leaguegroups.js` |
| 11 | X1 | Season in Progress Badge (audit) | Low | `profile.js`, `standings.js` |
| 12 | Y5 | Yahoo Bundle Stability | Medium | `worker.js`, `yahoo.js` |
| 13 | X2 | Cross-Platform League Link | High | `profile.js`, `firebase-db.js`, `leaguegroups.js` |
| 14 | F1 | Dynasty Overview Tab | High | `standings.js`, `profile.js`, `locker.css` |
| 15 | F2 | Custom Playoff Tracker | Very High | New module + several files |
| 16 | F7 | Custom Trophy Builder | High | `trophy-builder.js`, `trophy-room.js`, `locker.css` |
| 17 | F4 | Locker Room Redesign + Team Theme | Very High | New theme system + CSS refactor |
| 18 | F6 | Post-It Trash Talk Wall | High | `postits.js`, `firebase-db.js`, `locker.css` |
| 19 | F5 | Tournament Mode | Very High | New `tournament.js` + several files |

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

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*
