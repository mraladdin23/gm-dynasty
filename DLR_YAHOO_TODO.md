# DLR Yahoo & MFL — Remaining Issues
*Updated: April 18, 2026*
*Attach with DLR_PROJECT_SUMMARY.md + specific files per task.*

---

## How to Use This Doc
Each issue below is self-contained. For each session: attach this doc + project summary +
only the files listed under that issue. Fix one issue per session where possible.

---

## ✅ Completed

- Yahoo OAuth flow
- Yahoo Standings (CSS matches MFL/Sleeper, sort confirmed)
- Yahoo Matchups (season-pill week bar, click-to-expand with team stats)
- Yahoo Roster tab (PREFERRED_ORDER position grouping, detailMap fallback)
- Yahoo Players tab (YTD stats via `/yahoo/playerStats`, position dropdown)
- Yahoo Analytics (leagueKey wired)
- Yahoo keeper detection (`hasKeeperPicks` from draft data + `uses_roster_import`)
- Yahoo token fix: optimistic use when `expiresAt` is 0
- MFL `_detectMFLPlayoffFinish`: `isGuillotine` param, skips bracket for guillotine
- MFL guillotine standings rank cap removed
- MFL `resolved` flag: allows guillotine redraft leagues through
- Worker `userLeagues` SINCE= gap-fill: year-by-year supplement for missing years
- Mobile stuck panel fix: `renderLocker` closes detail panel on every load
- Mobile safe area: `viewport-fit=cover`, `env(safe-area-inset-top)`, `100dvh`

---

## 🔴 Issue 1 — Career Stats Modal Crash
**Status:** Broken — throws error every time career modal is opened.

**Error:** `Uncaught ReferenceError: _renderCSPlatform is not defined`

`_openCareerSummaryModal` in `profile.js` calls `_renderCSPlatform()` and
`_renderCSPlatformYear()` but these functions were never implemented.

**Fix needed in `profile.js`:**
Add two render functions after `_renderCSMatrix`:

`_renderCSPlatform(leagues)`: table grouped by `l.platform` ("sleeper", "mfl", "yahoo").
Use `_platformLabel()` for display names. Same structure as `_renderCSType`.

`_renderCSPlatformYear(leagues)`: matrix with rows=seasons, columns=platforms.
Same structure as `_renderCSMatrix`.

**Fix needed in `index.html`:**
Add after existing cs-tab buttons and panels:
```html
<button class="cs-tab" data-cstab="platform">By Platform</button>
<button class="cs-tab" data-cstab="platform-year">Platform × Year</button>
...
<div id="cs-platform"      class="cs-panel"></div>
<div id="cs-platform-year" class="cs-panel"></div>
```

**Files:** `profile.js`, `index.html`

---

## 🔴 Issue 2 — Yahoo Draft Tab Empty
**Status:** Debug instrumentation in place, needs deploy + console output to fix parser.

**Current state:** `worker.js` has `_draftDebug` object capturing parse shape info.
`draft.js` logs `bundle._draftDebug` to console after bundle fetch.

**Action needed:**
1. Deploy current `worker.js` to Cloudflare (paste into dashboard)
2. Open a Yahoo league → Draft tab → DevTools Console
3. Paste the `[Yahoo draft] debug:` output — key fields: `dResultsType`, `dContainerKeys`, `draftRawType`, `draftArrLen`
4. Fix the parser based on actual response shape
5. Remove `_draftDebug` from worker response and `draft.js` console log

**Files:** `worker.js`, `draft.js`

---

## 🔴 Issue 3 — Yahoo Transactions Team Name Blank
**Status:** Team name blank on most Yahoo transactions.

**Root cause:** `roster_ids[0]` comes from `tx.teamId` which may be null when worker
can't find the team key. For add transactions, team is `destination_team_key` at the
transaction level (not player level). For drops, it's `source_team_key`.

**Fix approach:**
- Verify `t.id` in `bundle.teams` matches `teamId` strings on transactions (both
  should be bare numeric strings like `"3"`)
- If `_teamName()` returns `Team ${id}`, at least that shows something — check if
  the `initiator` logic fires correctly for Yahoo free agent moves:
  ```js
  const initiator = type !== "trade" && tx.roster_ids?.[0]
    ? _teamName(tx.roster_ids[0]) : "";
  ```

**Files:** `transactions.js`, `worker.js`

---

## 🔴 Issue 4 — Yahoo Playoff Finish Bug (Runner-up shown as 3rd)
**Status:** Some leagues where user finished 2nd show `playoffFinish: 3`.

**Root cause:** In `_detectYahooPlayoffFinish` (`profile.js`):
The problem is that `allMatchups` may include a "3rd place game" in the same final
week as the championship. All 4 playoff teams are in `playoffTeamSet` so the
consolation game teams aren't excluded.

