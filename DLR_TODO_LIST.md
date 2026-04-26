# Dynasty Locker Room — Master TODO List
*Updated: April 25, 2026 — F5-P3 fully complete + UI polish pass complete. F5-P4 playoffs scoped and ready to build.*
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

*(none currently)*

---

## 🟡 Mobile / UI Polish

*(none currently)*

---

## 🟢 New Features

---

### F1 — Dynasty/Keeper League Overview Tab
**Idea:** For dynasty and keeper leagues, add an "Overview" tab consolidating standings
and analytics across all years, with a year selector at the top.
**Files:** `standings.js`, `profile.js`, `locker.css`
**Note:** Significant feature — needs scoping session first.

---

### F2 — Custom Playoff Tracker
**Idea:** Define a custom playoff structure (e.g. Royal Rumble: bottom 4 → winner faces
next 4 → winner faces top 4 → top 2 for championship) that DLR tracks and updates
independent of what the platform reports.
**Files:** New module likely needed + `firebase-db.js`, `standings.js`, `index.html`
**Note:** Large feature. Overlaps with F5-P4 — revisit scope after P4 ships.

---

### F4 — Locker Room Visual Redesign + Team Customization
**Idea:** Redesign the main locker room UI to look like an actual locker. User can
select their favorite NFL team and the locker theme (colors, logo, textures) updates
to match. Interchangeable visual elements — door style, nameplates, decorations.
**Files:** New CSS theme system + `locker.css`, `base.css`, `profile.js`, `index.html`
**Note:** Needs design mockup attached to session.

---

### F5 — Tournament Mode (Cross-Platform)
**Spec:** `GMDynasty_Tournament_Spec.docx` (v1.0) — attach to any tournament session.
**Files:** `tournament.js`, `tournament.css`, `tournaments/index.html`
**Public URL:** `dynastylockerroom.com/tournaments`

**Phase 1 — Foundation ✅ COMPLETE**
**Phase 2 — Core Views ✅ COMPLETE** (Standings, Info, Rules, Registration, Participants)
**Phase 3 — Analytics ✅ COMPLETE**
**Phase 4 — Custom Playoffs** — scoped, ready to build (see below)
**Phase 5 — Advanced** — after Phase 4

---

## ── F5-P4: Custom Playoffs ─────────────────────────────────────────

**Architecture principle:** Playoff structure is stored as config data, not hardcoded logic.
Rules (qualification, seeding, byes, bracket) are configurable objects that the app interprets.
This keeps the system extensible without rewriting code for each new tournament format.

**Key decisions locked in:**
- Single elimination only (no double elimination — not used in fantasy football)
- Scores/results auto-sync from platform matchup data (Sleeper/MFL/Yahoo) — no manual score entry
- Playoffs are tournament-level (cross-platform, same bracket for all leagues)
- Tournament champion determined at tournament level; optional league champion recognition
- Admin + sub-admins can manually override any auto-generated bracket or matchup pairing
- Bracket size auto-suggested based on qualifier count + bye count (next power of 2)
- Admin can "draw" their own bracket for smaller tournaments

**Firebase node:** `gmd/tournaments/{tid}/playoffs/`

---

### F5-P4-A — Playoff config: champion determination method 🟡
**What:** Admin configures how the tournament champion is determined:
1. **Total Points** — champion = highest cumulative PF at end of regular season. No bracket.
2. **Bracket Playoff** — H2H elimination bracket, winner is champion.
3. **League Champions** — optionally surface per-league platform champions separately from tournament champion.
**Firebase:** `meta.championMethod: "points" | "bracket"`, `meta.recognizeLeagueChampions: bool`
**Files:** `tournament.js`

---

### F5-P4-B — Playoff config: qualification rules 🟡
**What:** Admin defines who qualifies. Config-driven, not hardcoded. Options:
- Top X by record
- Top X by PF
- Top X per conference / division
- Composite: top X by wins, then fill remaining spots by PF (exclude already selected)
- Manual override: admin hand-picks qualifiers regardless of standings

