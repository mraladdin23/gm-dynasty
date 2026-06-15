# Dynasty Locker Room — Master TODO List
*Updated: June 14, 2026 — Major tournament reliability session (divisions, points-rounds locking, registration, roles, donations).*
*Attach with DLR_PROJECT_SUMMARY.md + specific files per task.*

---

## How to Use This Doc
Each issue is self-contained. For each session: attach this doc + project summary +
only the files listed under that issue. Fix one issue per session where possible.
After completing an issue, move it to the ✅ Completed section at the bottom.

---

## 🔴 Critical — Crashes or Broken Core Features

### FB-RULES — Confirm Firebase Rules Deployed
**Status:** Patch written, deployment unconfirmed.
**Problem:** The public tournament site (`tournaments/index.html`) needs specific exceptions to the `gmd/tournaments` rules (which default to `auth != null`). If these were never deployed, expect: registration submissions failing with permission_denied, "could not look up registration" on division self-select, and status-checker showing "no registration found" for people who did register.

**Action:** Go to Firebase Console → Realtime Database → Rules. Check whether `gmd/tournaments/$tournamentId/registrations` has `.read: true` and `$rid/.write: "!data.exists()"`, and whether `playoffs/$year/divisions/$divId/memberIds` has `.read: true` and `$rid/.write: true`. Full JSON patch is in DLR_PROJECT_SUMMARY.md under "Firebase Rules".

**Files:** none (Firebase Console only)

---

### DT-MISSING — Draft Ticker Not Picking Up Active Draft
**Problem:** At least one league currently drafting may not appear in the draft ticker (last reported status — re-verify still an issue).

**Diagnostic steps:**
1. `await DraftTicker.diagnosePickCalc()` — check monitored leagues + draft status
2. Check `gmd/draftWatchIndex/{username}` — is the league present?
3. On Sleeper, confirm draft status is `"drafting"` or `"paused"`
4. Check `gmd/draftStatus/{leagueId}` for Worker entry
5. `GET https://mfl-proxy.mraladdin23.workers.dev/draft/diagnose?username=mraladdin23`

**Files:** `draft-ticker.js`

---

## 🟡 Tournament — Remaining Items

### T-MFL-FETCH — Wizard Step 5: "Fetch All Leagues" for MFL
**Priority:** Medium
**Status:** Button exists in UI (`display:none`), handler not implemented.
**Files:** `tournament.js`

### TRN-CSS-VERSION — Confirm tournament.css version parity
**Priority:** Low
**Problem:** Root `app-index.html` is on `tournament.css?v=7`; last seen `tournaments/index.html` was still on `?v=6`. Confirm both reference the same version on next deploy.
**Files:** `tournaments/index.html`

### DEC-WEEKRANGE — Decathlon Week Range (verify still outstanding)
**Status:** Last reported `pfMap` fetching confirmed working (108 keys) but rangedPF not applying to display. May have been resolved incidentally by later decathlon work — re-verify before investing more time.
**Diagnostic:** `await DLRTournament.diagnoseDecathlon()` — check leagueConfig table for `pfStartWeek`/`pfEndWeek` and watch for `[decathlon] pfMap MISS` warnings.
**Files:** `tournament.js`

---

## 🟢 New Features (Not Started)

### A2 — Registration Confirmation Email
**Files:** `tournament.js`, `worker.js`

### F1 — Dynasty/Keeper League Overview Tab
**Files:** `standings.js`, `profile.js`, `locker.css`

### F4 — Locker Room Visual Redesign + NFL Team Themes
**Files:** `locker.css`, `profile.js`, `app.js`

### F6 — Post-It Trash Talk Wall
**Files:** `chat.js`, new module

### F7 — Custom Trophy Builder
**Files:** `trophy-room.js`, `tournament.js`, `locker.css`

---

## 🔧 Console Scripts (for surgical Firebase fixes)

