// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Draft Board
//  Reads Sleeper draft API directly.
//  Shows pick grid by round, supports snake + linear drafts.
//  Historical seasons via prev_league_id chain.
//  Click any pick to open the player card.
// ─────────────────────────────────────────────────────────

const DLRDraft = (() => {

  let _leagueId   = null;
  let _platform   = "sleeper";
  let _leagueKey  = null;
  let _season     = null;
  let _initToken  = 0;
  let _draftData  = null;
  let _seasons    = [];
  let _viewingId  = null;
  let _viewMode   = "draft";

  const POS_COLOR = {
    QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff",
    TE:"#ffc94d", K:"#9ca3af", DEF:"#9ca3af"
  };

  // ── Init ──────────────────────────────────────────────────
  async function init(leagueId, platform, season, leagueKey) {
    _leagueId  = leagueId;
    _platform  = platform || "sleeper";
    _season    = season   || new Date().getFullYear().toString();
    _leagueKey = leagueKey || null;
    _draftData = null;
    _viewingId = null;
    _viewMode  = "draft";
    _seasons   = [];
    _initToken++;
    const token = _initToken;

    const el = document.getElementById("dtab-draft");
    if (!el) return;

    if (_platform === "mfl") {
      el.innerHTML = _loadingHTML("Loading MFL draft & auction history…");
      try { await _loadMFLDraft(leagueId, season, token); }
      catch(e) {
        if (token !== _initToken) return;
        el.innerHTML = _errorHTML("Could not load MFL draft: " + e.message);
      }
      return;
    }

    if (_platform === "yahoo") {
      el.innerHTML = _loadingHTML("Loading Yahoo draft & auction history…");
      try { await _loadYahooDraft(leagueId, leagueKey, token); }
      catch(e) {
        if (token !== _initToken) return;
        el.innerHTML = _errorHTML("Could not load Yahoo draft: " + e.message);
      }
      return;
    }

    el.innerHTML = _loadingHTML("Loading draft board…");

    try {
      // No season selector in the draft tab — just load current league's draft
      await _loadDraft(leagueId, token);
    } catch(e) {
      if (token !== _initToken) return;
      el.innerHTML = _errorHTML("Could not load draft: " + e.message);
    }
  }

  function reset() {
    _leagueId  = null;
    _draftData = null;
    _seasons   = [];
    _viewingId = null;
    _initToken++;
  }

  // ── Load seasons chain (for season selector) ──────────────
  async function _loadSeasons(leagueId, token) {
    try {
      const chain = await SleeperAPI.getLeagueLineage(leagueId);
      _seasons = [];
      for (const id of [...chain].reverse()) {
        if (token !== _initToken) return;
        const l = await SleeperAPI.getLeague(id);
        if (l) _seasons.push({ leagueId: id, season: l.season, current: id === leagueId });
      }
      if (token !== _initToken) return;
      _renderSeasonBar();
    } catch(e) {}
  }

  function _renderSeasonBar() {
    const bar = document.getElementById("draft-season-bar");
    if (!bar || _seasons.length <= 1) { if (bar) bar.style.display = "none"; return; }
    const viewId = _viewingId || _leagueId;
    bar.style.display = "";
    bar.innerHTML = `
      <div class="season-bar-label">Season</div>
      <div class="season-bar-pills">
        ${_seasons.map(s => `
          <button class="season-pill ${s.leagueId === viewId ? "season-pill--current" : ""}"
            onclick="DLRDraft.switchSeason('${s.leagueId}')">
            ${s.season}${s.current ? " ★" : ""}
          </button>`).join("")}
      </div>`;
  }

  async function switchSeason(leagueId) {
    if (!leagueId) return;
    _viewingId = leagueId === _leagueId ? null : leagueId;
    _renderSeasonBar();
    const el = document.getElementById("dtab-draft");
    if (el) el.innerHTML = _loadingHTML("Loading draft…");
    const token = _initToken;
    await _loadDraft(leagueId, token);
  }

  // ── Load draft data ───────────────────────────────────────
  async function _loadDraft(leagueId, token) {
    const el = document.getElementById("dtab-draft");

    // Get all drafts for this league
    const drafts = await _fetchDrafts(leagueId);
    if (token !== _initToken) return;

    if (!drafts.length) {
      if (el) el.innerHTML = `<div class="draft-empty">
        <div style="font-size:2.5rem;margin-bottom:var(--space-3);">📋</div>
        <div style="font-weight:700;margin-bottom:var(--space-2);">No draft found</div>
        <div style="color:var(--color-text-dim);font-size:.88rem;">This league has no Sleeper draft recorded.</div>
      </div>`;
      return;
    }

    // Prefer rookie/linear over snake/startup for dynasty leagues
    const draft = drafts.find(d => d.type === "rookie" || d.type === "linear")
               || drafts.find(d => d.type !== "startup")
               || drafts[drafts.length - 1];

    // Fetch picks + roster/user data + traded picks for this specific draft
    // Use /v1/draft/{draft_id} for authoritative slot_to_roster_id and draft_order
    const [freshDraft, picks, rosters, users, tradedPicks] = await Promise.all([
      _fetchDraftById(draft.draft_id),
      _fetchPicks(draft.draft_id),
      SleeperAPI.getRosters(leagueId),
      SleeperAPI.getLeagueUsers(leagueId),
      _fetchTradedPicksForDraft(draft.draft_id)
    ]);
    if (token !== _initToken) return;

    // Merge fresh draft data (slot_to_roster_id may be more up to date)
    const draftObj = { ...draft, ...freshDraft };

    // Build maps
    const userMap = {}, rosterMap = {};
    users.forEach(u => { userMap[u.user_id] = u; });
    rosters.forEach(r => {
      const u = userMap[r.owner_id] || {};
      rosterMap[r.roster_id] = {
        teamName:    u.metadata?.team_name || u.display_name || u.username || `Team ${r.roster_id}`,
        username:    u.username || "",
        avatar:      u.avatar || null,
        roster_id:   r.roster_id,
        owner_id:    r.owner_id
      };
    });

    // Get players from IndexedDB-backed cache
    const players = DLRPlayers.all();

    _draftData = { draft: draftObj, picks, rosterMap, players, tradedPicks: tradedPicks || [] };
    if (token !== _initToken) return;
    _render(el);
  }

  async function _fetchDraftById(draftId) {
    try {
      const r = await fetch(`https://api.sleeper.app/v1/draft/${draftId}`);
      return r.ok ? await r.json() : {};
    } catch(e) { return {}; }
  }

  async function _fetchTradedPicksForDraft(draftId) {
    try {
      const r = await fetch(`https://api.sleeper.app/v1/draft/${draftId}/traded_picks`);
      return r.ok ? await r.json() : [];
    } catch(e) { return []; }
  }

  async function _fetchDrafts(leagueId) {
    try {
      const r = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`);
      return r.ok ? await r.json() : [];
    } catch(e) { return []; }
  }

  async function _fetchTradedPicks(leagueId) {
    try {
      const r = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/traded_picks`);
      return r.ok ? await r.json() : [];
    } catch(e) { return []; }
  }

  async function _fetchPicks(draftId) {
    try {
      const r = await fetch(`https://api.sleeper.app/v1/draft/${draftId}/picks`);
      return r.ok ? await r.json() : [];
    } catch(e) { return []; }
  }

  // ── Render board ──────────────────────────────────────────
  function _render(el) {
    if (!el || !_draftData) return;
    const { draft, picks, rosterMap, players, tradedPicks } = _draftData;

    const rounds  = draft.settings?.rounds || 4;
    const teams   = draft.settings?.teams  || 12;
    const isSnake = draft.type === "snake";
    const draftStatus = draft.status;

    // Build pick lookup: "round-pick" → pick data
    const pickMap = {};
    picks.forEach(p => {
      const key = `${p.round}-${p.draft_slot}`;
      pickMap[key] = p;
    });

    // Build slot owner map: key = "round-slot" using ORIGINAL (non-reversed) slot number
    // so traded pick lookups are consistent regardless of snake direction
    const slotOwners = {};  // "round-slot" → current owner roster_id (after trades)

    if (draft.slot_to_roster_id) {
      Object.entries(draft.slot_to_roster_id).forEach(([slot, rosterId]) => {
        for (let r = 1; r <= rounds; r++) {
          slotOwners[`${r}-${slot}`] = rosterId;
        }
      });
    }

    // Apply traded picks — Sleeper traded_picks format:
    // { round, roster_id (original slot team), owner_id (current owner), previous_owner_id }
    if (tradedPicks?.length) {
      tradedPicks.forEach(tp => {
        if (!tp.round || !tp.roster_id) return;
        // Find the original draft slot for this roster_id
        const originalSlot = Object.entries(draft.slot_to_roster_id || {})
          .find(([, rid]) => String(rid) === String(tp.roster_id))?.[0];
        if (!originalSlot) return;
        slotOwners[`${tp.round}-${originalSlot}`] = tp.owner_id;
      });
    }

    const draftTypeLabel = isSnake ? "🐍 Snake Draft" : "📋 Linear Draft";
    const statusColor = { complete:"var(--color-green)", drafting:"var(--color-gold)", pre_draft:"var(--color-text-dim)" }[draftStatus] || "var(--color-text-dim)";
    const statusLabel = { complete:"✅ Complete", drafting:"🔴 Live", pre_draft:"📅 Upcoming" }[draftStatus] || draftStatus;

    // For pre-draft with no slot order set yet — show a clear placeholder
    const hasSlotOrder = draft.slot_to_roster_id && Object.keys(draft.slot_to_roster_id).length > 0;
    if (draftStatus === "pre_draft" && !hasSlotOrder) {
      if (el) el.innerHTML = `
        <div class="draft-header-bar">
          <div class="draft-meta">
            <span class="draft-type-label">${draftTypeLabel}</span>
            <span class="draft-status" style="color:${statusColor}">● ${statusLabel}</span>
            <span class="dim">${rounds} rounds · ${teams} teams</span>
          </div>
        </div>
        <div class="draft-empty">
          <div style="font-size:2.5rem;margin-bottom:var(--space-3)">📅</div>
          <div style="font-weight:700;margin-bottom:var(--space-2)">Draft order not yet assigned</div>
          <div style="color:var(--color-text-dim);font-size:.88rem">
            The draft is scheduled but pick order hasn't been set yet.<br>
            Check back once the commissioner sets the draft order.
          </div>
        </div>`;
      return;
    }

    let boardHTML = "";
    for (let r = 1; r <= rounds; r++) {
      boardHTML += `<div class="draft-round"><div class="draft-round-label">Round ${r}</div><div class="draft-picks-row">`;

      for (let display = 1; display <= teams; display++) {
        // For snake, even rounds go right-to-left in display order
        const isReversed = isSnake && r % 2 === 0;
        // original slot = the slot in slot_to_roster_id (always 1..teams left to right)
        const originalSlot = isReversed ? (teams + 1 - display) : display;
        const overallNum   = (r - 1) * teams + display;
        const key          = `${r}-${String(originalSlot)}`;

        // Look up pick by round + original draft slot
        const pick         = picks.find(p => p.round === r && p.draft_slot === originalSlot);
        const currentOwner = slotOwners[key];
        const originalOwner = draft.slot_to_roster_id?.[String(originalSlot)];
        const isTraded     = currentOwner && String(currentOwner) !== String(originalOwner);
        const ownerRoster  = currentOwner ? rosterMap[currentOwner] : null;

        if (pick?.metadata?.first_name) {
          // Pick has been made
          const pName        = `${pick.metadata.first_name} ${pick.metadata.last_name}`;
          const pos          = (pick.metadata.position || "—").toUpperCase();
          const nfl          = pick.metadata.team || "FA";
          const color        = POS_COLOR[pos] || "#9ca3af";
          const pickerRoster = rosterMap[pick.roster_id];
          const pickLabel    = isSnake ? overallNum : `${r}.${String(originalSlot).padStart(2,"0")}`;

          boardHTML += `
            <div class="draft-pick draft-pick--filled"
              onclick="DLRPlayerCard.show('${pick.player_id}','${_escAttr(pName)}')"
              title="${_esc(pName)} · ${pos} · ${nfl}">
              <div class="draft-pick-num">${pickLabel}</div>
              <div class="draft-pick-player">
                <div class="draft-pick-name">${_esc(pName)}</div>
                <div class="draft-pick-meta">
                  <span class="draft-pos-badge" style="background:${color}22;color:${color};border-color:${color}55">${pos}</span>
                  <span class="draft-pick-nfl">${nfl}</span>
                </div>
              </div>
              <div class="draft-pick-team">${_esc(pickerRoster?.teamName || "")}</div>
            </div>`;
        } else {
          // Empty pick — show current owner (may be different from original after trades)
          const ownerName = ownerRoster?.teamName || (currentOwner ? `#${currentOwner}` : "");
          const pickLabel = isSnake ? overallNum : `${r}.${String(originalSlot).padStart(2,"0")}`;

          boardHTML += `
            <div class="draft-pick draft-pick--empty ${isTraded ? "draft-pick--traded" : ""}">
              <div class="draft-pick-num">${pickLabel}</div>
              <div class="draft-pick-owner">
                ${_esc(ownerName)}
                ${isTraded ? `<span class="draft-traded-badge">traded</span>` : ""}
              </div>
            </div>`;
        }
      }
      boardHTML += `</div></div>`;
    }

    el.innerHTML = `
      <div class="draft-header-bar">
        <div class="draft-meta">
          <span class="draft-type-label">${draftTypeLabel}</span>
          <span class="draft-status" style="color:${statusColor}">● ${statusLabel}</span>
          <span class="dim">${rounds} rounds · ${teams} teams</span>
        </div>
      </div>
      <div class="draft-board-scroll">
        <div class="draft-board">${boardHTML}</div>
      </div>`;
  }

  // ── MFL draft + auction history ───────────────────────────
  async function _loadMFLDraft(leagueId, season, token) {
    const el = document.getElementById("dtab-draft");
    const bundle = await MFLAPI.getLeagueBundle(leagueId, season);
    if (token !== _initToken) return;

    const teams = MFLAPI.getTeams(bundle);
    const teamMap = {};
    teams.forEach(t => { teamMap[String(t.id)] = t.name || `Team ${t.id}`; });

    // Draft picks — bundle.draft.draftResults.draftUnit[].draftPick[]
    const units = bundle?.draft?.draftResults?.draftUnit;
    const unitArr = units ? (Array.isArray(units) ? units : [units]) : [];
    const allPicks = [];
    unitArr.forEach(u => {
      const picks = u.draftPick ? (Array.isArray(u.draftPick) ? u.draftPick : [u.draftPick]) : [];
      picks.forEach(p => allPicks.push(p));
    });

    // Auction results — bundle.draft.draftResults could also have auction data
    // MFL auction picks have a "bidAmount" field
    const auctionPicks = allPicks.filter(p => p.bidAmount != null);
    const draftPicks   = allPicks.filter(p => p.bidAmount == null);
    const hasAuction   = auctionPicks.length > 0;
    const hasDraft     = draftPicks.length > 0 || (!hasAuction && allPicks.length > 0);

    _renderMFLDraftBoard(el, allPicks, auctionPicks, teamMap, hasAuction, hasDraft, season, leagueId);
  }

  function _renderMFLDraftBoard(el, allPicks, auctionPicks, teamMap, hasAuction, hasDraft, season, leagueId) {
    const showAuction = _viewMode === "auction" && hasAuction;

    const toggleBar = (hasAuction && hasDraft) ? `
      <div class="draft-toggle-bar">
        <button class="draft-toggle-btn ${!showAuction ? "draft-toggle-btn--active" : ""}"
          onclick="DLRDraft.setViewMode('draft')">📋 Draft Picks</button>
        <button class="draft-toggle-btn ${showAuction ? "draft-toggle-btn--active" : ""}"
          onclick="DLRDraft.setViewMode('auction')">🏷 Auction Results</button>
      </div>` : hasAuction ? `<div class="draft-meta-bar"><span class="draft-type-label">Auction Results</span></div>` : "";

    if (showAuction) {
      const sorted = [...auctionPicks].sort((a, b) => Number(b.bidAmount||0) - Number(a.bidAmount||0));
      el.innerHTML = `
        ${toggleBar}
        <div class="draft-auction-list">
          <div class="draft-auction-header">
            <span>Player</span><span>Team</span><span>Bid</span>
          </div>
          ${sorted.map((p, i) => {
            const pos   = (p.pos || "?").toUpperCase();
            const color = { QB:"#b89ffe",RB:"#18e07a",WR:"#00d4ff",TE:"#ffc94d" }[pos] || "#9ca3af";
            const name  = p.playerName || p.player || `Player ${p.player}`;
            const team  = teamMap[String(p.franchise)] || `Team ${p.franchise}`;
            const bid   = Number(p.bidAmount || 0);
            return `
              <div class="draft-auction-row">
                <span class="draft-auction-rank dim">${i+1}</span>
                <span class="draft-pos-badge" style="background:${color}22;color:${color};border-color:${color}55">${pos}</span>
                <span class="draft-auction-name">${_esc(name)}</span>
                <span class="draft-auction-team dim">${_esc(team)}</span>
                <span class="draft-auction-bid" style="color:var(--color-gold);font-family:var(--font-display);font-weight:700">
                  $${(bid/1000).toFixed(bid%1000===0?0:1)}K
                </span>
              </div>`;
          }).join("")}
        </div>`;
      return;
    }

    // Draft picks view
    const picks = allPicks.filter(p => p.bidAmount == null || allPicks.every(x => x.bidAmount == null));
    if (!picks.length) {
      el.innerHTML = toggleBar + `<div class="draft-empty"><div style="font-size:2.5rem">📋</div><div>No draft data found for ${season}.</div>
        <a href="https://www42.myfantasyleague.com/${season}/home/${leagueId}" target="_blank"
          style="color:var(--color-gold)">View on MFL ↗</a></div>`;
      return;
    }
    const sorted = [...picks].sort((a, b) => Number(a.pick||a.overall||0) - Number(b.pick||b.overall||0));
    el.innerHTML = toggleBar + `
      <div class="draft-auction-list">
        <div class="draft-auction-header"><span>Pick</span><span>Player</span><span>Team</span></div>
        ${sorted.map(p => {
          const pos   = (p.pos || "?").toUpperCase();
          const color = { QB:"#b89ffe",RB:"#18e07a",WR:"#00d4ff",TE:"#ffc94d" }[pos] || "#9ca3af";
          const name  = p.playerName || p.player || "—";
          const team  = teamMap[String(p.franchise)] || `Team ${p.franchise}`;
          const pick  = p.pick || p.overall || "—";
          return `
            <div class="draft-auction-row">
              <span class="draft-auction-rank" style="color:var(--color-text-dim)">${pick}</span>
              <span class="draft-pos-badge" style="background:${color}22;color:${color};border-color:${color}55">${pos}</span>
              <span class="draft-auction-name">${_esc(name)}</span>
              <span class="draft-auction-team dim">${_esc(team)}</span>
            </div>`;
        }).join("")}
      </div>`;
  }

  // ── Yahoo draft + auction history ──────────────────────────
  async function _loadYahooDraft(leagueId, leagueKey, token) {
    const el  = document.getElementById("dtab-draft");
    const key = leagueKey || `nfl.l.${leagueId}`;
    const bundle = await YahooAPI.getLeagueBundle(key);
    if (token !== _initToken) return;

    const teams    = bundle.teams    || [];
    const draft    = bundle.draft    || [];
    const teamMap  = {};
    teams.forEach(t => { teamMap[String(t.id)] = t.name || `Team ${t.id}`; });

    if (!draft.length) {
      el.innerHTML = `<div class="draft-empty">
        <div style="font-size:2.5rem">📋</div>
        <div style="font-weight:700;margin-bottom:var(--space-2)">No draft data available</div>
        <div class="dim" style="font-size:.85rem">Yahoo draft data may not be accessible for this league.</div>
      </div>`;
      return;
    }

    // Yahoo draft picks have a "cost" field for auction leagues
    const auctionPicks = draft.filter(p => p.cost != null && Number(p.cost) > 0);
    const hasAuction   = auctionPicks.length > 0;
    const showAuction  = _viewMode === "auction" && hasAuction;

    const toggleBar = hasAuction ? `
      <div class="draft-toggle-bar">
        <button class="draft-toggle-btn ${!showAuction ? "draft-toggle-btn--active" : ""}"
          onclick="DLRDraft.setViewMode('draft')">📋 Draft Order</button>
        <button class="draft-toggle-btn ${showAuction ? "draft-toggle-btn--active" : ""}"
          onclick="DLRDraft.setViewMode('auction')">🏷 Auction Results</button>
      </div>` : "";

    const displayPicks = showAuction
      ? [...auctionPicks].sort((a, b) => Number(b.cost||0) - Number(a.cost||0))
      : [...draft].sort((a, b) => Number(a.pick||a.round||0) - Number(b.pick||b.round||0));

    el.innerHTML = toggleBar + `
      <div class="draft-auction-list">
        <div class="draft-auction-header">
          ${showAuction
            ? `<span>Player</span><span>Team</span><span>Cost</span>`
            : `<span>Pick</span><span>Player</span><span>Team</span>`}
        </div>
        ${displayPicks.map((p, i) => {
          const pos   = (p.position || "?").toUpperCase();
          const color = { QB:"#b89ffe",RB:"#18e07a",WR:"#00d4ff",TE:"#ffc94d" }[pos] || "#9ca3af";
          const pid   = String(p.playerId || p.player_id || "");
          const name  = p.name || p.player_name || `Player ${pid}`;
          const team  = teamMap[String(p.teamId || p.team_id || "")] || "—";
          return `
            <div class="draft-auction-row">
              <span class="draft-auction-rank dim">${showAuction ? i+1 : (p.pick || `${p.round}.${p.pick_in_round||"?"}`)}</span>
              <span class="draft-pos-badge" style="background:${color}22;color:${color};border-color:${color}55">${pos}</span>
              <span class="draft-auction-name">${_esc(name)}</span>
              <span class="draft-auction-team dim">${_esc(team)}</span>
              ${showAuction ? `<span class="draft-auction-bid" style="color:var(--color-gold);font-family:var(--font-display);font-weight:700">$${Number(p.cost||0)}</span>` : ""}
            </div>`;
        }).join("")}
      </div>`;
  }

  function setViewMode(mode) {
    _viewMode = mode;
    // Re-trigger current platform's render
    const token = _initToken;
    if (_platform === "mfl")   _loadMFLDraft(_leagueId, _season, token);
    else if (_platform === "yahoo") _loadYahooDraft(_leagueId, _leagueKey, token);
  }

  // ── Helpers ────────────────────────────────────────────
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

  return { init, reset, switchSeason, setViewMode };

})();
