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

### Yahoo ✅ Fully working
- OAuth flow ✅
- Standings ✅ (CSS matches MFL/Sleeper, sort confirmed; bubble tag removed — in playoffs or not)
- Matchups ✅ (season-pill week bar, roster expand with slot-ordered lineup, data-attribute onclick fixes apostrophe bug)
- Playoffs ✅ (Championship + 3rd Place only; byes shown; bubble removed)
- Roster ✅ (PREFERRED_ORDER position grouping, detailMap fallback)
- Players tab ✅ (YTD stats via `/yahoo/playerStats`, position dropdown)
- Draft ✅ (parser working, grid/list/auction views, 25/page pagination)
- Transactions ✅ (team name blank confirmed resolved)
- Analytics ✅ (leagueKey wired, Draft Recap uses DLRPlayers.getByYahooId for names)
- Career stats ✅ (`_renderCSPlatform` and `_renderCSPlatformYear` implemented)
- Keeper detection ✅
- League type detection ✅ (`leagueTypeConfirmed` flag)
- Championship/playoff finish detection ✅ (uses standings `rank` + `clinched`/`playoffSeed` gate; badges for top 3 only; no 🏅 for made playoffs)
- Per-league sync button ✅ (🔄 Sync League; null myId handled gracefully; clears stale data even when Yahoo returns no team info)
- Commissioner broadcast message ✅ (fixed JSON-in-onclick bug via data attributes)
- Token persistence ✅ (Y4 closed — root cause was `YAHOO_REDIRECT_URI` env var in Cloudflare pointing to frontend instead of worker callback; also fixed `linked` gate in `showApp` and added save in `linkYahoo`)
- Bundle stability ⚠️ (worker batches week fetches 3/batch 300ms delay + retry; still rate-limits under heavy load — Y5 open)

---

## Tournament Feature (F5) — Planned

**Spec doc:** `GMDynasty_Tournament_Spec.docx` v1.0 — attach to any tournament session.
**Purpose:** Structured multi-platform competition layer for large-scale fantasy tournaments
(e.g. Scott Fish Bowl) spanning MFL, Yahoo, and Sleeper leagues.

**Firebase data root:** `gmd/tournaments/{tournamentId}/`
**New files:** `tournament.js`, `tournament.css`
**Existing files touched:** `firebase-db.js`, `index.html`, `app.js`, `profile.js`

