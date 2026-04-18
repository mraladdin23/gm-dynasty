# DLR Yahoo Integration — Remaining Work
*Updated after session completing Steps 1–5, 8, and partial 6.*
*Attach: DLR_PROJECT_SUMMARY.md + the specific files listed per step.*

---

## Context
All files from previous sessions are in the GitHub repo. The worker is deployed
via `wrangler deploy`. CSS lives in `css/locker.css`. Key CSS classes confirmed:
- Standings: `standings-row--me` (not `--mine`), `standings-win`, `standings-loss`,
  `standings-num`, `st-av`, `bubble-tag`, `standings-legend`, `standings-table-wrap`
- Matchups: `mu-card`, `mu-header`, `mu-team`, `mu-team--right`, `mu-scores`,
  `mu-score`, `mu-score--win`, `mu-score--lose`, `mu-dash`, `mu-no-detail`, `fw-700`
- Playoffs: `bracket-wrap`, `bracket-section`, `bracket-section-label`,
  `bracket-section-games`, `bracket-match`, `bracket-slot`, `bracket-slot--win`,
  `bracket-slot--lose`, `bracket-slot--me`, `bracket-team`, `bracket-score`,
  `bracket-check`, `bracket-tbd`, `bracket-finals`, `bracket-finals-game`,
  `bracket-finals-label`, `seed-tag`, `playoffs-pending`

---

## ✅ Completed This Session

### Step 8 — Analytics: leagueKey wire-up ✅
`analytics.js` + `profile.js` — `_leagueKey` state var added, passed as 6th arg
from `profile.js`, used in `_renderYahooAnalytics` instead of hardcoded `nfl.l.` prefix.
`poStart` guard fixed (`> 0 ? ... : 999`). Non-blocking `recomputeStats` added at
end of `renderLocker` for Yahoo-linked users (also covers Step 10).

### Step 1 — Standings CSS Fix ✅
`standings.js` — `_renderYahooStandings` rebuilt to match MFL structure exactly:
`standings-row--me` (was `--mine`), `★` star, `standings-win`/`standings-loss`/
`standings-num` classes, `standings-legend` at bottom, bubble tag.

### Step 2 — Matchup Click-to-Expand ✅
`standings.js` — `_renderYahooMatchups` cards now have `onclick` toggle on `.mu-detail`.
Expand section shows season W–L + total PF for both teams (looked up from `bundle.standings`).

### Step 3 — Standings Sort ✅
Already confirmed in place: wins DESC → PF DESC in `_renderYahooStandings`.

### Step 4 — Roster Tab: Dynamic Position Groups ✅
`roster.js` — `_teamCardHTML` uses `PREFERRED_ORDER = ["QB","RB","WR","TE","K","DEF","PN","Coach"]`
first, then remaining positions (DL, LB, CB, S, etc.) alphabetically. Sleeper keeps
hardcoded `POS_ORDER`. Also added `detailMap` from `bundle.rosters[].playerDetails`
as bio fallback for players missing from DynastyProcess CSV.

### Step 5 — Players Tab: Position Filter + Bio Fallback + Yahoo Stats ✅
`rules-and-fa.js` — Position filter replaced with `<select>` dropdown using same
`PREFERRED_ORDER` prefix + alphabetical extras. Toolbar collapsed to two rows (search
+ single flex-wrap control row). `detailMap` fallback for unmatched players.

**Yahoo season stats added (new worker endpoint):**
- `worker.js` — new `/yahoo/playerStats` POST endpoint: batches player IDs into
  groups of 25, fetches `league/{key}/players;player_keys={...};out=stats`, returns
  `{ [playerId]: totalPts }`. Parses `player_points.total` first, falls back to
  summing `stat_id=0` from stats array.
- `yahoo.js` — exposed `_getValidToken` and `_workerBase` on public surface.
- `rules-and-fa.js` — `_loadYahooRosterData` now fetches Yahoo YTD stats + Sleeper
  historical stats (2018+). Points resolved as: `sleeperPts ?? yahooPts`. Pts sort
  and year selector now shown for Yahoo (was previously hidden).

---

