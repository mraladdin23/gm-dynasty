// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Roster View
//  - Starters + bench combined, grouped by position,
//    ordered by Sleeper rank within each position group
//  - IR and Taxi Squad shown separately
//  - Click any player to open player card modal
// ─────────────────────────────────────────────────────────

const DLRRoster = (() => {

  let _leagueId   = null;
  let _platform   = "sleeper";
  let _rosterData = null;
  let _players    = {};
  let _initToken  = 0;
  let _filter     = "all";

  const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const POS_COLOR = {
    QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff",
    TE:"#ffc94d", K:"#9ca3af", DEF:"#9ca3af"
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
      el.innerHTML = _loadingHTML("Loading MFL rosters…");
      try {
        await _loadMFLData(leagueId, token);
      } catch(e) {
        if (token !== _initToken) return;
        el.innerHTML = _errorHTML("Could not load MFL rosters: " + e.message);
      }
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
    const el = document.getElementById("dtab-roster");

    // Load player DB first (may already be cached)
    _players = await _getPlayers(el, token);
    if (token !== _initToken) return;

    const [league, rosters, users] = await Promise.all([
      SleeperAPI.getLeague(leagueId),
      SleeperAPI.getRosters(leagueId),
      SleeperAPI.getLeagueUsers(leagueId)
    ]);
    if (token !== _initToken) return;

    const userMap = {};
    (users || []).forEach(u => { userMap[u.user_id] = u; });

    const teams = (rosters || []).map(r => {
      const u = userMap[r.owner_id] || {};
      return {
        roster_id: r.roster_id,
        owner_id:  r.owner_id,
        teamName:  u.metadata?.team_name || u.display_name || u.username || `Team ${r.roster_id}`,
        username:  u.username || "",
        avatar:    u.avatar || null,
        players:   r.players  || [],
        reserve:   r.reserve  || [],
        taxi:      r.taxi     || [],
        wins:      r.settings?.wins   || 0,
        losses:    r.settings?.losses || 0,
        fpts:      (r.settings?.fpts || 0) + (r.settings?.fpts_decimal || 0) / 100,
      };
    }).sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);

    _rosterData = { teams, league };
    _render();
  }

  async function _getPlayers(el, token) {
    try {
      // Use DLRPlayers module (IndexedDB-backed, no quota issues)
      if (el) el.innerHTML = _loadingHTML("Loading player database…");
      const players = await DLRPlayers.load();
      return players;
    } catch(e) {
      console.warn("[Roster] Player load failed:", e.message);
      return {};
    }
  }

  // ── Render ────────────────────────────────────────────────
  function _render() {
    const el = document.getElementById("dtab-roster");
    if (!el || !_rosterData) return;
    const { teams } = _rosterData;

    const opts = [
      `<option value="all">All Teams (${teams.length})</option>`,
      ...teams.map(t =>
        `<option value="${t.roster_id}" ${String(t.roster_id) === String(_filter) ? "selected" : ""}>${_esc(t.teamName)}</option>`
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
    _filter = val === "all" ? "all" : parseInt(val);
    _applyFilter();
  }

  function _applyFilter() {
    document.querySelectorAll(".roster-team-card").forEach(card => {
      const rid = parseInt(card.dataset.rosterId);
      const show = _filter === "all" || _filter === rid;
      card.style.display = show ? "" : "none";
    });
  }

  // ── Team card ─────────────────────────────────────────────
  function _teamCardHTML(team) {
    const initial = (team.teamName || "?")[0].toUpperCase();
    const avatar  = team.avatar
      ? `<img src="https://sleepercdn.com/avatars/thumbs/${team.avatar}" class="roster-avatar" onerror="this.style.display='none'">`
      : `<div class="roster-avatar-placeholder">${initial}</div>`;

    // Main roster = players minus reserve and taxi
    const reserveSet = new Set(team.reserve);
    const taxiSet    = new Set(team.taxi);
    const mainRoster = team.players.filter(id => !reserveSet.has(id) && !taxiSet.has(id));

    // Group main roster by position, sorted by Sleeper rank within group
    const byPos = {};
    POS_ORDER.forEach(p => { byPos[p] = []; });
    byPos["—"] = [];

    mainRoster.forEach(id => {
      const p   = _players[id] || {};
      const pos = (p.fantasy_positions?.[0] || p.position || "—").toUpperCase();
      const grp = POS_ORDER.includes(pos) ? pos : "—";
      byPos[grp].push({ id, player: p, rank: p.search_rank || p.rank || 9999 });
    });

    // Sort each group by rank
    Object.values(byPos).forEach(arr => arr.sort((a, b) => a.rank - b.rank));

    // Build position group sections
    let rosterHTML = "";
    for (const pos of [...POS_ORDER, "—"]) {
      const group = byPos[pos];
      if (!group.length) continue;
      rosterHTML += `
        <div class="roster-pos-group">
          <div class="roster-pos-header" style="color:${POS_COLOR[pos] || "var(--color-text-dim)"}">
            ${pos}
            <span class="roster-pos-count">${group.length}</span>
          </div>
          ${group.map(({ id }) => _playerRowHTML(id)).join("")}
        </div>`;
    }

    // IR
    let irHTML = "";
    if (team.reserve.length) {
      irHTML = `
        <div class="roster-special-section">
          <div class="roster-special-label">🏥 Injured Reserve</div>
          ${team.reserve.map(id => _playerRowHTML(id, "ir")).join("")}
        </div>`;
    }

    // Taxi
    let taxiHTML = "";
    if (team.taxi.length) {
      taxiHTML = `
        <div class="roster-special-section">
          <div class="roster-special-label">🚕 Taxi Squad</div>
          ${team.taxi.map(id => _playerRowHTML(id, "taxi")).join("")}
        </div>`;
    }

    return `
      <div class="roster-team-card" data-roster-id="${team.roster_id}">
        <div class="roster-team-header">
          <div class="roster-team-identity">
            ${avatar}
            <div>
              <div class="roster-team-name">${_esc(team.teamName)}</div>
              <div class="roster-team-record">${team.wins}–${team.losses} · ${team.fpts.toFixed(1)} PF · ${team.players.length} players</div>
            </div>
          </div>
          ${team.reserve.length || team.taxi.length ? `
          <div class="roster-team-counts">
            ${team.reserve.length ? `<span class="roster-count-badge roster-count-badge--ir">🏥 ${team.reserve.length}</span>` : ""}
            ${team.taxi.length ? `<span class="roster-count-badge roster-count-badge--taxi">🚕 ${team.taxi.length}</span>` : ""}
          </div>` : ""}
        </div>
        <div class="roster-body">
          <div class="roster-positions">${rosterHTML}</div>
          ${irHTML}${taxiHTML}
        </div>
      </div>`;
  }

  function _playerRowHTML(playerId, slot) {
    const p       = _players[playerId] || {};
    const name    = p.first_name ? `${p.first_name} ${p.last_name}` : playerId;
    const pos     = (p.fantasy_positions?.[0] || p.position || "—").toUpperCase();
    const nflTeam = p.team || "FA";
    const color   = POS_COLOR[pos] || "#9ca3af";
    const dim     = slot === "ir" || slot === "taxi";

    return `
      <div class="roster-player-row ${dim ? "roster-player-row--dim" : ""}"
        onclick="DLRPlayerCard.show('${playerId}', '${_escAttr(name)}')"
        style="cursor:pointer;">
        <div class="roster-player-photo">
          <img src="https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
            loading="lazy" />
          <div class="roster-player-photo-fallback" style="display:none;color:${color};">${pos}</div>
        </div>
        <div class="roster-player-info">
          <div class="roster-player-name">${_esc(name)}</div>
          <div class="roster-player-meta">
            <span class="roster-nfl-team">${nflTeam}</span>
            ${p.years_exp === 0 ? '<span class="roster-rookie-badge">R</span>' : ""}
            ${p.injury_status ? `<span class="roster-injury-badge">${p.injury_status}</span>` : ""}
          </div>
        </div>
      </div>`;
  }

  // ── Helpers ────────────────────────────────────────────
  async function _loadMFLData(leagueId, token) {
    const el = document.getElementById("dtab-roster");
    const season = new Date().getFullYear().toString();

    _players = await DLRPlayers.load();
    if (token !== _initToken) return;

    const [leagueData, standings, rosters] = await Promise.all([
      MFLAPI.getLeague(leagueId, season),
      MFLAPI.getStandings(leagueId, season),
      MFLAPI.getRosters(leagueId, season)
    ]);
    if (token !== _initToken) return;

    const franchises = leagueData?.franchises?.franchise || [];
    const franchiseArr = Array.isArray(franchises) ? franchises : [franchises];

    const standingsMap = {};
    (standings || []).forEach(s => { standingsMap[s.franchiseId] = s; });

    // MFL rosters: { franchise: [{ id, player: [...] }] }
    const rosterFranchises = rosters?.franchise ? (Array.isArray(rosters.franchise) ? rosters.franchise : [rosters.franchise]) : [];
    const rosterMap = {};
    rosterFranchises.forEach(f => {
      const players = f.player ? (Array.isArray(f.player) ? f.player : [f.player]) : [];
      rosterMap[f.id] = players;
    });

    const teams = franchiseArr.map(f => {
      const s = standingsMap[f.id] || {};
      const mflPlayers = rosterMap[f.id] || [];

      // Map MFL players to display format
      // MFL player IDs are numeric and don't match Sleeper IDs
      // We show position, name as-is from MFL
      const mainRoster = mflPlayers.filter(p => p.status !== "IR" && p.status !== "TAXI");
      const irRoster   = mflPlayers.filter(p => p.status === "IR");
      const taxiRoster = mflPlayers.filter(p => p.status === "TAXI");

      return {
        roster_id:   f.id,
        owner_id:    f.id,
        teamName:    f.name || `Team ${f.id}`,
        username:    (f.owner_name || f.id).toLowerCase(),
        avatar:      null,
        mflPlayers:  mflPlayers,   // raw MFL players
        players:     mainRoster.map(p => `mfl_${p.id}`),
        reserve:     irRoster.map(p => `mfl_${p.id}`),
        taxi:        taxiRoster.map(p => `mfl_${p.id}`),
        wins:        s.wins   || 0,
        losses:      s.losses || 0,
        fpts:        s.ptsFor || 0
      };
    }).sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);

    // Build a local player lookup from MFL data
    const mflPlayerLookup = {};
    teams.forEach(t => {
      (t.mflPlayers || []).forEach(p => {
        mflPlayerLookup[`mfl_${p.id}`] = {
          first_name: p.name?.split(", ")[1] || p.name || "",
          last_name:  p.name?.split(", ")[0] || "",
          position:   p.position || "?",
          fantasy_positions: [p.position || "?"],
          team:       p.team || "FA",
          search_rank: 9999
        };
      });
    });

    // Merge into _players
    Object.assign(_players, mflPlayerLookup);

    _rosterData = { teams, league: leagueData };
    _render();
  }

  function _loadingHTML(msg) {
    return `<div class="detail-loading"><div class="spinner"></div><span>${msg}</span></div>`;
  }
  function _errorHTML(msg) {
    return `<div class="detail-error">⚠️ ${_esc(msg)}</div>`;
  }
  function _esc(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }
  function _escAttr(s) {
    return String(s || "").replace(/'/g,"\\'").replace(/"/g,"&quot;");
  }

  return { init, reset, setFilter };

})();
