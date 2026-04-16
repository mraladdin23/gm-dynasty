# DLR Yahoo Integration — Remaining Work
*Generated from current session context. Pick up here in a new chat.*
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

## Step 1 — Standings CSS Fix
**Files:** `standings.js`, `locker.css`

**Issue 4:** Yahoo `_renderYahooStandings` uses wrong CSS class (`standings-row--mine`
instead of `standings-row--me`) and a non-standard inner layout. Rebuild it to exactly
match MFL's `_renderMFLStandings` structure:

- Row class: `standings-row--me` (not `--mine`)
- Team cell: `<div class="st-av">` initial bubble + `standings-team-name` div
- My-team star: `★` span with gold color (same as MFL)
- Data cells: use `standings-win`, `standings-loss`, `standings-tie` (td class),
  `standings-num` for PF/PA
- Add `bubble-tag` span for the bubble team
- Add `standings-legend` div at the bottom (playoff spot + bubble legend)
- Add optional FAAB column only when `faabEnabled` (use `standings-num` class)
- The owner name sub-row is fine to keep as a second line inside the team cell

**In `locker.css`:** No changes needed — all classes already exist.

---

## Step 2 — Matchup Cards Style + Click-to-Expand
**Files:** `standings.js`

**Issue 5:** Yahoo matchup cards render with `mu-card` but click does nothing because
there's no `.mu-detail.hidden` expand section. Yahoo doesn't have per-player scores,
so the expand shows season record + points for that week instead.

In `_renderYahooMatchups` → `_renderWeek`, build each card as:
```html
<div class="mu-card" onclick="this.querySelector('.mu-detail').classList.toggle('hidden')">
  <div class="mu-header">
    <div class="mu-team"> [st-av] [name fw-700 if winner] </div>
    <div class="mu-scores">
      <span class="mu-score mu-score--win/lose">score</span>
      <span class="mu-dash">–</span>
      <span class="mu-score mu-score--win/lose">score</span>
    </div>
    <div class="mu-team mu-team--right"> [name] [st-av] </div>
  </div>
  <div class="mu-detail hidden">
    <!-- season record for each team from standings data -->
    [hName]: [W]–[L], [PF] pts  |  [aName]: [W]–[L], [PF] pts
  </div>
</div>
```
The `standings` array from `_yahooBundle` has W/L/PF — look up by teamId.

**Week pills:** Use `matchups-week-pill` class with `matchups-week-pill--active`
for selected week. Confirm class names in locker.css:
```bash
grep -n "matchups-week-pill\|matchups-week-bar\|matchups-week-label" locker.css
```

---

## Step 3 — Standings Sort Fix
**Files:** `standings.js`

**Issue 2:** Already coded in last session (wins DESC → PF DESC). Confirm it's in
place — grep for the sort change in `_renderYahooStandings`. If still using API rank,
replace with:
```js
const sorted = [...standings].sort((a, b) => {
  const aw = a.wins ?? 0, bw = b.wins ?? 0;
  return bw !== aw ? bw - aw : (b.ptsFor ?? 0) - (a.ptsFor ?? 0);
});
```

---

## Step 4 — Roster Tab: Dynamic Position Groups
**Files:** `roster.js`

**Issue 7:** `POS_ORDER` is hardcoded `["QB","RB","WR","TE","K","DEF"]`. For Yahoo
leagues, players with positions like `P`, `DL`, `LB`, `DB`, `S`, `CB`, `Coach`
fall to `"—"` bucket.

In `_teamCardHTML`, make the grouping dynamic for Yahoo/MFL:
```js
// Build the active pos list from what's actually on this team's roster
const activePlatform = _platform; // "yahoo", "mfl", or "sleeper"
const dynamicPosOrder = activePlatform === "sleeper"
  ? POS_ORDER  // keep hardcoded for Sleeper
  : [...new Set(mainRoster.map(id => {
      const p = _players[id] || {};
      return (p.fantasy_positions?.[0] || p.position || "—").toUpperCase();
    }).filter(p => p !== "—" && p !== "?"))].sort();

// Use [...dynamicPosOrder, "—"] instead of [...POS_ORDER, "—"]
// Pre-initialize byPos with dynamicPosOrder entries
```
Also fix `byPos` initialization:
```js
const byPos = {};
dynamicPosOrder.forEach(p => { byPos[p] = []; });
byPos["—"] = [];
```
And the grouping check:
```js
const grp = dynamicPosOrder.includes(pos) ? pos : "—";
```

