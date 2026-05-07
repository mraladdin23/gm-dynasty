# Dynasty Locker Room (DLR) — Project Summary
*For use as context in a new Claude chat session*
*Updated: May 6, 2026 — Tournament message board, weekly matchups tab, form builder overhaul, H2H bracket rounds builder, registration import fixes all complete.*

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
- `index.html` — Full SPA shell. All screens defined here. Firebase SDK loaded at bottom of body. CSS cache-busted: `locker.css v=22`, `auth.css v=6`, `tournament.css v=5`. Viewport meta includes `viewport-fit=cover` for PWA safe area support.
- `worker.js` — Cloudflare Worker. MFL bundle fetches, Yahoo OAuth flow + bundle + playerStats + tournament draft + tournament rosters. Deploy by pasting into Cloudflare dashboard.

### `css/`
- `base.css` — Global variables, reset, typography. `.screen` uses `min-height: 100dvh`. `.screen.active { overflow: hidden }` on mobile.
- `auth.css` — Login/register screen styles
- `locker.css` — All app UI styles. v=22. Mobile: `100dvh` for app-view height, `env(safe-area-inset-top)` for nav + detail panel.
- `tournament.css` — Tournament module styles. **v=5.** Contains all playoff UI styles, Players tab list view, year pips, analytics tabs, World Cup bracket canvas, weekly matchup cards (`.trn-wmu-*`), message board (`.trn-board-*`), unified registration form field list (`.trn-form-field-*`).

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
- `index.html` — Public tournament directory and detail page. Reads from `gmd/publicTournaments/` (no auth required). Has mobile tab `<select>` dropdown, year selector, playoff tab with full round/standings/bracket rendering. Players tab fully at parity with internal. World Cup mode: group dropdown in Standings, tight bracket canvas in Playoffs. Message board tab (💬 Board) — read-only for anonymous, shows sign-in prompt.

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
  registrationForm/ — {fields, optionalFields, customQuestions, fieldOrder}
                      fieldOrder: [{type:"std"|"opt"|"custom", key?, question?, questionType?, required?, options?}]
  registrations/    — {rid: {displayName, email, status, custom_0, custom_1, ..., importedAt, reviewedAt, reviewedBy}}
  participants/     — {pid: {displayName, teamName, email, sleeperUsername, mflEmail,
                             yahooUsername, twitterHandle, gender, years[], dlrLinked, dlrUsername}}
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
  — playoffs/{year} — published snapshot with computedRounds, leagueChamps, standings,
                       finalRankings (all with displayName), worldcup config fields,
                       h2hRounds, h2hRoundWeeks, h2hReseed
  — adpByYear/{year} — published ADP data for public site
```

### Key behaviors

**Standings display name:** Uses participant `displayName`. Lookup keyed by `sleeperUsername` (stable) first, then display name / team name.

**Playoff config is year-scoped:** Each season stored at `playoffs/{year}/`. Admin selects year via year selector; `_activePoYear` passed through rerender chain.

**Qualification engine:** `_runCompositeQual` with `_groupKey`. Falls back to `leagueName` when `division/conference` fields are empty.

**Publish:** Fetches all playoff weeks, computes `computedRounds` and `finalRankings`. Writes to both `publicTournaments/{tid}/playoffs/{year}` AND `tournaments/{tid}/playoffs/{year}/finalRankings`. **Players tab stats (PO apps, rank, titles, pips) only activate after publish with a champion in `finalRankings`.**

**Regular season gating (all modes):**
- `_regSeasonComplete(t, po, year)` — returns true when `latestWeekPlayed >= po.startWeek - 1`. Controls advance/cut badge visibility in standings.
- `_playoffsUnderway(t, po, year)` — returns true when `latestWeekPlayed >= po.startWeek`. Gates the playoff tab for non-admin users (shows "Regular Season In Progress" message otherwise).
- `_computeQualCount(t, po)` — derives playoff qualifier count for cut-line positioning.
- Both check `po.startWeek` against max games played from `standingsCache`.

**finalRankings:** Rank 1 = overall champion. Mode-specific:
- `total_points`: ranked by PF desc
- `points_rounds`: backwards from round simulation (supports multi-week rounds via `weeksPerRound`)
- `custom_rounds`: simulates PF-based group advancement; includes `customRounds.matchups` for H2H assignment
- `h2h_bracket`: simulates bracket from `_weekScoreCache`; falls back to seed order
- `worldcup`: reads actual `{a,b,scoreA,scoreB}` bracket objects; bracket champion first, then eliminated by deepest round, then group-stage eliminated, then non-qualifiers by group PF.

---

### Registration Form — fieldOrder

The form builder now saves `fieldOrder[]` — an ordered array of all fields including std, opt, and custom questions interleaved. This is the authoritative order for both the admin builder and user-facing form.

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

Custom question answers are stored as `custom_0`, `custom_1` etc in Firebase — never the raw question text. The import template uses these same safe keys. The template's comment lines map `custom_N` back to the question text.

**Import notes:**
- Status values are normalized to lowercase on import (`"Approved"` → `"approved"`)
- CSV headers are sanitized via `_sanitizeKey` — all Firebase-illegal characters stripped
- Records with unrecognized status show in "⚠️ Unknown Status" section with bulk fix link
- `_renderRegistrantsTab` always fetches from `_tRegsRef(tid)` directly (avoids stale tournament snapshot for large datasets)

---

### H2H Bracket Rounds

H2H bracket now supports fully configurable rounds in Section D "Round Config (H2H)":

```js
po.h2hRounds: [
  { weeksPerRound: 1, blend: null },     // Round 1
  { weeksPerRound: 1, blend: null },     // Semifinals
  { weeksPerRound: 2, blend: {...} }     // Championship
]
po.h2hRoundWeeks: [1, 1, 2]             // derived array for backward compat
po.h2hReseed: true|null                 // reseed after each round
```

`_wprFor(ri)` — prefers `h2hRounds[ri].weeksPerRound`, falls back to `h2hRoundWeeks[ri]`, then legacy `h2hWeeksPerRound` scalar.
`_roundStart(ri)` — sums all prior rounds' wpr to compute absolute NFL start week.
Bracket canvas uses the same tight absolute-position math as World Cup (T7 complete).

---

### Tab structure (internal admin + user)
```
Admin tabs: Overview | Leagues | Roles | Registration Form | Registrants |
            Participants | Standings | Playoffs | Info/Rules |
            Players | Most Rostered | ADP vs Finish | Match Analysis | Matchups | Board

