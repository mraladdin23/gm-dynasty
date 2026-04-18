# DLR Yahoo Integration — Remaining Work
*Updated after major Yahoo session (April 16, 2026)*
*Attach: DLR_PROJECT_SUMMARY.md + the specific files listed per step.*

---

## Context
All files from previous sessions are in the GitHub repo. The worker is deployed
by pasting into the Cloudflare dashboard editor (not wrangler — no wrangler.toml).
CSS lives in `css/locker.css`. Key CSS classes confirmed:
- Standings: `standings-row--me` (not `--mine`), `standings-win`, `standings-loss`,
  `standings-num`, `st-av`, `bubble-tag`, `standings-legend`, `standings-table-wrap`
- Matchups: `mu-card`, `mu-header`, `mu-team`, `mu-team--right`, `mu-scores`,
  `mu-score`, `mu-score--win`, `mu-score--lose`, `mu-dash`, `mu-no-detail`, `fw-700`
- Playoffs: `bracket-wrap`, `bracket-section`, `bracket-section-label`,
  `bracket-section-games`, `bracket-match`, `bracket-slot`, `bracket-slot--win`,
  `bracket-slot--lose`, `bracket-slot--me`, `bracket-team`, `bracket-score`,
  `bracket-check`, `bracket-tbd`, `bracket-finals`, `bracket-finals-game`,
  `bracket-finals-label`, `seed-tag`, `playoffs-pending`
- Draft list/pagination: `draft-auction-list`, `draft-auction-row`, `draft-pagination`
- Transaction pagination: `tx-pagination`, `tx-page-btn`

---

## ✅ Completed

### Step 1 — Standings CSS Fix ✅
`standings.js` — `_renderYahooStandings` matches MFL structure exactly.

### Step 2 — Matchup Click-to-Expand ✅
`standings.js` — cards have onclick toggle, expand shows season W–L + PF.
Now also shows **roster players** (pos + name) in a two-column grid on expand.
Week pill bar matches Sleeper/MFL style exactly.

### Step 3 — Standings Sort ✅
Wins DESC → PF DESC in `_renderYahooStandings`.

### Step 4 — Roster Tab: Dynamic Position Groups ✅
`roster.js` — PREFERRED_ORDER, detailMap bio fallback.

### Step 5 — Players Tab: Position Filter + Bio Fallback + Yahoo Stats ✅
`rules-and-fa.js` — dropdown filter, Yahoo YTD stats, detailMap fallback.

### Step 6 — Draft Tab ✅
`draft.js` + `worker.js` — draft parsing fixed (nested-object shape with single-pick
detection). Grid view + list view + auction toggle. 25-per-page pagination on list view
(shared across Sleeper, MFL, Yahoo). `_draftDebug` diagnostic still in worker —
**remove from worker.js and draft.js** once confirmed stable.

### Step 7 — Transactions: Team Name + Player Bios ✅
`transactions.js` — teamId derived from moves[] when tx.teamId is empty. Player
enrichment chain: DynastyProcess CSV → Sleeper record → detailMap → tx name/position.
DEF player names now resolve from `editorial_team_full_name` (worker fix).
25-per-page pagination added (all platforms). `worker.js` updated to extract
`display_position` and better name fields for DEF/special team entries.

### Step 8 — Analytics: leagueKey wire-up ✅
`analytics.js` + `profile.js` — `_leagueKey` state var, non-blocking `recomputeStats`.

### Step 9 — Career Stats: Platform Tabs ✅
`profile.js` + `index.html` — `_renderCSPlatform` and `_renderCSPlatformYear` added.
`_platformLabel()` updated to include Yahoo. Crash fixed.

### Step 10 — Stats Header Auto-Update ✅
Non-blocking `recomputeStats` in `renderLocker` for Yahoo-linked users.

### Step 11 — League Type Detection ✅
`profile.js` — `_detectYahooLeagueType` uses `uses_roster_import` API field + name
keywords (dynasty/keeper/redraft/salary/auction). `_detectMFLLeagueType` also updated
with salary/auction/redraft detection. Existing non-redraft types preserved on
re-resolution (no overwriting dynasty/keeper leagues).

### Step 12 — Championship / Playoff Finish Detection ✅

**Yahoo (`_detectYahooPlayoffFinish`):**
- Builds `playoffTeamSet` from standings top-N seeds (`num_playoff_teams`) to filter
  out consolation games. Teams not in the set immediately return null (missed playoffs).