---

## Step 5 — Players Tab: Position Filter Dropdown + Yahoo Bio Fallback
**Files:** `rules-and-fa.js`

**Issue 8 (position filter):** Replace the `fa-pos-filter` pill buttons with a
`<select>` dropdown. Change this section in `_render()`:
```html
<!-- REPLACE buttons with: -->
<select class="fa-sort-btn" style="padding:3px 8px;border-radius:var(--radius-sm)"
  onchange="DLRFreeAgents.setPos(this.value)">
  ${["ALL",...filterPositions].map(pos =>
    `<option value="${pos}" ${_posFilter === pos ? "selected" : ""}>${pos}</option>`
  ).join("")}
</select>
```
Also label the year selector: wrap it with
`<label style="font-size:.75rem;color:var(--color-text-dim)">Stats Year</label>`.

**Issue 7 (Yahoo bio fallback):** Already coded in last session via `playerDetails`
from worker. Confirm `_loadYahooRosterData` in `rules-and-fa.js` has `yahooDetailMap`
and falls back to `detail.name`/`detail.position` when DynastyProcess has no match.

---

## Step 6 — Draft Tab: Fix Empty Results
**Files:** `worker.js`, `draft.js`

**Issue 9:** Draft returns empty. Two possible causes:

**Cause A — Wrong JSON path.** Yahoo draftresults JSON:
```
fantasy_content.league[1].draft_results[0].draft_result
```
But `draft_results` may itself be a count-keyed object, not an array:
```js
// Already fixed in last session with dContainer logic — confirm it's deployed
```

**Cause B — `draft_result` picks are count-keyed objects, not arrays.**
Yahoo sometimes returns:
```json
{ "count": 210, "0": { "pick": 1, "round": 1, ... }, "1": {...} }
```
The fix from last session handles this. If still empty, add a debug log:
```js
// In worker yahooLeagueBundle, after draft parsing:
console.log("[Yahoo draft] dContainer keys:", Object.keys(dContainer || {}));
console.log("[Yahoo draft] picks found:", draft.length);
```
Deploy worker, open browser console, load a Yahoo league draft tab.

**Also check:** The draft endpoint URL is `/draftresults` not `/draft_results`:
```js
fetch(`${base}/league/${leagueKey}/draftresults?format=json`, ...)
```
Confirm this is correct in `worker.js` around line 370.

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

## Step 8 — Analytics: Fix Empty Tabs
**Files:** `analytics.js`, `profile.js`

**Issue 11:** Analytics tabs render but show no data.

**Root cause:** `_renderYahooAnalytics` constructs the league key as
`` `nfl.l.${leagueId}` `` but `"nfl"` is the game code, not the game ID.
The correct key is something like `"449.l.123456"` where `449` is the NFL game ID
for 2024. This key is stored on the league object as `league.leagueKey`.

**Fix 1 — Pass leagueKey to analytics init.** In `profile.js`:
```js
// Change this line:
if (tab === "analytics") DLRAnalytics.init(league.leagueId, league.platform, _currentUsername, league.myRosterId || null, league.season || null);
// To:
if (tab === "analytics") DLRAnalytics.init(league.leagueId, league.platform, _currentUsername, league.myRosterId || null, league.season || null, league.leagueKey || null);
```

**Fix 2 — Update analytics.js `init` signature and usage:**
```js
async function init(leagueId, platform, myUsername, myRosterId, season, leagueKey) {
  _leagueId  = leagueId;
  _leagueKey = leagueKey || null;  // add this state var
  ...
}
// In _renderYahooAnalytics:
async function _renderYahooAnalytics(el, leagueId, token) {
  const key = _leagueKey || `nfl.l.${leagueId}`;  // use stored key
  _yahooBundle = await YahooAPI.getLeagueBundle(key);
  ...
}
```
Add `let _leagueKey = null;` to analytics state vars and reset it in `reset()`.

