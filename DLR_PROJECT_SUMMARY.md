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
  - Deployed by **pasting into Cloudflare dashboard editor** (no wrangler.toml)
  - Custom domain `api.dynastylockerroom.com` was configured but is NOT used in code
  - All code references `mfl-proxy.mraladdin23.workers.dev` directly
- **DNS:** GoDaddy nameservers (moved from Cloudflare — Cloudflare proxy broke Firebase mobile auth)

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
- `index.html` — Full SPA shell. All screens defined here. Firebase SDK loaded at bottom of body. CSS cache-busted at v=19.
- `worker.js` — Cloudflare Worker. MFL bundle fetches, Yahoo OAuth flow. Deploy by pasting into Cloudflare dashboard.

### `css/`
- `base.css` — Global variables, reset, typography
- `auth.css` — Login/register screen styles
- `locker.css` — All app UI styles. v=19.

### `js/` — Core modules (all vanilla JS IIFEs)

| File | Purpose |
|------|---------|
| `app.js` | Orchestrates screens, auth state, global monitors, button handlers |
| `auth.js` | Firebase Auth wrapper. 8-second timeout on auth state to prevent mobile hang. |
| `firebase-db.js` | All Firebase Realtime DB reads/writes. REST API with 8-second AbortController timeouts. `saveLeagues` uses `.update()` (merge). |
| `profile.js` | League card grid, franchise history, league detail panel, MFL/Yahoo/Sleeper import. Background identity resolution for all platforms. `resolved` flag system for historical league caching. |
| `mfl.js` | MFL API helpers. Full set of normalizers for standings, matchups, brackets, drafts. |
| `yahoo.js` | Yahoo OAuth token management, `getLeagueBundle`, `normalizeBundle` |
| `sleeper.js` | Sleeper API wrappers. `importUserLeagues` handles full import with playoff detection. `getPlayoffFinish` detects 1st/2nd/3rd from winners bracket. |
| `standings.js` | Standings, Matchups, Playoffs tabs — cross-platform. MFL bundle cached in `_mflBundle`. Yahoo matchups: week pills + roster detail expand. Yahoo playoffs: filtered to championship bracket only via `playoffTeamSet`. |
| `roster.js` | Roster tab — cross-platform. PREFERRED_ORDER position grouping. |
| `draft.js` | Draft board — multi-draft selector, grid/list/auction toggle, 25/page pagination (all platforms). Yahoo: grid + list + auction views, DynastyProcess player enrichment. |
| `transactions.js` | Transactions tab — all platforms. 25/page pagination. Yahoo: team name from moves[], DEF player name resolution, detailMap bio fallback. |
| `analytics.js` | Analytics tab — Sleeper + MFL fully working. Yahoo: leagueKey wired, partial. |
| `rules-and-fa.js` | League Rules + Players/Free Agents tab. |
| `salary.js` | Salary cap module. |
| `auction.js` | DLR auction system. |
| `players-db.js` | Cross-platform player DB. DynastyProcess CSV mappings. `MAPPINGS_VERSION = "2026-04b"`. |
| `idb-cache.js` | IndexedDB wrapper. |
| `playercard.js` | Player card modal. |
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
All tabs functional. Playoff finish detected at import via `getPlayoffFinish()`.
Past complete seasons marked `resolved: true` at import. Background `_resolveSleeperIdentities`
backfills `playoffFinish` for leagues imported before detection was added.

### MFL ✅ Fully working
All tabs functional: standings (standard + eliminator + guillotine + division filter),
matchups (slot-ordered side-by-side), playoffs (bracket renderer), roster, draft,
transactions, players, analytics, salary cap, auction.

**Championship detection:** `_detectMFLPlayoffFinish` — bracket leagues use
`MFLAPI.getPlayoffBracket` + score comparison (not `won` flag which is unreliable).
No-bracket/guillotine leagues fall back to standings rank ≤ 8. Runs at import
(`fetchBundle`) and background sync (`syncMFLTeams`). Past seasons marked `resolved`.

**Key architecture:**
- `myRosterId` is 4-digit zero-padded franchise ID (e.g. `"0035"`)
- Player resolution via DynastyProcess CSV (`getSleeperIdFromMfl()`)
- `getPlayers()` session cache versioned as `mfl_players_v2_...`
- Eliminator/guillotine week range from `weekEliminated` in standings

