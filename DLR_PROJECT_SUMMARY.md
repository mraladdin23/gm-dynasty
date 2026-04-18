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
- `index.html` — Full SPA shell. All screens defined here. Firebase SDK loaded at bottom of body. CSS cache-busted at v=19. Viewport meta includes `viewport-fit=cover` for PWA safe area support.
- `worker.js` — Cloudflare Worker. MFL bundle fetches, Yahoo OAuth flow + bundle + playerStats + matchupDetail. Deploy by pasting into Cloudflare dashboard.

### `css/`
- `base.css` — Global variables, reset, typography. `.screen` uses `min-height: 100dvh` (with `100vh` fallback).
- `auth.css` — Login/register screen styles
- `locker.css` — All app UI styles. v=19. Mobile: `100dvh` for app-view height, `env(safe-area-inset-top)` for nav + detail panel.

### `js/` — Core modules (all vanilla JS IIFEs)

| File | Purpose |
|------|---------|
| `app.js` | Orchestrates screens, auth state, global monitors, button handlers. Yahoo OAuth callback handled via `#yahoo_token=` hash. |
| `auth.js` | Firebase Auth wrapper. 8-second timeout on auth state to prevent mobile hang. |
| `firebase-db.js` | All Firebase Realtime DB reads/writes. REST API with 8-second AbortController timeouts. `saveLeagues` uses `.update()` (merge). |
| `profile.js` | League card grid, franchise history, league detail panel, MFL/Yahoo/Sleeper import. Background identity resolution for all platforms. `resolved` flag system for historical league caching. `_detectMFLPlayoffFinish` accepts `isGuillotine` param to skip bracket path for eliminator/guillotine leagues. |
| `mfl.js` | MFL API helpers. Full set of normalizers for standings, matchups, brackets, drafts. |
| `yahoo.js` | Yahoo OAuth token management, `getLeagueBundle`, `normalizeBundle`. Token logic: if `expiresAt` is unknown (0), use token optimistically. `hasKeeperPicks` detection from draft data. `uses_roster_import` in leagueMeta. |
| `sleeper.js` | Sleeper API wrappers. `importUserLeagues` handles full import with playoff detection. `getPlayoffFinish` detects 1st/2nd/3rd from winners bracket. |
| `standings.js` | Standings, Matchups, Playoffs tabs — cross-platform. Yahoo matchups: `season-pill` week pills (matching MFL/Sleeper), on-demand `/yahoo/matchupDetail` worker call for player scores. Yahoo playoffs: filtered to championship bracket only via `playoffTeamSet`. |
| `roster.js` | Roster tab — cross-platform. PREFERRED_ORDER position grouping. |
| `draft.js` | Draft board — multi-draft selector, grid/list/auction toggle, 25/page pagination (all platforms). Yahoo: grid + list + auction views, DynastyProcess player enrichment. |
| `transactions.js` | Transactions tab — all platforms. 25/page pagination. Yahoo: team name from moves[], DEF player name resolution, detailMap bio fallback. |
| `analytics.js` | Analytics tab — Sleeper + MFL fully working. Yahoo: leagueKey wired, not fully tested. |
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

### MFL ⚠️ Mostly working — championship detection broken for existing data
All tabs functional. New imports will correctly detect playoff finish for bracket,
eliminator, and guillotine leagues. However, leagues already in Firebase that were
imported before the `isGuillotine` fix (April 17) have stale data and need a reset.

**Championship detection:** `_detectMFLPlayoffFinish(myRosterId, bundle, leagueId, season, isGuillotine)`
- Bracket leagues: `MFLAPI.getPlayoffBracket` + score comparison
- Guillotine/eliminator: skips bracket entirely, uses standings rank (no cap)
- Standard no-bracket: standings rank ≤ 8
- Only runs for past seasons. Runs at import (`fetchBundle`) and sync (`syncMFLTeams`).
- `isGuillotine` and `leagueType !== "redraft"` gates the `resolved` flag

**Key architecture:**
- `myRosterId` is 4-digit zero-padded franchise ID (e.g. `"0035"`)
- Player resolution via DynastyProcess CSV (`getSleeperIdFromMfl()`)
- `getPlayers()` session cache versioned as `mfl_players_v2_...`
- Eliminator/guillotine week range from `weekEliminated` in standings

