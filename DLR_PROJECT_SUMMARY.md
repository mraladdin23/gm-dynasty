# Dynasty Locker Room (DLR) — Project Summary
*For use as context in a new Claude chat session*
*Updated: May 7, 2026 — Tournament landing page overhaul, participant sync, mobile fixes complete.*

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
- `index.html` — Full SPA shell. All screens defined here. Firebase SDK loaded at bottom of body. CSS cache-busted: `locker.css v=22`, `auth.css v=6`, `tournament.css v=6`. Viewport meta includes `viewport-fit=cover` for PWA safe area support.
- `worker.js` — Cloudflare Worker. MFL bundle fetches, Yahoo OAuth flow + bundle + playerStats + tournament draft + tournament rosters. Deploy by pasting into Cloudflare dashboard.

### `css/`
- `base.css` — Global variables, reset, typography. `.screen` uses `min-height: 100dvh`. `.screen.active { overflow: hidden }` on mobile.
- `auth.css` — Login/register screen styles
- `locker.css` — All app UI styles. v=22. Mobile: `100dvh` for app-view height, `env(safe-area-inset-top)` for nav + detail panel.
- `tournament.css` — Tournament module styles. **v=6.** Contains all playoff UI styles, Players tab list view, year pips, analytics tabs, World Cup bracket canvas, weekly matchup cards (`.trn-wmu-*`), message board (`.trn-board-*`), unified registration form field list (`.trn-form-field-*`), tournament landing page list rows (`.trn-row-*`, `.trn-list`), tournament guide modal (`.trn-guide-*`).

### `js/` — Core modules (all vanilla JS IIFEs)

| File | Purpose |
|------|---------|
| `app.js` | Orchestrates screens, auth state, global monitors, button handlers. |
| `auth.js` | Firebase Auth wrapper. `sendPasswordReset(username)` calls worker endpoint which emails reset link via Resend to real address. |
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
| `salary.js` | Salary cap management. Force-reads from Firebase after every save to bust SDK cache. |
| Other modules | `auction.js`, `playercard.js`, `idb-cache.js`, `chat.js`, `leaguegroups.js`, `manager-search.js`, `playerreport.js`, `config.js` |

### `tournaments/`
- `index.html` — Public tournament directory and detail page. Reads from `gmd/publicTournaments/` (no auth required). Has mobile tab `<select>` dropdown, year selector, playoff tab with full round/standings/bracket rendering. Players tab fully at parity with internal. World Cup mode: group dropdown in Standings, tight bracket canvas in Playoffs. Message board tab (💬 Board) — read-only for anonymous, shows sign-in prompt. Landing page uses same `.trn-row-*` list layout as internal app. Filters: Type (playoff mode) + Admin (createdBy).

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
  meta/             — name, tagline, status, regType, rankBy, playoffStartWeek, bio, createdAt, createdBy
  leagues/          — batch structure: {batchId: {platform, year, leagues: {leagueId: {name, conference, division}}}}
  roles/            — {username: {role: "admin"|"sub_admin"}}
  registrationForm/ — {fields, optionalFields, customQuestions, fieldOrder}
                      fieldOrder: [{type:"std"|"opt"|"custom", key?, question?, questionType?, required?, options?}]
  registrations/    — {rid: {displayName, email, status, custom_0, custom_1, ..., importedAt, reviewedAt, reviewedBy}}
  participants/     — {pid: {displayName, teamName, email,
                             sleeperUserId, sleeperUsername, sleeperDisplayName,
                             mflEmail, yahooUsername,
                             twitterHandle, gender, years[], dlrLinked, dlrUsername, syncedAt}}
  standingsCache/   — {year_leagueId: {leagueName, platform, year, conference, division, champion,
                                        leagueStatus, teams:[{teamId, userId, sleeperUsername,
                                        teamName, wins, losses, ties, pf, pa}], lastSynced}}
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
  — playoffMode (string) — written by _writePublicSummary via _tMode(t)
  — createdBy (string) — written by _writePublicSummary from meta.createdBy
  — playoffs/{year} — published snapshot with computedRounds, leagueChamps, standings,
                       finalRankings (all with displayName), worldcup config fields,
                       h2hRounds, h2hRoundWeeks, h2hReseed
  — adpByYear/{year} — published ADP data for public site
