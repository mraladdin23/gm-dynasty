# Dynasty Locker Room (DLR) — Project Summary
*For use as context in a new Claude chat session*
*Updated: May 20, 2026 — Decathlon mode, registration year-scoping, wizard polish, snake draft fix, public site parity.*

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
- `index.html` — Full SPA shell. CSS: `locker.css v=22`, `auth.css v=6`, `tournament.css v=6`. JS: `draft-ticker.js?v=6`. Viewport meta includes `viewport-fit=cover`. Cache-control `no-cache` meta tags.
- `worker.js` — Cloudflare Worker. MFL/Yahoo API proxy. Draft watcher cron. Deploy by pasting into Cloudflare dashboard.

### `css/`
- `base.css` — Global variables, reset, typography.
- `auth.css` — Login/register screen styles.
- `locker.css` — All app UI styles. v=22.
- `tournament.css` — Tournament module styles. v=6.

### `js/` — Core modules (all vanilla JS IIFEs)

| File | Purpose |
|------|---------|
| `app.js` | Orchestrates screens, auth state, global monitors. `AdminImpersonate` module (admin-only view-as-user). |
| `auth.js` | Firebase Auth wrapper. Password reset via worker/Resend. |
| `firebase-db.js` | All Firebase Realtime DB reads/writes. REST API with 8s timeouts. `linkPlatform` uses `.update()` not `.set()`. |
| `profile.js` | League card grid, franchise history, league detail panel, MFL/Yahoo/Sleeper import. |
| `mfl.js` | MFL API helpers and normalizers. |
| `yahoo.js` | Yahoo OAuth token management, `getLeagueBundle`, `normalizeBundle`. |
| `sleeper.js` | Sleeper API wrappers. |
| `standings.js` | Standings, Matchups, Playoffs tabs — cross-platform. |
| `roster.js` | Roster tab — cross-platform. |
| `draft.js` | Draft board — multi-draft selector, grid/list/auction toggle. |
| `transactions.js` | Transactions tab — all platforms. |
| `analytics.js` | Analytics tab — Sleeper + MFL + Yahoo. |
| `tournament.js` | Tournament module — full admin + user UI. See Tournament section below. |
| `draft-ticker.js` | Global draft ticker — Sleeper-first client architecture. v=6. See Draft Ticker section. |
| `hallway.js` | Hallway social feature. H2H records across common leagues, all three platforms. |
| `players-db.js` | Cross-platform player DB. `MAPPINGS_VERSION = "2026-04b"`. |
| `salary.js` | Salary cap management. |

### `tournaments/`
- `index.html` — Public tournament directory and registration page. Year-scoped duplicate check. `participantMap` pre-flight removed.

---

## Platform Integration Status

### Sleeper ✅ Fully working
### MFL ✅ Fully working
### Yahoo ✅ Fully working

---

## Global Draft Ticker (`draft-ticker.js` v=6)

### Core principle
**Client is self-sufficient.** `_initialLoad()` checks Sleeper directly for all current-season leagues in parallel on every page load. Worker cron supplements.

### Key fixes (as of May 2026)
- **Snake drafts:** `_checkSleeperDirect` fetches `/draft/{draft_id}` directly to get `slot_to_roster_id` (not returned by `/league/{id}/drafts`)
- **Linear drafts:** `slot === rosterId` fallback — no `slot_to_roster_id` needed
- **Firebase listener merge:** `_attachListener` merges Firebase snap into existing cache (preserves Sleeper-sourced `slot_to_roster_id`, `draft_order`, etc.)
- **`diagnosePickCalc(leagueId?)`:** public method, shows `has_draft_order`, `has_slot_to_roster_id`, `diagnoseNull` array with exact reason myNextPick is null

### Firebase paths
```
gmd/draftWatchIndex/{username}: { leagueId: leagueName, ... }
gmd/draftStatus/{leagueId}: { status, draftId, draftType, picksMade, totalPicks,
                               draft_order, slot_to_roster_id, traded_picks, ... }
  — Written ONLY by Worker. Rules: .write: false for clients.
```

---

## Tournament Module (`tournament.js`)

### Firebase paths
```
gmd/tournaments/{tid}/
  meta/              — name, tagline, bio, adminEmail, socialLinks, donationLinks, isPrivate
  playoffs/{year}/   — mode, startWeek, endWeek, qualification, decathlon{...}, finalRankings
  leagues/           — {batchId: {platform, year, leagues: {leagueId: {name}}}}
  standingsCache/    — {year_leagueId: {leagueName, platform, year, teams[{teamId, teamName, wins, losses, pf, ...}]}}
  registrations/     — {rid: {displayName, email, year, status, ...}}
  participants/      — {pid: {displayName, sleeperUsername, mflEmail, yahooUsername, gender, ...}}
  scoringSettings/   — {year: {platform: {rec, pass_yd, ...}}}

gmd/publicTournaments/{tid}/
  — Written by _writePublicSummary (never writes to playoffs/ node directly)
  — seasonConfig/{year}/ — thin playoff config (mode, weeks, qualification)
  — scoringSettings/     — scoring settings per year
  — playoffs/{year}/     — published snapshot (written ONLY by "Publish Playoffs" button)
    — Surgical child updates: registrationOpen, published flags only
```

### Playoff Modes
| Mode | Description |
|------|-------------|
| `total_points` | Highest cumulative PF wins |
| `points_rounds` | Advance each week by top score |
| `h2h_bracket` | Single-elimination bracket |
| `custom_rounds` | Admin authors each round manually |
| `worldcup` | Groups → H2H bracket |
| `decathlon` | Multi-league combined — see Decathlon section |

