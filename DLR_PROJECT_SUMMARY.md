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
- `index.html` — Full SPA shell. All screens defined here. Firebase SDK loaded at bottom of body. CSS cache-busted at v=20. Viewport meta includes `viewport-fit=cover` for PWA safe area support.
- `worker.js` — Cloudflare Worker. MFL bundle fetches, Yahoo OAuth flow + bundle + playerStats. Deploy by pasting into Cloudflare dashboard.

### `css/`
- `base.css` — Global variables, reset, typography. `.screen` uses `min-height: 100dvh` (with `100vh` fallback).
- `auth.css` — Login/register screen styles
- `locker.css` — All app UI styles. v=20. Mobile: `100dvh` for app-view height, `env(safe-area-inset-top)` for nav + detail panel.

### `js/` — Core modules (all vanilla JS IIFEs)

| File | Purpose |
|------|---------|
| `app.js` | Orchestrates screens, auth state, global monitors, button handlers. Yahoo OAuth callback handled via `#yahoo_token=` hash. |
| `auth.js` | Firebase Auth wrapper. 8-second timeout on auth state to prevent mobile hang. |
| `firebase-db.js` | All Firebase Realtime DB reads/writes. REST API with 8-second AbortController timeouts. `saveLeagues` uses `.update()` (merge). |
| `profile.js` | League card grid, franchise history, league detail panel, MFL/Yahoo/Sleeper import. Background identity resolution for all platforms. `resolved` flag system for historical league caching. `renderLocker` always closes the detail panel on load (prevents stuck panel on mobile). `_isSeasonComplete(l)` helper used for cross-platform finish label detection. |
| `mfl.js` | MFL API helpers. Full set of normalizers for standings, matchups, brackets, drafts. |
| `yahoo.js` | Yahoo OAuth token management, `getLeagueBundle`, `normalizeBundle`. Token logic: if `expiresAt` is unknown (0), use token optimistically. `hasKeeperPicks` detection from draft data. `uses_roster_import` in leagueMeta. `_getValidToken` and `_workerBase` exposed on public surface. |
| `sleeper.js` | Sleeper API wrappers. `importUserLeagues` handles full import with playoff detection. |
| `standings.js` | Standings, Matchups, Playoffs tabs — cross-platform. Yahoo: `season-pill` week pills (matching MFL/Sleeper), matchup expand with team stats. Yahoo bracket identifies championship game via semi-winner detection. |
| `roster.js` | Roster tab — cross-platform. PREFERRED_ORDER position grouping. `detailMap` bio fallback for unmatched players. |
| `draft.js` | Draft board — multi-draft selector, grid/list/auction toggle, 25/page pagination (all platforms). |
| `transactions.js` | Transactions tab — all platforms. 25/page pagination. |
| `analytics.js` | Analytics tab — Sleeper + MFL fully working. Yahoo: leagueKey wired. |
| `rules-and-fa.js` | League Rules + Players/Free Agents tab. Yahoo: position dropdown, stats fetch, detailMap fallback. |
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
Past complete seasons marked `resolved: true` at import.

### MFL ✅ Fully working
All tabs functional. New imports correctly detect playoff finish for bracket,
eliminator, and guillotine leagues.

**Key architecture:**
- `myRosterId` is 4-digit zero-padded franchise ID (e.g. `"0035"`)
- Player resolution via DynastyProcess CSV (`getSleeperIdFromMfl()`)
- `getPlayers()` session cache versioned as `mfl_players_v2_...`
- Eliminator/guillotine week range from `weekEliminated` in standings
- Bundle fetched in batches of 3 with 200ms delay, 1 auto-retry at 600ms

**Worker `userLeagues` endpoint:**
- Uses `SINCE=1999` bulk fetch first, then year-by-year for any missing years
- This ensures all historical seasons are returned even when MFL's SINCE= skips years

### Yahoo ⚠️ Mostly working
- OAuth flow ✅
- Standings ✅ (CSS matches MFL/Sleeper, sort confirmed)
- Matchups ✅ (season-pill week bar, click-to-expand with team stats)
- Playoffs ⚠️ (bracket + finish detection code fixed but needs full verification)
- Roster ✅ (PREFERRED_ORDER position grouping, detailMap fallback)
- Players tab ✅ (YTD stats via `/yahoo/playerStats`, position dropdown)
- Draft ✅ (parser working, grid/list/auction views, 25/page pagination)
- Transactions ⚠️ (team name blank on some transactions)
- Analytics ✅ (leagueKey wired)
- Career stats ✅ (`_renderCSPlatform` and `_renderCSPlatformYear` implemented)
- Keeper detection ✅
- League type detection ✅ (`leagueTypeConfirmed` flag)
- Championship/playoff finish detection ⚠️ (code fixed April 18; needs verification once Yahoo API stabilizes — old leagues 2002–2011 may have no matchup data)
- Token persistence ⚠️ (optimistic use when expiresAt=0 fixed; mobile still unreliable — Y4 open)
- Bundle stability ⚠️ (worker now batches week fetches 3 at a time with 300ms delay + retry; Yahoo still rate-limits under heavy load — Y5 open)

