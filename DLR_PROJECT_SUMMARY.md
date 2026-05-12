# Dynasty Locker Room (DLR) — Project Summary
*For use as context in a new Claude chat session*
*Updated: May 12, 2026 — Draft Ticker overhauled (Sleeper-first), Hallway H2H, Admin Impersonation, tournament private flag.*

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
  - Deployed by **pasting into Cloudflare dashboard editor**
  - `wrangler.toml` added for cron trigger: `crons = ["* * * * *"]` (requires Cloudflare Workers Paid plan)
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
- `index.html` — Full SPA shell. All screens defined here. Firebase SDK loaded at bottom of body. CSS cache-busted: `locker.css v=22`, `auth.css v=6`, `tournament.css v=6`. JS cache-busted: `draft-ticker.js?v=5`. Viewport meta includes `viewport-fit=cover` for PWA safe area support. Cache-control `no-cache` meta tags added to prevent stale JS on mobile.
- `worker.js` — Cloudflare Worker. MFL bundle fetches, Yahoo OAuth flow + bundle + playerStats + tournament draft + tournament rosters. Draft watcher cron. Deploy by pasting into Cloudflare dashboard.

### `css/`
- `base.css` — Global variables, reset, typography. `.screen` uses `min-height: 100dvh`. `.screen.active { overflow: hidden }` on mobile.
- `auth.css` — Login/register screen styles
- `locker.css` — All app UI styles. v=22. Mobile: `100dvh` for app-view height, `env(safe-area-inset-top)` for nav + detail panel. Nav pills show icon-only on mobile (labels hidden). `.hl-h2h`, `.spinner--sm` added for Hallway H2H.
- `tournament.css` — Tournament module styles. **v=6.**

### `js/` — Core modules (all vanilla JS IIFEs)

| File | Purpose |
|------|---------|
| `app.js` | Orchestrates screens, auth state, global monitors, button handlers. Contains `AdminImpersonate` module (admin-only view-as-user feature). `_openGlobalActivityModal()`, `_renderGlobalDraftBody()`, `_openGlobalDraftModal()` for draft/activity modals. |
| `auth.js` | Firebase Auth wrapper. `sendPasswordReset(username)` calls worker endpoint which emails reset link via Resend to real address. |
| `firebase-db.js` | All Firebase Realtime DB reads/writes. REST API with 8-second AbortController timeouts. `linkPlatform` uses `.update()` not `.set()`. |
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
| `tournament.js` | Tournament module — full admin + user UI. Private tournament flag (`meta.isPrivate`) hides from public listing. |
| `draft-ticker.js` | Global draft ticker — Sleeper-first client architecture. Checks Sleeper directly on load for all leagues. Worker cron supplements with pick counts for live drafts. See Draft Ticker section below. |
| `hallway.js` | The Hallway social feature. H2H records shown per common league in manager modal, aggregated across dynasty chains. All three platforms supported. |
| `trophy-room.js` | Trophy room display |
| `players-db.js` | Cross-platform player DB. DynastyProcess CSV. `MAPPINGS_VERSION = "2026-04b"`. |
| `salary.js` | Salary cap management. Force-reads from Firebase after every save to bust SDK cache. |
| Other modules | `auction.js`, `playercard.js`, `idb-cache.js`, `chat.js`, `leaguegroups.js`, `manager-search.js`, `playerreport.js`, `config.js` |

### `tournaments/`
- `index.html` — Public tournament directory. Private tournaments (`meta.isPrivate = true`) excluded from listing.

---

## Platform Integration Status

### Sleeper ✅ Fully working
### MFL ✅ Fully working
### Yahoo ✅ Fully working

---

## Global Draft Ticker — Architecture (as of May 12, 2026)

### Core principle
**Client is self-sufficient.** On every page load, `_initialLoad()` checks Sleeper directly for all of the user's current-season leagues in parallel. No waiting for the Worker cron. The Worker supplements with pick counts for live drafts.

### Client flow (`draft-ticker.js`)
1. `_buildWatchList()` — reads `gmd/users/{username}/leagues`, filters to current-season Sleeper leagues only. `mostRecentSeason` filter ensures only one entry per dynasty chain (not all historical seasons). Writes `gmd/draftWatchIndex/{username}` for Worker.
2. `_initialLoad()` — calls `_checkSleeperDirect(leagueId)` for every league in parallel. Finds live/upcoming drafts immediately. Supplements from Firebase draftStatus for traded_picks enrichment only.
3. Scheduling — live drafts get Firebase realtime listener; upcoming use `_pollLeague()` (calls Sleeper directly) on graduated intervals (15min → 5min → 1min → 30s based on proximity).
4. `_refreshLiveDrafts()` — fires on panel open, fetches fresh picks from Sleeper.
5. `diagnose()` — public method, call `DraftTicker.diagnose()` from console for full state report.

