// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Cross-League Player Report
//  Ported from SleeperBid playerreport.js
//  Shows all players you own across all your leagues,
//  how many leagues you own them in, and available gems.
//  Lives in a slide-in panel triggered from the header.
// ─────────────────────────────────────────────────────────

const DLRPlayerReport = (() => {

  let _isOpen  = false;
  let _built   = false;
  let _allLeagues = {};
  let _sleeperUserId = null;

  const POS_COLOR = {
    QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff",
    TE:"#ffc94d", K:"#9ca3af", DEF:"#9ca3af"
  };
  const SKILL_POS = ["QB","RB","WR","TE"];

  // ── Open / close ──────────────────────────────────────────
  function open(allLeagues, sleeperUserId) {
    _allLeagues     = allLeagues || {};
    _sleeperUserId  = sleeperUserId || null;
    _built          = false; // always rebuild so season filter is fresh

    const panel = document.getElementById("player-report-panel");
    if (!panel) return;
    panel.classList.remove("pr-panel--hidden");
    document.getElementById("player-report-backdrop")?.classList.remove("hidden");
    _isOpen = true;

    _buildReport();
  }

  function close() {
    document.getElementById("player-report-panel")?.classList.add("pr-panel--hidden");
    document.getElementById("player-report-backdrop")?.classList.add("hidden");
    _isOpen = false;
  }

  function toggle(allLeagues, sleeperUserId) {
    if (_isOpen) close();
    else open(allLeagues, sleeperUserId);
  }

  // ── Build report ──────────────────────────────────────────
  async function _buildReport() {
    const body = document.getElementById("pr-body");
    if (!body) return;

    body.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Scanning your leagues…</span></div>`;

    try {
      // Get player database
      let players = {};
      try {
        const cached = localStorage.getItem("dlr_players");
        if (cached) players = JSON.parse(cached);
        if (Object.keys(players).length < 100) {
          body.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Downloading player database…</span></div>`;
          const r = await fetch("https://api.sleeper.app/v1/players/nfl");
          if (r.ok) {
            players = await r.json();
            try { localStorage.setItem("dlr_players", JSON.stringify(players)); } catch(e) {}
          }
        }
      } catch(e) {}

      // Use 1/15 rule to determine which season's rosters to show
      const activeSeason = typeof getActiveSeason === "function"
        ? getActiveSeason()
        : String(new Date().getFullYear() - 1);

      // Get all Sleeper leagues from the active season
      const ownerLeagues = Object.entries(_allLeagues)
        .filter(([, l]) => l.platform === "sleeper" && l.leagueId && l.season === activeSeason)
        .map(([key, l]) => ({ key, ...l }));

      if (!ownerLeagues.length) {
        // Fallback: use most recent season available in stored data
        const allSeasons = Object.values(_allLeagues)
          .map(l => l.season).filter(Boolean)
          .sort((a, b) => b.localeCompare(a));
        const fallbackSeason = allSeasons[0];
        const fallback = Object.entries(_allLeagues)
          .filter(([, l]) => l.platform === "sleeper" && l.leagueId && l.season === fallbackSeason)
          .map(([key, l]) => ({ key, ...l }));
        if (!fallback.length) {
          body.innerHTML = `<div class="pr-empty">No Sleeper leagues found. Import your Sleeper account first.</div>`;
          return;
        }
        ownerLeagues.push(...fallback);
      }

      body.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Loading rosters for ${ownerLeagues.length} leagues…</span></div>`;

      // Fetch all rosters in parallel — only for Sleeper leagues
      const playerLeagueMap = {}; // playerId → [{ leagueName, leagueKey, slot }]

      await Promise.all(
        ownerLeagues
          .filter(l => l.platform === "sleeper" && l.leagueId)
          .map(async l => {
            try {
              const [rosters, users] = await Promise.all([
                fetch(`https://api.sleeper.app/v1/league/${l.leagueId}/rosters`).then(r => r.json()),
                fetch(`https://api.sleeper.app/v1/league/${l.leagueId}/users`).then(r => r.json())
              ]);

              // Find my roster by matching sleeper user ID or username
              let myRoster = null;
              if (_sleeperUserId) {
                myRoster = (rosters||[]).find(r => r.owner_id === _sleeperUserId);
              }
              if (!myRoster && l.teamName) {
                // fallback: match by team name via users
                const userMap = {};
                (users||[]).forEach(u => {
                  const tName = u.metadata?.team_name || u.display_name || u.username;
                  userMap[u.user_id] = tName;
                });
                const matchUser = (users||[]).find(u =>
                  (u.metadata?.team_name||u.display_name||u.username||"").toLowerCase() ===
                  (l.teamName||"").toLowerCase()
                );
                if (matchUser) myRoster = (rosters||[]).find(r => r.owner_id === matchUser.user_id);
              }
              if (!myRoster) return;

              const slotted = [
                ...(myRoster.players||[]).map(id => ({ id, slot:"roster" })),
                ...(myRoster.reserve||[]).map(id => ({ id, slot:"IR" })),
                ...(myRoster.taxi||[]).map(id => ({ id, slot:"Taxi" })),
              ];

              slotted.forEach(({ id, slot }) => {
                if (!playerLeagueMap[id]) playerLeagueMap[id] = [];
                playerLeagueMap[id].push({
                  leagueName: l.leagueName,
                  leagueKey:  l.key,
                  season:     l.season,
                  slot,
                  leagueType: l.leagueType
                });
              });
            } catch(e) {}
          })
      );

      // Fetch prior year stats for gem detection
      const priorYear = new Date().getFullYear() - 1;
      let priorScorers = new Set();
      try {
        const r = await fetch(
          `https://api.sleeper.app/v1/stats/nfl/regular/${priorYear}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE`
        );
        if (r.ok) {
          const stats = await r.json();
          Object.entries(stats||{}).forEach(([pid, s]) => {
            if ((s.pts_ppr || s.pts_std || 0) > 0) priorScorers.add(pid);
          });
        }
      } catch(e) {}

      const totalLeagues = ownerLeagues.filter(l => l.platform === "sleeper").length;
      const ownedIds     = new Set(Object.keys(playerLeagueMap));

      // Build owned player list
      const owned = Object.entries(playerLeagueMap).map(([pid, leagues]) => {
        const p = players[pid] || {};
        const name = p.first_name ? `${p.first_name} ${p.last_name}` : pid;
        const pos  = (p.fantasy_positions?.[0] || p.position || "—").toUpperCase();
        return {
          pid, name, pos,
          team:    p.team    || "FA",
          rank:    p.search_rank || 9999,
          age:     p.age     || null,
          leagues, count: leagues.length
        };
      }).sort((a, b) => b.count - a.count || a.rank - b.rank);

      // Build unowned gems
      const unowned = Object.entries(players)
        .filter(([pid, p]) => {
          if (ownedIds.has(pid)) return false;
          const pos = (p.fantasy_positions?.[0] || p.position || "").toUpperCase();
          if (!SKILL_POS.includes(pos)) return false;
          const onTeam = p.team && p.team !== "FA" && p.team !== "" && p.active !== false;
          return onTeam || priorScorers.has(pid);
        })
        .map(([pid, p]) => ({
          pid,
          name: `${p.first_name} ${p.last_name}`,
          pos:  (p.fantasy_positions?.[0] || p.position || "—").toUpperCase(),
          team: p.team || "FA",
          rank: p.search_rank || 9999,
          age:  p.age || null
        }))
        .sort((a, b) => a.rank - b.rank)
        .slice(0, 60);

      _renderReport(body, owned, unowned, players, totalLeagues);

    } catch(e) {
      const body2 = document.getElementById("pr-body");
      if (body2) body2.innerHTML = `<div class="pr-error">⚠️ ${e.message}</div>`;
    }
  }

  // ── Render ────────────────────────────────────────────────
  function _renderReport(body, owned, unowned, players, totalLeagues) {
    const posCounts = {};
    owned.forEach(p => { posCounts[p.pos] = (posCounts[p.pos] || 0) + 1; });
    const multiLeague = owned.filter(p => p.count > 1).length;

    body.innerHTML = `
      <!-- Summary row -->
      <div class="pr-summary-row">
        <div class="pr-summary-stat">
          <div class="pr-summary-val">${totalLeagues}</div>
          <div class="pr-summary-lbl">Leagues</div>
        </div>
        <div class="pr-summary-stat">
          <div class="pr-summary-val">${owned.length}</div>
          <div class="pr-summary-lbl">Players</div>
        </div>
        ${SKILL_POS.map(pos => `
        <div class="pr-summary-stat" style="border-left:3px solid ${POS_COLOR[pos]}22;">
          <div class="pr-summary-val" style="color:${POS_COLOR[pos]}">${posCounts[pos]||0}</div>
          <div class="pr-summary-lbl">${pos}s</div>
        </div>`).join("")}
        <div class="pr-summary-stat">
          <div class="pr-summary-val" style="color:var(--color-gold)">${multiLeague}</div>
          <div class="pr-summary-lbl">Multi-lg</div>
        </div>
      </div>

      <!-- Tab bar -->
      <div class="pr-tabs">
        <button class="pr-tab pr-tab--active" onclick="DLRPlayerReport.switchTab('owned', this)">
          My Players <span class="pr-tab-count">${owned.length}</span>
        </button>
        <button class="pr-tab" onclick="DLRPlayerReport.switchTab('gems', this)">
          Available Gems <span class="pr-tab-count">${unowned.length}</span>
        </button>
      </div>

      <!-- Pos filter -->
      <div class="pr-pos-filter" id="pr-pos-filter">
        ${["ALL",...SKILL_POS].map(pos =>
          `<button class="pr-pos-btn ${pos === "ALL" ? "pr-pos-btn--active" : ""}"
            onclick="DLRPlayerReport.filterPos('${pos}', this)">${pos}</button>`
        ).join("")}
      </div>

      <!-- Owned players -->
      <div id="pr-tab-owned" class="pr-player-list">
        ${owned.map(p => _playerRow(p, totalLeagues, true)).join("")}
      </div>

      <!-- Gems (hidden) -->
      <div id="pr-tab-gems" class="pr-player-list" style="display:none;">
        <div class="pr-gems-note">Top available players not on any of your ${totalLeagues} rosters. Sorted by ADP.</div>
        ${unowned.map((p, i) => _gemRow(p, i + 1)).join("")}
      </div>
    `;
  }

  function _playerRow(p, totalLeagues, showLeagues) {
    const color  = POS_COLOR[p.pos] || "#9ca3af";
    const pct    = Math.round((p.count / totalLeagues) * 100);
    const barCol = pct === 100 ? "var(--color-gold)" : p.count > 1 ? "var(--color-green)" : "var(--color-text-dim)";
    const multiLabel = p.count > 1 ? `<span class="pr-multi-badge">${p.count} leagues</span>` : "";

    const leagueNames = p.leagues
      .slice(0, 3)
      .map(l => `<span class="pr-league-chip ${l.slot !== "roster" ? "pr-league-chip--special" : ""}">${_esc(l.leagueName)}${l.slot !== "roster" ? ` (${l.slot})` : ""}</span>`)
      .join("");
    const more = p.leagues.length > 3 ? `<span class="pr-league-chip">+${p.leagues.length - 3}</span>` : "";

    return `
      <div class="pr-player-row" data-pos="${p.pos}"
        onclick="DLRPlayerCard.show('${p.pid}', '${_escAttr(p.name)}')">
        <div class="pr-pos-dot" style="background:${color}22;color:${color};border-color:${color}55">${p.pos}</div>
        <div class="pr-player-info">
          <div class="pr-player-name">${_esc(p.name)} ${multiLabel}</div>
          <div class="pr-player-meta">
            <span class="pr-nfl-team">${p.team}</span>
            ${p.rank < 999 ? `<span class="pr-adp">#${p.rank} ADP</span>` : ""}
          </div>
          <div class="pr-leagues-line">${leagueNames}${more}</div>
        </div>
        <div class="pr-ownership-bar">
          <div class="pr-bar-fill" style="width:${pct}%;background:${barCol}"></div>
          <span class="pr-bar-label" style="color:${barCol}">${pct}%</span>
        </div>
      </div>`;
  }

  function _gemRow(p, rank) {
    const color = POS_COLOR[p.pos] || "#9ca3af";
    return `
      <div class="pr-player-row" data-pos="${p.pos}"
        onclick="DLRPlayerCard.show('${p.pid}', '${_escAttr(p.name)}')">
        <div class="pr-rank-num">${rank}</div>
        <div class="pr-pos-dot" style="background:${color}22;color:${color};border-color:${color}55">${p.pos}</div>
        <div class="pr-player-info">
          <div class="pr-player-name">${_esc(p.name)}</div>
          <div class="pr-player-meta">
            <span class="pr-nfl-team">${p.team}</span>
            ${p.rank < 999 ? `<span class="pr-adp">#${p.rank} ADP</span>` : ""}
            ${p.age ? `<span class="pr-adp">Age ${p.age}</span>` : ""}
          </div>
        </div>
      </div>`;
  }

  // ── Tab / filter controls ─────────────────────────────────
  function switchTab(tabId, btn) {
    document.querySelectorAll(".pr-tab").forEach(t => t.classList.remove("pr-tab--active"));
    btn?.classList.add("pr-tab--active");
    document.getElementById("pr-tab-owned").style.display = tabId === "owned" ? "" : "none";
    document.getElementById("pr-tab-gems").style.display  = tabId === "gems"  ? "" : "none";
    // Reset pos filter to ALL
    document.querySelectorAll(".pr-pos-btn").forEach(b => b.classList.remove("pr-pos-btn--active"));
    document.querySelector(".pr-pos-btn")?.classList.add("pr-pos-btn--active");
    _applyPosFilter("ALL", tabId === "gems" ? "pr-tab-gems" : "pr-tab-owned");
  }

  function filterPos(pos, btn) {
    document.querySelectorAll(".pr-pos-btn").forEach(b => b.classList.remove("pr-pos-btn--active"));
    btn?.classList.add("pr-pos-btn--active");
    const activeTab = document.getElementById("pr-tab-owned").style.display !== "none" ? "pr-tab-owned" : "pr-tab-gems";
    _applyPosFilter(pos, activeTab);
  }

  function _applyPosFilter(pos, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll(".pr-player-row").forEach(row => {
      row.style.display = (pos === "ALL" || row.dataset.pos === pos) ? "" : "none";
    });
  }

  // ── Helpers ────────────────────────────────────────────
  function _esc(s)     { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function _escAttr(s) { return String(s||"").replace(/'/g,"\\'").replace(/"/g,"&quot;"); }

  return { open, close, toggle, switchTab, filterPos };

})();