### Registration System
- `entry.year = currentRegYear` on every new registration
- `currentRegYear` resolved from `playoffs[y].registrationOpen`
- Duplicate check: year-scoped only (`sameYearRegs = allRegs.filter(r => r.year && r.year === currentRegYear)`)
- Legacy entries (no year field) never block new registrations
- "🔧 Tag Registrations with Year" admin button in Registrants toolbar
- Both `tournament.js` and `tournaments/index.html` have the same year-scoped check

### Admin Wizard (7 steps)
Steps: Identity → Roles → History → Year Setup → Leagues → Playoff Config → Rules
- `modal-box--lg` applied AFTER `_showModal()` creates the element
- Year pill clicks: full rerender with `_tournaments[tid]` (fresh data)
- `_wireWizardStep5`: passes `_wizardYear` as filterYear
- `_wizardSaveAndClose(tid)`: reusable save + close helper
- Save & Close on any step via `btn-secondary` button

### Key functions
- `_writePublicSummary(tid, t)` — writes `seasonConfig`, `scoringSettings`, surgical flags. Never overwrites `playoffs/` node.
- `_buildPlayoffSnapshot()` — scrubs `undefined` before Firebase write (prevents "value contains undefined" errors)
- `_playoffForYear(t, year)` — always use this, not `t.playoffs[year]` directly (handles legacy flat nodes)
- `_tMode(t)` — always use this for mode detection

---

## Decathlon Mode

New as of May 2026. Same participants compete across multiple leagues simultaneously.

### Data model
```
playoffs/{year}/decathlon:
  scoringMethod: "combined_pf" | "finish_points"
  identityKey:   "sleeperUsername" | "mflEmail" | "yahooLogin" | "dlrUsername"
  pointsTable:   [10, 8, 6, 5, 4, 3, 2, 1]
  leagueConfig:
    {leagueId}:
      finishBasis:          "record" | "pf" | "playoffs" | "elimination"
      medianWins:           true | false   (sub-option of record)
      pfStartWeek:          1              (per-league, only for pf basis)
      pfEndWeek:            16
      eliminationStartWeek: 4
      cumulativeEndWeek:    4              (phase 1 end)
      eliminations:         [{week, playerId, playerName, score, note}]
```

### Engine
- `_buildDecathlonLeaderboard(t, year, po, weekData)` — pure computation from standingsCache + weekData
- `_buildDecWeekScoreMap()` async — fetches Sleeper matchup API, returns `{ pfMap, wlMap, medMap }`
  - PF leagues: use per-league `pfStartWeek`/`pfEndWeek`
  - Record/median/playoffs leagues: use global `po.startWeek`/`po.endWeek`
- `_fetchWeekScores(leagueId, week)` — caches in `_weekScoreCache` AND `_weekMatchupCache`; requires BOTH for cache hit
- `_openEliminationManager(tid, t, lgId, lgName, lgCfg, poYear)` — uses `resolvedPoYear` + `_tournaments[tid]` (NOT `_poLocal()`)
- `_setTabContent(tabId)` — async for `dec_*` tabs (shows spinner, awaits week fetch)
- `diagnoseDecathlon()` public method on `DLRTournament`

### Key gotchas
- standingsCache keys are `{year}_{leagueId}` — strip year prefix before using as Sleeper API param: `ck.replace(/^\d{4}_/, "")`
- `_poLocal()` and `_activePoYear` only in scope inside `_wirePlayoffConfigListeners` — never use in module-level functions
- `_wcWireBracketButtons` guarded with `typeof` check (temporal dead zone on initial render)
- `hasWeekRange = !!(startWk && endWk && pfMap)` — false until pfMap populated

---

## Admin Impersonation (`app.js`)

- `AdminImpersonate` module — `ADMINS = ["mraladdin23"]`
- 👁 button in nav (admin only). Loads target user's Firebase profile, re-renders entire app.
- Purple banner. DraftTicker re-inits as target user.
- Firebase Auth session unchanged — nothing writes under their account.

---

## Key Patterns & Gotchas

### Firebase writes
- Always `.update()` for merges, never `.set()` on nodes with data to keep
- Keys cannot contain: `. # $ / [ ]`
- For large datasets, fetch specific child ref directly

### CSS/JS versioning
- `locker.css` v=22, `auth.css` v=6, `tournament.css` v=6, `draft-ticker.js` v=6
- Bump `?v=N` in `index.html` on deploy

### Worker deployment
- Changes to `worker.js` require a **separate paste into Cloudflare dashboard**
- `YAHOO_REDIRECT_URI` must be `https://mfl-proxy.mraladdin23.workers.dev/auth/yahoo/callback`

### Auth
- Synthetic email: `username@gmdynasty.app`
- Worker secrets: `RESEND_API_KEY`, `FIREBASE_DB_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REDIRECT_URI`, `ANTHROPIC_API_KEY`

---

## Starting a New Session

1. **Attach this document** + `DLR_TODO_LIST.md` + **specific file(s)** for the task
2. **One task per session** — attach only the 1–3 files needed
3. **Commit to git** after each fix before starting a new session
4. **Never run bulk Firebase reset scripts** — fix things surgically
5. **Worker changes require a separate paste into Cloudflare dashboard**

### Standard context block
```
I'm building Dynasty Locker Room (DLR), a fantasy football SPA at dynastylockerroom.com.
Repo: mraladdin23/gm-dynasty (GitHub Pages).
Stack: Vanilla JS, Firebase Realtime DB, Cloudflare Worker (mfl-proxy.mraladdin23.workers.dev).
Platforms: Sleeper ✅, MFL ✅, Yahoo ✅.
[Attach DLR_PROJECT_SUMMARY.md + DLR_TODO_LIST.md]
Today I want to work on: [specific task]
Here are the relevant files: [attach files]
```
