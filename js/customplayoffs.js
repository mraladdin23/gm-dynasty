// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Custom Playoffs  v3
//
//  Supports matchups with ANY number of teams per group.
//  A "matchup" is a group of N teams playing the same week;
//  top advanceCount teams advance to the next round.
//
//  Config shape (stored at leagueMeta.customPlayoff):
//  {
//    seeds: [{rosterId}],            // ordered qualifier list #1→N
//    rounds: [
//      {
//        label:         "Wild Card",
//        startWeek:     14,
//        weeksPerRound: 1,
//        matchups: [
//          { teams: [rosterId,...], advanceCount: 1 },
//          ...
//        ],
//        byes: [rosterId, ...]       // sit out this round
//      }, ...
//    ]
//  }
//
//  Bracket rendering uses the WC-style card layout. Card height
//  scales with team count. Scores auto-populate from Sleeper.
//  After a round completes, a "Set Next Round" panel appears
//  with dropdowns for assigning any number of teams per matchup.
// ─────────────────────────────────────────────────────────

const DLRCustomPlayoffs = (() => {

  // ── State ─────────────────────────────────────────────
  let _leagueKey  = null;
  let _leagueId   = null;
  let _season     = null;
  let _isCommish  = false;
  let _username   = null;
  let _config     = null;
  let _rosters    = [];
  let _users      = [];
  let _scoreCache    = {};
  let _onMetaSave    = null;
  let _regStandings  = null;  // { rosterId → { wins, losses, pf } } — computed from reg season weeks

  // ── Entry point ───────────────────────────────────────
  async function init(leagueKey, league, username, leagueMeta) {
    _leagueKey = leagueKey;
    _leagueId  = league.leagueId;
    _season    = league.season;
    _isCommish = !!league.isCommissioner;
    _username  = username;
    _config    = leagueMeta?.customPlayoff || null;
    _scoreCache = {};

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
    // Use computed reg-season standings if provided, else fall back to live roster settings
    if (standings && standings[String(rosterId)]) return standings[String(rosterId)];
    const r = (_rosters || []).find(r => String(r.roster_id) === String(rosterId));
    if (!r) return { wins: 0, losses: 0, pf: 0 };
    const pf = (r.settings?.fpts || 0) + (r.settings?.fpts_decimal || 0) / 100;
    return { wins: r.settings?.wins || 0, losses: r.settings?.losses || 0, pf };
  }
  function _seedOpts(standings) {
    // standings = { rosterId → { wins, losses, pf } } or null → use live roster settings
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

  // ── Card geometry ─────────────────────────────────────
  // Row height scales so N-team cards look proportional.
  const ROW_H  = 32;   // px per team row
  const DIV_H  = 1;    // divider between rows
  const PAD    = 8;    // top+bottom card padding
  const CARD_G = 14;   // gap between matchup cards in a column

  function _cardH(n) {
    return Math.max(n, 1) * ROW_H + Math.max(n - 1, 0) * DIV_H + PAD;
  }

  // Build absolute positions for all matchup cards.
  // Round 0: stack sequentially.
  // Round ri > 0: centre of card mi = mean centre of the cards from ri-1
  //   that feed into it (one per team slot, in order of cumulative advanceCounts).
  function _buildPositions(rounds, bracketData) {
    const positions = []; // positions[ri][mi] = { top, height, centre }

    for (let ri = 0; ri < rounds.length; ri++) {
      const matchups = bracketData[ri] || [];
      const row      = [];

      if (ri === 0) {
        let y = 0;
        for (let mi = 0; mi < matchups.length; mi++) {
          const h = _cardH(matchups[mi].teams.length);
          row.push({ top: y, height: h, centre: y + h / 2 });
          y += h + CARD_G;
        }
      } else {
        const prevPos   = positions[ri - 1] || [];
        const prevRound = bracketData[ri - 1] || [];

        // Expand prev centres: each prev matchup contributes advanceCount feed slots
        const feedCentres = [];
        for (let pmi = 0; pmi < prevRound.length; pmi++) {
          const adv = prevRound[pmi].advanceCount || 1;
          for (let k = 0; k < adv; k++) {
            feedCentres.push(prevPos[pmi]?.centre ?? 0);
          }
        }

        let feedIdx = 0;
        for (let mi = 0; mi < matchups.length; mi++) {
          const h     = _cardH(matchups[mi].teams.length);
          const slots = Math.max(matchups[mi].teams.length, 2);
          const feeds = feedCentres.slice(feedIdx, feedIdx + slots);
          feedIdx += slots;
          const centre = feeds.length
            ? feeds.reduce((s, c) => s + c, 0) / feeds.length
            : (row[mi - 1] ? row[mi - 1].centre + row[mi - 1].height / 2 + CARD_G + h / 2 : h / 2);
          row.push({ top: Math.round(centre - h / 2), height: h, centre });
        }
      }
      positions.push(row);
    }
    return positions;
  }

  // ── Build scored bracket data ─────────────────────────
  // bracketData[ri] = { matchups: [{teams:[{rosterId,name,score}], advanceCount}], byes:[{...}] }
  async function _buildBracket() {
    const rounds = _config.rounds || [];
    const result = [];

    for (let ri = 0; ri < rounds.length; ri++) {
      const round  = rounds[ri];
      const cfgMus = round.matchups || [];

      const matchups = await Promise.all(cfgMus.map(async mu => {
        const rawTeams = mu.teams || [];
        const teams = await Promise.all(rawTeams.map(async rid => ({
          rosterId: String(rid || ""),
          name:     _rosterName(rid),
          score:    rid ? await _scoreForRoster(rid, ri) : null
        })));
        // Sort by score descending when scores available; otherwise keep assignment order
        const hasScores = teams.some(t => t.score != null);
        if (hasScores) teams.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
        return { teams, advanceCount: mu.advanceCount || 1 };
      }));

      const byes = (round.byes || []).map(rid => ({
        rosterId: String(rid), name: _rosterName(rid)
      }));

      result.push({ matchups, byes });
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
    const positions   = _buildPositions(rounds, bracketData.map(r => r.matchups));

    const getRoundLabel = (ri) =>
      rounds[ri]?.label?.trim() ||
      (ri === nr - 1 ? "🏆 Championship" : ri === nr - 2 ? "Semifinals"
       : ri === nr - 3 ? "Quarterfinals" : `Round ${ri + 1}`);

    const getWeekTag = (ri) => {
      const r = rounds[ri];
      if (!r?.startWeek) return "";
      const wpr = r.weeksPerRound || 1;
      const lbl = wpr > 1 ? `Wks ${r.startWeek}–${r.startWeek + wpr - 1}` : `Wk ${r.startWeek}`;
      return `<span class="trn-wc-week-tag">${_esc(lbl)}</span>`;
    };

    // ── Build bracket columns ─────────────────────────
    const cols = bracketData.map((rnd, ri) => {
      const pos    = positions[ri] || [];
      const totalH = pos.length
        ? Math.max(...pos.map(p => p.top + p.height))
        : _cardH(2);

      const cards = rnd.matchups.map((mu, mi) => {
        const p        = pos[mi] || { top: 0, height: _cardH(mu.teams.length) };
        const hasScores = mu.teams.some(t => t.score != null);
        const adv      = mu.advanceCount || 1;

        // Connector line to sibling (same WC pattern: pairs connect)
        const hasSib  = (mi % 2 === 0 && mi + 1 < rnd.matchups.length) || mi % 2 === 1;
        const sibPos  = pos[mi % 2 === 0 ? mi + 1 : mi - 1];
        const gap     = (hasSib && sibPos) ? Math.abs(p.centre - sibPos.centre) : 0;
        const connCls = (ri < nr - 1 && hasSib)
          ? (mi % 2 === 0 ? "trn-wc-card--conn-top" : "trn-wc-card--conn-bot") : "";

        const rows = mu.teams.map((t, rank) => {
          const advancing  = hasScores && rank < adv;
          const eliminated = hasScores && rank >= adv;
          const cls  = advancing ? "cp-mu-team--adv" : eliminated ? "cp-mu-team--out" : "";
          const badge = advancing ? `<span class="cp-adv-badge">ADV</span>` : "";
          const scoreStr = t.score != null ? t.score.toFixed(2) : "";
          const rankNum  = hasScores ? `<span class="cp-mu-rank">${rank + 1}</span>` : "";
          return `<div class="cp-mu-team ${cls}">
            ${rankNum}
            <span class="cp-mu-name" title="${_esc(t.name)}">${_esc(t.name || "TBD")}</span>
            ${scoreStr ? `<span class="cp-mu-score">${scoreStr}</span>` : ""}
            ${badge}
          </div>`;
        }).join(`<div class="trn-wc-card-divider"></div>`);

        // "N advance" label in card footer
        const footer = mu.teams.length > 2
          ? `<div class="cp-mu-footer">Top ${adv} advance</div>` : "";

        return `<div class="trn-wc-card ${connCls}" style="position:absolute;top:${p.top}px;left:0;right:0;--wc-gap:${gap}px">
          ${rows}${footer}
        </div>`;
      }).join("");

      const byePills = rnd.byes.length
        ? `<div class="cp-bye-pills">${rnd.byes.map(b =>
            `<div class="cp-bye-pill">${_esc(b.name)} <span class="cp-bye-tag">BYE</span></div>`
          ).join("")}</div>` : "";

      return `<div class="trn-wc-col" data-ri="${ri}">
        <div class="trn-wc-col-header">${_esc(getRoundLabel(ri))} ${getWeekTag(ri)}</div>
        <div class="trn-wc-col-cards" style="position:relative;height:${totalH}px">${cards}</div>
        ${byePills}
      </div>`;
    }).join("");

    // Champion col — top team from last round's first matchup (after scoring)
    const lastRnd  = bracketData[nr - 1];
    const lastMu   = lastRnd?.matchups?.[0];
    const champName = (lastMu?.teams?.[0]?.score != null) ? lastMu.teams[0].name : "";

    const champCol = `<div class="trn-wc-col trn-wc-col--champ">
      <div class="trn-wc-col-header">🏆 Champion</div>
      <div class="trn-wc-col-cards" style="display:flex;align-items:center;min-height:${_cardH(1)}px">
        <div class="trn-wc-card trn-wc-card--champion">
          <div class="trn-wc-bteam trn-wc-bt--champ">
            <span class="trn-wc-bteam-name">${_esc(champName || "TBD")}</span>
          </div>
        </div>
      </div>
    </div>`;

    // Seed list — use reg-season standings if available
    const seedRows = (cfg.seeds || []).map((s, i) => {
      const rec = _rosterRecord(s.rosterId, _regStandings);
      const pfStr = rec.pf > 0 ? ` · ${rec.pf.toFixed(1)} pts` : "";
      return `<div class="trn-po-seed-row">
        <span class="trn-po-seed-num">#${i + 1}</span>
        <span class="trn-po-seed-name">${_esc(_rosterName(s.rosterId))}</span>
        <span class="trn-po-seed-record">${rec.wins}–${rec.losses}${pfStr}</span>
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
      <div class="trn-wc-bracket-wrap">
        <div class="trn-wc-bracket">${cols}${champCol}</div>
      </div>
      ${assignPanel}
      <div class="trn-po-seed-list" style="margin-top:var(--space-4)">${seedRows}</div>`;

    _wireAssignPanel();
  }

  // ── Assignment panel ──────────────────────────────────
  // Determines the "pool" of available teams for the target round:
  //   winners of the last fully-scored round + that round's byes
  // Then shows dropdowns to build matchup groups of any size.
  function _buildAssignPanel(bracketData) {
    const rounds = _config.rounds || [];
    const nr     = rounds.length;

    // Find the last round where every matchup has been fully scored
    let lastScoredRi = -1;
    for (let ri = 0; ri < nr; ri++) {
      const rnd = bracketData[ri];
      if (rnd.matchups.length > 0 &&
          rnd.matchups.every(mu => mu.teams.length > 0 && mu.teams.every(t => t.score != null))) {
        lastScoredRi = ri;
      }
    }

    // Show panel for the round after the last scored one
    // Also show panel for round 0 if it has no matchups yet (initial setup)
    let targetRi;
    if (lastScoredRi >= 0 && lastScoredRi < nr - 1) {
      targetRi = lastScoredRi + 1;
    } else if ((rounds[0]?.matchups || []).length === 0) {
      targetRi = 0;
    } else {
      return ""; // nothing to assign
    }

    // Build pool
    const pool = [];
    if (lastScoredRi >= 0) {
      // Winners from last scored round
      bracketData[lastScoredRi].matchups.forEach(mu => {
        const adv = mu.advanceCount || 1;
        mu.teams.slice(0, adv).forEach(t => { if (t.rosterId) pool.push(t.rosterId); });
      });
      // Byes from last scored round carry forward
      (bracketData[lastScoredRi].byes || []).forEach(b => { if (b.rosterId) pool.push(b.rosterId); });
    } else {
      // Round 0 — use all seeds
      ((_config.seeds || [])).forEach(s => { if (s.rosterId) pool.push(s.rosterId); });
    }
    if (!pool.length) return "";

    const getRN = (ri) =>
      rounds[ri]?.label?.trim() ||
      (ri === nr - 1 ? "🏆 Championship" : ri === nr - 2 ? "Semifinals"
       : ri === nr - 3 ? "Quarterfinals" : `Round ${ri + 1}`);

    // Current assignments for target round
    const cfgRound = rounds[targetRi] || {};
    const cfgMus   = cfgRound.matchups || [];
    const cfgByes  = cfgRound.byes    || [];

    // If no matchups assigned yet, default to one empty 2-team matchup
    const initMus = cfgMus.length ? cfgMus : [{ teams: [], advanceCount: 1 }];

    const poolSelOpts = (cur) =>
      `<option value="">— Select team —</option>` +
      pool.map(rid =>
        `<option value="${rid}" ${rid === cur ? "selected" : ""}>${_esc(_rosterName(rid))}</option>`
      ).join("");

    const matchupSlots = initMus.map((mu, mi) => {
      const advVal   = mu.advanceCount || 1;
      const teamSels = (mu.teams?.length ? mu.teams : ["", ""])
        .map((rid, ti) =>
          `<select class="cp-assign-sel" data-mi="${mi}" data-ti="${ti}">${poolSelOpts(rid)}</select>`
        ).join("");

      return `<div class="cp-assign-matchup" data-mi="${mi}">
        <div class="cp-assign-matchup-header">
          <span class="cp-assign-num">Matchup ${mi + 1}</span>
          <label class="cp-assign-adv-label">Advance:
            <input type="number" class="cp-assign-adv" data-mi="${mi}"
              min="1" max="${Math.max(mu.teams?.length || 2, 2)}" value="${advVal}" />
          </label>
          <button class="cp-row-remove" onclick="DLRCustomPlayoffs._removeAssignTeam(${mi})" title="Remove last team">− Team</button>
          <button class="btn-secondary btn-sm" onclick="DLRCustomPlayoffs._addAssignTeam(${mi})">+ Team</button>
          <button class="cp-row-remove" style="margin-left:auto" onclick="this.closest('.cp-assign-matchup').remove()" title="Remove matchup">✕</button>
        </div>
        <div class="cp-assign-teams" id="cp-assign-mu-${mi}">${teamSels}</div>
      </div>`;
    }).join("");

    const byeSelects = cfgByes.map((rid, bi) =>
      `<div class="cp-assign-bye-row">
        <select class="cp-bye-sel" data-bi="${bi}">${poolSelOpts(rid)}</select>
        <button class="cp-row-remove" onclick="this.parentElement.remove()" title="Remove bye">✕</button>
      </div>`
    ).join("");

    const prevLabel = lastScoredRi >= 0 ? `${_esc(getRN(lastScoredRi))} complete — ` : "";

    return `<div class="trn-section-card" style="margin-top:var(--space-4);max-width:680px" id="cp-assign-panel">
      <div class="trn-section-card-title">Set ${_esc(getRN(targetRi))} Matchups</div>
      <p style="font-size:.78rem;color:var(--color-text-dim);margin-bottom:var(--space-3)">
        ${prevLabel}${pool.length} teams available. Each matchup can include any number of teams.
        Set how many advance from each matchup using the Advance field.
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
      </div>
    </div>`;
  }

  function _wireAssignPanel() {
    document.getElementById("cp-assign-save")?.addEventListener("click", async function() {
      await _saveAssignments(parseInt(this.dataset.targetRi));
    });
    document.getElementById("cp-assign-clear")?.addEventListener("click", async function() {
      await _clearRound(parseInt(this.dataset.targetRi));
    });
  }

  // Dynamic panel controls exposed to inline onclick
  function _addAssignTeam(mi) {
    const container = document.getElementById(`cp-assign-mu-${mi}`);
    if (!container) return;
    const pool = _getAssignPool();
    const ti   = container.querySelectorAll(".cp-assign-sel").length;
    const sel  = document.createElement("select");
    sel.className = "cp-assign-sel";
    sel.dataset.mi = mi;
    sel.dataset.ti = ti;
    sel.innerHTML = `<option value="">— Select team —</option>` +
      pool.map(r => `<option value="${r}">${_esc(_rosterName(r))}</option>`).join("");
    container.appendChild(sel);
    const advInp = document.querySelector(`.cp-assign-adv[data-mi="${mi}"]`);
    if (advInp) advInp.max = ti + 1;
  }

  function _removeAssignTeam(mi) {
    const container = document.getElementById(`cp-assign-mu-${mi}`);
    if (!container) return;
    const sels = container.querySelectorAll(".cp-assign-sel");
    if (sels.length > 1) sels[sels.length - 1].remove();
  }

  function _addAssignMatchup() {
    const slots = document.getElementById("cp-assign-slots");
    if (!slots) return;
    const mi   = slots.querySelectorAll(".cp-assign-matchup").length;
    const pool = _getAssignPool();
    const opts = `<option value="">— Select team —</option>` +
      pool.map(r => `<option value="${r}">${_esc(_rosterName(r))}</option>`).join("");

    const div  = document.createElement("div");
    div.className = "cp-assign-matchup";
    div.dataset.mi = mi;
    div.innerHTML = `
      <div class="cp-assign-matchup-header">
        <span class="cp-assign-num">Matchup ${mi + 1}</span>
        <label class="cp-assign-adv-label">Advance:
          <input type="number" class="cp-assign-adv" data-mi="${mi}" min="1" max="2" value="1" />
        </label>
        <button class="cp-row-remove" onclick="DLRCustomPlayoffs._removeAssignTeam(${mi})" title="Remove last team">− Team</button>
        <button class="btn-secondary btn-sm" onclick="DLRCustomPlayoffs._addAssignTeam(${mi})">+ Team</button>
        <button class="cp-row-remove" style="margin-left:auto" onclick="this.closest('.cp-assign-matchup').remove()" title="Remove matchup">✕</button>
      </div>
      <div class="cp-assign-teams" id="cp-assign-mu-${mi}">
        <select class="cp-assign-sel" data-mi="${mi}" data-ti="0">${opts}</select>
        <select class="cp-assign-sel" data-mi="${mi}" data-ti="1">${opts}</select>
      </div>`;
    slots.insertBefore(div, slots.querySelector(".btn-secondary"));
  }

  function _addAssignBye() {
    const byesDiv = document.getElementById("cp-assign-byes");
    if (!byesDiv) return;
    const pool = _getAssignPool();
    const bi   = byesDiv.querySelectorAll(".cp-bye-sel").length;
    const div  = document.createElement("div");
    div.className = "cp-assign-bye-row";
    div.innerHTML = `
      <select class="cp-bye-sel" data-bi="${bi}">
        <option value="">— Select team —</option>
        ${pool.map(r => `<option value="${r}">${_esc(_rosterName(r))}</option>`).join("")}
      </select>
      <button class="cp-row-remove" onclick="this.parentElement.remove()" title="Remove bye">✕</button>`;
    byesDiv.appendChild(div);
  }

  // Derive available pool from the current config state (no live bracket needed)
  function _getAssignPool() {
    const rounds = _config?.rounds || [];
    const seeds  = (_config?.seeds || []).map(s => s.rosterId).filter(Boolean);
    if (!rounds.length) return seeds;
    // Find last round with matchups assigned
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

  // ── Save / clear assignments ───────────────────────────
  async function _saveAssignments(targetRi) {
    const btn = document.getElementById("cp-assign-save");
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    try {
      const slots = document.getElementById("cp-assign-slots");
      const matchups = [];
      slots?.querySelectorAll(".cp-assign-matchup").forEach(card => {
        const mi    = parseInt(card.dataset.mi);
        const adv   = parseInt(card.querySelector(".cp-assign-adv")?.value) || 1;
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
          <div class="cp-empty-sub">Define your qualifying teams and rounds. Each matchup can include any number of teams — 2-team head-to-head, 3-team pods, 4-team groups, anything you need.</div>
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

  // ── Config modal (seeds + round schedule only) ────────
  async function openConfig() {
    const modal = document.getElementById("cp-config-modal");
    if (!modal) return;
    const cfg = _config || {};

    // Populate reg season week input
    const regWkInp = modal.querySelector("#cp-reg-week");
    if (regWkInp) regWkInp.value = cfg.regSeasonEndWeek || "";

    // Use already-computed standings if available, else fall back to live
    const opts = _seedOpts(_regStandings);
    modal._opts = opts;
    modal._regStandings = _regStandings;

    const savedSeeds = cfg.seeds?.length ? cfg.seeds : opts.map(r => ({ rosterId: r.rosterId }));
    _buildSeedRows(modal, savedSeeds);
    _buildRoundRows(modal, cfg.rounds || []);
    modal.classList.remove("hidden");
  }

  // ── Reg-season standings computation ─────────────────
  // Fetches Sleeper matchup data for weeks 1→endWeek and computes
  // W/L/PF per roster from actual head-to-head results.
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
      // Fetch all weeks in parallel
      const weekPromises = [];
      for (let w = 1; w <= endWeek; w++) {
        weekPromises.push(
          fetch(`https://api.sleeper.app/v1/league/${_leagueId}/matchups/${w}`)
            .then(r => r.ok ? r.json() : []).catch(() => [])
        );
      }
      const allWeeks = await Promise.all(weekPromises);

      // Build standings: group by matchup_id per week, compare points
      const standings = {}; // rosterId → { wins, losses, pf }
      (_rosters || []).forEach(r => {
        standings[String(r.roster_id)] = { wins: 0, losses: 0, pf: 0 };
      });

      allWeeks.forEach(weekData => {
        if (!Array.isArray(weekData)) return;
        // Group by matchup_id
        const groups = {};
        weekData.forEach(entry => {
          const mid = entry.matchup_id;
          if (!mid) return;
          if (!groups[mid]) groups[mid] = [];
          groups[mid].push(entry);
        });
        Object.values(groups).forEach(group => {
          if (group.length !== 2) return; // skip byes / oddities
          const [a, b] = group;
          const aPts = a.points || 0, bPts = b.points || 0;
          const aId  = String(a.roster_id), bId = String(b.roster_id);
          if (standings[aId]) {
            standings[aId].pf += aPts;
            if (aPts > bPts) standings[aId].wins++;
            else if (bPts > aPts) standings[aId].losses++;
          }
          if (standings[bId]) {
            standings[bId].pf += bPts;
            if (bPts > aPts) standings[bId].wins++;
            else if (aPts > bPts) standings[bId].losses++;
          }
        });
      });

      // Round pf
      Object.values(standings).forEach(s => { s.pf = Math.round(s.pf * 100) / 100; });

      // Store globally and on modal
      _regStandings = standings;
      modal._regStandings = standings;

      // Re-build opts with new standings
      const opts = _seedOpts(standings);
      modal._opts = opts;

      // Rebuild seed rows preserving current selections
      const curSelections = [...(modal.querySelectorAll("#cp-seeds-body .cp-seed-select") || [])]
        .map(s => ({ rosterId: s.value })).filter(s => s.rosterId);
      const seeds = curSelections.length ? curSelections : opts.map(r => ({ rosterId: r.rosterId }));
      _buildSeedRows(modal, seeds);

      // Show standings preview
      _renderStandingsPreview(modal, standings, opts, endWeek);
      showToast(`Standings updated through Week ${endWeek} ✓`);

    } catch(e) {
      showToast("Failed to fetch standings: " + e.message, "error");
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
      // Insert after the reg-week row
      const regRow = modal.querySelector(".cp-reg-week-row");
      regRow?.insertAdjacentElement("afterend", preview);
    }
    preview.innerHTML = `
      <div class="cp-standings-preview-title">Standings through Week ${endWeek}</div>
      <div class="cp-standings-table">
        <div class="cp-st-header">
          <span class="cp-st-rank">#</span>
          <span class="cp-st-name">Team</span>
          <span class="cp-st-rec">W–L</span>
          <span class="cp-st-pf">PF</span>
        </div>
        ${opts.map((r, i) => {
          const s = standings[r.rosterId] || { wins: 0, losses: 0, pf: 0 };
          return `<div class="cp-st-row">
            <span class="cp-st-rank">${i + 1}</span>
            <span class="cp-st-name">${_esc(r.name)}</span>
            <span class="cp-st-rec">${s.wins}–${s.losses}</span>
            <span class="cp-st-pf">${s.pf.toFixed(1)}</span>
          </div>`;
        }).join("")}
      </div>`;
  }

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
          matchups:      existing.matchups || [],   // preserve existing assignments
          byes:          existing.byes     || []
        };
      });

      const regSeasonEndWeek = parseInt(modal.querySelector("#cp-reg-week")?.value) || null;
      const newConfig = { seeds, rounds, ...(regSeasonEndWeek ? { regSeasonEndWeek } : {}) };

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
    updateRegStandings,
    _addSeedRow, _renumberSeeds,
    _addRound, _renumberRounds,
    _addAssignTeam, _removeAssignTeam,
    _addAssignMatchup, _addAssignBye
  };

})();