---

## Historical League Caching — `resolved` Flag

Past-season leagues are cached in Firebase with `resolved: true` once fully hydrated.
A resolved league is NEVER re-fetched from any platform API.

**A league is marked resolved when:**
- `season < currentYear` (past season)
- `playoffFinish != null`
- `leagueType` is set and not `"redraft"` — OR `lm.is_finished === 1` (covers finished redraft leagues — Y6 fix)
- `teamName` is set

**`_isSeasonComplete(l)` helper (profile.js):**
Returns true when a season is definitively over, regardless of platform:
- Sleeper: `l.status === "complete"`
- Yahoo/MFL resolved: `l.resolved === true`
- Any past year: `l.season < CURRENT_SEASON`
Used for "Missed Playoffs" vs "Season in Progress" display label.

**⚠️ IMPORTANT — Do NOT run bulk Firebase reset scripts.**
Running bulk reset scripts (setting `resolved: null`, `playoffFinish: null` on many
leagues at once) has caused repeated data corruption issues. Fix stale data surgically,
one league at a time. Use the console scripts in DLR_TODO_LIST.md.

---

## Key Data Structures

### Firebase paths
```
gmd/
  users/{username}/           — profile, platforms, leagues
  uid_map/{uid}               — uid → username lookup
  leagueMeta/{username}/{key} — pinned, archived, customLabel
  leagueSettings/{leagueId}   — shared commish settings
  auctions/{leagueKey}/       — auction records, bid log, settings
  salaryCap/{storageKey}/     — settings, rosters
  leagueRules/{leagueKey}     — markdown rules text
  chat/{leagueKey}/messages   — chat messages
```

### League key formats
```
Sleeper:  sleeper_{leagueId}           e.g. "sleeper_987654321"
MFL:      mfl_{season}_{leagueId}      e.g. "mfl_2024_22796"
Yahoo:    yahoo_{season}_{leagueId}    e.g. "yahoo_2024_123456"
MFL dynasty chain key: mfl__{leagueId}
Yahoo franchise chain key: yahoo__{normalized_league_name}
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
                   // fetched in batches of 3 with 300ms delay + 1 retry (worker)
  draft[],         // { pick, round, teamId, playerId, name, position, cost, isKeeper }
  transactions[],
  hasKeeperPicks,  // true if draft data contains keeper picks
}
```

### MFL worker endpoints
```
POST /mfl/userLeagues    — login + fetch all leagues (SINCE=1999 + year-by-year gap-fill)
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
POST /yahoo/leagueBundle   — full normalized bundle (weeks fetched in batches of 3, 300ms delay)
POST /yahoo/playerStats    — YTD fantasy points by player ID (batched, 25/req)
GET  /auth/yahoo/login     — OAuth redirect
GET  /auth/yahoo/callback  — OAuth callback
POST /auth/yahoo/refresh   — token refresh
```

---

## Network / Infrastructure Notes

- **Home router** blocks `workers.dev` and `firebaseio.com` WebSocket — use mobile data for testing
- **Firebase long-polling** fallback works on home network (REST works, WebSocket blocked)
- **Mobile fix:** `auth.js` 8-second timeout on `onAuthStateChanged`. `firebase-db.js` 8-second AbortController on all fetches. `index.html` 10-second safety net.
- **Cloudflare Worker** deployed by pasting into dashboard editor. Custom domain NOT used.
- **Mobile safe area:** `viewport-fit=cover` in index.html meta. Nav uses `env(safe-area-inset-top)`. League detail panel uses `padding-top: calc(48px + env(safe-area-inset-top))`.
- **Mobile viewport height:** `100dvh` used throughout (with `100vh` fallback).
- **Yahoo token storage:** `localStorage` primary, `sessionStorage` fallback. If `expiresAt` is 0 (unknown), token is used optimistically rather than triggering a refresh.
- **Stuck panel fix:** `renderLocker` explicitly closes the detail panel and clears `_detailLeagueKey` on every load — prevents mobile frozen screen state.
- **Yahoo rate limiting:** Yahoo's API has undocumented rate limits. Firing many parallel requests triggers HTTP 999 or silent failures. Worker batches week fetches (3/batch, 300ms delay). `_resolveYahooIdentities` runs 2 concurrent bundles with 500ms between batches.

---