Admin UI uses a rule builder (dropdowns + number inputs), not raw JSON editing.
Sub-admins can also trigger manual override with appropriate permission.

**Firebase:** `playoffs.qualification: { method, count, perGroup?, steps?, manualOverride?: [teamId] }`
**Files:** `tournament.js`

---

### F5-P4-C — Playoff config: seeding + byes 🟡
**What:** After qualification, admin configures seeding order and any byes.
Seeding and qualification are separate concerns — teams may qualify one way and be seeded another.

Seeding options:
- By record (default)
- By PF
- By qualification order
- Manual / custom

Bye options:
- None
- Top N seeds get byes (most common)
- Metric-based (e.g. top seed by PF gets bye)
- Manual

Bracket size auto-suggested: given Q qualifiers and B byes, suggest next power of 2
bracket that fits (e.g. 10 teams → suggest 16-team bracket with 6 first-round byes,
or 8-team with 2 byes depending on config). Admin confirms or adjusts.

**Firebase:** `playoffs.seeding: { method }`, `playoffs.byes: { type, count }`, `playoffs.bracketSize: N`
**Files:** `tournament.js`

---

### F5-P4-D — Bracket generation + admin draw 🟡
**What:** Once qualification/seeding/byes are configured, bracket is generated.
Two modes:
1. **Auto-generate** — system places seeds into bracket slots based on seeding rules (1 vs last, 2 vs second-last, etc.)
2. **Manual draw** — admin drags/assigns teams to bracket slots directly. Available for any size but especially useful for smaller tournaments.

Admin can override any auto-generated bracket at any time (reassign teams to slots,
adjust matchups before a round starts).

Bracket is stateless and regenerable from config — stored result is just the slot assignments.

**Firebase:** `playoffs.bracket: { rounds: [ { matchups: [ { slot, teamA, teamB, byeSlot? } ] } ] }`
**Files:** `tournament.js`, `tournament.css`

---

### F5-P4-E — Playoff bracket rendering (user view) 🟡
**What:** Visual bracket for users showing all rounds, matchups, scores (auto-synced),
advancement, and champion. Renders from `playoffs.bracket` config.

Bracket sizing adapts to bracket size (8/12/16/etc.) — horizontal scrollable on mobile.
Shows: seed #, display name, score (from matchup sync), W/L result, advancement arrows.
Champion slot at the end with 🏆.

Also: Standings tab shows 🏆 next to tournament champion once determined.
If `recognizeLeagueChampions` is on, a separate section surfaces per-league platform champions.

**Files:** `tournament.js`, `tournament.css`

---

### F5-P4-F — Playoff weekly matchup sync 🟡
**What:** During playoff weeks, the Matchups tab surfaces bracket matchups labeled by round
(Quarterfinals / Semifinals / Championship). Scores pulled from the same platform sync
already in use for regular season. No new sync mechanism needed — just filter by playoff week range
and label by round based on bracket config.

Winner auto-advances in bracket when both scores are final for that week.
Admin can manually advance/override advancement if needed.

**Firebase:** `meta.playoffStartWeek`, bracket advancement tracked in `playoffs.bracket`
**Files:** `tournament.js`

---

### F5-P4-G — Points-only champion detection 🟡
**What:** When `championMethod === "points"`, champion = highest cumulative PF in standings.
No bracket generated. Standings tab shows 🏆 next to the leader. Once the final week
is synced, champion is locked and written to `playoffs.champion`.
**Files:** `tournament.js`

---

## ── F5-P4 Build Order ───────────────────────────────────────────────

| Step | Task | Notes |
|------|------|-------|
| 1 | F5-P4-A | Champion method + league champion flag — admin settings UI |
| 2 | F5-P4-B | Qualification rules — rule builder UI + Firebase write |
| 3 | F5-P4-C | Seeding + byes + bracket size suggestion |
| 4 | F5-P4-D | Bracket generation + manual draw UI |
| 5 | F5-P4-E | Bracket rendering (user view) |
| 6 | F5-P4-F | Matchup sync into bracket rounds |
| 7 | F5-P4-G | Points-only path |

