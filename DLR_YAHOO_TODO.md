# DLR Yahoo & MFL — Remaining Issues
*Updated: April 17, 2026*
*Attach with DLR_PROJECT_SUMMARY.md + specific files per task.*

---

## How to Use This Doc
Each issue below is self-contained. For each session: attach this doc + project summary +
only the files listed under that issue. Fix one issue per session where possible.

---

## ✅ Completed (April 17 session)

- `_draftDebug` removed from `worker.js` and `yahoo.js`
- `uses_roster_import` added to `normalizeBundle` leagueMeta in `yahoo.js`
- All `saveLeague` catches now log `[GMDB] saveLeague failed for {key}` to console
- `viewport-fit=cover` added to `index.html` meta viewport
- Mobile nav safe area: `env(safe-area-inset-top)` on `.top-nav` height + padding in `locker.css`
- Mobile browser bar: `100dvh` replacing `100vh` in `locker.css` + `base.css`
- Mobile league detail panel: header + tab select now sticky; only `.league-detail-body` scrolls; `padding-top: calc(48px + env(safe-area-inset-top))`
- Yahoo week pills: `season-pill` / `season-pill--current` — now matches MFL/Sleeper exactly
- Yahoo matchup player scores: new `/yahoo/matchupDetail` worker endpoint (two-step fetch); frontend renders side-by-side player score grid on expand
- Yahoo token fix: optimistic use when `expiresAt` is 0; empty string refresh token treated as missing
- MFL `_detectMFLPlayoffFinish`: `isGuillotine` param added; guillotine/eliminator skip bracket path
- MFL guillotine rank cap: removed ≤ 8 limit for guillotine leagues
- MFL `resolved` flag: allows eliminator/guillotine leagues even when `leagueType === "redraft"`
- Yahoo keeper detection: `isKeeper` + `hasKeeperPicks` in draft; `_detectYahooLeagueType` uses it ✅ confirmed working
- `worker.js`: `is_keeper` on draft picks; `yahooLogin` function declaration fixed
- Career stats: confirmed working correctly

---

## 🔴 Issue 1 — MFL Championship Reset Script
**Status:** Needs to be run in browser console once.

Guillotine/eliminator leagues already in Firebase were imported before the `isGuillotine`
fix. They have `resolved: true` with `playoffFinish: null` so they'll never re-process.
Also some bracket leagues have wrong or missing `playoffFinish`.

**Run this in the browser console (replace username):**
```js
const u = "mraladdin23";
const ref = firebase.database().ref(`gmd/users/${u}/leagues`);
const snap = await ref.get();
const leagues = snap.val() || {};
const updates = {};
Object.entries(leagues).forEach(([key, l]) => {
  if (l.platform === "mfl" && (l.isGuillotine || l.playoffFinish == null)) {
    updates[`${key}/playoffFinish`] = null;
    updates[`${key}/isChampion`]    = false;
    updates[`${key}/resolved`]      = null;
  }
});
console.log("Resetting", Object.keys(updates).length / 3, "MFL leagues");
await ref.update(updates);
console.log("Done — click Sync to re-detect");
```

After running: click the **Sync** button on your MFL locker to trigger `syncMFLTeams`,
which will re-run `_detectMFLPlayoffFinish` with the `isGuillotine` fix in place.

**No file changes needed for this issue.**

---

## 🔴 Issue 2 — Yahoo Mobile Token Not Persisting
**Symptom:** After reconnecting Yahoo on mobile, tabs still say "No Yahoo access token."
Reconnecting works on desktop but not mobile browser.

**Root cause suspects:**
1. `localStorage` is blocked or partitioned in mobile Safari private/incognito mode
2. The OAuth redirect back to `dynastylockerroom.com/#yahoo_token=...` may be losing
   the hash on some mobile browsers (redirect strips fragment)
3. `storeTokens` is called in the IIFE at page load, but if YahooAPI hasn't initialized
   yet the call may silently fail

**Debug steps before next session:**
- Open mobile Safari → Settings → check if "Prevent Cross-Site Tracking" is on
- After reconnecting, open console and run:
  `console.log(localStorage.getItem('dlr_yahoo_access_token'))`
  If null, localStorage is being blocked → need sessionStorage-only fallback path
- Check if `window.location.hash` contains `yahoo_token=` after redirect

**Files:** `app.js`, `yahoo.js`

**Likely fix:** In `storeTokens`, if `localStorage.setItem` throws (blocked), fall back
to sessionStorage only and set a flag. In `_getValidToken`, try localStorage first,
sessionStorage second, and if both are empty but `dlr_yahoo_pending` was just set,
wait briefly and retry.

---

## 🔴 Issue 3 — Yahoo Matchup Player Scores Not Showing
**Symptom:** Clicking a matchup shows "Loading lineup…" but never populates player scores.

**Root cause:** The `/yahoo/matchupDetail` worker endpoint was rewritten to use the
correct two-step approach (scoreboard → teams roster+stats) but has not been confirmed
working against live Yahoo data. The `player_points` location in the response may need
adjustment.

