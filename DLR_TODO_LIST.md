# Dynasty Locker Room — Master TODO List
*Updated: May 6, 2026 — Tournament message board, weekly matchups tab, form builder, H2H bracket, registration import all resolved.*
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
**Status:** ✅ Partially done — admin can now delete all non-championship rounds leaving one window. Config UI (Section D rounds tab) allows setting weeks for the single championship round.
**Remaining:** Verify the scoring path in `_renderTotalPointsTab` correctly sums across multiple weeks for this single-round configuration. May need a session to validate end-to-end.
**Files:** `tournament.js`

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

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*

---

## ✅ Completed

### May 6, 2026 — Tournament Message Board, Matchups Tab, Form Builder, H2H Bracket, Registration Import

**💬 Tournament Message Board (`tournament.js`, `tournament.css`, `tournaments/index.html`)**
- Real-time Firebase-backed message board per tournament per year (`gmd/tournamentChats/{tid}_{year}/`)
- Full chat feature parity with league chat: emoji picker, GIF search (Tenor), smack talk presets, poll creator
- Messages render as chat bubbles (yours right/accent, theirs left)
- Admin can delete any message; users can delete their own
- Available on both internal admin/user view and public tournament page
- Public page: read-only for anonymous visitors, sign-in prompt for posting

**🏈 Weekly Matchups Tab (ESPN-style) (`tournament.js`, `tournament.css`)**
- New "Matchups" tab (renamed old "Matchups" → "Match Analysis" for highlights/blowouts)
- Week selector defaulting to latest played week; conference/division/league filter dropdown
- Always-visible filter: individual league names even when no conf/div structure configured
- 3-per-row cards desktop, 2-per-row tablet, 1-per-row mobile
- Fetches from Sleeper (direct), MFL + Yahoo (via worker)
- Stale cache cleared on tournament switch and year change

**📋 Registration Form Builder (`tournament.js`, `tournament.css`)**
- Unified drag-and-drop field list — all field types (standard, optional, custom) in one list
- Native HTML5 drag-and-drop reordering across all field types
- Standard fields (displayName, email): can reorder, can't delete (🔒 icon)
- Optional fields: "Add field" dropdown, appear/disappear correctly
- Custom questions: compact inline rows with type selector, Required checkbox, dropdown option rows (add/delete per option), textarea for paragraph type
- Saves `fieldOrder[]` array preserving order for user-facing form
- User-facing form respects `fieldOrder` — custom questions can be interleaved with std/opt fields
- 👁 Preview button shows modal of exact form appearance before saving
- Backwards compatible — existing tournaments auto-migrate from old format on first save

**🏆 H2H Bracket Rounds Builder (`tournament.js`)**
- Moved from Byes & Seeding section to Section D "Round Config (H2H)" tab
- Full round list: Round 1, Round 2… 🏆 Championship (fixed last, can't delete)
- Each round: weeks per round input + season-avg blend toggle (same as points_rounds)
- "+ Add Round" inserts before championship; ✕ removes non-championship rounds
- Saves as `po.h2hRounds: [{weeksPerRound, blend}]` + `po.h2hRoundWeeks[]` for backward compat
- Tight WC-style bracket canvas (T7): absolute-position centreR0/centreOf/topOf math, same as World Cup
- Reseed after each round toggle in Byes & Seeding
- Multi-week scoring: `_wprFor(ri)` + `_roundStart(ri)` sum across correct NFL weeks per round
- Blend applied to H2H scores same as points_rounds

**📥 Registration Import Fixes (`tournament.js`)**
- Template column order now respects `fieldOrder` (admin-configured form order)
- Custom question columns exported as `custom_0`, `custom_1` etc (never raw question text)
- Template includes `# custom_0 = Question text` comment lines for reference
- Importer strips comment lines, sanitizes all CSV headers via `_sanitizeKey` — strips `.#$/[]` from keys
- Import normalizes `status` to lowercase (`"Approved"` → `"approved"`)
- Registrants tab now fetches directly from `_tRegsRef(tid)` (not from stale tournament snapshot) — fixes large-batch display issue
- Unknown status bucket: records with unrecognized status shown in "⚠️ Unknown Status" section with one-click "Fix all → approved" bulk normalizer
- `_setRegistrationStatus` and delete handler no longer do full `_tRef` reload (avoided stale snapshot on re-render)

---

### May 5, 2026 — B1, B2, X1, X2: Bug Fix Session

**B1 — Password Reset** — Moved entirely to Cloudflare Worker. Worker fetches real email via DB secret, mints Google OAuth token from service account JWT, calls Firebase Auth Admin REST API with `returnOobLink: true`, sends via Resend.

**B2 — Salary Cap Manual Entry Not Persisting** — Force-reads from Firebase immediately after `_saveSalaryData()` to bust SDK cache.

**X1 — Registration Stickiness** — Success message targets correct overlay body. Duplicate check fetches fresh registrations via `_tRegsRef`.

**X2 — Tournament Draft Not Updating Live** — Worker prefers `"drafting"` draft. 24h Firebase + 5-min memory caches bypassed for active drafts. `_startDraftPoll`/`_stopDraftPoll` 15s Sleeper polling added.

---

### May 5, 2026 — World Cup Tournament Mode: Full Implementation

Full World Cup bracket + group standings + players tab. See previous entry for full detail.

---

### April 30, 2026 — T1–T4: Tournament Polish + Public Players Tab Parity

T1 multi-week playoff rounds, T2 public players tab, T3 custom rounds finalRankings, T4 H2H bracket finalRankings.

---

### April 29, 2026 — F5-P4-ext: Players Tab, Most Rostered, ADP vs Finish, finalRankings

Players tab (internal + public), finalRankings authoritative rank, Most Rostered, ADP vs Finish.

---

### April 29, 2026 — F5-P4: Custom Playoffs — FULLY COMPLETE

Full playoff configuration, display, live scoring, and public site integration for Tournament Mode.

---

### Earlier completed items

- Yahoo OAuth, standings, matchups, playoffs, roster, players, draft, transactions, analytics
- MFL playoff detection, identity matching, bundle reliability
- Auth, mobile scroll, DNS, Cloudflare Worker, Firebase token storage
- Hallway: Firebase pins, pagination, common-league modals
- F5 Phases 1–3: foundation, standings sync, public site, registration, participants, analytics

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*
