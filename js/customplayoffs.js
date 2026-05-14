// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Custom Playoffs  v4
//
//  Vertical "bracket-section" layout matching standings.js normal playoffs.
//  Each round = bracket-section with label + stacked bracket-match cards.
//  N-team matchups: each card shows N bracket-slots ranked by score.
//  Top advanceCount slots highlighted as advancing (bracket-slot--win).
//  Byes shown as pills below the round header (collapsed like standings).
//
//  Config shape (stored at leagueMeta.customPlayoff):
//  {
//    regSeasonEndWeek: 13,
//    seeds: [{rosterId}],
//    rounds: [
//      {
//        label: "Wild Card", startWeek: 14, weeksPerRound: 1,
//        matchups: [{ teams: [rosterId,...], advanceCount: 1 }],
//        byes: [rosterId, ...]
//      }, ...
//    ]
//  }
// ─────────────────────────────────────────────────────────

const DLRCustomPlayoffs = (() => {

  // ── State ─────────────────────────────────────────────
  let _leagueKey    = null;
  let _leagueId     = null;
  let _season       = null;
  let _isCommish    = false;
  let _username     = null;
  let _config       = null;
  let _rosters      = [];
  let _users        = [];
  let _scoreCache   = {};
  let _onMetaSave   = null;
  let _regStandings = null;

  // ── Entry point ───────────────────────────────────────
  async function init(leagueKey, league, username, leagueMeta) {
    _leagueKey    = leagueKey;
    _leagueId     = league.leagueId;
    _season       = league.season;
    _isCommish    = !!league.isCommissioner;
    _username     = username;
    _config       = leagueMeta?.customPlayoff || null;
    _scoreCache   = {};
    // Restore computed standings from saved config so they survive page reloads
    _regStandings = _config?.regStandings || null;

    const el = document.getElementById("dtab-customplayoffs");
    if (!el) return;
    el.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Loading…</span></div>`;

    try {
      [_rosters, _users] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${_leagueId}/rosters`).then(r => r.json()).catch(() => []),
        fetch(`https://api.sleeper.app/v1/league/${_leagueId}/users`).then(r => r.json()).catch(() => [])
      ]);
    } catch(e) { _rosters = []; _users = []; }

    if (!_config?.seeds?.length || !_config?.rounds?.length) {
      _renderEmpty(el); return;
    }
    try {
      await _render(el);
    } catch(e) {
      el.innerHTML = `<div class="cp-error">⚠ ${_esc(e.message)}</div>`;
    }
  }

  function reset() {
    _leagueKey = _leagueId = _season = _username = _config = null;
    _rosters = []; _users = []; _scoreCache = {}; _regStandings = null;
  }

  // ── Helpers ───────────────────────────────────────────
  function _userMap() {
    const m = {};
    (_users || []).forEach(u => {
      m[u.user_id] = u.metadata?.team_name || u.display_name || u.username || `User ${u.user_id}`;
    });
    return m;
  }
  function _rosterName(rosterId) {
    if (!rosterId) return "TBD";
    const um = _userMap();
    const r  = (_rosters || []).find(r => String(r.roster_id) === String(rosterId));
    return r ? (um[r.owner_id] || `Team ${rosterId}`) : `Team ${rosterId}`;
  }
  function _rosterRecord(rosterId, standings) {
    if (standings?.[String(rosterId)]) return standings[String(rosterId)];
    const r = (_rosters || []).find(r => String(r.roster_id) === String(rosterId));
    if (!r) return { wins: 0, losses: 0, pf: 0 };
    const pf = (r.settings?.fpts || 0) + (r.settings?.fpts_decimal || 0) / 100;
    return { wins: r.settings?.wins || 0, losses: r.settings?.losses || 0, pf };
  }
  function _seedOpts(standings) {
    const um = _userMap();
    return [...(_rosters || [])].sort((a, b) => {
      const ra = _rosterRecord(String(a.roster_id), standings);
      const rb = _rosterRecord(String(b.roster_id), standings);
      return rb.wins - ra.wins || rb.pf - ra.pf;
    }).map(r => {
      const rec = _rosterRecord(String(r.roster_id), standings);
      return {
        rosterId: String(r.roster_id),
        name: um[r.owner_id] || `Team ${r.roster_id}`,
        rec:  `${rec.wins}-${rec.losses}`,
        pf:   rec.pf
      };
    });
  }
  function _esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Score fetching ────────────────────────────────────
  async function _fetchWeek(week) {
    const key = `${_leagueId}|${week}`;
    if (_scoreCache[key]) return _scoreCache[key];
    try {
      const r = await fetch(`https://api.sleeper.app/v1/league/${_leagueId}/matchups/${week}`);
      if (!r.ok) return {};
      const data = await r.json();
      const map  = {};
      (data || []).forEach(m => { if (m.roster_id) map[String(m.roster_id)] = m.points || 0; });
      _scoreCache[key] = map;
      return map;
    } catch(e) { return {}; }
  }

  async function _scoreForRoster(rosterId, roundIdx) {
    const round   = (_config.rounds || [])[roundIdx] || {};
    const startWk = round.startWeek;
    if (!startWk || !rosterId) return null;
    const wpr = round.weeksPerRound || 1;
    let total = 0, found = 0;
    for (let w = 0; w < wpr; w++) {
      const wkMap = await _fetchWeek(startWk + w);
      const pts   = wkMap[String(rosterId)];
      if (pts != null) { total += pts; found++; }
    }
    return found > 0 ? total : null;
  }

  async function refreshScores() {
    _scoreCache = {};
    const el = document.getElementById("dtab-customplayoffs");
    if (el && _config?.rounds?.length) await _render(el);
  }

  // ── Build scored bracket data ─────────────────────────
  async function _buildBracket() {
    const rounds = _config.rounds || [];
    const result = [];
    for (let ri = 0; ri < rounds.length; ri++) {
      const round   = rounds[ri];
      const cfgMus  = round.matchups || [];
      const matchups = await Promise.all(cfgMus.map(async mu => {
        const teams = await Promise.all((mu.teams || []).map(async rid => ({
          rosterId: String(rid || ""),
          name:     _rosterName(rid),
          score:    rid ? await _scoreForRoster(rid, ri) : null
        })));
        const hasScores = teams.some(t => t.score != null);
        if (hasScores) teams.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
        return { teams, advanceCount: mu.advanceCount || 1 };
      }));
      const byes = (round.byes || []).map(rid => ({
        rosterId: String(rid), name: _rosterName(rid)
      }));
      result.push({ matchups, byes, label: round.label, startWeek: round.startWeek, weeksPerRound: round.weeksPerRound });
    }
    return result;
  }

  // ── Main render ───────────────────────────────────────
  async function _render(el) {
    el.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Fetching scores…</span></div>`;

    const cfg    = _config;
    const rounds = cfg.rounds || [];
    const nr     = rounds.length;
    const bracketData = await _buildBracket();

    const getRoundLabel = (ri) => {
      const custom = rounds[ri]?.label?.trim();
      if (custom) return custom;
      if (ri === nr - 1) return "🏆 Championship";
      if (ri === nr - 2) return "Semifinals";
      if (ri === nr - 3) return "Quarterfinals";
      return `Round ${ri + 1}`;
    };
    const getWeekTag = (ri) => {
      const r = rounds[ri];
      if (!r?.startWeek) return "";
      const wpr = r.weeksPerRound || 1;
      return ` · Wk${wpr > 1 ? `s ${r.startWeek}–${r.startWeek + wpr - 1}` : ` ${r.startWeek}`}`;
    };

    // ── Build sections ────────────────────────────────
    const isFinals = (ri) => ri === nr - 1;

    const sections = bracketData.map((rnd, ri) => {
      const adv = rnd.matchups;

      const cards = rnd.matchups.map(mu => {
        const hasScores  = mu.teams.some(t => t.score != null);
        const advCount   = mu.advanceCount || 1;
        const slots = mu.teams.map((t, rank) => {
          const advancing  = hasScores && rank < advCount;
          const eliminated = hasScores && rank >= advCount;
          const winCls  = advancing  ? "bracket-slot--win"  : "";
          const loseCls = eliminated ? "bracket-slot--lose" : "";
          const check   = advancing  ? `<span class="bracket-check">✓</span>` : "";
          const scoreEl = t.score != null
            ? `<span class="bracket-score">${t.score.toFixed(2)}</span>` : "";
          const seed = (cfg.seeds || []).findIndex(s => String(s.rosterId) === String(t.rosterId));
          const seedTag = seed >= 0 ? `<span class="seed-tag">#${seed + 1}</span>` : "";
          return `<div class="bracket-slot ${winCls}${loseCls}">
            <span class="bracket-team">${_esc(t.name || "TBD")} ${seedTag}</span>
            ${scoreEl}${check}
          </div>`;
        }).join("");

        const footer = mu.teams.length > 2 && !hasScores
          ? `<div class="bracket-tbd">Top ${advCount} advance</div>` : "";
        const inProgress = mu.teams.length > 0 && !hasScores && mu.teams.some(t => t.rosterId)
          ? `<div class="bracket-tbd">In progress</div>` : "";

        return `<div class="bracket-match">${slots}${footer || inProgress}</div>`;
      }).join("");

      // Bye pills inline under round label
      const byePills = rnd.byes.length
        ? `<div class="cp-bye-pills" style="margin-bottom:var(--space-2)">${rnd.byes.map(b =>
            `<div class="cp-bye-pill">${_esc(b.name)} <span class="cp-bye-tag">BYE</span></div>`
          ).join("")}</div>` : "";

      const sectionCls = isFinals(ri) ? "bracket-finals-section" : "bracket-section";
      const labelCls   = isFinals(ri) ? "bracket-finals-label"   : "bracket-section-label";

      return `<div class="${sectionCls}">
        <div class="${labelCls}">${_esc(getRoundLabel(ri))}${_esc(getWeekTag(ri))}</div>
        ${byePills}
        <div class="bracket-section-games">${cards}</div>
      </div>`;
    }).join("");

    // Seed list
    const seedRows = (cfg.seeds || []).map((s, i) => {
      const rec = _rosterRecord(s.rosterId, _regStandings);
      return `<div class="trn-po-seed-row">
        <span class="trn-po-seed-num">#${i + 1}</span>
        <span class="trn-po-seed-name">${_esc(_rosterName(s.rosterId))}</span>
        <span class="trn-po-seed-record">${rec.wins}–${rec.losses} · ${rec.pf.toFixed(1)} pts</span>
      </div>`;
    }).join("");

    const assignPanel = _isCommish ? _buildAssignPanel(bracketData) : "";

    const commishBar = _isCommish
      ? `<div class="cp-commish-bar">
          <button class="btn-secondary btn-sm" onclick="DLRCustomPlayoffs.openConfig()">⚙ Setup</button>
          <button class="btn-secondary btn-sm" onclick="DLRCustomPlayoffs.refreshScores()">↺ Refresh Scores</button>
        </div>` : "";

    el.innerHTML = `
      ${commishBar}
      <div class="bracket-wrap">${sections}</div>
      ${assignPanel}
      <div class="trn-po-seed-list" style="margin-top:var(--space-4)">${seedRows}</div>`;

    _wireAssignPanel();
  }

  // ── Assignment panel ──────────────────────────────────
  function _buildAssignPanel(bracketData) {
    const rounds = _config.rounds || [];
    const nr     = rounds.length;

    let lastScoredRi = -1;
    for (let ri = 0; ri < nr; ri++) {
      const rnd = bracketData[ri];
      if (rnd.matchups.length > 0 &&
          rnd.matchups.every(mu => mu.teams.length > 0 && mu.teams.every(t => t.score != null))) {
        lastScoredRi = ri;
      }
    }

    // Determine default target round: next unassigned, or next after last scored
    let defaultTargetRi = 0;
    if (lastScoredRi >= 0 && lastScoredRi < nr - 1) {
      defaultTargetRi = lastScoredRi + 1;
    } else {
      // Find first round with no matchups
      for (let ri = 0; ri < nr; ri++) {
        if (!(rounds[ri]?.matchups || []).length) { defaultTargetRi = ri; break; }
        defaultTargetRi = ri; // fall through to last round if all assigned
      }
    }

    const getRN = (ri) => rounds[ri]?.label?.trim() ||
      (ri === nr - 1 ? "🏆 Championship" : ri === nr - 2 ? "Semifinals"
       : ri === nr - 3 ? "Quarterfinals" : `Round ${ri + 1}`);

    // Round selector tabs
    const roundTabs = rounds.map((r, ri) =>
      `<button class="cp-round-tab btn-sm ${ri === defaultTargetRi ? "btn-primary" : "btn-secondary"}"
        data-ri="${ri}" onclick="DLRCustomPlayoffs._switchAssignRound(${ri})">${_esc(getRN(ri))}</button>`
    ).join("");

    // Build the panel for the default target round
    const panelContent = _buildAssignRoundContent(defaultTargetRi, bracketData, getRN, lastScoredRi);

    return `<div class="trn-section-card" style="margin-top:var(--space-4);max-width:680px" id="cp-assign-panel" data-last-scored="${lastScoredRi}">
      <div class="trn-section-card-title">Manage Matchups</div>
      <div class="cp-round-tabs" style="display:flex;flex-wrap:wrap;gap:var(--space-1);margin-bottom:var(--space-3)">${roundTabs}</div>
      <div id="cp-assign-round-content">${panelContent}</div>
    </div>`;
  }

  function _buildAssignRoundContent(targetRi, bracketData, getRN, lastScoredRi) {
    const rounds   = _config.rounds || [];
    const nr       = rounds.length;
    getRN = getRN || ((ri) => rounds[ri]?.label?.trim() ||
      (ri === nr - 1 ? "🏆 Championship" : ri === nr - 2 ? "Semifinals"
       : ri === nr - 3 ? "Quarterfinals" : `Round ${ri + 1}`));
    lastScoredRi = lastScoredRi ?? -1;

    // Build pool for this round
    const pool = [];
    if (lastScoredRi >= 0 && targetRi > 0) {
      // Use winners + byes from the round before targetRi
      const sourceRi = targetRi - 1;
      const srcRnd   = bracketData?.[sourceRi];
      if (srcRnd) {
        srcRnd.matchups.forEach(mu => {
          const adv = mu.advanceCount || 1;
          mu.teams.slice(0, adv).forEach(t => { if (t.rosterId) pool.push(t.rosterId); });
        });
        (srcRnd.byes || []).forEach(b => { if (b.rosterId) pool.push(b.rosterId); });
      }
    }
    // If pool is still empty, use all seeds (round 0 or unscored source round)
    if (!pool.length) {
      (_config.seeds || []).forEach(s => { if (s.rosterId) pool.push(s.rosterId); });
    }

    const cfgRound = rounds[targetRi] || {};
    const cfgMus   = cfgRound.matchups || [];
    const cfgByes  = cfgRound.byes    || [];
    const initMus  = cfgMus.length ? cfgMus : [{ teams: [], advanceCount: 1 }];
    const prevLabel = targetRi > 0 && lastScoredRi >= targetRi - 1
      ? `${_esc(getRN(targetRi - 1))} complete — ` : "";

    const matchupSlots = initMus.map((mu, mi) => _buildMatchupSlotHTML(mi, mu, pool)).join("");

    const byeSelects = cfgByes.map((rid, bi) =>
      `<div class="cp-assign-bye-row">
        <select class="cp-bye-sel" data-bi="${bi}" onchange="DLRCustomPlayoffs._syncSelects()">
          <option value="">— Select team —</option>
          ${pool.map(r => `<option value="${r}" ${r === rid ? "selected" : ""}>${_esc(_rosterName(r))}</option>`).join("")}
        </select>
        <button class="btn-secondary btn-sm cp-row-remove" onclick="this.parentElement.remove();DLRCustomPlayoffs._syncSelects()" title="Remove bye">✕</button>
      </div>`
    ).join("");

    return `<p style="font-size:.78rem;color:var(--color-text-dim);margin-bottom:var(--space-3)">
        ${prevLabel}${pool.length} teams available. Each matchup supports any number of teams.
      </p>
      <div id="cp-assign-slots" style="display:flex;flex-direction:column;gap:var(--space-3);margin-bottom:var(--space-3)">
        ${matchupSlots}
        <button class="btn-secondary btn-sm" style="align-self:flex-start"
          onclick="DLRCustomPlayoffs._addAssignMatchup()">+ Add Matchup</button>
      </div>
      <div style="margin-bottom:var(--space-3)">
        <div class="label-commish-divider" style="margin-bottom:var(--space-2)"><span>Byes for ${_esc(getRN(targetRi))}</span></div>
        <div id="cp-assign-byes">${byeSelects}</div>
        <button class="btn-secondary btn-sm" style="margin-top:var(--space-1)"
          onclick="DLRCustomPlayoffs._addAssignBye()">+ Add Bye</button>
      </div>
      <div style="display:flex;gap:var(--space-2);flex-wrap:wrap">
        <button class="btn-primary btn-sm" id="cp-assign-save" data-target-ri="${targetRi}">💾 Save ${_esc(getRN(targetRi))} Matchups</button>
        <button class="btn-secondary btn-sm" id="cp-assign-clear" data-target-ri="${targetRi}">✕ Clear Round</button>
      </div>`;
  }

  // Switch which round the assign panel is editing
  async function _switchAssignRound(targetRi) {
    const panel = document.getElementById("cp-assign-panel");
    if (!panel) return;
    const lastScoredRi = parseInt(panel.dataset.lastScored ?? "-1");
    const rounds = _config.rounds || [];
    const nr = rounds.length;
    const getRN = (ri) => rounds[ri]?.label?.trim() ||
      (ri === nr - 1 ? "🏆 Championship" : ri === nr - 2 ? "Semifinals"
       : ri === nr - 3 ? "Quarterfinals" : `Round ${ri + 1}`);

    // Re-fetch scored bracket data so pool is fresh
    const bracketData = await _buildBracket();
    const content = _buildAssignRoundContent(targetRi, bracketData, getRN, lastScoredRi);
    const contentEl = document.getElementById("cp-assign-round-content");
    if (contentEl) contentEl.innerHTML = content;

    // Update tab highlights
    panel.querySelectorAll(".cp-round-tab").forEach(btn => {
      const ri = parseInt(btn.dataset.ri);
      btn.classList.toggle("btn-primary",   ri === targetRi);
      btn.classList.toggle("btn-secondary", ri !== targetRi);
    });

    // Re-wire save/clear buttons and sync selects
    document.getElementById("cp-assign-save")?.addEventListener("click", async function() {
      await _saveAssignments(parseInt(this.dataset.targetRi));
    });
    document.getElementById("cp-assign-clear")?.addEventListener("click", async function() {
      await _clearRound(parseInt(this.dataset.targetRi));
    });
    _syncSelects();
  }

  function _buildMatchupSlotHTML(mi, mu, pool) {
    const advVal  = mu.advanceCount || 1;
    const teams   = mu.teams?.length ? mu.teams : ["", ""];
    const teamSels = teams.map((rid, ti) =>
      `<select class="cp-assign-sel" data-mi="${mi}" data-ti="${ti}" onchange="DLRCustomPlayoffs._syncSelects()">
        <option value="">— Select team —</option>
        ${pool.map(r => `<option value="${r}" ${r === rid ? "selected" : ""}>${_esc(_rosterName(r))}</option>`).join("")}
      </select>`
    ).join("");
    return `<div class="cp-assign-matchup" data-mi="${mi}">
      <div class="cp-assign-matchup-header">
        <span class="cp-assign-num">Matchup ${mi + 1}</span>
        <label class="cp-assign-adv-label">Advance:
          <input type="number" class="cp-assign-adv" data-mi="${mi}"
            min="1" max="${Math.max(teams.length, 2)}" value="${advVal}" />
        </label>
        <button class="btn-secondary btn-sm" onclick="DLRCustomPlayoffs._addAssignTeam(${mi})">+ Team</button>
        <button class="btn-secondary btn-sm" onclick="DLRCustomPlayoffs._removeAssignTeam(${mi})">− Team</button>
        <button class="btn-secondary btn-sm" style="margin-left:auto" onclick="this.closest('.cp-assign-matchup').remove();DLRCustomPlayoffs._syncSelects()">✕</button>
      </div>
      <div class="cp-assign-teams" id="cp-assign-mu-${mi}">${teamSels}</div>
    </div>`;
  }

  function _wireAssignPanel() {
    document.getElementById("cp-assign-save")?.addEventListener("click", async function() {
      await _saveAssignments(parseInt(this.dataset.targetRi));
    });
    document.getElementById("cp-assign-clear")?.addEventListener("click", async function() {
      await _clearRound(parseInt(this.dataset.targetRi));
    });
    _syncSelects();
  }
  function _syncSelects() {
    const panel = document.getElementById("cp-assign-panel");
    if (!panel) return;
    const allSels = [...panel.querySelectorAll(".cp-assign-sel, .cp-bye-sel")];
    const used = new Set(allSels.map(s => s.value).filter(Boolean));
    allSels.forEach(sel => {
      Array.from(sel.options).forEach(opt => {
        if (!opt.value) return;
        opt.disabled = used.has(opt.value) && opt.value !== sel.value;
      });
    });
  }

  // Dynamic panel controls
  function _addAssignTeam(mi) {
    const container = document.getElementById(`cp-assign-mu-${mi}`);
    if (!container) return;
    const pool = _getAssignPool();
    const ti   = container.querySelectorAll(".cp-assign-sel").length;
    const sel  = document.createElement("select");
    sel.className = "cp-assign-sel";
    sel.dataset.mi = mi; sel.dataset.ti = ti;
    sel.setAttribute("onchange", "DLRCustomPlayoffs._syncSelects()");
    sel.innerHTML = `<option value="">— Select team —</option>` +
      pool.map(r => `<option value="${r}">${_esc(_rosterName(r))}</option>`).join("");
    container.appendChild(sel);
    const advInp = document.querySelector(`.cp-assign-adv[data-mi="${mi}"]`);
    if (advInp) advInp.max = ti + 1;
    _syncSelects();
  }

  function _removeAssignTeam(mi) {
    const container = document.getElementById(`cp-assign-mu-${mi}`);
    if (!container) return;
    const sels = container.querySelectorAll(".cp-assign-sel");
    if (sels.length > 1) { sels[sels.length - 1].remove(); _syncSelects(); }
  }

  function _addAssignMatchup() {
    const slots = document.getElementById("cp-assign-slots");
    if (!slots) return;
    const addBtn = slots.querySelector(":scope > .btn-secondary");
    const mi   = slots.querySelectorAll(".cp-assign-matchup").length;
    const pool = _getAssignPool();
    const div  = document.createElement("div");
    div.innerHTML = _buildMatchupSlotHTML(mi, { teams: ["", ""], advanceCount: 1 }, pool);
    slots.insertBefore(div.firstElementChild, addBtn);
    _syncSelects();
  }

  function _addAssignBye() {
    const byesDiv = document.getElementById("cp-assign-byes");
    if (!byesDiv) return;
    const pool = _getAssignPool();
    const bi   = byesDiv.querySelectorAll(".cp-bye-sel").length;
    const div  = document.createElement("div");
    div.className = "cp-assign-bye-row";
    div.innerHTML = `
      <select class="cp-bye-sel" data-bi="${bi}" onchange="DLRCustomPlayoffs._syncSelects()">
        <option value="">— Select team —</option>
        ${pool.map(r => `<option value="${r}">${_esc(_rosterName(r))}</option>`).join("")}
      </select>
      <button class="btn-secondary btn-sm cp-row-remove" onclick="this.parentElement.remove();DLRCustomPlayoffs._syncSelects()" title="Remove bye">✕</button>`;
    byesDiv.appendChild(div);
    _syncSelects();
  }

  function _getAssignPool() {
    const rounds = _config?.rounds || [];
    const seeds  = (_config?.seeds || []).map(s => s.rosterId).filter(Boolean);
    let lastRi = -1;
    for (let ri = 0; ri < rounds.length; ri++) {
      if ((rounds[ri].matchups || []).some(mu => (mu.teams || []).length)) lastRi = ri;
    }
    if (lastRi < 0) return seeds;
    const lr  = rounds[lastRi];
    const out = [];
    (lr.matchups || []).forEach(mu => {
      const adv = mu.advanceCount || 1;
      (mu.teams || []).slice(0, adv).forEach(rid => { if (rid) out.push(rid); });
    });
    (lr.byes || []).forEach(rid => { if (rid) out.push(rid); });
    return [...new Set(out.length ? out : seeds)];
  }

  // ── Save / clear assignments ──────────────────────────
  async function _saveAssignments(targetRi) {
    const btn = document.getElementById("cp-assign-save");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    try {
      const slots   = document.getElementById("cp-assign-slots");
      const matchups = [];
      slots?.querySelectorAll(".cp-assign-matchup").forEach(card => {
        const mi   = parseInt(card.dataset.mi);
        const adv  = parseInt(card.querySelector(".cp-assign-adv")?.value) || 1;
        const teams = [...card.querySelectorAll(".cp-assign-sel")]
          .map(s => s.value).filter(Boolean);
        if (teams.length) matchups.push({ teams, advanceCount: adv });
      });
      const byes = [...(document.querySelectorAll("#cp-assign-byes .cp-bye-sel") || [])]
        .map(s => s.value).filter(Boolean);
      if (!matchups.length) { showToast("Add at least one matchup.", "error"); return; }

      const newConfig = JSON.parse(JSON.stringify(_config));
      if (!newConfig.rounds[targetRi]) newConfig.rounds[targetRi] = {};
      newConfig.rounds[targetRi].matchups = matchups;
      newConfig.rounds[targetRi].byes     = byes;

      await firebase.database()
        .ref(`gmd/users/${_username.toLowerCase()}/leagueMeta/${_leagueKey}`)
        .update({ customPlayoff: newConfig });

      _config = newConfig;
      if (typeof _onMetaSave === "function") _onMetaSave(_leagueKey, newConfig);
      showToast("Matchups saved ✓");
      _scoreCache = {};
      const el = document.getElementById("dtab-customplayoffs");
      if (el) await _render(el);
    } catch(e) {
      showToast("Save failed: " + e.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "💾 Save Matchups"; }
    }
  }

  async function _clearRound(ri) {
    const newConfig = JSON.parse(JSON.stringify(_config));
    if (newConfig.rounds[ri]) { newConfig.rounds[ri].matchups = []; newConfig.rounds[ri].byes = []; }
    await firebase.database()
      .ref(`gmd/users/${_username.toLowerCase()}/leagueMeta/${_leagueKey}`)
      .update({ customPlayoff: newConfig });
    _config = newConfig;
    if (typeof _onMetaSave === "function") _onMetaSave(_leagueKey, newConfig);
    showToast("Round cleared.");
    _scoreCache = {};
    const el = document.getElementById("dtab-customplayoffs");
    if (el) await _render(el);
  }

  // ── Empty state ───────────────────────────────────────
  function _renderEmpty(el) {
    if (_isCommish) {
      el.innerHTML = `
        <div class="cp-empty">
          <div class="cp-empty-icon">🏆</div>
          <div class="cp-empty-title">Custom Playoffs Not Configured</div>
          <div class="cp-empty-sub">Define your qualifying teams and rounds. Each matchup supports any number of teams.</div>
          <button class="btn-primary" onclick="DLRCustomPlayoffs.openConfig()">⚙ Set Up Custom Playoffs</button>
        </div>`;
    } else {
      el.innerHTML = `<div class="cp-empty">
        <div class="cp-empty-icon">🏆</div>
        <div class="cp-empty-title">Custom Playoffs</div>
        <div class="cp-empty-sub">Not yet configured by the commissioner.</div>
      </div>`;
    }
  }

  // ── Config modal ──────────────────────────────────────
  async function openConfig() {
    const modal = document.getElementById("cp-config-modal");
    if (!modal) return;
    const cfg  = _config || {};
    const regWkInp = modal.querySelector("#cp-reg-week");
    if (regWkInp) regWkInp.value = cfg.regSeasonEndWeek || "";
    const opts = _seedOpts(_regStandings);
    modal._opts = opts;
    modal._regStandings = _regStandings;
    const savedSeeds = cfg.seeds?.length ? cfg.seeds : opts.map(r => ({ rosterId: r.rosterId }));
    _buildSeedRows(modal, savedSeeds);
    _buildRoundRows(modal, cfg.rounds || []);
    modal.classList.remove("hidden");
  }

  // ── Reg-season standings ──────────────────────────────
  async function updateRegStandings() {
    const modal    = document.getElementById("cp-config-modal");
    const regWkInp = modal?.querySelector("#cp-reg-week");
    const btn      = modal?.querySelector("#cp-update-standings-btn");
    const endWeek  = parseInt(regWkInp?.value);
    if (!endWeek || endWeek < 1 || endWeek > 22) {
      showToast("Enter a valid end week (1–22).", "error"); return;
    }
    if (btn) { btn.disabled = true; btn.textContent = "Fetching…"; }
    try {
      const allWeeks = await Promise.all(
        Array.from({ length: endWeek }, (_, i) =>
          fetch(`https://api.sleeper.app/v1/league/${_leagueId}/matchups/${i + 1}`)
            .then(r => r.ok ? r.json() : []).catch(() => [])
        )
      );
      const standings = {};
      (_rosters || []).forEach(r => { standings[String(r.roster_id)] = { wins: 0, losses: 0, pf: 0 }; });
      allWeeks.forEach(weekData => {
        if (!Array.isArray(weekData)) return;
        const groups = {};
        weekData.forEach(e => {
          if (!e.matchup_id) return;
          if (!groups[e.matchup_id]) groups[e.matchup_id] = [];
          groups[e.matchup_id].push(e);
        });
        Object.values(groups).forEach(group => {
          if (group.length !== 2) return;
          const [a, b] = group;
          const aPts = a.points || 0, bPts = b.points || 0;
          const aId = String(a.roster_id), bId = String(b.roster_id);
          if (standings[aId]) { standings[aId].pf += aPts; if (aPts > bPts) standings[aId].wins++; else if (bPts > aPts) standings[aId].losses++; }
          if (standings[bId]) { standings[bId].pf += bPts; if (bPts > aPts) standings[bId].wins++; else if (aPts > bPts) standings[bId].losses++; }
        });
      });
      Object.values(standings).forEach(s => { s.pf = Math.round(s.pf * 100) / 100; });
      _regStandings = standings;
      modal._regStandings = standings;
      // Immediately persist to Firebase so standings survive without needing saveConfig
      if (_leagueKey && _username && _config) {
        const updated = { ...(_config || {}), regSeasonEndWeek: endWeek, regStandings: standings };
        firebase.database()
          .ref(`gmd/users/${_username.toLowerCase()}/leagueMeta/${_leagueKey}`)
          .update({ customPlayoff: updated }).catch(() => {});
        _config = updated;
        if (typeof _onMetaSave === "function") _onMetaSave(_leagueKey, updated);
      }
      const opts = _seedOpts(standings);
      modal._opts = opts;
      const curSelections = [...(modal.querySelectorAll("#cp-seeds-body .cp-seed-select") || [])]
        .map(s => ({ rosterId: s.value })).filter(s => s.rosterId);
      _buildSeedRows(modal, curSelections.length ? curSelections : opts.map(r => ({ rosterId: r.rosterId })));
      _renderStandingsPreview(modal, standings, opts, endWeek);
      showToast(`Standings updated through Week ${endWeek} ✓`);
    } catch(e) {
      showToast("Failed: " + e.message, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "↺ Update Standings"; }
    }
  }

  function _renderStandingsPreview(modal, standings, opts, endWeek) {
    let preview = modal.querySelector("#cp-standings-preview");
    if (!preview) {
      preview = document.createElement("div");
      preview.id = "cp-standings-preview";
      preview.className = "cp-standings-preview";
      const regRow = modal.querySelector(".cp-reg-week-row");
      regRow?.insertAdjacentElement("afterend", preview);
    }
    preview.innerHTML = `
      <div class="cp-standings-preview-title">Standings through Week ${endWeek}</div>
      <div class="cp-standings-table">
        <div class="cp-st-header"><span class="cp-st-rank">#</span><span class="cp-st-name">Team</span><span class="cp-st-rec">W–L</span><span class="cp-st-pf">PF</span></div>
        ${opts.map((r, i) => {
          const s = standings[r.rosterId] || { wins: 0, losses: 0, pf: 0 };
          return `<div class="cp-st-row"><span class="cp-st-rank">${i + 1}</span><span class="cp-st-name">${_esc(r.name)}</span><span class="cp-st-rec">${s.wins}–${s.losses}</span><span class="cp-st-pf">${s.pf.toFixed(1)}</span></div>`;
        }).join("")}
      </div>`;
  }

  // ── Seed rows ─────────────────────────────────────────
  function _buildSeedRows(modal, seeds) {
    const body = modal.querySelector("#cp-seeds-body");
    const opts = modal._opts || [];
    body.innerHTML = seeds.map((s, i) => _seedRowHTML(i, s?.rosterId || "", opts)).join("")
      + `<button class="btn-secondary btn-sm" style="margin-top:var(--space-2);width:100%"
           onclick="DLRCustomPlayoffs._addSeedRow()">+ Add Team</button>`;
  }
  function _seedRowHTML(i, rosterId, opts) {
    const o = opts || (document.getElementById("cp-config-modal")?._opts || []);
    return `<div class="cp-seed-row">
      <span class="cp-seed-num">#${i + 1}</span>
      <select class="cp-seed-select">
        <option value="">— Select team —</option>
        ${o.map(r => `<option value="${r.rosterId}" ${r.rosterId === String(rosterId) ? "selected" : ""}>${_esc(r.name)} (${r.rec})</option>`).join("")}
      </select>
      <button class="cp-row-remove" onclick="this.closest('.cp-seed-row').remove();DLRCustomPlayoffs._renumberSeeds()" title="Remove">✕</button>
    </div>`;
  }
  function _addSeedRow() {
    const modal = document.getElementById("cp-config-modal");
    const body  = modal?.querySelector("#cp-seeds-body");
    const opts  = modal?._opts || [];
    if (!body) return;
    const idx = body.querySelectorAll(".cp-seed-row").length;
    const div = document.createElement("div");
    div.innerHTML = _seedRowHTML(idx, "", opts);
    body.insertBefore(div.firstElementChild, body.querySelector(".btn-secondary"));
    _renumberSeeds();
  }
  function _renumberSeeds() {
    document.getElementById("cp-config-modal")
      ?.querySelectorAll("#cp-seeds-body .cp-seed-row")
      .forEach((row, i) => { const n = row.querySelector(".cp-seed-num"); if (n) n.textContent = `#${i + 1}`; });
  }

  // ── Round rows ────────────────────────────────────────
  function _buildRoundRows(modal, rounds) {
    const body = modal.querySelector("#cp-rounds-body");
    const init = rounds.length ? rounds : [{ startWeek: "", weeksPerRound: 1 }];
    body.innerHTML = init.map((r, ri) => _roundRowHTML(ri, r)).join("")
      + `<button class="btn-secondary btn-sm" style="margin-top:var(--space-2);width:100%"
           onclick="DLRCustomPlayoffs._addRound()">+ Add Round</button>`;
  }
  function _roundRowHTML(ri, r) {
    const lbl = r.label || `Round ${ri + 1}`;
    return `<div class="cp-round-card">
      <div class="cp-round-card-header">
        <input class="cp-round-label-input" type="text" value="${_esc(lbl)}" placeholder="Round name" />
        <button class="cp-row-remove" onclick="this.closest('.cp-round-card').remove();DLRCustomPlayoffs._renumberRounds()" title="Remove">✕</button>
      </div>
      <div class="cp-round-fields">
        <div class="cp-round-field">
          <label>Start Week</label>
          <input type="number" class="cp-round-start" min="1" max="22" value="${r.startWeek || ""}" placeholder="e.g. 14" />
        </div>
        <div class="cp-round-field">
          <label>Wks/Round</label>
          <input type="number" class="cp-round-wpr" min="1" max="4" value="${r.weeksPerRound || 1}" />
        </div>
      </div>
    </div>`;
  }
  function _addRound() {
    const modal = document.getElementById("cp-config-modal");
    const body  = modal?.querySelector("#cp-rounds-body");
    if (!body) return;
    const ri  = body.querySelectorAll(".cp-round-card").length;
    const div = document.createElement("div");
    div.innerHTML = _roundRowHTML(ri, {});
    body.insertBefore(div.firstElementChild, body.querySelector(".btn-secondary"));
    _renumberRounds();
  }
  function _renumberRounds() {
    document.getElementById("cp-config-modal")
      ?.querySelectorAll("#cp-rounds-body .cp-round-card")
      .forEach((card, i) => {
        const inp = card.querySelector(".cp-round-label-input");
        if (inp && /^Round \d+$/.test(inp.value)) inp.value = `Round ${i + 1}`;
      });
  }

  function closeConfig() {
    document.getElementById("cp-config-modal")?.classList.add("hidden");
  }

  async function saveConfig() {
    const modal   = document.getElementById("cp-config-modal");
    const saveBtn = modal?.querySelector("#cp-save-btn");
    if (!modal || !_leagueKey || !_username) return;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
    try {
      const seeds = [...modal.querySelectorAll("#cp-seeds-body .cp-seed-select")]
        .map(s => ({ rosterId: s.value })).filter(s => s.rosterId);
      if (seeds.length < 2) { showToast("Add at least 2 teams.", "error"); return; }
      const roundCards = [...modal.querySelectorAll("#cp-rounds-body .cp-round-card")];
      if (!roundCards.length) { showToast("Add at least one round.", "error"); return; }
      const rounds = roundCards.map((card, ri) => {
        const existing = (_config?.rounds || [])[ri] || {};
        return {
          label:         card.querySelector(".cp-round-label-input")?.value?.trim() || null,
          startWeek:     parseInt(card.querySelector(".cp-round-start")?.value) || null,
          weeksPerRound: parseInt(card.querySelector(".cp-round-wpr")?.value) || 1,
          matchups:      existing.matchups || [],
          byes:          existing.byes     || []
        };
      });
      const regSeasonEndWeek = parseInt(modal.querySelector("#cp-reg-week")?.value) || null;
      const newConfig = {
        seeds, rounds,
        ...(regSeasonEndWeek ? { regSeasonEndWeek } : {}),
        ...(_regStandings   ? { regStandings: _regStandings } : {})
      };
      await firebase.database()
        .ref(`gmd/users/${_username.toLowerCase()}/leagueMeta/${_leagueKey}`)
        .update({ customPlayoff: newConfig });
      _config = newConfig;
      if (typeof _onMetaSave === "function") _onMetaSave(_leagueKey, newConfig);
      closeConfig();
      showToast("Custom playoffs saved ✓");
      _scoreCache = {};
      const el = document.getElementById("dtab-customplayoffs");
      if (el) await _render(el);
    } catch(e) {
      showToast("Save failed: " + e.message, "error");
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
    }
  }

  function setMetaCallback(fn) { _onMetaSave = fn; }

  return {
    init, reset,
    openConfig, closeConfig, saveConfig,
    refreshScores, setMetaCallback,
    updateRegStandings, _syncSelects, _switchAssignRound,
    _addSeedRow, _renumberSeeds,
    _addRound, _renumberRounds,
    _addAssignTeam, _removeAssignTeam,
    _addAssignMatchup, _addAssignBye
  };

})();
