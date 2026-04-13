# Dynasty Locker Room (DLR) — Project Summary
*For use as context in a new Claude chat session*

---

## Project Identity

- **App name:** Dynasty Locker Room (DLR)
- **Live URL:** https://dynastylockerroom.com
- **GitHub repo:** https://github.com/mraladdin23/gm-dynasty (GitHub Pages deployment)
- **Owner/developer:** Mike (mraladdin23)
- **Stack:** Vanilla JavaScript SPA, Firebase Realtime DB, Cloudflare Worker proxy
- **Firebase project:** `sleeperbid-default-rtdb` (Realtime Database URL: `sleeperbid-default-rtdb.firebaseio.com`)
- **Firebase DB root node:** `gmd/`
- **Cloudflare Worker:** `mfl-proxy.mraladdin23.workers.dev` (file: `worker.js`)
- **DNS:** GoDaddy nameservers (was briefly on Cloudflare — reverted because Cloudflare proxy broke Firebase mobile auth)

---

## Architecture Overview

```
GitHub Pages (dynastylockerroom.com)
  └── index.html + css/ + js/
        ├── Firebase Auth (email/password — synthetic email: username@gmdynasty.app)
        ├── Firebase Realtime DB (gmd/ node — all user data)
        ├── Sleeper API (direct, no proxy)
        ├── MFL API (via Cloudflare Worker proxy)
        └── Yahoo API (OAuth via Cloudflare Worker)
```

---

## File Map — Every File and Its Purpose

### Root
- `index.html` — Full SPA shell. All screens defined here (auth, onboarding, app). Firebase SDK loaded at bottom of body (not head) to prevent mobile blank screen. CSS cache-busted at v=19.
- `worker.js` — Cloudflare Worker. Handles MFL bundle fetches, Yahoo OAuth flow. Deploy with `wrangler deploy`.

### `css/`
- `base.css` — Global variables, reset, typography
- `auth.css` — Login/register screen styles
- `locker.css` — All app UI styles (league cards, tabs, salary cap, auction, players, draft, etc.). v=19.

### `js/` — Core modules (all vanilla JS IIFEs)

| File | Purpose |
|------|---------|
| `app.js` | Orchestrates screens, auth state, global auction/chat monitors, button handlers |
| `auth.js` | Firebase Auth wrapper. Login/register/logout. **8-second timeout on auth state** to prevent mobile hang. |
| `firebase-db.js` | All Firebase Realtime DB reads/writes. Uses REST API with 8-second `AbortController` timeouts on all fetches. `saveLeagues` uses Firebase `.update()` (merge, not overwrite). |
| `profile.js` | League card grid, franchise history, league detail panel, MFL/Yahoo import (`linkMFL`, `linkYahoo`), overview tab live-fetch. Calls `DLRFreeAgents.init()` with `isCommissioner` as 10th arg. `_renderDetailTab` calls `DLRStandings.setLeague()` with 5th arg `myRosterId` on every tab switch. |
| `mfl.js` | MFL API helpers. Full list: `login()`, `getLeagueBundle()`, `getTeams()`, `getStandingsMap()`, `getRoster()` (async), `getPlayers()` (session-cached player universe), `normalizeMatchups()`, `normalizeLiveScoring()`, `normalizePlayoffBrackets()`, `normalizePlayoffBracketResult()`, `getLiveScoring()`, `getPlayoffBracket()`, `mflNameToSleeperId()`, `getDivisions()`, `getFranchiseDivision()`, `getDivisionFranchises()`, `filterStandingsByDivision()`, `getMyDraftUnitIndex()`, `debugBundle()` |
| `yahoo.js` | Yahoo OAuth token management, `getLeagueBundle` |
| `sleeper.js` | Sleeper API wrappers |
| `standings.js` | Standings, Matchups, Playoffs tabs — cross-platform. MFL: bundle cached in `_mflBundle` after first tab load and reused by matchups + playoffs tabs to avoid redundant fetches. `setLeague()` now accepts `myRosterId` as 5th arg and resets on season change. `_mflLiveScoringCache` and `_mflPlayoffState` cleared on reset. Division filter bar with "All Teams" toggle via `_showAllDivisions()`. |
| `roster.js` | Roster tab — cross-platform (Sleeper/MFL/Yahoo). MFL uses `getPlayers()` session cache for player names. |
| `draft.js` | Draft board — multi-draft selector (startup + rookie), grid/list toggle, MFL auction board, Sleeper snake/linear. MFL multi-set selector defaults to user's division unit via `MFLAPI.getMyDraftUnitIndex()`. Aborted drafts (< 1 full round) filtered out. |
| `transactions.js` | Transactions tab — all platforms normalized to Sleeper shape. MFL uses `MFLAPI.getPlayers()` for player name lookup (not bundle.players which is excluded from bundle). |
| `analytics.js` | Analytics tab — Sleeper fully working. MFL: full 5-tab parity (Power Rankings, Luck Index, Trade Map, Draft Recap, Waivers). Yahoo incomplete. |
| `rules-and-fa.js` | League Rules tab + Players/Free Agents tab. MFL players tab uses `MFLAPI.getPlayers()` (not bundle.players). `getRoster()` is awaited correctly with `Promise.all`. `DLRFreeAgents` tracks `_isCommish`. |
| `salary.js` | Salary cap module. FAAB multiplier, auto-tracking transactions (cross-platform), taxi squad promotion badges. |
| `auction.js` | DLR auction system. Proxy bid engine, night pause, auto-claim, bid history log. Commissioner quick-nominate modal. Cap checks subtract in-session auction wins. Nomination close/end-date controls. |
| `players-db.js` | Sleeper player DB loader (IndexedDB-backed via `idb-cache.js`) |
| `idb-cache.js` | IndexedDB wrapper for caching player DB and stats |
| `playercard.js` | Player card modal (Sleeper CDN photos) |
| `playerreport.js` | Cross-league player report panel |
| `chat.js` | League chat (Firebase Realtime DB) |
| `hallway.js` | The Hallway social feature |
| `trophy-room.js` | Trophy room display |
| `leaguegroups.js` | League grouping/commissioner tools |
| `manager-search.js` | Cross-league manager search |
| `config.js` | Firebase config (in `firebase/config.js`) |