Start with A+B+C in one session (all config/admin UI). Then D+E in one session (bracket render).
Then F+G to wire up live data.

---

## ── F5-P5: Advanced (after P4) ────────────────────────────────────

- Cross-platform identity merging (Sleeper username ↔ MFL email ↔ Yahoo)
- Weekly summary emails (email provider TBD)
- Message board integration
- MFL/Yahoo authenticated standings sync (admin provides credentials, not user)

---

### F6 — Locker Room Post-It Trash Talk Wall
**Idea:** Post-it style sticky notes on lockers, stored in Firebase.
**Files:** New `postits.js` or extend `hallway.js` + `firebase-db.js`, `locker.css`, `index.html`
**Note:** Depends on F4 being done first.

### F7 — Custom Trophy Builder
**Idea:** SVG-based trophy composer. Saved to Firebase, displayed in Trophy Room.
**Files:** New `trophy-builder.js` + extend `trophy-room.js`, `firebase-db.js`, `locker.css`, `index.html`

### F8 — Hallway: H2H Records in Common Leagues
**Idea:** In the locker modal, show head-to-head record against that manager
for each common league (dynasty/keeper shows combined H2H, redraft shows per-season).
**Files:** `hallway.js`

---

## Suggested Session Order

| # | ID | Description | Effort | Files Needed |
|---|-----|-------------|--------|--------------| 
| 1 | F5-P4-A/B/C | Playoff config: champion method + qualification + seeding/byes | High | `tournament.js` |
| 2 | F5-P4-D/E | Bracket generation + manual draw + user view render | High | `tournament.js`, `tournament.css` |
| 3 | F5-P4-F/G | Matchup sync into rounds + points-only path | Medium | `tournament.js` |
| 4 | F8 | Hallway: H2H Records | Medium | `hallway.js` |
| 5 | F1 | Dynasty Overview Tab | High | `standings.js`, `profile.js`, `locker.css` |
| 6 | F2 | Custom Playoff Tracker (individual leagues) | High | New module + several files |
| 7 | F7 | Custom Trophy Builder | High | `trophy-builder.js`, `trophy-room.js`, `locker.css` |
| 8 | F4 | Locker Room Redesign + Team Theme | Very High | New theme system + CSS refactor |
| 9 | F6 | Post-It Trash Talk Wall | High | `postits.js`, `firebase-db.js`, `locker.css` |

---

## Files Reference: What to Attach for Tournament Sessions

| Scenario | Attach These Files |
|---|---|
| Any tournament.js bug or feature | `tournament.js`, `tournament.css` |
| Public site changes | `tournaments/index.html` |
| Draft board rendering | `tournament.js`, `draft.js` |
| Draft player cards | `tournament.js`, `draft.js`, `playercard.js` |
| Standings improvements | `tournament.js`, `tournament.css`, `standings.js` |
| Bracket rendering | `tournament.js`, `tournament.css`, `standings.js` |
| Worker endpoint changes | `worker.js` |
| CSS consistency pass | `tournament.css`, `locker.css`, `base.css` |

---

## ✅ Completed

### April 25, 2026 — UI Polish Pass (Mobile + Draft Cards + Standings)