User tabs:  Info | Rules | Standings | Playoffs | Draft | Match Analysis | Matchups |
            Rosters | Players | Most Rostered | ADP vs Finish | Board
```

Tab routing:
- **Matchups** → `_renderWeeklyMatchups` (ESPN-style weekly card view, week + conf/div/league filter)
- **Match Analysis** → `_renderAnalyticsMatchups` (highlights, high scores, blowouts, histogram)
- **Board** → `_renderBoardTab` (Firebase real-time message board with emoji/GIF/poll)

---

### Message Board

Firebase path: `gmd/tournamentChats/{tid}_{year}/`
Message types: `text`, `gif`, `poll`
Poll votes stored as: `{messageId}/votes/{username} = optionIndex`

Features:
- Real-time Firebase listener (`limitToLast(100)`)
- Emoji picker (30 emojis), GIF search (Tenor API), smack talk presets, poll creator (up to 4 options)
- Chat bubble layout: yours right/accent, theirs left
- Admin deletes any; users delete own
- Public page: read-only, "Sign in to Dynasty Locker Room" prompt

Firebase rules needed:
```json
"tournamentChats": {
  ".read": true,
  ".write": "auth != null"
}
```

---

### Weekly Matchups Tab

`_renderWeeklyMatchups(tid, t, body)` — the ESPN-style matchups tab.

Filter dropdown always visible with three tiers:
- All Leagues
- 📂 Conference name / 🗂 Division name (if configured on batch leagues)
- 🏈 Individual league names (always present, grouped under "By League" when conf/div also exist)

State variables: `_weeklyMuWeek`, `_weeklyMuFilter`, `_weeklyMuPage`, `_weeklyMuCache`
All four cleared on tournament switch (`_openTournamentView`) and year change.
Cache TTL: 5 minutes. Refresh button clears cache for current week.

---

### Points Rounds — Multi-Week Support
- Each round has optional `weeksPerRound` field (default 1)
- `_wsCombined_(tm, startWk, numWks)` sums scores across weeks
- Round header shows "Weeks 14–15" format when wpr > 1
- Single championship window: admin can delete all non-championship rounds (min 1 round)

---

### World Cup Mode — Key Details
- Group standings computed from `worldcupSchedule` + Sleeper scores (not Sleeper league records)
- Tight bracket canvas: `centreR0(mi)`, `centreOf(ri,mi)`, `topOf(ri,mi)`, `cardH=44`, `pairG=8`
- `_wcRegSeasonComplete()` gates advance/eliminate badges and bracket setup
- `_wcQualified()` sorts by in-group W/L/PF/tiebreaker

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

---

## Key Patterns & Gotchas

### Firebase writes
- Always use `.update()` for merges, never `.set()` on existing nodes with data you want to keep
- Firebase Realtime DB keys cannot contain: `. # $ / [ ]` — sanitize user-supplied strings
- `GMDB.saveLeagues` (plural) is correct — `saveLeague` (singular) does not exist
- For large datasets (e.g. 300+ registrations), always fetch the specific child ref (`_tRegsRef`) directly rather than reading the full tournament snapshot — the SDK can truncate large payloads

### Mobile scroll
- `base.css`: `.screen.active { overflow: hidden }` — clips everything at mobile
- To make a view scrollable on mobile: add `#view-{name}.active { overflow-y: auto !important; height: calc(100dvh - 48px) !important; }` to the relevant CSS file

### CSS versioning
- `locker.css` is at **v=22**, `auth.css` at **v=6**, `tournament.css` at **v=5**
- Bump `?v=N` in the `<link>` tag in `index.html` when deploying CSS changes

### Tournament year/string normalization
- `lc.year` in standingsCache can be a **number** (e.g. `2025`); `Object.keys(poByYear)` returns **strings**
- Always normalize with `String(yr)` when comparing or using as Set/Map keys

### Worker deployment
- Changes to `worker.js` require a **separate paste into Cloudflare dashboard** — git push alone does nothing
- `YAHOO_REDIRECT_URI` must be `https://mfl-proxy.mraladdin23.workers.dev/auth/yahoo/callback`

### Tournament Draft Live Polling
- `_startDraftPoll` / `_stopDraftPoll` poll Sleeper every 15s when `draft_status === "drafting"`
- Both the 24h Firebase cache and 5-min in-memory cache are bypassed entirely for active drafts
- Worker prefers `"drafting"` draft over completed ones
- MFL/Yahoo still require manual refresh (↺) during live drafts

### Registration Import
- Status values in CSV must be lowercase (`approved`, `pending`, `denied`) — importer normalizes automatically
- Custom question columns must use `custom_0`, `custom_1` etc as headers (not question text)
- Download the template first — it reflects current `fieldOrder` and includes `# custom_N = Question` comments

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