### Points Rounds — diagnose / reset locked eliminations
```js
await DLRTournament.diagnosePointsRounds('tid', 2025)
// Shows lock status per round + eliminated team keys

await DLRTournament.resetPointsRoundsElimination('tid', 2025, 1)  // round index 1 (round 2)
await DLRTournament.resetPointsRoundsElimination('tid', 2025)     // all rounds
// Re-open the cleared round while score data is available to re-lock correctly
```

### Decathlon week range diagnostic
```js
await DLRTournament.diagnoseDecathlon()
```

### Custom playoffs visibility
```js
await Profile.diagnoseCustomPlayoffs()
```

### Draft ticker pick calculation
```js
await DraftTicker.diagnosePickCalc()
// or: await DraftTicker.diagnosePickCalc("leagueId")
```

### Salary cap diagnostic
```js
await diagnoseSalary()
```

### Restore wiped auction salaries
Admin → Salary → Settings → Data Recovery → 🔧 Restore Auction Salaries from Bids

### Clear stale draft cache for one league
```js
await firebase.database().ref(`gmd/tournaments/${tid}/analyticsCache/drafts/${lid}`).remove();
```

### Clear bundles node (safe)
```js
await firebase.database().ref('gmd/users/mraladdin23/bundles').remove();
```

### Force-republish public summaries
Open DLR while logged in as admin — `_backfillPublicSummaries()` runs automatically on tournament page load.

### Tag registrations with current year
Admin → Registrants tab → "🔧 Tag Registrations with Year"

### Worker debug endpoints
```
GET https://mfl-proxy.mraladdin23.workers.dev/draft/diagnose?username=USERNAME
GET https://mfl-proxy.mraladdin23.workers.dev/draft/rebuildWatchIndex
GET https://mfl-proxy.mraladdin23.workers.dev/draft/status
```

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league/round at a time.*

---

## ✅ Completed

### June 14, 2026 — Points Rounds: Locked Elimination Records (`tournament.js`)
With `startWeek=1` (no regular season), a team eliminated in week 2 could reappear as "advancing" in week 3 — caused by Sleeper's matchups API returning empty data for a past week, causing the round-2 re-simulation to fall back to season-`pf` tiebreaks. Fixed by writing `playoffs/{year}/pointsRounds/eliminations/{roundIdx}` once a round is computed with complete real data; later rounds read this locked record instead of re-simulating. New diagnostics: `diagnosePointsRounds()`, `resetPointsRoundsElimination()`.

### June 14, 2026 — Role Permissions Case-Insensitivity + Inline Role Change (`tournament.js`)
Added `_myRole(t)` for case-insensitive role lookups (previously exact-match on `_currentUsername`, could silently fail). Added inline ⬆ Make Admin / ⬇ Make Sub-Admin buttons on each staff row in the Roles tab.

### June 14, 2026 — Public Registration Status Checker (`tournaments/index.html`)
New "🔍 Check Your Registration Status" card on the Register tab (shown whether registration is open or closed). Anyone enters their email and sees status (✅/⏳/❌) per year, division assignment if approved, and a jump-link to Divisions if unassigned + self-select open. Also re-applied the email-lowercase-on-save fix (had reverted again).

### June 14, 2026 — Weekly Matchups: Scores Ranked View (`tournament.js`, `tournament.css`)
New ⚔️ Matchups / 📊 Scores toggle on the weekly matchups tab. Scores view is a flat ranked list of every team's score for the selected week, 25/page, with division/conference/league tags and gold-first/dim-last styling. CSS classes added to `tournament.css` matching existing `trn-wmu-*` design language.

### June 14, 2026 — Division Self-Select Reliability Overhaul (`tournaments/index.html`, `tournament.js`)
Multiple compounding issues fixed: replaced `prompt()`-based email entry with an inline modal (mobile-safe, retry-friendly); added `_isJoining` guard against double-tap; duplicate-division check no longer silently swallows read errors (aborts instead); orphaned rids (deleted registrations still in `memberIds`) hidden from public display. Admin Divisions tab: added ⚠️ multi-division detector + Fix button (removes duplicates, keeps last-alphabetical), 🗑 orphan detector + Clean button, ⬇ Export CSV (full roster with platform IDs grouped by division, unassigned at bottom), 👥 Gender Summary modal with per-division M/F/Other/unset breakdown.

