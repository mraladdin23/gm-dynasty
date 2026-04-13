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
| `profile.js` | League card grid, franchise history, league detail panel, MFL/Yahoo import (`linkMFL`, `linkYahoo`), overview tab live-fetch. Calls `DLRFreeAgents.init()` with `isCommissioner` as 10th arg. |
| `mfl.js` | MFL API helpers: `login()`, `getLeagueBundle()`, `getTeams()`, `getStandingsMap()`, `getRoster()` (async — uses `getPlayers()` session cache), `getPlayers()` (session-cached player universe), `normalizeMatchups()` (liveScoring shape), `normalizeLiveScoring()`, `normalizePlayoffBrackets()`, `normalizePlayoffBracketResult()`, `getLiveScoring()`, `getPlayoffBracket()`, `mflNameToSleeperId()` (skill pos only: QB/RB/WR/TE) |
| `yahoo.js` | Yahoo OAuth token management, `getLeagueBundle` |
| `sleeper.js` | Sleeper API wrappers |
| `standings.js` | Standings tab — cross-platform. MFL matchups use on-demand liveScoring per week with cache. MFL playoffs render bracket via `playoffBrackets` + `playoffBracket` APIs. Guillotine and eliminator leagues both handled with distinct UI. |
| `roster.js` | Roster tab — cross-platform (Sleeper/MFL/Yahoo). MFL uses `getPlayers()` session cache for player names. |
| `draft.js` | Draft board — multi-draft selector (startup + rookie), grid/list toggle, MFL auction board, Sleeper snake/linear. MFL multi-set selector (multiple draft units / auction sets). Aborted drafts (< 1 full round) are filtered out. |
| `transactions.js` | Transactions tab — all platforms normalized to Sleeper shape, `status=complete` filter only |
| `analytics.js` | Analytics tab — Sleeper fully working. MFL: full 5-tab parity (Power Rankings, Luck Index, Trade Map, Draft Recap, Waivers). Yahoo incomplete. |
| `rules-and-fa.js` | League Rules tab + Players/Free Agents tab. Year selector for stats (2020–current). MFL uses Sleeper bio via `_sleeperId` mapping. `DLRFreeAgents` now tracks `_isCommish` — commissioner always sees active 🏷 nominate button. |
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

### MFL ⚠️ Mostly working — tab rendering broken
- **Working:** Import (franchise_id based), league cards (names populate correctly), overview (live fetch), standings (standard + eliminator + guillotine), matchups (liveScoring on-demand per week), analytics (all 5 tabs), draft (grid/list + multi-set selector), auction/salary board, transactions, salary cap, playoffs (bracket renderer)
- **🔴 CRITICAL OPEN ISSUE — Next session priority:**
  - **Standings, matchups, playoffs tabs** — inconsistent data pull; sometimes don't match roster IDs correctly
  - **Players, draft, rosters tabs** — returning `MFL Worker 500` errors
  - Root cause likely: bundle endpoint failures and/or roster ID / franchise ID mismatch between `myRosterId` stored in Firebase and what the tab modules expect. Need to audit the full data flow from Firebase → tab init → bundle fetch → render for each broken tab.
- **Known architecture:** `myRosterId` is the 4-digit zero-padded franchise ID (e.g. `"0035"`). This is used as the team identity anchor across all tabs. If this isn't threading correctly it breaks standings highlighting, roster rendering, and player display.

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
  league:          // TYPE=league — league info, franchises, settings
  rosters:         // TYPE=rosters — franchise player arrays (id + status only, NO names)
  standings:       // TYPE=leagueStandings — franchise standings rows
  liveScoring:     // TYPE=liveScoring — current week matchups + per-player scores
  draft:           // TYPE=draftResults — draftUnit array (may be multiple units)
  auctionResults:  // TYPE=auctionResults — auction picks (may be "No" for snake leagues)
  transactions:    // TYPE=transactions
  playerScores:    // TYPE=playerScores&WEEK=YTD — season totals
  playoffBrackets: // TYPE=playoffBrackets — bracket definitions
}
// NOTE: players (TYPE=players) is NOT in the bundle — fetched on-demand via
// /mfl/players endpoint and cached in sessionStorage as mfl_players_{year}.
// rosters endpoint only returns {id, status} per player — names come from getPlayers() cache.
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
`MFLAPI.getPlayers(year)` fetches `TYPE=players` once per session. Cached in memory (`_playersMemCache`) and `sessionStorage` keyed by `mfl_players_{year}`. Provides `{ name, position, pos, team, sleeperId }` per MFL player ID.

