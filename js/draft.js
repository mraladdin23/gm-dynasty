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
  let _initToken  = 0;
  let _draftData  = null;  // { draft, picks, teams, players }
  let _seasons    = [];    // [{ leagueId, season, current }]
  let _viewingId  = null;  // null = current league

  const POS_COLOR = {
    QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff",
    TE:"#ffc94d", K:"#9ca3af", DEF:"#9ca3af"
  };

  // ── Init ──────────────────────────────────────────────────
  async function init(leagueId, platform) {
    _leagueId  = leagueId;
    _platform  = platform || "sleeper";
    _draftData = null;
    _viewingId = null;
    _initToken++;
    const token = _initToken;

    const el = document.getElementById("dtab-draft");
    if (!el) return;

    if (_platform !== "sleeper") {
      el.innerHTML = `<div class="empty-state" style="padding:var(--space-8);text-align:center;">
        <div style="font-size:2rem;margin-bottom:var(--space-3);">📋</div>
        <div style="font-weight:600;">MFL draft board coming soon</div>
      </div>`;
      return;
    }

    el.innerHTML = _loadingHTML("Loading draft board…");

    try {
      // Load seasons chain non-blocking
      _loadSeasons(leagueId, token);
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

    // Fetch picks + roster/user data in parallel
    const [picks, rosters, users] = await Promise.all([
      _fetchPicks(draft.draft_id),
      SleeperAPI.getRosters(leagueId),
      SleeperAPI.getLeagueUsers(leagueId)
    ]);
    if (token !== _initToken) return;

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

    // Get players from cache
    let players = {};
    try { players = JSON.parse(localStorage.getItem("dlr_players") || "{}"); } catch(e) {}

    _draftData = { draft, picks, rosterMap, players };
    if (token !== _initToken) return;
    _render(el);
  }

  async function _fetchDrafts(leagueId) {
    try {
      const r = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`);
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
    const { draft, picks, rosterMap, players } = _draftData;

    const rounds  = draft.settings?.rounds || 4;
    const teams   = draft.settings?.teams  || 12;
    const isSnake = draft.type === "snake";
    const draftStatus = draft.status; // "pre_draft" | "drafting" | "complete"

    // Build pick lookup: "round-pick" → pick data
    const pickMap = {};
    picks.forEach(p => {
      const key = `${p.round}-${p.draft_slot}`;
      pickMap[key] = p;
    });

    // Build slot owner map from draft.slot_to_roster_id
    const slotOwners = {};
    if (draft.slot_to_roster_id) {
      Object.entries(draft.slot_to_roster_id).forEach(([slot, rosterId]) => {
        for (let r = 1; r <= rounds; r++) {
          const isReversed = isSnake && r % 2 === 0;
          const pick = isReversed ? String(teams + 1 - Number(slot)) : String(slot);
          slotOwners[`${r}-${pick}`] = rosterId;
        }
      });
    }

    const draftTypeLabel = isSnake ? "🐍 Snake Draft" : "📋 Linear Draft";
    const statusColor = { complete:"var(--color-green)", drafting:"var(--color-gold)", pre_draft:"var(--color-text-dim)" }[draftStatus] || "var(--color-text-dim)";
    const statusLabel = { complete:"Complete", drafting:"In Progress", pre_draft:"Not Started" }[draftStatus] || draftStatus;

    let boardHTML = "";
    for (let r = 1; r <= rounds; r++) {
      boardHTML += `
        <div class="draft-round">
          <div class="draft-round-label">Round ${r}</div>
          <div class="draft-picks-row">`;

      for (let slot = 1; slot <= teams; slot++) {
        const isReversed  = isSnake && r % 2 === 0;
        const pickSlot    = isReversed ? (teams + 1 - slot) : slot;
        const key         = `${r}-${pickSlot}`;
        const overallNum  = (r - 1) * teams + slot;
        const pick        = pickMap[key];
        const ownerRoster = slotOwners[key] ? rosterMap[slotOwners[key]] : null;

        if (pick?.metadata?.first_name) {
          // Pick made
          const pName = `${pick.metadata.first_name} ${pick.metadata.last_name}`;
          const pos   = (pick.metadata.position || "—").toUpperCase();
          const nfl   = pick.metadata.team || "FA";
          const color = POS_COLOR[pos] || "#9ca3af";
          const pickerRoster = rosterMap[pick.roster_id];

          boardHTML += `
            <div class="draft-pick draft-pick--filled"
              onclick="DLRPlayerCard.show('${pick.player_id}', '${_escAttr(pName)}')"
              title="${_esc(pName)} · ${pos} · ${nfl}">
              <div class="draft-pick-num">${isSnake ? overallNum : `${r}.${String(pickSlot).padStart(2,"0")}`}</div>
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
          // Empty pick
          boardHTML += `
            <div class="draft-pick draft-pick--empty">
              <div class="draft-pick-num">${isSnake ? overallNum : `${r}.${String(pickSlot).padStart(2,"0")}`}</div>
              <div class="draft-pick-owner">${_esc(ownerRoster?.teamName || "")}</div>
            </div>`;
        }
      }
      boardHTML += `</div></div>`;
    }

    el.innerHTML = `
      <div class="draft-header-bar">
        <div id="draft-season-bar" style="display:none;margin-bottom:var(--space-3);"></div>
        <div class="draft-meta">
          <span class="draft-type-label">${draftTypeLabel}</span>
          <span class="draft-status" style="color:${statusColor}">● ${statusLabel}</span>
          <span class="dim">${rounds} rounds · ${teams} teams</span>
        </div>
      </div>
      <div class="draft-board-scroll">
        <div class="draft-board">${boardHTML}</div>
      </div>`;

    // Season bar may be ready by now
    _renderSeasonBar();
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

  return { init, reset, switchSeason };

})();