**Five build phases:**
- **Phase 1 — Foundation:** Admin setup, league loading (multi-platform), role permissions (admin + scoped sub-admins), tournament lifecycle (Draft→Registration→Active→Playoffs→Complete), registration form builder, applicant approval, CSV export/import, auto-discovery (user's leagues silently matched to tournament league IDs on sync)
- **Phase 2 — Core Views:** Tournament bio/info page (rich text, donation link), rules tab (versioned), tiebreaker config, consolidated standings (all teams, search/filter), division/conference sub-views
- **Phase 3 — Analytics:** Consolidated draft board (all picks, ADP calc, filter by position/division), individual team draft board, weekly matchup summary tab (highlights + admin recap + AI-assisted recap via Claude API), top rosters view
- **Phase 4 — Playoffs:** Format config (top-X by PF, top-N per division, H2H bracket, hybrid), list or bracket rendering, lineup view per matchup, winners advance / losers dimmed
- **Phase 5 — Advanced:** Cross-platform identity merging (auto-match + admin override), weekly summary emails (SendGrid), message board integration

**Open questions (resolve before each phase):**
- P2: Rich text editor library — Quill, TipTap, or ProseMirror?
- P3: AI recap — Claude API call from Cloudflare Worker or Firebase Function?
- P4: Double elimination in Phase 4 or defer to Phase 5?
- P5: Email provider; fallback for low-confidence identity auto-match?

**Note:** F2 (Custom Playoff Tracker) overlaps with Phase 4 — decide before scoping P4 whether
to merge them or keep F2 as a standalone lightweight precursor.

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
POST /yahoo/leagueBundle    — full normalized bundle (weeks fetched in batches of 3, 300ms delay)
POST /yahoo/playerStats     — YTD fantasy points by player ID (batched, 25/req)
POST /yahoo/matchupRoster   — weekly roster for two teams (starters + bench, selected_position slot)
GET  /auth/yahoo/login      — OAuth redirect
GET  /auth/yahoo/callback   — OAuth callback
POST /auth/yahoo/refresh    — token refresh
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
- Standings: `standings-row--me`, `standings-win`, `standings-loss`, `standings-num`, `st-av`, `standings-legend`, `standings-table-wrap`
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

**April 20 (Yahoo polish + analytics session):**
- Yahoo playoff bracket fully verified: Championship + 3rd Place only, byes shown, semi-loser identification fixed (`bothLosers` check), `_detectYahooPlayoffFinish` gated on playoff appearance (prevents false champion badges)
- Yahoo matchup expand: roster-only lineup (starters + bench, slot-ordered QB→WR→TE→FLEX→SF→K→DEF), season-pill CSS, team name apostrophe bug fixed via data-attributes on mu-card
- Per-league Yahoo sync button: 🔄 Sync League in detail panel clears resolved/playoffFinish and re-fetches bundle; wired in `openLeagueDetail` and `switchDetailSeason`
- Yahoo Analytics Draft Recap: `_yahooRenderDraft` made async, uses `DLRPlayers.load()` + full `getByYahooId` → Sleeper DB → rosterDetails chain for player names
- Worker: `/yahoo/matchupRoster` endpoint added (roster-only, no stats — Yahoo scoring requires per-league rule application)
- CSS: `mu-sbs-row--no-pts` / `mu-sbs-header--no-pts` added to `locker.css` for 3-column Yahoo expand layout
- `yahoo.js`: `getMatchupRoster()` method added

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

**April 20 (Y4 — Yahoo OAuth token persistence session):**
- Root cause: `YAHOO_REDIRECT_URI` Cloudflare env var was set to `dynastylockerroom.com` (frontend) instead of `https://mfl-proxy.mraladdin23.workers.dev/auth/yahoo/callback` — Yahoo tokens were DOA
- `app.js`: removed `yahoo.linked` gate from token sync block — was silently skipping save on every first connect since `linked` is false until `linkYahoo` runs 500ms later
- `profile.js`: added `GMDB.saveYahooTokens` call inside `linkYahoo` after `linkPlatform` — reliable save point for first-time connects
- ⚠️ **Cloudflare env var tip:** `YAHOO_REDIRECT_URI` must be `https://mfl-proxy.mraladdin23.workers.dev/auth/yahoo/callback` — never the frontend URL

**April 20 (Yahoo playoff finish + sync overhaul session):**
- `_detectYahooPlayoffFinish` fully rewritten — now uses standings `rank` + `clinched`/`playoffSeed` gate instead of bracket parsing; outcomes: 1/2/3/4/7/null only
- Playoff participation gate: `clinched === true` OR `playoffSeed <= num_playoff_teams` (fallback for old leagues where Yahoo didn't set `clinched` reliably)
- Bubble tag removed from all platforms (Sleeper, Yahoo, MFL) in `standings.js` — you're either in or out
- Playoff finish badges top-3 only: 🏆🥈🥉; 🏅 removed everywhere; 4th place and "Made Playoffs" show no badge
- `syncYahooLeague` overhauled: null `myTeamId` no longer throws — writes cleared flags + marks resolved, shows warning toast
- `GMDB.saveLeague` (singular, non-existent) fixed to `GMDB.saveLeagues` in all 6 call sites in `profile.js` — was silently failing everywhere, preventing sync from ever writing to Firebase
- `is_finished` gate removed from detection — Yahoo returns 0 for many old completed leagues
- Commissioner broadcast message fixed in `leaguegroups.js` — JSON array in inline onclick was corrupting HTML; replaced with data attributes + addEventListener
- U4 (broadcast) and X1 (season status audit) both closed

**April 21 (session 9 — Y5 closed + doc update):**
- Y5 declared closed — bundle batching + per-league Sync button is best achievable without server-side caching
- All three platforms now fully working

**April 21 (sessions 10–12 — pre-F1/F5 polish: Items 1, 2, 3):**

*Session A — Options modal gating (Item 2):*
- `league-label-modal` restructured: Custom Label + Pin + Archive visible to all users; League Type Override, Commish Group, Enable Auction, Include Draft Picks gated behind `#label-commish-section` (hidden unless `league.isCommissioner`)
- New `#label-groups-display` read-only block shows colored chips for every label/group this league belongs to (personal labels from `leagueLabels` + commish groups from `commGroups` + legacy `commishGroup` text)
- `leaguegroups.js`: `loadCommGroups` added to public API
- `locker.css`: `.label-commish-divider`, `.label-groups-display`, `.label-group-chip` styles added (v=21)

*Session B — Group filter dropdown (Item 1):*
- Two separate `filter-groups-btn` / `filter-commish-btn` buttons replaced with single `filter-mygroups-btn` (🗂 My Groups) with active-filter count badge
- New unified `filter-panel-mygroups` panel with two subsections: "🏷 My Labels" and "⚡ Commissioner Groups"
- `_renderLeagueFilters()` refactored — checkbox wiring separated from group population; group data now loaded async from Firebase via `_refreshGroupsFilter()`
- `_refreshGroupsFilter()` fetches personal labels + commish groups from Firebase, filters to user's league keys, populates both subsections
- `_updateGroupsBtnCount()` keeps badge + button highlight in sync with active `label:`/`group:` filters
- `locker.css`: `.filter-group-section`, `.filter-group-section-title` added

*Session C — Cross-platform merge (Item 3 / X2):*
- `firebase-db.js`: `saveMergeLinks()` and `removeMergeLinks()` added — write `mergedInto` / `suppressMerge` to `gmd/users/{u}/leagueMeta/{key}`
- `_buildFranchises()` updated: checks `_leagueMeta[key].mergedInto` before assigning franchiseId — merged keys fold into their target chain seamlessly
- `_detectMergeCandidates(leagueKey)` — finds same-name franchises on different chains where user is commish of both
- `_applyMerge()` — determines primary (newer) vs absorbed (older) chain, persists to Firebase, updates local meta, re-renders
- `_removeMerge()` — sets `suppressMerge: true` on absorbed keys (soft undo, data preserved)
- `_renderMergeSection()` — populates `#label-merge-section` in options modal: shows candidate rows + Merge buttons, or current merged state + Unlink button
- `index.html`: `#label-merge-section` div added inside `#label-commish-section` with "🔗 Dynasty Chain" divider
- `locker.css`: merge candidate and merge state styles added

**April 21 (sessions 13–15 — bug fixes post-deploy):**

*Group filter not appearing (Bug B1):*
- Root cause: `index.html` with old `filter-groups-btn`/`filter-commish-btn` IDs was never replaced — new JS looked for `filter-mygroups-btn` which didn't exist in DOM
- Fix: Session B HTML finally deployed — old two-button structure replaced with unified `filter-mygroups-btn` + `filter-panel-mygroups`

*Group filter showing "no leagues match" (Bug B2):*
- Root cause: `_franchiseMatchesFilter` checked `meta.commishGroup === groupName` — a plain text field nobody uses; actual groups are in Firebase `commGroups` with `leagueKeys` arrays
- Fix: Added `_groupsCache` module-level variable; `_refreshGroupsFilter()` now populates it after loading; `_franchiseMatchesFilter` `group:` case checks `cachedGroup.leagueKeys.includes(season.key)` across all franchise seasons; legacy `commishGroup` text kept as fallback
- Also fixed `commUsername` check so groups you *created* always appear even if your league keys aren't listed

*Merge detail panel not showing extra seasons (Bug C1):*
- Root cause: `openLeagueDetail`, `_renderOverviewHTML`, `_renderHistory` all filtered on `league.franchiseId` directly — didn't follow `_leagueMeta[key].mergedInto`
- Fix: Added `_resolveEffectiveFid(leagueKey)` and `_getAllSeasonsForFranchise(targetFid)` helpers; all three functions updated to use them; merged MFL seasons now show in season pills and history tab

*Merge commish requirement too strict (Bug C2):*
- Root cause: `_detectMergeCandidates` required `isCommissioner` on both franchises
- Fix: Only requires commish on the league you're opening options for; other franchise can be non-commish (e.g. MFL leagues imported as member)
- Also: `_normalizeName` strips emoji so "Ballers Empire 💵📜" matches "Ballers Empire"

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
Platforms: Sleeper ✅, MFL ✅, Yahoo ✅.
[Attach DLR_PROJECT_SUMMARY.md + DLR_TODO_LIST.md]
Today I want to work on: [specific task]
Here are the relevant files: [attach files]
```

### Tips:
- **`YAHOO_REDIRECT_URI` Cloudflare env var** must be `https://mfl-proxy.mraladdin23.workers.dev/auth/yahoo/callback` — setting it to the frontend URL makes every token DOA ("Request denied")
- Test Yahoo on **mobile data** — home router blocks workers.dev and firebaseio.com WebSocket
- `standings-row--me` is correct (NOT `standings-row--mine`)
- Yahoo week pills use `season-pill` / `season-pill--current` (same as MFL/Sleeper)
- Yahoo game key format: `"{game_id}.l.{league_id}"` — always use stored `league.leagueKey`
- Worker changes require a **separate paste into Cloudflare dashboard** — git push alone is not enough
- Yahoo rate limiting: don't run multiple tabs or hammer the import button repeatedly
- **Merge links** stored at `gmd/users/{u}/leagueMeta/{key}.mergedInto` — `suppressMerge: true` = soft unlinked
- **locker.css is now at v=21** — Sessions A/B/C styles all consolidated there

---

*Document updated: April 21, 2026 (session 15)*
*All three platforms fully working. Items 1, 2, 3 fully verified and bug-fixed.*
*Next: F1 (Dynasty/Keeper Overview Tab) or F5-P1 (Tournament Mode Phase 1).*