### June 14, 2026 — Tournament Board Notification Fix (`app.js`, `tournament.js`)
Notifications for tournament board messages now show the actual tournament name (via new `DLRTournament.getTournamentName(tid)`) instead of generic "🏟 Tournament Board", and reliably navigate to the specific tournament's Chat tab via a retry loop (was a fragile single 150ms `setTimeout`). Fixed `chatKey` parsing to split on last underscore.

### June 14, 2026 — Email Opt-Out System (`tournament.js`)
New `emailOptOut` flag on participant records. Participants tab: per-row ✉/🚫 toggle, "🚫 Opted Out" filter, toolbar count. Participant detail modal: opt-out checkbox. New `_getOptOutEmails(tid)` helper used by all 4 email modals (lapsed, league invite, division invite, division-select) to silently exclude opted-out addresses.

### June 14, 2026 — Donations Tracker (`tournament.js`)
New 💰 Donations admin tab. Per-year config (label, default amount, payment methods). Per-registrant payment history with full audit trail (amount, method, note, date), add/edit/delete entries, stats header (collected/paid/unpaid/expected), CSV export.

### June 14, 2026 — Division System: Full Build + Auto-Publish (`tournament.js`, `tournaments/index.html`)
Persistent named divisions per year (`playoffs/{year}/divisions`). Admin: create/edit/delete, manual assign via search modal, 🎲 Random Assign All (fewest-members-first, respects caps). `_writeDivisionsPublic` now auto-fires after every membership mutation (assign/remove/random-assign) and after public self-select joins — previously only fired on manual "Publish to Public" click, causing the public site to show stale division rosters. Logged-in users get a 🗂 Divisions tab with "Your Division" highlight + self-select join.

### June 14, 2026 — Registration Double-Submit Fix (`tournaments/index.html`)
`_isSubmitting` guard + immediate button disable + `crypto.randomUUID()`-based rid (was timestamp-based, could collide within the same millisecond on rapid double-taps, producing duplicate registration entries like `modzrisfewhfp`/`modzrisf5vizq`).

### June 14, 2026 — Cache-Busting + Bug Fixes (`tournaments/index.html`, `tournament.js`)
Added `Cache-Control: no-cache` meta tags and corrected CSS version numbers on `tournaments/index.html`. Fixed `_wcWireBracketButtons` TDZ ReferenceError (`const () => {}` → `function(){}`). Fixed playoffs gate to bypass "Regular Season In Progress" message when `po.published || po.finalRankings`; Publish button now writes `published: true`. Fixed missing `totalPages` declaration in weekly matchups (ReferenceError). Fixed `multiDivRids`/`orphanRids`/`ridDivMap` closure scope bug in division admin event wiring (passed as explicit params).

### June 14, 2026 — Password Validation (`app-index.html`, `auth.js`)
Password minimum raised to 8 characters. Live strength indicator (Weak/Fair/Strong) and password-match feedback on registration form, validated client-side (capture phase) before `Auth.register()` fires. `auth.js` enforces 8-char minimum in `register()` and corrected error message.

### June 14, 2026 — Lapsed Player Report + Shared BCC Helper (`tournament.js`)
Rewrote F10 lapsed-player report to source from `participants` (historical DB) and do a fresh Firebase read on every click (was using stale closure data). New `_sendBccEmail()` helper shared across all 4 email modals — opens first 50 as mailto draft, shows remaining as copyable batches (browser only allows one `window.open` per gesture). All "From" field labels corrected to "Your Email (To:)".

---

### Earlier sessions (May 2026) — see prior summaries for full detail
- Custom Playoffs v4, World Cup tournament mode, draft ticker overhaul (snake/linear/Firebase merge), admin impersonation, Hallway H2H records, decathlon mode build, salary cap Firebase numeric-key corruption fix, registration year-scoping, tournament wizard polish, MFL/Yahoo platform integration to full parity, password reset via Cloudflare Worker + Resend.

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league/round at a time.*
