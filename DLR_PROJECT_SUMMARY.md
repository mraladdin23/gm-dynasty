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
| `mfl.js` | MFL API helpers. Exports: `login()`, `getLeagueBundle()`, `getTeams()`, `getStandingsMap()`, `getRoster()`, `getPlayers()` (session-cached, v2 key), `normalizeMatchups()`, `normalizeLiveScoring()`, `normalizePlayoffBrackets()`, `normalizePlayoffBracketResult()`, `getLiveScoring()`, `getPlayoffBracket()`, `getLeagueInfo()`, `getStarterSlots()`, `assignStartersToSlots()`, `getAliveTeamsForWeek()`, `getDivisions()`, `getFranchiseDivision()`, `getDivisionFranchises()`, `filterStandingsByDivision()`, `getMyDraftUnitIndex()`, `debugBundle()` |
| `yahoo.js` | Yahoo OAuth token management, `getLeagueBundle` |
| `sleeper.js` | Sleeper API wrappers |
| `standings.js` | Standings, Matchups, Playoffs tabs — cross-platform. MFL bundle cached in `_mflBundle` after first tab load; reused by matchups + playoffs. Week range for eliminator/guillotine leagues derived from standings `weekEliminated` values (reliable) rather than guessed league API field names. Division filter bar with persistent selection. `assignStartersToSlots` used for slot-ordered matchup breakdown. Eliminated teams filtered per-week via `getAliveTeamsForWeek()`. Guillotine final week resolved by pre-fetching the correct week's liveScoring at standings init. |
| `roster.js` | Roster tab — cross-platform (Sleeper/MFL/Yahoo). MFL: player universe pre-loaded via `MFLAPI.getPlayers()`, `_players` populated with `mfl_`-keyed stubs from `DLRPlayers.getFullPlayer()` for position grouping (QB/RB/WR/TE/K/DEF) and rank sorting. `_playerRowHTML()` unified for all platforms. |
| `draft.js` | Draft board — multi-draft selector (startup + rookie), grid/list toggle, MFL auction board, Sleeper snake/linear. MFL multi-set selector defaults to user's division unit via `MFLAPI.getMyDraftUnitIndex()`. Division labels resolved from `DIVISION00`/`DIVISION01` unit field pattern. Aborted drafts (< 1 full round) filtered out. Custom players (pick proxies) detected by name pattern only. |
| `transactions.js` | Transactions tab — all platforms normalized to Sleeper shape. MFL `mflPid()` resolver uses `entry.sleeperId` (pre-resolved via CSV), then `DLRPlayers.getFullPlayer()` for bio fallback. |
| `analytics.js` | Analytics tab — Sleeper fully working. MFL: full 5-tab parity (Power Rankings, Luck Index, Trade Map, Draft Recap, Waivers). Yahoo incomplete. |
| `rules-and-fa.js` | League Rules tab + Players/Free Agents tab. MFL: IR/Taxi tracked via `irIds`/`taxiIds` Sets from `MFLAPI.getRoster()` `p.status`; shown as 🏥 IR / 🚕 Taxi badge. Player photo resolved via `DLRPlayers.getSleeperIdFromMfl()` first. |
| `salary.js` | Salary cap module. FAAB multiplier, auto-tracking transactions (cross-platform), taxi squad promotion badges. `reconcileAuctionWins()` runs on every `init()` to heal any auction wins that were claimed before the module was loaded (timing gap fix). |
| `auction.js` | DLR auction system. Proxy bid engine, night pause, auto-claim, bid history log. History tab: sort by date/price/name, team filter dropdown, CSV export, pagination (25 rows/page). Commissioner quick-nominate modal, cap checks, nomination close/end-date controls. |
| `players-db.js` | Cross-platform player DB. Loads Sleeper player DB (IndexedDB-backed) **and** DynastyProcess `db_playerids.csv` mappings (`byMfl`, `byYahoo`, `bySleeper`). CSV rows without a valid `birth_date` are skipped to eliminate legacy duplicate entries (e.g. retired players sharing a name with current players). `MAPPINGS_VERSION = "2026-04b"`. `getFullPlayer(platformId, platform)` returns best available object. `getSleeperIdFromMfl(mflId)` is the primary ID resolution path. |
| `idb-cache.js` | IndexedDB wrapper (`dlr_cache` DB, `kvstore` store, v2). Stores Sleeper player DB and DynastyProcess mappings. Fallback to localStorage on error. |
| `playercard.js` | Player card modal. `show(playerId, playerName)` accepts any ID format (Sleeper, `mfl_XXXX`). Resolves `_statsId` via `DLRPlayers.getSleeperIdFromMfl()`. Stats/photo always use `_statsId`. Clean "No Sleeper stats available" message when no mapping exists. |
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

