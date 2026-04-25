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
- `index.html` — Full SPA shell. All screens defined here. Firebase SDK loaded at bottom of body. CSS cache-busted: `locker.css v=22`, `auth.css v=6`, `tournament.css v=1`. Viewport meta includes `viewport-fit=cover` for PWA safe area support. Inline script at bottom wires forgot-password flow.
- `worker.js` — Cloudflare Worker. MFL bundle fetches, Yahoo OAuth flow + bundle + playerStats. Deploy by pasting into Cloudflare dashboard.

### `css/`
- `base.css` — Global variables, reset, typography. `.screen` uses `min-height: 100dvh` (with `100vh` fallback). `.screen.active { overflow: hidden }` on mobile — each view that needs to scroll must override this explicitly (see locker.css pattern).
- `auth.css` — Login/register screen styles
- `locker.css` — All app UI styles. v=21. Mobile: `100dvh` for app-view height, `env(safe-area-inset-top)` for nav + detail panel. `.app-view.active` is the scroll container at ≤640px (`overflow-y: auto; height: calc(100vh - 48px)`). Views that need mobile scroll must add `#view-{name}.active { overflow-y: auto !important; height: calc(100dvh - 48px) !important; }` — see `#view-hallway` and `#view-tournament` for examples.
- `tournament.css` — Tournament module styles. v=1. Contains: standings table, tab select (mobile dropdown), gender badges, scroll fix for `#view-tournament.active`. Mobile breakpoint at ≤640px to match locker.css.

### `js/` — Core modules (all vanilla JS IIFEs)

| File | Purpose |
|------|---------|
| `app.js` | Orchestrates screens, auth state, global monitors, button handlers. Yahoo OAuth callback handled via `#yahoo_token=` hash. |
| `auth.js` | Firebase Auth wrapper. 8-second timeout on auth state to prevent mobile hang. `sendPasswordReset(username)` looks up real email from DB then calls Firebase `sendPasswordResetEmail()`. |
| `firebase-db.js` | All Firebase Realtime DB reads/writes. REST API with 8-second AbortController timeouts. `saveLeagues` uses `.update()` (merge). `deleteLeague(username, key)` and `deleteLeaguesByPlatform(username, platform)` remove `leagues/` + `leagueMeta/` entries. |
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
| `tournament.js` | Tournament module — admin setup, standings, registration, participant DB, public summary. See Tournament section below for full architecture. |
| `playerreport.js` | Cross-league player report panel |
| `chat.js` | League chat (Firebase Realtime DB) |
| `hallway.js` | The Hallway social feature |
| `trophy-room.js` | Trophy room display |
| `leaguegroups.js` | League grouping/commissioner tools |
| `manager-search.js` | Cross-league manager search |
| `config.js` | Firebase config (in `firebase/config.js`) |

### `tournaments/`
- `index.html` — Public tournament directory and detail page. Reads from `gmd/publicTournaments/` (no auth required). Uses same CSS classes as internal standings (`standings-table`, `standings-rank`, `standings-team-cell`, `st-av`). Has mobile tab `<select>` dropdown. Gender badges and participant `displayName` shown via `participantMap` field in the public node.

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

---

## Tournament Mode — Architecture

### Firebase paths
```
gmd/tournaments/{tid}/
  meta/           — name, tagline, status, regType, rankBy, playoffStartWeek, bio, createdAt, createdBy
  leagues/        — batch structure: {batchId: {platform, year, hasConferences, leagues: {leagueId: {name, conference}}}}
  roles/          — {username: {role: "admin"|"sub_admin", grantedAt}}
  registrationForm/ — {fields, optionalFields, customQuestions}
  registrations/  — {rid: {displayName, email, status: "pending"|"approved"|"denied", ...}}
  participants/   — {pid: {displayName, teamName, email, sleeperUsername, mflEmail, yahooUsername,
                           twitterHandle, gender, years[], dlrLinked, dlrUsername, autoRegister}}
  standingsCache/ — {year_leagueId: {leagueName, platform, year, conference, division,
                                      teams:[{teamId, teamName, wins, losses, ties, pf, pa}], lastSynced}}

gmd/publicTournaments/{tid}/
  — Same as meta fields + leagueCount, registrationCount, registrationForm, standingsCache
  — participantMap: {sanitizedKey: {displayName, gender}} — keyed by sleeperUsername/displayName/teamName
    Keys are sanitized: trim + lowercase + replace /[.#$/\[\]]/g with "_"
    Written by _writePublicSummary() after every standings sync, meta update, or status change
```

