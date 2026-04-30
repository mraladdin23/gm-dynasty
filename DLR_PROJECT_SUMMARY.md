# Dynasty Locker Room (DLR) — Project Summary
*For use as context in a new Claude chat session*
*Updated: April 29, 2026 — Tournament analytics, Players tab, and all F5 phases complete.*

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
- `index.html` — Full SPA shell. All screens defined here. Firebase SDK loaded at bottom of body. CSS cache-busted: `locker.css v=22`, `auth.css v=6`, `tournament.css v=4`. Viewport meta includes `viewport-fit=cover` for PWA safe area support.
- `worker.js` — Cloudflare Worker. MFL bundle fetches, Yahoo OAuth flow + bundle + playerStats + tournament draft + tournament rosters. Deploy by pasting into Cloudflare dashboard.

### `css/`
- `base.css` — Global variables, reset, typography. `.screen` uses `min-height: 100dvh`. `.screen.active { overflow: hidden }` on mobile.
- `auth.css` — Login/register screen styles
- `locker.css` — All app UI styles. v=22. Mobile: `100dvh` for app-view height, `env(safe-area-inset-top)` for nav + detail panel.
- `tournament.css` — Tournament module styles. v=4. Contains all playoff UI styles, Players tab list view, year pips, analytics tabs (Most Rostered, ADP vs Finish).

### `js/` — Core modules (all vanilla JS IIFEs)

| File | Purpose |
|------|---------|
| `app.js` | Orchestrates screens, auth state, global monitors, button handlers. |
| `auth.js` | Firebase Auth wrapper. `sendPasswordReset(username)` looks up real email from DB. |
| `firebase-db.js` | All Firebase Realtime DB reads/writes. REST API with 8-second AbortController timeouts. |
| `profile.js` | League card grid, franchise history, league detail panel, MFL/Yahoo/Sleeper import. |
| `mfl.js` | MFL API helpers. Full set of normalizers for standings, matchups, brackets, drafts. |
| `yahoo.js` | Yahoo OAuth token management, `getLeagueBundle`, `normalizeBundle`. |
| `sleeper.js` | Sleeper API wrappers. `importUserLeagues` handles full import with playoff detection. |
| `standings.js` | Standings, Matchups, Playoffs tabs — cross-platform. |
| `roster.js` | Roster tab — cross-platform. |
| `draft.js` | Draft board — multi-draft selector, grid/list/auction toggle, 25/page pagination. |
| `transactions.js` | Transactions tab — all platforms. |
| `analytics.js` | Analytics tab — Sleeper + MFL + Yahoo. |
| `rules-and-fa.js` | League Rules + Players/Free Agents tab. |
| `tournament.js` | Tournament module — full admin + user UI. See Tournament section below. |
| `hallway.js` | The Hallway social feature |
| `trophy-room.js` | Trophy room display |
| `players-db.js` | Cross-platform player DB. DynastyProcess CSV. `MAPPINGS_VERSION = "2026-04b"`. |
| Other modules | `salary.js`, `auction.js`, `playercard.js`, `idb-cache.js`, `chat.js`, `leaguegroups.js`, `manager-search.js`, `playerreport.js`, `config.js` |

### `tournaments/`
- `index.html` — Public tournament directory and detail page. Reads from `gmd/publicTournaments/` (no auth required). Has mobile tab `<select>` dropdown, year selector, playoff tab with full round/standings/league champs rendering. Players tab with career history (list view, searchable).

---

## Platform Integration Status

### Sleeper ✅ Fully working
### MFL ✅ Fully working
### Yahoo ✅ Fully working

---

## Tournament Mode — Architecture

### Firebase paths
```
gmd/tournaments/{tid}/
  meta/             — name, tagline, status, regType, rankBy, playoffStartWeek, bio, createdAt
  leagues/          — batch structure: {batchId: {platform, year, leagues: {leagueId: {name, conference, division}}}}
  roles/            — {username: {role: "admin"|"sub_admin"}}
  registrationForm/ — {fields, optionalFields, customQuestions}
  registrations/    — {rid: {displayName, email, status, ...}}
  participants/     — {pid: {displayName, teamName, email, sleeperUsername, mflEmail,
                             yahooUsername, twitterHandle, gender, years[], dlrLinked, dlrUsername}}
  standingsCache/   — {year_leagueId: {leagueName, platform, year, conference, division, champion,
                                        leagueStatus, teams:[{teamId, userId, sleeperUsername,
                                        teamName, wins, losses, ties, pf, pa}], lastSynced}}
  playoffs/         — {year: {mode, qualification, seeding, byes, pointsRounds, customRounds,
                               bracketSize, startWeek, endWeek, recognizeLeagueChampions,
                               scoringSettings, finalRankings}}
  scoringSettings/  — {year: {platform: {field: value}}}
  analyticsCache/   — {drafts: {...}, weeklyHighlights: {...}, recap: {...}}

gmd/publicTournaments/{tid}/
  — Meta fields + leagueCount, registrationCount, standingsCache, participantMap
  — playoffs/{year} — published snapshot with computedRounds, leagueChamps, standings,
                       finalRankings (all with displayName)
  — adpByYear/{year} — published ADP data for public site
```

