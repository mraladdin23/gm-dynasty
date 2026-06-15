# Dynasty Locker Room (DLR) — Project Summary
*For use as context in a new Claude chat session*
*Updated: June 14, 2026 — Division system, points-rounds elimination locking, registration reliability, role permissions, donations, weekly score rankings.*

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
- **DNS:** GoDaddy nameservers (moved from Cloudflare — Cloudflare proxy broke Firebase mobile auth)

---

## File Naming Convention (for chat sessions)

Two files are both literally named `index.html` on disk, distinguished by folder:
- **`app-index.html`** = root SPA shell (`/index.html`)
- **`tournaments/index.html`** = public tournament directory + registration page (`/tournaments/index.html`)

Always refer to these by these names in chat to avoid confusion. When uploading, specify which one.

---

## Architecture Overview

```
GitHub Pages (dynastylockerroom.com)
  ├── index.html (app-index)         — main SPA shell
  ├── tournaments/index.html         — public tournament site
  ├── css/ + js/
  │     ├── Firebase Auth (email/password — synthetic email: username@gmdynasty.app)
  │     ├── Firebase Realtime DB (gmd/ node — all user data)
  │     ├── Sleeper API (direct, no proxy)
  │     ├── MFL API (via Cloudflare Worker proxy)
  │     └── Yahoo API (OAuth via Cloudflare Worker)
```

---

## File Map — Every File and Its Purpose

### Root
- `app-index.html` — Full SPA shell. CSS: `locker.css v=22`, `auth.css v=6`, `tournament.css v=7`. JS: `tournament.js?v=6`, `draft-ticker.js?v=6`. Has `Cache-Control: no-cache` meta tags. Password field now has 8-char minimum with live strength indicator and match validation.
- `worker.js` — Cloudflare Worker. MFL/Yahoo API proxy. Draft watcher cron. Deploy by pasting into Cloudflare dashboard.

### `css/`
- `base.css` — Global variables, reset, typography.
- `auth.css` — Login/register screen styles.
- `locker.css` — All app UI styles. v=22.
- `tournament.css` — Tournament module styles. v=7. Includes `.trn-wmu-score-*` classes for the weekly scores ranked view.

### `js/` — Core modules (all vanilla JS IIFEs)

| File | Purpose |
|------|---------|
| `app.js` | Orchestrates screens, auth state, global monitors. `AdminImpersonate` module. Tournament board notifications now show the tournament name and reliably deep-link via retry loop. |
| `auth.js` | Firebase Auth wrapper. 8-char password minimum enforced both client-side and in `register()`. Password reset via worker/Resend. |
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
| `tournament.js` | Tournament module — full admin + user UI. v=6 (~20,700 lines). See Tournament section below. |
| `draft-ticker.js` | Global draft ticker — Sleeper-first client architecture. v=6. |
| `hallway.js` | Hallway social feature. H2H records across common leagues, all three platforms. |
| `players-db.js` | Cross-platform player DB. `MAPPINGS_VERSION = "2026-04b"`. |
| `salary.js` | Salary cap management. FAAB waiver fix (`String(rid)` lookup), `_lastTxProcessed` persisted to Firebase, `forceRestoreAuctionSalaries()` recovery tool. |