---

## Platform Integration Status

### Sleeper ✅ Fully working
All tabs functional: overview, standings, roster, draft, transactions, players, analytics, salary cap, auction.

### MFL ⚠️ Connection stable — UI polish remaining
- **Working well:** Import (franchise_id based), league cards, overview (live fetch), standings (standard + eliminator + guillotine + division filter), rosters (player names resolving), analytics (all 5 tabs), salary cap, auction/salary board
- **Partially working:** Matchups (data loads but plain text — not card format), playoffs (data loads but bracket rendering broken), draft (multi-unit selector working but some player names unresolved), transactions (loads but trades show "details unavailable", some player chips blank), players tab (loads but some unresolved)
- **Known architecture:** `myRosterId` is the 4-digit zero-padded franchise ID (e.g. `"0035"`). Player name resolution depends on `MFLAPI.getPlayers()` session cache — unresolved players mean the cache lookup returned nothing for that MFL player ID. MFL player IDs in rosters are bare numeric strings; the `getPlayers()` map keys on those same IDs.

### Yahoo ⚠️ Partial
- OAuth flow implemented in worker
- Basic bundle (standings, rosters, draft, transactions) built
- Most tabs render but not fully tested end-to-end (requires OAuth which requires non-blocked network)

---

## Key Data Structures

### Firebase paths
```
gmd/
  users/{username}/           — profile, platforms, leagues
  uid_map/{uid}               — uid → username lookup
  leagueMeta/{username}/{leagueKey}  — pinned, archived, teamName, myRosterId, wins, etc.
  auctions/{leagueKey}/
    bids/{auctionId}          — auction records
    bidLog/{auctionId}        — bid history
    settings                  — bidDuration, pauseStart, pauseEnd, scheduledStart, scheduledEnd,
                                 nominationsClosed, minBid, minIncrement, maxNoms, maxRosterSize,
                                 forceFullRoster
  salaryCap/{storageKey}/
    settings                  — cap, minSalary, faabMultiplier, taxiYears, etc.
    rosters                   — { username: { players: [{playerId, salary, years, holdout}] } }
  leagueRules/{leagueKey}     — markdown rules text
  chat/{leagueKey}/messages   — chat messages
```

### MFL platform data (stored in `gmd/users/{username}/platforms/mfl`)
```js
{
  linked: true,
  mflEmail: "user@email.com",
  mflUsername: "user",  // derived from email prefix
}
```

### MFL league key structure
```
League key in Firebase:   mfl_{season}_{leagueId}     e.g. "mfl_2024_22796"
Dynasty chain key:        mfl__{leagueId}             e.g. "mfl__22796"
myRosterId:               4-digit zero-padded franchise ID e.g. "0035"
```

