// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Roster View
//  Shows all team rosters for a league, live from Sleeper API.
//  Includes player photos, positions, team affiliations.
//  No salary data needed — works with any league type.
// ─────────────────────────────────────────────────────────

const DLRRoster = (() => {

  let _leagueId  = null;
  let _platform  = "sleeper";
  let _rosterData = null;   // { teams: [...], league, rosterSlots }
  let _players    = {};     // Sleeper player lookup cache
  let _initToken  = 0;
  let _filter     = "all";  // "all" | rosterId

  const POS_COLOR = {
    QB: "#b89ffe", RB: "#18e07a", WR: "#00d4ff",
    TE: "#ffc94d", K: "#9ca3af", DEF: "#9ca3af"
  };

  // ── Init ─────────────────────────────────────────────────
  async function init(leagueId, platform) {
    _leagueId  = leagueId;
    _platform  = platform || "sleeper";
    _rosterData = null;
    _filter    = "all";
    _initToken++;
    const token = _initToken;

    const el = document.getElementById("dtab-roster");
    if (!el) return;

    if (_platform !== "sleeper") {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-8);text-align:center;">
        <div style="font-size:2rem;margin-bottom:var(--space-3);">🏈</div>
        <div style="font-weight:600;">Rosters coming for MFL soon</div>
      </div>`;
      return;
    }

    el.innerHTML = _loadingHTML("Loading rosters…");

    try {
      await _loadData(leagueId, token);
    } catch(e) {
      if (token !== _initToken) return;
      el.innerHTML = _errorHTML("Could not load rosters: " + e.message);
    }
  }

  function reset() {
    _leagueId   = null;
    _rosterData = null;
    _filter     = "all";
    _initToken++;
  }

  // ── Load data ─────────────────────────────────────────────
  async function _loadData(leagueId, token) {
    const [league, rosters, users] = await Promise.all([
      SleeperAPI.getLeague(leagueId),
      SleeperAPI.getRosters(leagueId),
      SleeperAPI.getLeagueUsers(leagueId)
    ]);
    if (token !== _initToken) return;

    // Load player database from cache
    _players = await _getPlayers();
    if (token !== _initToken) return;

    const userMap = {};
    (users || []).forEach(u => { userMap[u.user_id] = u; });

    const teams = (rosters || []).map(r => {
      const u = userMap[r.owner_id] || {};
      return {
        roster_id:  r.roster_id,
        owner_id:   r.owner_id,
        teamName:   u.metadata?.team_name || u.display_name || u.username || `Team ${r.roster_id}`,
        username:   u.username || "",
        avatar:     u.avatar || null,
        players:    r.players || [],
        starters:   r.starters || [],
        reserve:    r.reserve || [],   // IR
        taxi:       r.taxi || [],
        wins:       r.settings?.wins   || 0,
        losses:     r.settings?.losses || 0,
        fpts:       (r.settings?.fpts  || 0) + (r.settings?.fpts_decimal || 0) / 100,
      };
    }).sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);

    _rosterData = {
      teams,
      league,
      rosterSlots: league.roster_positions || []
    };

    _render();
  }

  async function _getPlayers() {
    try {
      const cached = localStorage.getItem("dlr_players");
      if (cached) {
        const p = JSON.parse(cached);
        if (Object.keys(p).length > 100) return p;
      }
      const el = document.getElementById("dtab-roster");
      if (el) el.innerHTML = _loadingHTML("Downloading player database…");
      const res  = await fetch("https://api.sleeper.app/v1/players/nfl");
      const data = await res.json();
      try { localStorage.setItem("dlr_players", JSON.stringify(data)); } catch(e) {}
      return data;
    } catch(e) { return {}; }
  }

  // ── Render ────────────────────────────────────────────────
  function _render() {
    const el = document.getElementById("dtab-roster");
    if (!el || !_rosterData) return;
    const { teams } = _rosterData;

    // Team selector
    const opts = [
      `<option value="all">All Teams (${teams.length})</option>`,
      ...teams.map(t =>
        `<option value="${t.roster_id}" ${t.roster_id === _filter ? "selected" : ""}>${_esc(t.teamName)}</option>`
      )
    ].join("");

    el.innerHTML = `
      <div class="roster-toolbar">
        <select class="roster-team-select" onchange="DLRRoster.setFilter(this.value)">
          ${opts}
        </select>
      </div>
      <div id="roster-cards-container">
        ${teams.map(t => _teamCardHTML(t)).join("")}
      </div>`;

    _applyFilter();
  }

  function setFilter(val) {
    _filter = isNaN(val) ? val : parseInt(val);
    _applyFilter();
    // Update select
    const sel = document.querySelector(".roster-team-select");
    if (sel) sel.value = val;
  }

  function _applyFilter() {
    document.querySelectorAll(".roster-team-card").forEach(card => {
      const rid = parseInt(card.dataset.rosterId);
      const show = _filter === "all" || _filter === rid || _filter === String(rid);
      card.style.display = show ? "" : "none";
    });
  }

  function _teamCardHTML(team) {
    const initial = (team.teamName || "?")[0].toUpperCase();
    const avatar  = team.avatar
      ? `<img src="https://sleepercdn.com/avatars/thumbs/${team.avatar}" class="roster-avatar" onerror="this.style.display='none'">`
      : `<div class="roster-avatar-placeholder">${initial}</div>`;

    // Split players into starters, bench, IR, taxi
    const starterSet = new Set(team.starters);
    const reserveSet = new Set(team.reserve);
    const taxiSet    = new Set(team.taxi);
    const bench      = team.players.filter(id =>
      !starterSet.has(id) && !reserveSet.has(id) && !taxiSet.has(id)
    );

    const starterRows = team.starters
      .filter(id => id && id !== "0")
      .map(id => _playerRow(id, "starter"))
      .join("");
    const benchRows = bench
      .map(id => _playerRow(id, "bench"))
      .join("");
    const irRows = team.reserve
      .map(id => _playerRow(id, "ir"))
      .join("");
    const taxiRows = team.taxi
      .map(id => _playerRow(id, "taxi"))
      .join("");

    return `
      <div class="roster-team-card" data-roster-id="${team.roster_id}">
        <div class="roster-team-header">
          <div class="roster-team-identity">
            ${avatar}
            <div>
              <div class="roster-team-name">${_esc(team.teamName)}</div>
              <div class="roster-team-record">${team.wins}–${team.losses} · ${team.fpts.toFixed(1)} PF</div>
            </div>
          </div>
          <div class="roster-team-counts">
            <span class="roster-count-badge">${team.players.length} players</span>
            ${team.reserve.length ? `<span class="roster-count-badge roster-count-badge--ir">🏥 ${team.reserve.length} IR</span>` : ""}
            ${team.taxi.length ? `<span class="roster-count-badge roster-count-badge--taxi">🚕 ${team.taxi.length} Taxi</span>` : ""}
          </div>
        </div>

        ${starterRows ? `
        <div class="roster-section-label">Starters</div>
        <div class="roster-player-list">${starterRows}</div>` : ""}

        ${benchRows ? `
        <div class="roster-section-label">Bench</div>
        <div class="roster-player-list">${benchRows}</div>` : ""}

        ${irRows ? `
        <div class="roster-section-label">IR 🏥</div>
        <div class="roster-player-list">${irRows}</div>` : ""}

        ${taxiRows ? `
        <div class="roster-section-label">Taxi Squad 🚕</div>
        <div class="roster-player-list">${taxiRows}</div>` : ""}
      </div>`;
  }

  function _playerRow(playerId, slot) {
    const p       = _players[playerId] || {};
    const name    = p.first_name ? `${p.first_name} ${p.last_name}` : playerId;
    const pos     = (p.fantasy_positions?.[0] || p.position || "—").toUpperCase();
    const nflTeam = p.team || "FA";
    const color   = POS_COLOR[pos] || "#9ca3af";
    const isIR    = slot === "ir";
    const isTaxi  = slot === "taxi";
    const isBench = slot === "bench";

    return `
      <div class="roster-player-row ${isIR ? "roster-player-row--ir" : isTaxi ? "roster-player-row--taxi" : ""}">
        <div class="roster-player-photo">
          <img src="https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
            loading="lazy" />
          <div class="roster-player-photo-fallback" style="display:none;color:${color};">${pos}</div>
        </div>
        <div class="roster-player-info">
          <div class="roster-player-name ${isBench || isIR || isTaxi ? "dim" : ""}">${_esc(name)}</div>
          <div class="roster-player-meta">
            <span class="roster-pos-badge" style="background:${color}22;color:${color};border-color:${color}55">${pos}</span>
            <span class="roster-nfl-team">${nflTeam}</span>
            ${p.years_exp === 0 ? '<span class="roster-rookie-badge">R</span>' : ""}
            ${p.injury_status ? `<span class="roster-injury-badge">${p.injury_status}</span>` : ""}
          </div>
        </div>
      </div>`;
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

  return { init, reset, setFilter };

})();