### `tournaments/`
- `index.html` (= `tournaments-index.html` in chat) — Public tournament directory, registration, divisions, status checker. No-cache meta tags. CSS versions matched to main app (`locker.css?v=22`, `tournament.css?v=6` — **note: confirm this matches root's v=7 on next deploy**).

---

## Platform Integration Status

### Sleeper ✅ Fully working
### MFL ✅ Fully working
### Yahoo ✅ Fully working

---

## Tournament Module (`tournament.js`)

### Firebase paths
```
gmd/tournaments/{tid}/
  meta/                — name, tagline, bio, adminEmail, socialLinks, donationLinks, isPrivate,
                         registrationForm{fieldOrder, optionalFields, customQuestions}
  roles/{username}     — {role: "admin"|"sub_admin", scope, grantedAt, grantedBy, changedAt, changedBy}
  playoffs/{year}/     — mode, startWeek, endWeek, qualification, decathlon{...}, finalRankings,
                         published, donationConfig{label, defaultAmount, methods}
    divisions/{divId}/   — name, description, teamCap, maleCap, femaleCap,
                            enforceTotal/Male/Female, allowSelfSelect, showPublicly,
                            template{subject,body}, memberIds{rid:true}
    pointsRounds/
      rounds: [...]
      eliminations/{roundIdx}: {"leagueName|teamId": true, ...}   — LOCKED, write-once
  leagues/             — {batchId: {platform, year, leagues: {leagueId: {name}}}}
  standingsCache/      — {year_leagueId: {leagueName, platform, year, division, conference, teams[...]}}
  registrations/{rid}/ — {displayName, email (always lowercase), year, status, gender,
                          sleeperUsername, mflEmail, yahooUsername, dlrUsername,
                          autoRegister, _isDuplicate, ...}
  participants/{pid}/  — {displayName, sleeperUsername, mflEmail, yahooUsername, gender,
                          years, dlrLinked, dlrUsername, autoRegister, emailOptOut}
  donations/{year}/{rid}/ — {entries:[{amount,method,note,paidAt}], total}
  scoringSettings/     — {year: {platform: {rec, pass_yd, ...}}}

gmd/publicTournaments/{tid}/
  — Written by _writePublicSummary (never writes to playoffs/ node directly)
  seasonConfig/{year}/   — thin playoff config (mode, weeks, qualification)
  scoringSettings/       — scoring settings per year
  divisions/{year}/      — slim division snapshot (no emails), via _writeDivisionsPublic;
                           auto-published on every admin membership change AND on self-select join
  playoffs/{year}/       — published snapshot incl. computedRounds (written by "Publish Playoffs")
    — Surgical child updates: registrationOpen, published, finalRankings
```

### Admin tabs (Registrants / Participants / Divisions / Donations)
1. **📋 Registrants** — approval queue, lapsed-player report, league invite emails, division-select email
2. **👥 Participants** — curated historical player DB. Per-row ✉/🚫 email opt-out toggle. Filter dropdown includes "🚫 Opted Out".
3. **🗂 Divisions** — create/edit/delete named divisions, manual + 🎲 random assign, ⬇ Export CSV (division roster with platform IDs), 👥 Gender Summary modal, ⚠️ multi-division detector + Fix button, 🗑 orphan detector + Clean button, 🌐 Publish to Public (also auto-fires on every change)
4. **💰 Donations** — per-registrant payment tracking with full audit trail, config (label/default amount/methods), CSV export

### Roles & Permissions
- `_myRole(t)` — **case-insensitive** role lookup (was previously exact-match on `_currentUsername`, could silently fail if casing differed)
- Roles tab: inline **⬆ Make Admin / ⬇ Make Sub-Admin** buttons on each staff row — no need to re-open "Add Staff" modal to change a role

### Division System
- **Admin:** create/edit/delete named divisions per year (teamCap, maleCap, femaleCap, enforce toggles, allowSelfSelect, showPublicly, invite template)
- **Assign:** manual checklist or 🎲 Random Assign All (fewest-members-first, respects enforced caps)
- **Auto-publish:** `_writeDivisionsPublic` fires automatically (fire-and-forget) after every admin membership mutation — assign, remove, random assign — and after every public self-select join
- **Logged-in user view:** 🗂 Divisions tab (visible when `_hasNamedDivisions(t)`) shows "Your Division" banner + highlighted card + Join button for self-select divisions
- **Public site (`tournaments/index.html`):**
  - Divisions tab with fill meters, M/F counts, member chips (orphaned rids filtered from display)
  - 🙋 Join Division opens an **inline modal** (replaced unreliable `prompt()`) — email input, inline validation, retry-safe
  - `_isJoining` guard prevents double-tap double-division-join
  - Duplicate-division check **never silently swallows errors** — aborts the join rather than risk a second division assignment
  - "🔍 Check Your Registration Status" card — anyone enters email, sees ✅/⏳/❌ status per year, division assignment if approved, and a jump-link to Divisions tab if unassigned + self-select open

### Lapsed Player Report (F10) — done
- Sources from `participants` (curated historical DB), matches against current-year registrations on email/displayName/sleeperUsername/mflEmail/yahooUsername
- Always does a fresh Firebase read on click (no stale closure)
- Shared `_sendBccEmail(adminTo, emails, subject, body)` helper used by all 4 email modals (lapsed, league invite, division invite, division-select) — first 50 as mailto draft, remaining as copyable batches
- All 4 email modals filter out `emailOptOut` participants via `_getOptOutEmails(tid)`

### Registration Reliability
- `_isSubmitting` guard + immediate button disable + `crypto.randomUUID()`-based rid — fixes double-submit duplicate registrations
- Email normalized to lowercase on save (`entry.email = val.toLowerCase()`) — re-verify this is present on every deploy, it has reverted to stale uploads multiple times
- Year check relaxed: `!yr || !r.year || String(r.year) === String(yr)` — legacy registrations with no `year` field are never blocked
- "Automatically enroll me for future years" checkbox on public registration form → `entry.autoRegister = true`

### Weekly Matchups Tab — ⚔️ Matchups / 📊 Scores toggle
- `_weeklyMuView` state (`"matchups"` | `"scores"`), `WEEKLY_MU_PAGE_SIZE = 25`
- Scores view: flat ranked list of every team's score for the selected week, 25/page, sorted high→low, shows division/conference/league tags, gold #1 / dim last-place styling
- `_weeklyMuT` holds the `t` reference for `_isMyTeam` lookups (scores view is a module-level function, not nested)

### Points Rounds Mode — Elimination Locking (June 14, 2026)
**Problem solved:** with `startWeek=1` (no regular season), a team eliminated in week 2 could reappear as "advancing" in week 3's simulation if Sleeper's matchups API returned an empty array for week 2 by the time round 3 was viewed (common once the season progresses past that week). The simulation would fall back to season-total `pf` for the tiebreak, letting a high-`pf`/low-week-2-score team incorrectly "win" the re-simulated round 2.

**Fix:** `playoffs/{year}/pointsRounds/eliminations/{roundIdx}` — write-once locked record of eliminated team keys (`"leagueName|teamId"`), written the first time a round is computed with **complete** real score data. Later rounds read this locked record instead of re-simulating. Applied to both `_renderPointsRound` (live view) and `_computedRounds` (publish snapshot).

**Diagnostics (console, while tournament loaded):**
```js
await DLRTournament.diagnosePointsRounds('tid', 2025)
// Shows lock status + eliminated team keys per round

await DLRTournament.resetPointsRoundsElimination('tid', 2025, 1)  // clear round index 1 (round 2)
await DLRTournament.resetPointsRoundsElimination('tid', 2025)     // clear all rounds
// Then re-open the round while score data is available to re-lock correctly
```

### Other resolved bugs
- `_wcWireBracketButtons` — converted from `const () => {}` to `function(){}` (TDZ ReferenceError on call-before-declaration; `typeof` guards don't protect `const`/`let`)
- Playoffs gate ("Regular Season In Progress" message) now bypassed if `po.published || po.finalRankings` is truthy; Publish button writes `published: true` to Firebase
- Missing `const totalPages = Math.ceil(matchups.length / WEEKLY_MU_PAGE_SIZE)` restored (dropped during scores-view edit, caused ReferenceError)

### Key functions
- `_writePublicSummary(tid, t)` — writes `seasonConfig`, `scoringSettings`, surgical flags. Never overwrites `playoffs/` node.
- `_writeDivisionsPublic(tid, yr, divsObj, regsObj)` — writes slim division data to public node; auto-called everywhere divisions change
- `_buildPlayoffSnapshot()` — scrubs `undefined` before Firebase write
- `_playoffForYear(t, year)` — always use this, not `t.playoffs[year]` directly
- `_tMode(t)` — always use this for mode detection
- `_myRole(t)` — case-insensitive role lookup
- `_sendBccEmail(adminTo, emails, subject, body)` — shared BCC launcher for all email modals
- `_getOptOutEmails(tid)` — returns Set of lowercase opted-out emails
- `DLRTournament.getTournamentName(tid)` — exposed for `app.js` notification labels

---

## Decathlon Mode

Same participants compete across multiple leagues simultaneously.

### Data model
```
playoffs/{year}/decathlon:
  scoringMethod: "combined_pf" | "finish_points"
  identityKey:   "sleeperUsername" | "mflEmail" | "yahooLogin" | "dlrUsername"
  pointsTable:   [10, 8, 6, 5, 4, 3, 2, 1]
  leagueConfig:
    {leagueId}:
      finishBasis:          "record" | "pf" | "playoffs" | "elimination"
      medianWins:           true | false
      pfStartWeek/pfEndWeek, eliminationStartWeek, cumulativeEndWeek
      eliminations:         [{week, playerId, playerName, score, note}]
```

### Engine
- `_buildDecathlonLeaderboard(t, year, po, weekData)` — pure computation from standingsCache + weekData
- `_buildDecWeekScoreMap()` async — `{ pfMap, wlMap, medMap }`
- `_fetchWeekScores(leagueId, week)` — caches in `_weekScoreCache` AND `_weekMatchupCache`
- `_openEliminationManager(...)` — uses `resolvedPoYear` + `_tournaments[tid]` (NOT `_poLocal()`)
- `diagnoseDecathlon()` public method on `DLRTournament`

### Key gotchas
- standingsCache keys are `{year}_{leagueId}` — strip year prefix: `ck.replace(/^\d{4}_/, "")`
- `_poLocal()` / `_activePoYear` only in scope inside `_wirePlayoffConfigListeners`
- `hasWeekRange = !!(startWk && endWk && pfMap)`

---

## Salary Cap (`salary.js`)

### Business rules
- Auction → winning bid sets salary
- Drop → salary cleared immediately
- Waiver/FA add → FAAB bid sets salary (works after drop because drop already cleared the entry)

### Fixes
- `String(rid)` on rosterMap lookup — Sleeper sends numeric roster IDs in `tx.adds`, map keys are strings
- `_lastTxProcessed` persisted to `salaryCap/{leagueKey}/lastTxProcessed`, defaults to `Date.now()` on first deploy
- `forceRestoreAuctionSalaries()` — recovery tool in Salary → Settings → Data Recovery, reads winning bids and restores salaries that drifted

---

## Admin Impersonation (`app.js`)
- `AdminImpersonate` module — `ADMINS = ["mraladdin23"]`. 👁 button in nav (admin only).

---

## Key Patterns & Gotchas

### Firebase writes
- Always `.update()` for merges, never `.set()` on nodes with data to keep
- Keys cannot contain: `. # $ / [ ]`
- **Never `.set()` on objects with all-numeric string keys** — Firebase converts to array indices. Use per-child writes: `GMD.child(\`path/${key}\`).set(data)`
- `salaryCap/{leagueKey}/rosters` — always per-team writes

### CSS/JS versioning
- `locker.css` v=22, `auth.css` v=6, `tournament.css` v=7, `tournament.js` v=6, `draft-ticker.js` v=6
- Bump `?v=N` on every deploy — GitHub Pages CDN can serve stale files up to ~10 min regardless of meta tags
- `app-index.html` has `Cache-Control: no-cache` meta tags; `tournaments/index.html` does too (added this session) but its CSS version numbers need to be re-confirmed against root on next deploy

### Worker deployment
- Changes to `worker.js` require a **separate paste into Cloudflare dashboard**
- `YAHOO_REDIRECT_URI` must be `https://mfl-proxy.mraladdin23.workers.dev/auth/yahoo/callback`

### Auth
- Synthetic email: `username@gmdynasty.app`
- Password: 8-char minimum, enforced client-side (live strength/match indicators) and in `auth.js register()`
- Worker secrets: `RESEND_API_KEY`, `FIREBASE_DB_SECRET`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REDIRECT_URI`, `ANTHROPIC_API_KEY`

### Firebase Rules — public tournament site
The `gmd/tournaments` node requires `auth != null` by default. The public site needs these exceptions added (confirm deployed in Firebase Console → Realtime Database → Rules):
```json
"tournaments": {
  ".read": "auth != null",
  ".write": "auth != null",
  "$tournamentId": {
    ".read": "auth != null",
    ".write": "auth != null",
    "registrations": {
      ".read": true,
      "$rid": { ".write": "!data.exists()" }
    },
    "playoffs": {
      "$year": {
        "divisions": {
          "$divId": {
            "memberIds": {
              ".read": true,
              "$rid": { ".write": true }
            }
          }
        }
      }
    }
  }
},
"publicTournaments": {
  ".read": true,
  ".write": "auth != null",
  "$tid": {
    "registrationCount": { ".write": true },
    "divisions": { ".write": true }
  }
}
```
**This has not been confirmed as deployed** — if registration/division-join errors persist ("permission_denied", "could not look up registration"), check this first.

---

## Starting a New Session

1. **Attach this document** + `DLR_TODO_LIST.md` + **specific file(s)** for the task
2. **One task per session** — attach only the 1–3 files needed
3. **Verify fixes are present in newly uploaded files** before building on them — files have repeatedly reverted to stale versions across sessions (email lowercase fix, lapsed-report fresh-read fix, etc. have all had to be re-applied more than once)
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
