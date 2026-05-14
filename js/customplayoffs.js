// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Custom Playoffs Module  v2
//  Fully flexible bracket: any team count, any round count,
//  per-round byes, scores auto-populated from Sleeper API.
//
//  Config shape (stored at leagueMeta.customPlayoff):
//  {
//    enabled: true,
//    reseed: false,
//    seedingMethod: "record"|"pf"|"manual",
//    seeds: [{rosterId}],          // ordered 1→N
//    rounds: [
//      {
//        label: "Round 1",         // display name (optional)
//        startWeek: 14,            // NFL week this round begins
//        weeksPerRound: 1,
//        playingSeeds: [9,10,11,12], // 1-based seed numbers that PLAY
//                                    // all other seeds in the bracket get a BYE
//        advanceCount: null,        // winners advancing (null = half of playing)
//      }, ...
//    ]
//  }
//
//  How the bracket builds:
//    Pool starts as all seeds in seed order.
//    Each round:
//      - playingSeeds (1-based indices into CURRENT pool) play head-to-head
//      - all others in pool get a bye into next round's pool
//      - winners advance; new pool = byes + winners (reseeded if reseed=true)
// ─────────────────────────────────────────────────────────

const DLRCustomPlayoffs = (() => {

  // ── Module state ──────────────────────────────────────
  let _leagueKey  = null;
  let _leagueId   = null;
  let _season     = null;
  let _isCommish  = false;
  let _username   = null;
  let _config     = null;
  let _rosters    = [];
  let _users      = [];
  let _scoreCache = {};
  let _leagueSize = 0;

  // ── Public entry point ────────────────────────────────
  async function init(leagueKey, league, username, leagueMeta) {
    _leagueKey  = leagueKey;
    _leagueId   = league.leagueId;
    _season     = league.season;
    _isCommish  = !!league.isCommissioner;
    _username   = username;
    _config     = leagueMeta?.customPlayoff || null;
    _scoreCache = {};

    const el = document.getElementById("dtab-customplayoffs");
    if (!el) return;

    el.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Loading…</span></div>`;

    // Always fetch rosters+users upfront — needed for config modal team dropdowns
    try {
      [_rosters, _users] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${_leagueId}/rosters`).then(r => r.json()).catch(() => []),
        fetch(`https://api.sleeper.app/v1/league/${_leagueId}/users`).then(r => r.json()).catch(() => [])
      ]);
      _leagueSize = (_rosters || []).length;
    } catch(e) {
      _rosters = []; _users = []; _leagueSize = 0;
    }

    if (!_config?.rounds?.length) {
      _renderEmpty(el);
      return;
    }

    try {
      await _renderBracket(el);
    } catch(e) {
      el.innerHTML = `<div class="cp-error">⚠ Could not render bracket: ${_esc(e.message)}</div>`;
    }
  }

  function reset() {
    _leagueKey = _leagueId = _season = _username = _config = null;
    _rosters = []; _users = []; _scoreCache = {}; _leagueSize = 0;
  }

  function _renderEmpty(el) {
    if (_isCommish) {
      el.innerHTML = `
        <div class="cp-empty">
          <div class="cp-empty-icon">🏆</div>
          <div class="cp-empty-title">Custom Playoffs Not Configured</div>
          <div class="cp-empty-sub">Build a completely custom bracket — any number of teams, rounds, and byes. Define exactly which seeds play each round.</div>
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
  }

  // ── Team helpers ──────────────────────────────────────
  function _userMap() {
    const m = {};
    (_users || []).forEach(u => {
      m[u.user_id] = u.metadata?.team_name || u.display_name || u.username || `User ${u.user_id}`;
    });
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
    const pf = (r.settings?.fpts || 0) + (r.settings?.fpts_decimal || 0) / 100;
    return { wins: r.settings?.wins || 0, losses: r.settings?.losses || 0, pf };
  }
  function _sortPool(pool) {
    return [...pool].sort((a, b) => {
      const ra = _rosterRecord(a.rosterId), rb = _rosterRecord(b.rosterId);
      return (rb.wins - ra.wins) || (rb.pf - ra.pf);
    });
  }
  function _rosterOpts() {
    const um = _userMap();
    return [...(_rosters || [])].sort((a, b) => {
      const wa = a.settings?.wins || 0, wb = b.settings?.wins || 0;
      return wb - wa || (b.settings?.fpts || 0) - (a.settings?.fpts || 0);
    }).map(r => ({
      rosterId: String(r.roster_id),
      name: um[r.owner_id] || `Team ${r.roster_id}`,
      rec: `${r.settings?.wins || 0}-${r.settings?.losses || 0}`
    }));
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
    const round   = _config.rounds[roundIdx] || {};
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

  // ── Build bracket ─────────────────────────────────────
  // Returns: array of round objects { matchups[], byes[] }
  async function _buildBracket() {
    const cfg     = _config;
    const rounds  = cfg.rounds || [];
    const reseed  = !!cfg.reseed;

    const allSeeds = (cfg.seeds || []).map(s => ({
      rosterId: String(s.rosterId),
      name: _rosterName(s.rosterId)
    }));

    const result = [];
    let pool = [...allSeeds]; // active pool, ordered by current seeding

    for (let ri = 0; ri < rounds.length; ri++) {
      const round      = rounds[ri];
      const playSeeds  = (round.playingSeeds || []).map(n => parseInt(n)).filter(n => !isNaN(n) && n > 0);
      const activePool = (reseed && ri > 0) ? _sortPool(pool) : pool;

      // Resolve playing slots — playSeeds are 1-based positions in the current pool
      let playing, byes;
      if (playSeeds.length > 0) {
        const playSet = new Set(playSeeds.map(s => s - 1)); // 0-based
        playing = activePool.filter((_, i) => playSet.has(i));
        byes    = activePool.filter((_, i) => !playSet.has(i));
      } else {
        // No explicit seeds — everyone plays
        playing = [...activePool];
        byes    = [];
      }

      // Pair: 1st vs last, 2nd vs 2nd-last, etc.
      const matchups = [];
      const half = Math.floor(playing.length / 2);
      for (let i = 0; i < half; i++) {
        const slotA  = playing[i];
        const slotB  = playing[playing.length - 1 - i];
        const scoreA = await _scoreForRoster(slotA?.rosterId, ri);
        const scoreB = await _scoreForRoster(slotB?.rosterId, ri);
        matchups.push({ slotA, slotB, scoreA, scoreB });
      }
      // Odd team out gets a bye too
      if (playing.length % 2 === 1) byes.push(playing[half]);

      result.push({ matchups, byes });

      // Build next pool: byes first (they maintain position), then winners
      const winners = matchups.map(m => {
        if (m.scoreA == null || m.scoreB == null) return null;
        return m.scoreA >= m.scoreB ? m.slotA : m.slotB;
      }).filter(Boolean);

      const advCount = round.advanceCount ?? winners.length;
      const advancing = winners.slice(0, advCount);
      const nextPool  = [...byes, ...advancing];
      pool = reseed ? _sortPool(nextPool) : nextPool;
    }

    return result;
  }

  // ── Render bracket ────────────────────────────────────
  async function _renderBracket(el) {
    el.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Fetching scores…</span></div>`;

    const cfg    = _config;
    const rounds = cfg.rounds || [];
    const nr     = rounds.length;
    const bracket = await _buildBracket();

    const getRoundLabel = (ri) => rounds[ri]?.label?.trim() ||
      (ri === nr - 1 ? "🏆 Championship" : ri === nr - 2 ? "Semifinals" : ri === nr - 3 ? "Quarterfinals" : `Round ${ri + 1}`);

    // ── Canvas math ──
    // We compute absolute centre Y for each matchup in each round.
    // Round 0: each matchup pair stacks sequentially.
    // Later rounds: centre = midpoint between centres of the two feeding matchups.
    // With byes the feed is not always clean binary, so we use:
    //   round ri matchup mi centre = average of feeding matchup centres from ri-1
    // For simplicity without full tree tracking, we use spacing proportional to
    // round 0 layout, scaled by 2^ri gaps.

    const cardH = 44;
    const pairG = 8;
    const unit  = cardH + pairG; // base spacing unit

    // Compute centres for all matchups across rounds
    const centres = []; // centres[ri][mi] = Y centre pixels

    for (let ri = 0; ri < nr; ri++) {
      const n = bracket[ri]?.matchups?.length || 0;
      if (ri === 0) {
        // Stack matchups sequentially in pairs
        const row = [];
        for (let mi = 0; mi < n; mi++) {
          // Each pair shares vertical space of (2*cardH + 3*pairG)
          const pairIdx = Math.floor(mi / 2);
          const inPair  = mi % 2;
          row.push(pairIdx * (2 * cardH + 3 * pairG) + inPair * (cardH + pairG) + cardH / 2);
        }
        centres.push(row);
      } else {
        const prevCentres = centres[ri - 1] || [];
        const row = [];
        for (let mi = 0; mi < n; mi++) {
          // Each matchup in ri feeds from 2 matchups in ri-1
          const feedA = prevCentres[mi * 2]     ?? prevCentres[0] ?? cardH / 2;
          const feedB = prevCentres[mi * 2 + 1] ?? feedA;
          row.push((feedA + feedB) / 2);
        }
        centres.push(row);
      }
    }

    // Build HTML
    const cols = bracket.map((rnd, ri) => {
      const n      = rnd.matchups.length;
      const cRow   = centres[ri] || [];
      const maxC   = Math.max(...cRow, cardH / 2);
      const totalH = Math.round(maxC + cardH / 2);
      const wkLbl  = _weekLabel(ri);

      const cards = rnd.matchups.map((m, mi) => {
        const hasA = m.scoreA != null, hasB = m.scoreB != null;
        const hasScores = hasA && hasB;
        const winA = hasScores && m.scoreA > m.scoreB;
        const winB = hasScores && m.scoreB > m.scoreA;
        const top  = Math.round((cRow[mi] ?? 0) - cardH / 2);

        // Connector to sibling
        const hasSib  = (mi % 2 === 0 && mi + 1 < n) || mi % 2 === 1;
        const sibC    = cRow[mi % 2 === 0 ? mi + 1 : mi - 1] ?? 0;
        const gap     = hasSib ? Math.abs((cRow[mi] ?? 0) - sibC) : 0;
        const connCls = (ri < nr - 1 && hasSib)
          ? (mi % 2 === 0 ? "trn-wc-card--conn-top" : "trn-wc-card--conn-bot") : "";

        const tRow = (slot, score, isWin, isLoss) => {
          if (!slot) return `<div class="trn-wc-bteam trn-wc-bt--tbd"><span class="trn-wc-bteam-name">TBD</span></div>`;
          const cls = isWin ? "trn-wc-bt--win" : isLoss ? "trn-wc-bt--loss" : "";
          return `<div class="trn-wc-bteam ${cls}">
            <span class="trn-wc-bteam-name" title="${_esc(slot.name)}">${_esc(slot.name)}</span>
            ${hasScores ? `<span class="trn-wc-bteam-score">${(score || 0).toFixed(1)}</span>` : ""}
          </div>`;
        };

        return `<div class="trn-wc-card ${connCls}" style="position:absolute;top:${top}px;left:0;right:0;--wc-gap:${gap}px">
          ${tRow(m.slotA, m.scoreA, winA, winB)}
          <div class="trn-wc-card-divider"></div>
          ${tRow(m.slotB, m.scoreB, winB, winA)}
        </div>`;
      }).join("");

      const byePills = rnd.byes.length
        ? `<div class="cp-bye-pills">${rnd.byes.map(b =>
            `<div class="cp-bye-pill">${_esc(b.name)} <span class="cp-bye-tag">BYE</span></div>`
          ).join("")}</div>` : "";

      return `<div class="trn-wc-col" data-ri="${ri}">
        <div class="trn-wc-col-header">${getRoundLabel(ri)}${wkLbl ? ` <span class="trn-wc-week-tag">${_esc(wkLbl)}</span>` : ""}</div>
        <div class="trn-wc-col-cards" style="position:relative;height:${totalH}px">${cards}</div>
        ${byePills}
      </div>`;
    }).join("");

    // Champion col
    const finalMatch = bracket[nr - 1]?.matchups?.[0] || {};
    const champName  = (finalMatch.scoreA != null && finalMatch.scoreB != null)
      ? (finalMatch.scoreA >= finalMatch.scoreB ? finalMatch.slotA?.name : finalMatch.slotB?.name) : "";
    const champCol = `<div class="trn-wc-col trn-wc-col--champ">
      <div class="trn-wc-col-header">🏆 Champion</div>
      <div class="trn-wc-col-cards" style="display:flex;align-items:center;min-height:${cardH + 16}px">
        <div class="trn-wc-card trn-wc-card--champion">
          <div class="trn-wc-bteam trn-wc-bt--champ">
            <span class="trn-wc-bteam-name">${_esc(champName || "TBD")}</span>
          </div>
        </div>
      </div>
    </div>`;

    // Seed list
    const seedRows = (cfg.seeds || []).map((s, i) => {
      const rec = _rosterRecord(s.rosterId);
      return `<div class="trn-po-seed-row">
        <span class="trn-po-seed-num">#${i + 1}</span>
        <span class="trn-po-seed-name">${_esc(_rosterName(s.rosterId))}</span>
        <span class="trn-po-seed-record">${rec.wins}–${rec.losses}</span>
        <span class="trn-po-seed-pf">${rec.pf.toFixed(1)} pts</span>
      </div>`;
    }).join("");

    const commishBar = _isCommish
      ? `<div class="cp-commish-bar">
          <button class="btn-secondary btn-sm" onclick="DLRCustomPlayoffs.openConfig()">⚙ Edit Config</button>
          <button class="btn-secondary btn-sm" onclick="DLRCustomPlayoffs.refreshScores()">↺ Refresh Scores</button>
        </div>` : "";

    el.innerHTML = `
      ${commishBar}
      <div class="trn-wc-bracket-wrap">
        <div class="trn-wc-bracket">${cols}${champCol}</div>
      </div>
      <div class="trn-po-seed-list" style="margin-top:var(--space-4)">${seedRows}</div>
    `;
  }

  function _weekLabel(ri) {
    const round = _config?.rounds?.[ri];
    if (!round?.startWeek) return "";
    const wpr = round.weeksPerRound || 1;
    return wpr > 1 ? `Wks ${round.startWeek}–${round.startWeek + wpr - 1}` : `Wk ${round.startWeek}`;
  }

  async function refreshScores() {
    _scoreCache = {};
    const el = document.getElementById("dtab-customplayoffs");
    if (el && _config?.rounds?.length) await _renderBracket(el);
  }

  // ── Config modal ──────────────────────────────────────
  async function openConfig() {
    const modal = document.getElementById("cp-config-modal");
    if (!modal) return;

    const cfg     = _config || {};
    const opts    = _rosterOpts();
    modal._opts   = opts; // store for dynamic row additions

    // Set dropdowns
    modal.querySelector("#cp-seed-method").value = cfg.seedingMethod || "record";
    modal.querySelector("#cp-reseed").checked    = !!cfg.reseed;

    // Seed rows
    const savedSeeds = cfg.seeds?.length
      ? cfg.seeds
      : opts.map(r => ({ rosterId: r.rosterId })); // auto-populate all teams
    _buildSeedRows(modal, savedSeeds);

    // Round rows
    _buildRoundRows(modal, cfg.rounds || []);

    modal.classList.remove("hidden");
  }

  // ── Seed rows ─────────────────────────────────────────
  function _buildSeedRows(modal, seeds) {
    const body = modal.querySelector("#cp-seeds-body");
    const opts = modal._opts || [];
    body.innerHTML = seeds.map((s, i) => _seedRowHTML(i, s?.rosterId || "", opts)).join("")
      + `<button class="btn-secondary btn-sm" style="margin-top:var(--space-2);width:100%" onclick="DLRCustomPlayoffs._addSeedRow()">+ Add Team</button>`;
  }

  function _seedRowHTML(i, rosterId, opts) {
    const opts2 = opts || (document.getElementById("cp-config-modal")?._opts || []);
    return `<div class="cp-seed-row">
      <span class="cp-seed-num">#${i + 1}</span>
      <select class="cp-seed-select">
        <option value="">— Select team —</option>
        ${opts2.map(r => `<option value="${r.rosterId}" ${r.rosterId === String(rosterId) ? "selected" : ""}>${_esc(r.name)} (${r.rec})</option>`).join("")}
      </select>
      <button class="cp-row-remove" onclick="this.closest('.cp-seed-row').remove();DLRCustomPlayoffs._renumberSeeds()" title="Remove">✕</button>
    </div>`;
  }

  function _addSeedRow() {
    const modal = document.getElementById("cp-config-modal");
    const body  = modal?.querySelector("#cp-seeds-body");
    const opts  = modal?._opts || [];
    if (!body) return;
    const idx  = body.querySelectorAll(".cp-seed-row").length;
    const div  = document.createElement("div");
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
    const init = rounds.length ? rounds : [{ startWeek: "", weeksPerRound: 1, playingSeeds: [] }];
    body.innerHTML = init.map((r, ri) => _roundRowHTML(ri, r)).join("")
      + `<button class="btn-secondary btn-sm" style="margin-top:var(--space-2);width:100%" onclick="DLRCustomPlayoffs._addRound()">+ Add Round</button>`;
  }

  function _roundRowHTML(ri, r) {
    const playStr  = (r.playingSeeds || []).join(", ");
    const lbl      = r.label || `Round ${ri + 1}`;
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
        <div class="cp-round-field cp-round-field--wide">
          <label>Seeds That Play <span class="cp-field-hint">(seed #s, comma-separated — all others get a BYE)</span></label>
          <input type="text" class="cp-round-playing" value="${_esc(playStr)}" placeholder="e.g. 9,10,11,12" />
        </div>
        <div class="cp-round-field">
          <label>Winners Advancing <span class="cp-field-hint">(blank = half)</span></label>
          <input type="number" class="cp-round-advance" min="1" value="${r.advanceCount || ""}" placeholder="auto" />
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

  // ── Save ──────────────────────────────────────────────
  async function saveConfig() {
    const modal   = document.getElementById("cp-config-modal");
    const saveBtn = modal?.querySelector("#cp-save-btn");
    if (!modal || !_leagueKey || !_username) return;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }

    try {
      const seedingMethod = modal.querySelector("#cp-seed-method").value || "record";
      const reseed        = modal.querySelector("#cp-reseed").checked;

      const seeds = [...modal.querySelectorAll("#cp-seeds-body .cp-seed-select")]
        .map(s => ({ rosterId: s.value })).filter(s => s.rosterId);
      if (seeds.length < 2) { showToast("Add at least 2 teams.", "error"); return; }

      const roundCards = [...modal.querySelectorAll("#cp-rounds-body .cp-round-card")];
      if (!roundCards.length) { showToast("Add at least one round.", "error"); return; }

      const rounds = roundCards.map(card => ({
        label:         card.querySelector(".cp-round-label-input")?.value?.trim() || null,
        startWeek:     parseInt(card.querySelector(".cp-round-start")?.value) || null,
        weeksPerRound: parseInt(card.querySelector(".cp-round-wpr")?.value) || 1,
        playingSeeds:  (card.querySelector(".cp-round-playing")?.value || "")
                         .split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n) && n > 0),
        advanceCount:  parseInt(card.querySelector(".cp-round-advance")?.value) || null
      }));

      const newConfig = { enabled: true, seedingMethod, reseed, seeds, rounds };

      // Write directly to personal leagueMeta path
      await firebase.database()
        .ref(`gmd/users/${_username.toLowerCase()}/leagueMeta/${_leagueKey}`)
        .update({ customPlayoff: newConfig });

      _config = newConfig; _scoreCache = {};
      closeConfig();
      showToast("Custom playoffs saved ✓");
      const el = document.getElementById("dtab-customplayoffs");
      if (el) await _renderBracket(el);

    } catch(e) {
      showToast("Save failed: " + e.message, "error");
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
    }
  }

  function _esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  return {
    init, reset,
    openConfig, closeConfig, saveConfig,
    refreshScores,
    _addSeedRow, _renumberSeeds,
    _addRound, _renumberRounds
  };

})();