**Files:** `worker.js`, `standings.js`

**Debug approach:** In the worker, add temporary logging to the `yahooMatchupDetail`
function to log what the roster+stats response actually looks like:
```js
console.log("[matchupDetail] rosterData sample:", JSON.stringify(rosterData)?.slice(0, 500));
```
Check Cloudflare Worker logs after triggering a matchup expand on mobile data.

**Most likely fixes needed in `worker.js`:**
- The `player_points` field may be at `p[k]?.player_points?.total` or just `p[k]?.player_points`
- The roster container path `teamEntry[1]?.roster` vs `teamEntry[2]?.roster` varies by response shape
- `selected_position` may be nested differently than expected

**Known working pattern** (from `yahooLeagueBundle` roster parsing in worker):
```js
// player[0] = info array, player[1] = selected_position, player[2+] = stats
const selPos = p[1]?.selected_position;
```

---

## 🔴 Issue 4 — Yahoo Playoff Finish Bug (Runner-up shown as 3rd)
**Symptom:** Some leagues where the user finished 2nd (runner-up) are showing `playoffFinish: 3`.
The Overview tab shows the correct result, suggesting the stored value is wrong but
display logic may be compensating in some places.

**Root cause:** In `_detectYahooPlayoffFinish` (`profile.js` ~line 777):
```js
const finalWeek = poWeeks[poWeeks.length - 1];
if (elimWeek === finalWeek)                    return 2;  // lost championship
if (elimWeek === poWeeks[poWeeks.length - 2])  return 3;  // lost semifinal
```
The problem is that `allMatchups` may include a "3rd place game" in the same final week
as the championship game. The `playoffTeamSet` filter is supposed to exclude consolation
teams, but if the consolation game teams are ALSO in the playoff set (e.g. in a 4-team
playoff, all 4 teams are in `playoffTeamSet`), the filter doesn't remove it.

Result: the user loses the semifinal, gets placed into the 3rd place game, wins or
loses it — the code finds them "eliminated" in the final week and returns 2 or 3
incorrectly.

**Fix needed in `_detectYahooPlayoffFinish` (`profile.js`):**
Track which teams played in the championship game. Only that game counts as "final week."
Any other game in the final week is a consolation game — elimination there means 3rd or 4th,
not 2nd. Logic should be:

1. Find the championship game (the one game in the last playoff week that only involves
   teams who won their semifinal)
2. If user is in the championship game: win = 1st, lose = 2nd
3. If user is NOT in the championship game but plays in the final week: win = 3rd, lose = 4th
4. If eliminated in semifinal week: 3rd/4th (already lost before final)

**Files:** `profile.js`

---

## 🟡 Issue 5 — Yahoo Firebase Persistence (saveLeague Failures)
**Symptom:** Yahoo leagues sometimes don't save correctly after resolution. Console now
shows `[GMDB] saveLeague failed for yahoo_XXX` when this happens.

**Root cause suspects:**
1. Race condition: multiple `saveLeague` calls firing simultaneously in `_resolveYahooIdentities`
   (currently `CONCURRENCY = 2`)
2. Firebase REST API timeout (8-second AbortController) triggered during slow Yahoo bundle fetch
3. The `resolved` flag being set on a stale copy of the league object

**Files:** `profile.js`, `firebase-db.js`

**Fix approach:**
- Reduce `CONCURRENCY` from 2 to 1 in `_resolveYahooIdentities` to eliminate races
- Confirm `_markResolved` is called before `saveLeague` (already fixed in April 17 session
  but worth verifying the save order is correct in all paths)
- Add retry logic to `saveLeague` — if it fails once, wait 1 second and retry once

---

## 🟡 Issue 6 — Yahoo Analytics Tab
**Symptom:** Analytics tab for Yahoo leagues not fully tested. `leagueKey` is wired
into `analytics.js` but end-to-end behavior is unknown.

**Files:** `analytics.js`, `standings.js`

**Approach:** Open a Yahoo league → Analytics tab. Check console for errors.
The Yahoo bundle is already cached in `_yahooBundle` — analytics just needs to read
from it the same way standings/matchups do.

---

## 🟡 Issue 7 — Yahoo Completed Redraft Leagues Not Getting `resolved`
**Symptom:** Past-season Yahoo redraft leagues re-fetch their bundle every page load
even though the season is over and data won't change.

**Current logic** in `_resolveYahooIdentities`:
```js
if (_isPastSeason(l) && playoffFinish !== null && leagueType && leagueType !== "redraft") {
  _markResolved(l);
}
```
Redraft leagues are explicitly excluded, but a completed redraft season is also
historical and safe to cache.

**Fix:** Also mark resolved if `lm.is_finished === 1` regardless of `leagueType`:
```js
if (_isPastSeason(l) && playoffFinish !== null
    && (leagueType !== "redraft" || lm.is_finished === 1)) {
  _markResolved(l);
}
```