### Worker cron (`worker.js` — `runDraftWatcher`)
- Reads `gmd/draftWatchIndex` (single node, all users unioned) + `gmd/draftStatus`.
- Classifies leagues: `urgent` (drafting/paused) → always check; `neverChecked` → priority pending (up to 80/run); `alreadyChecked` → shuffled pending (up to 120 total/run).
- Writes to `gmd/draftStatus/{leagueId}` — pick counts, traded picks, status changes.
- `gmd/draftStatus` rules: `.read: auth != null, .write: false` — only Worker can write (via DB secret).

### Firebase paths
```
gmd/draftWatchIndex/
  {username}: { leagueId: leagueName, ... }
  — Written by client on init(). Read by Worker cron.
  — Rules: .read: auth != null, .write: auth != null

gmd/draftStatus/
  {leagueId}: { status, draftId, draftType, picksMade, totalPicks,
                draft_order, slot_to_roster_id, traded_picks, picks_hash,
                startTime, updatedAt }
  — Written ONLY by Worker (via DB secret, bypasses rules).
  — Rules: .read: auth != null, .write: false
```

### Worker debug endpoints
```
GET /draft/status              — Read full gmd/draftStatus
GET /draft/test                — Step-by-step diagnostic
GET /draft/diagnose?username=X — Full per-user report: leagues, filter results,
                                  draftStatus vs Sleeper cross-check, mismatches
GET /draft/rebuildWatchIndex   — Backfill draftWatchIndex for ALL users (run once)
GET /draft/forcecheck          — Force-check a specific league
```

---

## Admin Impersonation (`app.js`)

- `AdminImpersonate` module — `ADMINS = ["mraladdin23"]`
- 👁 button in nav (only visible to admins). Prompts for username, loads their Firebase profile, re-renders entire app as them.
- Purple banner: "Viewing as {username} — read only". Exit button restores your session.
- DraftTicker re-inits as target user. Run `DraftTicker.diagnose()` to see their exact state.
- Firebase Auth session unchanged — nothing writes under their account.

---

## Tournament Module

### Firebase paths
```
gmd/tournaments/{tid}/
  meta/             — name, tagline, status, regType, rankBy, playoffStartWeek, bio,
                      createdAt, createdBy, isPrivate (optional — hides from public listing)
  leagues/          — batch structure: {batchId: {platform, year, leagues: {leagueId: {name, ...}}}}
  roles/            — {username: {role: "admin"|"sub_admin"}}
  registrationForm/ — {fields, optionalFields, customQuestions, fieldOrder}
  registrations/    — {rid: {displayName, email, status, custom_0..., importedAt, ...}}
  participants/     — {pid: {displayName, teamName, email, sleeperUserId, sleeperUsername,
                             mflEmail, yahooUsername, twitterHandle, gender, years[],
                             dlrLinked, dlrUsername, syncedAt}}
  standingsCache/   — {year_leagueId: {leagueName, platform, year, conference, division,
                                        champion, leagueStatus, teams:[...]}}
  playoffs/         — {year: {mode, qualification, seeding, byes, pointsRounds, customRounds,
                               bracketSize, h2hRounds, h2hRoundWeeks, h2hReseed,
                               startWeek, endWeek, recognizeLeagueChampions,
                               scoringSettings, finalRankings,
                               worldcupGroups, worldcupSchedule, worldcupBracket,
                               worldcupRegWeeks, worldcupAdvanceCount, worldcupWeeksPerRound,
                               worldcupTiebreakers, worldcupBracketMode,
                               customRounds.matchups}}
  scoringSettings/  — {year: {platform: {field: value}}}
  analyticsCache/   — {drafts: {...}, weeklyHighlights: {...}, recap: {...}}

gmd/tournamentChats/{tid}_{year}/
  — {messageId: {user, text, ts, type:"text"|"gif"|"poll", options?, votes?, question?}}

gmd/publicTournaments/{tid}/
  — Meta fields + leagueCount, registrationCount, standingsCache, participantMap
  — playoffMode, createdBy written by _writePublicSummary
  — NOT written if meta.isPrivate === true (_writePublicSummary removes the node instead)
  — playoffs/{year} — published snapshot
```

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
| `/mfl/userLeagues` | POST | List user's MFL leagues |
| `/mfl/login` | POST | Get MFL cookie |
| `/mfl/bundle` | POST | Full MFL league data bundle |
| `/mfl/liveScoring` | POST | MFL live scoring for a specific week |
| `/mfl/playoffBracket` | POST | MFL playoff bracket |
| `/mfl/auctionResults` | POST | MFL auction results |
| `/mfl/players` | POST | MFL player universe |
| `/mfl/rosters` | POST | MFL rosters for a specific week |
| `/tournament/draft` | POST | Draft picks for one league |
| `/tournament/rosters` | POST | Rosters for one league |
| `/tournament/recap` | POST | AI-generated weekly recap via Claude Haiku |
| `/auth/passwordReset` | POST | Look up real email, generate Firebase reset link, send via Resend |
| `/draft/status` | GET | Read `gmd/draftStatus` from Firebase (debug) |
| `/draft/test` | GET | Step-by-step diagnostic: watchIndex → Sleeper → Firebase write |
| `/draft/diagnose?username=X` | GET | Full per-user report: leagues, filter, draftStatus vs Sleeper, mismatches |
| `/draft/rebuildWatchIndex` | GET | Backfill draftWatchIndex for all users (one-time admin) |
| `/draft/forcecheck` | GET | Force-check a specific league's draft status |