- **Roster tab mobile — 2 per row:** `trn-rosters-grid` changed from `1fr` to `repeat(2, 1fr)` on mobile. (`tournament.css`)
- **Standings — PA column removed:** PA `<th>` and `<td>` removed from both internal and public standings tables. Data still computed internally; just not displayed. Frees space for team name + Twitter pill. (`tournament.js`, `tournaments/index.html`)
- **Standings mobile tightening:** W/L columns 22px, PF 44px, rank 20px, cell padding 2px, font .72rem. `!important` added to override `locker.css` base padding in the internal app. Both internal and public sites now match. (`tournament.css`)
- **Standings sub-line fix:** Mobile sub-line (`.trn-st-league--mobile`) changed from `teamName · leagueName` to just `leagueName` — display name was already on line 1. (`tournament.js`, `tournaments/index.html`)
- **Draft card redesign:** Position-colored background tint (`{posColor}18`) on each card. Name abbreviated to `J. Jefferson` format. Position badge removed. `pos · NFL` rendered inline after name as dimmed `.draft-pick-pos-team` span. Two lines: player name + pos·team (line 1), fantasy team name (line 2). Applied across all four board renderers (Sleeper, MFL, Yahoo, tournament analytics). (`draft.js`, `tournament.js`, `locker.css`)
- **Tournament draft board mobile — 4-col fit:** `draft-picks-row` forced to `repeat(4, 1fr)`, `overflow-x: hidden`, cards `min-height: 48px`, padding/gap condensed. Cards now fit 4-across without horizontal scroll. (`tournament.css`)

### April 25, 2026 — F5-P3 Completion

- **F5-P3-S6 — Rules year-specific versioning:** Storage moved to `rulesByYear/{year}/`. Admin editor has year dropdown seeded from `standingsCache` + `registrationYear` + current year. User Rules tab has year selector when multiple years exist. Public site reads `rulesByYear` for both preview and full Rules tab. (`tournament.js`, `tournaments/index.html`)
- **F5-P3-S7 — CSS consistency pass:** `.trn-az-pill` rewritten to match `.season-pill` pattern from `locker.css` (radius-sm, gold hover/active). `color-text-muted` → `color-text-dim` throughout. `var(--color-surface-2)` fallbacks added. (`tournament.css`)
- **Public bio and rules:** `renderInfoTab` on public site reads from `rulesByYear`. Rules tab added to public nav (year selector, full content render). (`tournaments/index.html`)
- **Registrant template CSV:** ⬇ Template button on registrants tab downloads a dynamic CSV matching the tournament's actual registration form fields. (`tournament.js`)
- **Participant template CSV:** ⬇ Template button on participants tab downloads a fixed shell CSV with all importable columns and an example row. (`tournament.js`)
- **Registrant delete:** 🗑 Delete button in registrant View modal. Confirm dialog, removes from Firebase, updates public summary, re-renders tab. (`tournament.js`)

### April 25, 2026 — Tournament Small Fixes Batch + Bug Fixes

- **F5-P3-S1 — Registration year in header:** Registration overlay and section card title now read `meta.registrationYear` (stamped when admin advances to `registration_open`) instead of the standings year. Falls back to `new Date().getFullYear()`. Public site uses `t.registrationYear` from public node. (tournament.js, tournaments/index.html)
- **F5-P3-S2 — Standings desktop/mobile column strategy:** Desktop (>640px) shows League and Conference as separate columns (`trn-col-league`, `trn-col-conf`). Mobile hides those columns and shows a stacked sub-line under the display name. Identical CSS behavior on internal and public sites. (tournament.js, tournament.css, tournaments/index.html)
- **F5-P3-S3 — Public standings Twitter handle:** Desktop shows `@handle` as a pill badge next to the name (matching gender badge style). Mobile sub-line makes the display name itself a clickable Twitter link, followed by " · League Name". `twitterHandle` added to `participantMap` in `_writePublicSummary` so it flows to the public node. Internal standings match the same pill format. (tournament.js, tournament.css, tournaments/index.html)
- **F5-P3-S4 — Info page "Years" stat:** Stat card now computes distinct years from `standingsCache` and shows "X Years" when standings data exists, falling back to "X Leagues" for new tournaments without history. Both internal and public. (tournament.js, tournaments/index.html)
- **Bug — `_writePublicSummary` wiping ADP:** Switched from `.set()` to `.update()` on `publicTournaments/{tid}` so `adp` and `adpByYear` written by `_writePublicADP` are never overwritten. (tournament.js)
- **Bug — rankBy handler missing `_writePublicSummary` call:** Standings ranking dropdown save now calls `_writePublicSummary` after updating Firebase. (tournament.js)
- **🔄 Re-publish Public Summary button:** Added to Admin Tools card on Overview tab. Does a fresh Firebase read then calls both `_writePublicSummary` and `_writePublicADP` — use this any time participant data (names, handles, gender) needs to be pushed to the public site. (tournament.js)