### MFL ✅ Fully working
All tabs functional: overview, standings (standard + eliminator + guillotine + division filter), matchups (slot-ordered side-by-side, eliminated teams filtered per week, correct week range), playoffs (bracket renderer), roster (player names, photos, IR/Taxi sections), draft (multi-division sets, pick proxies/custom players), transactions, players tab (photos, IR/Taxi badges, bio), analytics (all 5 tabs), salary cap, auction/salary board.

**Key architecture:**
- `myRosterId` is the 4-digit zero-padded franchise ID (e.g. `"0035"`)
- Player name/photo resolution uses DynastyProcess CSV mappings (`DLRPlayers.getSleeperIdFromMfl()`) as the primary path. CSV rows without a birthdate are excluded to avoid legacy duplicates.
- `getPlayers()` session cache is versioned as `mfl_players_v2_...` to bust stale data
- Eliminator/guillotine week range derived from `weekEliminated` in normalized standings — does not rely on guessed `league.league` field names
- `assignStartersToSlots()` is inside the MFLAPI IIFE (has access to `_normalizeMFLPos`); `displaySlot` stays as slot label (SF/FLEX), not player position

### Yahoo ⚠️ Partial
- OAuth flow implemented in worker
- Basic bundle (standings, rosters, draft, transactions) built
- Most tabs render but not fully tested end-to-end; analytics not connected; matchups tab not built

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
// NOTE: players (TYPE=players) NOT in bundle — fetched on-demand via /mfl/players,
// cached in sessionStorage as mfl_players_v2_{year}_{leagueId}.
// Custom players (pick proxies like "2025 Rookie, 4.01") detected by name pattern only
// (NOT by ID range — real retired players have low IDs like 0804).
```

### MFL divisions (multi-division leagues)
```js
// league.league.divisions.division — array of { id, name }
// Each franchise has a `division` attribute matching a division id
// draftUnit entries have a `unit` field like "DIVISION00", "DIVISION01" —
//   strip prefix and match numeric ID to division names in divNameMap
// MFLAPI helpers: getDivisions(), getFranchiseDivision(), getDivisionFranchises(),
//   filterStandingsByDivision(), getMyDraftUnitIndex()
// standings.js shows user's division by default with "All Teams" toggle
```

### MFL worker endpoints
```
POST /mfl/userLeagues    — login + fetch all leagues (uses SINCE=1999 single request, falls back to batched)
POST /mfl/login          — login only, returns cookie for reuse
POST /mfl/bundle         — full league bundle (accepts cookie to skip re-login)
POST /mfl/liveScoring    — single week liveScoring on-demand (W= param)
POST /mfl/playoffBracket — single bracket result on-demand (BRACKET_ID= param)
POST /mfl/players        — full MFL player universe (session-cached client-side, includes league-custom players via &L= param)
POST /mfl/rosters        — week-specific rosters for accurate IR/Taxi status
```

### League type detection
- **Eliminator:** `league.league.franchises_eliminated` present → teams eliminated in order, players stay rostered
- **Guillotine:** `franchise_eliminated` on individual standings entries → lowest scorer eliminated weekly, players return to FA
- **Overall-points:** `standingsSort` starts with "PF", "POINTS", or "OVERALL" — no head-to-head matchups

### MFL starter slots (`getStarterSlots` / `assignStartersToSlots`)
```js
// getStarterSlots(bundle) — parses league.league.starters config into ordered slot array
//   count may be a range like "7-10" — uses the max
//   SF slot generated when QB has limit="1-2" (min < max) or limit="0-1"
//   Returns: ["QB","RB","RB","WR","WR","WR","TE","SF","FLEX","FLEX","FLEX"]

