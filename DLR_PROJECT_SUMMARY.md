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
| `firebase-db.js` | All Firebase Realtime DB reads/writes. Uses REST API with 8-second `AbortController` timeouts on all fetches. |
| `profile.js` | League card grid, franchise history, league detail panel, MFL/Yahoo import (`linkMFL`, `linkYahoo`), overview tab live-fetch |
| `mfl.js` | MFL API helpers: `getLeagueBundle`, `getTeams`, `getStandingsMap`, `getRoster`, `getPlayerScores`, `mflNameToSleeperId` (skill pos only: QB/RB/WR/TE) |
| `yahoo.js` | Yahoo OAuth token management, `getLeagueBundle` |
| `sleeper.js` | Sleeper API wrappers |
| `standings.js` | Standings tab — cross-platform |
| `roster.js` | Roster tab — cross-platform (Sleeper/MFL/Yahoo) |
| `draft.js` | Draft board — grid/list toggle, MFL auction board, Sleeper snake/linear |
| `transactions.js` | Transactions tab — all platforms normalized to Sleeper shape, `status=complete` filter only |
| `analytics.js` | Analytics tab (Sleeper power rankings; MFL/Yahoo incomplete) |
| `rules-and-fa.js` | League Rules tab + Players/Free Agents tab. Year selector for stats (2020–current). MFL uses Sleeper bio via `_sleeperId` mapping. |
| `salary.js` | Salary cap module. FAAB multiplier, auto-tracking transactions (cross-platform), taxi squad promotion badges. |
| `auction.js` | DLR auction system. Proxy bid engine, night pause, auto-claim, bid history log. |
| `players-db.js` | Sleeper player DB loader (IndexedDB-backed via `idb-cache.js`) |
| `idb-cache.js` | IndexedDB wrapper for caching player DB and stats |
| `playercard.js` | Player card modal (Sleeper CDN photos) |
| `playerreport.js` | Cross-league player report panel |
| `chat.js` | League chat (Firebase Realtime DB) |
| `hallway.js` | The Hallway social feature |
| `trophy-room.js` — Trophy room display |
| `leaguegroups.js` | League grouping/commissioner tools |
| `manager-search.js` | Cross-league manager search |
| `config.js` | Firebase config (in `firebase/config.js`) |

---

## Platform Integration Status

### Sleeper ✅ Fully working
All tabs functional: overview, standings, roster, draft, transactions, players, analytics, salary cap, auction.

### MFL ⚠️ Mostly working, some gaps
- **Working:** Import (franchise_id based), league cards, overview (live fetch), standings, roster (Sleeper photo mapping), transactions (normalized to Sleeper format), draft board (grid + list), auction/salary board, players tab (Sleeper bio + MFL pts), salary cap
- **Known issues:**
  - Some worker bundle endpoints may be broken causing incomplete league downloads — needs investigation
  - Matchups tab uses two endpoints (`TYPE=schedule` + `TYPE=scoreboard` fallback) — needs to be simplified to a single reliable endpoint
  - Playoffs/bracket tab not built
  - Analytics tab not connected
- **Identity matching:** Uses `franchise_id` + `league_id` from `TYPE=myleagues` API response — no email matching. `franchise_id` is the authoritative 4-digit zero-padded user↔franchise link (e.g. `"0035"`).

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
    settings                  — bidDuration, pauseStart, pauseEnd, etc.
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
  mflEmail: "user@email.com",   // primary email used for login
  mflUsername: "user",          // username prefix (derived from email)
}
// NOTE: mflAdditionalEmails has been removed — identity is now franchise_id based, not email based
```

### MFL league key structure
```
League key in Firebase:   mfl_{season}_{leagueId}     e.g. "mfl_2024_22796"
Dynasty chain key:        mfl__{leagueId}              e.g. "mfl__22796"
  └── Same league_id across all years chains seasons together automatically.
      This replaced the old normalized-league-name approach.

