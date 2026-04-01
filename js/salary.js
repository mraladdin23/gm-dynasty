// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Salary Cap Module
//  Stores salary data in Firebase gmd/salaryCap/{leagueKey}/
//  Settings: cap, minSalary, irDiscount, taxiDiscount,
//            contractYears, holdoutsEnabled
// ─────────────────────────────────────────────────────────

const DLRSalaryCap = (() => {

  let _leagueId   = null;
  let _leagueKey  = null;
  let _isCommish  = false;
  let _initToken  = 0;
  let _settings   = null;
  let _salaryData = null;
  let _rosterData = null;
  let _players    = {};

  const DEFAULT_SETTINGS = {
    cap:           301200000,
    minSalary:     100000,
    irDiscount:    0.25,
    contractYears: false,
    holdouts:      false
  };

  function fmtM(n) {
    n = Number(n) || 0;
    if (n >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3)  return `$${Math.round(n / 1e3)}K`;
    return `$${n}`;
  }

  function capColor(spent, cap) {
    const r = spent / (cap || 1);
    if (r > 0.95) return "var(--color-red)";
    if (r > 0.80) return "#ffc94d";
    return "var(--color-green)";
  }

  // ── Init ──────────────────────────────────────────────────
  async function init(leagueId, leagueKey, isCommish) {
    _leagueId   = leagueId;
    _leagueKey  = leagueKey;
    _isCommish  = !!isCommish;
    _settings   = null;
    _salaryData = null;
    _rosterData = null;
    _initToken++;
    const token = _initToken;

    const el = document.getElementById("dtab-salary");
    if (!el) return;
    el.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Loading salary data…</span></div>`;

    try {
      await _loadAll(leagueId, leagueKey, token);
    } catch(e) {
      if (token !== _initToken) return;
      el.innerHTML = `<div class="detail-error">⚠️ ${e.message}</div>`;
    }
  }

  function reset() {
    _leagueId = null; _leagueKey = null;
    _settings = null; _salaryData = null; _rosterData = null;
    _initToken++;
  }

  async function _loadAll(leagueId, leagueKey, token) {
    const [settings, salaryData, rosters, users] = await Promise.all([
      _restGet(`gmd/salaryCap/${leagueKey}/settings`),
      _restGet(`gmd/salaryCap/${leagueKey}/rosters`),
      SleeperAPI.getRosters(leagueId),
      SleeperAPI.getLeagueUsers(leagueId)
    ]);
    if (token !== _initToken) return;

    _settings   = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    _salaryData = salaryData || {};

    const userMap = {};
    (users||[]).forEach(u => { userMap[u.user_id] = u; });
    _rosterData = (rosters||[]).map(r => {
      const u = userMap[r.owner_id] || {};
      return {
        roster_id: r.roster_id,
        owner_id:  r.owner_id,
        teamName:  u.metadata?.team_name || u.display_name || u.username || `Team ${r.roster_id}`,
        players:   r.players  || [],
        reserve:   r.reserve  || [],
        taxi:      r.taxi     || [],
      };
    });

    try { _players = JSON.parse(localStorage.getItem("dlr_players") || "{}"); } catch(e) {}
    _render();
  }

  async function _restGet(path) {
    try { return await GMDB._restGet(path); } catch(e) { return null; }
  }

  // ── Compute team salary totals ────────────────────────────
  function _computeTeams() {
    const cap = _settings.cap;
    return _rosterData.map(team => {
      const salMap     = _salaryData[team.roster_id] || {};
      const reserveSet = new Set(team.reserve);
      const taxiSet    = new Set(team.taxi);
      let spent = 0;
      const playerRows = [];

      team.players.forEach(pid => {
        const entry   = salMap[pid] || {};
        const sal     = entry.salary || 0;
        const isIR    = reserveSet.has(pid);
        const isTaxi  = taxiSet.has(pid);
        const effective = isIR ? Math.round(sal * (1 - (_settings.irDiscount || 0))) : sal;
        spent += effective;
        playerRows.push({ pid, sal, isIR, isTaxi, holdout: !!entry.holdout,
                          years: entry.years || null, effective });
      });

      return { ...team, spent, available: cap - spent, playerRows };
    }).sort((a, b) => b.spent - a.spent);
  }

  // ── Main render ───────────────────────────────────────────
  function _render() {
    const el = document.getElementById("dtab-salary");
    if (!el) return;

    const cap   = _settings.cap;
    const teams = _computeTeams();

    const spents   = teams.map(t => t.spent);
    const avails   = teams.map(t => t.available);
    const avgSpent = spents.length ? Math.round(spents.reduce((a,b)=>a+b,0)/spents.length) : 0;

    el.innerHTML = `
      ${_isCommish ? `
        <div style="text-align:right;margin-bottom:var(--space-3);">
          <button class="btn-secondary btn-sm" onclick="DLRSalaryCap.openSettings()">⚙ Cap Settings</button>
        </div>` : ""}

      <div class="sal-summary-grid">
        <div class="sal-summary-stat">
          <div class="sal-summary-val">${fmtM(cap)}</div>
          <div class="sal-summary-lbl">Salary Cap</div>
        </div>
        <div class="sal-summary-stat">
          <div class="sal-summary-val">${fmtM(avgSpent)}</div>
          <div class="sal-summary-lbl">Avg Spent</div>
        </div>
        <div class="sal-summary-stat">
          <div class="sal-summary-val" style="color:var(--color-red)">${fmtM(spents.length ? Math.max(...spents) : 0)}</div>
          <div class="sal-summary-lbl">Most Spent</div>
        </div>
        <div class="sal-summary-stat">
          <div class="sal-summary-val" style="color:${Math.min(...avails) < 0 ? "var(--color-red)" : "var(--color-green)"}">${fmtM(avails.length ? Math.min(...avails) : 0)}</div>
          <div class="sal-summary-lbl">Least Available</div>
        </div>
      </div>

      <div class="sal-tabs">
        <button class="sal-tab sal-tab--active" onclick="DLRSalaryCap.showSalTab('cap',this)">📊 Cap Space</button>
        <button class="sal-tab" onclick="DLRSalaryCap.showSalTab('toppaid',this)">💰 Top Paid</button>
        <button class="sal-tab" onclick="DLRSalaryCap.showSalTab('rosters',this)">👥 Rosters</button>
        ${_isCommish ? `<button class="sal-tab" onclick="DLRSalaryCap.showSalTab('edit',this)">✏️ Edit</button>` : ""}
      </div>

      <div id="sal-tab-cap">${_renderCapSpace(teams)}</div>
      <div id="sal-tab-toppaid" style="display:none">${_renderTopPaid(teams)}</div>
      <div id="sal-tab-rosters" style="display:none">${_renderRosters(teams)}</div>
      ${_isCommish ? `<div id="sal-tab-edit" style="display:none">${_renderEdit(teams)}</div>` : ""}

      <!-- Settings modal rendered inline -->
      <div id="sal-settings-modal" class="modal-overlay hidden">
        <div class="modal-box modal-box--sm">
          <div class="modal-header">
            <h3>Cap Settings</h3>
            <button class="modal-close" onclick="DLRSalaryCap.closeSettings()">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>Salary Cap (millions)</label>
              <input type="number" id="sal-cap-input" value="${(_settings.cap/1e6).toFixed(1)}" step="0.1" />
              <span class="field-hint">e.g. 301.2 = $301.2M cap</span>
            </div>
            <div class="form-group">
              <label>Minimum Salary (thousands)</label>
              <input type="number" id="sal-min-input" value="${((_settings.minSalary||100000)/1e3).toFixed(0)}" step="10" />
              <span class="field-hint">e.g. 100 = $100K minimum</span>
            </div>
            <div class="form-group">
              <label>IR Discount % (how much off)</label>
              <input type="number" id="sal-ir-input" value="${((_settings.irDiscount||0.25)*100).toFixed(0)}" min="0" max="100" />
              <span class="field-hint">e.g. 25 = IR players count 75% of salary</span>
            </div>
            <div class="label-options">
              <label class="label-checkbox">
                <input type="checkbox" id="sal-contracts-check" ${_settings.contractYears ? "checked" : ""} />
                <span>Track contract years</span>
              </label>
              <label class="label-checkbox">
                <input type="checkbox" id="sal-holdouts-check" ${_settings.holdouts ? "checked" : ""} />
                <span>Enable holdout flags 🔥</span>
              </label>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="DLRSalaryCap.closeSettings()">Cancel</button>
            <button class="btn-primary" onclick="DLRSalaryCap.saveSettings()">Save</button>
          </div>
        </div>
      </div>
    `;
  }

  function _renderCapSpace(teams) {
    const cap = _settings.cap;
    const hasData = teams.some(t => t.spent > 0);
    if (!hasData) return `<div class="sal-empty">
      <div style="font-size:1.5rem;margin-bottom:var(--space-2)">💰</div>
      <div style="font-weight:600;margin-bottom:var(--space-2)">No salary data yet</div>
      <div style="font-size:.85rem;color:var(--color-text-dim)">${_isCommish ? "Use Edit tab to enter player salaries." : "Commissioner hasn't entered salary data yet."}</div>
    </div>`;

    return teams.map(t => {
      const color = capColor(t.spent, cap);
      const pct   = Math.min(t.spent / cap * 100, 100).toFixed(1);
      const over  = t.spent > cap;
      return `<div class="sal-team-row ${over ? "sal-team-row--over" : ""}">
        <div class="sal-team-name">${_esc(t.teamName)}</div>
        <div class="sal-cap-bar-wrap">
          <div class="sal-cap-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="sal-cap-numbers">
          <span style="color:${color};font-weight:700">${fmtM(t.spent)}</span>
          <span class="dim"> / ${fmtM(cap)}</span>
          ${over
            ? `<span class="sal-over-badge">OVER</span>`
            : `<span class="sal-avail">+${fmtM(t.available)}</span>`}
        </div>
      </div>`;
    }).join("");
  }

  function _renderTopPaid(teams) {
    const POS_COLOR = { QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff", TE:"#ffc94d" };
    const all = [];
    teams.forEach(t => {
      t.playerRows.forEach(row => {
        if (row.sal > 0) {
          const p = _players[row.pid] || {};
          all.push({
            pid:     row.pid,
            name:    p.first_name ? `${p.first_name} ${p.last_name}` : row.pid,
            pos:     (p.fantasy_positions?.[0] || p.position || "—").toUpperCase(),
            salary:  row.sal,
            isIR:    row.isIR,
            holdout: row.holdout,
            teamName: t.teamName
          });
        }
      });
    });
    all.sort((a, b) => b.salary - a.salary);
    if (!all.length) return `<div class="sal-empty">No salaries entered yet.</div>`;

    const maxSal = all[0].salary;
    return `<div class="sal-toppaid-list">
      ${all.slice(0, 50).map((p, i) => {
        const color  = POS_COLOR[p.pos] || "#9ca3af";
        const barPct = (p.salary / maxSal * 100).toFixed(1);
        return `<div class="sal-toppaid-row" onclick="DLRPlayerCard.show('${p.pid}','${_escAttr(p.name)}')">
          <div class="sal-tp-rank">${i + 1}</div>
          <div class="sal-tp-pos" style="background:${color}22;color:${color};border-color:${color}55">${p.pos}</div>
          <div class="sal-tp-info">
            <div class="sal-tp-name">${_esc(p.name)}${p.holdout?" 🔥":""}${p.isIR?" 🏥":""}</div>
            <div class="sal-tp-team dim">${_esc(p.teamName)}</div>
          </div>
          <div class="sal-tp-bar-wrap">
            <div class="sal-tp-bar" style="width:${barPct}%;background:${color}"></div>
          </div>
          <div class="sal-tp-salary">${fmtM(p.salary)}</div>
        </div>`;
      }).join("")}
    </div>`;
  }

  function _renderRosters(teams) {
    const POS_COLOR = { QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff", TE:"#ffc94d", K:"#9ca3af" };
    const cap = _settings.cap;
    return teams.map(t => {
      const rows    = [...t.playerRows].sort((a, b) => b.sal - a.sal);
      const color   = capColor(t.spent, cap);
      const pct     = Math.min(t.spent / cap * 100, 100).toFixed(0);
      return `<div class="sal-roster-card">
        <div class="sal-roster-header">
          <div>
            <div class="sal-roster-teamname">${_esc(t.teamName)}</div>
            <div class="dim" style="font-size:.72rem">${fmtM(t.spent)} / ${fmtM(cap)} · ${fmtM(t.available)} left</div>
          </div>
          <div class="sal-cap-bar-wrap" style="width:70px">
            <div class="sal-cap-bar-fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </div>
        ${rows.map(row => {
          const p   = _players[row.pid] || {};
          const nm  = p.first_name ? `${p.first_name} ${p.last_name}` : row.pid;
          const pos = (p.fantasy_positions?.[0] || p.position || "—").toUpperCase();
          const col = POS_COLOR[pos] || "#9ca3af";
          const slot = row.isIR ? "IR" : row.isTaxi ? "Taxi" : "";
          return `<div class="sal-roster-row ${slot ? "sal-roster-row--dim" : ""}">
            <div class="sal-pos-dot" style="background:${col}22;color:${col};border-color:${col}55">${pos}</div>
            <div class="sal-roster-name">${_esc(nm)}${row.holdout?" 🔥":""}</div>
            <div class="sal-roster-slot dim">${slot}</div>
            <div class="sal-roster-salary">${row.sal > 0 ? fmtM(row.effective) : "—"}</div>
          </div>`;
        }).join("")}
      </div>`;
    }).join("");
  }

  function _renderEdit(teams) {
    return `<div class="sal-edit-info">Enter salaries in millions. Saves automatically.</div>
      ${teams.map(t => `
        <div class="sal-edit-team">
          <div class="sal-edit-teamname">${_esc(t.teamName)} <span class="dim">${fmtM(t.spent)}</span></div>
          ${[...t.playerRows].sort((a,b)=>b.sal-a.sal).map(row => {
            const p  = _players[row.pid] || {};
            const nm = p.first_name ? `${p.first_name} ${p.last_name}` : row.pid;
            const v  = row.sal > 0 ? (row.sal/1e6).toFixed(2) : "";
            return `<div class="sal-edit-row">
              <div class="sal-edit-name">${_esc(nm)}${row.isIR?" 🏥":row.isTaxi?" 🚕":""}</div>
              <div style="display:flex;align-items:center;gap:6px">
                <span class="dim" style="font-size:.75rem">$</span>
                <input type="number" class="sal-edit-input" value="${v}" placeholder="0.00"
                  min="0" step="0.1"
                  onchange="DLRSalaryCap.saveSalary('${t.roster_id}','${row.pid}',this.value)" />
                <span class="dim" style="font-size:.75rem">M</span>
                ${_settings.holdouts ? `
                  <label title="Holdout" style="cursor:pointer">
                    <input type="checkbox" ${row.holdout?"checked":""}
                      onchange="DLRSalaryCap.saveHoldout('${t.roster_id}','${row.pid}',this.checked)" />
                    🔥
                  </label>` : ""}
              </div>
            </div>`;
          }).join("")}
        </div>`).join("")}`;
  }

  function showSalTab(name, btn) {
    document.querySelectorAll(".sal-tab").forEach(t => t.classList.remove("sal-tab--active"));
    btn?.classList.add("sal-tab--active");
    ["cap","toppaid","rosters","edit"].forEach(n => {
      const el = document.getElementById(`sal-tab-${n}`);
      if (el) el.style.display = n === name ? "" : "none";
    });
  }

  function openSettings()  { document.getElementById("sal-settings-modal")?.classList.remove("hidden"); }
  function closeSettings() { document.getElementById("sal-settings-modal")?.classList.add("hidden"); }

  async function saveSettings() {
    if (!_leagueKey) return;
    const cap        = parseFloat(document.getElementById("sal-cap-input")?.value||"301.2") * 1e6;
    const minSalary  = parseFloat(document.getElementById("sal-min-input")?.value||"100") * 1e3;
    const irDiscount = parseFloat(document.getElementById("sal-ir-input")?.value||"25") / 100;
    const settings   = { cap, minSalary, irDiscount, contractYears: document.getElementById("sal-contracts-check")?.checked||false, holdouts: document.getElementById("sal-holdouts-check")?.checked||false };
    try {
      await GMDB._restPut(`gmd/salaryCap/${_leagueKey}/settings`, settings);
      _settings = { ...DEFAULT_SETTINGS, ...settings };
      closeSettings();
      _render();
    } catch(e) { alert("Save failed: " + e.message); }
  }

  async function saveSalary(rosterId, playerId, valueM) {
    if (!_leagueKey) return;
    const salary = Math.round(parseFloat(valueM||0) * 1e6);
    if (!_salaryData[rosterId]) _salaryData[rosterId] = {};
    if (!_salaryData[rosterId][playerId]) _salaryData[rosterId][playerId] = {};
    _salaryData[rosterId][playerId].salary = salary;
    try { await GMDB._restPut(`gmd/salaryCap/${_leagueKey}/rosters/${rosterId}/${playerId}/salary`, salary); }
    catch(e) { console.warn("[Salary] save failed:", e.message); }
  }

  async function saveHoldout(rosterId, playerId, val) {
    if (!_leagueKey) return;
    if (!_salaryData[rosterId]) _salaryData[rosterId] = {};
    if (!_salaryData[rosterId][playerId]) _salaryData[rosterId][playerId] = {};
    _salaryData[rosterId][playerId].holdout = val;
    try { await GMDB._restPut(`gmd/salaryCap/${_leagueKey}/rosters/${rosterId}/${playerId}/holdout`, val); }
    catch(e) {}
  }

  function _esc(s)     { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function _escAttr(s) { return String(s||"").replace(/'/g,"\\'").replace(/"/g,"&quot;"); }

  return { init, reset, showSalTab, openSettings, closeSettings, saveSettings, saveSalary, saveHoldout };

})();
