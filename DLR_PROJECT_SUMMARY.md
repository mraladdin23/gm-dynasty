# Dynasty Locker Room (DLR) — Project Summary
*For use as context in a new Claude chat session*
*Updated: May 5, 2026 — B1 (password reset), B2 (salary saving), X1 (registration stickiness), X2 (live draft updates) all resolved.*

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
- `tournament.css` — Tournament module styles. v=4. Contains all playoff UI styles, Players tab list view, year pips, analytics tabs, World Cup bracket canvas.

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
- `index.html` — Public tournament directory and detail page. Reads from `gmd/publicTournaments/` (no auth required). Has mobile tab `<select>` dropdown, year selector, playoff tab with full round/standings/bracket rendering. Players tab fully at parity with internal. World Cup mode: group dropdown in Standings, tight bracket canvas in Playoffs.

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
                               scoringSettings, finalRankings,
                               worldcupGroups, worldcupSchedule, worldcupBracket,
                               worldcupRegWeeks, worldcupAdvanceCount, worldcupWeeksPerRound,
                               worldcupTiebreakers, worldcupBracketMode,
                               customRounds.matchups}}
  scoringSettings/  — {year: {platform: {field: value}}}
  analyticsCache/   — {drafts: {...}, weeklyHighlights: {...}, recap: {...}}

gmd/publicTournaments/{tid}/
  — Meta fields + leagueCount, registrationCount, standingsCache, participantMap
  — playoffs/{year} — published snapshot with computedRounds, leagueChamps, standings,
                       finalRankings (all with displayName), worldcup config fields
  — adpByYear/{year} — published ADP data for public site