---

## Network / Infrastructure Notes

- **Home router** blocks `workers.dev` and `firebaseio.com` WebSocket — use mobile data or disable router security for MFL/Yahoo testing
- **Firebase long-polling** fallback works on home network (WebSocket blocked but REST works)
- **Mobile fix:** `auth.js` has 8-second timeout on `onAuthStateChanged`. `firebase-db.js` has 8-second `AbortController` on all `fetch()` calls. `index.html` has 10-second global safety net that force-shows auth screen.
- **CDN:** Firebase SDK loaded at bottom of `<body>` (not `<head>`) — prevents mobile blank screen while SDK downloads

---

## Completed — April 10, 2026 Session

1. **Mobile auth fix** — `getIdToken(false)` + timeouts everywhere Firebase is called
2. **MFL player matching** — Skill positions only (QB/RB/WR/TE), raw name format for Sleeper lookup
3. **MFL transactions** — Normalized to Sleeper format (type/team filter dropdowns, chip styling)
4. **MFL overview** — Live fetch with broadened identity matching, re-renders card on success
5. **MFL draft board** — Grid/list toggle (same as Sleeper), separate Draft Board / Auction Board buttons
6. **Auction proxy fix** — Correct displayBid formula
7. **Auction timer** — Shows post-pause expiry time `⏸ Xh Ym` not just "Paused"
8. **Auction auto-claim** — Now claims expired auctions even during pause window
9. **Auction history** — Uses stored `winner`/`winningBid` (authoritative), not re-derived from proxies
10. **Salary cap** — FAAB multiplier setting, cross-platform transaction auto-tracking, taxi promotion badges
11. **Players tab** — Auction badge as fixed column, year selector (2020–current), MFL Sleeper bio
12. **Transactions** — `status=complete` filter (hides failed waivers)
13. **Salary IR/taxi badges** — Removed slot badges, added contextual taxi promotion warnings
14. **MFL email identity** — Stored `mflEmail`, resync banner for username-only users
15. **DNS rollback** — Reverted from Cloudflare to GoDaddy nameservers (Cloudflare proxy broke Firebase mobile)

## Completed — April 12, 2026 Session

16. **MFL identity overhaul** — franchise_id based, dynasty chain key `mfl__<league_id>`, teamName from bundle
17. **Removed email matching infrastructure** — deleted `buildEmailList()`, `findMyFranchise()`, `mflAdditionalEmails`
18. **UI cleanup** — Simplified `linkMFL` to email + password only

## Completed — April 12–13, 2026 Sessions (Auction + Draft overhaul)

19. **Auction — initial bid log** — Nomination now writes opening bid as first `bidLog` entry so history is never empty.
20. **Auction — available cap in bid modal** — Bid modal shows "Max you can bid" computed as `d.remaining − spent − committedOther`.
21. **Auction — pass button removed** — Cleaned up from auction cards; function preserved.
22. **Auction — Force Full Roster setting** — New commissioner setting (default off).
23. **Auction — cap calculation root fix** — Added `_auctionSpentTotal(rosterId)` helper.
24. **Auction — commissioner nomination** — `canNominate()` returns `true` for commish so 🏷 button always shows.
25. **Auction — Quick Nominate modal** — Commissioner-only shortcut on the Live tab toolbar.
26. **Auction — nomination close controls** — New `scheduledEnd` and `nominationsClosed` settings.
27. **Players tab — commissioner always sees nominate button** — `DLRFreeAgents` now tracks `_isCommish`.
28. **Players tab — compact status badges** — R/A/C letter badges (26×26px).
29. **Draft — multi-draft selector** — Sleeper leagues with multiple drafts now show a pill selector bar.
30. **Draft — aborted draft filter** — Drafts with fewer picks than one full round are excluded.