### Key behaviors
- **Standings display name:** Internal standings show participant `displayName` (from participants list) instead of raw Sleeper `display_name`. Lookup uses sanitized key matching `sleeperUsername`, `displayName`, and `teamName`.
- **Gender badges:** Blue **M** / pink **F** pill shown inline after team name. No separate gender column.
- **Public page gender/displayName:** Sourced from `participantMap` in `gmd/publicTournaments`. Must re-run "Sync Standings" after importing participants to update the public node.
- **Mobile tabs:** Tab bar replaced with `<select class="trn-tab-select">` at ≤640px. Both stay in sync.
- **Mobile scroll:** `#view-tournament.active` has explicit `overflow-y: auto; height: calc(100dvh - 48px)` in `tournament.css` — same pattern as `#view-hallway` in locker.css.
- **Tournament visibility:** Internal "All Tournaments" shows: admin/sub-admin, discovered, non-draft status, OR has standings data (so historical tournaments are always visible).
- **Key sanitization:** All Firebase keys derived from participant names use `_sk = (s) => String(s).trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_")` — participant names with `/` (e.g. "nora/maeve") no longer crash writes.

### Status lifecycle
`draft` → `registration_open` → `active` → `playoffs` → `completed`
Admin controls transitions manually. Draft tournaments with standings are still visible publicly.

### Phase completion
- **Phase 1 ✅** — Foundation (admin setup, roles, registration, participant DB, discovery)
- **Phase 2 ✅** — Standings sync, public page, display name, gender badges, Info tab, Rules tab
- **Phase 3 ⚠️ IN PROGRESS** — Analytics: Draft ✅, ADP ✅, Matchups ✅, Rosters ✅. Remaining: S1–S4 small fixes, S6 (rules versioning), S7 (CSS pass)
- **Phase 4** — Custom playoffs (bracket config, rendering)
- **Phase 5** — Advanced (cross-platform identity merge, emails, message board)

---

## Key Patterns & Gotchas

### Firebase writes
- Always use `.update()` for merges, never `.set()` on existing nodes with data you want to keep
- Firebase Realtime DB keys cannot contain: `. # $ / [ ]` — sanitize any user-supplied strings before using as keys
- `GMDB.saveLeagues` (plural) is correct — `saveLeague` (singular) does not exist

### Mobile scroll
- `base.css`: `.screen.active { overflow: hidden }` — this clips everything at mobile
- `locker.css`: `.app-view.active { overflow-y: auto; height: calc(100vh - 48px) }` — each active view is its own scroll container
- To make a view scrollable on mobile: add `#view-{name}.active { overflow-y: auto !important; -webkit-overflow-scrolling: touch; height: calc(100dvh - 48px) !important; }` to the relevant CSS file
- Do NOT set `overflow` on child containers inside a view — creates nested scroll contexts that break things

### CSS versioning
- `locker.css` is at **v=22**
- `auth.css` is at **v=6**
- `tournament.css` is at **v=1** — bump when deploying tournament CSS changes
- Cache bust by incrementing `?v=N` in the `<link>` tag in `index.html`

### Worker deployment
- Changes to `worker.js` require a **separate paste into Cloudflare dashboard** — git push alone does nothing for the worker
- `YAHOO_REDIRECT_URI` env var must be `https://mfl-proxy.mraladdin23.workers.dev/auth/yahoo/callback` — never the frontend URL

### Yahoo
- Test on **mobile data** — home router blocks workers.dev and firebaseio.com WebSocket
- Yahoo game key format: `"{game_id}.l.{league_id}"` — always use stored `league.leagueKey`
- Rate limiting: don't run multiple tabs or hammer the import button