**Files:** `profile.js`

---

## 🟡 Issue 8 — Bottom Safe Area on Mobile
**Symptom:** On iPhones with home indicator, content at the bottom of scrollable
areas can be clipped behind the home bar.

**Fix:** Add `padding-bottom: env(safe-area-inset-bottom)` to:
- `.league-detail-body` (already scrollable)
- `.app-view.active` (main content area)
- Any other `overflow-y: auto` containers at full viewport height

**Files:** `locker.css`

---

## 🟢 Issue 9 — MFL Bracket Early-Round Exit Placement
**Symptom:** For non-standard bracket sizes (6-team, 10-team), the placement formula
`Math.pow(2, roundsFromFinal) + 1` may give wrong results.

Example: In a 6-team playoff where there's a bye round, losing in round 1 (quarterfinal
equivalent) would give `2^2 + 1 = 5` but the actual placement might be 5th or 6th
depending on bracket structure.

**Files:** `profile.js`

**Low priority** — only affects non-standard bracket sizes and the error is minor.

---

## 🟢 Issue 10 — Cloudflare Custom Domain
**Symptom:** Email warning that `api.dynastylockerroom.com` will be deleted.

**Status:** Safe to ignore. Worker itself (`mfl-proxy.mraladdin23.workers.dev`) is
unaffected. All code uses the `workers.dev` URL directly.

**Action if desired:** Log into Cloudflare → Workers & Pages → confirm `mfl-proxy`
is still deployed. Custom domain can be restored by adding a GoDaddy CNAME:
`api` → `mfl-proxy.mraladdin23.workers.dev` (but not required).

---

## Console Reset Scripts

### Reset MFL guillotine/eliminator championships
```js
const u = "mraladdin23";
const ref = firebase.database().ref(`gmd/users/${u}/leagues`);
const snap = await ref.get();
const leagues = snap.val() || {};
const updates = {};
Object.entries(leagues).forEach(([key, l]) => {
  if (l.platform === "mfl" && (l.isGuillotine || l.playoffFinish == null)) {
    updates[`${key}/playoffFinish`] = null;
    updates[`${key}/isChampion`]    = false;
    updates[`${key}/resolved`]      = null;
  }
});
console.log("Resetting", Object.keys(updates).length / 3, "MFL leagues");
await ref.update(updates);
console.log("Done — click Sync to re-detect");
```

### Reset Yahoo playoff/resolved data
```js
const u = "mraladdin23";
const ref = firebase.database().ref(`gmd/users/${u}/leagues`);
const snap = await ref.get();
const leagues = snap.val() || {};
const updates = {};
Object.entries(leagues).forEach(([key, l]) => {
  if (l.platform === "yahoo") {
    updates[`${key}/playoffFinish`] = null;
    updates[`${key}/isChampion`]    = false;
    updates[`${key}/resolved`]      = null;
  }
});
console.log("Resetting", Object.keys(updates).length / 3, "Yahoo leagues");
await ref.update(updates);
console.log("Done — reload the page");
```

---

## Files Modified (This Session — April 17)
| File | Key Changes |
|------|-------------|
| `worker.js` | `_draftDebug` removed; `is_keeper` on draft picks; `yahooMatchupDetail` endpoint added (two-step roster+stats fetch); `yahooLogin` declaration bug fixed |
| `yahoo.js` | `uses_roster_import` in leagueMeta; `isKeeper`/`hasKeeperPicks` in draft; `_draftDebug` passthrough removed; token expiry logic fixed (optimistic use when expiresAt=0) |
| `profile.js` | `_detectMFLPlayoffFinish` accepts `isGuillotine`; guillotine skip bracket; rank cap removed; `resolved` allows guillotine redraft; `saveLeague` errors now logged; `hasKeeperPicks` wired into `_detectYahooLeagueType` |
| `standings.js` | Yahoo week pills use `season-pill`/`season-pill--current`; `_yahooExpandMatchup` handler; side-by-side player score grid in matchup expand |
| `index.html` | `viewport-fit=cover` added to meta viewport |
| `locker.css` | `100dvh` for app-view; `env(safe-area-inset-top)` on nav + detail panel; detail panel header/tabs sticky, body-only scroll |
| `base.css` | `min-height: 100dvh` with `100vh` fallback |

---

## Suggested Session Order
1. **Issue 1** — Run MFL reset script (no code changes, 5 minutes)
2. **Issue 4** — Yahoo playoff finish bug (`profile.js` only, surgical fix)
3. **Issue 3** — Yahoo matchup scores (`worker.js` + debug first, then `standings.js` if needed)
4. **Issue 2** — Yahoo mobile token (`app.js` + `yahoo.js`)
5. **Issue 5** — Yahoo Firebase persistence (`profile.js`)
6. **Issue 7** — Yahoo redraft resolved flag (`profile.js`, one-liner)
7. **Issue 8** — Bottom safe area (`locker.css`, small)
8. **Issue 6** — Yahoo Analytics (`analytics.js`)