### MFL bundle shape (returned by worker `/mfl/bundle`)
```js
{
  league:          // TYPE=league — league info, franchises, settings, divisions
  rosters:         // TYPE=rosters — franchise player arrays (id + status only, NO names)
  standings:       // TYPE=leagueStandings — franchise standings rows
  liveScoring:     // TYPE=liveScoring — current week matchups + per-player scores
  draft:           // TYPE=draftResults — draftUnit array (may be multiple units for multi-division)
  auctionResults:  // TYPE=auctionResults — auction picks (may be "No" for snake leagues)
  transactions:    // TYPE=transactions
  playerScores:    // TYPE=playerScores&WEEK=YTD — season totals
  playoffBrackets: // TYPE=playoffBrackets — bracket definitions
}
// NOTE: players (TYPE=players) is NOT in the bundle — fetched on-demand via
// /mfl/players endpoint and cached in sessionStorage as mfl_players_{year}.
// rosters endpoint only returns {id, status} per player — names come from getPlayers() cache.
```

### MFL divisions (multi-division leagues)
```js
// league.league.divisions.division — array of { id, name }
// Each franchise has a `division` attribute matching a division id
// draftUnit entries have a `unit` field matching a division id
// MFLAPI helpers: getDivisions(), getFranchiseDivision(), getDivisionFranchises(),
//   filterStandingsByDivision(), getMyDraftUnitIndex()
// standings.js shows user's division by default with "All Teams" toggle
// Division state is currently tab-local — NOT persistent across tab switches (open issue)
```

### MFL worker endpoints
```
POST /mfl/userLeagues   — login + fetch all leagues (uses SINCE=1999 single request, falls back to batched)
POST /mfl/login         — login only, returns cookie for reuse
POST /mfl/bundle        — full league bundle (accepts cookie to skip re-login)
POST /mfl/liveScoring   — single week liveScoring on-demand (W= param)
POST /mfl/playoffBracket — single bracket result on-demand (BRACKET_ID= param)
POST /mfl/players       — full MFL player universe (session-cached client-side)
```

### Worker User-Agent
All MFL outbound fetches in `worker.js` now include:
```
User-Agent: DynastyLockerRoom/1.0 (dynastylockerroom.com)
```
This gives better rate limits from MFL. Previously unidentified requests got stricter throttling.

### League type detection
- **Eliminator:** `league.league.franchises_eliminated` present → teams eliminated in order, players stay rostered
- **Guillotine:** `franchise_eliminated` on individual standings entries → lowest scorer eliminated weekly, players return to FA
- **Survivor pool:** `survivorPool === "Yes"` — these ARE imported (reversed earlier decision)

---

## Worker Architecture Notes

### Session cookie reuse
`linkMFL` in `profile.js` calls `/mfl/login` once at the start of import, then passes the cookie to all `/mfl/bundle` calls. This avoids 28 separate logins for 28 leagues.

### Bundle fetch batching
Leagues are fetched in batches of 3 with 200ms between batches. Each bundle gets one automatic retry after 600ms if it fails or returns an empty `league.league.name`.

### Safe JSON parsing
All MFL API responses go through `r.text()` then `JSON.parse()` in a try/catch. MFL returns plain text `"No"` for endpoints that don't apply to a league (e.g. `auctionResults` on a snake draft league). This no longer causes Worker 500 errors.

### Player universe caching
`MFLAPI.getPlayers(year)` fetches `TYPE=players` once per session. Cached in memory (`_playersMemCache`) and `sessionStorage` keyed by `mfl_players_{year}`. Provides `{ name, position, pos, team, sleeperId }` per MFL player ID. Used by: roster.js, draft.js, rules-and-fa.js (Players tab), transactions.js.

### Bundle reuse across tabs
`standings.js` stores the full MFL bundle in `_mflBundle` after first load. Matchups and playoffs tabs check this cache before fetching — avoids redundant bundle calls when user browses multiple tabs on the same league.

---

## Network / Infrastructure Notes

- **Home router** blocks `workers.dev` and `firebaseio.com` WebSocket — use mobile data or disable router security for MFL/Yahoo testing
- **Firebase long-polling** fallback works on home network (WebSocket blocked but REST works)
- **Mobile fix:** `auth.js` has 8-second timeout on `onAuthStateChanged`. `firebase-db.js` has 8-second `AbortController` on all `fetch()` calls. `index.html` has 10-second global safety net that force-shows auth screen.
- **CDN:** Firebase SDK loaded at bottom of `<body>` (not `<head>`) — prevents mobile blank screen while SDK downloads

