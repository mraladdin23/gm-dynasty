// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Custom Playoffs Module
//  Commissioner-configured bracket for individual leagues.
//  Scores auto-populated from Sleeper matchup API.
//  Config stored at gmd/users/{username}/leagueMeta/{leagueKey}
//  under the `customPlayoff` object.
// ─────────────────────────────────────────────────────────

const DLRCustomPlayoffs = (() => {

  // ── State ─────────────────────────────────────────────
  let _leagueKey    = null;
  let _leagueId     = null;
  let _season       = null;
  let _isCommish    = false;
  let _username     = null;
  let _config       = null;   // loaded from leagueMeta.customPlayoff
  let _rosters      = [];     // [{roster_id, owner_id, settings:{wins,losses,fpts}}]
  let _users        = [];     // [{user_id, display_name, metadata:{team_name}}]
  let _scoreCache   = {};     // "leagueId|week" → {rosterId: pts}

  // ── Public entry point ────────────────────────────────
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

    el.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Loading custom playoffs…</span></div>`;

    // No config yet — commish sees setup prompt, others see pending message
    if (!_config || !_config.bracketSize) {
      if (_isCommish) {
        el.innerHTML = `
          <div class="cp-empty">
            <div class="cp-empty-icon">🏆</div>
            <div class="cp-empty-title">Custom Playoffs Not Configured</div>
            <div class="cp-empty-sub">Set up your custom bracket to track playoffs outside of the platform's official bracket.</div>
            <button class="btn-primary" onclick="DLRCustomPlayoffs.openConfig()">⚙ Configure Custom Playoffs</button>
          </div>`;
      } else {
        el.innerHTML = `
          <div class="cp-empty">
            <div class="cp-empty-icon">🏆</div>
            <div class="cp-empty-title">Custom Playoffs</div>
            <div class="cp-empty-sub">Not yet configured by the commissioner.</div>
          </div>`;
      }
      return;
    }

    try {
      // Fetch rosters + users for team name resolution
      [_rosters, _users] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${_leagueId}/rosters`).then(r => r.json()).catch(() => []),
        fetch(`https://api.sleeper.app/v1/league/${_leagueId}/users`).then(r => r.json()).catch(() => [])
      ]);
      await _renderBracket(el);
    } catch(e) {
      el.innerHTML = `<div class="cp-error">⚠ Could not load custom playoffs: ${_esc(e.message)}</div>`;
    }
  }

  function reset() {
    _leagueKey = _leagueId = _season = _username = _config = null;
    _rosters = []; _users = []; _scoreCache = {};
  }

  // ── Team name helpers ─────────────────────────────────
  function _userMap() {
    const m = {};
    (_users || []).forEach(u => { m[u.user_id] = u.metadata?.team_name || u.display_name || u.username || `User ${u.user_id}`; });
    return m;
  }
  function _rosterName(rosterId) {
    const um = _userMap();
    const r  = (_rosters || []).find(r => String(r.roster_id) === String(rosterId));
    return r ? (um[r.owner_id] || `Team ${rosterId}`) : `Team ${rosterId}`;
  }
  function _rosterRecord(rosterId) {
    const r = (_rosters || []).find(r => String(r.roster_id) === String(rosterId));
    if (!r) return { wins: 0, losses: 0, pf: 0 };
    const fpts = (r.settings?.fpts || 0) + (r.settings?.fpts_decimal || 0) / 100;
    return { wins: r.settings?.wins || 0, losses: r.settings?.losses || 0, pf: fpts };
  }

  // ── Score fetching ─────────────────────────────────────
  async function _fetchWeek(week) {
    const key = `${_leagueId}|${week}`;
    if (_scoreCache[key]) return _scoreCache[key];
    try {
      const r = await fetch(`https://api.sleeper.app/v1/league/${_leagueId}/matchups/${week}`);
      if (!r.ok) return {};
      const data = await r.json();
      const map = {};
      (data || []).forEach(m => { if (m.roster_id) map[String(m.roster_id)] = m.points || 0; });
      _scoreCache[key] = map;
      return map;
    } catch(e) { return {}; }
  }

  async function _scoreForSlot(slot, ri) {
    // slot = { rosterId } from seeds/bracket
    // ri   = round index (0-based)
    const cfg    = _config;
    const rounds = cfg.rounds || [];
    const round  = rounds[ri] || {};
    const startWk = _roundStartWeek(ri);
    if (!startWk || !slot?.rosterId) return null;
    const wpr = round.weeksPerRound || 1;
    let total = 0, found = 0;
    for (let w = 0; w < wpr; w++) {
      const wkMap = await _fetchWeek(startWk + w);
      const pts   = wkMap[String(slot.rosterId)];
      if (pts != null) { total += pts; found++; }
    }
    return found > 0 ? total : null;
  }

  function _roundStartWeek(ri) {
    const cfg    = _config;
    const startWk = cfg.startWeek;
    if (!startWk) return null;
    let wk = startWk;
    for (let r = 0; r < ri; r++) {
      wk += (cfg.rounds?.[r]?.weeksPerRound || 1);
    }
    return wk;
  }

  function _weekLabel(ri) {
    const s = _roundStartWeek(ri);
    if (!s) return "";
    const wpr = _config.rounds?.[ri]?.weeksPerRound || 1;
    return wpr > 1 ? `Wks ${s}–${s + wpr - 1}` : `Wk ${s}`;
  }

  // ── Build bracket data ─────────────────────────────────
  // Returns bracket[ri] = [{slotA, slotB, scoreA, scoreB}]
  // where slot = {rosterId, name}
  async function _buildBracket() {
    const cfg     = _config;
    const seeds   = (cfg.seeds || []).slice(0, cfg.bracketSize || 8);
    const byeCount = cfg.byeCount || 0;
    const reseed   = !!cfg.reseed;
    const numRounds = Math.log2(cfg.bracketSize || 8);

    const _slot = (rid) => ({ rosterId: String(rid), name: _rosterName(rid) });

    // Round 0 — high-seed vs low-seed, byes advance
    const byes    = seeds.slice(0, byeCount).map(s => _slot(s.rosterId));
    const players = seeds.slice(byeCount).map(s => _slot(s.rosterId));
    const r0matchups = [];
    for (let i = 0; i < Math.floor(players.length / 2); i++) {
      r0matchups.push({ slotA: players[i], slotB: players[players.length - 1 - i] });
    }

    // Fetch round 0 scores
    const r0 = await Promise.all(r0matchups.map(async m => {
      const sA = await _scoreForSlot(m.slotA, 0);
      const sB = await _scoreForSlot(m.slotB, 0);
      return { slotA: m.slotA, slotB: m.slotB, scoreA: sA, scoreB: sB };
    }));

    const bracket = [r0];

    // Advance survivors
    let survivors = [...byes];
    r0.forEach(m => {
      const winner = (m.scoreA != null && m.scoreB != null)
        ? (m.scoreA >= m.scoreB ? m.slotA : m.slotB) : null;
      if (winner) survivors.push(winner);
    });

    // Subsequent rounds
    for (let ri = 1; ri < numRounds; ri++) {
      const pool = reseed
        ? [...survivors].sort((a, b) => {
            const ra = _rosterRecord(a.rosterId), rb = _rosterRecord(b.rosterId);
            return (rb.wins - ra.wins) || (rb.pf - ra.pf);
          })
        : survivors;

      const matchups = [];
      for (let i = 0; i < Math.floor(pool.length / 2); i++) {
        matchups.push({ slotA: pool[i], slotB: pool[pool.length - 1 - i] });
      }

      const rnd = await Promise.all(matchups.map(async m => {
        const sA = await _scoreForSlot(m.slotA, ri);
        const sB = await _scoreForSlot(m.slotB, ri);
        return { slotA: m.slotA, slotB: m.slotB, scoreA: sA, scoreB: sB };
      }));

      bracket.push(rnd);

      survivors = [];
      rnd.forEach(m => {
        const winner = (m.scoreA != null && m.scoreB != null)
          ? (m.scoreA >= m.scoreB ? m.slotA : m.slotB) : null;
        if (winner) survivors.push(winner);
      });
    }

    return bracket;
  }

  // ── Render bracket using WC tight canvas math ──────────
  async function _renderBracket(el) {
    el.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Fetching scores…</span></div>`;

    const cfg       = _config;
    const bracket   = await _buildBracket();
    const nr        = bracket.length;
    const bracketSize = cfg.bracketSize || 8;
    const byeCount   = cfg.byeCount || 0;
    const reseed     = !!cfg.reseed;
    const seeds      = (cfg.seeds || []).slice(0, bracketSize);

    const getRoundName = (ri, tot) =>
      ri === tot - 1 ? "🏆 Championship"
      : ri === tot - 2 ? "Semifinals"
      : ri === tot - 3 ? "Quarterfinals"
      : `Round ${ri + 1}`;

    // ── Canvas math (exact same as tournament.js _renderBracket) ──
    const cardH  = 44;
    const pairG  = 8;
    const centreR0 = (mi) => Math.floor(mi / 2) * (2 * cardH + 3 * pairG) + (mi % 2) * (cardH + pairG) + cardH / 2;
    const centreOf = (ri, mi) => ri === 0 ? centreR0(mi) : (centreOf(ri - 1, 2 * mi) + centreOf(ri - 1, 2 * mi + 1)) / 2;
    const topOf    = (ri, mi) => Math.round(centreOf(ri, mi) - cardH / 2);
    const colH     = (ri, n)  => n === 0 ? cardH : topOf(ri, n - 1) + cardH;
    const connGap  = (ri, mi) => {
      const sib = mi % 2 === 0 ? mi + 1 : mi - 1;
      return Math.abs(centreOf(ri, mi) - centreOf(ri, sib));
    };

    const cols = bracket.map((rnd, ri) => {
      const n      = rnd.length;
      const totalH = colH(ri, n);
      const wkLbl  = _weekLabel(ri);
      const cards  = rnd.map((m, mi) => {
        const hasA = m.scoreA != null, hasB = m.scoreB != null;
        const winA = hasA && hasB && m.scoreA > m.scoreB;
        const winB = hasA && hasB && m.scoreB > m.scoreA;
        const tRow = (slot, score, isWin, isLoss) => {
          if (!slot) return `<div class="trn-wc-bteam trn-wc-bt--tbd"><span class="trn-wc-bteam-name">TBD</span></div>`;
          const cls = isWin ? "trn-wc-bt--win" : isLoss ? "trn-wc-bt--loss" : "";
          return `<div class="trn-wc-bteam ${cls}">
            <span class="trn-wc-bteam-name" title="${_esc(slot.name)}">${_esc(slot.name)}</span>
            ${(hasA && hasB) ? `<span class="trn-wc-bteam-score">${(score || 0).toFixed(1)}</span>` : ""}
          </div>`;
        };
        const top        = topOf(ri, mi);
        const hasSib     = (mi % 2 === 0 && mi + 1 < n) || mi % 2 === 1;
        const gap        = hasSib ? connGap(ri, mi) : 0;
        const isTop      = mi % 2 === 0;
        const connCls    = (ri < nr - 1 && hasSib) ? (isTop ? "trn-wc-card--conn-top" : "trn-wc-card--conn-bot") : "";
        return `<div class="trn-wc-card ${connCls}" style="position:absolute;top:${top}px;left:0;right:0;--wc-gap:${gap}px">
          ${tRow(m.slotA, m.scoreA, winA, winB)}
          <div class="trn-wc-card-divider"></div>
          ${tRow(m.slotB, m.scoreB, winB, winA)}
        </div>`;
      }).join("");

      return `<div class="trn-wc-col" data-ri="${ri}">
        <div class="trn-wc-col-header">${getRoundName(ri, nr)}${wkLbl ? ` <span class="trn-wc-week-tag">${_esc(wkLbl)}</span>` : ""}</div>
        <div class="trn-wc-col-cards" style="position:relative;height:${totalH}px">${cards}</div>
      </div>`;
    }).join("");

    // Champion col
    const finalMatch = bracket[nr - 1]?.[0] || {};
    const champName  = (finalMatch.scoreA != null && finalMatch.scoreB != null)
      ? (finalMatch.scoreA >= finalMatch.scoreB ? finalMatch.slotA?.name : finalMatch.slotB?.name) : "";
    const champCol = `<div class="trn-wc-col trn-wc-col--champ">
      <div class="trn-wc-col-header">🏆 Champion</div>
      <div class="trn-wc-col-cards" style="display:flex;align-items:center;height:100%">
        <div class="trn-wc-card trn-wc-card--champion">
          <div class="trn-wc-bteam trn-wc-bt--champ">
            <span class="trn-wc-bteam-name">${_esc(champName || "TBD")}</span>
          </div>
        </div>
      </div>
    </div>`;

    // Note bar
    const wprArr  = (cfg.rounds || []).map(r => r.weeksPerRound || 1);
    const allSame = wprArr.length > 0 && wprArr.every(w => w === wprArr[0]);
    const wprNote = wprArr.length === 0 ? "" : allSame
      ? (wprArr[0] > 1 ? ` · ${wprArr[0]} wks/round` : "")
      : ` · ${wprArr.join("-")} wks/round`;
    const note = `<div class="trn-po-bracket-note">
      ${bracketSize}-team bracket
      ${byeCount > 0 ? ` · ${byeCount} first-round bye${byeCount !== 1 ? "s" : ""}` : ""}
      · Seeded by ${cfg.seedingMethod === "pf" ? "Points For" : cfg.seedingMethod === "manual" ? "Manual" : "Record"}
      ${wprNote}
      ${reseed ? " · Reseeds each round" : ""}
    </div>`;

    // Seed list
    const seedList = `<div class="trn-po-seed-list">
      <div class="trn-po-section-title" style="font-size:.75rem;font-weight:700;color:var(--color-text-dim);margin-bottom:var(--space-2)">Seedings${reseed ? " (initial)" : ""}</div>
      ${seeds.map((s, i) => {
        const rec = _rosterRecord(s.rosterId);
        return `<div class="trn-po-seed-row${i < byeCount ? " trn-po-seed-row--bye" : ""}">
          <span class="trn-po-seed-num">#${i + 1}</span>
          <span class="trn-po-seed-name">${_esc(_rosterName(s.rosterId))}</span>
          <span class="trn-po-seed-record">${rec.wins}–${rec.losses}</span>
          <span class="trn-po-seed-pf">${rec.pf.toFixed(1)} pts</span>
          ${i < byeCount ? `<span class="trn-po-badge trn-po-badge--bye">BYE</span>` : ""}
        </div>`;
      }).join("")}
    </div>`;

    const commishBar = _isCommish ? `
      <div class="cp-commish-bar">
        <button class="btn-secondary btn-sm" onclick="DLRCustomPlayoffs.openConfig()">⚙ Edit Config</button>
        <button class="btn-secondary btn-sm" onclick="DLRCustomPlayoffs.refreshScores()">↺ Refresh Scores</button>
      </div>` : "";

    el.innerHTML = `
      ${commishBar}
      ${note}
      <div class="trn-wc-bracket-wrap">
        <div class="trn-wc-bracket">${cols}${champCol}</div>
      </div>
      ${seedList}
    `;
  }

  async function refreshScores() {
    _scoreCache = {};
    const el = document.getElementById("dtab-customplayoffs");
    if (!el) return;
    await _renderBracket(el);
  }

  // ── Config modal ──────────────────────────────────────
  function openConfig() {
    if (!_leagueKey) return;
    const cfg     = _config || {};
    const rosters = _rosters || [];
    const um      = _userMap();

    // Build roster options sorted by current record
    const sorted = [...rosters].sort((a, b) => {
      const wa = a.settings?.wins || 0, wb = b.settings?.wins || 0;
      const fa = (a.settings?.fpts || 0) + (a.settings?.fpts_decimal || 0) / 100;
      const fb = (b.settings?.fpts || 0) + (b.settings?.fpts_decimal || 0) / 100;
      return wb - wa || fb - fa;
    });

    const rosterOpts = sorted.map(r => {
      const name = um[r.owner_id] || `Team ${r.roster_id}`;
      const rec  = `${r.settings?.wins || 0}-${r.settings?.losses || 0}`;
      return { rosterId: String(r.roster_id), name, rec };
    });

    const bracketSize = cfg.bracketSize || 8;
    const byeCount    = cfg.byeCount    || 0;
    const numRounds   = Math.log2(bracketSize);
    const seedMethod  = cfg.seedingMethod || "record";
    const startWeek   = cfg.startWeek || "";
    const reseed      = !!cfg.reseed;
    const existSeeds  = cfg.seeds || [];

    // Build seed slots (auto-fill from record order if no manual seeds yet)
    const autoSeeds = rosterOpts.slice(0, bracketSize).map(r => r.rosterId);
    const seedSlots = Array.from({ length: bracketSize }, (_, i) => {
      const saved = existSeeds[i];
      return saved?.rosterId || autoSeeds[i] || "";
    });

    // Round config rows
    const rounds = cfg.rounds || Array.from({ length: numRounds }, (_, i) => ({
      weeksPerRound: 1,
      startWeek: startWeek ? (Number(startWeek) + i) : ""
    }));

    const rosterSelect = (selectedId) =>
      `<select class="cp-seed-select">
        <option value="">— Select team —</option>
        ${rosterOpts.map(r => `<option value="${r.rosterId}" ${String(r.rosterId) === String(selectedId) ? "selected" : ""}>${_esc(r.name)} (${r.rec})</option>`).join("")}
      </select>`;

    const roundRows = Array.from({ length: numRounds }, (_, ri) => {
      const r   = rounds[ri] || {};
      const lbl = ri === numRounds - 1 ? "🏆 Championship" : ri === numRounds - 2 ? "Semifinals" : ri === numRounds - 3 ? "Quarterfinals" : `Round ${ri + 1}`;
      return `<div class="cp-round-row">
        <span class="cp-round-lbl">${lbl}</span>
        <label style="font-size:.78rem;color:var(--color-text-dim)">Start week</label>
        <input type="number" class="cp-round-start" min="1" max="22" value="${r.startWeek || ""}" placeholder="Wk" style="width:52px" />
        <label style="font-size:.78rem;color:var(--color-text-dim)">Weeks/round</label>
        <input type="number" class="cp-round-wpr" min="1" max="4" value="${r.weeksPerRound || 1}" style="width:44px" />
      </div>`;
    }).join("");

    const seedRows = seedSlots.map((rid, i) =>
      `<div class="cp-seed-row">
        <span class="cp-seed-num">${i < byeCount ? `#${i + 1} <span class="trn-po-badge trn-po-badge--bye">BYE</span>` : `#${i + 1}`}</span>
        ${rosterSelect(rid)}
      </div>`
    ).join("");

    const modal = document.getElementById("cp-config-modal");
    if (!modal) return;

    modal.querySelector("#cp-bracket-size").value  = bracketSize;
    modal.querySelector("#cp-bye-count").value     = byeCount;
    modal.querySelector("#cp-seed-method").value   = seedMethod;
    modal.querySelector("#cp-reseed").checked      = reseed;
    modal.querySelector("#cp-rounds-body").innerHTML = roundRows;
    modal.querySelector("#cp-seeds-body").innerHTML  = seedRows;

    // Wire bracket size change to rebuild seed slots
    modal.querySelector("#cp-bracket-size").onchange = function() { _rebuildConfigSeeds(modal); };
    modal.querySelector("#cp-bye-count").onchange    = function() { _rebuildByeBadges(modal); };

    modal.classList.remove("hidden");
  }

  function _rebuildByeBadges(modal) {
    const bc = parseInt(modal.querySelector("#cp-bye-count").value) || 0;
    modal.querySelectorAll(".cp-seed-num").forEach((el, i) => {
      el.innerHTML = i < bc
        ? `#${i + 1} <span class="trn-po-badge trn-po-badge--bye">BYE</span>`
        : `#${i + 1}`;
    });
  }

  function _rebuildConfigSeeds(modal) {
    const bs      = parseInt(modal.querySelector("#cp-bracket-size").value) || 8;
    const bc      = parseInt(modal.querySelector("#cp-bye-count").value) || 0;
    const rosters = _rosters || [];
    const um      = _userMap();
    const sorted  = [...rosters].sort((a, b) => {
      const wa = a.settings?.wins || 0, wb = b.settings?.wins || 0;
      return wb - wa || ((b.settings?.fpts || 0) - (a.settings?.fpts || 0));
    });
    const opts = sorted.map(r => {
      const name = um[r.owner_id] || `Team ${r.roster_id}`;
      const rec  = `${r.settings?.wins || 0}-${r.settings?.losses || 0}`;
      return { rosterId: String(r.roster_id), name, rec };
    });

    // Preserve any already-selected values
    const existing = [...modal.querySelectorAll(".cp-seed-select")].map(s => s.value);

    modal.querySelector("#cp-seeds-body").innerHTML = Array.from({ length: bs }, (_, i) => {
      const selId = existing[i] || opts[i]?.rosterId || "";
      const isBye = i < bc;
      return `<div class="cp-seed-row">
        <span class="cp-seed-num">${isBye ? `#${i + 1} <span class="trn-po-badge trn-po-badge--bye">BYE</span>` : `#${i + 1}`}</span>
        <select class="cp-seed-select">
          <option value="">— Select team —</option>
          ${opts.map(r => `<option value="${r.rosterId}" ${r.rosterId === selId ? "selected" : ""}>${_esc(r.name)} (${r.rec})</option>`).join("")}
        </select>
      </div>`;
    }).join("");

    // Rebuild round rows
    const nr = Math.log2(bs);
    const existRounds = [...modal.querySelectorAll(".cp-round-row")];
    const roundVals = existRounds.map(row => ({
      startWeek: row.querySelector(".cp-round-start")?.value || "",
      weeksPerRound: row.querySelector(".cp-round-wpr")?.value || "1"
    }));
    modal.querySelector("#cp-rounds-body").innerHTML = Array.from({ length: nr }, (_, ri) => {
      const rv  = roundVals[ri] || {};
      const lbl = ri === nr - 1 ? "🏆 Championship" : ri === nr - 2 ? "Semifinals" : ri === nr - 3 ? "Quarterfinals" : `Round ${ri + 1}`;
      return `<div class="cp-round-row">
        <span class="cp-round-lbl">${lbl}</span>
        <label style="font-size:.78rem;color:var(--color-text-dim)">Start week</label>
        <input type="number" class="cp-round-start" min="1" max="22" value="${rv.startWeek || ""}" placeholder="Wk" style="width:52px" />
        <label style="font-size:.78rem;color:var(--color-text-dim)">Weeks/round</label>
        <input type="number" class="cp-round-wpr" min="1" max="4" value="${rv.weeksPerRound || 1}" style="width:44px" />
      </div>`;
    }).join("");
  }

  function closeConfig() {
    document.getElementById("cp-config-modal")?.classList.add("hidden");
  }

  async function saveConfig() {
    const modal = document.getElementById("cp-config-modal");
    if (!modal || !_leagueKey || !_username) return;

    const saveBtn = modal.querySelector("#cp-save-btn");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }

    try {
      const bracketSize  = parseInt(modal.querySelector("#cp-bracket-size").value) || 8;
      const byeCount     = parseInt(modal.querySelector("#cp-bye-count").value) || 0;
      const seedingMethod = modal.querySelector("#cp-seed-method").value || "record";
      const reseed       = modal.querySelector("#cp-reseed").checked;

      // Collect round configs
      const roundEls = [...modal.querySelectorAll(".cp-round-row")];
      const rounds = roundEls.map(row => ({
        startWeek:    parseInt(row.querySelector(".cp-round-start")?.value) || null,
        weeksPerRound: parseInt(row.querySelector(".cp-round-wpr")?.value) || 1
      }));

      // Derive global startWeek from round 0
      const startWeek = rounds[0]?.startWeek || null;

      // Collect seeds
      const seedEls = [...modal.querySelectorAll(".cp-seed-select")];
      const seeds = seedEls.map(sel => ({
        rosterId: sel.value || null
      })).filter(s => s.rosterId);

      if (seeds.length < 2) {
        showToast("Select at least 2 teams for the bracket.", "error");
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
        return;
      }

      const newConfig = {
        enabled: true,
        bracketSize,
        byeCount,
        seedingMethod,
        reseed,
        startWeek,
        rounds,
        seeds
      };

      // Save to Firebase via leagueMeta
      await GMDB.saveLeagueMetaEntry(_username, _leagueKey, {
        ...(await _loadCurrentMeta()),
        customPlayoff: newConfig,
        isCommissioner: true,
        _leagueId: _leagueId
      });

      _config = newConfig;
      _scoreCache = {};
      closeConfig();
      showToast("Custom playoffs saved ✓");

      // Re-render
      const el = document.getElementById("dtab-customplayoffs");
      if (el) await _renderBracket(el);

    } catch(e) {
      showToast("Save failed: " + e.message, "error");
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
    }
  }

  async function _loadCurrentMeta() {
    try {
      const snap = await firebase.database()
        .ref(`gmd/users/${_username.toLowerCase()}/leagueMeta/${_leagueKey}`)
        .once("value");
      return snap.val() || {};
    } catch(e) { return {}; }
  }

  // ── Helpers ───────────────────────────────────────────
  function _esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  return {
    init,
    reset,
    openConfig,
    closeConfig,
    saveConfig,
    refreshScores
  };

})();