### April 24, 2026 — Auth, Profile, Tournament

- **A1 — Password reset:** "Forgot your password?" link on login screen. Looks up real email from `gmd/users/{username}/email`, calls Firebase `sendPasswordResetEmail()`. Wired entirely in `auth.js` + inline script in `index.html`. `auth.css` updated with `.auth-forgot`, `.auth-reset-hint`, `.auth-success` styles. (auth.js, auth.css, index.html)
- **A2 — Delete league / delete platform from profile:** Single-league delete from ⋯ options modal (🗑 Remove button). Platform batch delete (🗑 Remove All) per platform in Edit Profile. Shared `#delete-league-modal` confirmation dialog. `GMDB.deleteLeague()` and `GMDB.deleteLeaguesByPlatform()` added — both clean up `leagueMeta` entries. In-memory state and rendered cards update immediately after delete. `btn-danger` style added to `locker.css`. (firebase-db.js, profile.js, index.html, locker.css)
- **F5-P3-S8 — Duplicate registration prevention:** Check runs at top of `_submitRegistration` before field validation. Matches on DLR username, email, and Sleeper username against existing registrations. Shows clear message and blocks second submission. (tournament.js)
- **F5-P3-U5 — Rosters tab layout overhaul:** Position-group layout matching league detail roster tab (`roster.js` pattern: `roster-pos-group` / `roster-pos-header` / `roster-player-row`). Starters and bench together, sorted by rank within group, bench dimmed at opacity .45. Single-line player rows: name + NFL team abbreviation inline. 5-across CSS grid on desktop (`repeat(5, 1fr)`, `align-items: stretch`), single column on mobile. All card bodies equal height via `flex: 1` on `.trn-roster-body`. (tournament.js, tournament.css)

### F5-P3 — Analytics (Draft, ADP, Admin UI) — completed April 2026
- **F5-P3-B1:** Draft team ID collision — picks keyed as `{leagueId}:{teamId}` throughout `_renderAnalyticsDraft` and `_loadAndRenderMatchups`
- **F5-P3-B2:** Matchups sorting — fixed after B1; debug logs confirm top-3 per sort bucket
- **F5-P3-U1:** Draft board — `draft.js`-style pick cells, `slot_to_roster_id` column ordering, snake/3RR/linear direction, grid + list toggle, `DLRPlayerCard.show()` on click
- **F5-P3-U2:** ADP — flat ranked list by ADP; columns: #, Player (pos+name+NFL stacked), Dft, ADP, Min, Range (p25–p75), Max; responsive 5-col on mobile (drops Dft/Range); position filter; 25/page pagination
- **F5-P3-U3:** Draft card — two-column horizontal layout ordered by overall pick#; shows round.pick + (#overall) + pos badge + name + steal/reach badges (💎/🚀 based on p25/p75); canvas-drawn PNG download; Web Share API on mobile; right-click to save
- **F5-P3-S5:** Admin settings UI — Standings Ranking (H2H Record / Points For), Median Wins, and 3rd-Round Reversal all use Yes/No toggle buttons with `?` tooltip helpers; Twitter Column setting removed (handle always embedded inline)
- **Draft board snake/3RR direction** — `_roundOrder()` helper: snake reverses on even rounds; 3RR uses `round % 3 !== 1` (R1 forward, R2+R3 reversed, R4 forward, R5+R6 reversed…). Pick lookup by `overall` number is authoritative regardless of format
- **Worker fix (pick_no)** — Sleeper `pick_no` used for `overall` instead of `draft_slot`; `slot_to_roster_id` and `draft_type` returned alongside picks; `nflTeam` added; requires `wrangler deploy` + analytics cache clear
- **Public ADP by year** — `_writePublicADP` writes to `adpByYear/{year}` + flat `/adp`; public site reads year-specific ADP; year selector fetches correct year on demand; auto-refresh during active drafts stops when tournament goes inactive
- **`_computeADP`** — now returns `min`, `max`, `p25`, `p75` via linear interpolation
- **`_adpRefreshTimer`** — declared in outer scope in `tournaments/index.html`
- **F5-P3-U4:** Matchups UX overhaul — 5-card horizontal grid, 4 dropdown sections (Highest/Lowest/Closest/Blowouts), matchup cards with winner/loser/Δ/league lines, score histogram with median line and stat legend, improved AI recap prompt with distribution + lowest scorers

