# Dynasty Locker Room — Master TODO List
*Updated: May 7, 2026 — Tournament landing page overhaul, participant sync, mobile fixes all complete.*
*Attach with DLR_PROJECT_SUMMARY.md + specific files per task.*

---

## How to Use This Doc
Each issue is self-contained. For each session: attach this doc + project summary +
only the files listed under that issue. Fix one issue per session where possible.
After completing an issue, move it to the ✅ Completed section at the bottom.

---

## 🔴 Critical — Crashes or Broken Core Features

*(none currently)*

---

## 🔴 Yahoo Platform Bugs

*(none currently)*

---

## 🔴 MFL Platform Bugs

*(none currently)*

---

## 🟡 Cross-Platform Bugs

*(none currently — X3 de-prioritized, may not be a real issue)*

---

## 🟡 Mobile / UI Polish

*(none currently)*

---

## 🟢 Tournament — New Features & Polish

### T5 — Total Points Mode: Single-Round Multi-Week Championship Window
**Status:** ✅ Complete — validated end-to-end. Admin can configure a single championship round spanning multiple weeks.

---

### A2 — Registration Confirmation Email
**Idea:** When a user submits a tournament registration, send a confirmation email acknowledging receipt.
**Files:** `tournament.js`, `worker.js`
**Note:** Resend + `support@dynastylockerroom.com` is fully set up (used for password reset). Add a `/tournament/confirmRegistration` worker endpoint that calls Resend after a successful registration write. No new infrastructure needed — just a new worker endpoint + call from `_submitRegistration`.

---

## 🟢 Auth & Account

### A1 — Contact Email for Support
**Idea:** Add a visible support contact email somewhere accessible to users — login screen, registration confirmation, or a footer on the public site.
**Files:** `auth.css`, `index.html`, `tournaments/index.html`
**Note:** Support email is `support@dynastylockerroom.com`. Simple text addition.

---

## 🟢 UX / Notification

### U1 — Global Draft Ticker (Tournament Drafts)
**Idea:** A global sticky ticker bar (like the auction ticker) that shows currently active tournament drafts, who is on the clock, what pick number, and how many picks until the logged-in user is up. Notification when it's their turn.
**Files:** `tournament.js`, `draft.js`, `locker.css`
**Note:** The auction module already has a ticker — study that pattern. Draft live polling (15s interval for Sleeper) is already in place from X2 fix — ticker can piggyback on that. MFL/Yahoo still need manual refresh.

---

## 🟢 New Features

### F1 — Dynasty/Keeper League Overview Tab
**Idea:** For dynasty and keeper leagues, add an "Overview" tab consolidating standings and analytics across all years, with a year selector at the top.
**Files:** `standings.js`, `profile.js`, `locker.css`
**Note:** Significant feature — needs scoping session first.

---

### F2 — Custom Playoff Tracker (Individual Leagues)
**Idea:** Define a custom playoff structure per league (e.g. Royal Rumble format) tracked inside DLR.
**Files:** `standings.js`, `locker.css`
**Note:** Significant feature — needs scoping session first.

---

### F4 — Locker Room Visual Redesign + NFL Team Themes
**Idea:** Allow users to choose an NFL team theme for their locker room — team colors applied to the card UI, header, and background tint.
**Files:** `locker.css`, `profile.js`, `app.js`
**Note:** Nice-to-have polish. Low priority.

---

### F6 — Post-It Trash Talk Wall
**Idea:** A per-league digital "trash talk wall" — sticky notes posted by managers, visible to all league members.
**Files:** `chat.js` (reference), `tournament.js` or new module
**Note:** The tournament message board (💬 Board tab) was just built — can use the same Firebase + chat bubble pattern. Scope for individual leagues, not just tournaments.

---

### F7 — Custom Trophy Builder
**Idea:** Admin can design and award custom trophies to participants (e.g. "Worst Drafter", "Injury Magnet"). Displayed in the player's profile.
**Files:** `trophy-room.js`, `tournament.js`, `locker.css`
**Note:** Fun feature. Low priority.

---

### F8 — Hallway H2H Records in Common Leagues
**Idea:** In the Hallway manager modal, show head-to-head record per common league (combined for dynasty/keeper chains, per-season for redraft).
**Files:** `hallway.js`
**Note:** Medium effort. Well-scoped. Good candidate for a focused session.

---

## 🔧 Console Scripts (for surgical Firebase fixes)

### Clear stale draft cache for one league
```js
const tid = "YOUR_TID";
const lid = "YOUR_LEAGUE_ID";
await firebase.database().ref(`gmd/tournaments/${tid}/analyticsCache/drafts/${lid}`).remove();
console.log("Draft cache cleared for", lid);
```

### Clear bundles node (safe)
```js
await firebase.database().ref('gmd/users/mraladdin23/bundles').remove();
console.log("Bundles cleared");
```

### Force-republish public summaries (if playoffMode/createdBy missing)
Open DLR while logged in as admin — `_backfillPublicSummaries()` runs automatically on tournament page load and republishes any stale public nodes.

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*

---

## ✅ Completed

### May 7, 2026 — Tournament Landing Page Overhaul, Participant Sync, Mobile Fixes