## Step 6 — Draft Tab: Fix Empty Results ⚠️ NEEDS DEPLOY + DEBUG
**Files:** `worker.js`, `draft.js`

**Status:** Debug instrumentation added but not yet deployed/tested. Both files
are in the repo with the following changes:

**`worker.js`** — draft parsing block rewritten with:
- `_draftDebug` object capturing `dResultsType`, `dContainerKeys`, `draftRawType`,
  `draftArrLen`, `error` at each parse step
- Handles additional response shapes (Shape C/D where `draft_results` is an object,
  not an array)
- `_draftDebug` returned in the response payload for client-side inspection

**`draft.js`** — after `getLeagueBundle()`, logs:
```js
console.log("[Yahoo draft] debug:", bundle._draftDebug);
console.log("[Yahoo draft] picks parsed:", (bundle.draft || []).length);
```

**Action needed:**
1. `wrangler deploy` the worker, push `draft.js`
2. Open a Yahoo league → Draft tab → DevTools Console
3. Paste the `[Yahoo draft] debug:` output here
4. Key fields: `dResultsType`, `dContainerKeys`, `draftRawType`, `draftArrLen`

Once the shape is known, fix the parser and **remove `_draftDebug`** from the
worker response and `draft.js` console log.

---

## Step 7 — Transactions: Show Team Name
**Files:** `transactions.js`, `worker.js`

**Issue 10:** Team name blank on Yahoo transactions. Root cause: `roster_ids[0]` is
set from `tx.teamId` which may be null when the worker can't find any team key.

**Fix in worker** — for add transactions, the team is `destination_team_key` at the
**transaction level** (not player level). For drops, it's `source_team_key`. The
current code already does this. Check the actual Yahoo response in devtools:

Add temporary logging to worker:
```js
// After meta parsing in transaction loop:
console.log("[Yahoo tx]", txType, "trader:", traderKey, "dest:", destKey, "src:", srcKey);
```

**Fix in transactions.js** — ensure `_rosters` is populated before `_loadYahooData`
tries to look up names. The `_rosters` array is built from `bundle.teams` with
`roster_id: t.id`. Verify `t.id` matches the `teamId` strings on transactions —
both should be bare numeric strings like `"3"`.

If still blank, add a fallback: when `_teamName()` returns `Team ${id}`, at least
that shows something. Check if the issue is that `initiator` check at:
```js
const initiator = type !== "trade" && tx.roster_ids?.[0]
  ? _teamName(tx.roster_ids[0]) : "";
```
Yahoo adds/drops have `type = "free_agent"` (not "trade"), so `initiator` should
fire. Log `tx.roster_ids[0]` and compare against `_rosters[i].roster_id`.

---

## Step 9 — Career Stats: Platform Tabs ⚠️ BROKEN — FIX FIRST IN NEW SESSION
**Files:** `profile.js`, `index.html`

**Error:** `Uncaught ReferenceError: _renderCSPlatform is not defined` fires every
time the career summary modal is opened. `_openCareerSummaryModal` calls
`_renderCSPlatform()` and `_renderCSPlatformYear()` but these functions were never
implemented.

**In `index.html`** — add after the matrix tab button and panel:
```html
<button class="cs-tab" data-cstab="platform">By Platform</button>
<button class="cs-tab" data-cstab="platform-year">Platform × Year</button>
...
<div id="cs-platform"      class="cs-panel"></div>
<div id="cs-platform-year" class="cs-panel"></div>
```

**In `profile.js`** — add two render functions after `_renderCSMatrix`:

`_renderCSPlatform(leagues)`: same table structure as `_renderCSType` but grouped by
`l.platform` ("sleeper", "mfl", "yahoo"). Use `_platformLabel()` for display names.

`_renderCSPlatformYear(leagues)`: same matrix structure as `_renderCSMatrix` but
columns are platforms instead of types, rows are seasons.

Call both from `_openCareerSummaryModal` alongside the existing four calls.

---

## Step 10 — Stats Header Auto-Update ✅ (done as part of Step 8)
Non-blocking `recomputeStats` added at end of `renderLocker` for Yahoo-linked users.
Confirm `_resolveYahooIdentities` also calls `recomputeStats` at the end — should
already be in place from a prior session.