## CSS Key Classes (confirmed)
- Standings: `standings-row--me`, `standings-win`, `standings-loss`, `standings-num`, `st-av`, `bubble-tag`, `standings-legend`, `standings-table-wrap`
- Matchups: `mu-card`, `mu-header`, `mu-team`, `mu-team--right`, `mu-scores`, `mu-score`, `mu-score--win`, `mu-score--lose`, `mu-dash`, `mu-no-detail`, `fw-700`, `mu-sbs-row`, `mu-sbs-header`, `mu-slot`, `mu-name`, `mu-pts`, `mu-pts--win`, `mu-bench-header`
- Week pills: `season-pill`, `season-pill--current` (all platforms including Yahoo)
- Playoffs: `bracket-wrap`, `bracket-section`, `bracket-match`, `bracket-slot`, `bracket-slot--win`, `bracket-slot--lose`, `bracket-slot--me`, `bracket-team`, `bracket-score`, `bracket-tbd`, `bracket-finals`
- Draft: `draft-auction-list`, `draft-auction-row`, `draft-pagination`
- Transactions: `tx-pagination`, `tx-page-btn`

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
- All `saveLeague` catches now log errors
- Mobile header: `viewport-fit=cover` + `env(safe-area-inset-top)` on nav
- Mobile browser bar: `100dvh` replacing `100vh`
- Mobile league detail panel: header + tabs sticky, body-only scroll
- Yahoo week pills: `season-pill` / `season-pill--current` matching MFL/Sleeper
- Yahoo matchup expand: team season stats shown on expand
- Yahoo token fix: optimistic use when `expiresAt` unknown
- MFL `_detectMFLPlayoffFinish`: `isGuillotine` param, skips bracket for guillotine
- MFL guillotine rank cap removed
- Yahoo keeper detection: `isKeeper` + `hasKeeperPicks`

**April 18 (Yahoo draft + keeper session):**
- Yahoo draft tab fixed: endpoint + multi-shape parser (Shapes 1–5)
- Yahoo keeper detection: worker fetches `players;status=K`, cross-references draft picks
- `hasKeeperPicks` from `keeperCount`; `leagueTypeConfirmed` flag added
- `_resolveYahooIdentities` filter tightened: skips resolved + current-season-only re-detect
- `allMatchups` capped to `current_week`
- DEF/team defense fallback in draft `playerMap`

**April 18 (stability session):**
- Worker `userLeagues` SINCE= gap-fill
- `profile.js` stuck panel fix
- `yahoo.js` token fix restored
- `base.css` + `index.html` mobile fixes restored

**April 18 (Yahoo playoff + stability session):**
- `_detectYahooPlayoffFinish` rewritten: identifies championship game via semi-winner detection; correctly assigns 1st/2nd/3rd/4th place; no longer confuses consolation game loser with runner-up
- Yahoo bracket (`standings.js`): championship game identified by semi-winner set, sorted first in finals display
- Y6: `_resolveYahooIdentities` now sets `resolved: true` for finished redraft leagues (`lm.is_finished === 1`)
- Y6: resolved leagues skipped in `_resolveYahooIdentities` filter
- `_isSeasonComplete(l)` helper added — cross-platform "season is over" check used for "Missed Playoffs" vs "Season in Progress" display label
- `_updateJumpDropdown` crash fixed (undefined `leagueName` in sort)
- Worker: Yahoo week fetches now batched (3/batch, 300ms delay, 1 retry) instead of all-parallel — reduces Yahoo rate limit hits
- All Yahoo leagues deleted and reimported fresh; placeholder Firebase keys from bad console script cleaned up
- Note: Yahoo API still rate-limits under heavy load; old leagues (2002–2011) may have no matchup data and will show "Missed Playoffs" by default

---

## Tips for Starting a New Claude Chat

1. **Attach this document** + `DLR_TODO_LIST.md` + **the specific file(s)** for the task
2. **One task per session** — attach only the 1–3 files needed for that task
3. **Commit to git** after each fix before starting a new session
4. **Never run bulk Firebase reset scripts** — they corrupt league data. Fix things surgically.
5. **Worker changes require a separate paste into Cloudflare dashboard** — git push alone is not enough

### Standard context block:
```
I'm building Dynasty Locker Room (DLR), a fantasy football SPA at dynastylockerroom.com.
Repo: mraladdin23/gm-dynasty (GitHub Pages).
Stack: Vanilla JS, Firebase Realtime DB, Cloudflare Worker (mfl-proxy.mraladdin23.workers.dev).
Worker deployed by pasting into Cloudflare dashboard editor (no wrangler.toml).
Platforms: Sleeper ✅, MFL ✅, Yahoo ⚠️.
[Attach DLR_PROJECT_SUMMARY.md + DLR_TODO_LIST.md]
Today I want to work on: [specific task]
Here are the relevant files: [attach files]
```

### Tips:
- Test Yahoo on **mobile data** — home router blocks workers.dev and firebaseio.com WebSocket
- `standings-row--me` is correct (NOT `standings-row--mine`)
- Yahoo week pills use `season-pill` / `season-pill--current` (same as MFL/Sleeper)
- Yahoo game key format: `"{game_id}.l.{league_id}"` — always use stored `league.leagueKey`
- Worker changes require a **separate paste into Cloudflare dashboard** — git push alone is not enough
- Yahoo rate limiting: don't run multiple tabs or hammer the import button repeatedly

---

*Document updated: April 18, 2026*
*MFL: fully working. Sleeper: fully working. Yahoo: mostly working — see DLR_TODO_LIST.md.*
*Yahoo playoff detection code fixed. Bundle stability improved. Y4/Y5 still open.*