// assignStartersToSlots(slots, players, playerLookup) — greedy 3-pass assignment
//   Pass 1: fill named slots (QB, RB, WR, TE, K…) in order
//   Pass 2: fill SF slots — QBs first, then RB/WR/TE fallback
//   Pass 3: fill FLEX with whatever remains
//   displaySlot stays as slot label ("SF", "FLEX") — NOT overwritten with player position
//   MUST be inside the MFLAPI IIFE to access _normalizeMFLPos
```

### DynastyProcess player mappings (`players-db.js`)
```js
// Fetched from: https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv
// Cached in IndexedDB under key "dlr_player_mappings", version "2026-04b"
// Rows without a valid birth_date are SKIPPED — eliminates legacy duplicate entries
// Shape: { byMfl: {mflId → entry}, byYahoo: {yahooId → entry}, bySleeper: {sleeperId → entry} }
// Entry fields: sleeper_id, mfl_id, yahoo_id, name, position, team, age, height, weight, college, draft_year

DLRPlayers.load()                    // loads both Sleeper DB + CSV mappings (IDB-backed)
DLRPlayers.getFullPlayer(id, "mfl")  // best available player object — Sleeper if mapped, CSV bio otherwise
DLRPlayers.getSleeperIdFromMfl(id)   // primary ID resolution — used by roster, players tab, playercard
DLRPlayers.getByMflId(id)            // raw CSV mapping entry
DLRPlayers.formatBio(p, mapping)     // age · height · weight · college · experience
```

---

## Worker Architecture Notes

### Session cookie reuse
`linkMFL` in `profile.js` calls `/mfl/login` once at the start of import, then passes the cookie to all `/mfl/bundle` calls. Avoids 28 separate logins for 28 leagues.

### Bundle fetch batching
Leagues are fetched in batches of 3 with 200ms between batches. Each bundle gets one automatic retry after 600ms if it fails or returns an empty `league.league.name`.

### Safe JSON parsing
All MFL API responses go through `r.text()` then `JSON.parse()` in a try/catch. MFL returns plain text `"No"` for endpoints that don't apply to a league (e.g. `auctionResults` on a snake draft league).

### Player universe caching
`MFLAPI.getPlayers(year, leagueId)` fetches `TYPE=players&L={leagueId}` once per session. Cached in memory (`_playersMemCache`) and `sessionStorage` keyed by `mfl_players_v2_{year}_{leagueId}`. The `v2` prefix busts stale caches that were built with the old broken `isCustom` detection. Always pass `leagueId` to include league-custom players (pick proxies).

### Bundle reuse across tabs
`standings.js` stores the full MFL bundle in `_mflBundle` after first load. Matchups and playoffs tabs check this cache before fetching.

---

## Network / Infrastructure Notes

- **Home router** blocks `workers.dev` and `firebaseio.com` WebSocket — use mobile data or disable router security for MFL/Yahoo testing
- **Firebase long-polling** fallback works on home network (WebSocket blocked but REST works)
- **Mobile fix (partial):** `auth.js` has 8-second timeout on `onAuthStateChanged`. `firebase-db.js` has 8-second `AbortController` on all `fetch()` calls. `index.html` has 10-second global safety net. **Viewport zoom issue and auth loop on mobile still open** — see Roadmap.
- **CDN:** Firebase SDK loaded at bottom of `<body>` (not `<head>`) — prevents mobile blank screen while SDK downloads

---

## Roadmap — Open Issues

### 🔴 Next Priority

**Mobile — Viewport zoom + auth loop**
On mobile the screen zooms in on input focus and auth state may re-check in a loop. Fix: add `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">` to `index.html`. Audit `auth.js` for redundant `onAuthStateChanged` triggers (check `hallway.js` too — it may register its own listener).
Files to attach: `index.html`, `auth.js`, `hallway.js`

**Yahoo — End-to-end tab completion**
OAuth flow works. Need to build/test: matchups tab (not built), analytics (not connected), and verify standings/roster/draft/transactions end-to-end once OAuth is accessible on a non-blocked network.
Files to attach: `yahoo.js`, `standings.js`, `analytics.js`