---

## Key Patterns & Gotchas

### Firebase writes
- Always use `.update()` for merges, never `.set()` on existing nodes with data you want to keep
- Firebase Realtime DB keys cannot contain: `. # $ / [ ]` — sanitize user-supplied strings
- `GMDB.saveLeagues` (plural) is correct — `saveLeague` (singular) does not exist
- For large datasets (e.g. 300+ registrations), always fetch the specific child ref directly

### Mobile scroll
- `base.css`: `.screen.active { overflow: hidden }` — clips everything at mobile
- To make a view scrollable: add `#view-{name}.active { overflow-y: auto !important; overflow-x: hidden !important; height: calc(100dvh - 48px) !important; }` to the relevant CSS file

### CSS/JS versioning
- `locker.css` is at **v=22**, `auth.css` at **v=6**, `tournament.css` at **v=6**, `draft-ticker.js` at **v=5**
- Bump `?v=N` in `index.html` when deploying changes to force cache bust
- `index.html` itself has `no-cache` meta tags — browsers always fetch a fresh copy

### Draft Ticker
- **Client-first:** `_initialLoad()` checks Sleeper directly for all leagues on load. No Worker dependency for discovery.
- **`mostRecentSeason` filter:** dynasty chains store one Firebase entry per season. Only include leagues where `l.season === l.mostRecentSeason` (or `mostRecentSeason` absent). Without this, a 6-year dynasty shows up 6× in the watchList.
- **Tournament bloat:** `_buildWatchList` section 2 only *annotates* leagues already in watchList with tournament name — does NOT add new leagues just because user is tournament admin. Prevents BOTS 336-league explosion.
- **`gmd/draftStatus` rules:** `.write: false` for clients — only Worker writes via DB secret. Client attempts to write will get `permission_denied` (harmless, fire-and-forget).
- **`gmd/draftWatchIndex` rules:** `.read: auth != null, .write: auth != null` — clients write their own slot.
- **Impersonation + diagnose:** Use `AdminImpersonate.viewAs("username")` then `DraftTicker.diagnose()` to debug any user's ticker state without touching their account.
- **`/draft/rebuildWatchIndex`:** Run once after deployment to backfill all existing users' watchIndex entries.

### Tournament type detection
- Always use `_tMode(t)` — never `t.playoff?.mode` or `t.playoffs?.mode`
- `_tMode` reads `t.playoffs[mostRecentYear].mode` first, then flat `t.playoffs.mode`, then defaults to `"total_points"`

### Tournament private flag
- `meta.isPrivate = true` prevents `_writePublicSummary` from writing to `gmd/publicTournaments/{tid}`
- If already published, saving with the flag checked removes the public node

### Participant sync
- Sleeper `u.username` can be null — fall back to `u.display_name`
- Use `u.user_id` as `dedupKey` (always unique)
- DLR stores Sleeper identity at `platforms/sleeper/sleeperUsername` (primary), also check `platforms/sleeper/username` and `platforms/sleeper/displayName`

### Worker deployment
- Changes to `worker.js` require a **separate paste into Cloudflare dashboard** — git push alone does nothing
- `YAHOO_REDIRECT_URI` must be `https://mfl-proxy.mraladdin23.workers.dev/auth/yahoo/callback`

### Auth
- Synthetic email format: `username@gmdynasty.app`
- Password reset: worker mints service account JWT → calls Firebase Auth Admin API → sends link via Resend
- Resend sender: `support@dynastylockerroom.com`
- Worker secrets: `RESEND_API_KEY`, `FIREBASE_DB_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`

### Yahoo
- Test on **mobile data** — home router blocks workers.dev and firebaseio.com WebSocket

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
Worker deployed by pasting into Cloudflare dashboard editor.
Platforms: Sleeper ✅, MFL ✅, Yahoo ✅.
[Attach DLR_PROJECT_SUMMARY.md + DLR_TODO_LIST.md]
Today I want to work on: [specific task]
Here are the relevant files: [attach files]
```
