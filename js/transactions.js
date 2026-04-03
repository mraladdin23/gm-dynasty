// ─────────────────────────────────────────────────────────
//  DLR Transactions — Sleeper league transaction viewer
//  Filters: type dropdown + team dropdown
// ─────────────────────────────────────────────────────────

const DLRTransactions = (() => {

  let _leagueId  = null;
  let _platform  = null;
  let _season    = null;
  let _token     = 0;
  let _allTx     = [];      // all loaded transactions
  let _rosters   = [];      // {roster_id, teamName, username}
  let _players   = {};
  let _typeFilter = "all";
  let _teamFilter = "all";  // roster_id as string, or "all"

  const TYPE_LABELS = {
    trade:      "🔄 Trades",
    waiver:     "🏷 Waivers",
    free_agent: "➕ Free Agent",
  };

  // ── Public: init ─────────────────────────────────────────
  async function init(leagueId, platform, season) {
    _leagueId    = leagueId;
    _platform    = platform || "sleeper";
    _season      = season   || new Date().getFullYear().toString();
    _typeFilter  = "all";
    _teamFilter  = "all";
    _allTx       = [];
    _rosters     = [];
    _token++;
    const tok = _token;

    const el = document.getElementById("dtab-transactions");
    if (!el) return;

    if (_platform !== "sleeper") {
      el.innerHTML = `<div class="tx-empty">Transactions available for Sleeper leagues only.</div>`;
      return;
    }

    el.innerHTML = _loadHTML("Loading transactions…");
    await _loadData(tok);
  }

  // ── Load all data ─────────────────────────────────────────
  async function _loadData(tok) {
    const el = document.getElementById("dtab-transactions");
    if (!el || tok !== _token) return;

    try {
      // Load players + rosters in parallel with transactions (weeks 1–18)
      const weekNums = Array.from({length: 18}, (_, i) => i + 1);

      const [rosterRes, userRes, ...weekResults] = await Promise.all([
        SleeperAPI.getRosters(_leagueId),
        SleeperAPI.getLeagueUsers(_leagueId),
        ...weekNums.map(w =>
          fetch(`https://api.sleeper.app/v1/league/${_leagueId}/transactions/${w}`)
            .then(r => r.ok ? r.json() : []).catch(() => [])
        )
      ]);

      if (tok !== _token) return;

      // Build roster lookup {roster_id -> teamName}
      const userMap = {};
      (userRes||[]).forEach(u => { userMap[u.user_id] = u; });
      _rosters = (rosterRes||[]).map(r => {
        const u = userMap[r.owner_id] || {};
        return {
          roster_id: r.roster_id,
          teamName:  u.metadata?.team_name || u.display_name || `Team ${r.roster_id}`,
          username:  (u.username||"").toLowerCase()
        };
      }).sort((a,b) => a.teamName.localeCompare(b.teamName));

      _players = DLRPlayers.all();
      if (Object.keys(_players).length < 100) _players = await DLRPlayers.load();
      if (tok !== _token) return;

      // Flatten + sort by date desc
      _allTx = weekResults.flat().filter(Boolean);
      _allTx.sort((a,b) => (b.created||b.status_updated||0) - (a.created||a.status_updated||0));

      _renderView(el);
    } catch(e) {
      if (tok !== _token) return;
      el.innerHTML = `<div class="tx-empty">Could not load transactions.<br><span class="dim">${e.message}</span></div>`;
    }
  }

  // ── Render full view with toolbar ────────────────────────
  function _renderView(el) {
    if (!el) el = document.getElementById("dtab-transactions");
    if (!el) return;

    const typeCounts = { all: _allTx.length };
    _allTx.forEach(t => { typeCounts[t.type] = (typeCounts[t.type]||0) + 1; });

    const filtered = _filterTx();

    // Team dropdown options
    const teamOpts = [
      `<option value="all">All Teams</option>`,
      ..._rosters.map(r =>
        `<option value="${r.roster_id}" ${String(_teamFilter)===String(r.roster_id)?"selected":""}>${_esc(r.teamName)}</option>`)
    ].join("");

    // Type dropdown options
    const typeOpts = [
      `<option value="all" ${_typeFilter==="all"?"selected":""}>All Types (${typeCounts.all})</option>`,
      ...Object.entries(TYPE_LABELS).map(([k,v]) =>
        `<option value="${k}" ${_typeFilter===k?"selected":""}>${v} (${typeCounts[k]||0})</option>`)
    ].join("");

    el.innerHTML = `
      <div class="tx-toolbar">
        <div class="tx-filters">
          <div class="tx-filter-group">
            <label class="tx-filter-label">Type</label>
            <select class="tx-select" onchange="DLRTransactions.setType(this.value)">${typeOpts}</select>
          </div>
          <div class="tx-filter-group">
            <label class="tx-filter-label">Team</label>
            <select class="tx-select" onchange="DLRTransactions.setTeam(this.value)">${teamOpts}</select>
          </div>
          <span class="tx-count dim">${filtered.length} transaction${filtered.length!==1?"s":""}</span>
        </div>
      </div>
      <div class="tx-list">
        ${filtered.length
          ? filtered.slice(0,150).map(tx => _txRow(tx)).join("")
          : `<div class="tx-empty">No transactions match the selected filters.</div>`}
        ${filtered.length > 150
          ? `<div class="tx-more dim">Showing 150 of ${filtered.length}</div>` : ""}
      </div>`;
  }

  // ── Filter logic ──────────────────────────────────────────
  function _filterTx() {
    return _allTx.filter(tx => {
      if (_typeFilter !== "all" && tx.type !== _typeFilter) return false;
      if (_teamFilter !== "all") {
        const rid = String(_teamFilter);
        const involved = new Set([
          ...Object.values(tx.adds  || {}),
          ...Object.values(tx.drops || {}),
          ...(tx.waiver_bid !== undefined ? [tx.roster_ids?.[0]] : []),
          ...(tx.roster_ids || [])
        ].map(String));
        if (!involved.has(rid)) return false;
      }
      return true;
    });
  }

  // ── Single transaction row ────────────────────────────────
  function _txRow(tx) {
    const date    = tx.created || tx.status_updated || 0;
    const dateStr = date ? new Date(date).toLocaleDateString([], {month:"short",day:"numeric"}) : "";
    const week    = tx.leg    ? `Wk ${tx.leg}` : "";
    const type    = tx.type   || "unknown";
    const statusOk = !tx.status || tx.status === "complete";
    const statusColor = statusOk ? "" : "color:var(--color-red)";

    let body = "";
    if (type === "trade") {
      body = _tradeSummary(tx);
    } else {
      const adds  = Object.entries(tx.adds  || {}).map(([pid]) => _chip(pid, "add")).join(" ");
      const drops = Object.entries(tx.drops || {}).map(([pid]) => _chip(pid, "drop")).join(" ");
      const waivBid = tx.settings?.waiver_bid != null
        ? `<span class="tx-bid dim">$${tx.settings.waiver_bid}</span>` : "";
      body = [
        adds  ? `${adds} ${waivBid}` : "",
        drops ? `<span class="tx-drops">${drops}</span>` : ""
      ].filter(Boolean).join(`<span class="tx-arrow"> · </span>`);
    }

    // Who initiated (for non-trades, show team name)
    const initiator = type !== "trade" && tx.roster_ids?.[0]
      ? _teamName(tx.roster_ids[0]) : "";

    return `
      <div class="tx-row tx-row--${type}">
        <div class="tx-meta">
          <span class="tx-type-badge tx-type-badge--${type}">${TYPE_LABELS[type]||type}</span>
          ${initiator ? `<span class="tx-team-name">${_esc(initiator)}</span>` : ""}
          <span class="tx-spacer"></span>
          ${week ? `<span class="tx-week dim">${week}</span>` : ""}
          <span class="tx-date dim">${dateStr}</span>
          ${!statusOk ? `<span class="tx-status" style="${statusColor}">${tx.status}</span>` : ""}
        </div>
        ${body ? `<div class="tx-body">${body}</div>` : ""}
      </div>`;
  }

  function _tradeSummary(tx) {
    const sides = {};
    const rids  = new Set([
      ...Object.values(tx.adds  || {}),
      ...Object.values(tx.drops || {}),
      ...(tx.draft_picks||[]).map(p => p.owner_id),
      ...(tx.draft_picks||[]).map(p => p.previous_owner_id),
    ].filter(Boolean).map(String));

    rids.forEach(rid => { sides[rid] = { gets:[], gives:[] }; });

    Object.entries(tx.adds  ||{}).forEach(([pid, rid]) => { sides[String(rid)]?.gets.push(_chip(pid,"trade")); });
    Object.entries(tx.drops ||{}).forEach(([pid, rid]) => { sides[String(rid)]?.gives.push(_chip(pid,"drop")); });
    (tx.draft_picks||[]).forEach(p => {
      const chip = `<span class="tx-chip tx-chip--pick">${p.season} Rd${p.round}</span>`;
      if (p.owner_id)          sides[String(p.owner_id)]?.gets.push(chip);
      if (p.previous_owner_id) sides[String(p.previous_owner_id)]?.gives.push(chip);
    });

    const sideArr = Object.entries(sides);
    if (!sideArr.length) return `<span class="dim">Details unavailable</span>`;

    return `<div class="tx-trade-grid">
      ${sideArr.map(([rid, {gets, gives}]) => `
        <div class="tx-trade-side">
          <div class="tx-trade-team">${_esc(_teamName(rid))}</div>
          ${gets.length  ? `<div class="tx-trade-row"><span class="tx-gets-lbl">gets</span> ${gets.join(" ")}</div>` : ""}
          ${gives.length ? `<div class="tx-trade-row"><span class="tx-gives-lbl">gives</span> ${gives.join(" ")}</div>` : ""}
        </div>`).join('<div class="tx-trade-divider">↔</div>')}
    </div>`;
  }

  function _chip(pid, chipType) {
    const p    = _players[pid] || {};
    const name = p.first_name ? `${p.first_name[0]}. ${p.last_name}` : (pid||"?");
    const pos  = (p.fantasy_positions?.[0] || p.position || "").toUpperCase();
    const posColor = {QB:"#b89ffe",RB:"#18e07a",WR:"#00d4ff",TE:"#ffc94d"}[pos] || "#9ca3af";
    const cls  = `tx-chip tx-chip--${chipType}`;
    return `<span class="${cls}" style="${chipType==="trade"?`border-color:${posColor}44`:""}" title="${pos}">${_esc(name)}</span>`;
  }

  function _teamName(rosterId) {
    return _rosters.find(r => String(r.roster_id) === String(rosterId))?.teamName || `Team ${rosterId}`;
  }

  // ── Public filter setters ─────────────────────────────────
  function setType(t) {
    _typeFilter = t;
    _renderView();
  }

  function setTeam(t) {
    _teamFilter = t;
    _renderView();
  }

  function _loadHTML(msg) {
    return `<div class="detail-loading"><div class="spinner"></div><span>${msg}</span></div>`;
  }

  function _esc(s) {
    return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  return { init, setType, setTeam };
})();
