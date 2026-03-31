// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Standings, Matchups, Playoffs
//  Ported from SleeperBid/standings.js
//  Renders inside the league detail panel tabs.
// ─────────────────────────────────────────────────────────

const DLRStandings = (() => {

  let _leagueId   = null;
  let _platform   = "sleeper";
  let _leagueData = null;
  let _matchCache = {};
  let _historyLeagues = [];
  let _viewingId  = null;
  let _initToken  = 0; // increment on each init to cancel stale async ops

  // ── Reset (call when closing or switching leagues) ───────
  function reset() {
    _leagueId    = null;
    _platform    = "sleeper";
    _leagueData  = null;
    _matchCache  = {};
    _historyLeagues = [];
    _viewingId   = null;
    _initToken++;
  }

  // ── Init ────────────────────────────────────────────────
  async function init(leagueId, platform) {
    reset();
    _leagueId  = leagueId;
    _platform  = platform || "sleeper";
    const token = ++_initToken;

    const el = document.getElementById("dtab-standings");
    if (!el) return;
    el.innerHTML = _loadingHTML("Loading standings…");

    // MFL standings not yet supported via API — show placeholder
    if (_platform === "mfl") {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-8);text-align:center;">
        <div style="font-size:2rem;margin-bottom:var(--space-3);">🏈</div>
        <div style="font-weight:600;margin-bottom:var(--space-2);">MFL standings coming soon</div>
        <div style="font-size:.85rem;color:var(--color-text-dim);">
          View full standings on <a href="https://www42.myfantasyleague.com/${new Date().getFullYear()}/home/${leagueId}" target="_blank" style="color:var(--color-gold);">MyFantasyLeague.com</a>
        </div>
      </div>`;
      return;
    }

    try {
      await _loadData(leagueId, token);
      if (token !== _initToken) return; // stale
      await _loadHistory(leagueId, token);
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
    if (token !== undefined && token !== _initToken) return;
    _renderSeasonBar();
  }

  // ── Season bar ────────────────────────────────────────────
  function _renderSeasonBar() {
    const bar = document.getElementById("dtab-standings-seasonbar");
    if (!bar) return;
    if (_historyLeagues.length <= 1) { bar.style.display = "none"; return; }
    const viewId = _viewingId || _leagueId;
    bar.style.display = "";
    bar.innerHTML = `
      <div class="season-bar-label">Season</div>
      <div class="season-bar-pills">
        ${_historyLeagues.map(h => `
          <button class="season-pill ${h.leagueId === viewId ? "season-pill--current" : ""}"
            onclick="DLRStandings.switchSeason('${h.leagueId}')">
            ${h.season}${h.current ? " ★" : ""}
          </button>`).join("")}
      </div>`;
  }

  async function switchSeason(leagueId) {
    if (!leagueId || leagueId === "0") return;
    _viewingId  = leagueId;
    _matchCache = {};
    _renderSeasonBar();
    const el = document.getElementById("dtab-standings");
    if (el) el.innerHTML = _loadingHTML("Loading season…");
    await _loadData(leagueId);
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
      <div id="dtab-standings-seasonbar" style="display:none;margin-bottom:12px;"></div>
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

    _renderSeasonBar();
  }

  async function refresh() {
    const id = _viewingId || _leagueId;
    if (!id) return;
    const el = document.getElementById("dtab-standings");
    if (el) el.innerHTML = _loadingHTML("Refreshing…");
    await _loadData(id);
  }

  // ── Matchups ──────────────────────────────────────────────
  async function initMatchups() {
    const el = document.getElementById("dtab-matchups");
    if (!el) return;

    if (_platform === "mfl") {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-8);text-align:center;">
        MFL matchups not yet available. <a href="https://www42.myfantasyleague.com/${new Date().getFullYear()}/home/${_leagueId}" target="_blank" style="color:var(--color-gold);">View on MFL →</a>
      </div>`;
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

    // Get players from cache or fetch
    let players = {};
    try {
      const raw = localStorage.getItem("dlr_players");
      if (raw) players = JSON.parse(raw);
      if (!Object.keys(players).length) {
        const r = await fetch("https://api.sleeper.app/v1/players/nfl");
        players = await r.json();
        try { localStorage.setItem("dlr_players", JSON.stringify(players)); } catch(e) {}
      }
    } catch(e) {}

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

    if (_platform === "mfl") {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-8);text-align:center;">
        MFL playoff bracket not yet available. <a href="https://www42.myfantasyleague.com/${new Date().getFullYear()}/home/${_leagueId}" target="_blank" style="color:var(--color-gold);">View on MFL →</a>
      </div>`;
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
        const t1win = decided && m.w === m.t1;
        const t2win = decided && m.w === m.t2;
        return `<div class="bracket-match">
          <div class="bracket-slot ${t1win ? "bracket-slot--win" : t2win ? "bracket-slot--lose" : ""}">${matchLabel(m.t1)}</div>
          <div class="bracket-vs">vs</div>
          <div class="bracket-slot ${t2win ? "bracket-slot--win" : t1win ? "bracket-slot--lose" : ""}">${matchLabel(m.t2)}</div>
          <div class="bracket-result">${decided ? `Winner: <span class="bracket-winner">${matchLabel(m.w)}</span>` : "In progress"}</div>
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

      const cols = rounds.map(r => {
        const isSemis = r === maxRound;
        const label   = isSemis ? "Semifinals" : "First Round";
        const sublabel = isSemis ? "Semifinal" : "First Round";
        const regHTML = (byRound[r] || []).map(m => `
          <div class="bracket-match-group">
            <div class="bracket-match-sublabel">${sublabel}</div>
            ${bracketMatch(m)}
          </div>`).join("");
        const fifthHTML = isSemis && fifthGame ? `
          <div class="bracket-match-group">
            <div class="bracket-match-sublabel place-5">5th Place</div>
            ${bracketMatch(fifthGame)}
          </div>` : "";
        return `<div class="bracket-round">
          <div class="bracket-round-label">${label}</div>
          ${regHTML}${fifthHTML}
        </div>`;
      }).join("");

      const finalCol = `<div class="bracket-round">
        <div class="bracket-round-label">🏆 Championship</div>
        ${champGame ? `<div class="bracket-match-group">
          <div class="bracket-match-sublabel">🏆 Championship</div>
          ${bracketMatch(champGame)}
        </div>` : ""}
        ${thirdGame ? `<div class="bracket-match-group">
          <div class="bracket-match-sublabel place-3">🥉 3rd Place</div>
          ${bracketMatch(thirdGame)}
        </div>` : ""}
      </div>`;

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
          <div class="bracket-title">🏆 Playoff Bracket</div>
          <div class="bracket-container">${cols}${finalCol}</div>
          ${draftHTML}
        </div>`;
    } catch(e) {
      if (el) el.innerHTML = _errorHTML("Could not load bracket: " + e.message);
    }
  }

  // ── Helpers ────────────────────────────────────────────
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
    init,
    reset,
    refresh,
    switchSeason,
    initMatchups,
    loadMatchupsWeek,
    initPlayoffs
  };

})();
