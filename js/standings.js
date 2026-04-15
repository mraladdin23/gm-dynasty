// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Standings, Matchups, Playoffs
//  Ported from SleeperBid/standings.js
//  Renders inside the league detail panel tabs.
// ─────────────────────────────────────────────────────────

const DLRStandings = (() => {

  let _leagueId   = null;
  let _platform   = "sleeper";
  let _season     = null;
  let _leagueKey  = null;   // Yahoo full league key e.g. "nfl.l.12345"
  let _leagueData = null;
  let _matchCache = {};
  let _historyLeagues = [];
  let _viewingId  = null;
  let _myRosterId = null;   // current user's franchise/roster ID
  let _initToken  = 0; // increment on each init to cancel stale async ops

  // ── Reset (call when closing or switching leagues) ───────
  function reset() {
    _leagueId    = null;
    _platform    = "sleeper";
    _leagueData  = null;
    _leagueKey   = null;
    _matchCache  = {};
    _historyLeagues = [];
    _viewingId   = null;
    _myRosterId  = null;
    _mflBundle   = null;
    _mflNameMap  = {};
    _mflLiveScoringCache = {};
    _mflPlayoffState     = null;
    _mflSelectedDivId    = null;
    _initToken++;
  }

  function setLeague(leagueId, platform, season, leagueKey, myRosterId) {
    // Reset if league OR season changed (MFL reuses the same leagueId across seasons)
    if (_leagueId !== leagueId || _season !== season) reset();
    _leagueId   = leagueId;
    _platform   = platform   || "sleeper";
    _season     = season     || null;
    _leagueKey  = leagueKey  || null;
    _myRosterId = myRosterId || _myRosterId || null;  // keep existing if not passed
  }
  async function init(leagueId, platform, season, leagueKey, myRosterId) {
    reset();
    _leagueId    = leagueId;
    _platform    = platform  || "sleeper";
    _season      = season    || null;
    _leagueKey   = leagueKey || null;
    _myRosterId  = myRosterId || null;
    const token = ++_initToken;

    const el = document.getElementById("dtab-standings");
    if (!el) return;
    el.innerHTML = _loadingHTML("Loading standings…");

    // MFL standings via Cloudflare Worker bundle
    if (_platform === "mfl") {
      try {
        const season = _season || new Date().getFullYear().toString();
        const bundle = await MFLAPI.getLeagueBundle(leagueId, season);
        if (token !== _initToken) return;

        // Cache bundle so matchups/playoffs can reuse it without a second fetch
        if (!_mflBundle) {
          _mflBundle  = _mflBuildBundleState(bundle, season);
          _mflNameMap = _mflBundle.nameMap;
        }

        const standings  = MFLAPI.normalizeStandings(bundle);
        const leagueInfo = MFLAPI.getLeagueInfo(bundle);

        // For guillotine leagues: pre-fetch the final matchup week's live scoring so
        // _renderMFLStandings can resolve winner vs runner-up with the correct week number.
        // This must happen before render (sync) so the cache is populated in time.
        if (leagueInfo.isGuillotine) {
          const aliveTeams  = standings.filter(s => !s.eliminated);
          if (aliveTeams.length === 2) {
            const elimWeeks = standings
              .filter(s => s.eliminated && s.weekEliminated)
              .map(s => Number(s.weekEliminated));
            const lastElimWeek   = elimWeeks.length ? Math.max(...elimWeeks) : null;
            const finalMatchWeek = lastElimWeek ? lastElimWeek + 1 : null;
            if (finalMatchWeek && !_mflLiveScoringCache[finalMatchWeek]) {
              try {
                const d = await MFLAPI.getLiveScoring(leagueId, season, finalMatchWeek);
                _mflLiveScoringCache[finalMatchWeek] = d;
              } catch(e) { /* non-fatal */ }
            }
          }
        }

        _renderMFLStandings(el, bundle.league?.league, standings, leagueId, season, leagueInfo, _myRosterId, bundle);
      } catch(e) {
        if (token !== _initToken) return;
        el.innerHTML = `<div class="empty-state" style="padding:var(--space-8);text-align:center;">
          <div style="font-size:2rem;margin-bottom:var(--space-3);">🏈</div>
          <div style="font-weight:600;margin-bottom:var(--space-2);">Could not load MFL standings</div>
          <div style="font-size:.85rem;color:var(--color-text-dim);">${e.message}<br>
          <a href="https://www42.myfantasyleague.com/${_season||new Date().getFullYear()}/home/${leagueId}"
            target="_blank" style="color:var(--color-gold);">View on MFL ↗</a></div>
        </div>`;
      }
      return;
    }

    // Yahoo standings via worker bundle
    if (_platform === "yahoo") {
      try {
        const leagueKey = _leagueKey || `nfl.l.${leagueId}`;
        const bundle = await YahooAPI.getLeagueBundle(leagueKey);
        if (token !== _initToken) return;
        _renderYahooStandings(el, bundle, leagueId);
      } catch(e) {
        if (token !== _initToken) return;
        const isNetwork = e.message?.includes("fetch") || e.message?.includes("network") || e.message?.includes("disconnected");
        const isToken   = e.message?.includes("token") || e.message?.includes("reconnect");
        el.innerHTML = `<div class="empty-state" style="padding:var(--space-8);text-align:center;">
          <div style="font-size:2rem;margin-bottom:var(--space-3);">🏈</div>
          <div style="font-weight:600;margin-bottom:var(--space-2);">Could not load Yahoo standings</div>
          <div style="font-size:.85rem;color:var(--color-text-dim);margin-bottom:var(--space-3);">
            ${isToken ? "Yahoo token expired — reconnect Yahoo in Edit Profile." :
              isNetwork ? "Network error — check your connection and try again." :
              e.message}
          </div>
          ${isNetwork ? `<button class="btn-secondary" onclick="DLRStandings.init('${leagueId}','yahoo','${_season || ""}','${_leagueKey||""}')">↻ Retry</button>` : ""}
          ${isToken ? `<div style="font-size:.75rem;color:var(--color-text-dim);margin-top:var(--space-2)">Go to your profile → Edit → reconnect Yahoo</div>` : ""}
        </div>`;
      }
      return;
    }

    try {
      await _loadData(leagueId, token);
      if (token !== _initToken) return;
      // Load history non-blocking — doesn't affect standings render
      _loadHistory(leagueId, token).catch(() => {});
    } catch(e) {
      if (token !== _initToken) return;
      const el2 = document.getElementById("dtab-standings");
      if (el2) el2.innerHTML = _errorHTML("Could not load standings: " + e.message);
    }
  }

  async function _loadData(leagueId, token) {
    const [league, rosters, users] = await Promise.all([
      SleeperAPI.getLeague(leagueId),
      SleeperAPI.getRosters(leagueId),
      SleeperAPI.getLeagueUsers(leagueId)
    ]);
    if (token !== undefined && token !== _initToken) return;
    if (!league) throw new Error("League not found.");

    const week = league.settings?.leg || league.settings?.week || 1;
    const userMap = {};
    (users || []).forEach(u => { userMap[u.user_id] = u; });

    const teams = (rosters || []).map(r => {
      const u = userMap[r.owner_id] || {};
      const s = r.settings || {};
      return {
        roster_id:    r.roster_id,
        owner_id:     r.owner_id,
        display_name: u.metadata?.team_name || u.display_name || u.username || `Team ${r.roster_id}`,
        avatar:       u.avatar || null,
        username:     (u.username || "").toLowerCase(),
        wins:         s.wins   || 0,
        losses:       s.losses || 0,
        ties:         s.ties   || 0,
        fpts:         (s.fpts  || 0) + (s.fpts_decimal  || 0) / 100,
        fpts_against: (s.fpts_against || 0) + (s.fpts_against_decimal || 0) / 100,
        max_pts:      (s.ppts || 0) + (s.ppts_decimal || 0) / 100,
        streak:       s.streak_type === "W" ? `W${s.streak_count || 1}` :
                      s.streak_type === "L" ? `L${s.streak_count || 1}` : "—",
      };
    });

    _leagueData = { teams, league, week };
    _renderStandings();
  }

  async function _loadHistory(currentLeagueId, token) {
    _historyLeagues = [];
    try {
      const chain = await SleeperAPI.getLeagueLineage(currentLeagueId);
      for (const id of [...chain].reverse()) {
        if (token !== undefined && token !== _initToken) return;
        const l = await SleeperAPI.getLeague(id);
        if (l) _historyLeagues.push({ leagueId: id, season: l.season, current: id === currentLeagueId });
      }
    } catch(e) {
      _historyLeagues = [{ leagueId: currentLeagueId, season: _leagueData?.league?.season, current: true }];
    }
  }

  // ── Render standings table ────────────────────────────────
  function _renderStandings() {
    const el = document.getElementById("dtab-standings");
    if (!el || !_leagueData) return;
    const { teams, league, week } = _leagueData;
    const playoffSpots = league.settings?.playoff_teams || 6;

    const sorted = [...teams].sort((a, b) =>
      b.wins !== a.wins ? b.wins - a.wins : b.fpts - a.fpts
    );
    const fmt = n => (n || 0) % 1 === 0 ? (n || 0).toFixed(0) : (n || 0).toFixed(2);

    el.innerHTML = `
      <div class="standings-meta">
        <span>${league.name || "League"} · Week ${week} · Top ${playoffSpots} make playoffs</span>
        <button class="btn-refresh" onclick="DLRStandings.refresh()">↻ Refresh</button>
      </div>
      <div class="standings-table-wrap">
        <table class="standings-table">
          <thead>
            <tr>
              <th>#</th><th>Team</th>
              <th>W</th><th>L</th><th>T</th>
              <th title="Points For">PF</th>
              <th title="Points Against">PA</th>
              <th title="Max Potential Points">MaxPF</th>
              <th>Streak</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map((t, i) => {
              const rank      = i + 1;
              const inPO      = rank <= playoffSpots;
              const bubble    = rank === playoffSpots;
              const initial   = (t.display_name || "?")[0].toUpperCase();
              const avatar    = t.avatar
                ? `<img src="https://sleepercdn.com/avatars/thumbs/${t.avatar}" class="standings-avatar" onerror="this.outerHTML='<div class=st-av>${initial}</div>'">`
                : `<div class="st-av">${initial}</div>`;
              const streakColor = t.streak.startsWith("W") ? "var(--color-green)" :
                                  t.streak.startsWith("L") ? "var(--color-red)"   : "var(--color-text-dim)";
              return `<tr class="${inPO ? "standings-row--playoff" : ""}" style="${inPO ? `border-left:3px solid ${bubble ? "var(--color-gold-dim)" : "var(--color-gold)"}` : "border-left:3px solid transparent"}">
                <td class="standings-rank">${rank}</td>
                <td>
                  <div class="standings-team-cell">
                    ${avatar}
                    <span class="${inPO ? "fw-700" : ""}">${_esc(t.display_name)}</span>
                    ${bubble ? `<span class="bubble-tag">bubble</span>` : ""}
                  </div>
                </td>
                <td class="standings-win">${t.wins}</td>
                <td class="standings-loss">${t.losses}</td>
                <td class="standings-tie">${t.ties}</td>
                <td class="standings-num">${fmt(t.fpts)}</td>
                <td class="standings-num dim">${fmt(t.fpts_against)}</td>
                <td class="standings-num dim">${t.max_pts > 0 ? fmt(t.max_pts) : "—"}</td>
                <td class="standings-streak" style="color:${streakColor}">${t.streak}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="standings-legend">
        <span class="legend-dot" style="background:var(--color-gold)"></span>Playoff spot
        <span class="legend-dot" style="background:var(--color-gold-dim);margin-left:8px;"></span>Bubble
      </div>`;
  }

  async function refresh() {
    if (!_leagueId) return;
    const el = document.getElementById("dtab-standings");
    if (el) el.innerHTML = _loadingHTML("Refreshing…");
    await _loadData(_leagueId);
  }

  // ── Matchups ──────────────────────────────────────────────
  async function initMatchups() {
    const el = document.getElementById("dtab-matchups");
    if (!el) return;

    if (_platform === "yahoo") {
      el.innerHTML = _loadingHTML("Loading Yahoo matchups…");
      try {
        const leagueKey = _leagueKey || `nfl.l.${_leagueId}`;
        const bundle = await YahooAPI.getLeagueBundle(leagueKey);
        _renderYahooMatchups(el, bundle);
      } catch(e) {
        el.innerHTML = `<div class="empty-state" style="padding:var(--space-6);text-align:center;">
          Could not load Yahoo matchups: ${e.message}
        </div>`;
      }
      return;
    }
    if (_platform === "mfl") {
      el.innerHTML = _loadingHTML("Loading MFL matchups…");
      try {
        const season = _season || new Date().getFullYear().toString();

        // Reuse cached bundle from standings tab to avoid a redundant fetch.
        // If standings tab was never opened, we fetch the bundle now and cache it.
        let bundleState = _mflBundle;
        if (!bundleState) {
          const bundle = await MFLAPI.getLeagueBundle(_leagueId, season);
          bundleState = _mflBuildBundleState(bundle, season);
          _mflBundle  = bundleState;
          _mflNameMap = bundleState.nameMap;
        }

        const { bundle, nameMap, allWeeks, currentWeek, leagueInfo } = bundleState;

        // For eliminator/guillotine leagues default to the most recent week with data.
        // For standard leagues default to week 1 so users see full season history.
        const isSpecial   = leagueInfo?.isEliminator || leagueInfo?.isGuillotine;
        const defaultWeek = isSpecial ? currentWeek : (allWeeks[0] || 1);

        // Pre-fetch the default week's live scoring so the first render is instant.
        let liveData = _mflLiveScoringCache[defaultWeek];
        if (!liveData) {
          liveData = await MFLAPI.getLiveScoring(_leagueId, season, defaultWeek);
          _mflLiveScoringCache[defaultWeek] = liveData;
        }

        // Also warm week 1 cache for standard leagues (background, non-blocking)
        if (!isSpecial && !_mflLiveScoringCache[1] && defaultWeek !== 1) {
          MFLAPI.getLiveScoring(_leagueId, season, 1)
            .then(d => { _mflLiveScoringCache[1] = d; })
            .catch(() => {});
        }

        const matchups = MFLAPI.normalizeMatchups(liveData);

        // Fetch player lookup including league-custom players (draft picks etc.)
        let playerLookup = null;
        try { playerLookup = await MFLAPI.getPlayers(season, _leagueId); } catch(e) {}

        // Filter matchups to user's division if applicable
        const divisionFranchises = _myRosterId
          ? MFLAPI.getDivisionFranchises(bundle, _myRosterId)
          : null;

        _renderMFLMatchupsShell(el, nameMap, allWeeks, defaultWeek, matchups, divisionFranchises, liveData, playerLookup, bundleState.starterSlots || []);
      } catch(e) {
        el.innerHTML = `<div class="empty-state" style="padding:var(--space-6);text-align:center;">
          <div style="margin-bottom:var(--space-2)">Could not load MFL matchups: ${e.message}</div>
          <a href="https://www42.myfantasyleague.com/${_season||new Date().getFullYear()}/home/${_leagueId}"
            target="_blank" style="color:var(--color-gold)">View on MFL →</a>
        </div>`;
      }
      return;
    }

    // Wait for standings data if it hasn't loaded yet
    if (!_leagueData) {
      el.innerHTML = _loadingHTML("Loading matchups…");
      if (_leagueId) {
        try { await _loadData(_leagueId); } catch(e) { el.innerHTML = _errorHTML(e.message); return; }
      } else {
        el.innerHTML = _errorHTML("No league selected.");
        return;
      }
    }

    _renderMatchupsShell();
    loadMatchupsWeek(_leagueData?.week || 1);
  }

  // ── MFL matchups — on-demand liveScoring ──────────────────
  let _mflBundle            = null;   // { teams, nameMap, season, allWeeks }
  let _mflNameMap           = {};
  let _mflLiveScoringCache  = {};     // week → raw liveScoring response
  let _mflPlayoffState      = null;   // { brackets, nameMap, season, leagueId, activeBracketIdx }
  // Persistent division selection: null = user's own division, "all" = show all, divId = specific div
  let _mflSelectedDivId     = null;   // set when user clicks a division pill

  // Build the bundle state object, shared across all three bundle-fetch sites.
  // Computes allWeeks correctly for eliminator/guillotine leagues that run beyond lastRegularSeasonWeek.
  function _mflBuildBundleState(bundle, season) {
    const teams   = MFLAPI.getTeams(bundle);
    const nameMap = {};
    teams.forEach(t => { nameMap[t.id] = t.name || `Team ${t.id}`; });
    const leagueInfo  = MFLAPI.getLeagueInfo(bundle);
    const l = bundle?.league?.league || {};

    const currentWeek = parseInt(l.nflScheduleWeek || 1);

    // Use the league's own startWeek/endWeek to bound the week pill range.
    // startWeek is the first week of regular season (usually 1).
    // endWeek / lastRegularSeasonWeek is the last week to show (includes playoffs for
    // eliminator/guillotine leagues that use lastPlayoffWeek instead).
    const startWeek   = Math.max(1, parseInt(l.startWeek || l.firstRegularSeasonWeek || 1));
    const lastRegular = parseInt(l.lastRegularSeasonWeek || l.endWeek || 13);
    const lastPlayoff = parseInt(l.lastPlayoffWeek || l.playoffWeeks || 0);
    // Cap at the higher of lastRegular, lastPlayoff, or currentWeek — never go below startWeek
    const endWeek     = Math.max(startWeek, currentWeek, lastRegular, lastPlayoff);
    const allWeeks    = Array.from({ length: endWeek - startWeek + 1 }, (_, i) => startWeek + i);

    // Pre-normalize standings so eliminator/guillotine week filtering works in matchups
    const standings = MFLAPI.normalizeStandings(bundle);

    return {
      bundle, teams, nameMap, season, leagueInfo,
      allWeeks, currentWeek, startWeek, endWeek,
      starterSlots: MFLAPI.getStarterSlots(bundle),
      standings,
    };
  }

  function _renderMFLMatchupsShell(el, nameMap, allWeeks, activeWeek, matchups, divisionFranchises, liveData, playerLookup, starterSlots) {
    // activeWeek is now passed correctly by the caller:
    //   - eliminator/guillotine leagues → currentWeek (most recent)
    //   - standard leagues → startWeek (week 1 / first week of season)
    const displayWeek = activeWeek || allWeeks[0] || 1;

    const weekPills = allWeeks.map(w =>
      `<button class="season-pill ${w === displayWeek ? "season-pill--current" : ""}"
        onclick="DLRStandings._mflLoadWeek(${w})">${w}</button>`
    ).join("");

    // Store division filter, player lookup and starter slots for week-switching
    if (divisionFranchises !== undefined) {
      _mflBundle._divisionFranchises = divisionFranchises;
    }
    if (playerLookup)  _mflBundle._playerLookup  = playerLookup;
    if (starterSlots)  _mflBundle._starterSlots   = starterSlots;
    // standings already stored in _mflBundle.standings via _mflBuildBundleState

    // Division banner if applicable
    let divBanner = "";
    if (divisionFranchises && _mflBundle?.bundle && _myRosterId) {
      const { franchiseDivision, divisions } = MFLAPI.getDivisions(_mflBundle.bundle);
      const myDivId   = franchiseDivision[String(_myRosterId)];
      const myDivName = divisions.find(d => d.id === myDivId)?.name || "";
      if (myDivName) {
        divBanner = `<div class="standings-division-bar" style="margin-bottom:var(--space-2)">
          <span class="standings-division-label">📊 ${_esc(myDivName)} matchups</span>
        </div>`;
      }
    }

    el.innerHTML = `
      <div class="matchups-week-bar">
        <span class="matchups-week-label">Week:</span>
        <div class="matchups-week-pills">${weekPills}</div>
      </div>
      ${divBanner}
      <div id="mfl-matchups-grid" class="matchups-grid">
        <div class="detail-loading"><div class="spinner"></div><span>Loading week ${displayWeek}…</span></div>
      </div>`;

    // Always load via _mflLoadWeek so week-switching and caching work consistently.
    // This also ensures the alive-team filter runs with the correct week number.
    _mflLoadWeek(displayWeek);
  }

  async function _mflLoadWeek(week) {
    const grid = document.getElementById("mfl-matchups-grid");
    if (!grid || !_mflBundle) return;

    // Update pill highlight immediately
    document.querySelectorAll(".matchups-week-pills .season-pill").forEach(b => {
      b.classList.toggle("season-pill--current", b.textContent.trim() === String(week));
    });

    const divisionFranchises = _mflBundle._divisionFranchises || null;
    const playerLookup       = _mflBundle._playerLookup || null;
    const starterSlots       = _mflBundle._starterSlots  || _mflBundle.starterSlots || [];
    const standings          = _mflBundle.standings || [];

    // Use cache if available
    if (_mflLiveScoringCache[week]) {
      const liveData = _mflLiveScoringCache[week];
      const matchups = MFLAPI.normalizeMatchups(liveData);
      grid.innerHTML = _mflMatchupCards(matchups, _mflNameMap, divisionFranchises, liveData, playerLookup, starterSlots, standings, week);
      return;
    }

    grid.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Loading week ${week}…</span></div>`;
    try {
      const liveData = await MFLAPI.getLiveScoring(_leagueId, _mflBundle.season, week);
      _mflLiveScoringCache[week] = liveData;
      const matchups = MFLAPI.normalizeMatchups(liveData);
      grid.innerHTML = _mflMatchupCards(matchups, _mflNameMap, divisionFranchises, liveData, playerLookup, starterSlots, standings, week);
    } catch(e) {
      grid.innerHTML = `<div class="dim" style="padding:var(--space-4)">Could not load week ${week}: ${e.message}</div>`;
    }
  }

  // Detect whether a liveScoring response is a "no-roster" (pick-a-player / survivor)
  // league. Real MFL shape for these leagues:
  //   { liveScoring: { franchise: [{id, score, players:{player:[...]}}, ...], week: "N" } }
  // Standard leagues have:
  //   { liveScoring: { matchup: [{franchise:[{...},{...}]}, ...], week: "N" } }
  function _isMFLNoRosterLeague(liveData) {
    const ls = liveData?.liveScoring;
    if (!ls) return false;
    const hasMatchup   = ls.matchup != null;
    const hasFranchise = ls.franchise != null;
    return !hasMatchup && hasFranchise;
  }

  // Normalize "no-roster" franchise scores. Each franchise entry has its own
  // players array at the top level (no home/away pairing).
  // Returns [{ teamId, score, players: [{id, score, status, position}] }]
  function _normalizeMFLNoRosterScores(liveData) {
    const ls  = liveData?.liveScoring;
    const raw = ls?.franchise;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr
      .filter(f => parseFloat(f.score || 0) > 0 || (f.players?.player))
      .map(f => {
        const allP = f.players?.player
          ? (Array.isArray(f.players.player) ? f.players.player : [f.players.player])
          : [];
        return {
          teamId: String(f.id || ""),
          score:  parseFloat(f.score || 0),
          players: allP.map(p => ({
            id:       String(p.id || ""),
            score:    parseFloat(p.score || 0),
            status:   String(p.status || ""),
            position: String(p.position || "?").toUpperCase(),
          }))
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  // Render MFL matchup cards — two paths:
  //   1. Standard matchups (head-to-head): click to expand slot-ordered side-by-side player breakdown
  //   2. No-roster scoring leagues: sorted score cards with slot-ordered breakdown on expand
  // `standings` and `week` are used to filter eliminated teams in eliminator/guillotine leagues.
  function _mflMatchupCards(matchups, nameMap, divisionFranchises, liveData, playerLookup, starterSlots, standings, week) {
    const POS_COLOR = {
      QB:"var(--color-orange)", RB:"var(--color-green)", WR:"var(--color-cyan)",
      TE:"var(--color-purple)", K:"var(--color-text-dim)", DEF:"var(--color-text-dim)",
      SF:"var(--color-orange)", FLEX:"var(--color-text-dim)",
      P:"var(--color-text-dim)", COACH:"var(--color-gold-dim)"
    };

    // Build alive-team filter for eliminator/guillotine leagues.
    // getAliveTeamsForWeek returns a Set<string> of franchise IDs still active in `week`,
    // or null if the league has no elimination data.
    const aliveSet = (standings && standings.length && week)
      ? MFLAPI.getAliveTeamsForWeek(standings, week)
      : null;

    // ── No-roster / overall-points league path ───────────────
    if (liveData && _isMFLNoRosterLeague(liveData)) {
      let teams = _normalizeMFLNoRosterScores(liveData);

      // Filter by alive teams for eliminator leagues
      if (aliveSet) {
        teams = teams.filter(t => aliveSet.has(String(t.teamId)));
      }

      const filtered = divisionFranchises
        ? teams.filter(t => divisionFranchises.includes(t.teamId))
        : teams;
      if (!filtered.length) return `<div class="dim" style="padding:var(--space-4)">No scores this week.</div>`;

      return filtered.map((t, rank) => {
        const name      = _esc(nameMap[t.teamId] || t.teamId || "TBD");
        const scoreFmt  = t.score > 0 ? t.score.toFixed(2) : "—";
        const isMe      = _myRosterId && String(t.teamId) === String(_myRosterId);

        const starters  = t.players.filter(p => p.status === "starter" || p.status === "");
        const bench     = t.players.filter(p => p.status !== "starter" && p.status !== "");
        const hasDetail = t.players.length > 0;

        // Use assignStartersToSlots when we have the league slot config —
        // this gives proper QB/RB/WR/TE/SF/FLEX labels instead of raw positions.
        let starterRows = "";
        if (starterSlots && starterSlots.length > 0 && playerLookup) {
          const assigned = MFLAPI.assignStartersToSlots(starterSlots, starters, playerLookup);
          starterRows = assigned.map(r => {
            const p     = r.player;
            const label = r.displaySlot || r.slot;
            const col   = POS_COLOR[label] || POS_COLOR[r.slot] || "var(--color-text-dim)";
            const pName = p ? _esc(playerLookup[p.id]?.name || p.id) : "—";
            const pts   = p ? (p.score > 0 ? p.score.toFixed(2) : "—") : "—";
            return `<div class="mu-sbs-row">
              <span class="mu-slot" style="color:${col}">${label}</span>
              <span class="mu-name mu-name--left" style="flex:1">${pName}</span>
              <span class="mu-pts" style="margin-left:auto">${pts}</span>
            </div>`;
          }).join("");
        } else {
          // Fallback: sort by canonical position order and show raw position label
          const POS_ORDER = ["QB","RB","WR","TE","K","DEF","DL","LB","DB","P",""];
          const posRank   = p => { const i = POS_ORDER.indexOf(p); return i < 0 ? 99 : i; };
          const sortedSt  = [...starters].sort((a, b) => {
            const pa = (playerLookup?.[a.id]?.pos || a.position || "?").toUpperCase();
            const pb = (playerLookup?.[b.id]?.pos || b.position || "?").toUpperCase();
            const pr = posRank(pa) - posRank(pb);
            return pr !== 0 ? pr : b.score - a.score;
          });
          starterRows = sortedSt.map(p => {
            const pName = playerLookup ? _esc(playerLookup[p.id]?.name || p.id) : p.id;
            const pos   = ((playerLookup?.[p.id]?.pos || playerLookup?.[p.id]?.position) || p.position || "?").toUpperCase();
            const col   = POS_COLOR[pos] || "var(--color-text-dim)";
            return `<div class="mu-sbs-row">
              <span class="mu-slot" style="color:${col}">${pos}</span>
              <span class="mu-name mu-name--left" style="flex:1">${pName}</span>
              <span class="mu-pts" style="margin-left:auto">${p.score > 0 ? p.score.toFixed(2) : "—"}</span>
            </div>`;
          }).join("");
        }

        const benchRows = bench.map(p => {
          const pName = playerLookup ? _esc(playerLookup[p.id]?.name || p.id) : p.id;
          const pos   = ((playerLookup?.[p.id]?.pos || playerLookup?.[p.id]?.position) || p.position || "?").toUpperCase();
          const col   = POS_COLOR[pos] || "var(--color-text-dim)";
          return `<div class="mu-sbs-row mu-sbs-row--bench">
            <span class="mu-slot dim">${pos}</span>
            <span class="mu-name mu-name--left dim" style="flex:1">${pName}</span>
            <span class="mu-pts dim" style="margin-left:auto">${p.score > 0 ? p.score.toFixed(2) : "—"}</span>
          </div>`;
        }).join("");

        const avStyle = isMe ? "background:var(--color-gold);color:#000;font-weight:700;" : "";
        return `<div class="mu-card" onclick="this.querySelector('.mu-detail').classList.toggle('hidden')">
          <div class="mu-header">
            <div class="mu-team">
              <div class="st-av" style="${avStyle}">${(nameMap[t.teamId]||"?")[0].toUpperCase()}</div>
              <span${isMe ? " style='font-weight:700;color:var(--color-gold)'" : ""}>${name}</span>
            </div>
            <div class="mu-scores">
              <span class="mu-score mu-score--win">${scoreFmt}</span>
            </div>
            <div style="min-width:44px;text-align:right;color:var(--color-text-dim);font-size:.75rem">#${rank+1}</div>
          </div>
          ${hasDetail
            ? `<div class="mu-detail hidden" style="padding:var(--space-3) var(--space-4)">
                ${starterRows}
                ${bench.length ? `<div class="mu-bench-header">Bench</div>${benchRows}` : ""}
              </div>`
            : `<div class="mu-no-detail">No player data yet</div>`}
        </div>`;
      }).join("");
    }

    // ── Standard head-to-head matchups ───────────────────────
    let filtered = divisionFranchises
      ? matchups.filter(m =>
          divisionFranchises.includes(String(m.home.teamId)) ||
          divisionFranchises.includes(String(m.away.teamId)))
      : matchups;

    // Filter out matchups where both teams were already eliminated before this week
    if (aliveSet) {
      filtered = filtered.filter(m =>
        aliveSet.has(String(m.home.teamId)) || aliveSet.has(String(m.away.teamId))
      );
    }

    if (!filtered.length) {
      return `<div class="dim" style="padding:var(--space-4)">No matchups this week.</div>`;
    }

    return filtered.map(m => {
      const home  = m.home || {};
      const away  = m.away || {};
      const hId   = home.teamId || "";
      const aId   = away.teamId || "";
      const hSc   = parseFloat(home.score || 0);
      const aSc   = parseFloat(away.score || 0);
      const hWin  = hSc > aSc && hSc > 0;
      const aWin  = aSc > hSc && aSc > 0;
      const hName = nameMap[hId] || hId || "TBD";
      const aName = nameMap[aId] || aId || "TBD";
      const fmt   = n => n > 0 ? n.toFixed(2) : "—";

      let detailHTML = `<div class="mu-no-detail">No player data yet</div>`;
      if (liveData && playerLookup) {
        const matchupRaw = liveData?.liveScoring?.matchup;
        const matchupArr = matchupRaw ? (Array.isArray(matchupRaw) ? matchupRaw : [matchupRaw]) : [];
        const rawMatchup = matchupArr.find(mu => {
          const fs = mu.franchise ? (Array.isArray(mu.franchise) ? mu.franchise : [mu.franchise]) : [];
          return fs.some(f => String(f.id) === String(hId)) && fs.some(f => String(f.id) === String(aId));
        });

        if (rawMatchup) {
          const fs = Array.isArray(rawMatchup.franchise) ? rawMatchup.franchise : [rawMatchup.franchise];
          const fH = fs.find(f => String(f.id) === String(hId));
          const fA = fs.find(f => String(f.id) === String(aId));

          if (fH && fA) {
            const extractPlayers = (f) => {
              const ps = f.players?.player
                ? (Array.isArray(f.players.player) ? f.players.player : [f.players.player])
                : [];
              return ps.map(p => ({
                id:     String(p.id || ""),
                score:  parseFloat(p.score || 0),
                status: p.status || "",
                // position comes from playerLookup, not liveScoring
              }));
            };

            const pH = extractPlayers(fH);
            const pA = extractPlayers(fA);
            const stH = pH.filter(p => p.status === "starter");
            const stA = pA.filter(p => p.status === "starter");
            const bnH = pH.filter(p => p.status !== "starter");
            const bnA = pA.filter(p => p.status !== "starter");

            // ── Slot-ordered starter rows ────────────────────
            // If we have starterSlots from the league config, use assignStartersToSlots
            // to pair each slot with the right player. Otherwise fall back to index order.
            let rows = "";
            if (starterSlots && starterSlots.length > 0) {
              const slotsH = MFLAPI.assignStartersToSlots(starterSlots, stH, playerLookup);
              const slotsA = MFLAPI.assignStartersToSlots(starterSlots, stA, playerLookup);
              const numRows = Math.max(slotsH.length, slotsA.length);
              for (let i = 0; i < numRows; i++) {
                const sh = slotsH[i] || { slot: "FLEX", displaySlot: "FLEX", player: null };
                const sa = slotsA[i] || { slot: "FLEX", displaySlot: "FLEX", player: null };
                // Center column shows the displaySlot (actual position for FLEX/SF rows)
                const label = sh.displaySlot || sh.slot;
                const col   = POS_COLOR[label] || "var(--color-text-dim)";
                const ph    = sh.player;
                const pa    = sa.player;
                const ptsH  = ph ? ph.score : null;
                const ptsA  = pa ? pa.score : null;
                rows += `<div class="mu-sbs-row">
                  <span class="mu-pts ${ptsH != null && ptsA != null && ptsH > ptsA ? "mu-pts--win" : ""}">${ptsH != null ? ptsH.toFixed(2) : "—"}</span>
                  <span class="mu-name mu-name--left">${ph ? _esc(playerLookup[ph.id]?.name || ph.id) : "—"}</span>
                  <span class="mu-slot" style="color:${col}">${label}</span>
                  <span class="mu-name mu-name--right">${pa ? _esc(playerLookup[pa.id]?.name || pa.id) : "—"}</span>
                  <span class="mu-pts mu-pts--right ${ptsA != null && ptsH != null && ptsA > ptsH ? "mu-pts--win" : ""}">${ptsA != null ? ptsA.toFixed(2) : "—"}</span>
                </div>`;
              }
            } else {
              // Fallback: no slot config — render by index, derive position from lookup
              const maxSt = Math.max(stH.length, stA.length);
              for (let i = 0; i < maxSt; i++) {
                const ph  = stH[i], pa = stA[i];
                const pos = (playerLookup?.[ph?.id]?.pos || playerLookup?.[ph?.id]?.position
                          || playerLookup?.[pa?.id]?.pos || playerLookup?.[pa?.id]?.position || "?").toUpperCase();
                const col  = POS_COLOR[pos] || "var(--color-text-dim)";
                const ptsH = ph ? ph.score : null;
                const ptsA = pa ? pa.score : null;
                rows += `<div class="mu-sbs-row">
                  <span class="mu-pts ${ptsH != null && ptsA != null && ptsH > ptsA ? "mu-pts--win" : ""}">${ptsH != null ? ptsH.toFixed(2) : "—"}</span>
                  <span class="mu-name mu-name--left">${ph ? _esc(playerLookup[ph.id]?.name || ph.id) : "—"}</span>
                  <span class="mu-slot" style="color:${col}">${pos}</span>
                  <span class="mu-name mu-name--right">${pa ? _esc(playerLookup[pa.id]?.name || pa.id) : "—"}</span>
                  <span class="mu-pts mu-pts--right ${ptsA != null && ptsH != null && ptsA > ptsH ? "mu-pts--win" : ""}">${ptsA != null ? ptsA.toFixed(2) : "—"}</span>
                </div>`;
              }
            }

            // Bench rows (no slot ordering needed)
            if (bnH.length || bnA.length) {
              rows += `<div class="mu-bench-header">Bench</div>`;
              const maxBn = Math.max(bnH.length, bnA.length);
              for (let i = 0; i < maxBn; i++) {
                const ph = bnH[i], pa = bnA[i];
                rows += `<div class="mu-sbs-row mu-sbs-row--bench">
                  <span class="mu-pts dim">${ph ? ph.score.toFixed(2) : ""}</span>
                  <span class="mu-name mu-name--left dim">${ph ? _esc(playerLookup[ph.id]?.name || ph.id) : ""}</span>
                  <span class="mu-slot dim">BN</span>
                  <span class="mu-name mu-name--right dim">${pa ? _esc(playerLookup[pa.id]?.name || pa.id) : ""}</span>
                  <span class="mu-pts mu-pts--right dim">${pa ? pa.score.toFixed(2) : ""}</span>
                </div>`;
              }
            }

            detailHTML = `<div class="mu-detail hidden">
              <div class="mu-sbs-header">
                <span></span>
                <span class="mu-sbs-team">${_esc(hName)}</span>
                <span class="mu-sbs-pos">SLOT</span>
                <span class="mu-sbs-team" style="text-align:right">${_esc(aName)}</span>
                <span></span>
              </div>
              ${rows}
            </div>`;
          }
        }
      }

      return `<div class="mu-card" onclick="this.querySelector('.mu-detail, .mu-no-detail').classList?.toggle('hidden')">
        <div class="mu-header">
          <div class="mu-team">
            <div class="st-av">${hName[0]?.toUpperCase()||"?"}</div>
            <span class="${hWin ? "fw-700" : ""}">${_esc(hName)}</span>
          </div>
          <div class="mu-scores">
            <span class="mu-score ${hWin ? "mu-score--win" : aWin ? "mu-score--lose" : ""}">${fmt(hSc)}</span>
            <span class="mu-dash">–</span>
            <span class="mu-score ${aWin ? "mu-score--win" : hWin ? "mu-score--lose" : ""}">${fmt(aSc)}</span>
          </div>
          <div class="mu-team mu-team--right">
            <span class="${aWin ? "fw-700" : ""}">${_esc(aName)}</span>
            <div class="st-av">${aName[0]?.toUpperCase()||"?"}</div>
          </div>
        </div>
        ${detailHTML}
      </div>`;
    }).join("");
  }

  function _renderMatchupsShell() {
    const el = document.getElementById("dtab-matchups");
    if (!el || !_leagueData) return;
    const maxWeek = _leagueData.week || 1;
    el.innerHTML = `
      <div class="matchups-week-bar">
        <span class="matchups-week-label">Week:</span>
        <div class="matchups-week-pills">
          ${Array.from({length: maxWeek}, (_, i) => i + 1).map(w =>
            `<button id="mu-week-${w}" class="season-pill ${w === maxWeek ? "season-pill--current" : ""}"
              onclick="DLRStandings.loadMatchupsWeek(${w})">${w}</button>`
          ).join("")}
        </div>
      </div>
      <div id="matchups-grid"></div>`;
  }

  async function loadMatchupsWeek(week) {
    // Update pill highlight
    document.querySelectorAll('[id^="mu-week-"]').forEach(b => {
      const w = parseInt(b.id.replace("mu-week-", ""));
      b.className = `season-pill ${w === week ? "season-pill--current" : ""}`;
    });

    const grid = document.getElementById("matchups-grid");
    if (!grid) return;

    const lid = _viewingId || _leagueId;
    if (_matchCache[week]) {
      await _renderMatchupCards(_matchCache[week], week);
      return;
    }

    grid.innerHTML = _loadingHTML(`Loading week ${week}…`);
    try {
      const matchups = await SleeperAPI.getMatchups(lid, week);
      _matchCache[week] = matchups;
      await _renderMatchupCards(matchups, week);
    } catch(e) {
      grid.innerHTML = _errorHTML(`Could not load week ${week}.`);
    }
  }

  async function _renderMatchupCards(matchups, week) {
    const grid = document.getElementById("matchups-grid");
    if (!grid || !_leagueData) return;

    // Group by matchup_id
    const pairs = {};
    matchups.forEach(m => {
      if (!pairs[m.matchup_id]) pairs[m.matchup_id] = [];
      pairs[m.matchup_id].push(m);
    });

    const rosterMap = {};
    (_leagueData.teams || []).forEach(t => { rosterMap[t.roster_id] = t; });

    // Get players from IndexedDB-backed cache
    const players = DLRPlayers.all();

    const pName = id => { const p = players[id]; return p ? `${p.first_name || ""} ${p.last_name || ""}`.trim() : id; };
    const rosterSlots = _leagueData.league?.roster_positions || [];
    const fmt = n => (n || 0).toFixed(2);
    const POS_COLOR = { QB:"var(--color-orange)", RB:"var(--color-green)", WR:"var(--color-cyan)", TE:"var(--color-purple)", K:"var(--color-text-dim)", DEF:"var(--color-text-dim)" };

    function teamAv(t) {
      if (!t) return `<div class="st-av">?</div>`;
      const i = (t.display_name || "?")[0].toUpperCase();
      return t.avatar
        ? `<img src="https://sleepercdn.com/avatars/thumbs/${t.avatar}" class="standings-avatar" onerror="this.outerHTML='<div class=st-av>${i}</div>'">`
        : `<div class="st-av">${i}</div>`;
    }

    function renderSBS(a, b) {
      const stA = a.starters || [], stB = b.starters || [];
      const spA = a.starters_points || {}, ppA = a.players_points || {};
      const spB = b.starters_points || {}, ppB = b.players_points || {};
      const starterSlots = rosterSlots.filter(s => !["BN","IR","TAXI"].includes(s));
      const maxLen = Math.max(stA.length, stB.length, starterSlots.length);
      let rows = "";
      for (let i = 0; i < maxLen; i++) {
        const idA = stA[i], idB = stB[i];
        const slot = starterSlots[i] || "FLEX";
        const label = ["FLEX","WRT","WRTF","REC_FLEX"].includes(slot) ? "FLEX" :
                      ["SUPER_FLEX","SF"].includes(slot) ? "SF" : slot;
        const ptsA = idA ? +(spA[idA] ?? ppA[idA] ?? 0) : 0;
        const ptsB = idB ? +(spB[idB] ?? ppB[idB] ?? 0) : 0;
        const col = POS_COLOR[label] || "var(--color-text-dim)";
        rows += `<div class="mu-sbs-row">
          <span class="mu-pts ${ptsA > ptsB ? "mu-pts--win" : ""}">${idA ? ptsA.toFixed(2) : "—"}</span>
          <span class="mu-name mu-name--left">${idA ? pName(idA) : "—"}</span>
          <span class="mu-slot" style="color:${col}">${label}</span>
          <span class="mu-name mu-name--right">${idB ? pName(idB) : "—"}</span>
          <span class="mu-pts mu-pts--right ${ptsB > ptsA ? "mu-pts--win" : ""}">${idB ? ptsB.toFixed(2) : "—"}</span>
        </div>`;
      }
      // Bench
      const benchA = (a.players || []).filter(id => !stA.includes(id));
      const benchB = (b.players || []).filter(id => !stB.includes(id));
      if (benchA.length || benchB.length) {
        rows += `<div class="mu-bench-header">Bench</div>`;
        const bl = Math.max(benchA.length, benchB.length);
        for (let i = 0; i < bl; i++) {
          const idA = benchA[i], idB = benchB[i];
          const ptsA = idA ? +(ppA[idA] ?? 0) : 0;
          const ptsB = idB ? +(ppB[idB] ?? 0) : 0;
          rows += `<div class="mu-sbs-row mu-sbs-row--bench">
            <span class="mu-pts dim">${idA ? ptsA.toFixed(2) : ""}</span>
            <span class="mu-name mu-name--left dim">${idA ? pName(idA) : ""}</span>
            <span class="mu-slot dim">BN</span>
            <span class="mu-name mu-name--right dim">${idB ? pName(idB) : ""}</span>
            <span class="mu-pts mu-pts--right dim">${idB ? ptsB.toFixed(2) : ""}</span>
          </div>`;
        }
      }
      return rows;
    }

    const cards = Object.entries(pairs).sort(([a],[b]) => +a - +b).map(([, pair]) => {
      if (pair.length < 2) return "";
      const [a, b] = pair;
      const ta = rosterMap[a.roster_id] || { display_name: `Team ${a.roster_id}` };
      const tb = rosterMap[b.roster_id] || { display_name: `Team ${b.roster_id}` };
      const aWin = a.points > b.points;
      const bWin = b.points > a.points;
      const hasDetail = (a.starters || []).length > 0;
      return `<div class="mu-card" onclick="this.querySelector('.mu-detail').classList.toggle('hidden')">
        <div class="mu-header">
          <div class="mu-team">${teamAv(ta)}<span class="${aWin ? "fw-700" : ""}">${_esc(ta.display_name)}</span></div>
          <div class="mu-scores">
            <span class="mu-score ${aWin ? "mu-score--win" : bWin ? "mu-score--lose" : ""}">${fmt(a.points)}</span>
            <span class="mu-dash">–</span>
            <span class="mu-score ${bWin ? "mu-score--win" : aWin ? "mu-score--lose" : ""}">${fmt(b.points)}</span>
          </div>
          <div class="mu-team mu-team--right"><span class="${bWin ? "fw-700" : ""}">${_esc(tb.display_name)}</span>${teamAv(tb)}</div>
        </div>
        ${hasDetail
          ? `<div class="mu-detail hidden">
              <div class="mu-sbs-header">
                <span></span>
                <span class="mu-sbs-team">${_esc(ta.display_name)}</span>
                <span class="mu-sbs-pos">POS</span>
                <span class="mu-sbs-team" style="text-align:right">${_esc(tb.display_name)}</span>
                <span></span>
              </div>
              ${renderSBS(a, b)}
            </div>`
          : `<div class="mu-no-detail">No player data yet</div>`}
      </div>`;
    }).join("");

    grid.innerHTML = cards || `<div class="empty-state">No matchups for week ${week}.</div>`;
  }

  // ── Playoffs bracket ──────────────────────────────────────
  async function initPlayoffs() {
    const el = document.getElementById("dtab-playoffs");
    if (!el) return;
    const token = ++_initToken;

    if (_platform === "mfl") {
      el.innerHTML = _loadingHTML("Loading MFL playoffs…");
      try {
        const season = _season || new Date().getFullYear().toString();

        // Reuse bundle from standings/matchups tab if already cached
        let bundle;
        if (_mflBundle?.bundle) {
          bundle = _mflBundle.bundle;
        } else {
          bundle = await MFLAPI.getLeagueBundle(_leagueId, season);
          if (token !== _initToken) return;
          _mflBundle  = _mflBuildBundleState(bundle, season);
          _mflNameMap = _mflBundle.nameMap;
        }
        if (token !== _initToken) return;

        const brackets  = MFLAPI.normalizePlayoffBrackets(bundle);
        const teams     = MFLAPI.getTeams(bundle);
        const nameMap   = {};
        teams.forEach(t => { nameMap[String(t.id)] = t.name || `Team ${t.id}`; });

        if (!brackets.length) {
          // No brackets defined — show standings as fallback
          const standings  = MFLAPI.normalizeStandings(bundle);
          const leagueInfo = MFLAPI.getLeagueInfo(bundle);
          _renderMFLStandings(el, bundle.league?.league, standings, _leagueId, season, leagueInfo, _myRosterId, bundle);
          return;
        }

        // Cache state for bracket switching
        _mflPlayoffState = { brackets, nameMap, season, leagueId: _leagueId, activeBracketIdx: 0 };

        // Build shell with bracket selector pills
        const pillBar = brackets.length > 1
          ? `<div class="matchups-week-bar" style="margin-bottom:var(--space-3)">
               <span class="matchups-week-label">Bracket:</span>
               <div class="matchups-week-pills">
                 ${brackets.map((b, i) =>
                   `<button class="season-pill ${i === 0 ? "season-pill--current" : ""}"
                     onclick="DLRStandings._mflLoadBracket(${i})">${_esc(b.name)}</button>`
                 ).join("")}
               </div>
             </div>`
          : "";

        el.innerHTML = pillBar + `<div id="mfl-bracket-body">${_loadingHTML("Loading bracket…")}</div>`;
        await _mflLoadBracket(0);
      } catch(e) {
        if (token !== _initToken) return;
        el.innerHTML = `<div class="empty-state" style="padding:var(--space-8);text-align:center;">
          Could not load MFL playoffs.<br>
          <a href="https://www42.myfantasyleague.com/${_season||new Date().getFullYear()}/home/${_leagueId}"
            target="_blank" style="color:var(--color-gold);">View on MFL →</a>
        </div>`;
      }
      return;
    }

    if (!_leagueData && _leagueId) {
      el.innerHTML = _loadingHTML("Loading…");
      try { await _loadData(_leagueId); } catch(e) { el.innerHTML = _errorHTML(e.message); return; }
    }

    const status = _leagueData?.league?.status || "";
    const isPostseason = status === "post_season" || status === "complete";

    if (!isPostseason) {
      const pw = _leagueData?.league?.settings?.playoff_week_start || "?";
      el.innerHTML = `<div class="playoffs-pending">
        <div class="playoffs-icon">🏆</div>
        <div class="playoffs-title">Playoffs haven't started yet</div>
        <div class="playoffs-sub">Regular season runs through week ${typeof pw === "number" ? pw - 1 : "?"}.</div>
      </div>`;
      return;
    }

    el.innerHTML = _loadingHTML("Loading bracket…");
    await _loadBracket();
  }

  async function _loadBracket() {
    const lid = _viewingId || _leagueId;
    const el  = document.getElementById("dtab-playoffs");
    if (!el || !lid) return;

    try {
      const winners = await SleeperAPI.getBracket(lid, "winners");
      if (!winners || !winners.length) {
        el.innerHTML = `<div class="empty-state">Bracket not available yet.</div>`;
        return;
      }

      // Seed map from standings
      const sortedTeams = [...(_leagueData?.teams || [])].sort((a, b) =>
        b.wins !== a.wins ? b.wins - a.wins : b.fpts - a.fpts
      );
      const rosterMap = {}, seedMap = {};
      sortedTeams.forEach((t, i) => {
        rosterMap[t.roster_id] = t.display_name;
        seedMap[t.roster_id]   = i + 1;
      });

      function matchLabel(rosterId) {
        if (!rosterId) return "TBD";
        const name = rosterMap[rosterId] || `Team ${rosterId}`;
        const seed = seedMap[rosterId];
        return seed ? `${_esc(name)} <span class="seed-tag">#${seed}</span>` : _esc(name);
      }

      function bracketMatch(m) {
        const decided = m.w != null;
        const t1win   = decided && m.w === m.t1;
        const t2win   = decided && m.w === m.t2;
        return `<div class="bracket-match">
          <div class="bracket-slot ${t1win ? "bracket-slot--win" : t2win ? "bracket-slot--lose" : ""}">
            <span class="bracket-team">${matchLabel(m.t1)}</span>
            ${t1win ? '<span class="bracket-check">✓</span>' : ""}
          </div>
          <div class="bracket-slot ${t2win ? "bracket-slot--win" : t1win ? "bracket-slot--lose" : ""}">
            <span class="bracket-team">${matchLabel(m.t2)}</span>
            ${t2win ? '<span class="bracket-check">✓</span>' : ""}
          </div>
          ${!decided ? '<div class="bracket-tbd">In progress</div>' : ""}
        </div>`;
      }

      // KEY: p=1=Championship, p=3=3rd place, p=5=5th place. All in winners bracket.
      const regular  = winners.filter(m => m.p == null);
      const champGame = winners.find(m => m.p === 1);
      const thirdGame = winners.find(m => m.p === 3);
      const fifthGame = winners.find(m => m.p === 5);

      const byRound = {};
      regular.forEach(m => { const r = m.r || 1; if (!byRound[r]) byRound[r] = []; byRound[r].push(m); });
      const rounds   = Object.keys(byRound).map(Number).sort((a, b) => a - b);
      const maxRound = rounds.length ? Math.max(...rounds) : 1;

      // Vertical layout: each round is a section, games stacked within
      const cols = rounds.map(r => {
        const isSemis  = r === maxRound;
        const label    = r === 1 ? "First Round" : isSemis ? "Semifinals" : `Round ${r}`;
        const games    = (byRound[r] || []).map(m => bracketMatch(m)).join("");
        return `<div class="bracket-section">
          <div class="bracket-section-label">${label}</div>
          <div class="bracket-section-games">${games}</div>
        </div>`;
      }).join("");

      // Consolation draft order
      const playoffSpots = _leagueData?.league?.settings?.playoff_teams || 6;
      const nonPO = sortedTeams.slice(playoffSpots).sort((a, b) => (a.max_pts || 0) - (b.max_pts || 0));
      const draftHTML = nonPO.length ? `
        <div class="draft-order-section">
          <div class="draft-order-title">📋 Consolation Draft Order</div>
          <div class="draft-order-sub">Based on MaxPF — lower MaxPF picks earlier</div>
          <div class="draft-order-grid">
            ${nonPO.map((t, i) => `
              <div class="draft-order-row">
                <span class="draft-pick">1.${String(i + 1).padStart(2, "0")}</span>
                <span class="draft-team">${_esc(t.display_name)}</span>
                <span class="draft-maxpf">${t.max_pts > 0 ? t.max_pts.toFixed(2) : "—"}</span>
              </div>`).join("")}
          </div>
        </div>` : "";

      el.innerHTML = `
        <div class="bracket-wrap">
          ${cols}
          <div class="bracket-finals">
            ${champGame ? `
            <div class="bracket-finals-game">
              <div class="bracket-finals-label">🏆 Championship</div>
              ${bracketMatch(champGame)}
            </div>` : ""}
            ${thirdGame ? `
            <div class="bracket-finals-game">
              <div class="bracket-finals-label">🥉 3rd Place</div>
              ${bracketMatch(thirdGame)}
            </div>` : ""}
            ${fifthGame ? `
            <div class="bracket-finals-game">
              <div class="bracket-finals-label place-5">5th Place</div>
              ${bracketMatch(fifthGame)}
            </div>` : ""}
          </div>
          ${draftHTML}
        </div>`;
    } catch(e) {
      if (el) el.innerHTML = _errorHTML("Could not load bracket: " + e.message);
    }
  }

  // ── MFL Playoff bracket — on-demand per-bracket ───────────
  async function _mflLoadBracket(idx) {
    const body = document.getElementById("mfl-bracket-body");
    if (!body || !_mflPlayoffState) return;

    const { brackets, nameMap, season, leagueId } = _mflPlayoffState;
    _mflPlayoffState.activeBracketIdx = idx;

    // Update pill highlight
    document.querySelectorAll(".matchups-week-pills .season-pill").forEach((b, i) => {
      b.classList.toggle("season-pill--current", i === idx);
    });

    const bracket = brackets[idx];
    if (!bracket) return;

    body.innerHTML = _loadingHTML(`Loading ${_esc(bracket.name)}…`);

    try {
      const data   = await MFLAPI.getPlayoffBracket(leagueId, season, bracket.id);
      const rounds = MFLAPI.normalizePlayoffBracketResult(data);

      if (!rounds.length) {
        body.innerHTML = `<div class="empty-state" style="padding:var(--space-6);text-align:center;">
          ${_esc(bracket.name)} hasn't started yet.
          <br><a href="https://www42.myfantasyleague.com/${season}/home/${leagueId}"
            target="_blank" style="color:var(--color-gold)">View on MFL →</a>
        </div>`;
        return;
      }

      // Build seed map from standings if available
      const seedMap = {};
      if (_mflBundle?.bundle) {
        const standings = MFLAPI.normalizeStandings(_mflBundle.bundle);
        standings.forEach((s, i) => { seedMap[String(s.franchiseId)] = i + 1; });
      }

      function teamLabel(id, seed) {
        if (!id) return "TBD";
        const name     = nameMap[id] || `Team ${id}`;
        const seedNum  = seed || seedMap[id];
        const isMe     = _myRosterId && String(id) === String(_myRosterId);
        const meStyle  = isMe ? " style='color:var(--color-gold);font-weight:700'" : "";
        return `<span${meStyle}>${_esc(name)}</span>${seedNum ? ` <span class="seed-tag">#${seedNum}</span>` : ""}`;
      }

      function bracketCard(m) {
        const hId  = m.home.id, aId = m.away.id;
        const hSc  = m.home.score, aSc = m.away.score;
        const hWon = m.home.won,   aWon = m.away.won;
        const decided = hWon || aWon;
        const isMe_h  = _myRosterId && hId && String(hId) === String(_myRosterId);
        const isMe_a  = _myRosterId && aId && String(aId) === String(_myRosterId);
        // If id is empty but wonGameId is set, show "Winner of Game N" placeholder
        const hLabel = hId ? teamLabel(hId, m.home.seed)
          : m.home.wonGameId ? `<span class="dim">Winner of Game ${m.home.wonGameId}</span>` : "TBD";
        const aLabel = aId ? teamLabel(aId, m.away.seed)
          : m.away.wonGameId ? `<span class="dim">Winner of Game ${m.away.wonGameId}</span>` : "TBD";
        return `<div class="bracket-match">
          <div class="bracket-slot ${hWon ? "bracket-slot--win" : decided ? "bracket-slot--lose" : ""}${isMe_h ? " bracket-slot--me" : ""}">
            <span class="bracket-team">${hLabel}</span>
            ${hSc > 0 ? `<span class="bracket-score">${hSc.toFixed(1)}</span>` : ""}
            ${hWon ? '<span class="bracket-check">✓</span>' : ""}
          </div>
          <div class="bracket-slot ${aWon ? "bracket-slot--win" : decided ? "bracket-slot--lose" : ""}${isMe_a ? " bracket-slot--me" : ""}">
            <span class="bracket-team">${aLabel}</span>
            ${aSc > 0 ? `<span class="bracket-score">${aSc.toFixed(1)}</span>` : ""}
            ${aWon ? '<span class="bracket-check">✓</span>' : ""}
          </div>
          ${!decided ? '<div class="bracket-tbd">In progress</div>' : ""}
        </div>`;
      }

      // Label rounds by position: first=Quarterfinals/First Round, last=Championship
      // Use week numbers from the data to give context ("Week 15", "Week 16"…)
      const totalRounds = rounds.length;
      const earlyRounds = rounds.slice(0, -1);
      const finalRound  = rounds[totalRounds - 1];

      function roundLabel(r, ri) {
        const remaining = totalRounds - 1 - ri;  // 0 = this IS the final
        const weekLabel = r.week ? ` · Wk ${r.week}` : "";
        if (remaining === 0) return `🏆 Championship${weekLabel}`;
        if (remaining === 1 && totalRounds > 2) return `Semifinals${weekLabel}`;
        if (remaining === 1) return `Semifinals${weekLabel}`;
        if (remaining === 2) return `Quarterfinals${weekLabel}`;
        return `Round ${r.round}${weekLabel}`;
      }

      const cols = earlyRounds.map((r, ri) => {
        const games = r.matchups.map(m => bracketCard(m)).join("");
        return `<div class="bracket-section">
          <div class="bracket-section-label">${roundLabel(r, ri)}</div>
          <div class="bracket-section-games">${games || '<div class="bracket-tbd">TBD</div>'}</div>
        </div>`;
      }).join("");

      // Final round — handle 1 game (champ only) or multiple (champ + consolation)
      const finalMatchups = finalRound?.matchups || [];
      let finalsHTML = "";
      const weekLabel = finalRound?.week ? ` · Wk ${finalRound.week}` : "";
      if (finalMatchups.length === 1) {
        finalsHTML = `<div class="bracket-finals">
          <div class="bracket-finals-game">
            <div class="bracket-finals-label">🏆 Championship${weekLabel}</div>
            ${bracketCard(finalMatchups[0])}
          </div>
        </div>`;
      } else if (finalMatchups.length > 1) {
        const placeLabels = [`🏆 Championship${weekLabel}`, `🥉 3rd Place${weekLabel}`, `5th Place${weekLabel}`, `7th Place${weekLabel}`];
        finalsHTML = `<div class="bracket-finals">
          ${finalMatchups.map((m, i) => `
            <div class="bracket-finals-game">
              <div class="bracket-finals-label${i > 0 ? " place-" + (2*i+1) : ""}">${placeLabels[i] || `Place ${2*i+1}`}</div>
              ${bracketCard(m)}
            </div>`).join("")}
        </div>`;
      }

      body.innerHTML = `<div class="bracket-wrap">${cols}${finalsHTML}</div>`;

    } catch(e) {
      body.innerHTML = `<div class="empty-state" style="padding:var(--space-6);text-align:center;">
        Could not load bracket: ${_esc(e.message)}
      </div>`;
    }
  }

  // ── Helpers ────────────────────────────────────────────
  function _renderYahooStandings(el, bundle, leagueId) {
    const teams     = bundle.teams     || [];
    const standings = bundle.standings || [];
    if (!standings.length) {
      el.innerHTML = `<div class="empty-state">No Yahoo standings data available.</div>`;
      return;
    }

    const teamMap = {};
    teams.forEach(t => { teamMap[String(t.id)] = t.name || `Team ${t.id}`; });

    // normalizeBundle uses teamId/ptsFor/ptsAgainst
    const sorted = [...standings].sort((a, b) => {
      const aw = a.wins ?? 0, bw = b.wins ?? 0;
      const ap = a.ptsFor ?? a.points_for ?? 0;
      const bp = b.ptsFor ?? b.points_for ?? 0;
      return bw !== aw ? bw - aw : bp - ap;
    });
    const totalTeams   = sorted.length;
    const playoffSpots = Math.floor(totalTeams / 2);

    el.innerHTML = `
      <div class="standings-meta">
        <span>${bundle.league?.name || "Yahoo League"}</span>
      </div>
      <div class="standings-table-wrap">
        <table class="standings-table">
          <thead><tr>
            <th>#</th><th class="team-col">Team</th><th>W</th><th>L</th><th>T</th><th>PF</th><th>PA</th>
          </tr></thead>
          <tbody>
            ${sorted.map((s, i) => {
              const rank   = i + 1;
              const inPO   = rank <= playoffSpots;
              const bubble = rank === playoffSpots;
              const tid    = String(s.teamId ?? s.team_id ?? "");
              const name   = teamMap[tid] || `Team ${tid}`;
              const pf     = s.ptsFor     ?? s.points_for     ?? 0;
              const pa     = s.ptsAgainst ?? s.points_against ?? 0;
              return `<tr class="${inPO ? "standings-row--playoff" : ""}"
                style="${inPO ? `border-left:3px solid ${bubble ? "var(--color-gold-dim)" : "var(--color-gold)"}` : "border-left:3px solid transparent"}">
                <td class="standings-rank">${rank}</td>
                <td class="team-col">
                  <div class="standings-team-cell">
                    <div class="st-av">${name[0]?.toUpperCase() || "?"}</div>
                    <div class="standings-team-name">${_esc(name)}</div>
                  </div>
                </td>
                <td>${s.wins}</td><td>${s.losses}</td><td>${s.ties ?? 0}</td>
                <td>${pf ? pf.toFixed(1) : "—"}</td>
                <td class="dim">${pa ? pa.toFixed(1) : "—"}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  }

  function _renderYahooMatchups(el, bundle) {
    const matchups = bundle.matchups || [];
    const teams    = bundle.teams    || [];
    const nameMap  = {};
    teams.forEach(t => { nameMap[String(t.id)] = t.name || `Team ${t.id}`; });

    if (!matchups.length) {
      el.innerHTML = `<div class="empty-state">No matchup data available.</div>`;
      return;
    }

    const week = matchups[0]?.week || "—";
    const cards = matchups.map(m => {
      // normalizeBundle uses home/away with teamId (not home_team/away_team with team_id)
      const h    = m.home || m.home_team || {};
      const a    = m.away || m.away_team || {};
      const hId  = String(h.teamId ?? h.team_id ?? "");
      const aId  = String(a.teamId ?? a.team_id ?? "");
      const hSc  = parseFloat(h.score || 0);
      const aSc  = parseFloat(a.score || 0);
      const hWin = hSc > aSc;
      const aWin = aSc > hSc;
      return `
        <div class="matchup-card">
          <div class="matchup-team ${hWin ? "matchup-team--winner" : ""}">
            <span class="matchup-name">${_esc(nameMap[hId] || hId || "TBD")}</span>
            <span class="matchup-score">${hSc > 0 ? hSc.toFixed(2) : "—"}</span>
          </div>
          <div class="matchup-vs">vs</div>
          <div class="matchup-team ${aWin ? "matchup-team--winner" : ""}">
            <span class="matchup-name">${_esc(nameMap[aId] || aId || "TBD")}</span>
            <span class="matchup-score">${aSc > 0 ? aSc.toFixed(2) : "—"}</span>
          </div>
        </div>`;
    }).join("");

    el.innerHTML = `
      <div class="matchups-week-bar">
        <span class="matchups-week-label">Week ${week}</span>
      </div>
      <div class="matchups-grid">${cards}</div>`;
  }

  function _renderMFLStandings(el, rawLeague, standings, leagueId, season, leagueInfo, myRosterId, bundle, _unused) {
    if (!standings.length) {
      el.innerHTML = `<div class="empty-state">No standings data available.</div>`;
      return;
    }
    const franchises   = rawLeague?.franchises?.franchise || [];
    const franchiseArr = Array.isArray(franchises) ? franchises : [franchises];
    const teamName     = (fid) => franchiseArr.find(f => f.id === fid)?.name || `Team ${fid}`;
    const isEliminator = leagueInfo?.isEliminator || standings.some(s => s.isEliminator);
    const isGuillotine = leagueInfo?.isGuillotine  || standings.some(s => s.isGuillotine);
    const isSpecial    = isEliminator || isGuillotine;

    // ── Guillotine: resolve final 2 un-eliminated teams ──────
    // When only 2 teams remain with eliminated:"", use the highest week in which
    // any team was eliminated to find the right liveScoring data, then identify
    // winner vs runner-up by score. The runner-up's "Out Wk N" = that matchup week.
    let guillotineFinalMap = {};
    if (isGuillotine) {
      const aliveTeams = standings.filter(s => !s.eliminated);
      if (aliveTeams.length === 2) {
        const ids = aliveTeams.map(s => String(s.franchiseId));

        // The final matchup week = 1 + the week the second-to-last team was eliminated.
        // Find the highest weekEliminated among eliminated teams — that's the penultimate week.
        // The final was played the week after that.
        const elimWeeks = standings
          .filter(s => s.eliminated && s.weekEliminated)
          .map(s => Number(s.weekEliminated));
        const lastElimWeek = elimWeeks.length ? Math.max(...elimWeeks) : null;
        // Final match week = lastElimWeek + 1, or fall back to highest cached week
        const finalMatchWeek = lastElimWeek ? lastElimWeek + 1 : null;

        // Prefer the cached liveScoring for the exact final match week,
        // then try nearby weeks, then fall back to most-recent cached week.
        const cachedWeeks = Object.keys(_mflLiveScoringCache).map(Number).sort((a,b) => b-a);
        const weeksToTry  = finalMatchWeek
          ? [finalMatchWeek, finalMatchWeek - 1, finalMatchWeek + 1, ...cachedWeeks]
          : cachedWeeks;
        const uniqueWeeks = [...new Set(weeksToTry)].filter(w => _mflLiveScoringCache[w]);

        let resolved = false;
        for (const w of uniqueWeeks) {
          const liveD  = _mflLiveScoringCache[w];
          const result = MFLAPI.resolveGuillotineFinal(ids, liveD);
          if (result) {
            // Use the actual week from liveScoring data, not the NFL schedule week
            const matchWeek = parseInt(liveD?.liveScoring?.week || w);
            guillotineFinalMap[result.winnerId]     = { status: "winner",   week: matchWeek };
            guillotineFinalMap[result.eliminatedId] = { status: "runnerup", week: matchWeek };
            resolved = true;
            break;
          }
        }
        // Fall back to bundle liveScoring
        if (!resolved && bundle?.liveScoring) {
          const result = MFLAPI.resolveGuillotineFinal(ids, bundle.liveScoring);
          if (result) {
            const matchWeek = parseInt(bundle.liveScoring?.liveScoring?.week || 0);
            guillotineFinalMap[result.winnerId]     = { status: "winner",   week: matchWeek };
            guillotineFinalMap[result.eliminatedId] = { status: "runnerup", week: matchWeek };
          }
        }
      }
    }

    // ── Division filter ──────────────────────────────────────
    let displayStandings = standings;
    let divisionBannerHTML = "";
    if (bundle) {
      const { divisions, franchiseDivision } = MFLAPI.getDivisions(bundle);
      if (divisions.length) {
        const myDivId     = myRosterId ? franchiseDivision[String(myRosterId)] : null;
        const activeDivId = _mflSelectedDivId === "all" ? null
                          : (_mflSelectedDivId || myDivId || null);
        if (activeDivId) {
          displayStandings = standings.filter(s => franchiseDivision[String(s.franchiseId)] === activeDivId);
        }
        const activeDivName = activeDivId ? (divisions.find(d => d.id === activeDivId)?.name || activeDivId) : null;
        const allPill  = `<button class="standings-div-pill ${!activeDivId ? "standings-div-pill--active" : ""}"
          onclick="DLRStandings._selectDivision('all')">All Teams</button>`;
        const divPills = divisions.map(d =>
          `<button class="standings-div-pill ${d.id === activeDivId ? "standings-div-pill--active" : ""}"
            onclick="DLRStandings._selectDivision('${_esc(d.id)}')">${_esc(d.name)}</button>`
        ).join("");
        divisionBannerHTML = `<div class="standings-division-bar">
          <span class="standings-division-label">📊 ${activeDivName ? _esc(activeDivName) : "All Divisions"}</span>
          ${allPill}${divPills}
        </div>`;
      }
    }

    const totalTeams   = displayStandings.length;
    const playoffSpots = leagueInfo?.playoffTeams
      || (rawLeague?.playoffTeams ? parseInt(rawLeague.playoffTeams) : null)
      || Math.floor(totalTeams / 2);

    const typeLabel  = isGuillotine ? " · Guillotine" : isEliminator ? " · Eliminator" : "";
    const leagueLabel = (leagueInfo?.name || rawLeague?.name || "MFL League") + typeLabel;

    // ── Column headers ───────────────────────────────────────
    const theadCols = isSpecial
      ? `<th>Status</th><th title="Points For">PF</th>`
      : `<th>W</th><th>L</th><th>T</th><th title="Points For">PF</th><th title="Points Against">PA</th>`;

    // ── Rows ─────────────────────────────────────────────────
    const rows = displayStandings.map((s, i) => {
      const rank   = s.rank || i + 1;
      const name   = teamName(s.franchiseId);
      const initial = (name || "?")[0].toUpperCase();
      const isMe   = myRosterId && String(s.franchiseId) === String(myRosterId);
      const inPO   = !isSpecial && rank <= playoffSpots;
      const bubble = !isSpecial && rank === playoffSpots;

      // Border color
      const borderColor = inPO
        ? (bubble ? "var(--color-gold-dim)" : "var(--color-gold)")
        : isSpecial && !s.eliminated
          ? (guillotineFinalMap[String(s.franchiseId)]?.status === "winner" ? "var(--color-gold)" : "#18e07a")
          : isSpecial && s.eliminated
            ? "var(--color-text-dim)"
            : "transparent";

      // Avatar — MFL has no avatar URLs; use initial bubble matching Sleeper style
      const avStyle = isMe
        ? "background:var(--color-gold);color:#000;font-weight:700;"
        : "";
      const avatar = `<div class="st-av" style="${avStyle}">${initial}</div>`;

      // Status cell (guillotine / eliminator only)
      let statusCell = "";
      if (isGuillotine) {
        const finalEntry = guillotineFinalMap[String(s.franchiseId)];
        const finalStatus = finalEntry?.status;
        const finalWeek   = finalEntry?.week;
        let label;
        if (finalStatus === "winner") {
          label = `<span style="color:var(--color-gold);font-weight:700;">👑 Champion</span>`;
        } else if (finalStatus === "runnerup") {
          const wkLabel = finalWeek ? ` Wk ${finalWeek}` : "";
          label = `<span style="color:var(--color-text-dim)">⚔️ Out${wkLabel}</span>`;
        } else if (!s.eliminated) {
          label = `<span style="color:#18e07a">Active</span>`;
        } else {
          label = `<span style="color:var(--color-text-dim)">⚔️ Out Wk ${s.weekEliminated || "?"}</span>`;
        }
        statusCell = `<td style="font-size:.75rem;">${label}</td>
          <td class="standings-num">${s.ptsFor > 0 ? s.ptsFor.toFixed(1) : "—"}</td>`;
      } else if (isEliminator) {
        const label = rank === 1
          ? `<span style="color:var(--color-gold);font-weight:700;">🏆 Winner</span>`
          : s.eliminated
            ? `<span style="color:var(--color-text-dim)">Out Rd ${s.weekEliminated || "?"}</span>`
            : `<span style="color:#18e07a">Active</span>`;
        statusCell = `<td style="font-size:.75rem;">${label}</td>
          <td class="standings-num">${s.ptsFor > 0 ? s.ptsFor.toFixed(1) : "—"}</td>`;
      }

      const dataCells = isSpecial
        ? statusCell
        : `<td class="standings-win">${s.wins}</td>
           <td class="standings-loss">${s.losses}</td>
           <td class="standings-tie">${s.ties}</td>
           <td class="standings-num">${s.ptsFor > 0 ? s.ptsFor.toFixed(1) : "—"}</td>
           <td class="standings-num dim">${s.ptsAgainst > 0 ? s.ptsAgainst.toFixed(1) : "—"}</td>`;

      const rowClasses = [
        inPO  ? "standings-row--playoff"  : "",
        isMe  ? "standings-row--me"       : "",
        isSpecial && s.eliminated ? "standings-row--eliminated" : "",
      ].filter(Boolean).join(" ");

      return `<tr class="${rowClasses}" style="border-left:3px solid ${borderColor}">
        <td class="standings-rank">${rank}</td>
        <td class="team-col">
          <div class="standings-team-cell">
            ${avatar}
            <div>
              <div class="standings-team-name">
                ${_esc(name)}${isMe ? ' <span style="font-size:.7rem;color:var(--color-gold);font-weight:700;">★</span>' : ""}
              </div>
              ${bubble ? `<span class="bubble-tag">bubble</span>` : ""}
            </div>
          </div>
        </td>
        ${dataCells}
      </tr>`;
    }).join("");

    // ── Legend ───────────────────────────────────────────────
    const legend = isSpecial
      ? `<div class="standings-legend">
          <span class="legend-dot" style="background:#18e07a"></span>Active
          <span class="legend-dot" style="background:var(--color-text-dim);margin-left:8px;"></span>Eliminated
         </div>`
      : `<div class="standings-legend">
          <span class="legend-dot" style="background:var(--color-gold)"></span>Playoff spot
          <span class="legend-dot" style="background:var(--color-gold-dim);margin-left:8px;"></span>Bubble
         </div>`;

    el.innerHTML = `
      <div class="standings-meta">
        <span>${_esc(leagueLabel)} · ${season}</span>
        <a href="https://www42.myfantasyleague.com/${season}/home/${leagueId}" target="_blank"
          style="font-size:.75rem;color:var(--color-gold);">View on MFL ↗</a>
      </div>
      ${divisionBannerHTML}
      <div class="standings-table-wrap">
        <table class="standings-table">
          <thead><tr>
            <th>#</th><th class="team-col">Team</th>
            ${theadCols}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${legend}`;
  }

  // Called when user clicks any division pill ("all" or a specific division ID)
  function _selectDivision(divId) {
    if (!_mflBundle) return;
    _mflSelectedDivId = divId === "all" ? "all" : String(divId);
    const el = document.getElementById("dtab-standings");
    if (!el) return;
    const { bundle, season } = _mflBundle;
    const standings  = MFLAPI.normalizeStandings(bundle);
    const leagueInfo = MFLAPI.getLeagueInfo(bundle);
    _renderMFLStandings(el, bundle.league?.league, standings, _leagueId, season, leagueInfo, _myRosterId, bundle);
  }

  // Keep old name as alias for any existing onclick references
  function _showAllDivisions() { _selectDivision("all"); }

  function _loadingHTML(msg) {
    return `<div class="detail-loading"><div class="spinner"></div><span>${msg}</span></div>`;
  }
  function _errorHTML(msg) {
    return `<div class="detail-error">⚠️ ${_esc(msg)}</div>`;
  }
  function _esc(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  return {
    init, reset, setLeague, refresh,
    initMatchups, loadMatchupsWeek,
    initPlayoffs, _mflLoadWeek, _mflLoadBracket,
    _showAllDivisions, _selectDivision,
    getSelectedDivId: () => _mflSelectedDivId,
  };

})();
