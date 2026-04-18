# Dynasty Locker Room — Master TODO List
*Updated: April 18, 2026*
*Attach with DLR_PROJECT_SUMMARY.md + specific files per task.*

---

## How to Use This Doc
Each issue is self-contained. For each session: attach this doc + project summary +
only the files listed under that issue. Fix one issue per session where possible.
After completing an issue, move it to the ✅ Completed section at the bottom.

---

## 🔴 Critical — Crashes or Broken Core Features

### C1 — Career Stats Modal Crash
**Error:** `Uncaught ReferenceError: _renderCSPlatform is not defined`
`_openCareerSummaryModal` in `profile.js` calls `_renderCSPlatform()` and
`_renderCSPlatformYear()` but these functions were never implemented.

**Fix needed in `profile.js`:**
Add two render functions after `_renderCSMatrix`:
- `_renderCSPlatform(leagues)`: table grouped by `l.platform` ("sleeper", "mfl", "yahoo"). Use `_platformLabel()` for display names. Same structure as `_renderCSType`.
- `_renderCSPlatformYear(leagues)`: matrix with rows=seasons, columns=platforms. Same structure as `_renderCSMatrix`.

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

### C2 — Yahoo Draft Tab Empty
**Problem:** Draft results not rendering for Yahoo leagues.

**Fix:** The parser below handles all known Yahoo response shapes and should go into
`worker.js` where the draft array is built in the bundle builder:

```js
// ── Draft results ─────────────────────────────────────────────────────────
let draft = [];
try {
  let draftArr = [];
  // Shape 1 / 2: direct draft_results
  if (draftData?.draft_results !== undefined) {
    const dr = draftData.draft_results;
    if (Array.isArray(dr)) {
      draftArr = dr;
    } else if (dr && typeof dr === "object") {
      const count = parseInt(dr.count) || Object.keys(dr).filter(k => k !== "count").length;
      for (let i = 0; i < count; i++) {
        if (dr[String(i)]) draftArr.push(dr[String(i)]);
      }
    }
  }
  // Shape 3+: nested under fantasy_content.league
  if (!draftArr.length) {
    const dLeague = draftData?.fantasy_content?.league;
    const dLeague1 = Array.isArray(dLeague) ? dLeague[1] : dLeague?.[1];
    const dResults = dLeague1?.draft_results;
    let dContainer;
    if (Array.isArray(dResults)) {
      dContainer = dResults[0];
    } else if (dResults && typeof dResults === "object") {
      dContainer = dResults.draft_result !== undefined ? dResults : (dResults["0"] || dResults);
    }
    let draftRaw;
    if (dResults && typeof dResults === "object" && dResults.count) {
      draftRaw = dResults;
    } else if (dContainer?.draft_result) {
      draftRaw = dContainer.draft_result;
    } else {
      draftRaw = dContainer;
    }
    if (Array.isArray(draftRaw)) {
      draftArr = draftRaw.map(e => e?.draft_result || e).filter(Boolean);
    } else if (draftRaw && typeof draftRaw === "object") {
      const numericKeys = Object.keys(draftRaw).filter(k => !isNaN(k));
      if (numericKeys.length > 0) {
        numericKeys.forEach(k => {
          const entry = draftRaw[k];
          if (entry) draftArr.push(entry.draft_result || entry);
        });
      } else {
        draftArr = [draftRaw];
      }
    }
  }
  draftArr.forEach((pick, i) => {
    if (!pick) return;
    const rawPid = pick.player_key || pick.player_id;
    const rawTid = pick.team_key || pick.team_id;
    draft.push({
      pick: parseInt(pick.pick || i + 1),
      round: parseInt(pick.round || 1),
      teamId: String(rawTid || "").split(".").pop(),
      playerId: yahooPlayerId(rawPid),
      name: pick.player_name || pick.name || "",
      position: pick.position || "?",
      cost: pick.cost != null ? parseInt(pick.cost) : null,
    });
  });
} catch (e) {}
```
**Files:** `worker.js`, `draft.js`

---

### C3 — Yahoo Keeper Detection via Draft Cost
**Problem:** Keeper identification should use the `cost` field in draft results —
keepers have a cost value set in Yahoo auction/keeper drafts.
**Note:** Do in same session as C2 since it depends on the cost field being parsed.
**Files:** `yahoo.js`, `worker.js`

---

## 🔴 Yahoo Platform Bugs

### Y1 — Yahoo Playoff Tab + Championship Detection
**Problem:** Playoffs tab advances the wrong teams through rounds. Runner-up sometimes
shown as `playoffFinish: 3`. Both the bracket rendering and the finish detection need fixes.

**Root cause (finish detection) in `profile.js` `_detectYahooPlayoffFinish`:**
All 4 playoff teams are in `playoffTeamSet` so consolation game teams aren't excluded.
Fix: find the championship game (teams who won their semifinal), then:
- In championship game: win = 1st, lose = 2nd
- In final week but NOT championship game: win = 3rd, lose = 4th
- Eliminated in semifinal week: 5th+

**Files:** `profile.js`, `standings.js`

---

### Y2 — Yahoo Matchup Pills + Player Score Expand
**Problem:** Week pills don't match Sleeper/MFL style. Expanded matchup should show
lineup with individual player scores, not just team totals.
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
with no way to refresh a new token.
**Files:** `yahoo.js`, `worker.js`, `app.js`

---

### Y5 — Yahoo Bundle Instability
**Problem:** Yahoo league bundles are unreliable — drop data intermittently.
**Files:** `worker.js`, `yahoo.js`

---