---

## Step 11 — League Type Detection (Keeper/Dynasty)
**Files:** `worker.js`, `profile.js`

**Issue 3:** Already partially fixed — `uses_roster_import` added to `leagueMeta`
in `worker.js`, and `_detectYahooLeagueType` updated in `profile.js`.

**Confirm** worker returns `uses_roster_import` in `leagueMeta`. Then confirm
`_resolveYahooIdentities` calls `_detectYahooLeagueType(bundle.leagueMeta, ...)` and
writes `leagueType` to Firebase.

**Gap:** Leagues already imported before this fix won't get updated. Add
`leagueType` to the fields that trigger re-resolution by changing the filter in
`_resolveYahooIdentities`:
```js
const allYahoo = Object.entries(_allLeagues).filter(([, l]) =>
  l.platform === "yahoo" && (
    !l.myRosterId || !l.teamName || l.teamName === "" ||
    l.leagueType === "redraft"   // re-check leagues still marked as redraft
  )
);
```

---

## Step 12 — Overview: Championship Detection
**Files:** `profile.js`

**Issue 6:** `playoffFinish` is never set for past Yahoo leagues so no 🏆 champion
badge shows on the overview tab.

`_detectYahooPlayoffFinish` was added in a prior session inside `_resolveYahooIdentities`.
**Confirm** it's writing `playoffFinish` and `isChampion` to Firebase.

For current in-season leagues where `is_finished = 0`, the function returns null
(correct). For completed leagues it should return 1 for champion.

**Test:** After deploying, open a finished Yahoo league overview. If still blank,
add a console log in `_detectYahooPlayoffFinish` to see what `allMatchups` and
`poWeeks` contain.

---

## Deployment Checklist
After each step, commit and push to trigger GitHub Pages. Worker changes need
`wrangler deploy` separately.

**Order of priority for next session:**
1. Step 9 (Career stats `_renderCSPlatform` — currently throwing a console error)
2. Step 6 (Draft — deploy debug build, read console output, fix parser)
3. Step 7 (Transactions team name)
4. Steps 11–12 (League type, championships — data layer)

---

## Files Modified This Session (all should be in repo)
| File | Last Changed |
|------|-------------|
| `worker.js` | `/yahoo/playerStats` endpoint, draft debug instrumentation + shape handling |
| `yahoo.js` | `playerDetails` passed through `normalizeBundle` rosters, `_getValidToken` + `_workerBase` exposed |
| `analytics.js` | `_leagueKey` state var, `init()` 6th arg, `_renderYahooAnalytics` key fix, `poStart` guard |
| `profile.js` | `DLRAnalytics.init()` passes `league.leagueKey`, non-blocking `recomputeStats` in `renderLocker` |
| `standings.js` | `_renderYahooStandings` CSS/structure rebuilt, `_renderYahooMatchups` click-to-expand |
| `roster.js` | `PREFERRED_ORDER` position grouping, `detailMap` bio fallback for unmatched players |
| `rules-and-fa.js` | Position dropdown with `PREFERRED_ORDER`, compact toolbar, Yahoo stats fetch, `detailMap` bio fallback |
| `draft.js` | Debug log after `getLeagueBundle()` |

---

## Notes for Next Session
- Attach `DLR_PROJECT_SUMMARY.md` + the specific JS file(s) for the step
- The CSS classes are confirmed from `locker.css` — use them exactly as listed above
- `standings-row--me` is the correct class (NOT `standings-row--mine`)
- Yahoo game key format: `"{game_id}.l.{league_id}"` e.g. `"449.l.123456"` for NFL 2024
  The game_id changes yearly — always use the stored `league.leagueKey` not a hardcoded prefix
- Worker changes require `wrangler deploy` in addition to git push
- Test on mobile data (home router blocks workers.dev)
- `/yahoo/playerStats` worker endpoint is new — needs `wrangler deploy` before Yahoo
  Players tab will show points data
- `_renderCSPlatform` error is a hard crash on career modal open — fix this first