myRosterId:               franchise_id from myleagues  e.g. "0035"
  └── This is the 4-digit zero-padded franchise ID — same as the `id` field
      on every franchise/roster/standings object in all bundle API calls.
      Set once at import from myleagues; never re-derived from email matching.
```

### Auction bid record shape
```js
{
  id, playerId, playerName, nominatedBy,
  proxies: { rosterId: maxBid },     // hidden max bids
  leaderId, displayBid,              // displayBid = second-highest proxy (authoritative, set by placeBid transaction)
  expiresAt, bidCount,
  processed, cancelled, winner, winningBid, claimedAt
}
```

**Proxy auction rules:**
- Challenger bid > displayBid but ≤ champion proxy → `displayBid = challenger bid`, champion still leads
- Challenger bid > champion proxy → challenger leads, `displayBid = prior champion proxy + MIN_INC`
- Champion adjusting own proxy → displayBid unchanged
- `MIN_INC` = `MIN_BID` = `$100,000` (configurable via settings)

---

## Auction System — Critical Details

- `_computeLeader(a)` reads stored `a.displayBid` — does NOT recompute from proxies
- `placeBid()` uses a Firebase transaction to atomically set `proxies`, `leaderId`, `displayBid`, `expiresAt`
- Auto-claim runs on every Firebase snapshot update AND every 30s interval (commish only)
- Auto-claim now processes expired auctions even during pause window (previously skipped them, leaving auctions stuck as "Expired")
- Night pause: `pauseStart`/`pauseEnd` in CT. Timer shows `⏸ Xh Ym` (post-pause expiry) not "Paused"

---

## Salary Cap — Critical Details

- Storage key = `franchiseId` (stable across seasons), not `leagueKey`
- FAAB multiplier: `$1 FAAB bid × multiplier = salary` (default $100k per $1 bid)
- Auto-track transactions: polls every 5 min, normalized across all platforms
- Taxi squad: `taxiYears` setting. Badge logic: `years_exp === taxiYears` → ⚠️ Last Year; `years_exp > taxiYears` → 🚨 Promote Now
- MFL/Yahoo players resolve `years_exp` via `_sleeperId` mapping

---

## MFL Player Matching

`MFLAPI.mflNameToSleeperId(rawMFLName, position)`:
- Only indexes QB/RB/WR/TE in Sleeper DB (avoids wrong matches with K/DEF/DL etc.)
- Expects raw MFL format "Last, First" — NOT converted display name
- Returns Sleeper player ID or null
- Cache invalidated on module reset

---

## MFL API — Known Endpoint Issues (Next Session Priority)

The Cloudflare Worker's `/mfl/bundle` endpoint fetches ~11 sub-endpoints in parallel via `Promise.allSettled`. Some of these are suspected broken or returning errors that cause the overall import to fail silently (leagues skipped). The matchups situation specifically needs fixing:

- **Current approach (broken/fragile):** `normalizeMatchups()` in `mfl.js` tries `TYPE=schedule` first (all weeks, home/away), then falls back to `TYPE=scoreboard` (current week only). Both are fetched in every bundle regardless of which is needed.
- **Goal:** Identify which single matchup endpoint is most reliable and simplify to that one. The MFL API has `TYPE=schedule` (full season schedule with scores) and `TYPE=scoreboard` (current week scoreboard). Determine which one consistently returns data and remove the other from the bundle fetch.
- **Also investigate:** Which of the ~11 parallel fetches in `mflBundle()` in `worker.js` are causing failures. Candidates: `TYPE=schedule`, `TYPE=auctionResults`, `TYPE=salaries`. Consider making non-essential endpoints optional/lazy rather than blocking the whole bundle.

Worker endpoint list for reference (in `worker.js` → `mflBundle()`):
```js
league, rosters, standings, schedule, matchups (scoreboard),
players, draft, auctionResults, salaries, transactions, playerScores
```

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
6. **Auction proxy fix** — Correct displayBid formula. displayBid = second-highest proxy (challenger's bid when champion still leads)
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

16. **MFL identity overhaul** — Removed all email-based franchise matching. Identity is now derived entirely from `franchise_id` + `league_id` in the `TYPE=myleagues` API response:
    - `franchise_id` → stored as `myRosterId` (4-digit padded, e.g. `"0035"`) — used to look up roster, standings, team name in every bundle
    - `league_id` → dynasty chain key changed from normalized league name (`mfl__leaguename`) to `mfl__<league_id>` — stable and collision-free across all seasons
    - `teamName` now read from `bundle.league.league.franchises.franchise[id].name` — the authoritative source
    - `syncMFLTeams` simplified: uses stored `myRosterId`, refreshes teamName + record from bundle, no email matching
    - `_resolveMFLIdentities` function deleted (dead code)
    - `_renderOverview` live-fetch simplified: uses stored `myRosterId` only
17. **Removed email matching infrastructure** — deleted `buildEmailList()` and `findMyFranchise()` from `mfl.js` and their exports; removed `mflAdditionalEmails` from Firebase storage, all UI inputs, and all app.js handlers
18. **UI cleanup** — Removed additional emails input from onboarding MFL card and edit profile modal; removed "Save Emails Only" button; simplified `linkMFL` to email + password only; updated field hints and resync banner text

---

## Roadmap — What's Left

### High Priority
- [ ] **MFL bundle endpoint audit** — Identify which parallel fetches in `worker.js → mflBundle()` are failing and causing leagues to be skipped on import. Make non-essential endpoints (auctionResults, salaries, schedule) non-blocking.
- [ ] **MFL matchups endpoint fix** — Simplify `normalizeMatchups()` in `mfl.js` to use a single reliable endpoint instead of `TYPE=schedule` + `TYPE=scoreboard` fallback. Determine which one consistently returns data.
- [ ] **MFL analytics tab** — Power rankings and points leaders not connected
- [ ] **Yahoo end-to-end test** — OAuth requires non-blocked network; test all tabs once available
- [ ] **Career stats accuracy** — Verify cross-platform totals are correct
- [ ] **MFL historical seasons import verification** — Confirm multi-year dynasty chaining works with new `mfl__<league_id>` key

### Medium Priority
- [ ] **Playoffs / bracket tab** — Not built for any platform
- [ ] **Auction History tab cleanup** — Minor display issues noted
- [ ] **Draft board — Yahoo** — Grid/list toggle ready; needs Yahoo data tested
- [ ] **Analytics — Yahoo** — Not connected

### Low Priority / Future Features
- [ ] **Sticky notes in Hallway UI**
- [ ] **Commissioner trophy builder**
- [ ] **Tournament bracket feature**
- [ ] **Matchups tab for Yahoo**

---

## Tips for Starting a New Claude Chat

### What to paste at the start of a new chat:
1. **This document** — paste the full text or attach as a file
2. **The specific file(s)** you want to work on — Claude can't access GitHub directly but can read files you paste or upload
3. **A brief description of what you want to do** — e.g. "Fix MFL bundle endpoints" or "Fix MFL matchups tab"

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
1. **Start a new chat for each distinct feature** — e.g. one chat for "fix MFL bundle endpoints", another for "fix matchups tab"
2. **Keep file pastes focused** — only paste the file(s) directly relevant to the task
3. **Save your work frequently** — after each fix, commit to git immediately so you never lose progress
4. **Use this summary doc** — paste just the relevant sections, not the whole thing, when context allows

**Reducing token usage:**
- Ask Claude to "just give me the changed lines" rather than full file rewrites when changes are small
- Ask for syntax check only (`node --check`) rather than running the full file
- For large files (profile.js is ~2000 lines), paste only the relevant function, not the whole file

---

*Document updated: April 12, 2026*
*Current deployed versions: CSS v=19, JS files updated April 12 (profile.js, mfl.js, app.js, index.html)*