### Y6 — Yahoo Completed Redraft Leagues Not Marked Resolved
**Problem:** Completed redraft leagues re-fetch from Yahoo API on every page load.
**Fix:** Also mark resolved if `lm.is_finished === 1` regardless of `leagueType`:
```js
if (_isPastSeason(l) && playoffFinish !== null
    && (leagueType !== "redraft" || lm.is_finished === 1)) {
  _markResolved(l);
}
```
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
**Problem:** Overall tab still shows "Season in Progress" badge for leagues that have ended.
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
**Note:** Needs design mockup attached to session. Will likely require a new
`themes.js` or `customization.js` module and significant CSS variable refactor.

### F5 — Tournament Mode (Cross-Platform)
**Idea:** A full tournament feature that works across Sleeper, MFL, and Yahoo. User
loads their leagues and the tournament system creates:
- Overall standings across all participating leagues
- Custom playoff bracket support (see F2)
- Tournament-specific stat tracking and leaderboards
- Separate from individual league data — its own Firebase node
**Files:** New `tournament.js` module + `firebase-db.js`, `index.html`, `locker.css`
**Note:** Very large feature. Builds on F2 (Custom Playoffs). Needs scoping session.
Likely needs its own screen/view in the SPA.

### F6 — Locker Room Post-It Trash Talk Wall
**Idea:** Inside the visual locker room (F4), users can leave post-it style sticky
notes on their locker or on opponents' lockers as trash talk messages. Notes are
stored in Firebase and visible to other users.
**Files:** New `postits.js` or extend `hallway.js` + `firebase-db.js`, `locker.css`, `index.html`
**Note:** Depends on F4 (Locker Room Redesign) being done first. Needs Firebase
security rules to allow cross-user writes to the post-it node only.

### F7 — Custom Trophy Builder
**Idea:** Users can design and create their own custom trophies for the Trophy Room.
Build a trophy from selectable components (base, body, topper, engraving text,
color/material). Saved to Firebase and displayed in their Trophy Room alongside
auto-detected platform trophies.
**Files:** New `trophy-builder.js` + extend `trophy-room.js`, `firebase-db.js`, `locker.css`, `index.html`
**Note:** Could use SVG-based trophy composer. Standalone feature — no blockers.

---

## Suggested Session Order

| # | ID | Description | Effort | Files |
|---|-----|-------------|--------|-------|
| 1 | C2 | Yahoo Draft Parsing | Medium | `worker.js`, `draft.js` |
| 2 | C3 | Yahoo Keeper via Cost | Low (with C2) | `yahoo.js`, `worker.js` |
| 3 | C1 | Career Stats Crash | Medium | `profile.js`, `index.html` |
| 4 | Y1 | Yahoo Playoff/Championship | Medium | `profile.js`, `standings.js` |
| 5 | Y2 | Yahoo Matchup Pills + Scores | Medium | `standings.js`, `worker.js` |
| 6 | Y4 | Yahoo Mobile Token | High | `yahoo.js`, `worker.js`, `app.js` |
| 7 | M1 | MFL Championship Detection | Medium | `profile.js`, `mfl.js` |
| 8 | M2 | MFL Analytics Tab | Medium | `analytics.js`, `mfl.js` |
| 9 | Y3 | Yahoo Transactions Team Name | Low | `transactions.js`, `worker.js` |
| 10 | U1 | Hallway Grid + Scroll | Low | `hallway.js`, `locker.css` |
| 11 | U2 | Bottom Safe Area | Trivial | `locker.css` |
| 12 | U3 | Groups League Order | Low | `leaguegroups.js` |
| 13 | U4 | Broadcast Message | Low | `leaguegroups.js` |
| 14 | X1 | Season in Progress Badge | Low | `profile.js`, `standings.js` |
| 15 | Y5 | Yahoo Bundle Stability | Medium | `worker.js`, `yahoo.js` |
| 16 | Y6 | Yahoo Redraft Resolved Flag | Trivial | `profile.js` |
| 17 | X2 | Cross-Platform League Link | High | `profile.js`, `firebase-db.js`, `leaguegroups.js` |
| 18 | F1 | Dynasty Overview Tab | High | `standings.js`, `profile.js`, `locker.css` |
| 19 | F2 | Custom Playoff Tracker | Very High | New module + several files |
| 20 | F7 | Custom Trophy Builder | High | `trophy-builder.js`, `trophy-room.js`, `locker.css` |
| 21 | F4 | Locker Room Redesign + Team Theme | Very High | New theme system + CSS refactor |
| 22 | F6 | Post-It Trash Talk Wall | High | `postits.js`, `firebase-db.js`, `locker.css` |
| 23 | F5 | Tournament Mode | Very High | New `tournament.js` + several files |

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
- MFL identity matching overhauled to use `franchise_id`/`league_id` from `TYPE=myleagues` API
- MFL `myRosterId`/`teamName` Firebase path writes fixed
- MFL transaction parsing rewritten (TRADE, WAIVER, BBID_WAIVER, FREE_AGENT, FAAB `BB_` prefix, `|` delimiter)
- MFL matchup cards rebuilt (clickable expansion, per-player scoring breakdowns)
- MFL playoff bracket rendering, division filter persistence, guillotine/eliminator handling
- MFL auction system: nomination flow, commissioner eligibility, compact badges, multi-draft pills, nomination close controls
- DynastyProcess CSV player mappings (`getFullPlayer()`, `getSleeperIdFromMfl()`)
- MFL bundle reliability: batch fetches (3 at a time, 200ms delay, 1 auto-retry at 600ms)
- Mobile viewport zoom fix, input font-size fix
- Auction CSV export
- Draft multi-selector, aborted draft filter
- `_resolveSleeperIdentities` backfill
- DNS rollback to GoDaddy (Cloudflare proxy was breaking Firebase mobile auth)

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

### Reset a SINGLE league (surgical — safe)
```js
// Only use for one specific league, never bulk
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