### Earlier completed items
- **Item 2 (Session A):** Options modal gating — commish-only fields hidden from non-commish users
- Yahoo Standings, Matchups, Roster tab, Players tab, Analytics, token persistence (Y4 fully fixed)
- MFL playoff detection, guillotine/eliminator handling, identity matching, transaction parsing, matchup cards, bracket rendering, auction system, bundle reliability
- DynastyProcess CSV player mappings; draft multi-selector; aborted draft filter
- Mobile viewport, safe area, stuck panel, input zoom fixes
- DNS rollback; Cloudflare worker OAuth; Firebase token storage
- Hallway: Firebase-backed pins, pagination, common-league modals, card/grid layout, mobile scroll
- **F5-T1:** Median wins — Sleeper weekly scores fetched, median computed, +1W/+1L credited per week
- **F5-P2:** Info tab (bio/social/donation/rules preview), Rules tab, admin Info/Rules editor
- **F5-P3 nav:** Tab bar → dropdown everywhere, global year selector, Manage/View split, admin analytics tabs
- **F5-P3 standings:** League name stacked under display name, Twitter as inline link, fixed-width columns
- **Register pill:** Title row button, full-screen overlay
- **Public site (`tournaments/index.html`):** Year selector, tab select, standings mobile fix, rich Info tab, ADP tab with auto-refresh

---

## Console Scripts (Safe to Run)

### Clear tournament analytics cache (force re-fetch)
```js
const TID = "YOUR_TOURNAMENT_ID"; // ← replace
await firebase.database().ref(`gmd/tournaments/${TID}/analyticsCache`).remove();
console.log("Analytics cache cleared");
```

### Diagnose tournament draft data in Firebase
```js
const TID = "YOUR_TOURNAMENT_ID"; // ← replace
const snap = await firebase.database().ref(`gmd/tournaments/${TID}/analyticsCache/drafts`).get();
const drafts = snap.val() || {};
Object.keys(drafts).forEach(k => {
  const d = drafts[k];
  console.log(`${k}: ${d.picks?.length || 0} picks, platform=${d.platform}, year=${d.year}`);
  if (d.picks?.length) console.log(`  sample:`, d.picks[0]);
});
```

### Check MFL league data health
```js
const snap = await firebase.database().ref('gmd/users/mraladdin23/leagues').get();
const leagues = snap.val() || {};
const mfl = Object.entries(leagues).filter(([k,v]) => v.platform === 'mfl');
console.log('MFL total:', mfl.length, '| Resolved:', mfl.filter(([k,v]) => v.resolved).length);
```

### Check Yahoo token in Firebase
```js
const snap = await firebase.database().ref('gmd/users/mraladdin23/platforms/yahoo/tokens').get();
console.log('Yahoo tokens:', snap.val());
```

### Surgical fix for a single wrong league
```js
const key = "yahoo_2024_123456"; // replace with actual key
await firebase.database().ref(`gmd/users/mraladdin23/leagues/${key}`).update({
  playoffFinish: null, isChampion: false, resolved: null
});
console.log("Fixed", key);
```

### Clear bundles node (safe — only clears cached bundles, not league data)
```js
await firebase.database().ref('gmd/users/mraladdin23/bundles').remove();
console.log("Bundles cleared");
```

---

*⚠️ NEVER run bulk Firebase reset scripts. Fix stale data surgically, one league at a time.*