### Medium Priority
- [ ] Career stats accuracy — verify cross-platform totals are correct
- [ ] Draft board — Yahoo — grid/list toggle ready; needs Yahoo data tested
- [ ] Yahoo matchups tab — not built

### Low Priority / Future Features
- [ ] Sticky notes in Hallway UI
- [ ] Commissioner trophy builder
- [ ] Tournament bracket feature (separate from multi-division leagues)

---

## Tips for Starting a New Claude Chat

1. **Attach this document** + **the specific file(s)** you want to work on
2. **Describe what you want** — Claude can't pull from GitHub

### Standard context block:
```
I'm building Dynasty Locker Room (DLR), a fantasy football SPA at dynastylockerroom.com.
Repo: mraladdin23/gm-dynasty (GitHub Pages).
Stack: Vanilla JS, Firebase Realtime DB, Cloudflare Worker (mfl-proxy.mraladdin23.workers.dev).
Platforms: Sleeper ✅, MFL ✅, Yahoo ⚠️ partial.
[Attach DLR_PROJECT_SUMMARY.md]
Today I want to work on: [specific task]
Here are the relevant files: [attach files]
```

### For the mobile session:
Attach: `index.html`, `auth.js`, `hallway.js`
Ask: *"On mobile the screen zooms in on input focus and auth state may loop. Add the viewport meta tag and audit auth.js / hallway.js for redundant onAuthStateChanged listeners."*

### For the Yahoo session:
Attach: `yahoo.js`, `standings.js`, `analytics.js` (and any other tab file needed)
Ask: *"Yahoo OAuth works. I need to build the matchups tab and connect analytics. Here's what Sleeper's versions look like for reference — match that format."*

### Tips:
- Don't paste 10 files at once — Claude works best with 1–3 files at a time
- Don't ask Claude to "continue from where we left off" without context — it won't know
- For large files (profile.js ~2000 lines), paste only the relevant function if the task is narrow
- Commit to git after each fix so you never lose progress

---

## Completed Sessions Log (Summary)

**April 10:** Mobile auth fixes, MFL player matching, transactions, overview, draft board, auction proxy/timer/auto-claim/history, salary cap, players tab, DNS rollback.

**April 12:** MFL identity overhaul (franchise_id based, dynasty chain key `mfl__<league_id>`), removed email matching infrastructure.

**April 12–13:** Auction overhaul (bid log, cap calculation, pass button removal, Force Full Roster, Quick Nominate modal, nomination close controls). Draft multi-selector, aborted draft filter.

**April 13:** MFL bundle reliability (safe JSON parsing, liveScoring + playoffBrackets added, players removed from bundle). New worker endpoints. MFL matchups/playoffs/analytics. Division support. Bundle caching across tabs.

**April 13 (fixes):** Worker 500 fixes. `getPlayers()` session cache. `setLeague()` myRosterId parameter. `_mflLiveScoringCache` reset on league change.

**April 14:** DynastyProcess CSV player mappings. `getFullPlayer()` / `getSleeperIdFromMfl()` as primary ID resolution. MFL roster/players/transactions/playercard unified around CSV mappings.

**April 15 (session 1):** MFL draft division labels (DIVISION00/01 → real names). Custom player detection by name pattern. `getStarterSlots` range count + SF detection fixes. `assignStartersToSlots` inside IIFE fix. `isCustom` fix (name pattern not ID range). Session cache version bumped to v2. Auction history pagination + sort. Eliminator team filtering per week (`getAliveTeamsForWeek`). `isOverallPoints` added to `getLeagueInfo`. No-roster matchup cards use slot ordering.

**April 15 (session 2):** Guillotine week range via `weekEliminated` in standings (not guessed league API fields). Guillotine final week pre-fetched before standings render. Matchups default week = `currentWeek` for special leagues. `displaySlot` fixed to show "SF"/"FLEX" not player position. `players-db.js` birthdate filter for duplicate CSV entries (MAPPINGS_VERSION `2026-04b`). Auction history team filter + CSV export. `salary.js` `reconcileAuctionWins()` for timing gap fix.

---

*Document updated: April 15, 2026*
*MFL: fully working. Next: mobile fixes + Yahoo completion.*