---

## Completed Sessions Log

### April 10, 2026
1. Mobile auth fix — `getIdToken(false)` + timeouts everywhere Firebase is called
2. MFL player matching — Skill positions only (QB/RB/WR/TE), raw name format for Sleeper lookup
3. MFL transactions — Normalized to Sleeper format (type/team filter dropdowns, chip styling)
4. MFL overview — Live fetch with broadened identity matching, re-renders card on success
5. MFL draft board — Grid/list toggle (same as Sleeper), separate Draft Board / Auction Board buttons
6. Auction proxy fix — Correct displayBid formula
7. Auction timer — Shows post-pause expiry time `⏸ Xh Ym` not just "Paused"
8. Auction auto-claim — Now claims expired auctions even during pause window
9. Auction history — Uses stored `winner`/`winningBid` (authoritative), not re-derived from proxies
10. Salary cap — FAAB multiplier setting, cross-platform transaction auto-tracking, taxi promotion badges
11. Players tab — Auction badge as fixed column, year selector (2020–current), MFL Sleeper bio
12. Transactions — `status=complete` filter (hides failed waivers)
13. Salary IR/taxi badges — Removed slot badges, added contextual taxi promotion warnings
14. MFL email identity — Stored `mflEmail`, resync banner for username-only users
15. DNS rollback — Reverted from Cloudflare to GoDaddy nameservers (Cloudflare proxy broke Firebase mobile)

### April 12, 2026
16. MFL identity overhaul — franchise_id based, dynasty chain key `mfl__<league_id>`, teamName from bundle
17. Removed email matching infrastructure — deleted `buildEmailList()`, `findMyFranchise()`, `mflAdditionalEmails`
18. UI cleanup — Simplified `linkMFL` to email + password only

### April 12–13, 2026 (Auction + Draft overhaul)
19. Auction — initial bid log — Nomination now writes opening bid as first `bidLog` entry so history is never empty
20. Auction — available cap in bid modal — Shows "Max you can bid" computed as `d.remaining − spent − committedOther`
21. Auction — pass button removed — Cleaned up from auction cards; function preserved
22. Auction — Force Full Roster setting — New commissioner setting (default off)
23. Auction — cap calculation root fix — Added `_auctionSpentTotal(rosterId)` helper
24. Auction — commissioner nomination — `canNominate()` returns `true` for commish so 🏷 button always shows
25. Auction — Quick Nominate modal — Commissioner-only shortcut on the Live tab toolbar
26. Auction — nomination close controls — New `scheduledEnd` and `nominationsClosed` settings
27. Players tab — commissioner always sees nominate button — `DLRFreeAgents` now tracks `_isCommish`
28. Players tab — compact status badges — R/A/C letter badges (26×26px)
29. Draft — multi-draft selector — Sleeper leagues with multiple drafts now show a pill selector bar
30. Draft — aborted draft filter — Drafts with fewer picks than one full round are excluded

### April 13, 2026 (MFL overhaul)
31. Worker — bundle reliability — Removed `schedule`, `scoreboard`, `salaries`, `players` from bundle. Added `liveScoring`, `playoffBrackets`. All endpoints now use safe JSON parsing.
32. Worker — new on-demand endpoints — `/mfl/liveScoring`, `/mfl/playoffBracket`, `/mfl/players`, `/mfl/login`
33. Worker — userLeagues reliability — `SINCE=1999` single request, fallback to batched year-by-year
34. Worker — bundle batching — 3 at a time, 200ms gap, one auto-retry per league
35. mfl.js — liveScoring matchups, playoff support, player universe cache, login helper
36. standings.js — MFL matchups (on-demand per week), playoffs (bracket renderer), guillotine leagues
37. analytics.js — Full MFL tab parity (all 5 tabs)
38. draft.js — MFL multi-set selector (startup + rookie units, auction sets)
39. roster.js — Player name resolution via `getPlayers()` session cache
40. profile.js — Import reliability (cookie reuse, batch 3, one retry, progress updates)
41. Survivor pool filter removed — These leagues ARE imported
42. Guillotine league detection — `isGuillotine` stored on league record in Firebase