```

### Key behaviors

**Standings display name:** Uses participant `displayName`. Lookup keyed by `sleeperUsername` (stable) first, then display name / team name.

**Playoff config is year-scoped:** Each season stored at `playoffs/{year}/`. Admin selects year via year selector; `_activePoYear` passed through rerender chain.

**Qualification engine:** `_runCompositeQual` with `_groupKey`. Falls back to `leagueName` when `division/conference` fields are empty.

**Publish:** Fetches all playoff weeks, computes `computedRounds` and `finalRankings`. Writes to both `publicTournaments/{tid}/playoffs/{year}` AND `tournaments/{tid}/playoffs/{year}/finalRankings`. **Players tab stats (PO apps, rank, titles, pips) only activate after publish with a champion in `finalRankings`.**

**finalRankings:** Rank 1 = overall champion. Mode-specific:
- `total_points`: ranked by PF desc
- `points_rounds`: backwards from round simulation (supports multi-week rounds via `weeksPerRound`)
- `custom_rounds`: simulates PF-based group advancement; includes `customRounds.matchups` for H2H assignment
- `h2h_bracket`: simulates bracket from `_weekScoreCache`; falls back to seed order
- `worldcup`: reads actual `{a,b,scoreA,scoreB}` bracket objects; bracket champion first, then eliminated by deepest round (same-round tie: score desc), then group-stage eliminated, then non-qualifiers by group PF. Includes `groupWins`, `groupLosses`, `groupPF`, `isGroupWinner` per entry.

**_buildPoByYear(t):** PRIMARY: reads `t.playoffs[year].finalRankings`. FALLBACK: derives from `_computeQualification()`. Keyed by `_sk(displayName)` + `_sk(teamName)` variants. Name-matching fallback: tries `c.seasons[yr][].teamName` variants when `displayName` lookup fails (catches bracket name mismatches).

**Players tab gating:** PO appearances, rank, titles, and year pips only count/show when `finalRankings` exists AND contains `isTChamp: true` (bracket is fully complete and published). Before that, all playoff stats show blank/zero and pips show grey "in progress".

**Diagnostic:** `diagQual("name")` in browser console.

---

### World Cup Mode — Full Architecture

#### Firebase paths (under `playoffs/{year}/`)
```
worldcupGroups          — [{name, advanceCount, members[]}]
worldcupSchedule        — {groupIndex: {weekIndex: [{home, away}]}}
worldcupBracket         — [[{a,b,scoreA,scoreB},...], [...]]  (array of rounds)
worldcupBracketMode     — "manual" | "random"
worldcupRegWeeks        — number of regular season weeks
worldcupAdvanceCount    — default advance count per group
worldcupWeeksPerRound   — weeks per playoff bracket round
worldcupTiebreakers     — ordered array of tiebreaker keys
customRounds.matchups   — [roundIdx][groupIdx] = [teamName, ...]
```

#### Key behaviors
- **Group standings:** Computed from `worldcupSchedule` + Sleeper scores, NOT from Sleeper league records. Full tiebreaker chain — 3+ way tie: overall pt diff only; 2-way: configured chain (h2h_record_tied → h2h_pt_diff → overall_pt_diff → overall_pf).
- **Bracket canvas:** Absolute positioning — `centreR0(mi)`, `centreOf(ri,mi)`, `topOf(ri,mi)`, `cardH=44`, `pairG=8`. Both admin and public use identical math. `--wc-gap` CSS var drives connector line heights.
- **Regular season gate:** `_wcRegSeasonComplete()` checks all scheduled weeks have scores before showing advance/eliminate badges or bracket setup.
- **Bracket assignment:** After each scored round, "Set [Round N] Matchups" panel shows below canvas with free-pick dropdowns (any winner into any slot). ✕ Clear This Round wipes that round + downstream.
- **Score refresh:** Uses `_wcTeamInfoMap` (teamName → {teamId, leagueId}) for direct cross-league lookup. Sums across `worldcupWeeksPerRound`.
- **Tab layout:** Playoffs tab = bracket only. Standings tab = group dropdown selector (shows standings + week matchup cards for selected group).
- **Players tab:** `groupWins/groupLosses/groupPF` override Sleeper league records. `isGroupWinner` = finished 1st in group = counts as title. All gated on bracket complete.

#### _wcQualified(g, gi) — key function
Sorts group members by in-group W/L/PF/tiebreaker using `_wcGroupRec()` (schedule + `_weekScoreCache`). Falls back to Sleeper standingsCache if no scores. Used for bracket setup dropdowns and `finalRankings` advancer identification.

---

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
- Year pips (worldcup): gold=bracket champion, green=won group, red=didn't win group, grey=in progress/absent
- Year pips (other modes): gold=tournament champ, green=qualified, red=eliminated
- All playoff stats gated behind bracket complete (champion in finalRankings)
- Public `tournaments/index.html` fully at parity with internal tab

### Points Rounds — Multi-Week Support
- Each round has optional `weeksPerRound` field (default 1)
- `_wsCombined_(tm, startWk, numWks)` sums scores across weeks
- Round header shows "Weeks 14–15" format when wpr > 1

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
| `/tournament/rosters` | POST | Rosters for one league (MFL/Yahoo) |
| `/tournament/recap` | POST | AI-generated weekly recap via Claude Haiku |
| `/auth/passwordReset` | POST | Look up real email, generate Firebase reset link, send via Resend |

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

### Worker deployment
- Changes to `worker.js` require a **separate paste into Cloudflare dashboard** — git push alone does nothing
- `YAHOO_REDIRECT_URI` must be `https://mfl-proxy.mraladdin23.workers.dev/auth/yahoo/callback`

### Tournament Draft Live Polling
-  /  in  poll Sleeper every 15s when 
- Both the 24h Firebase cache and 5-min in-memory cache are bypassed entirely for active drafts
- Worker  now prefers  draft over completed ones
- MFL/Yahoo still require manual refresh (↺) during live drafts — no public picks API
- If a draft shows stale pick count: clear the specific Firebase cache entry (see Console Scripts)

### Yahoo
- Test on **mobile data** — home router blocks workers.dev and firebaseio.com WebSocket

### World Cup bracket name matching
- `_wcQualified()` and `_buildFinalRankings` worldcup branch both normalize names via `_skWC()` / `_sk3()`
- `_buildPoByYear` writes keys under both `displayName` and `teamName` variants
- Career loop tries `cKey = _sk(displayName)` first, then falls back to `c.seasons[yr][].teamName` variants — handles cases where bracket-assigned names differ from participant displayNames

### Auth
- Synthetic email format: `username@gmdynasty.app` — Firebase Auth only knows this email, never the real one
- Password reset: worker mints service account JWT → calls Firebase Auth Admin API with `returnOobLink: true` → sends link to real email via Resend
- Resend sender: `support@dynastylockerroom.com` (domain verified on dynastylockerroom.com)
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