### Yahoo ⚠️ Mostly working
- OAuth flow ✅
- Standings ✅
- Matchups ✅ (season-pill week bar matches MFL/Sleeper; player score detail via `/yahoo/matchupDetail` worker endpoint — needs live validation)
- Playoffs ⚠️ (bracket filtered to championship teams, but runner-up sometimes shown as 3rd — bug in `_detectYahooPlayoffFinish`)
- Roster ✅
- Players tab ✅ (YTD stats via `/yahoo/playerStats`)
- Draft ✅
- Transactions ✅
- Career stats ✅
- Analytics ⚠️ (leagueKey wired, not fully tested)
- Keeper detection ✅ (`hasKeeperPicks` from draft data + `uses_roster_import`)
- Championship detection ⚠️ (playoff finish logic has runner-up/3rd-place bug)
- Historical caching ⚠️ (`resolved` flag logic fixed but Firebase persistence on mobile needs investigation — tokens not saving to localStorage on some mobile browsers)

---

## Historical League Caching — `resolved` Flag

Past-season leagues are cached in Firebase with `resolved: true` once fully hydrated.
A resolved league is NEVER re-fetched from any platform API.

**A league is marked resolved when:**
- `season < currentYear` (past season)
- `playoffFinish != null`
- `leagueType` is set and not `"redraft"` — OR `isGuillotine === true`
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

### Yahoo bundle (from `YahooAPI.getLeagueBundle` → `normalizeBundle`)
```js
{
  leagueMeta: { current_week, end_week, playoff_start_week, num_playoff_teams,
                uses_playoff, uses_roster_import, is_finished, scoring_type, season, name },
  myTeamId,        // team_id of logged-in user's team
  currentWeek,
  teams[],         // { id, name, ownerName, isMyTeam, faab, clinched }
  standings[],     // { teamId, wins, losses, ties, ptsFor, ptsAgainst, rank, playoffSeed, clinched }
  rosters[],       // { teamId, players[], playerDetails[] }
  matchups[],      // current week
  allMatchups,     // { [week]: matchups[] } — all weeks including playoffs
  draft[],         // { pick, round, teamId, playerId, name, position, cost, isKeeper }
  transactions[],
  hasKeeperPicks,  // true if draft data contains keeper picks
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
POST /yahoo/leagueBundle   — full normalized bundle
POST /yahoo/playerStats    — YTD fantasy points by player ID (batched, 25/req)
POST /yahoo/matchupDetail  — per-player scores for a given week
                             Step 1: scoreboard;week=N → team IDs
                             Step 2: teams;team_keys=.../roster;out=stats;type=week;week=N
POST /yahoo/leagues        — list user's leagues
GET  /auth/yahoo/login     — OAuth redirect
GET  /auth/yahoo/callback  — OAuth callback
POST /auth/yahoo/refresh   — token refresh
```

---

## Network / Infrastructure Notes

- **Home router** blocks `workers.dev` and `firebaseio.com` WebSocket — use mobile data for testing
- **Firebase long-polling** fallback works on home network (REST works, WebSocket blocked)
- **Mobile fix:** `auth.js` 8-second timeout on `onAuthStateChanged`. `firebase-db.js` 8-second AbortController on all fetches. `index.html` 10-second safety net.
- **Cloudflare Worker** deployed by pasting into dashboard editor. Custom domain `api.dynastylockerroom.com` is NOT used in code.
- **Mobile safe area:** `viewport-fit=cover` in index.html meta. Nav uses `env(safe-area-inset-top)`. League detail panel uses `padding-top: calc(48px + env(safe-area-inset-top))` and `overflow: hidden` with scrollable `.league-detail-body` only.
- **Mobile viewport height:** `100dvh` used throughout (with `100vh` fallback) to avoid browser chrome clipping.
- **Yahoo token storage:** `localStorage` primary, `sessionStorage` fallback. If `expiresAt` is 0 (unknown), token is used optimistically rather than triggering a refresh.

---

## CSS Key Classes (confirmed)
- Standings: `standings-row--me`, `standings-win`, `standings-loss`, `standings-num`, `st-av`, `bubble-tag`, `standings-legend`, `standings-table-wrap`
- Matchups: `mu-card`, `mu-header`, `mu-team`, `mu-team--right`, `mu-scores`, `mu-score`, `mu-score--win`, `mu-score--lose`, `mu-dash`, `mu-no-detail`, `fw-700`, `mu-sbs-row`, `mu-sbs-header`, `mu-slot`, `mu-name`, `mu-pts`, `mu-pts--win`, `mu-bench-header`
- Week pills: `season-pill`, `season-pill--current` (all platforms including Yahoo)
- Playoffs: `bracket-wrap`, `bracket-section`, `bracket-match`, `bracket-slot`, `bracket-slot--win`, `bracket-slot--lose`, `bracket-slot--me`, `bracket-team`, `bracket-score`, `bracket-tbd`, `bracket-finals`
- Draft: `draft-auction-list`, `draft-auction-row`, `draft-pagination`
- Transactions: `tx-pagination`, `tx-page-btn`