```

### Key tournament helper functions

**`_tMode(t)`** — Derives the active playoff mode from a tournament object. Reads `t.playoffs[mostRecentYear].mode` (year-keyed), falls back to `t.playoffs.mode` (legacy flat), then `"total_points"`. Always use this instead of reading `t.playoff?.mode` (wrong key).

**`_backfillPublicSummaries()`** — Runs silently after `_loadTournaments()` on every page load. Re-publishes any public tournament node missing `playoffMode` or `createdBy`. No-op once all nodes are up to date.

**`_autoSyncParticipants(tid, t)`** — Fetches rosters from all league batches (Sleeper/MFL/Yahoo), deduplicates by `dedupKey` (Sleeper: `user_id`, MFL: email, Yahoo: nickname), upserts participant records, then calls `_matchParticipantsToDLR` on all participants. Does a fresh Firebase read before dedup to avoid stale-snapshot duplicates. Single `participantsRef.update(updates)` write.

**`_matchParticipantsToDLR(tid, participantsMap)`** — Reads `gmd/users/*/platforms` and builds lookup indexes for all three platforms:
- Sleeper: `platforms/sleeper/sleeperUsername`, `platforms/sleeper/username`, `platforms/sleeper/displayName`
- MFL: `platforms/mfl/mflEmail`
- Yahoo: `platforms/yahoo/username`, `platforms/yahoo/yahooUsername`
Returns `{ newMatches, alreadyLinked, total }` — caller handles toast and re-render.

### Key behaviors

**Standings display name:** Uses participant `displayName`. Lookup keyed by `sleeperUsername` (stable) first, then display name / team name.

**Playoff config is year-scoped:** Each season stored at `playoffs/{year}/`. Admin selects year via year selector; `_activePoYear` passed through rerender chain.

**Qualification engine:** `_runCompositeQual` with `_groupKey`. Falls back to `leagueName` when `division/conference` fields are empty.

**Publish:** Fetches all playoff weeks, computes `computedRounds` and `finalRankings`. Writes to both `publicTournaments/{tid}/playoffs/{year}` AND `tournaments/{tid}/playoffs/{year}/finalRankings`. **Players tab stats (PO apps, rank, titles, pips) only activate after publish with a champion in `finalRankings`.**

**Regular season gating (all modes):**
- `_regSeasonComplete(t, po, year)` — returns true when `latestWeekPlayed >= po.startWeek - 1`
- `_playoffsUnderway(t, po, year)` — returns true when `latestWeekPlayed >= po.startWeek`
- `_computeQualCount(t, po)` — derives playoff qualifier count for cut-line positioning

**finalRankings:** Rank 1 = overall champion. Mode-specific:
- `total_points`: ranked by PF desc
- `points_rounds`: backwards from round simulation (supports multi-week rounds via `weeksPerRound`)
- `custom_rounds`: simulates PF-based group advancement; includes `customRounds.matchups` for H2H assignment
- `h2h_bracket`: simulates bracket from `_weekScoreCache`; falls back to seed order
- `worldcup`: reads actual `{a,b,scoreA,scoreB}` bracket objects; bracket champion first, then eliminated by deepest round, then group-stage eliminated, then non-qualifiers by group PF

---

### Tournament Landing Page

**Internal app list rows** use `.trn-row` → `.trn-row-main` + `.trn-row-right`:
```
.trn-row-main (flex:1)
  .trn-row-line1  ← tournament name
  .trn-row-line2  ← tagline/description
  .trn-row-line3  ← type badge + league count + reg count + admin
.trn-row-right (260px desktop, 100% mobile)
  trn-status-badge
  .trn-row-actions (162px desktop, auto mobile)
    btn-primary (Manage)
    btn-secondary (View)
```

Desktop fixed widths live in `@media (min-width: 701px)` — not the base rule — so mobile never has to fight overrides.

Mobile (`≤700px`): rows stack to column, `trn-row-right` goes full width with `border-top` separator. `overflow-x: hidden !important` on `#view-tournament.active` prevents horizontal clipping from `locker.css .screen.active`.

**Filter row:** Three selects (View/Type/Admin) using `flex: 1 1 0` + `flex-wrap: nowrap`. Type built from `_tMode(t)` across all tournaments. Admin from `meta.createdBy`.

**"My Tournaments"** tab: `discoveredBy[currentUsername]` OR `dlrLinked + dlrUsername === currentUsername` as participant. Being admin-only does NOT qualify.

**Public site:** Same row structure, same `tournament.css`. Type + Admin filters only (no status filter). `playoffMode` and `createdBy` must be present in the public node — auto-backfilled by `_backfillPublicSummaries()`.

---

### Registration Form — fieldOrder

The form builder saves `fieldOrder[]` — an ordered array of all fields including std, opt, and custom questions interleaved. This is the authoritative order for both the admin builder and user-facing form.

```js
fieldOrder: [
  { type: "std", key: "displayName" },
  { type: "std", key: "email" },
  { type: "opt", key: "sleeperUsername" },
  { type: "custom", question: "Your question?", questionType: "select", required: true,
    options: ["Option A", "Option B"] },
  { type: "opt", key: "gender" }
]
```

Custom question answers are stored as `custom_0`, `custom_1` etc in Firebase — never the raw question text. The import template uses these same safe keys.

---

### H2H Bracket Rounds

```js
po.h2hRounds: [
  { weeksPerRound: 1, blend: null },     // Round 1
  { weeksPerRound: 1, blend: null },     // Semifinals
  { weeksPerRound: 2, blend: {...} }     // Championship
]
po.h2hRoundWeeks: [1, 1, 2]             // derived array for backward compat
po.h2hReseed: true|null                 // reseed after each round
```

---

### Tab structure (internal admin + user)
```
Admin tabs: Overview | Leagues | Roles | Registration Form | Registrants |
            Participants | Standings | Playoffs | Info/Rules |
            Players | Most Rostered | ADP vs Finish | Match Analysis | Matchups | Board

User tabs:  Info | Rules | Standings | Playoffs | Draft | Match Analysis | Matchups |
            Rosters | Players | Most Rostered | ADP vs Finish | Board
```

---

### Message Board

Firebase path: `gmd/tournamentChats/{tid}_{year}/`
Message types: `text`, `gif`, `poll`
Poll votes stored as: `{messageId}/votes/{username} = optionIndex`

---

### Weekly Matchups Tab

State variables: `_weeklyMuWeek`, `_weeklyMuFilter`, `_weeklyMuPage`, `_weeklyMuCache`
All four cleared on tournament switch and year change. Cache TTL: 5 minutes.

---

### Draft Tab

- **Live updates:** `_draftForceRefresh` flag bypasses Firebase + in-memory cache when set. Set by refresh button and by live poll when new picks detected. Cleared after fetch completes.
- **League dropdown:** `selected` attribute applied to current `_draftLeague` so it doesn't snap back on re-render.
- **Live poll:** `_startDraftPoll` / `_stopDraftPoll` — Sleeper every 15s for `draft_status === "drafting"`. MFL/Yahoo still require manual refresh.

---

## Worker Endpoints

| Path | Method | Purpose |
|------|--------|---------|\
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

---

## Key Patterns & Gotchas

### Firebase writes
- Always use `.update()` for merges, never `.set()` on existing nodes with data you want to keep
- Firebase Realtime DB keys cannot contain: `. # $ / [ ]` — sanitize user-supplied strings
- `GMDB.saveLeagues` (plural) is correct — `saveLeague` (singular) does not exist
- For large datasets (e.g. 300+ registrations), always fetch the specific child ref (`_tRegsRef`) directly rather than reading the full tournament snapshot

### Mobile scroll
- `base.css`: `.screen.active { overflow: hidden }` — clips everything at mobile
- To make a view scrollable: add `#view-{name}.active { overflow-y: auto !important; overflow-x: hidden !important; height: calc(100dvh - 48px) !important; }` to the relevant CSS file
- Setting `overflow-y` explicitly also sets `overflow-x: auto` — always set both explicitly

### CSS versioning
- `locker.css` is at **v=22**, `auth.css` at **v=6**, `tournament.css` at **v=6**
- Bump `?v=N` in the `<link>` tag in `index.html` when deploying CSS changes

### Tournament type detection
- Always use `_tMode(t)` — never `t.playoff?.mode` (wrong key, no 's') or `t.playoffs?.mode` (misses year-keyed config)
- `_tMode` reads `t.playoffs[mostRecentYear].mode` first, then flat `t.playoffs.mode`, then defaults to `"total_points"`

### Tournament year/string normalization
- `lc.year` in standingsCache can be a **number** (e.g. `2025`); `Object.keys(poByYear)` returns **strings**
- Always normalize with `String(yr)` when comparing or using as Set/Map keys

### Participant sync
- Sleeper `u.username` can be null for users who never set one — fall back to `u.display_name`
- Use `u.user_id` as `dedupKey`, not username (user_id is always present and unique)
- DLR stores Sleeper identity at `platforms/sleeper/sleeperUsername` (primary), also check `platforms/sleeper/username` and `platforms/sleeper/displayName`
- Always do a fresh `_tParticipantsRef(tid).once("value")` read before building dedup maps — never rely on the tournament snapshot's `participants` node which may be stale

### Worker deployment
- Changes to `worker.js` require a **separate paste into Cloudflare dashboard** — git push alone does nothing
- `YAHOO_REDIRECT_URI` must be `https://mfl-proxy.mraladdin23.workers.dev/auth/yahoo/callback`

### Registration Import
- Status values in CSV must be lowercase (`approved`, `pending`, `denied`) — importer normalizes automatically
- Custom question columns must use `custom_0`, `custom_1` etc as headers (not question text)

### Yahoo
- Test on **mobile data** — home router blocks workers.dev and firebaseio.com WebSocket

### Auth
- Synthetic email format: `username@gmdynasty.app` — Firebase Auth only knows this email
- Password reset: worker mints service account JWT → calls Firebase Auth Admin API with `returnOobLink: true` → sends link to real email via Resend
- Resend sender: `support@dynastylockerroom.com`
- Worker secrets: `RESEND_API_KEY`, `FIREBASE_DB_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`

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