### Yahoo ⚠️ Mostly working
- OAuth flow ✅
- Standings ✅ (CSS matches MFL/Sleeper exactly)
- Matchups ✅ (week pills + roster expand detail)
- Playoffs ✅ (bracket filtered to championship teams only)
- Roster ✅
- Players tab ✅ (YTD stats via `/yahoo/playerStats` worker endpoint)
- Draft ✅ (grid + list + auction, pagination)
- Transactions ✅ (team names, player names, DEF resolution, pagination)
- Career stats ✅ (platform tabs added)
- Analytics ⚠️ (leagueKey wired, not fully tested)
- Championship detection ✅ (`playoffTeamSet` filters consolation games)
- Historical caching ✅ (`resolved` flag — but saving to Firebase has intermittent issues)

**Known issues (see DLR_YAHOO_TODO.md):**
- Yahoo data not always saving to Firebase (race condition suspected)
- `resolved` flag may not persist correctly
- `_draftDebug` cleanup still needed in worker.js + draft.js
- `uses_roster_import` not passed through `normalizeBundle` in yahoo.js

---

## Historical League Caching — `resolved` Flag

Past-season leagues are cached in Firebase with `resolved: true` once fully hydrated.
A resolved league is NEVER re-fetched from any platform API.

**A league is marked resolved when:**
- `season < currentYear` (past season)
- `playoffFinish != null` (or confirmed no playoffs)
- `leagueType` is set and not `"redraft"`
- `teamName` is set

**Helpers in `profile.js`:**
```js
_isPastSeason(l)    // true if l.season < currentYear
_isFullyResolved(l) // true if past AND l.resolved === true
_markResolved(l)    // sets resolved=true, corrects isChampion
```

**Per platform:**
- Sleeper: marked at `linkSleeper` import + backfilled by `_resolveSleeperIdentities`
- MFL: marked at `fetchBundle` import + `syncMFLTeams` background sync
- Yahoo: marked after successful `_resolveYahooIdentities` hydration

---

## Key Data Structures

### Firebase paths
```
gmd/
  users/{username}/           — profile, platforms, leagues
  uid_map/{uid}               — uid → username lookup
  leagueMeta/{username}/{leagueKey}  — pinned, archived, teamName, etc.
  auctions/{leagueKey}/       — auction records, bid log, settings
  salaryCap/{storageKey}/     — settings, rosters
  leagueRules/{leagueKey}     — markdown rules text
  chat/{leagueKey}/messages   — chat messages
```

### League key formats
```
Sleeper:  sleeper_{leagueId}           e.g. "sleeper_987654321"
MFL:      mfl_{season}_{leagueId}      e.g. "mfl_2024_22796"
Yahoo:    yahoo_{leagueKey}            e.g. "yahoo_449.l.123456"
MFL dynasty chain key: mfl__{leagueId}
```

### Yahoo bundle (from `YahooAPI.getLeagueBundle`)
```js
{
  leagueMeta: { current_week, end_week, playoff_start_week, num_playoff_teams,
                uses_playoff, is_finished, scoring_type, season, name },
  myTeamId,    // team_id of logged-in user's team
  currentWeek,
  teams[],     // { id, name, ownerName, isMyTeam, faab, clinched }
  standings[], // { teamId, wins, losses, ties, ptsFor, ptsAgainst, rank, playoffSeed, clinched }
  rosters[],   // { teamId, players[], playerDetails[] }
  matchups[],  // current week
  allMatchups, // { [week]: matchups[] } — all weeks including playoffs
  draft[],     // { pick, round, teamId, playerId, name, position, cost }
  transactions[]
}
```

### MFL worker endpoints
```
POST /mfl/userLeagues    — login + fetch all leagues
POST /mfl/login          — login only, returns cookie
POST /mfl/bundle         — full league bundle
POST /mfl/liveScoring    — single week on-demand
POST /mfl/playoffBracket — single bracket result on-demand
POST /mfl/players        — full player universe (session-cached client-side)
POST /mfl/rosters        — week-specific rosters
POST /mfl/auctionResults — auction results on-demand
```

### Yahoo worker endpoints
```
POST /yahoo/leagueBundle  — full normalized bundle
POST /yahoo/playerStats   — YTD fantasy points by player ID
POST /yahoo/leagues       — list user's leagues
GET  /auth/yahoo/login    — OAuth redirect
GET  /auth/yahoo/callback — OAuth callback
POST /auth/yahoo/refresh  — token refresh
```

---

## Network / Infrastructure Notes