### April 13, 2026 (MFL Worker 500 fixes + data flow audit)
43. Worker — `/mfl/players` — Fixed crash on non-JSON MFL response (was using `r.json()`, now uses `r.text()` + try/catch)
44. Worker — User-Agent header — Added `DynastyLockerRoom/1.0` to all MFL outbound fetches for better rate limits
45. rules-and-fa.js — Players tab — Fixed: was reading `bundle.players` (never in bundle); now uses `MFLAPI.getPlayers(_season)`
46. rules-and-fa.js — Players tab — Fixed: `MFLAPI.getRoster()` was called synchronously (returns Promise); now awaited with `Promise.all`
47. transactions.js — Fixed: was reading `bundle.players` (never in bundle); now uses `MFLAPI.getPlayers(_season)`
48. standings.js — `setLeague()` — Added `myRosterId` as 5th parameter; now resets on season change (not just leagueId change)
49. standings.js — `reset()` — Now clears `_mflLiveScoringCache` and `_mflPlayoffState` (were missing, caused stale data bleed)
50. profile.js — `DLRStandings.setLeague()` call — Now passes `league.myRosterId` as 5th arg on every tab switch

### April 13, 2026 (Division support + matchups/playoffs fixes)
51. mfl.js — Added division helpers: `getDivisions()`, `getFranchiseDivision()`, `getDivisionFranchises()`, `filterStandingsByDivision()`, `getMyDraftUnitIndex()`
52. standings.js — Division filter bar on MFL standings with "All Teams" toggle (`_showAllDivisions()`)
53. standings.js — Bundle cached in `_mflBundle` after first standings load; matchups + playoffs reuse it (no redundant fetches)
54. standings.js — MFL matchups: filtered to user's division when applicable; division banner shown above matchup grid
55. standings.js — MFL playoffs: reuses cached bundle; standings fallback also passes bundle for division filtering
56. draft.js — MFL multi-unit draft: defaults to user's division unit via `getMyDraftUnitIndex()` instead of always unit 0
57. locker.css — Added `.standings-division-bar`, `.standings-division-label`, `.standings-div-pill`, `.standings-div-pill--active`, `.standings-row--me td`; mobile: division bar scrolls horizontally

---

## Roadmap — Open Issues

### 🔴 Critical — Next Session Priority

**MFL — Division state not persistent across tabs**
Division filter is currently computed fresh on each tab. It should be stored at the league level and respected by all tabs (standings, matchups, playoffs, and potentially roster/draft). The pill clicking "All Teams" also currently causes pills to disappear — the toggle needs to re-render properly. Architecture: store selected division ID in `_mflBundle` or a module-level var in `standings.js`, and expose a getter so other modules can read it.

**MFL — Matchups not rendered as cards**
Currently renders as plain text. Should match Sleeper's card format: clickable cards that expand to show per-player scorer breakdown (side-by-side layout). Should default to Week 1, not current week. Files: `standings.js` (`_renderMFLMatchupsShell`, `_mflMatchupCards`). Model after Sleeper's `_renderMatchupCards()` in the same file.

**MFL — Playoffs bracket not rendering correctly**
Bracket data is loading but the visual rendering is broken. Should match Sleeper's bracket look and feel. Files: `standings.js` (`_mflLoadBracket`, `_mflBracketMatchCard`). Compare with Sleeper's `_loadBracket()`.

**MFL — Large number of unresolved players**
Many MFL players show as `Player {id}` with no name. Root cause: `MFLAPI.getPlayers()` returns names in `"Last, First"` MFL format but roster/transaction code may not be converting them consistently. Also affects draft results (some pick names missing), transactions (chips show blank), and the Players tab. Debug approach: use `MFLAPI.debugBundle()` in browser console on a broken league to inspect `_franchiseEmails` and then check if the player IDs in rosters exist as keys in `sessionStorage.getItem('mfl_players_2025')`.

**MFL — Auction results not showing**
The Auction Board tab shows empty. The `auctionResults` key in the bundle uses `bundle.auctionResults.auctionResults` — the shape may be inconsistent (single object vs array). Also verify the `salary` field name: MFL uses `amount`, `bid`, or `winningBid` depending on endpoint version. Files: `draft.js` (`_loadMFLDraft`, auction set normalization).

**MFL — Trades show "details unavailable", some transaction chips blank**
Trades in MFL transactions use a different structure than Sleeper — the `adds`/`drops` format doesn't map correctly to the trade summary renderer. Also some player IDs in transactions don't match the `getPlayers()` map. Files: `transactions.js` (`_loadMFLData`, `mflPid()` resolver, `_tradeSummary()`).