---

## Roadmap — Open Issues (see DLR_YAHOO_TODO.md for detail)

### 🔴 High Priority
1. **MFL championship reset** — guilotine/eliminator leagues already in Firebase need `playoffFinish` + `resolved` cleared so they re-process
2. **Yahoo mobile token persistence** — tokens not saving to localStorage on some mobile browsers; `resolved` leagues may not persist
3. **Yahoo matchup player scores** — `/yahoo/matchupDetail` endpoint built but not yet confirmed working against live Yahoo data
4. **Yahoo playoff finish bug** — runner-up sometimes detected as 3rd place; bug in `_detectYahooPlayoffFinish` week/elimination logic

### 🟡 Medium Priority
5. **Yahoo Analytics tab** — leagueKey wired, not end-to-end tested
6. **Yahoo resolved flag for completed redraft leagues** — `is_finished=1` past-season redraft leagues should also be marked resolved
7. **MFL bracket early-round exits** — `Math.pow(2, roundsFromFinal) + 1` may be wrong for non-power-of-2 bracket sizes
8. **Bottom safe area** — `env(safe-area-inset-bottom)` not yet applied to scrollable content

### 🟢 Low Priority / Future
9. **Cloudflare custom domain** — email warning about `api.dynastylockerroom.com` deletion; Worker itself is fine
10. **Sticky notes in Hallway UI**
11. **Commissioner trophy builder**
12. **Tournament bracket feature**

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

**April 16 (Yahoo mega-session):** Draft parsing, transactions, career stats tabs, championship detection (Yahoo + MFL), playoffs bracket filter, matchup week pills, league type detection, `resolved` flag system, `_resolveSleeperIdentities` backfill.

**April 17 (performance + polish session):**
- `_draftDebug` removed from `worker.js` and `yahoo.js`
- `uses_roster_import` added to `normalizeBundle` leagueMeta
- All `saveLeague` catches now log errors (no more silent failures)
- Mobile header fix: `viewport-fit=cover` + `env(safe-area-inset-top)` on nav
- Mobile browser bar fix: `100dvh` replacing `100vh` in `locker.css` + `base.css`
- Mobile league detail panel: header + tab select now sticky; only body scrolls
- Yahoo week pills: switched to `season-pill` / `season-pill--current` matching MFL/Sleeper
- Yahoo matchup player scores: new `/yahoo/matchupDetail` worker endpoint (two-step: scoreboard → roster+stats)
- Yahoo token fix: optimistic token use when `expiresAt` unknown; empty string refresh treated as missing
- MFL `_detectMFLPlayoffFinish`: `isGuillotine` param added, skips bracket for eliminator/guillotine
- MFL guillotine standings rank: cap removed (was ≤ 8, now unlimited for guillotine leagues)
- MFL `resolved` flag: allows eliminator/guillotine leagues through even when `leagueType === "redraft"`
- Yahoo keeper detection: `isKeeper` flag + `hasKeeperPicks` from draft data; `_detectYahooLeagueType` uses it
- `worker.js`: `is_keeper` field added to draft pick output; `yahooLogin` function declaration bug fixed

---

## Tips for Starting a New Claude Chat

1. **Attach this document** + `DLR_YAHOO_TODO.md` + **the specific file(s)** for the task
2. **One task per session** — attach only the 1–3 files needed for that task
3. **Commit to git** after each fix before starting a new session

### Standard context block:
```
I'm building Dynasty Locker Room (DLR), a fantasy football SPA at dynastylockerroom.com.
Repo: mraladdin23/gm-dynasty (GitHub Pages).
Stack: Vanilla JS, Firebase Realtime DB, Cloudflare Worker (mfl-proxy.mraladdin23.workers.dev).
Worker deployed by pasting into Cloudflare dashboard editor (no wrangler.toml).
Platforms: Sleeper ✅, MFL ⚠️, Yahoo ⚠️.
[Attach DLR_PROJECT_SUMMARY.md + DLR_YAHOO_TODO.md]
Today I want to work on: [specific task]
Here are the relevant files: [attach files]
```

### Tips:
- Test Yahoo on **mobile data** — home router blocks workers.dev and firebaseio.com WebSocket
- `standings-row--me` is correct (NOT `standings-row--mine`)
- Yahoo week pills use `season-pill` / `season-pill--current` (same as MFL/Sleeper)
- Yahoo game key format: `"{game_id}.l.{league_id}"` — always use stored `league.leagueKey`

---

*Document updated: April 17, 2026*
*MFL: mostly working (championship detection fixed for new imports; existing data needs reset). Sleeper: fully working. Yahoo: mostly working — see DLR_YAHOO_TODO.md.*