### Other
- `standings-row--me` is correct (NOT `standings-row--mine`)
- Yahoo week pills use `season-pill` / `season-pill--current` (same as MFL/Sleeper)
- Merge links stored at `gmd/users/{u}/leagueMeta/{key}.mergedInto` — `suppressMerge: true` = soft unlinked

---

## Session History (condensed)

**April 20 (Y4 — Yahoo OAuth token persistence):**
- Root cause: `YAHOO_REDIRECT_URI` Cloudflare env var was set to `dynastylockerroom.com` (frontend) instead of `https://mfl-proxy.mraladdin23.workers.dev/auth/yahoo/callback`
- `app.js`: removed `yahoo.linked` gate from token sync block
- `profile.js`: added `GMDB.saveYahooTokens` call inside `linkYahoo`

**April 20 (Yahoo playoff finish + sync overhaul):**
- `_detectYahooPlayoffFinish` fully rewritten — uses standings `rank` + `clinched`/`playoffSeed` gate
- Bubble tag removed from all platforms; playoff finish badges top-3 only (🏆🥈🥉)
- `syncYahooLeague` overhauled; `GMDB.saveLeague` → `saveLeagues` fixed in all 6 call sites

**April 21 (pre-F5 polish — Items 1, 2, 3):**
- Options modal gating (commish-only fields hidden)
- Group filter (unified My Groups button, async Firebase load, leagueKeys matching)
- Cross-platform merge (auto-detect, Merge/Unlink, `_resolveEffectiveFid`)

**April 22 (F5 Tournament Mode — Phase 1 + Phase 2 standings):**
- Full Phase 1 built and deployed
- Standings: sync from all platforms, year filter, ranking, playoff start week, dedup fix
- Public directory at `dynastylockerroom.com/tournaments`

**April 22 (F5 T3/T2/T4 fixes + display name + gender session):**
- **T3:** Playoff start week field in admin Overview; Preview as User restored; standings toolbar cleaned up; mobile card overflow fixed
- **T2:** Twitter handle as clickable link in participant list + detail modal; Sleeper identity matching broadened
- **T4:** Public page fully synced to internal — same CSS classes, tab dropdown, year in toolbar, dimmed last-synced
- **Display name + gender:** Internal and public standings now show participant `displayName`; gender badges inline; `participantMap` written to public Firebase node; Firebase key sanitization (`_sk`) fixes illegal-char crash

**April 24, 2026 — Auth, Profile, Tournament P3 completion:**
- **A1 (Password reset):** `Auth.sendPasswordReset(username)` looks up real email from `gmd/users/{username}/email`, calls `sendPasswordResetEmail()`. "Forgot your password?" link on login → forgot form → success/back flow. Wired via inline script in `index.html` (no app.js changes needed — auth tab handler only targets `${target}-form` by data-tab, never touches `#forgot-form`).
- **A2 (Delete leagues):** `GMDB.deleteLeague()` and `GMDB.deleteLeaguesByPlatform()` remove `leagues/` and `leagueMeta/` keys. `_promptDeleteLeague()` wired to 🗑 Remove in league ⋯ modal. `_deleteAllPlatformLeagues()` wired to 🗑 Remove All in Edit Profile per platform. Shared `#delete-league-modal` confirmation dialog with cloned buttons to prevent stale listener accumulation. `btn-danger` + `btn-danger.btn-sm` added to `locker.css`.
- **F5-P3-S8 (Duplicate registration):** Check at top of `_submitRegistration` — matches DLR username, email, Sleeper username against existing registrations before writing.
- **F5-P3-U5 (Rosters):** 5-across CSS grid, position-group layout matching `roster.js` pattern, starters+bench together sorted by rank, bench dimmed, single-line name+NFL team, equal-height card bodies via flexbox.

*Document updated: April 24, 2026*
*F5-P3 nearly complete. Next: S1–S4 small fixes batch (tournament.js, tournament.css, tournaments/index.html), then S6, S7, P4.*

---

## Starting a New Session

1. **Attach this document** + `DLR_TODO_LIST.md` + **the specific file(s)** for the task
2. **One task per session** — attach only the 1–3 files needed for that task
3. **Commit to git** after each fix before starting a new session
4. **Never run bulk Firebase reset scripts** — fix things surgically
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