**🏆 Tournament Landing Page — List Row Layout (`tournament.js`, `tournament.css`, `tournaments/index.html`)**
- Replaced card grid with compact single-line list rows on desktop
- Row structure: 4-line mobile layout — (1) name, (2) description, (3) type badge + stats, (4) status + buttons
- Desktop: `trn-row-main` (flex:1) + `trn-row-right` (fixed 260px) with `trn-row-actions` (fixed 162px)
- Fixed column alignment using `align-items: stretch` on `.trn-row` with `align-items: center` on right panel
- `overflow: hidden` removed from `trn-row-main` (was clipping rows)
- Mobile (`≤700px`): rows stack to 4 lines; `trn-row-right` goes full width with border-top separator
- Desktop fixed widths moved to `@media (min-width: 701px)` block — mobile no longer fights overrides
- Internal app mobile fix: `overflow-x: hidden !important` on `#view-tournament.active` at both 640px and 700px to counteract `locker.css .screen.active { overflow: hidden }` which was causing horizontal clipping

**🔍 Tournament Filters (`tournament.js`, `tournament.css`)**
- Three filter dropdowns (View/Type/Admin) now on one line using `flex: 1 1 0` with `flex-wrap: nowrap`
- Type filter uses `_tMode(t)` helper which reads `playoffs[mostRecentYear].mode` correctly (was reading wrong key `t.playoff`)
- Admin filter populated from `meta.createdBy` across all tournaments
- Alphabetical sort on tournament name
- Pagination: 10 per page with Prev/Next at top and bottom
- "My Tournaments" — shows only `discoveredBy` (league match) or `dlrLinked` participant match; admin-only excluded
- Public site: same Type + Admin filters; Type filter left, Admin filter right

**📖 Tournament Type Guide (`tournament.js`, `tournament.css`)**
- `📖 Tournament Type Guide` button as subtle text link below `+ New Tournament`
- Also appears as `📖 Type Guide` link below `+ Season` in playoff config year bar
- Tabbed modal — 5 type buttons across top, one panel at a time (Points Rounds / H2H Bracket / Custom Rounds / World Cup / Total Points)
- Each panel: summary, "Best for" callout, numbered setup steps

**🏷 Tournament Type Badges**
- Color-coded inline badges: gold (Points Rounds), blue (H2H Bracket), purple (Custom Rounds), green (World Cup), gray (Total Points)
- Appear on both internal list rows and public site

**🌐 Public Site Parity (`tournaments/index.html`)**
- Same list-row layout as internal app
- `playoffMode` and `createdBy` written to `gmd/publicTournaments/{tid}` via `_writePublicSummary`
- `_backfillPublicSummaries()` auto-runs on page load to republish any stale public nodes missing these fields
- Public site filters match internal: Type (left) + Admin (right)

**👥 Participant Auto-Sync (`tournament.js`)**
- `⚡ Sync from Leagues` button in Participants toolbar
- `_autoSyncParticipants(tid, t)`: iterates all league batches, fetches rosters from Sleeper/MFL/Yahoo APIs
- Sleeper: uses `user_id` as `dedupKey` (always unique), `username || display_name` as `sleeperUsername`
- MFL: `email` as `dedupKey` and `mflEmail`; team name as `displayName`
- Yahoo: `managerNickname` as `dedupKey` and `yahooUsername`; nickname/team name as `displayName`
- All platforms: if no registration data, platform identity value populates `displayName`
- Fresh Firebase read before building dedup lookup (avoids stale snapshot duplicates)
- Single `participantsRef.update(updates)` write (atomic, surfaces errors)
- `_matchParticipantsToDLR` called automatically after sync on all participants
- DLR match indexes: `platforms/sleeper/sleeperUsername`, `platforms/sleeper/username`, `platforms/sleeper/displayName` (all three checked); `platforms/mfl/mflEmail`; `platforms/yahoo/username`
- Single authoritative reload + re-render after all writes complete
- Existing participants: patch only fills missing fields (no overwrite of existing data)

**📱 Mobile UI Polish (`tournament.css`)**
- Section pages (roles, registrants, participants, registration form): stay single-row on mobile with tighter font sizes
- Registrant/participant rows: `flex-wrap: nowrap`, name `.80rem` truncates, meta `.68rem` truncates, buttons `3px 7px`
- Role rows: single line, avatar shrinks to 26×26, name `.80rem`, scope `.68rem`
- Registration Type radio labels: `.82rem` to match section card body font (was `.88rem`)
- Global baseline: `.trn-container` and `.trn-detail-container` set to `.86rem` on mobile

**🔄 Draft Tab Fixes (`tournament.js`)**
- Draft updates live on refresh: `_draftForceRefresh` flag bypasses both Firebase and in-memory cache
- Set `true` by refresh button and by live poll when picks change; cleared after fetch
- Draft league dropdown no longer snaps back on selection (`selected` attribute on current `_draftLeague`)

---

### May 6, 2026 — Tournament Message Board, Matchups Tab, Form Builder, H2H Bracket, Registration Import

*(see previous entries)*

---

### May 5, 2026 — B1, B2, X1, X2: Bug Fix Session

*(see previous entries)*

---

### May 5, 2026 — World Cup Tournament Mode: Full Implementation

*(see previous entries)*

---

### April 30, 2026 — T1–T4: Tournament Polish + Public Players Tab Parity

*(see previous entries)*

---

### April 29, 2026 — F5-P4-ext / F5-P4: Custom Playoffs, Players Tab, finalRankings

*(see previous entries)*

---

### Earlier completed items

- Yahoo OAuth, standings, matchups, playoffs, roster, players, draft, transactions, analytics
- MFL playoff detection, identity matching, bundle reliability
- Auth, mobile scroll, DNS, Cloudflare Worker, Firebase token storage
- Hallway: Firebase pins, pagination, common-league modals
- F5 Phases 1–3: foundation, standings sync, public site, registration, participants, analytics

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*