## Completed — April 13, 2026 Session (MFL overhaul)

31. **Worker — bundle reliability** — Removed `schedule`, `scoreboard`, `salaries`, `players` from bundle. Added `liveScoring`, `playoffBrackets`. All endpoints now use safe JSON parsing (`r.text()` + try/catch) — `"No"` responses from MFL no longer cause Worker 500 errors.
32. **Worker — new on-demand endpoints** — `/mfl/liveScoring` (week picker), `/mfl/playoffBracket` (bracket fetcher), `/mfl/players` (player universe), `/mfl/login` (cookie reuse).
33. **Worker — userLeagues reliability** — Now uses `SINCE=1999` single request (one call instead of 27). Falls back to batched year-by-year if needed. Safe JSON parsing throughout.
34. **Worker — bundle batching** — Bundle fetches batched 3 at a time with 200ms gap + one auto-retry per league.
35. **mfl.js — liveScoring matchups** — `normalizeMatchups()` now reads `bundle.liveScoring` shape. Added `normalizeLiveScoring()` for per-player starter/bench breakdown.
36. **mfl.js — playoff support** — `normalizePlayoffBrackets()`, `normalizePlayoffBracketResult()`, `getLiveScoring()`, `getPlayoffBracket()`.
37. **mfl.js — player universe cache** — `getPlayers(year)` fetches once per session, cached in memory + sessionStorage. `getRoster()` now async, returns `sleeperId` on each player.
38. **mfl.js — login helper** — `login()` returns cookie for reuse across bundle calls.
39. **standings.js — MFL matchups** — On-demand per-week fetch via `_mflLoadWeek()` with spinner + cache.
40. **standings.js — MFL playoffs** — Full bracket renderer using `playoffBrackets` + `playoffBracket` APIs. Multi-bracket pill selector. `bracket-slot--me` highlights user's team.
41. **standings.js — Guillotine leagues** — Detected via `franchise_eliminated` on standings entries. Distinct from eliminator. Renders `⚔️ Out Wk X` badge, `Survivor ★` for last team standing. `standings-row--eliminated` CSS class with 0.6 opacity.
42. **analytics.js — Full MFL tab parity** — All 5 tabs (Power Rankings, Luck Index, Trade Map, Draft Recap, Waivers) working for MFL using bundle data. Luck Index fetches all weeks of liveScoring in parallel.
43. **draft.js — MFL multi-set selector** — Multiple draft units (startup + rookie) and multiple auction result sets each get a pill selector. Auction results list-only sorted by price. Draft gets grid/list toggle.
44. **roster.js — player name resolution** — Uses `MFLAPI.getPlayers()` session cache. `mflPlayerLookup` simplified to read already-resolved `name`/`sleeperId` from roster entries.
45. **profile.js — import reliability** — Login once, reuse cookie. Batch 3 leagues at a time. One retry per failed bundle. Live progress updates (`onProgress` callback). Skipped league count shown in UI. Merge with existing Firebase data using `GMDB.getLeagues()`.
46. **app.js — import feedback** — Progress messages update `statusEl` during import. Final message shows skipped count if any leagues failed to load.
47. **Survivor pool filter removed** — These leagues ARE imported (was incorrectly filtering them out).
48. **Guillotine league detection** — `isGuillotine` stored on league record in Firebase, detected from standings entries.

---

## Roadmap — What's Left