- **Home router** blocks `workers.dev` and `firebaseio.com` WebSocket — use mobile data
- **Firebase long-polling** fallback works on home network (REST works, WebSocket blocked)
- **Mobile fix:** `auth.js` 8-second timeout on `onAuthStateChanged`. `firebase-db.js` 8-second AbortController on all fetches. `index.html` 10-second safety net.
- **Cloudflare Worker** deployed by pasting into dashboard editor. Custom domain `api.dynastylockerroom.com` is NOT used in code — all calls go to `mfl-proxy.mraladdin23.workers.dev` directly.

---

## Roadmap — Open Issues

### 🔴 High Priority
- **Yahoo Firebase persistence bug** — resolved leagues not always saving correctly
- **Yahoo `resolved` flag** — may not persist to Firebase (check save order)
- **`_draftDebug` cleanup** — remove from worker.js + draft.js

### 🟡 Medium Priority
- **Yahoo analytics** — leagueKey wired but not fully tested
- **`uses_roster_import`** — not passed through `normalizeBundle` in yahoo.js
- **Career stats accuracy** — verify cross-platform totals

### 🟢 Low Priority / Future
- Sticky notes in Hallway UI
- Commissioner trophy builder
- Tournament bracket feature

---

## Completed Sessions Log

**April 10:** Mobile auth fixes, MFL player matching, transactions, overview, draft, auction, salary cap, players tab, DNS rollback.

**April 12:** MFL identity overhaul (franchise_id based, dynasty chain key `mfl__<league_id>`).

**April 12–13:** Auction overhaul. Draft multi-selector, aborted draft filter.

**April 13:** MFL bundle reliability, new worker endpoints, matchups/playoffs/analytics, division support.

**April 13 (fixes):** Worker 500 fixes. `getPlayers()` session cache. Bundle caching.

**April 14:** DynastyProcess CSV player mappings. `getFullPlayer()` / `getSleeperIdFromMfl()`.

**April 15 (session 1):** MFL draft division labels. Custom player detection. `assignStartersToSlots`. Auction pagination. Eliminator filtering.

**April 15 (session 2):** Guillotine week range. Matchups default week. `displaySlot` fix. Birthdate filter for CSV. Auction CSV export.

**April 15 (session 3):** Mobile viewport zoom fix. `base.css` input font-size fix.

**April 16 (Yahoo mega-session):**
- Draft tab: fixed Yahoo draft parsing (all response shapes), grid+list+auction views, 25/page pagination across all platforms
- Transactions: Yahoo team names, player bios, DEF resolution, 25/page pagination
- Career stats: `_renderCSPlatform` + `_renderCSPlatformYear` added, crash fixed
- Championship detection: `_detectYahooPlayoffFinish` (playoff team set filter, no false champions), `_detectMFLPlayoffFinish` (bracket + standings fallback, score comparison not won flag)
- Yahoo playoffs bracket: filtered to championship teams only
- Yahoo matchups: roster expand detail, clean week pills
- League type detection: MFL + Yahoo both improved
- `resolved` flag system: past leagues cached, never re-fetched
- `_resolveSleeperIdentities`: background backfill for Sleeper playoff finish
- `_draftDebug`: in worker/draft.js — still needs removal

---

## Tips for Starting a New Claude Chat

1. **Attach this document** + **the specific file(s)** you want to work on
2. **Describe what you want** — Claude can't pull from GitHub

### Standard context block:
```
I'm building Dynasty Locker Room (DLR), a fantasy football SPA at dynastylockerroom.com.
Repo: mraladdin23/gm-dynasty (GitHub Pages).
Stack: Vanilla JS, Firebase Realtime DB, Cloudflare Worker (mfl-proxy.mraladdin23.workers.dev).
Worker deployed by pasting into Cloudflare dashboard editor (no wrangler.toml).
Platforms: Sleeper ✅, MFL ✅, Yahoo ⚠️ mostly working.
[Attach DLR_PROJECT_SUMMARY.md + DLR_YAHOO_TODO.md]
Today I want to work on: [specific task]
Here are the relevant files: [attach files]
```

### Tips:
- Don't paste 10 files at once — 1–3 files at a time works best
- Commit to git after each fix
- Test Yahoo on mobile data (home router blocks workers.dev)

---

*Document updated: April 16, 2026*
*MFL: fully working. Sleeper: fully working. Yahoo: mostly working — see DLR_YAHOO_TODO.md.*