**Fix needed in `profile.js`:**
1. Find the championship game (only game in last playoff week involving teams who
   won their semifinal)
2. If user is in championship game: win = 1st, lose = 2nd
3. If user plays in final week but NOT in championship game: win = 3rd, lose = 4th
4. If eliminated in semifinal week: 3rd/4th

**Files:** `profile.js`

---

## 🟡 Issue 5 — Yahoo Matchup Player Scores
**Status:** `/yahoo/matchupDetail` endpoint not yet in deployed worker.

The two-step fetch (scoreboard → roster+stats) was built in a previous session but
the worker with that endpoint has not been deployed. Need to:
1. Confirm `/yahoo/matchupDetail` endpoint exists in `worker.js`
2. Deploy worker
3. Test by clicking a matchup expand on a Yahoo league

**Files:** `worker.js`, `standings.js`

---

## 🟡 Issue 6 — Yahoo Firebase Persistence (saveLeague Failures)
**Status:** Yahoo leagues sometimes don't save correctly after resolution.

**Root cause suspects:**
1. Race condition in `_resolveYahooIdentities` (CONCURRENCY = 2)
2. Firebase REST API timeout during slow Yahoo bundle fetch
3. `resolved` flag set on stale copy

**Fix approach:**
- Reduce CONCURRENCY from 2 to 1 in `_resolveYahooIdentities`
- Add retry logic to `saveLeague` — if fails once, wait 1 second and retry

**Files:** `profile.js`, `firebase-db.js`

---

## 🟡 Issue 7 — Yahoo Completed Redraft Leagues Not Getting `resolved`
**Status:** Past-season Yahoo redraft leagues re-fetch on every page load.

**Fix:** Also mark resolved if `lm.is_finished === 1` regardless of `leagueType`:
```js
if (_isPastSeason(l) && playoffFinish !== null
    && (leagueType !== "redraft" || lm.is_finished === 1)) {
  _markResolved(l);
}
```

**Files:** `profile.js`

---

## 🟡 Issue 8 — MFL Guillotine Championship Detection
**Status:** Existing guillotine/eliminator leagues in Firebase may have wrong
`playoffFinish` values from before the `isGuillotine` fix.

**⚠️ WARNING:** Do NOT run bulk reset scripts on Firebase league data.
This has caused repeated data corruption. Instead, fix surgically:

For any specific league showing wrong championship:
```js
// Fix ONE league at a time — replace KEY with the specific mfl_YYYY_XXXXX key
const key = "mfl_2024_XXXXX";
await firebase.database().ref(`gmd/users/mraladdin23/leagues/${key}`).update({
  playoffFinish: null,
  isChampion: false,
  resolved: null
});
console.log("Reset", key, "— click Sync to re-detect");
```
Then click **Sync** to re-run detection.

For guillotine leagues, `playoffFinish` = standings rank (last surviving = 1st,
last eliminated = 2nd, etc.). The code is correct — the issue is stale Firebase data.

---

## 🟢 Issue 9 — Bottom Safe Area on Mobile
**Status:** Content at bottom of scrollable areas clipped behind home indicator.

**Fix:** Add `padding-bottom: env(safe-area-inset-bottom)` to:
- `.league-detail-body`
- `.app-view.active`

**Files:** `locker.css`

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

### Reset a SINGLE MFL league (surgical — safe)
```js
// Only use this for one specific league, not bulk
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

## Suggested Session Order
1. **Issue 1** — Career stats crash (`profile.js` + `index.html`, fix first — it's a hard error)
2. **Issue 2** — Yahoo draft (deploy worker, read console output, fix parser)
3. **Issue 3** — Yahoo transactions team name
4. **Issue 4** — Yahoo playoff finish bug
5. **Issue 5** — Yahoo matchup player scores (worker deploy)
6. **Issue 7** — Yahoo redraft resolved flag (one-liner)
7. **Issue 9** — Bottom safe area (CSS only)

---

## Files Modified (April 18 Session)
| File | Key Changes |
|------|-------------|
| `worker.js` | `userLeagues`: SINCE= gap-fill — fetches missing years year-by-year after SINCE= response |
| `profile.js` | `renderLocker`: closes detail panel + clears `_detailLeagueKey` on every load (stuck panel fix) |
| `yahoo.js` | Token fix restored: `!expiresAt` optimistic condition; `_draftDebug` removed; `isKeeper`/`hasKeeperPicks` restored; `uses_roster_import` in leagueMeta |
| `base.css` | `min-height: 100dvh` restored on `.screen` |
| `index.html` | `viewport-fit=cover` restored in viewport meta |
