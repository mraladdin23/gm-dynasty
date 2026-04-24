# Dynasty Locker Room — Master TODO List
*Updated: April 24, 2026 — F5-P3 Analytics mostly complete. Remaining: U5 (Rosters), S-series small fixes, then P4 (Custom Playoffs).*
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
**Note:** Large feature. Related to F5-P4 Tournament Playoffs below.

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
**Phase 3 — Analytics ⚠️ IN PROGRESS** (U4, U5, S-series remain)
**Phase 4 — Custom Playoffs** — next major milestone after P3 is clean
**Phase 5 — Advanced** — after Phase 4

---

## ── F5-P3: Analytics UX Improvements ──────────────────────────────

### F5-P3-U5 — Rosters: horizontal position-group card layout 🟡
**What:** Reorganize the roster card to show players in horizontal position groups
going across the card (QB | RB | WR | TE | FLEX | K | DEF), starters first then
bench, ordered by rank/name within each group. Currently shows a flat vertical list.
**Files:** `tournament.js`, `tournament.css`
**Attach:** `tournament.js`, `tournament.css`

---

## ── F5-P3: Small Fixes (quick wins) ───────────────────────────────

### F5-P3-S1 — Registration: include tournament name + year in header 🟢
**What:** Register button overlay title should say "Register for [Name] [Year]"
(e.g. "Register for Scott Fish Bowl 2025") to make it unambiguous which year's
registration the user is submitting.
**Files:** `tournament.js`, `tournaments/index.html`
**Attach:** `tournament.js`, `tournaments/index.html`

### F5-P3-S2 — Standings: desktop vs mobile column strategy 🟢
**What:** On desktop (>640px) restore League and Conference as separate columns.
On mobile keep them stacked under display name. Internal and public site should use
identical CSS.
**Files:** `tournament.css`, `tournaments/index.html`
**Attach:** `tournament.css`, `tournaments/index.html`

### F5-P3-S3 — Public site: Twitter handle in standings 🟢
**What:** On desktop (public site), show Twitter handle in parentheses after the
display name as a clickable link. On mobile, make the display name itself the clickable
link to their Twitter profile (if available).
**Files:** `tournaments/index.html`
**Attach:** `tournaments/index.html`

### F5-P3-S4 — Info page: "Leagues" stat should say "Years" 🟢
**What:** The stat card on the Info tab says "X Leagues" but it actually represents
the number of distinct years the tournament has run. Change label to "Years" and
compute from distinct years in standingsCache.
**Files:** `tournament.js`, `tournaments/index.html`
**Attach:** `tournament.js`, `tournaments/index.html`

### F5-P3-S6 — Rules: year-specific versioning 🟢
**What:** Rules should be storable per year so 2023 rules are preserved when 2024
rules are published. Store at `gmd/tournaments/{tid}/rulesByYear/{year}/` instead of
`gmd/tournaments/{tid}/rules/`. Admin can see a year dropdown to view/edit past rules.
Users see the rules for the currently selected year.
**Files:** `tournament.js`
**Attach:** `tournament.js`

### F5-P3-S7 — CSS consistency pass 🟢
**What:** Audit tournament.js / tournament.css / tournaments/index.html for visual
inconsistencies with the main app (locker.css patterns). Specific items:
- View pills should match `.season-pill` / `.season-pill--current` style from locker.css
- Card component styling should match `.trn-section-card` consistently
- Font sizes, spacing tokens, color variables should reference base.css vars not hardcoded values
**Files:** `tournament.css`, `locker.css` (reference), `tournaments/index.html`
**Attach:** `tournament.css`, `tournaments/index.html`

---

## ── F5-P4: Custom Playoffs ─────────────────────────────────────────

**This is the next major milestone after P3 is complete.**

### F5-P4-A — Playoff config: champion determination method 🟡
**What:** Admin configures how the tournament champion is determined. Two modes:
1. **Total Points** — champion is team with highest cumulative PF (no bracket).
2. **Bracket Playoff** — traditional elimination bracket.
**Firebase:** `meta.championMethod: "points" | "bracket"`
**Files:** `tournament.js`

### F5-P4-B — Playoff config: qualification rules 🟡
**What:** Admin defines how teams qualify for the bracket. Options: top X by record,
top X by PF, top X per conference, manual override.
**Firebase:** `meta.playoffQualification: { method, count, perGroup? }`
**Files:** `tournament.js`

### F5-P4-C — Playoff config: bracket format 🟡
**What:** Single elimination, double elimination, or custom seeding.
**Firebase:** `meta.bracketFormat: "single" | "double" | "custom"`
**Files:** `tournament.js`

### F5-P4-D — Playoff bracket rendering (user view) 🟡
**What:** Visual bracket for users showing matchups, results, advancement, champion.
Reuse bracket rendering patterns from `standings.js` where possible.
**Files:** `tournament.js`, `tournament.css`, `standings.js` (reference)

### F5-P4-E — Playoff weekly matchup sync 🟡
**What:** During playoff weeks, Matchups tab shows bracket matchups labeled by round
(Quarterfinals, Semifinals, Championship).
**Files:** `tournament.js`

### F5-P4-F — Points-only champion detection 🟡
**What:** When `championMethod === "points"`, champion = highest PF in standings.
No bracket. Standings tab shows 🏆 next to top-PF team.
**Files:** `tournament.js`

**Open questions before building P4:**
- Double elimination: build now or defer to P5?
- How does admin input results? Auto-sync from matchup data, manual entry, or hybrid?
- F2 (Custom Playoff Tracker for individual leagues) overlaps with F5-P4 — merge or keep separate?

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
| 1 | ~~F5-P3-U4~~ | ~~Matchups: card layout + score histogram~~ | ✅ Done | — |
| 2 | F5-P3-U5 | Rosters: horizontal position-group layout | Small | `tournament.js`, `tournament.css` |
| 3 | F5-P3-S1–S4 | Small fixes batch (registration, standings, info, years) | Medium | `tournament.js`, `tournament.css`, `tournaments/index.html` |
| 4 | F5-P3-S6 | Rules: year-specific versioning | Small | `tournament.js` |
| 5 | F5-P3-S7 | CSS consistency pass | Medium | `tournament.css`, `tournaments/index.html` |
| 6 | F5-P4 scoping | Custom playoffs scoping session | — | `tournament.js` |
| 7 | F5-P4-A/B/C | Playoff config: method + qualification + format | High | `tournament.js` |
| 8 | F5-P4-D/E/F | Playoff bracket rendering + sync + champion | High | `tournament.js`, `tournament.css`, `standings.js` |
| 9 | F8 | Hallway: H2H Records | Medium | `hallway.js` |
| 10 | F1 | Dynasty Overview Tab | High | `standings.js`, `profile.js`, `locker.css` |
| 11 | F2 | Custom Playoff Tracker (individual leagues) | High | New module + several files |
| 12 | F7 | Custom Trophy Builder | High | `trophy-builder.js`, `trophy-room.js`, `locker.css` |
| 13 | F4 | Locker Room Redesign + Team Theme | Very High | New theme system + CSS refactor |
| 14 | F6 | Post-It Trash Talk Wall | High | `postits.js`, `firebase-db.js`, `locker.css` |

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