### Key behaviors

**Standings display name:** Uses participant `displayName`. Lookup keyed by `sleeperUsername` (stable) first, then display name / team name. Gender also keyed by `sleeperUsername`.

**Gender badges:** Blue M / pink F pill inline after team name.

**Playoff config is year-scoped:** Each season stored at `playoffs/{year}/`. Admin selects year via year pills; `_activePoYear` passed through rerender chain so historical saves never go to wrong year.

**Qualification engine:** `_runCompositeQual` with `_groupKey` — falls back to `leagueName` when `division/conference` fields are empty. Each Sleeper league = one division in BOTS-style tournaments.

**Bye metric:** `byes.method` (H2H Record or PF) is independent of seeding method. `byeSet` computed per-group per scope.

**Publish:** Button fetches all playoff weeks, computes `computedRounds` (pre-sorted with blend scores) and `finalRankings` (authoritative ordered list from rank 1 = champion down to last non-qualifier). Writes to both `publicTournaments/{tid}/playoffs/{year}` AND `tournaments/{tid}/playoffs/{year}/finalRankings`.

**finalRankings:** Written at publish time. Rank 1 = overall champion. For `points_rounds` mode: works backwards from final round (survivors → R(N-1) elim sorted by that round's score → … → non-qualifiers by regular-season PF). Used by all analytics tabs so no re-simulation is needed.

**_buildPoByYear(t):** Shared helper used by Players tab, PO Appearance Rate (now merged into Players), ADP vs Finish, and Most Rostered. PRIMARY: reads `t.playoffs[year].finalRankings`. FALLBACK: derives from `_computeQualification()` if not yet published (PF-based, approximate). Keyed by sanitized displayName + teamName + sleeperUsername.

**_computeQualification(t, year):** Pure function, no network calls, runs the full qual engine from `t.standingsCache + t.playoffs[year]` config. Same logic as `_renderPlayoffsTab`. Shared between the publish flow and `_buildPoByYear` fallback.

**Cross-platform sync warnings:** After standings sync, a dismissible amber banner shows any MFL/Yahoo leagues that were skipped (no auth) or failed, plus scoring setting differences between platforms.

**Diagnostic:** `diagQual("name")` in browser console — shows gender, sleeperUsername, step-by-step qualification.

**Mobile tabs:** `<select>` at ≤600px, button bar on desktop, synced.

### Tab structure (internal admin + user)
```
Admin tabs: Overview | Leagues | Roles | Registration Form | Registrants |
            Participants | Standings | Playoffs | Info/Rules |
            Players | Most Rostered | ADP vs Finish

User tabs:  Info | Rules | Standings | Playoffs | Draft | Matchups |
            Rosters | Players | Most Rostered | ADP vs Finish
```

### Players tab (internal + public)
- Paginated list (25/page), searchable by name
- Sort: Tournament champions → Years played desc → Best finish rank asc → Win% desc
- Columns: # | Player (name, gender, streak badge, twitter) | Yrs | W–L | Win% | PO | Best | Titles | Year pips
- Year pips: gold=champion, green=qualified, red=eliminated, grey=absent (hover for tooltip with rank)
- Tournament champion rows: gold left border + amber background
- League champion rows (not tournament champ): subtle purple background
- Modal: career totals (Seasons, W–L, Win%, PO Apps, Best Rank, Career PF, Tourn champs, League champs) + per-year table with W–L, PF, Lg Champ column, finish row at bottom of each year's table
- Also on public `tournaments/index.html` with the same structure

### Most Rostered tab
- For a selected year: among all playoff-qualified teams, which players appeared on the most rosters
- Fetches Sleeper via public API; MFL via worker `/tournament/rosters` (cookie required); Yahoo via worker `/tournament/rosters` (token required)
- Position filter, ownership bar, team chip list

### ADP vs Finish tab
- Requires draft data loaded (Draft tab or Load button)
- Splits all drafted players into playoff-team picks vs eliminated-team picks
- Computes PO%, Elim%, Swing (PO%−Elim%) per player
- Three sort views: PO-Heavy, Elim-Heavy, By Swing
- Position filter

### Phase completion
- **Phase 1 ✅** — Foundation (admin setup, roles, registration, participant DB, discovery)
- **Phase 2 ✅** — Standings sync, public page, display name, gender badges, Info + Rules tabs
- **Phase 3 ✅** — Analytics: Draft, ADP, Matchups, Rosters, admin settings, public ADP by year
- **Phase 4 ✅** — Custom playoffs: config UI, qualification engine, seeding/byes, round rendering, live scores, public site
- **Phase 4-ext ✅** — Players tab (career history + PO stats), Most Rostered, ADP vs Finish, finalRankings publish, cross-platform sync warnings
- **Phase 5** — Advanced (future if needed): multi-week rounds, cross-platform identity merging, weekly emails, message board

---

## Worker Endpoints

| Path | Method | Purpose |
|------|--------|---------|
| `/auth/yahoo/login` | GET | Start Yahoo OAuth flow |
| `/auth/yahoo/callback` | GET | OAuth callback, redirect to app |
| `/auth/yahoo/refresh` | POST | Refresh Yahoo token |
| `/yahoo/leagues` | POST | List user's Yahoo leagues |
| `/yahoo/leagueBundle` | POST | Full Yahoo league data bundle |
| `/yahoo/playerStats` | POST | Player stats for a league |
| `/yahoo/matchupRoster` | POST | Roster for a specific matchup week |
| `/mfl/userLeagues` | POST | List user's MFL leagues (with SINCE= support) |
| `/mfl/login` | POST | Get MFL cookie (reusable across calls) |
| `/mfl/bundle` | POST | Full MFL league data bundle |
| `/mfl/liveScoring` | POST | MFL live scoring for a specific week |
| `/mfl/playoffBracket` | POST | MFL playoff bracket by bracket_id |
| `/mfl/auctionResults` | POST | MFL auction results |
| `/mfl/players` | POST | MFL player universe |
| `/mfl/rosters` | POST | MFL rosters for a specific week |
| `/tournament/draft` | POST | Draft picks for one league (Sleeper/MFL/Yahoo) |
| `/tournament/rosters` | POST | Rosters for one league (MFL/Yahoo) — normalized `{rosters:[{teamId, playerIds[]}]}` |
| `/tournament/recap` | POST | AI-generated weekly recap via Claude Haiku |

---

## Key Patterns & Gotchas

### Firebase writes
- Always use `.update()` for merges, never `.set()` on existing nodes with data you want to keep
- Firebase Realtime DB keys cannot contain: `. # $ / [ ]` — sanitize user-supplied strings
- `GMDB.saveLeagues` (plural) is correct — `saveLeague` (singular) does not exist

### Mobile scroll
- `base.css`: `.screen.active { overflow: hidden }` — clips everything at mobile
- To make a view scrollable on mobile: add `#view-{name}.active { overflow-y: auto !important; height: calc(100dvh - 48px) !important; }` to the relevant CSS file

### CSS versioning
- `locker.css` is at **v=22**, `auth.css` at **v=6**, `tournament.css` at **v=4**
- Bump `?v=N` in the `<link>` tag in `index.html` when deploying CSS changes

### Tournament year/string normalization
- `lc.year` in standingsCache can be a **number** (e.g. `2025`); `Object.keys(poByYear)` returns **strings**
- Always normalize with `String(yr)` when comparing or using as Set/Map keys
- `new Set([2025, "2025"])` creates two entries — this is the source of duplicate year pips if not normalized

### Worker deployment
- Changes to `worker.js` require a **separate paste into Cloudflare dashboard** — git push alone does nothing
- `YAHOO_REDIRECT_URI` must be `https://mfl-proxy.mraladdin23.workers.dev/auth/yahoo/callback`

### Yahoo
- Test on **mobile data** — home router blocks workers.dev and firebaseio.com WebSocket
- Yahoo game key format: `"{game_id}.l.{league_id}"`

### Other
- `standings-row--me` (NOT `standings-row--mine`)
- Yahoo week pills use `season-pill` / `season-pill--current`

---

## Starting a New Session

1. **Attach this document** + `DLR_TODO_LIST.md` + **the specific file(s)** for the task
2. **One task per session** — attach only the 1–3 files needed
3. **Commit to git** after each fix before starting a new session
4. **Never run bulk Firebase reset scripts** — fix things surgically
5. **Worker changes require a separate paste into Cloudflare dashboard**

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
