// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — League Rules + Free Agents
//  Rules: markdown viewer for any member, editor for commish
//  Free Agents: top available players by ADP or prior pts
// ─────────────────────────────────────────────────────────

// ══════════════════════════════════════════════════════════
//  RULES MODULE
// ══════════════════════════════════════════════════════════
const DLRRules = (() => {

  let _leagueId   = null;
  let _isCommish  = false;
  let _leagueKey  = null;
  let _initToken  = 0;

  async function init(leagueId, leagueKey, isCommish) {
    _leagueId  = leagueId;
    _leagueKey = leagueKey;
    _isCommish = !!isCommish;
    _initToken++;
    const token = _initToken;

    const el = document.getElementById("dtab-rules");
    if (!el) return;

    el.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Loading rules…</span></div>`;

    // Load rules from Firebase gmd/leagueRules/{leagueKey}
    try {
      const rulesData = await GMDB.getLeagueRules(leagueKey);
      if (token !== _initToken) return;
      _render(el, rulesData?.text || "", rulesData?.updatedAt || null);
    } catch(e) {
      if (token !== _initToken) return;
      _render(el, "", null);
    }
  }

  function reset() {
    _leagueId  = null;
    _leagueKey = null;
    _isCommish = false;
    _initToken++;
  }

  function _render(el, text, updatedAt) {
    const hasRules = text && text.trim().length > 0;
    const lastUpdated = updatedAt
      ? `<span class="rules-updated">Last updated ${new Date(updatedAt).toLocaleDateString()}</span>`
      : "";

    if (_isCommish) {
      // Commissioner gets editor + preview
      el.innerHTML = `
        <div class="rules-editor-wrap">
          <div class="rules-editor-header">
            <span class="rules-editor-title">League Rules</span>
            ${lastUpdated}
            <div class="rules-editor-actions">
              <button class="rules-btn rules-btn--secondary" onclick="DLRRules.togglePreview()">Preview</button>
              <button class="rules-btn rules-btn--primary" onclick="DLRRules.saveRules()">Save Rules</button>
            </div>
          </div>
          <textarea id="rules-textarea" class="rules-textarea"
            placeholder="Write your league rules here. Markdown is supported — use ## for headings, **bold**, - for bullets..."
            >${_escHtml(text)}</textarea>
          <div id="rules-preview" class="rules-preview hidden">
            ${_renderMarkdown(text)}
          </div>
        </div>`;
    } else {
      // Member gets read-only view
      el.innerHTML = hasRules
        ? `<div class="rules-view">
            <div class="rules-view-header">League Rules ${lastUpdated}</div>
            <div class="rules-preview rules-preview--standalone">${_renderMarkdown(text)}</div>
           </div>`
        : `<div class="rules-empty">
            <div style="font-size:2rem;margin-bottom:var(--space-3);">📋</div>
            <div style="font-weight:600;margin-bottom:var(--space-2);">No rules posted yet</div>
            <div style="font-size:.85rem;color:var(--color-text-dim);">The commissioner hasn't added league rules.</div>
           </div>`;
    }
  }

  function togglePreview() {
    const textarea = document.getElementById("rules-textarea");
    const preview  = document.getElementById("rules-preview");
    const btn      = document.querySelector(".rules-btn--secondary");
    if (!textarea || !preview) return;

    const isHidden = preview.classList.toggle("hidden");
    textarea.style.display = isHidden ? "" : "none";
    if (btn) btn.textContent = isHidden ? "Preview" : "Edit";
    if (!isHidden) {
      preview.innerHTML = _renderMarkdown(textarea.value);
    }
  }

  async function saveRules() {
    const textarea = document.getElementById("rules-textarea");
    if (!textarea || !_leagueKey) return;
    const btn = document.querySelector(".rules-btn--primary");
    if (btn) { btn.textContent = "Saving…"; btn.disabled = true; }
    try {
      await GMDB.saveLeagueRules(_leagueKey, {
        text:      textarea.value,
        updatedAt: Date.now()
      });
      if (btn) { btn.textContent = "Saved ✓"; setTimeout(() => { btn.textContent = "Save Rules"; btn.disabled = false; }, 2000); }
    } catch(e) {
      if (btn) { btn.textContent = "Error — retry"; btn.disabled = false; }
    }
  }

  // Very simple markdown renderer — headings, bold, italic, lists, links
  function _renderMarkdown(text) {
    if (!text) return "";
    let html = _escHtml(text)
      // h1-h4
      .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
      .replace(/^### (.+)$/gm, "<h3>$1</h3>")
      .replace(/^## (.+)$/gm, "<h2>$1</h2>")
      .replace(/^# (.+)$/gm, "<h1>$1</h1>")
      // bold/italic
      .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      // unordered list items
      .replace(/^[*\-] (.+)$/gm, "<li>$1</li>")
      // ordered list items
      .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
      // horizontal rule
      .replace(/^---$/gm, "<hr>")
      // line breaks → paragraphs
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>");

    // Wrap consecutive <li> in <ul>
    html = html.replace(/(<li>.*?<\/li>)/gs, "<ul>$1</ul>")
               .replace(/<\/ul>\s*<ul>/g, "");

    return `<div class="rules-md"><p>${html}</p></div>`;
  }

  function _escHtml(s) {
    return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  return { init, reset, togglePreview, saveRules };

})();


// ══════════════════════════════════════════════════════════
//  FREE AGENTS MODULE
// ══════════════════════════════════════════════════════════
const DLRFreeAgents = (() => {

  let _leagueId      = null;
  let _leagueKey     = null;
  let _auctionEnabled = false;
  let _auctionIncludePicks = false;
  let _myRosterId    = null;
  let _myTeamName    = "My Team";
  let _initToken = 0;
  let _sortMode  = "adp";
  let _posFilter = "ALL";
  let _cachedData = null;

  const POS_COLOR = {
    QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff",
    TE:"#ffc94d", K:"#9ca3af", DEF:"#9ca3af"
  };
  const SKILL_POS = ["QB","RB","WR","TE"];

  async function init(leagueId, leagueKey, auctionEnabled, auctionIncludePicks, myRosterId, myTeamName) {
    _leagueId           = leagueId;
    _leagueKey          = leagueKey || null;
    _auctionEnabled     = !!auctionEnabled;
    _auctionIncludePicks= !!auctionIncludePicks;
    _myRosterId         = myRosterId || null;
    _myTeamName         = myTeamName || "My Team";
    _cachedData = null;
    _sortMode   = "adp";
    _posFilter  = "ALL";
    _initToken++;
    const token = _initToken;

    const el = document.getElementById("dtab-freeagents");
    if (!el) return;
    el.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Loading free agents…</span></div>`;

    try {
      await _loadData(leagueId, token);
    } catch(e) {
      if (token !== _initToken) return;
      el.innerHTML = `<div class="detail-error">⚠️ ${e.message}</div>`;
    }
  }

  function reset() {
    _leagueId   = null;
    _cachedData = null;
    _initToken++;
  }

  async function _loadData(leagueId, token) {
    const el = document.getElementById("dtab-freeagents");

    // Get all rostered player IDs in this league
    const rosters = await SleeperAPI.getRosters(leagueId);
    if (token !== _initToken) return;

    const rostered = new Set();
    (rosters||[]).forEach(r => {
      (r.players||[]).forEach(id => rostered.add(id));
      (r.reserve||[]).forEach(id => rostered.add(id));
      (r.taxi||[]).forEach(id => rostered.add(id));
    });

    // Get player database via IndexedDB-backed module
    const players = await DLRPlayers.load();
    if (token !== _initToken) return;

    // Fetch prior year PPR stats
    const priorYear = new Date().getFullYear() - 1;
    let priorStats  = {};
    try {
      const cacheKey = `dlr_stats_${priorYear}`;
      let cached = await DLRIDB.get(cacheKey).catch(() => null);
      if (!cached) {
        const r = await fetch(
          `https://api.sleeper.app/v1/stats/nfl/regular/${priorYear}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K`
        );
        if (r.ok) {
          cached = await r.json();
          try { await DLRIDB.set(cacheKey, cached); } catch(e) {}
        }
      }
      priorStats = cached || {};
    } catch(e) {}

    if (token !== _initToken) return;

    // Build free agent list
    const fas = Object.entries(players)
      .filter(([pid, p]) => {
        if (rostered.has(pid)) return false;
        const pos = (p.fantasy_positions?.[0] || p.position || "").toUpperCase();
        if (!SKILL_POS.includes(pos)) return false;
        const onTeam = p.team && p.team !== "FA" && p.team !== "" && p.active !== false;
        const hasPts = priorStats[pid] && (priorStats[pid].pts_ppr || 0) > 0;
        return onTeam || hasPts;
      })
      .map(([pid, p]) => ({
        pid,
        name:  `${p.first_name} ${p.last_name}`,
        pos:   (p.fantasy_positions?.[0] || p.position || "—").toUpperCase(),
        team:  p.team || "FA",
        rank:  p.search_rank || 9999,
        pts:   priorStats[pid]?.pts_ppr || null,
        age:   p.age || null,
        status: p.injury_status || null
      }));

    _cachedData = fas;
    if (token !== _initToken) return;
    _render();
  }

  function _render() {
    const el = document.getElementById("dtab-freeagents");
    if (!el || !_cachedData) return;

    const sorted = [..._cachedData]
      .filter(p => _posFilter === "ALL" || p.pos === _posFilter)
      .sort((a, b) =>
        _sortMode === "pts"
          ? (b.pts || 0) - (a.pts || 0)
          : (a.rank || 9999) - (b.rank || 9999)
      )
      .slice(0, 50);

    const priorYear = new Date().getFullYear() - 1;

    el.innerHTML = `
      <div class="fa-toolbar">
        <div class="fa-pos-filter">
          ${["ALL",...SKILL_POS].map(pos =>
            `<button class="fa-pos-btn ${_posFilter === pos ? "fa-pos-btn--active" : ""}"
              onclick="DLRFreeAgents.setPos('${pos}')">${pos}</button>`
          ).join("")}
        </div>
        <div class="fa-sort-toggle">
          <button class="fa-sort-btn ${_sortMode === "adp" ? "fa-sort-btn--active" : ""}"
            onclick="DLRFreeAgents.setSort('adp')">ADP Rank</button>
          <button class="fa-sort-btn ${_sortMode === "pts" ? "fa-sort-btn--active" : ""}"
            onclick="DLRFreeAgents.setSort('pts')">${priorYear} Pts</button>
        </div>
      </div>
      <div class="fa-list">
        ${sorted.length ? sorted.map((p, i) => {
          const color = POS_COLOR[p.pos] || "#9ca3af";
          const pts   = p.pts ? p.pts.toFixed(0) : "—";
          const rank  = p.rank < 9999 ? `#${p.rank}` : "—";
          const canNom = _auctionEnabled
            ? (typeof DLRAuction !== "undefined" && DLRAuction.canNominate?.())
            : false;
          const nomBtn = _auctionEnabled
            ? (canNom
                ? `<button class="fa-nom-btn btn-primary btn-sm"
                    onclick="event.stopPropagation();DLRAuction.openNominate('${p.pid}','${_escAttr(p.name)}','${p.pos}','${p.team}')"
                    title="Nominate for auction">🏷</button>`
                : `<button class="fa-nom-btn btn-secondary btn-sm" disabled
                    title="Max nominations reached" style="opacity:.4">🏷</button>`)
            : "";
          return `
            <div class="fa-player-row" onclick="DLRPlayerCard.show('${p.pid}', '${_escAttr(p.name)}')">
              <div class="fa-rank">${i + 1}</div>
              <div class="fa-photo">
                <img src="https://sleepercdn.com/content/nfl/players/thumb/${p.pid}.jpg"
                  onerror="this.style.display='none'" loading="lazy" />
              </div>
              <div class="fa-pos-dot" style="background:${color}22;color:${color};border-color:${color}55">${p.pos}</div>
              <div class="fa-info">
                <div class="fa-name">${_esc(p.name)}${p.status ? ` <span class="fa-injury">${p.status}</span>` : ""}</div>
                <div class="fa-meta">${p.team}${p.age ? ` · Age ${p.age}` : ""}</div>
              </div>
              <div class="fa-stats">
                <div class="fa-stat-val">${_sortMode === "pts" ? pts : rank}</div>
                <div class="fa-stat-lbl">${_sortMode === "pts" ? "PPR pts" : "ADP"}</div>
              </div>
              <div class="fa-stats fa-stats--secondary">
                <div class="fa-stat-val">${_sortMode === "pts" ? rank : pts}</div>
                <div class="fa-stat-lbl">${_sortMode === "pts" ? "ADP" : "PPR pts"}</div>
              </div>
              ${nomBtn}
            </div>`;
        }).join("") : `<div class="fa-empty">No free agents found.</div>`}
      </div>`;
  }

  function setSort(mode) {
    _sortMode = mode;
    _render();
  }

  function setPos(pos) {
    _posFilter = pos;
    _render();
  }

  function _esc(s)     { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function _escAttr(s) { return String(s||"").replace(/'/g,"\\'").replace(/"/g,"&quot;"); }

  return { init, reset, setSort, setPos };

})();