- Only counts decided games (has scores or winnerTeamId).
- `appearedInPlayoffs` flag prevents false champions.
- Filter now runs on `playoff_start_week` (not just `is_finished`).

**MFL (`_detectMFLPlayoffFinish`):**
- Path 1 (bracket leagues): fetches championship bracket via `MFLAPI.getPlayoffBracket`,
  uses score comparison (not `won` flag which is unreliable when one score is 0).
  Handles championship game, consolation games (3rd/5th/7th), and earlier-round exits.
- Path 2 (no-bracket / guillotine): falls back to standings rank ≤ 8.
- Only runs for past seasons (leagueYear < currentYear).
- Wired into both `fetchBundle` (initial import) and `syncMFLTeams` (background sync).

**Playoffs bracket rendering (`standings.js`):**
- `playoffTeamSet` filter applied to bracket — consolation games excluded.
- `champGames(week)` helper used throughout.

### Step 13 — `resolved` Flag / Historical League Caching ✅
`profile.js` — past-season leagues marked `resolved: true` once fully hydrated.
Resolved leagues are never re-fetched (no API calls, no overwriting).

**Helpers added:**
- `_isPastSeason(l)` — true if `l.season < currentYear`
- `_isFullyResolved(l)` — true if past season AND `l.resolved === true`
- `_markResolved(l)` — sets `resolved: true`, corrects `isChampion` consistency

**Per platform:**
- **Sleeper:** `linkSleeper` marks complete past leagues resolved at import.
  `_resolveSleeperIdentities()` runs non-blocking from `renderLocker` — stamps
  `resolved` on already-hydrated leagues instantly, backfills `playoffFinish` via
  `SleeperAPI.getPlayoffFinish()` for leagues imported before playoff detection existed.
- **MFL:** `fetchBundle` (import) and `syncMFLTeams` (sync) both mark resolved.
  `syncMFLTeams` filter skips resolved leagues.
- **Yahoo:** `_resolveYahooIdentities` filter skips resolved leagues. After successful
  hydration of a past-season league, marks resolved.

---

## ⚠️ Outstanding Issues

### Issue A — Yahoo Data Not Always Saving to Firebase
**Symptom:** After resolution runs, some Yahoo leagues don't persist correctly.
**Likely cause:** Race condition between resolution batches and `saveLeague` calls,
or network timeout during the Yahoo bundle fetch causing silent failure.
**Files:** `profile.js`, `firebase-db.js`
**Debug steps:**
1. Open console, filter for `[GMDB]` or network errors during page load
2. Check if `_resolveYahooIdentities` is hitting the concurrency limit (currently 2)
   — try reducing to 1 to eliminate races
3. Verify `GMDB.saveLeague` isn't silently failing (add `.catch(e => console.error(e))`)

### Issue B — Yahoo `resolved` Flag Not Persisting
**Symptom:** Leagues show as resolved in memory but re-fetch on next page load.
**Likely cause:** The `resolved` field may not be getting written to Firebase because
`_markResolved` is called AFTER `saveLeague` in some paths, or `saveLeague` is called
on a stale copy of the object.
**Fix:** Ensure `_markResolved` is called BEFORE `GMDB.saveLeague`.
**Files:** `profile.js`

### Issue C — `_draftDebug` Cleanup Needed
**Symptom:** `_draftDebug` diagnostic still in `worker.js` return payload and
`draft.js` console logs — dead weight in production.
**Fix:** Remove `_draftDebug` from both files once confirmed stable.
**Files:** `worker.js`, `draft.js`

### Issue D — `uses_roster_import` Not in `normalizeBundle`
**Symptom:** `_detectYahooLeagueType` API field detection (`uses_roster_import`) may
not work because `yahoo.js` `normalizeBundle` doesn't pass it through.
**Status:** `yahoo.js` leagueMeta section doesn't include `uses_roster_import`.
**Fix:** Add to `normalizeBundle` leagueMeta block in `yahoo.js`.
**Files:** `yahoo.js`

### Issue E — Cloudflare Worker Custom Domain
**Symptom:** Email warning that `api.dynastylockerroom.com` custom domain on the
Cloudflare Worker will be deleted because DNS moved from Cloudflare to GoDaddy.
**See "Cloudflare Infrastructure" section below.**

### Issue F — Analytics Tab (Yahoo) Not Connected
`analytics.js` Yahoo path exists but not fully tested/wired. Lower priority.

---

## Console Reset Script
If Yahoo playoffs show wrong values, run this in the browser console to clear
stale data and force re-resolution:

```js
const u = "mraladdin23";
const ref = firebase.database().ref(`gmd/users/${u}/leagues`);
const snap = await ref.get();
const leagues = snap.val() || {};
const updates = {};
Object.entries(leagues).forEach(([key, l]) => {
  if (l.platform === "yahoo") {
    updates[`${key}/playoffFinish`] = null;
    updates[`${key}/isChampion`] = false;
    updates[`${key}/resolved`] = null;
  }
});
console.log("Resetting", Object.keys(updates).length / 3, "Yahoo leagues");
await ref.update(updates);
console.log("Done — reload the page");
```

---

## Cloudflare Infrastructure

### The Problem
Moving DNS from Cloudflare to GoDaddy means `api.dynastylockerroom.com` (the custom
domain on the `mfl-proxy` Worker) no longer works via Cloudflare's proxy. The Worker
itself (`mfl-proxy.mraladdin23.workers.dev`) is unaffected — it's on Cloudflare's
infrastructure regardless of DNS.

### What You Actually Need to Keep
1. **The Worker itself** — `mfl-proxy.mraladdin23.workers.dev` — this NEVER gets
   deleted as long as you have a Cloudflare account. Workers are tied to your account,
   not to your domain's DNS.
2. **The Worker code** — always backed up in your GitHub repo (`worker.js`).

### What You Can Safely Ignore
The "your site will be deleted" email likely refers to Cloudflare Pages (if you ever
had a Pages project for dynastylockerroom.com) or the custom domain binding. Your
actual site is on **GitHub Pages**, not Cloudflare Pages — Cloudflare can't delete it.

### The Custom Domain (`api.dynastylockerroom.com`)
This was optional. Your code in `yahoo.js` uses `BASE = "https://mfl-proxy.mraladdin23.workers.dev"`
directly — **not** `api.dynastylockerroom.com`. So losing the custom domain doesn't
break anything in production.

### Action Items
1. **Verify your Worker still works** — visit `https://mfl-proxy.mraladdin23.workers.dev/`
   in a browser. Should return `"Worker running"`.
2. **Log into Cloudflare dashboard** → Workers & Pages → `mfl-proxy` → confirm it's
   still deployed and the code is there.
3. **Ignore the email** if it refers to a Cloudflare Pages project for your domain —
   your site runs on GitHub Pages, not Cloudflare Pages.
4. **If you want `api.dynastylockerroom.com` back:** You'd need to either move DNS
   back to Cloudflare OR add a GoDaddy CNAME pointing `api` to
   `mfl-proxy.mraladdin23.workers.dev` — but the `workers.dev` URL works fine and
   is already what your code uses.

---

## Files Modified (Across All Yahoo Sessions)
| File | Key Changes |
|------|-------------|
| `worker.js` | Yahoo bundle, draft parsing (all shapes), `/yahoo/playerStats` endpoint, transaction DEF player names, `_draftDebug` (to remove) |
| `yahoo.js` | `normalizeBundle`, token management, `_getValidToken` + `_workerBase` exposed |
| `profile.js` | `_detectYahooLeagueType`, `_detectMFLPlayoffFinish`, `_detectYahooPlayoffFinish`, `_resolveYahooIdentities`, `_resolveSleeperIdentities`, `_isFullyResolved`, `_markResolved`, career stats platform tabs, MFL league type |
| `standings.js` | `_renderYahooStandings`, `_renderYahooMatchups` (roster detail, week pills), Yahoo playoffs bracket (playoff team set filter) |
| `roster.js` | PREFERRED_ORDER position grouping, detailMap bio fallback |
| `rules-and-fa.js` | Position dropdown, compact toolbar, Yahoo stats, detailMap fallback |
| `transactions.js` | Yahoo team name resolution, player enrichment, 25/page pagination |
| `draft.js` | Yahoo draft grid+list+auction, 25/page pagination (all platforms), `_renderYahooDraftBoard` |
| `analytics.js` | `_leagueKey` wire-up, poStart guard |
| `index.html` | Career stats platform tabs (cs-platform, cs-platform-year) |

---

## Notes for Next Session
- Worker is deployed by **pasting into Cloudflare dashboard editor** — no wrangler
- After pasting worker, verify at `https://mfl-proxy.mraladdin23.workers.dev/`
- Test on **mobile data** — home router blocks workers.dev
- `standings-row--me` is correct (NOT `standings-row--mine`)
- Yahoo game key format: `"{game_id}.l.{league_id}"` — always use stored `league.leagueKey`