### 🔴 Critical — Next Session
- [ ] **MFL tab Worker 500 errors** — Players, draft, and rosters tabs returning `MFL Worker 500`. Root cause unknown — likely a bundle endpoint issue or a mismatch between the `myRosterId` stored in Firebase and what the tab modules pass to the worker. Need to audit the full data flow: Firebase league record → tab `init()` → `getLeagueBundle()` → render path. Start by attaching `roster.js`, `draft.js`, `rules-and-fa.js`, and `worker.js` and checking what parameters are being sent and what the worker returns.
- [ ] **MFL standings/matchups/playoffs — inconsistent data + roster ID mismatch** — Tabs sometimes render with wrong team highlighted or no data. `myRosterId` (4-digit franchise ID e.g. `"0035"`) must be threaded correctly through every tab init call. Audit: `profile.js → openLeagueDetail()` → tab init args → module use of `_myRosterId`.

### High Priority
- [ ] **Yahoo end-to-end test** — OAuth requires non-blocked network; test all tabs once available
- [ ] **Career stats accuracy** — Verify cross-platform totals are correct
- [ ] **MFL historical seasons import verification** — Confirm multi-year dynasty chaining works with `mfl__<league_id>` key

### Medium Priority
- [ ] **Auction History tab cleanup** — Minor display issues noted
- [ ] **Draft board — Yahoo** — Grid/list toggle ready; needs Yahoo data tested
- [ ] **Analytics — Yahoo** — Not connected
- [ ] **Matchups tab for Yahoo** — Not built

### Low Priority / Future Features
- [ ] **Sticky notes in Hallway UI**
- [ ] **Commissioner trophy builder**
- [ ] **Tournament bracket feature**

---

## Tips for Starting a New Claude Chat

### What to paste at the start of a new chat:
1. **This document** — paste the full text or attach as a file
2. **The specific file(s)** you want to work on — Claude can't access GitHub directly but can read files you paste or upload
3. **A brief description of what you want to do**

### How to set context efficiently:
```
I'm working on Dynasty Locker Room (DLR), a fantasy football SPA at dynastylockerroom.com.
Repo: mraladdin23/gm-dynasty (GitHub Pages).
Stack: Vanilla JS, Firebase Realtime DB, Cloudflare Worker (mfl-proxy.mraladdin23.workers.dev).
Platforms: Sleeper (fully working), MFL (mostly working), Yahoo (partial).
[Attach DLR_PROJECT_SUMMARY.md]
Today I want to work on: [specific task]
Here is the relevant file: [attach file]
```

### For the next session (MFL tab 500 errors):
Attach these files: `worker.js`, `roster.js`, `draft.js`, `rules-and-fa.js`, `profile.js`
Tell Claude: *"The players, draft, and rosters tabs are returning MFL Worker 500 errors. The standings, matchups, and playoffs tabs are inconsistent and sometimes don't match roster IDs. Please audit the full data flow and fix."*

### What NOT to do:
- Don't paste 10 files at once — Claude works best with 1-3 files at a time
- Don't ask Claude to "continue from where we left off" without context — it won't know
- Do paste the specific file you want changed — Claude can't pull from GitHub

---

## About Computer Lag / Usage Limits

**Why chats get slow:**
- Long conversations accumulate a large context window — every message Claude sends requires processing the entire conversation history
- After ~50-100 exchanges, responses noticeably slow down
- Claude has a hard context limit; very long chats eventually get compacted (you'll see a summary at the top)

**Best practices for new chats:**
1. **Start a new chat for each distinct feature** — e.g. one chat for "fix MFL tab 500 errors", another for "fix matchups tab"
2. **Keep file pastes focused** — only paste the file(s) directly relevant to the task
3. **Save your work frequently** — after each fix, commit to git immediately so you never lose progress
4. **Use this summary doc** — paste just the relevant sections, not the whole thing, when context allows

**Reducing token usage:**
- Ask Claude to "just give me the changed lines" rather than full file rewrites when changes are small
- Ask for syntax check only (`node --check`) rather than running the full file
- For large files (profile.js is ~2000 lines), paste only the relevant function, not the whole file

---

*Document updated: April 13, 2026*
*Files updated this session: worker.js, mfl.js, standings.js, analytics.js, draft.js, roster.js, profile.js, app.js*