**MFL — Eliminator week elimination not shown consistently**
Guillotine leagues show which week a team was eliminated via `franchise_eliminated` on standings entries, but eliminator leagues (where `franchises_eliminated` is on `league.league`) don't show the week number consistently. The `weekEliminated` field on eliminator standings rows may be off-by-one or null. Files: `mfl.js` (`normalizeStandings` eliminator branch).

### 🟡 Mobile Issues

**Login check loop + zoom on mobile**
On mobile the app is constantly re-checking login state, and the screen view is zoomed in requiring manual zoom-out to snap back. This also happens when focusing search inputs in the Hallway section. Fix: add `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">` to `index.html` to prevent browser zoom on input focus. Also audit `auth.js` for redundant `onAuthStateChanged` triggers. Files: `index.html`, `auth.js`, `hallway.js`.

**Consolation draft order card height mismatch**
Cards are 36px but inner content sections are 72px. Either increase card height to 72px or condense inner sections to 36px. Files: `locker.css` (`.draft-order-row`, `.draft-order-section`).

### High Priority
- [ ] Yahoo end-to-end test — OAuth requires non-blocked network; test all tabs once available
- [ ] Career stats accuracy — Verify cross-platform totals are correct
- [ ] MFL historical seasons import verification — Confirm multi-year dynasty chaining works

### Medium Priority
- [ ] Auction History tab cleanup — Minor display issues noted
- [ ] Draft board — Yahoo — Grid/list toggle ready; needs Yahoo data tested
- [ ] Analytics — Yahoo — Not connected
- [ ] Matchups tab for Yahoo — Not built

### Low Priority / Future Features
- [ ] Sticky notes in Hallway UI
- [ ] Commissioner trophy builder
- [ ] Tournament bracket feature (separate from multi-division leagues — distinct concept)

---

## Tips for Starting a New Claude Chat

### What to paste at the start of a new chat:
1. **This document** — attach as a file
2. **The specific file(s)** you want to work on — Claude can't access GitHub directly
3. **A brief description of what you want to do**

### Standard context block:
```
I'm working on Dynasty Locker Room (DLR), a fantasy football SPA at dynastylockerroom.com.
Repo: mraladdin23/gm-dynasty (GitHub Pages).
Stack: Vanilla JS, Firebase Realtime DB, Cloudflare Worker (mfl-proxy.mraladdin23.workers.dev).
Platforms: Sleeper (fully working), MFL (mostly working), Yahoo (partial).
[Attach DLR_PROJECT_SUMMARY.md]
Today I want to work on: [specific task]
Here are the relevant files: [attach files]
```

### For the next session (MFL UI fixes):
**Priority 1 — Matchups + Playoffs:**
Attach: `standings.js`
Ask: *"MFL matchups are plain text, not cards. They should match Sleeper's card format with expandable per-player scoring and default to Week 1. MFL playoffs are not rendering correctly and should look like the Sleeper bracket. Please fix both."*

**Priority 2 — Division persistence:**
Attach: `standings.js`, `profile.js`
Ask: *"The MFL division filter is not persistent — clicking 'All Teams' makes the pills disappear and the division state resets on every tab switch. Division context should be stored at the module level and persist across standings, matchups, and playoffs tabs."*

**Priority 3 — Player resolution + transactions:**
Attach: `mfl.js`, `transactions.js`, `draft.js`
Ask: *"Many MFL players are unresolved (show as 'Player {id}'). Trades show 'details unavailable'. Auction results are empty. Please audit the player ID → name resolution chain and fix."*

**Priority 4 — Mobile viewport + auth loop:**
Attach: `index.html`, `auth.js`
Ask: *"On mobile the screen zooms in on input focus and the auth state check loops. Add viewport meta tag to prevent zoom and audit the auth state listener."*

### What NOT to do:
- Don't paste 10 files at once — Claude works best with 1–3 files at a time
- Don't ask Claude to "continue from where we left off" without context — it won't know
- Do paste the specific file you want changed — Claude can't pull from GitHub

---

## About Computer Lag / Usage Limits

**Why chats get slow:**
- Long conversations accumulate a large context window
- After ~50–100 exchanges, responses noticeably slow down

**Best practices:**
1. Start a new chat for each distinct feature
2. Keep file pastes focused — only paste files directly relevant to the task
3. Commit to git after each fix so you never lose progress
4. For large files (profile.js ~2000 lines), paste only the relevant function

---

*Document updated: April 13, 2026*
*Files updated this session: mfl.js, standings.js, transactions.js, draft.js, locker.css*
*Previous session files: worker.js, rules-and-fa.js, profile.js*