**Fix 3 — `_yahooGetWeekData` filter:** If `playoff_start_week` is 0 (not set),
the current filter `w >= poStart` with `poStart = 999` excludes all weeks. Change:
```js
const poStart = lm.playoff_start_week > 0 ? lm.playoff_start_week : 999;
```
This already exists — confirm it's in place.

---

## Step 9 — Career Stats: Platform Tabs
**Files:** `profile.js`, `index.html`

**Issue 2:** Add "By Platform" and "Platform × Year" tabs to career modal.

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

## Step 10 — Stats Header Auto-Update
**Files:** `profile.js`, `firebase-db.js` (read-only reference)

**Issue 1:** Header stats (W-L, championships, dynasty score) don't update when new
Yahoo leagues are connected.

`_resolveYahooIdentities` already calls `GMDB.recomputeStats(username)` and
`_renderStatsRow(stats)` after all leagues are saved (added in last session).
**Confirm** this is in place by checking the end of the function.

The other gap: when `renderLocker` fires, it reads `profile.stats` from Firebase which
was written at link time. If Yahoo leagues were added after the last `recomputeStats`
call, the numbers are stale. Fix: call `recomputeStats` non-blocking at the end of
`renderLocker` for any user with Yahoo linked:
```js
// At end of renderLocker, after _renderLeagues():
if (profile.platforms?.yahoo?.linked) {
  GMDB.recomputeStats(_currentUsername).then(stats => {
    if (stats) { _renderStatsRow(stats); }
  }).catch(() => {});
}
```

---

## Step 11 — League Type Detection (Keeper/Dynasty)
**Files:** `worker.js`, `profile.js`

**Issue 3:** Already partially fixed in last session — `uses_roster_import` added to
`leagueMeta` in `worker.js`, and `_detectYahooLeagueType` updated in `profile.js`.

**Confirm** worker now returns `uses_roster_import` in `leagueMeta`. Then confirm
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

`_detectYahooPlayoffFinish` was added in last session inside `_resolveYahooIdentities`.
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

**Order of priority:**
1. Step 8 (Analytics fix — highest impact, just a leagueKey wire-up)
2. Step 1 (Standings CSS — visual)
3. Step 2 (Matchup click-expand — visual)
4. Step 5 (Players position dropdown)
5. Step 4 (Roster dynamic positions)
6. Step 6 (Draft — may need devtools debugging)
7. Step 7 (Transactions team name)
8. Steps 9–12 (Career stats, league type, championships — data layer)

---

## Files Modified in Previous Sessions (all should be in repo)
| File | Last Changed |
|------|-------------|
| `worker.js` | Draft fix, transaction fix, leagueMeta fields, playerDetails in rosters |
| `yahoo.js` | normalizeBundle with myTeamId, allMatchups, leagueMeta, moves[] |
| `standings.js` | Yahoo standings/matchups/playoffs renders, _yahooBundle cache |
| `profile.js` | _resolveYahooIdentities, _detectYahooLeagueType, _detectYahooPlayoffFinish, Yahoo overview fetch |
| `roster.js` | _loadYahooData with DLRPlayers, _playerRowHTML Yahoo photo/bio |
| `rules-and-fa.js` | _loadYahooRosterData with playerDetails fallback, dynamic pos filter |
| `transactions.js` | _loadYahooData with moves[], drop srcTeamId fix |
| `draft.js` | DLRPlayers.load, position enrichment, my-team highlight |
| `analytics.js` | Full Yahoo analytics suite (5 tabs) |
| `players-db.js` | getByYahooId, birthdate filter (no changes this session) |

---

## Notes for Next Session
- Attach `DLR_PROJECT_SUMMARY.md` + the specific JS file(s) for the step
- The CSS classes are confirmed from `locker.css` — use them exactly as listed above
- `standings-row--me` is the correct class (NOT `standings-row--mine`)
- Yahoo game key format: `"{game_id}.l.{league_id}"` e.g. `"449.l.123456"` for NFL 2024
  The game_id changes yearly — always use the stored `league.leagueKey` not a hardcoded prefix
- Worker changes require `wrangler deploy` in addition to git push
- Test on mobile data (home router blocks workers.dev)
