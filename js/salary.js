// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Salary Cap Module
//  Only shown for leagues tagged as "salary" type
//  Firebase: gmd/salaryCap/{leagueKey}/settings
//            gmd/salaryCap/{leagueKey}/rosters
//
//  Settings:
//    cap         — total cap (any number, formatted smartly)
//    minSalary   — minimum player salary
//    irCapPct    — how much IR salaries count toward cap (0-100%)
//    taxiCapPct  — how much taxi salaries count toward cap (0-100%)
//    holdouts    — boolean, allow holdout flags
//    contracts   — boolean, track contract years
// ─────────────────────────────────────────────────────────

const DLRSalaryCap = (() => {

  let _leagueKey  = null;
  let _storageKey = null;  // franchiseId or leagueKey — stable across seasons
  let _leagueId   = null;
  let _isCommish  = false;
  let _settings   = null;
  let _rosterData = null;  // from Sleeper
  let _salaryData = null;  // from Firebase: { username: { players: [...] } }
  let _players    = {};    // slim player map
  let _initToken  = 0;
  let _viewMode   = "overview";
  let _selectedTeam = null;   // username string, null = all teams
  let _topPaidPos   = "ALL";  // position filter for top paid

  const DEFAULT_SETTINGS = {
    cap:        300000000,
    minSalary:  100000,
    irCapPct:   75,   // IR counts at 75% of salary toward cap
    taxiCapPct: 0,    // Taxi counts at 0% (free)
    holdouts:   true,
    contracts:  false
  };

  const POS_COLOR = {
    QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff",
    TE:"#ffc94d", K:"#9ca3af", DEF:"#9ca3af"
  };

  // ── Smart money formatter ─────────────────────────────────
  function _fmtMoney(v) {
    if (!v && v !== 0) return "—";
    const abs = Math.abs(v);
    const sign = v < 0 ? "-" : "";
    if (abs >= 1_000_000_000) return `${sign}$${(abs/1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000)     return `${sign}$${(abs/1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1)}M`;
    if (abs >= 1_000)         return `${sign}$${(abs/1_000).toFixed(abs % 1_000 === 0 ? 0 : 0)}K`;
    return `${sign}$${abs.toLocaleString()}`;
  }

  // ── Init ──────────────────────────────────────────────────
  async function init(leagueKey, leagueId, isCommish, franchiseId) {
    _leagueKey  = leagueKey;
    _leagueId   = leagueId;
    _isCommish  = !!isCommish;
    // Use franchiseId as storage key so salary data persists across seasons
    // franchiseId is stable (oldest leagueId in chain), leagueKey changes each year
    _storageKey = franchiseId || leagueKey;
    _settings   = null;
    _salaryData = null;
    _rosterData = null;
    _viewMode     = "overview";
    _selectedTeam = null;
    _topPaidPos   = "ALL";
    _initToken++;
    const token = _initToken;

    const el = document.getElementById("dtab-salary");
    if (!el) return;
    el.innerHTML = _loadingHTML("Loading salary data…");

    try {
      [_settings, _salaryData] = await Promise.all([
        _loadSettings(_storageKey),
        _loadSalaryData(_storageKey)
      ]);
      if (token !== _initToken) return;

      // Load player DB via IndexedDB-backed module
      _players = DLRPlayers.all();
      if (Object.keys(_players).length < 100) {
        _players = await DLRPlayers.load();
      }
      if (token !== _initToken) return;

      // Load Sleeper roster data
      if (_leagueId) {
        const [rosters, users] = await Promise.all([
          SleeperAPI.getRosters(_leagueId),
          SleeperAPI.getLeagueUsers(_leagueId)
        ]);
        if (token !== _initToken) return;
        const userMap = {};
        (users||[]).forEach(u => { userMap[u.user_id] = u; });
        _rosterData = (rosters||[]).map(r => {
          const u = userMap[r.owner_id] || {};
          return {
            roster_id: r.roster_id,
            ownerId:   r.owner_id,
            username:  (u.username || u.user_id || `team_${r.roster_id}`).toLowerCase(),
            teamName:  u.metadata?.team_name || u.display_name || u.username || `Team ${r.roster_id}`,
            avatar:    u.avatar || null,
            players:   r.players  || [],
            reserve:   r.reserve  || [],
            taxi:      r.taxi     || [],
            wins:      r.settings?.wins   || 0,
            losses:    r.settings?.losses || 0
          };
        });
      }

      if (token !== _initToken) return;
      _render();
    } catch(e) {
      if (token !== _initToken) return;
      el.innerHTML = _errorHTML("Could not load salary data: " + e.message);
    }
  }

  function reset() {
    _leagueKey  = null;
    _salaryData = null;
    _rosterData = null;
    _settings   = null;
    _initToken++;
  }

  // ── Firebase — all use SDK refs to avoid 401 auth issues ──
  async function _loadSettings(leagueKey) {
    try {
      const data = await GMDB.getSalarySettings(leagueKey);
      return { ...DEFAULT_SETTINGS, ...(data || {}) };
    } catch(e) { return { ...DEFAULT_SETTINGS }; }
  }

  async function _loadSalaryData(leagueKey) {
    try {
      return await GMDB.getSalaryRosters(leagueKey) || {};
    } catch(e) { return {}; }
  }

  async function _saveSettings(settings) {
    await GMDB.saveSalarySettings(_storageKey, settings);
    _settings = settings;
  }

  async function _saveSalaryData() {
    await GMDB.saveSalaryRosters(_storageKey, _salaryData);
  }

  // ── Main render ───────────────────────────────────────────
  function _render() {
    const el = document.getElementById("dtab-salary");
    if (!el) return;

    el.innerHTML = `
      <div class="sal-toolbar">
        <div class="sal-view-tabs">
          <button class="sal-tab ${_viewMode==="overview" ?"sal-tab--active":""}" onclick="DLRSalaryCap.setView('overview')">Overview</button>
          <button class="sal-tab ${_viewMode==="roster"  ?"sal-tab--active":""}" onclick="DLRSalaryCap.setView('roster')">Rosters</button>
          <button class="sal-tab ${_viewMode==="toppaid" ?"sal-tab--active":""}" onclick="DLRSalaryCap.setView('toppaid')">Top Paid</button>
          ${_isCommish ? `
            <button class="sal-tab ${_viewMode==="bulk"    ?"sal-tab--active":""}" onclick="DLRSalaryCap.setView('bulk')">📤 Bulk Upload</button>
            <button class="sal-tab ${_viewMode==="settings"?"sal-tab--active":""}" onclick="DLRSalaryCap.setView('settings')">⚙ Settings</button>
          ` : ""}
        </div>
        <div class="sal-cap-badge">
          <span class="sal-cap-label">Cap</span>
          <span class="sal-cap-val">${_fmtMoney(_settings.cap)}</span>
        </div>
      </div>
      <div id="sal-content"></div>`;

    _renderView();
  }

  function setView(mode) {
    _viewMode = mode;
    document.querySelectorAll(".sal-tab").forEach(t => {
      const matches = t.getAttribute("onclick")?.includes(`'${mode}'`);
      t.classList.toggle("sal-tab--active", !!matches);
    });
    _renderView();
  }

  function _renderView() {
    const el = document.getElementById("sal-content");
    if (!el) return;
    if (_viewMode === "overview")  _renderOverview(el);
    if (_viewMode === "roster")    _renderRosters(el);
    if (_viewMode === "toppaid")   _renderTopPaid(el);
    if (_viewMode === "caproom")   _renderCapRoom(el);
    if (_viewMode === "bulk")      _renderBulkUpload(el);
    if (_viewMode === "settings")  _renderSettings(el);
  }

  function setPos(pos) {
    _topPaidPos = pos || "ALL";
    _renderView();
  }

  function selectTeam(username) {
    _selectedTeam = username || null;
    _renderView();
  }

  // ── Player helpers ────────────────────────────────────────
  function _playerName(pid) {
    const p = _players[pid] || {};
    const fn = p.fn || p.first_name || "";
    const ln = p.ln || p.last_name  || "";
    return fn ? `${fn} ${ln}` : pid;
  }
  function _playerPos(pid) {
    const p = _players[pid] || {};
    return (p.pos || p.fantasy_positions?.[0] || p.position || "—").toUpperCase();
  }
  function _playerTeam(pid) {
    return (_players[pid]?.team || _players[pid]?.team || "FA");
  }

  // ── Salary map ────────────────────────────────────────────
  function _getTeamSalaryMap() {
    const map = {};
    Object.entries(_salaryData || {}).forEach(([username, td]) => {
      map[username] = {};
      (td.players || []).forEach(p => {
        if (p.playerId) map[username][p.playerId] = p;
      });
    });
    return map;
  }
  // Alias used by CSV template and getCapData
  const _getSalaryMap = _getTeamSalaryMap;

  function _calcCapSpent(team, salaryMap) {
    const sm   = salaryMap[team.username] || {};
    const irSet = new Set(team.reserve);
    const txSet = new Set(team.taxi);
    let spent = 0;
    [...team.players, ...team.reserve, ...team.taxi].forEach(pid => {
      const entry = sm[pid] || {};
      const sal   = entry.salary || 0;
      if (irSet.has(pid))      spent += sal * (_settings.irCapPct   / 100);
      else if (txSet.has(pid)) spent += sal * (_settings.taxiCapPct / 100);
      else                     spent += sal;
    });
    return Math.round(spent);
  }

  // ── Overview — salary breakdown per team ──────────────────
  function _renderOverview(el) {
    if (!_rosterData?.length) {
      el.innerHTML = `<div class="sal-empty">No roster data.</div>`; return;
    }
    const salaryMap = _getTeamSalaryMap();
    const POS = ["QB","RB","WR","TE","K"];
    const irPct  = (_settings.irCapPct   ?? 75) / 100;
    const txPct  = (_settings.taxiCapPct ?? 0)  / 100;

    const teams = [..._rosterData].map(t => {
      const sm    = salaryMap[t.username] || {};
      const irSet = new Set(t.reserve || []);
      const txSet = new Set(t.taxi    || []);
      const seen  = new Set();
      const byPos = {};
      POS.forEach(p => { byPos[p] = 0; });
      byPos["OTHER"] = 0;
      let capSpent = 0;

      // Deduplicate — players array already includes reserve/taxi in Sleeper
      const allPids = [...new Set([...(t.players||[]), ...(t.reserve||[]), ...(t.taxi||[])])];
      allPids.forEach(pid => {
        if (seen.has(pid)) return; seen.add(pid);
        const rawSal = sm[pid]?.salary || 0;
        // Apply cap percentage based on slot
        const effectiveSal = irSet.has(pid) ? rawSal * irPct
                           : txSet.has(pid) ? rawSal * txPct
                           : rawSal;
        const pos = _playerPos(pid);
        const grp = POS.includes(pos) ? pos : "OTHER";
        byPos[grp] += effectiveSal;
        capSpent   += effectiveSal;
      });
      capSpent = Math.round(capSpent);
      return { ...t, byPos, capSpent };
    }).sort((a, b) => b.capSpent - a.capSpent);

    const posColors = { QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff", TE:"#ffc94d", K:"#f97316", OTHER:"#6b7280" };
    const cap = _settings.cap || 0;

    el.innerHTML = `
      ${irPct < 1 || txPct < 1 ? `<div class="sal-cap-note dim" style="font-size:.75rem;margin-bottom:var(--space-3)">
        IR counts at ${Math.round(irPct*100)}% · Taxi counts at ${Math.round(txPct*100)}% of salary toward cap
      </div>` : ""}
      <div class="sal-overview-grid">
        ${teams.map(t => {
          const avail   = cap - t.capSpent;
          const usedPct = cap > 0 ? Math.min(100, t.capSpent / cap * 100) : 0;
          const capColor = usedPct >= 95 ? "var(--color-red)" : usedPct >= 80 ? "var(--color-gold)" : "var(--color-green)";

          const segments = [...POS, "OTHER"].map(pos => {
            const pct = cap > 0 ? (t.byPos[pos] / cap * 100) : 0;
            return pct > 0.3 ? `<div class="sal-ov-seg" style="width:${pct.toFixed(1)}%;background:${posColors[pos]}" title="${pos}: ${_fmtMoney(Math.round(t.byPos[pos]))}"></div>` : "";
          }).join("");
          const availPct = Math.max(0, 100 - usedPct);
          const segAvail = availPct > 0.3 ? `<div class="sal-ov-seg" style="width:${availPct.toFixed(1)}%;background:rgba(255,255,255,.07)"></div>` : "";

          return `
            <div class="sal-ov-card" onclick="DLRSalaryCap.selectTeam('${t.username}');DLRSalaryCap.setView('roster')">
              <div class="sal-ov-header">
                <div class="sal-ov-name">${_esc(t.teamName)}</div>
                <div class="sal-ov-total" style="color:${capColor}">${_fmtMoney(t.capSpent)}</div>
              </div>
              <div class="sal-ov-bar">${segments}${segAvail}</div>
              <div class="sal-ov-meta">
                <span class="${avail<0?"sal-ov-over":"sal-ov-avail"}">${avail<0?"−":""}${_fmtMoney(Math.abs(avail))} ${avail<0?"over cap":"available"}</span>
                <div class="sal-ov-pos-row">
                  ${[...POS,"OTHER"].filter(p => t.byPos[p] > 0).map(p =>
                    `<span class="sal-ov-pos-pill" style="color:${posColors[p]}">${p} ${_fmtMoney(Math.round(t.byPos[p]))}</span>`
                  ).join("")}
                </div>
              </div>
            </div>`;
        }).join("")}
      </div>
      <div class="sal-ov-legend">
        ${[...POS,"OTHER"].map(p => `<span><span class="sal-ov-dot" style="background:${posColors[p]}"></span>${p}</span>`).join("")}
        <span><span class="sal-ov-dot" style="background:rgba(255,255,255,.1)"></span>Available</span>
      </div>`;
  }

  // ── Roster view — with team selector ─────────────────────
  function _renderRosters(el) {
    if (!_rosterData?.length) {
      el.innerHTML = `<div class="sal-empty">No roster data.</div>`; return;
    }
    const salaryMap = _getTeamSalaryMap();

    // Team selector bar
    const teamBtns = `
      <div class="sal-team-pills">
        <button class="sal-team-pill ${!_selectedTeam?"sal-team-pill--active":""}"
          onclick="DLRSalaryCap.selectTeam(null)">All Teams</button>
        ${_rosterData.map(t =>
          `<button class="sal-team-pill ${_selectedTeam===t.username?"sal-team-pill--active":""}"
            onclick="DLRSalaryCap.selectTeam('${t.username}')">${_esc(t.teamName)}</button>`
        ).join("")}
      </div>`;

    const teamsToShow = _selectedTeam
      ? _rosterData.filter(t => t.username === _selectedTeam)
      : [..._rosterData].sort((a, b) => _calcCapSpent(b, salaryMap) - _calcCapSpent(a, salaryMap));

    el.innerHTML = teamBtns + teamsToShow.map(t => _renderTeamCard(t, salaryMap)).join("");
  }

  function _renderTeamCard(team, salaryMap) {
    const sm       = salaryMap[team.username] || {};
    const capSpent = _calcCapSpent(team, salaryMap);
    const capAvail = _settings.cap - capSpent;
    const capPct   = _settings.cap > 0 ? Math.min(100, (capSpent / _settings.cap) * 100) : 0;
    const capColor = capPct >= 95 ? "var(--color-red)" : capPct >= 80 ? "var(--color-gold)" : "var(--color-green)";

    const irSet   = new Set(team.reserve);
    const taxiSet = new Set(team.taxi);

    const posOrder = ["QB","RB","WR","TE","K","DEF"];
    const byPos = {};
    posOrder.forEach(p => { byPos[p] = []; });
    byPos["—"] = [];

    team.players.filter(id => !irSet.has(id) && !taxiSet.has(id)).forEach(pid => {
      const pos = _playerPos(pid);
      const grp = posOrder.includes(pos) ? pos : "—";
      byPos[grp].push(pid);
    });
    posOrder.forEach(pos => byPos[pos].sort((a, b) => (sm[b]?.salary||0) - (sm[a]?.salary||0)));

    const renderPid = (pid, slot) => {
      const entry = sm[pid] || {};
      const name  = _playerName(pid);
      const pos   = _playerPos(pid);
      const color = POS_COLOR[pos] || "#9ca3af";
      const sal   = entry.salary || 0;
      const isHoldout = entry.holdout || false;

      const editBtn = _isCommish
        ? `<button class="sal-edit-btn" onclick="DLRSalaryCap.openEditModal('${pid}','${team.username}','${_escAttr(name)}')" title="Edit salary">✏</button>`
        : "";

      return `
        <div class="sal-player-row${isHoldout ? " sal-player-row--holdout" : ""}">
          <div class="sal-player-photo">
            <img src="https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg"
              onerror="this.style.display='none'" loading="lazy"/>
          </div>
          <div class="sal-pos-dot" style="background:${color}22;color:${color};border-color:${color}55">${pos}</div>
          <div class="sal-player-name-col">
            <span class="sal-player-name-text sal-player-link"
              onclick="DLRPlayerCard.show('${pid}','${_escAttr(name)}')">${_esc(name)}</span>
            ${slot==="ir"   ? `<span class="sal-badge sal-badge--slot">IR ${_settings.irCapPct}%</span>` : ""}
            ${slot==="taxi" ? `<span class="sal-badge sal-badge--taxi">Taxi ${_settings.taxiCapPct}%</span>` : ""}
          </div>
          <div class="sal-salary-right">
            ${isHoldout ? `<span class="sal-holdout-icon" title="Holdout">🔥</span>` : ""}
            <div class="sal-salary-cell">
              ${sal > 0 ? `<span class="sal-amount">${_fmtMoney(sal)}</span>` : `<span class="sal-unset">—</span>`}
              ${_settings.contracts && entry.years ? `<span class="sal-years">${entry.years}yr</span>` : ""}
            </div>
            ${editBtn}
          </div>
        </div>`;
    };

    let rows = "";
    for (const pos of [...posOrder, "—"]) {
      if (!byPos[pos]?.length) continue;
      const posTotal = byPos[pos].reduce((s, pid) => s + (sm[pid]?.salary||0), 0);
      rows += `
        <div class="sal-pos-header">
          <span style="color:${POS_COLOR[pos]||"var(--color-text-dim)"}">${pos}</span>
          <span class="sal-pos-total">${posTotal > 0 ? _fmtMoney(posTotal) : ""}</span>
        </div>
        ${byPos[pos].map(pid => renderPid(pid, "roster")).join("")}`;
    }

    if (team.reserve.length) {
      rows += `<div class="sal-divider">IR — counts ${_settings.irCapPct}% toward cap</div>`;
      team.reserve.forEach(pid => { rows += renderPid(pid, "ir"); });
    }
    if (team.taxi.length) {
      rows += `<div class="sal-divider">Taxi — counts ${_settings.taxiCapPct}% toward cap</div>`;
      team.taxi.forEach(pid => { rows += renderPid(pid, "taxi"); });
    }

    return `
      <div class="sal-team-card">
        <div class="sal-team-header">
          <div class="sal-team-id">
            <div class="sal-team-name">${_esc(team.teamName)}</div>
            <div class="sal-team-record dim">${team.wins}–${team.losses}</div>
          </div>
          <div class="sal-cap-bar-section">
            <div class="sal-cap-bar-wrap">
              <div class="sal-cap-bar-fill" style="width:${capPct.toFixed(1)}%;background:${capColor}"></div>
            </div>
            <div class="sal-cap-row">
              <span style="color:${capColor};font-weight:700">${_fmtMoney(capSpent)} spent</span>
              <span class="dim">${_fmtMoney(Math.abs(capAvail))} ${capAvail < 0 ? "OVER" : "avail"}</span>
              <span class="dim">${capPct.toFixed(0)}%</span>
            </div>
          </div>
        </div>
        <div class="sal-player-list">${rows}</div>
      </div>`;
  }

  // ── Top Paid ──────────────────────────────────────────────
  // ── Top Paid — with position filter pills ─────────────────
  function _renderTopPaid(el) {
    const salaryMap = _getTeamSalaryMap();
    const all = [];
    const seen = new Set();
    (_rosterData||[]).forEach(team => {
      const sm = salaryMap[team.username] || {};
      [...(team.players||[]), ...(team.reserve||[]), ...(team.taxi||[])].forEach(pid => {
        if (seen.has(pid)) return; seen.add(pid);
        const entry = sm[pid];
        if (entry?.salary > 0) {
          all.push({ pid, salary: entry.salary, teamName: team.teamName,
            pos: _playerPos(pid), name: _playerName(pid) });
        }
      });
    });

    if (!all.length) {
      el.innerHTML = `<div class="sal-empty">No salary data yet.</div>`; return;
    }

    const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K"];
    const filtered = _topPaidPos === "ALL" ? all : all.filter(p => p.pos === _topPaidPos);
    filtered.sort((a, b) => b.salary - a.salary);
    const maxSal = filtered[0]?.salary || 1;

    const posColors = { QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff", TE:"#ffc94d", K:"#f97316" };

    el.innerHTML = `
      <div class="sal-pos-pills">
        ${POSITIONS.map(pos =>
          `<button class="sal-pos-pill ${_topPaidPos===pos?"sal-pos-pill--active":""}"
            onclick="DLRSalaryCap.setPos('${pos}')">${pos}</button>`
        ).join("")}
      </div>
      <div class="sal-toppaid-list">
        ${filtered.slice(0, 40).map((p, i) => {
          const c   = posColors[p.pos] || "#9ca3af";
          const pct = (p.salary / maxSal * 100).toFixed(0);
          return `
            <div class="sal-toppaid-row" onclick="DLRPlayerCard.show('${p.pid}','${_escAttr(p.name)}')">
              <div class="sal-tp-rank dim">${i+1}</div>
              <div class="sal-tp-photo">
                <img src="https://sleepercdn.com/content/nfl/players/thumb/${p.pid}.jpg"
                  onerror="this.style.display='none'" loading="lazy"/>
              </div>
              <div class="sal-pos-dot" style="background:${c}22;color:${c};border-color:${c}55">${p.pos}</div>
              <div class="sal-tp-info">
                <div class="sal-player-name-text">${_esc(p.name)}</div>
                <div class="sal-tp-team dim">${_esc(p.teamName)}</div>
              </div>
              <div class="sal-tp-bar-outer"><div class="sal-tp-bar-fill" style="width:${pct}%;background:${c}99"></div></div>
              <div class="sal-amount">${_fmtMoney(p.salary)}</div>
            </div>`;
        }).join("")}
      </div>`;
  }

  // ── Cap Room — stacked bar by position ───────────────────
  function _renderCapRoom(el) {
    if (!_rosterData?.length) {
      el.innerHTML = `<div class="sal-empty">No roster data.</div>`; return;
    }
    const salaryMap = _getTeamSalaryMap();
    const POS = ["QB","RB","WR","TE","K","OTHER"];
    const posColors = { QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff", TE:"#ffc94d", K:"#f97316", OTHER:"#6b7280" };
    const cap = _settings.cap || 0;

    const teams = [..._rosterData].map(t => {
      const sm  = salaryMap[t.username] || {};
      const seen = new Set();
      const byPos = {};
      POS.forEach(p => { byPos[p] = 0; });
      [...(t.players||[]),...(t.reserve||[]),...(t.taxi||[])].forEach(pid => {
        if (seen.has(pid)) return; seen.add(pid);
        const sal = sm[pid]?.salary || 0;
        const pos = _playerPos(pid);
        const grp = ["QB","RB","WR","TE","K"].includes(pos) ? pos : "OTHER";
        byPos[grp] += sal;
      });
      const total = Object.values(byPos).reduce((s, v) => s + v, 0);
      return { ...t, byPos, total };
    }).sort((a, b) => b.total - a.total);

    el.innerHTML = `
      <div class="sal-cr-legend">
        ${POS.map(p => `<span class="sal-cr-leg-item"><span class="sal-cr-leg-dot" style="background:${posColors[p]}"></span>${p}</span>`).join("")}
        <span class="sal-cr-leg-item"><span class="sal-cr-leg-dot" style="background:rgba(255,255,255,.1)"></span>Available</span>
      </div>
      <div class="sal-cr-list">
        ${teams.map(t => {
          const avail = cap - t.total;
          const capColor = cap > 0 && t.total/cap >= 0.95 ? "var(--color-red)"
                         : cap > 0 && t.total/cap >= 0.8  ? "var(--color-gold)"
                         : "var(--color-green)";
          // Build stacked bar segments
          const segs = POS.map(pos => {
            const pct = cap > 0 ? (t.byPos[pos] / cap * 100) : 0;
            return pct > 0.3 ? `<div class="sal-cr-seg" style="width:${pct.toFixed(1)}%;background:${posColors[pos]}" title="${pos}: ${_fmtMoney(t.byPos[pos])}"></div>` : "";
          }).join("");
          const availPct = cap > 0 ? Math.max(0, (avail / cap * 100)) : 0;
          const availSeg = availPct > 0.3 ? `<div class="sal-cr-seg sal-cr-seg--avail" style="width:${availPct.toFixed(1)}%"></div>` : "";

          return `
            <div class="sal-cr-row">
              <div class="sal-cr-name" title="${_esc(t.teamName)}">${_esc(t.teamName)}</div>
              <div class="sal-cr-bar-wrap">
                <div class="sal-cr-stacked">${segs}${availSeg}</div>
              </div>
              <div class="sal-cr-numbers">
                <span style="color:${capColor};font-family:var(--font-display);font-weight:700">${_fmtMoney(t.total)}</span>
                <span style="color:${avail<0?"var(--color-red)":"var(--color-text-dim)"};font-size:.72rem">${avail<0?"−":"+"}${_fmtMoney(Math.abs(avail))}</span>
              </div>
            </div>`;
        }).join("")}
      </div>`;
  }

  // ── Settings ──────────────────────────────────────────────
  function _renderSettings(el) {
    if (!_isCommish) { el.innerHTML = `<div class="sal-empty">Commissioner access only.</div>`; return; }
    const s = _settings;
    el.innerHTML = `
      <div class="sal-settings-wrap">
        <div class="form-group">
          <label>Total Salary Cap</label>
          <input type="number" id="sal-cap" value="${s.cap}" step="1" min="0"/>
          <span class="field-hint">Any amount — formatted as $B, $M, $K or $ automatically</span>
        </div>
        <div class="form-group">
          <label>Minimum Player Salary</label>
          <input type="number" id="sal-min" value="${s.minSalary}" step="1" min="0"/>
        </div>
        <div class="form-group">
          <label>IR Salary Cap Contribution %</label>
          <input type="number" id="sal-ir" value="${s.irCapPct}" min="0" max="100"/>%
          <span class="field-hint">0 = IR players are free, 100 = full salary counts, 75 = 75% counts toward cap</span>
        </div>
        <div class="form-group">
          <label>Taxi Salary Cap Contribution %</label>
          <input type="number" id="sal-taxi" value="${s.taxiCapPct}" min="0" max="100"/>%
          <span class="field-hint">0 = Taxi squad is free, 100 = full salary counts toward cap</span>
        </div>
        <div class="form-group">
          <label class="label-checkbox">
            <input type="checkbox" id="sal-holdouts" ${s.holdouts?"checked":""}/>
            <span>Enable holdout flags on players</span>
          </label>
        </div>
        <div class="form-group">
          <label class="label-checkbox">
            <input type="checkbox" id="sal-contracts" ${s.contracts?"checked":""}/>
            <span>Track contract years per player</span>
          </label>
        </div>
        <button class="btn-primary" onclick="DLRSalaryCap.saveSettings()">Save Settings</button>
        <div id="sal-settings-status" style="margin-top:var(--space-3);font-size:.82rem;color:var(--color-text-dim);"></div>
      </div>`;
  }

  async function saveSettings() {
    const settings = {
      cap:        parseFloat(document.getElementById("sal-cap")?.value)  || DEFAULT_SETTINGS.cap,
      minSalary:  parseFloat(document.getElementById("sal-min")?.value)  || DEFAULT_SETTINGS.minSalary,
      irCapPct:   parseFloat(document.getElementById("sal-ir")?.value)   ?? DEFAULT_SETTINGS.irCapPct,
      taxiCapPct: parseFloat(document.getElementById("sal-taxi")?.value) ?? DEFAULT_SETTINGS.taxiCapPct,
      holdouts:   document.getElementById("sal-holdouts")?.checked  ?? true,
      contracts:  document.getElementById("sal-contracts")?.checked ?? false
    };
    const btn = document.querySelector(".sal-settings-wrap .btn-primary");
    const status = document.getElementById("sal-settings-status");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    try {
      await _saveSettings(settings);
      if (btn)    { btn.textContent = "Save Settings"; btn.disabled = false; }
      if (status) status.textContent = `✓ Saved at ${new Date().toLocaleTimeString()}`;
      _render();
    } catch(e) {
      if (btn)    { btn.textContent = "Error — try again"; btn.disabled = false; }
      if (status) status.textContent = "Save failed: " + e.message;
    }
  }

  // ── Edit player salary modal ──────────────────────────────
  function openEditModal(pid, username, playerName) {
    if (!_isCommish) return;

    if (!_salaryData[username]) _salaryData[username] = { players: [] };
    const existing = (_salaryData[username].players || []).find(p => p.playerId === pid) || {};

    document.getElementById("sal-edit-modal")?.remove();
    const modal = document.createElement("div");
    modal.id        = "sal-edit-modal";
    modal.className = "modal-overlay";
    modal.style.zIndex = "850";
    modal.innerHTML = `
      <div class="modal-box modal-box--sm">
        <div class="modal-header">
          <h3>Edit Salary</h3>
          <button class="modal-close" onclick="document.getElementById('sal-edit-modal').remove()">✕</button>
        </div>
        <div class="modal-body">
          <div style="font-weight:600;margin-bottom:var(--space-3);font-size:.95rem;">${_esc(playerName)}</div>
          <div class="form-group">
            <label>Salary</label>
            <input type="number" id="sal-edit-amount" value="${existing.salary||0}" step="1" min="0"
              placeholder="${_settings.minSalary}" autofocus/>
            <span class="field-hint" id="sal-edit-preview">${_fmtMoney(existing.salary||0)}</span>
          </div>
          ${_settings.contracts ? `
          <div class="form-group">
            <label>Contract Years</label>
            <input type="number" id="sal-edit-years" value="${existing.years||1}" min="1" max="10"/>
          </div>` : ""}
          ${_settings.holdouts ? `
          <div class="form-group">
            <label class="label-checkbox">
              <input type="checkbox" id="sal-edit-holdout" ${existing.holdout?"checked":""}/>
              <span>🔥 Flag as holdout</span>
            </label>
          </div>` : ""}
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="document.getElementById('sal-edit-modal').remove()">Cancel</button>
          <button class="btn-primary" onclick="DLRSalaryCap.savePlayerSalary('${pid}','${username}')">Save</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // Live preview of formatted amount
    const amtEl = document.getElementById("sal-edit-amount");
    const prevEl = document.getElementById("sal-edit-preview");
    if (amtEl && prevEl) {
      amtEl.addEventListener("input", () => {
        prevEl.textContent = _fmtMoney(parseFloat(amtEl.value)||0);
      });
    }
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  }

  async function savePlayerSalary(pid, username) {
    const salary  = parseFloat(document.getElementById("sal-edit-amount")?.value) || 0;
    const years   = parseInt(document.getElementById("sal-edit-years")?.value)    || 1;
    const holdout = document.getElementById("sal-edit-holdout")?.checked          || false;

    if (!_salaryData[username]) _salaryData[username] = { players: [] };
    const players = _salaryData[username].players || [];
    const idx     = players.findIndex(p => p.playerId === pid);
    const entry   = { playerId: pid, salary, years, holdout };
    if (idx >= 0) players[idx] = entry;
    else players.push(entry);
    _salaryData[username].players = players;

    document.getElementById("sal-edit-modal")?.remove();
    try {
      await _saveSalaryData();
    } catch(e) { console.error("[Salary] Save failed:", e); }
    _renderView();
  }

  // ── Bulk Upload ───────────────────────────────────────────
  function _renderBulkUpload(el) {
    if (!_isCommish) { el.innerHTML = `<div class="sal-empty">Commissioner access only.</div>`; return; }

    const csvTemplate = _buildCSVTemplate();

    el.innerHTML = `
      <div class="sal-bulk-wrap">
        <div class="sal-bulk-intro">
          <div class="sal-bulk-title">📤 Bulk Salary Upload</div>
          <p class="sal-bulk-desc">Download the template, fill in salaries in your spreadsheet, then paste or upload the CSV here. Only the "salary" column is required — years and holdout are optional.</p>
        </div>

        <div class="sal-bulk-section">
          <div class="sal-bulk-step">Step 1 — Download Template</div>
          <button class="btn-secondary" onclick="DLRSalaryCap.downloadTemplate()">⬇ Download CSV Template</button>
        </div>

        <div class="sal-bulk-section">
          <div class="sal-bulk-step">Step 2 — Paste or Upload CSV</div>
          <div class="sal-bulk-upload-zone" id="sal-drop-zone">
            <div>Drag & drop CSV here, or</div>
            <input type="file" id="sal-file-input" accept=".csv,.txt" style="display:none" onchange="DLRSalaryCap.handleFileUpload(this)"/>
            <button class="btn-secondary" onclick="document.getElementById('sal-file-input').click()">Choose File</button>
          </div>
          <textarea id="sal-bulk-csv" class="sal-bulk-textarea"
            placeholder="Or paste CSV here (no username needed — matched by player_id):&#10;player_id,player_name,nfl_team,fantasy_team,salary,years,holdout&#10;4984,Justin Jefferson,MIN,My Team,39000000,2,false"
            rows="8"></textarea>
        </div>

        <div class="sal-bulk-section">
          <button class="btn-primary" onclick="DLRSalaryCap.processBulkCSV()">Process & Save</button>
          <span id="sal-bulk-status" style="margin-left:var(--space-3);font-size:.82rem;color:var(--color-text-dim);"></span>
        </div>

        <div id="sal-bulk-preview" style="margin-top:var(--space-4);"></div>
      </div>`;

    // Drag and drop
    const zone = document.getElementById("sal-drop-zone");
    if (zone) {
      zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("sal-drop-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("sal-drop-over"));
      zone.addEventListener("drop", e => {
        e.preventDefault();
        zone.classList.remove("sal-drop-over");
        const file = e.dataTransfer.files[0];
        if (file) _readFileToTextarea(file);
      });
    }
  }

  function _buildCSVTemplate() {
    const rows = ["player_id,player_name,nfl_team,fantasy_team,salary,years,holdout"];
    const salMap = _getSalaryMap();
    (_rosterData||[]).forEach(team => {
      const sm  = salMap[team.username] || {};
      // Deduplicate — Sleeper's team.players already contains IR and taxi players
      const seen = new Set();
      const allPids = [...(team.players||[]), ...(team.reserve||[]), ...(team.taxi||[])];
      allPids.forEach(pid => {
        if (seen.has(pid)) return;
        seen.add(pid);
        const p     = _players[pid] || {};
        const name  = p.first_name ? `${p.first_name} ${p.last_name}` : pid;
        const nfl   = p.team || "FA";
        const entry = sm[pid] || {};
        rows.push(`${pid},"${name}",${nfl},"${team.teamName}",${entry.salary||0},${entry.years||1},${entry.holdout?"true":"false"}`);
      });
    });
    return rows.join("\n");
  }

  function downloadTemplate() {
    const csv  = _buildCSVTemplate();
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `salary_template_${_storageKey || _leagueKey}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleFileUpload(input) {
    const file = input.files[0];
    if (file) _readFileToTextarea(file);
  }

  function _readFileToTextarea(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const ta = document.getElementById("sal-bulk-csv");
      if (ta) ta.value = e.target.result;
    };
    reader.readAsText(file);
  }

  async function processBulkCSV() {
    const ta     = document.getElementById("sal-bulk-csv");
    const status = document.getElementById("sal-bulk-status");
    const preview = document.getElementById("sal-bulk-preview");
    if (!ta || !ta.value.trim()) {
      if (status) status.textContent = "No data to process.";
      return;
    }

    const lines = ta.value.trim().split("\n").filter(Boolean);
    const header = lines[0].toLowerCase().split(",").map(s => s.trim().replace(/"/g,""));
    const pidIdx  = header.findIndex(h => h.includes("player_id") || h === "id");
    const salIdx  = header.findIndex(h => h.includes("salary") || h.includes("sal"));
    const yrsIdx  = header.findIndex(h => h.includes("year") || h.includes("yr"));
    const hoIdx   = header.findIndex(h => h.includes("holdout") || h.includes("hold"));
    // username column is optional — we find owner by player_id lookup in roster data

    if (pidIdx < 0 || salIdx < 0) {
      if (status) status.textContent = "CSV must have player_id and salary columns.";
      return;
    }

    // Build a player→team lookup map for fast matching
    const pidToUsername = {};
    (_rosterData||[]).forEach(team => {
      [...team.players, ...team.reserve, ...team.taxi].forEach(pid => {
        pidToUsername[pid] = team.username;
      });
    });

    // Parse rows — match by player_id, ignore username column
    const updates = [];
    const errors  = [];
    lines.slice(1).forEach((line, i) => {
      const cols = _parseCSVLine(line);
      const pid  = cols[pidIdx]?.replace(/"/g,"").trim();
      const sal  = parseFloat((cols[salIdx]||"").replace(/["$,\s]/g,"") || "0");
      const yrs  = yrsIdx >= 0 ? parseInt(cols[yrsIdx]?.replace(/"/g,"") || "1") : 1;
      const ho   = hoIdx  >= 0 ? cols[hoIdx]?.toLowerCase().includes("true") : false;

      if (!pid || isNaN(sal)) { errors.push(`Row ${i+2}: invalid player_id or salary`); return; }

      // Find owner by player_id in loaded rosters
      const ownerUsername = pidToUsername[pid] || null;
      if (!ownerUsername) { errors.push(`Row ${i+2}: player ${pid} not found on any roster (import active season first)`); return; }

      updates.push({ pid, username: ownerUsername, salary: sal, years: yrs || 1, holdout: ho });
    });

    // Show preview
    if (preview) {
      preview.innerHTML = `
        <div style="font-size:.82rem;color:var(--color-text-dim);margin-bottom:var(--space-2);">
          ${updates.length} players to update${errors.length ? `, ${errors.length} errors` : ""}
        </div>
        ${errors.length ? `<div style="color:var(--color-red);font-size:.75rem;margin-bottom:var(--space-2)">${errors.slice(0,5).join("<br>")}</div>` : ""}
        <div class="sal-bulk-preview-list">
          ${updates.slice(0,10).map(u => `
            <div class="sal-bulk-preview-row">
              <span>${_esc(_playerName(u.pid))}</span>
              <span class="dim">${u.username}</span>
              <span class="sal-amount">${_fmtMoney(u.salary)}</span>
            </div>`).join("")}
          ${updates.length > 10 ? `<div class="dim" style="font-size:.75rem;padding:var(--space-1) 0">…and ${updates.length-10} more</div>` : ""}
        </div>
        <button id="sal-confirm-btn" class="btn-primary" style="margin-top:var(--space-3)"
          onclick="DLRSalaryCap.confirmBulkSave()">
          ✓ Confirm & Save All ${updates.length} Players
        </button>`;
      window._pendingBulkUpdates = updates;
    }

    if (status) status.textContent = errors.length ? `${errors.length} rows had errors (shown above)` : "Ready to save";
  }

  async function confirmBulkSave() {
    const updates = window._pendingBulkUpdates || [];
    if (!updates.length) return;

    const btn = document.getElementById("sal-confirm-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

    // Apply updates to _salaryData
    updates.forEach(({ pid, username, salary, years, holdout }) => {
      if (!_salaryData[username]) _salaryData[username] = { players: [] };
      const players = _salaryData[username].players;
      const idx     = players.findIndex(p => p.playerId === pid);
      const entry   = { playerId: pid, salary, years, holdout };
      if (idx >= 0) players[idx] = entry;
      else players.push(entry);
    });

    try {
      await _saveSalaryData();
      window._pendingBulkUpdates = [];
      const status = document.getElementById("sal-bulk-status");
      if (status) status.textContent = `✓ Saved ${updates.length} players`;
      setView("roster"); // switch to roster view to see results
    } catch(e) {
      if (btn) { btn.disabled = false; btn.textContent = "Retry Save"; }
      const status = document.getElementById("sal-bulk-status");
      if (status) status.textContent = "Save failed: " + e.message;
    }
  }

  function _parseCSVLine(line) {
    const result = [];
    let current  = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"')      inQuotes = !inQuotes;
      else if (line[i] === "," && !inQuotes) { result.push(current); current = ""; }
      else current += line[i];
    }
    result.push(current);
    return result;
  }

  // ── Helpers ────────────────────────────────────────────────
  function _loadingHTML(msg) { return `<div class="detail-loading"><div class="spinner"></div><span>${msg}</span></div>`; }
  function _errorHTML(msg)   { return `<div class="detail-error">⚠️ ${_esc(msg)}</div>`; }
  function _esc(s)     { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function _escAttr(s) { return String(s||"").replace(/'/g,"\\'").replace(/"/g,"&quot;"); }

  // ── Expose cap data to auction module ────────────────────
  // ── Silent preload — loads cap data without touching UI or initToken ──
  // Used by openLeagueDetail so Teams tab has cap data immediately
  async function preloadCap(leagueKey, leagueId, franchiseId) {
    // Don't overwrite if already loaded for this league
    if (_leagueKey === leagueKey && _settings && _rosterData) {
      console.log(`[SalaryCap.preloadCap] Already loaded for ${leagueKey}, cap=${_settings?.cap}`);
      return;
    }
    console.log(`[SalaryCap.preloadCap] Loading for ${leagueKey}, franchiseId=${franchiseId}`);

    const storageKey = franchiseId || leagueKey;
    try {
      const [settings, salaryData] = await Promise.all([
        _loadSettings(storageKey),
        _loadSalaryData(storageKey)
      ]);
      // Only update module state if we're not already initialized for this league
      if (_leagueKey !== leagueKey || !_settings) {
        _leagueKey  = leagueKey;
        _leagueId   = leagueId;
        _storageKey = storageKey;
        _settings   = settings;
        _salaryData = salaryData;
      }
      // Load roster data for cap calculations
      if (leagueId && !_rosterData) {
        const [rosters, users] = await Promise.all([
          SleeperAPI.getRosters(leagueId),
          SleeperAPI.getLeagueUsers(leagueId)
        ]);
        const userMap = {};
        (users||[]).forEach(u => { userMap[u.user_id] = u; });
        _rosterData = (rosters||[]).map(r => {
          const u = userMap[r.owner_id] || {};
          return {
            roster_id: r.roster_id,
            ownerId:   r.owner_id,
            username:  (u.username || u.user_id || `team_${r.roster_id}`).toLowerCase(),
            teamName:  u.metadata?.team_name || u.display_name || u.username || `Team ${r.roster_id}`,
            players:   r.players  || [],
            reserve:   r.reserve  || [],
            taxi:      r.taxi     || [],
            wins:      r.settings?.wins   || 0,
            losses:    r.settings?.losses || 0
          };
        });
      }
    } catch(e) {
      console.error(`[SalaryCap.preloadCap] Error:`, e.message);
    }
    console.log(`[SalaryCap.preloadCap] Done. settings=${JSON.stringify(_settings)}, rosterData=${_rosterData?.length}`);
  }

  function getCapData() {
    console.log(`[SalaryCap.getCapData] settings=${!!_settings} cap=${_settings?.cap} rosterData=${_rosterData?.length} leagueKey=${_leagueKey}`);
    if (!_settings || !_rosterData) return null;
    const salaryMap = _getSalaryMap();
    const result = {};
    (_rosterData || []).forEach(team => {
      const spent     = _calcCapSpent(team, salaryMap);
      const remaining = _settings.cap - spent;
      result[team.username] = { spent, remaining, cap: _settings.cap };
    });
    return result;
  }

  function getTeamSalaryEntries(username) {
    return (_salaryData[username]?.players || []);
  }

  return {
    init, preloadCap, reset, setView, setPos, selectTeam,
    openEditModal, savePlayerSalary,
    saveSettings,
    downloadTemplate, handleFileUpload, processBulkCSV, confirmBulkSave,
    getCapData, getTeamSalaryEntries
  };

})();
