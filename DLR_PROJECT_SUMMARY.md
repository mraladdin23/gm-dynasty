# Dynasty Locker Room (DLR) — Project Summary
*For use as context in a new Claude chat session*
*Updated: April 29, 2026 — F5-P4 complete. All tournament phases done.*

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
- `index.html` — Full SPA shell. All screens defined here. Firebase SDK loaded at bottom of body. CSS cache-busted: `locker.css v=22`, `auth.css v=6`, `tournament.css v=1`. Viewport meta includes `viewport-fit=cover` for PWA safe area support.
- `worker.js` — Cloudflare Worker. MFL bundle fetches, Yahoo OAuth flow + bundle + playerStats. Deploy by pasting into Cloudflare dashboard.

### `css/`
- `base.css` — Global variables, reset, typography. `.screen` uses `min-height: 100dvh`. `.screen.active { overflow: hidden }` on mobile.
- `auth.css` — Login/register screen styles
- `locker.css` — All app UI styles. v=22. Mobile: `100dvh` for app-view height, `env(safe-area-inset-top)` for nav + detail panel.
- `tournament.css` — Tournament module styles. v=1. Contains all playoff UI styles including standings table, round tabs, bye toggle, champion banner, league champs grid.

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
- `index.html` — Public tournament directory and detail page. Reads from `gmd/publicTournaments/` (no auth required). Has mobile tab `<select>` dropdown, year selector, playoff tab with full round/standings/league champs rendering.

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
  meta/           — name, tagline, status, regType, rankBy, playoffStartWeek, bio, createdAt
  leagues/        — batch structure: {batchId: {platform, year, leagues: {leagueId: {name, conference, division}}}}
  roles/          — {username: {role: "admin"|"sub_admin"}}
  registrationForm/ — {fields, optionalFields, customQuestions}
  registrations/  — {rid: {displayName, email, status, ...}}
  participants/   — {pid: {displayName, teamName, email, sleeperUsername, mflEmail,
                           yahooUsername, twitterHandle, gender, years[], dlrLinked, dlrUsername}}
  standingsCache/ — {year_leagueId: {leagueName, platform, year, conference, division, champion,
                                      leagueStatus, teams:[{teamId, userId, sleeperUsername,
                                      teamName, wins, losses, ties, pf, pa}], lastSynced}}
  playoffs/       — {year: {mode, qualification, seeding, byes, pointsRounds, customRounds,
                             bracketSize, startWeek, endWeek, recognizeLeagueChampions,
                             scoringSettings}}
  scoringSettings/ — {year: {platform: {field: value}}}

gmd/publicTournaments/{tid}/
  — Meta fields + leagueCount, registrationCount, standingsCache, participantMap
  — playoffs/{year} — published snapshot with computedRounds, leagueChamps, standings (all with displayName)
```

### Key behaviors
- **Standings display name:** Uses participant `displayName`. Lookup keyed by `sleeperUsername` (stable) first, then display name / team name. Gender also keyed by `sleeperUsername`.
- **Gender badges:** Blue M / pink F pill inline after team name.
- **Playoff config is year-scoped:** Each season stored at `playoffs/{year}/`. Admin selects year via year pills; `_activePoYear` passed through rerender chain so historical saves never go to wrong year.
- **Qualification engine:** `_runCompositeQual` with `_groupKey` — falls back to `leagueName` when `division/conference` fields are empty. Each Sleeper league = one division in BOTS-style tournaments.
- **Bye metric:** `byes.method` (H2H Record or PF) is independent of seeding method. `byeSet` computed per-group per scope.
- **Publish:** Button fetches all playoff weeks, computes `computedRounds` (pre-sorted with blend scores), writes to `publicTournaments/{tid}/playoffs/{year}`. Public site reads year-specific node on each tab open.
- **Diagnostic:** `diagQual("name")` in browser console — shows gender, sleeperUsername, step-by-step qualification.
- **Mobile tabs:** `<select>` at ≤600px, button bar on desktop, synced.

### Phase completion
- **Phase 1 ✅** — Foundation (admin setup, roles, registration, participant DB, discovery)
- **Phase 2 ✅** — Standings sync, public page, display name, gender badges, Info + Rules tabs
- **Phase 3 ✅** — Analytics: Draft, ADP, Matchups, Rosters, admin settings, public ADP by year
- **Phase 4 ✅** — Custom playoffs: config UI, qualification engine, seeding/byes, round rendering, live scores, public site
- **Phase 5** — Advanced (future if needed)

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
- `locker.css` is at **v=22**, `auth.css` at **v=6**, `tournament.css` at **v=1**
- Bump `?v=N` in the `<link>` tag in `index.html` when deploying CSS changes

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
