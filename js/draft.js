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
  let _myRosterId = null;   // current user's team ID
  let _seasons    = [];
  let _viewingId  = null;
  let _viewMode   = "draft";    // "draft" | "auction"
  let _layoutMode = "grid";     // "grid" | "list"
  let _auctionSort = "salary";  // "salary" | "name"

  // MFL data cache for re-renders without refetch
  let _mflCache   = null;
  
  // Yahoo data cache + pagination
  let _yahooCache = null;   // { draft, teams, myTeamId, teamMap, playerMap }
  let _yahooPage  = 0;      // current page for list view (25 per page)
  let _listPage   = 0;      // shared list pagination page — reset on each fresh load

  // Multiple-draft support (Sleeper only)
  let _allDrafts  = [];   // all drafts returned for this league/season
  let _draftIndex = 0;    // which draft is currently displayed

  const POS_COLOR = {
    QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff",
    TE:"#ffc94d", K:"#9ca3af", DEF:"#9ca3af"
  };

  // ── Init ──────────────────────────────────────────────────
  async function init(leagueId, platform, season, leagueKey, myRosterId) {
    _leagueId    = leagueId;
    _platform    = platform || "sleeper";
    _season      = season   || new Date().getFullYear().toString();
    _leagueKey   = leagueKey || null;
    _myRosterId  = myRosterId || null;
    _draftData  = null;
    _viewingId  = null;
    _viewMode   = "draft";
    _seasons    = [];
    _allDrafts  = [];
    _draftIndex = 0;
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
    _leagueId    = null;
    _draftData   = null;
    _myRosterId  = null;
    _seasons     = [];
    _viewingId   = null;
    _mflCache    = null;
    _yahooCache  = null;
    _listPage    = 0;
    _viewMode    = "draft";
    _layoutMode  = "grid";
    _auctionSort = "salary";
    _allDrafts   = [];
    _draftIndex  = 0;
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

    // Get all drafts for this league/season
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

    // Sort drafts: startup first, then by start_time ascending so the most
    // recent (rookie) draft shows at the end — user can navigate forward in time.
    const sorted = [...drafts].sort((a, b) => {
      // startup/snake before linear/rookie
      const typeRank = t => t === "snake" || t === "startup" ? 0 : 1;
      const tr = typeRank(a.type) - typeRank(b.type);
      if (tr !== 0) return tr;
      return (a.start_time || 0) - (b.start_time || 0);
    });
    // Filter out aborted drafts — a draft that shows as "complete" but has
    // fewer picks than one full round was almost certainly started and then
    // cancelled before anyone actually drafted. last_picked is the total number
    // of picks made on the draft object.
    const validDrafts = sorted.filter(d => {
      if (d.status !== "complete") return true;  // keep in-progress / upcoming
      const teams  = d.settings?.teams || 12;
      const picked = d.last_picked || 0;
      return picked >= teams;  // at least one full round completed
    });
    // If filtering removed everything, fall back to the full list so we still
    // show something (e.g. a league that cancelled mid-round 1)
    _allDrafts = validDrafts.length > 0 ? validDrafts : sorted;

    // Default: show the last draft in the sorted list (most likely the rookie
    // or most recent draft).  If _draftIndex is already set (user switched),
    // respect it — but clamp to valid range.
    if (_draftIndex >= _allDrafts.length) _draftIndex = _allDrafts.length - 1;
    // On first load, default to rookie draft (last) so dynasty users see the
    // more interesting data first.  Startup with kicker placeholders comes second.
    // If there's only one draft, index 0 is fine.
    if (_allDrafts.length > 1 && _draftIndex === 0) {
      _draftIndex = _allDrafts.length - 1;
    }

    await _loadDraftAtIndex(leagueId, _draftIndex, token);
  }

  // Load and render a specific draft by index in _allDrafts
  async function _loadDraftAtIndex(leagueId, index, token) {
    const el = document.getElementById("dtab-draft");
    const draft = _allDrafts[index];
    if (!draft) return;

    if (el) el.innerHTML = _loadingHTML("Loading draft…");

    // Fetch picks + roster/user data + traded picks for this specific draft
    const [freshDraft, picks, rosters, users, tradedPicks] = await Promise.all([
      _fetchDraftById(draft.draft_id),
      _fetchPicks(draft.draft_id),
      SleeperAPI.getRosters(leagueId),
      SleeperAPI.getLeagueUsers(leagueId),
      _fetchTradedPicksForDraft(draft.draft_id)
    ]);
    if (token !== _initToken) return;

    // Merge fresh draft data
    const draftObj = { ...draft, ...freshDraft };

    // Build maps
    const userMap = {}, rosterMap = {};
    users.forEach(u => { userMap[u.user_id] = u; });
    rosters.forEach(r => {
      const u = userMap[r.owner_id] || {};
      rosterMap[r.roster_id] = {
        teamName:  u.metadata?.team_name || u.display_name || u.username || `Team ${r.roster_id}`,
        username:  u.username || "",
        avatar:    u.avatar || null,
        roster_id: r.roster_id,
        owner_id:  r.owner_id
      };
    });

    const players = DLRPlayers.all();
    _draftData = { draft: draftObj, picks, rosterMap, players, tradedPicks: tradedPicks || [] };
    if (token !== _initToken) return;
    _render(el);
  }

  // Public: user tapped a draft selector pill
  function switchDraft(index) {
    _draftIndex = index;
    _viewMode   = "draft";  // reset to draft view when switching
    const token = _initToken;
    _loadDraftAtIndex(_leagueId, index, token);
  }

  // ── Draft label helper ────────────────────────────────────
  // Returns a short human-readable label for a Sleeper draft object
  function _draftLabel(d, index) {
    const typeLabel = {
      snake:   "Startup",
      startup: "Startup",
      linear:  "Rookie",
      auction: "Auction",
    }[d.type] || (d.type ? d.type.charAt(0).toUpperCase() + d.type.slice(1) : `Draft ${index + 1}`);

    const statusIcon = { complete: "✅", drafting: "🔴", pre_draft: "📅" }[d.status] || "";
    const season = d.season || "";
    return `${statusIcon} ${season} ${typeLabel}`.trim();
  }

  // ── Draft selector bar (rendered inside _render for Sleeper) ─
  function _renderDraftSelectorBar() {
    if (_allDrafts.length <= 1) return "";
    return `
      <div class="draft-selector-bar">
        <span class="draft-selector-label dim">Draft:</span>
        ${_allDrafts.map((d, i) => `
          <button class="draft-selector-pill ${i === _draftIndex ? "draft-selector-pill--active" : ""}"
            onclick="DLRDraft.switchDraft(${i})"
            title="${_esc(d.type || "")} · ${d.settings?.rounds || "?"} rounds">
            ${_esc(_draftLabel(d, i))}
          </button>`).join("")}
      </div>`;
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
        ${_renderDraftSelectorBar()}
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
      ${_renderDraftSelectorBar()}
      <div class="draft-header-bar">
        <div class="draft-meta">
          <span class="draft-type-label">${draftTypeLabel}</span>
          <span class="draft-status" style="color:${statusColor}">● ${statusLabel}</span>
          <span class="dim">${rounds} rounds · ${teams} teams</span>
        </div>
        <div class="draft-layout-toggle">
          <button class="draft-toggle-btn ${_layoutMode === "grid" ? "draft-toggle-btn--active" : ""}"
            onclick="DLRDraft.setLayoutMode('grid')" title="Grid view">⊞</button>
          <button class="draft-toggle-btn ${_layoutMode === "list" ? "draft-toggle-btn--active" : ""}"
            onclick="DLRDraft.setLayoutMode('list')" title="List view">☰</button>
        </div>
      </div>
      ${_layoutMode === "grid"
        ? `<div class="draft-board-scroll"><div class="draft-board">${boardHTML}</div></div>`
        : _buildSleeperListHTML(picks, rounds, teams, isSnake, rosterMap)
      }`;
  }

  function _buildSleeperListHTML(picks, rounds, teams, isSnake, rosterMap) {
    const sorted = [...picks]
      .filter(p => p.metadata?.first_name)
      .sort((a, b) => {
        if (a.round !== b.round) return a.round - b.round;
        return a.draft_slot - b.draft_slot;
      });

    if (!sorted.length) return `<div class="draft-empty"><div>No picks made yet.</div></div>`;

    const rows = sorted.map(p => {
      const display   = isSnake && p.round % 2 === 0 ? (teams + 1 - p.draft_slot) : p.draft_slot;
      const overall   = (p.round - 1) * teams + display;
      const pickLabel = isSnake ? overall : `${p.round}.${String(p.draft_slot).padStart(2,"0")}`;
      const pos   = (p.metadata?.position || "—").toUpperCase();
      const color = POS_COLOR[pos] || "#9ca3af";
      const name  = `${p.metadata.first_name} ${p.metadata.last_name}`;
      const nfl   = p.metadata?.team || "FA";
      const picker = rosterMap[p.roster_id]?.teamName || "";
      return `
        <div class="draft-auction-row" onclick="DLRPlayerCard.show('${p.player_id}','${_escAttr(name)}')" style="cursor:pointer">
          <span class="draft-auction-rank dim">${pickLabel}</span>
          <span class="draft-pos-badge" style="background:${color}22;color:${color};border-color:${color}55">${pos}</span>
          <div>
            <div class="draft-auction-name">${_esc(name)}</div>
            <div class="dim" style="font-size:.7rem">${nfl}</div>
          </div>
          <span class="draft-auction-team dim">${_esc(picker)}</span>
        </div>`;
    });

    const header = `<div class="draft-auction-header" style="grid-template-columns:60px 44px 1fr 1fr">
      <span>Pick</span><span>Pos</span><span>Player</span><span>Team</span>
    </div>`;
    return _buildPaginatedListHTML(rows, _listPage, header, "DLRDraft.setListPage");
  }

  // ── MFL draft + auction history ───────────────────────────
  async function _loadMFLDraft(leagueId, season, token) {
    const el = document.getElementById("dtab-draft");
    const bundle = await MFLAPI.getLeagueBundle(leagueId, season);
    if (token !== _initToken) return;

    const teams = MFLAPI.getTeams(bundle);
    const teamMap = {};
    teams.forEach(t => { teamMap[String(t.id)] = t.name || `Team ${t.id}`; });

    // Fetch session-cached player universe including league-custom players (pick proxies etc.)
    const playerLookup = await MFLAPI.getPlayers(season, leagueId);
    if (token !== _initToken) return;

    // Build division name map for labelling multi-unit drafts/auctions
    const { divisions } = MFLAPI.getDivisions(bundle);
    const divNameMap = {};  // divisionId → name
    divisions.forEach(d => { divNameMap[String(d.id)] = d.name; });

    // ── Draft units — keep per-unit for multi-draft selector ─
    const unitsRaw  = bundle?.draft?.draftResults?.draftUnit;
    const unitArr   = unitsRaw ? (Array.isArray(unitsRaw) ? unitsRaw : [unitsRaw]) : [];

    // Normalize each unit's picks into a flat array tagged with unitIndex
    const draftSets = unitArr.map((u, i) => {
      const picks = u.draftPick ? (Array.isArray(u.draftPick) ? u.draftPick : [u.draftPick]) : [];
      // Label: prefer explicit name, then division name, then fallback.
      // MFL encodes division ID as "DIVISION00", "DIVISION01", etc. in the unit field —
      // strip the prefix and zero-pad to match the division id from the league API (e.g. "00" → "0").
      let rawUnit = String(u.unit || u.division || "");
      let divId   = rawUnit;
      const divMatch = rawUnit.match(/^DIVISION(\d+)$/i);
      if (divMatch) {
        // MFL zero-pads to 2 digits; division IDs in the league API may be bare integers ("0","1")
        // or zero-padded ("00","01"). Try both.
        const n = parseInt(divMatch[1], 10);
        divId = divNameMap[String(n)] ? String(n)
              : divNameMap[String(n).padStart(2, "0")] ? String(n).padStart(2, "0")
              : rawUnit;
      }
      const divLabel = divNameMap[divId] || "";
      const label    = u.name || divLabel || (i === 0 ? "Startup Draft" : `Draft ${i + 1}`);
      return {
        label,
        divId,
        type:  "draft",
        picks: picks.map(p => ({
          ...p,
          franchise: p.franchise || p.franchiseId || p.franchise_id || ""
        }))
      };
    }).filter(s => s.picks.length > 0);

    // ── Auction results — support multiple units ─────────────
    // Real MFL shape from /mfl/auctionResults:
    //   { auctionResults: { auctionUnit: { auction: [...], unit: "LEAGUE" } } }
    //   OR multiple units: { auctionResults: { auctionUnit: [{...},{...}] } }
    // The bundle key is `auctionResults` → value is the full auctionResults response.
    // So bundle.auctionResults.auctionResults.auctionUnit is the unit or unit array.
    let auctionResultsRoot = bundle?.auctionResults?.auctionResults?.auctionUnit
                          || bundle?.auctionResults?.auctionUnit;  // direct shape from standalone fetch

    // If not in bundle (null/undefined), try a targeted fetch (non-fatal)
    if (!auctionResultsRoot) {
      try {
        const auctionData = await MFLAPI.getAuctionResultsDirect(leagueId, season);
        if (token !== _initToken) return;
        // Standalone response shape: { auctionResults: { auctionUnit: {...} } }
        auctionResultsRoot = auctionData?.auctionResults?.auctionUnit;
      } catch(e) {
        // Auction results not available — fine for draft-only leagues
      }
    }

    // Normalize auctionUnit (single object or array) into auctionSets
    let auctionSetsRaw = [];
    if (auctionResultsRoot) {
      const unitArr = Array.isArray(auctionResultsRoot) ? auctionResultsRoot : [auctionResultsRoot];
      auctionSetsRaw = unitArr;
    }

    const auctionSets = auctionSetsRaw.map((unit, i) => {
      const raw     = unit.auction ? (Array.isArray(unit.auction) ? unit.auction : [unit.auction]) : [];
      // MFL auction units: resolve division name from DIVISION00/01 pattern same as draft units
      let rawUnit   = String(unit.unit || unit.unit_id || unit.division || "");
      let divId     = rawUnit;
      const divMatchA = rawUnit.match(/^DIVISION(\d+)$/i);
      if (divMatchA) {
        const n = parseInt(divMatchA[1], 10);
        divId = divNameMap[String(n)] ? String(n)
              : divNameMap[String(n).padStart(2, "0")] ? String(n).padStart(2, "0")
              : rawUnit;
      }
      const divLabel = divNameMap[divId] || "";
      const rawLabel = unit.name || "";
      const label    = (rawLabel && rawLabel !== "LEAGUE")
        ? rawLabel
        : divLabel || (i === 0 ? "Auction" : `Auction ${i + 1}`);
      return {
        label,
        divId,
        type:  "auction",
        picks: raw.map(p => ({
          id:        String(p.player    || p.playerId || ""),
          franchise: String(p.franchise || p.franchiseId || ""),
          salary:    parseFloat(p.winningBid || p.amount || p.bid || 0),
          amount:    parseFloat(p.winningBid || p.amount || p.bid || 0),
        })).filter(p => p.id)
      };
    }).filter(s => s.picks.length > 0);

    const hasAuction = auctionSets.length > 0;
    const hasDraft   = draftSets.length  > 0;

    // Flatten for legacy code paths
    const allPicks  = draftSets.flatMap(s => s.picks);
    const salaryArr = auctionSets.flatMap(s => s.picks);

    // Default to the draft/auction unit matching the user's division.
    // Try by divId first (new), then fall back to existing getMyDraftUnitIndex logic.
    const myDivId = _myRosterId ? MFLAPI.getFranchiseDivision(bundle, _myRosterId) : null;

    let defaultDraftIdx = 0;
    if (myDivId && draftSets.length > 1) {
      const byDiv = draftSets.findIndex(s => s.divId === String(myDivId));
      defaultDraftIdx = byDiv >= 0 ? byDiv : MFLAPI.getMyDraftUnitIndex(unitArr, bundle, _myRosterId);
    } else {
      defaultDraftIdx = MFLAPI.getMyDraftUnitIndex(unitArr, bundle, _myRosterId);
    }

    let defaultAuctionIdx = 0;
    if (myDivId && auctionSets.length > 1) {
      const byDiv = auctionSets.findIndex(s => s.divId === String(myDivId));
      defaultAuctionIdx = byDiv >= 0 ? byDiv : 0;
    }

    _mflCache = {
      allPicks, salaryArr, teamMap, playerLookup,
      hasAuction, hasDraft, season, leagueId,
      draftSets, auctionSets,
      _activeDraftSetIdx:   defaultDraftIdx,
      _activeAuctionSetIdx: defaultAuctionIdx,
    };

    // Default view: auction if no draft data, draft otherwise. Only override if
    // current _viewMode doesn't match what's available.
    if (_viewMode === "draft"   && !hasDraft   && hasAuction) _viewMode = "auction";
    if (_viewMode === "auction" && !hasAuction && hasDraft)   _viewMode = "draft";
    // Fresh init with no selection — pick sensibly
    if (_viewMode !== "draft" && _viewMode !== "auction") {
      _viewMode = hasAuction && !hasDraft ? "auction" : "draft";
    }

    _renderMFLDraftBoard(el);
  }

  function _renderMFLDraftBoard(el) {
    if (!el) el = document.getElementById("dtab-draft");
    if (!el || !_mflCache) return;
    const { teamMap, playerLookup, hasAuction, hasDraft, season, leagueId,
            draftSets, auctionSets } = _mflCache;

    const showAuction = _viewMode === "auction";

    // Resolve active set + picks for current view
    let activeSet, allPicks, salaryArr;
    if (showAuction) {
      const idx  = Math.min(_mflCache._activeAuctionSetIdx || 0, (auctionSets?.length || 1) - 1);
      activeSet  = auctionSets?.[idx];
      salaryArr  = activeSet?.picks || _mflCache.salaryArr;
      allPicks   = _mflCache.allPicks;
    } else {
      const idx  = Math.min(_mflCache._activeDraftSetIdx || 0, (draftSets?.length || 1) - 1);
      activeSet  = draftSets?.[idx];
      allPicks   = activeSet?.picks || _mflCache.allPicks;
      salaryArr  = _mflCache.salaryArr;
    }

    // ── Multi-set pill selector ──────────────────────────────
    const sets      = showAuction ? (auctionSets || []) : (draftSets || []);
    const activeIdx = showAuction ? (_mflCache._activeAuctionSetIdx || 0) : (_mflCache._activeDraftSetIdx || 0);
    const setPills  = sets.length > 1
      ? `<div class="draft-selector-bar" style="margin-bottom:var(--space-2)">
          ${sets.map((s, i) =>
            `<button class="draft-selector-pill ${i === activeIdx ? "draft-selector-pill--active" : ""}"
              onclick="DLRDraft._mflSetActiveSet(${i})">${_esc(s.label)}</button>`
          ).join("")}
         </div>`
      : "";

    // Toggle bar: Draft Board / Auction Board + layout/sort toggles
    let toggleBar = "";
    if (hasAuction || hasDraft) {
      toggleBar = `<div class="draft-toggle-bar">`;
      if (hasDraft) {
        toggleBar += `<button class="draft-toggle-btn ${!showAuction ? "draft-toggle-btn--active" : ""}"
          onclick="DLRDraft.setViewMode('draft')">📋 Draft Board</button>`;
      }
      if (hasAuction) {
        toggleBar += `<button class="draft-toggle-btn ${showAuction ? "draft-toggle-btn--active" : ""}"
          onclick="DLRDraft.setViewMode('auction')">🏷 Auction Board</button>`;
      }
      if (!showAuction) {
        toggleBar += `
          <div style="margin-left:auto;display:flex;gap:4px">
            <button class="draft-toggle-btn ${_layoutMode === "grid" ? "draft-toggle-btn--active" : ""}"
              onclick="DLRDraft.setLayoutMode('grid')" title="Grid view">⊞</button>
            <button class="draft-toggle-btn ${_layoutMode === "list" ? "draft-toggle-btn--active" : ""}"
              onclick="DLRDraft.setLayoutMode('list')" title="List view">☰</button>
          </div>`;
      } else {
        toggleBar += `
          <div style="margin-left:auto;display:flex;gap:4px">
            <button class="draft-toggle-btn ${_auctionSort === "salary" ? "draft-toggle-btn--active" : ""}"
              onclick="DLRDraft.setAuctionSort('salary')">$ Salary</button>
            <button class="draft-toggle-btn ${_auctionSort === "name" ? "draft-toggle-btn--active" : ""}"
              onclick="DLRDraft.setAuctionSort('name')">A–Z Name</button>
          </div>`;
      }
      toggleBar += `</div>`;
    }

    // ── Auction board ────────────────────────────────────────
    if (showAuction) {
      const sorted = [...salaryArr].sort((a, b) => {
        if (_auctionSort === "name") {
          const na = (playerLookup[a.id]?.name || a.id || "").toLowerCase();
          const nb = (playerLookup[b.id]?.name || b.id || "").toLowerCase();
          return na.localeCompare(nb);
        }
        return Number(b.salary || b.amount || 0) - Number(a.salary || a.amount || 0);
      });
      el.innerHTML = setPills + toggleBar + `
        <div class="draft-auction-list">
          <div class="draft-auction-header" style="grid-template-columns:40px 44px 1fr 1fr auto">
            <span>#</span><span>Pos</span><span>Player</span><span>Team</span><span>Salary</span>
          </div>
          ${sorted.map((p, i) => {
            const info   = playerLookup[p.id] || {};
            // Resolve position — custom players may only have 'pos' or 'position'
            const pos    = (info.pos || info.position || "?").toUpperCase();
            const color  = POS_COLOR[pos] || "#9ca3af";
            // Name: use lookup name, fall back to a readable ID label
            const name   = info.name || (p.id ? `Player #${p.id}` : "Unknown");
            const tid    = String(p.franchise || p.franchiseId || "");
            const team   = teamMap[tid] || "—";
            const sal    = Number(p.salary || p.amount || 0);
            const salFmt = sal >= 1000000 ? `$${(sal/1000000).toFixed(sal%1000000===0?0:2)}M`
                         : sal > 0 ? `$${sal.toLocaleString()}` : "—";
            const sid    = info.sleeperId;
            // For custom players (draft picks), no player card — just show a dimmed indicator
            const isCustom = info.isCustom || (!info.name && !sid);
            const clickAttr = sid
              ? `onclick="DLRPlayerCard.show('${sid}','${_escAttr(name)}')" style="cursor:pointer"`
              : "";
            return `
              <div class="draft-auction-row" ${clickAttr}>
                <span class="draft-auction-rank dim">${i+1}</span>
                <span class="draft-pos-badge" style="background:${color}22;color:${color};border-color:${color}55">${pos}</span>
                <div>
                  <div class="draft-auction-name">${_esc(name)}</div>
                  ${isCustom && p.id ? `<div class="dim" style="font-size:.7rem">MFL #${p.id}</div>` : ""}
                </div>
                <span class="draft-auction-team dim">${_esc(team)}</span>
                <span class="draft-auction-bid" style="color:var(--color-gold);font-family:var(--font-display);font-weight:700">${salFmt}</span>
              </div>`;
          }).join("")}
        </div>`;
      return;
    }

    // ── Draft board ──────────────────────────────────────────
    if (!allPicks.length) {
      el.innerHTML = setPills + toggleBar + `
        <div class="draft-empty">
          <div style="font-size:2.5rem">📋</div>
          <div style="font-weight:700;margin-bottom:var(--space-2)">No draft data for ${season}</div>
          <a href="https://www42.myfantasyleague.com/${season}/home/${leagueId}" target="_blank"
            style="color:var(--color-gold)">View on MFL ↗</a>
        </div>`;
      return;
    }

    const sorted = [...allPicks].sort((a, b) => {
      const ra = Number(a.round || 0), rb = Number(b.round || 0);
      if (ra !== rb) return ra - rb;
      return Number(a.pick || a.overall || 0) - Number(b.pick || b.overall || 0);
    });

    if (_layoutMode === "list") {
      // List view with pagination
      const mflRows = sorted.map(p => {
        const pid      = p.player || p.playerId || "";
        const info     = playerLookup[pid] || {};
        const pos      = (info.pos || p.pos || "?").toUpperCase();
        const color    = POS_COLOR[pos] || "#9ca3af";
        const name     = info.name || p.playerName || "—";
        const team     = teamMap[String(p.franchise||"")] || "—";
        const round    = Number(p.round || 0);
        const pickNum  = Number(p.pick || 0);
        const pickLabel = round > 0 && pickNum > 0 ? `${round}.${String(pickNum).padStart(2,"0")}` : (p.overall || "—");
        const sid      = info.sleeperId;
        const cardId   = sid ? sid : (pid ? `mfl_${pid}` : null);
        const clickAttr = cardId
          ? `onclick="DLRPlayerCard.show('${cardId}','${_escAttr(name)}')" style="cursor:pointer;"` : "";
        return `
          <div class="draft-auction-row" ${clickAttr}>
            <span class="draft-auction-rank dim">${pickLabel}</span>
            <span class="draft-pos-badge" style="background:${color}22;color:${color};border-color:${color}55">${pos}</span>
            <div>
              <div class="draft-auction-name">${_esc(name)}</div>
              ${info.isCustom ? `<div class="dim" style="font-size:.7rem">Draft Pick</div>` : ""}
            </div>
            <span class="draft-auction-team dim">${_esc(team)}</span>
          </div>`;
      });
      const mflHeader = `<div class="draft-auction-header" style="grid-template-columns:60px 44px 1fr 1fr">
        <span>Pick</span><span>Pos</span><span>Player</span><span>Team</span>
      </div>`;
      el.innerHTML = setPills + toggleBar + _buildPaginatedListHTML(mflRows, _listPage, mflHeader, "DLRDraft.setListPage");
      return;
    }

    // Grid view — build round-by-round grid similar to Sleeper
    // Group picks by round and franchise
    const rounds = Math.max(...sorted.map(p => Number(p.round || 0)), 0);
    const teamIds = Object.keys(teamMap).length
      ? Object.keys(teamMap)
      : [...new Set(sorted.map(p => String(p.franchise||"")))];
    const numTeams = teamIds.length;

    // Build pick lookup: "round-franchise" → pick
    const pickMap = {};
    sorted.forEach(p => { pickMap[`${p.round}-${p.franchise}`] = p; });

    let boardHTML = "";
    for (let r = 1; r <= rounds; r++) {
      boardHTML += `<div class="draft-round"><div class="draft-round-label">Round ${r}</div><div class="draft-picks-row">`;
      // For MFL we don't have snake ordering info, just show picks in franchise order
      sorted.filter(p => Number(p.round) === r).forEach(p => {
        const pid   = p.player || p.playerId || "";
        const info  = playerLookup[pid] || {};
        const pos   = (info.pos || p.pos || "?").toUpperCase();
        const color = POS_COLOR[pos] || "#9ca3af";
        const name  = info.name || p.playerName || "—";
        const team  = teamMap[String(p.franchise||"")] || "—";
        const round = Number(p.round || 0);
        const pickNum = Number(p.pick || 0);
        const pickLabel = round > 0 && pickNum > 0 ? `${round}.${String(pickNum).padStart(2,"0")}` : (p.overall || "—");
        const sid   = info.sleeperId;
        const cardId = sid ? sid : (pid ? `mfl_${pid}` : null);
        const clickAttr = cardId
          ? `onclick="DLRPlayerCard.show('${cardId}','${_escAttr(name)}')" style="cursor:pointer;"` : "";

        if (name && name !== "—") {
          boardHTML += `
            <div class="draft-pick draft-pick--filled" ${clickAttr} title="${_esc(name)} · ${pos}">
              <div class="draft-pick-num">${pickLabel}</div>
              <div class="draft-pick-player">
                <div class="draft-pick-name">${_esc(name)}</div>
                <div class="draft-pick-meta">
                  <span class="draft-pos-badge" style="background:${color}22;color:${color};border-color:${color}55">${pos}</span>
                </div>
              </div>
              <div class="draft-pick-team">${_esc(team)}</div>
            </div>`;
        } else {
          boardHTML += `
            <div class="draft-pick draft-pick--empty">
              <div class="draft-pick-num">${pickLabel}</div>
              <div class="draft-pick-owner">${_esc(team)}</div>
            </div>`;
        }
      });
      boardHTML += `</div></div>`;
    }

    el.innerHTML = setPills + toggleBar + `
      <div class="draft-board-scroll">
        <div class="draft-board">${boardHTML}</div>
      </div>`;
  }

  // ── Yahoo draft + auction history ──────────────────────────
  async function _loadYahooDraft(leagueId, leagueKey, token) {
    const el  = document.getElementById("dtab-draft");
    const key = leagueKey || `nfl.l.${leagueId}`;

    await DLRPlayers.load();
    if (token !== _initToken) return;

    const bundle = await YahooAPI.getLeagueBundle(key);
    if (token !== _initToken) return;

    const teams    = bundle.teams    || [];
    const draft    = bundle.draft    || [];
    const myTeamId = bundle.myTeamId || _myRosterId || null;
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

    // ── Enrich picks with DynastyProcess player data ─────────────────────────
    // Worker returns name="" and position="?" for most leagues since draftresults
    // doesn't include player details. Resolve via yahoo_id → Sleeper record → CSV fallback.
    const playerMap = {};  // pid → { name, pos, sleeperPid, nflTeam }
    draft.forEach(p => {
      const pid = String(p.playerId || "");
      if (!pid || playerMap[pid]) return;
      const map      = DLRPlayers.getByYahooId(pid);
      const sleeperP = map?.sleeper_id ? DLRPlayers.get(map.sleeper_id) : null;
      let name = p.name || "";
      let pos  = (p.position || "?").toUpperCase();
      let nflTeam = "";
      if (sleeperP && Object.keys(sleeperP).length > 5) {
        name    = `${sleeperP.first_name || ""} ${sleeperP.last_name || ""}`.trim() || name;
        pos     = (sleeperP.position || pos).toUpperCase();
        nflTeam = sleeperP.team || "";
      } else if (map) {
        name    = map.name || name;
        pos     = (map.position || pos).toUpperCase();
        nflTeam = map.team || "";
      }
      // Final fallback: bundle rosters playerDetails
      if (!name) {
        const detail = (bundle.rosters || []).flatMap(r => r.playerDetails || []).find(d => String(d.id) === pid);
        if (detail?.name) { name = detail.name; pos = (detail.position || pos).toUpperCase(); nflTeam = detail.nflTeam || ""; }
      }
      const sleeperPid = map?.sleeper_id || null;
      playerMap[pid] = { name: name || `Player ${pid}`, pos, nflTeam, sleeperPid };
    });

    // Cache for re-renders (view/layout/page switches)
    _yahooCache = { draft, teams, myTeamId, teamMap, playerMap };
    _listPage   = 0;
    _renderYahooDraftBoard(el);
  }

  function _renderYahooDraftBoard(el) {
    if (!_yahooCache) return;
    const { draft, myTeamId, teamMap, playerMap } = _yahooCache;
    el = el || document.getElementById("dtab-draft");
    if (!el) return;

    const auctionPicks = draft.filter(p => p.cost != null && Number(p.cost) > 0);
    const hasAuction   = auctionPicks.length > 0;
    const showAuction  = _viewMode === "auction" && hasAuction;

    // ── Toggle bar: Draft Order / Auction / Grid / List ──────────────────────
    const viewBtns = [
      !showAuction && _layoutMode === "grid" ? `<button class="draft-toggle-btn draft-toggle-btn--active" onclick="DLRDraft.setLayoutMode('grid')">⊞ Grid</button>`
        : `<button class="draft-toggle-btn" onclick="DLRDraft.setLayoutMode('grid')">⊞ Grid</button>`,
      !showAuction && _layoutMode === "list" ? `<button class="draft-toggle-btn draft-toggle-btn--active" onclick="DLRDraft.setLayoutMode('list')">☰ List</button>`
        : `<button class="draft-toggle-btn" onclick="DLRDraft.setLayoutMode('list')">☰ List</button>`,
      hasAuction
        ? (showAuction
            ? `<button class="draft-toggle-btn draft-toggle-btn--active" onclick="DLRDraft.setViewMode('auction')">🏷 Auction</button>`
            : `<button class="draft-toggle-btn" onclick="DLRDraft.setViewMode('auction')">🏷 Auction</button>`)
        : "",
    ].filter(Boolean).join("");
    const toggleBar = `<div class="draft-toggle-bar">${viewBtns}</div>`;

    // ── Auction list view ─────────────────────────────────────────────────────
    if (showAuction) {
      const sorted = [...auctionPicks].sort((a, b) => Number(b.cost||0) - Number(a.cost||0));
      const rows = sorted.map((p, i) => {
        const pid      = String(p.playerId || "");
        const info     = playerMap[pid] || { name: `Player ${pid}`, pos: "?", nflTeam: "" };
        const color    = POS_COLOR[info.pos] || "#9ca3af";
        const fantTeam = teamMap[String(p.teamId || "")] || "—";
        const isMe     = myTeamId && String(p.teamId || "") === String(myTeamId);
        const cardId   = info.sleeperPid || (pid ? `yahoo_${pid}` : null);
        const clickAttr = cardId ? `onclick="DLRPlayerCard.show('${cardId}','${_escAttr(info.name)}')" style="cursor:pointer"` : "";
        return `
          <div class="draft-auction-row${isMe ? " draft-auction-row--mine" : ""}" ${clickAttr}
            ${isMe ? `style="background:var(--color-surface-2);cursor:pointer"` : ""}>
            <span class="draft-auction-rank dim">${i + 1}</span>
            <span class="draft-pos-badge" style="background:${color}22;color:${color};border-color:${color}55">${info.pos}</span>
            <div>
              <div class="draft-auction-name">${_esc(info.name)}</div>
              ${info.nflTeam ? `<div class="dim" style="font-size:.7rem">${_esc(info.nflTeam)}</div>` : ""}
            </div>
            <span class="draft-auction-team dim">${_esc(fantTeam)}${isMe ? ' <span style="color:var(--color-gold);font-size:.7rem">▶</span>' : ""}</span>
            <span class="draft-auction-bid" style="color:var(--color-gold);font-family:var(--font-display);font-weight:700">$${Number(p.cost||0)}</span>
          </div>`;
      });
      const header = `<div class="draft-auction-header" style="grid-template-columns:44px 44px 1fr 1fr 60px">
        <span>#</span><span>Pos</span><span>Player</span><span>Team</span><span>Cost</span>
      </div>`;
      el.innerHTML = toggleBar + _buildPaginatedListHTML(rows, _listPage, header, "DLRDraft.setListPage");
      return;
    }

    const sortedDraft = [...draft].sort((a, b) => Number(a.pick||0) - Number(b.pick||0));
    const numTeams    = _yahooCache.teams.length || 12;
    const numRounds   = sortedDraft.length ? Math.ceil(sortedDraft.length / numTeams) : 0;

    // ── List view ─────────────────────────────────────────────────────────────
    if (_layoutMode === "list") {
      const rows = sortedDraft.map(p => {
        const pid      = String(p.playerId || "");
        const info     = playerMap[pid] || { name: `Player ${pid}`, pos: "?", nflTeam: "" };
        const color    = POS_COLOR[info.pos] || "#9ca3af";
        const fantTeam = teamMap[String(p.teamId || "")] || "—";
        const isMe     = myTeamId && String(p.teamId || "") === String(myTeamId);
        const pickInRound = numTeams > 0 ? ((Number(p.pick||0) - 1) % numTeams) + 1 : (p.pick || "?");
        const pickLabel   = p.round ? `${p.round}.${String(pickInRound).padStart(2,"0")}` : (p.pick || "?");
        const cardId   = info.sleeperPid || (pid ? `yahoo_${pid}` : null);
        const clickAttr = cardId ? `onclick="DLRPlayerCard.show('${cardId}','${_escAttr(info.name)}')" style="cursor:pointer"` : "";
        return `
          <div class="draft-auction-row${isMe ? " draft-auction-row--mine" : ""}" ${clickAttr}
            ${isMe && !cardId ? `style="background:var(--color-surface-2)"` : ""}>
            <span class="draft-auction-rank dim">${pickLabel}</span>
            <span class="draft-pos-badge" style="background:${color}22;color:${color};border-color:${color}55">${info.pos}</span>
            <div>
              <div class="draft-auction-name">${_esc(info.name)}</div>
              ${info.nflTeam ? `<div class="dim" style="font-size:.7rem">${_esc(info.nflTeam)}</div>` : ""}
            </div>
            <span class="draft-auction-team dim">${_esc(fantTeam)}${isMe ? ' <span style="color:var(--color-gold);font-size:.7rem">▶</span>' : ""}</span>
            ${p.isKeeper ? `<span style="font-size:.65rem;color:var(--color-accent);font-weight:700;letter-spacing:.03em">K</span>` : ""}
          </div>`;
      });
      const header = `<div class="draft-auction-header" style="grid-template-columns:60px 44px 1fr 1fr">
        <span>Pick</span><span>Pos</span><span>Player</span><span>Team</span>
      </div>`;
      el.innerHTML = toggleBar + _buildPaginatedListHTML(rows, _listPage, header, "DLRDraft.setListPage");
      return;
    }

    // ── Grid view ─────────────────────────────────────────────────────────────
    if (!numRounds || !numTeams) {
      el.innerHTML = toggleBar + `<div class="draft-empty"><div>No picks to display.</div></div>`;
      return;
    }
    // Build lookup: pick number → pick data
    const pickByNum = {};
    sortedDraft.forEach(p => { if (p.pick) pickByNum[Number(p.pick)] = p; });

    let boardHTML = "";
    for (let r = 1; r <= numRounds; r++) {
      boardHTML += `<div class="draft-round"><div class="draft-round-label">Round ${r}</div><div class="draft-picks-row">`;
      for (let slot = 1; slot <= numTeams; slot++) {
        const overall = (r - 1) * numTeams + slot;
        const p       = pickByNum[overall];
        const pickLabel = `${r}.${String(slot).padStart(2,"0")}`;
        if (p) {
          const pid      = String(p.playerId || "");
          const info     = playerMap[pid] || { name: "", pos: "?", nflTeam: "" };
          const color    = POS_COLOR[info.pos] || "#9ca3af";
          const fantTeam = teamMap[String(p.teamId || "")] || "—";
          const isMe     = myTeamId && String(p.teamId || "") === String(myTeamId);
          const cardId   = info.sleeperPid || (pid ? `yahoo_${pid}` : null);
          const clickAttr = cardId ? `onclick="DLRPlayerCard.show('${cardId}','${_escAttr(info.name)}')" style="cursor:pointer"` : "";
          if (info.name) {
            boardHTML += `
              <div class="draft-pick draft-pick--filled${isMe ? " draft-pick--mine" : ""}" ${clickAttr}
                title="${_esc(info.name)} · ${info.pos}">
                <div class="draft-pick-num">${pickLabel}</div>
                <div class="draft-pick-player">
                  <div class="draft-pick-name">${_esc(info.name)}${p.isKeeper ? ' <span style="font-size:.6rem;color:var(--color-accent);font-weight:700">K</span>' : ""}</div>
                  <div class="draft-pick-meta">
                    <span class="draft-pos-badge" style="background:${color}22;color:${color};border-color:${color}55">${info.pos}</span>
                    ${info.nflTeam ? `<span class="draft-pick-nfl">${_esc(info.nflTeam)}</span>` : ""}
                  </div>
                </div>
                <div class="draft-pick-team">${_esc(fantTeam)}</div>
              </div>`;
          } else {
            boardHTML += `
              <div class="draft-pick draft-pick--empty">
                <div class="draft-pick-num">${pickLabel}</div>
                <div class="draft-pick-owner">${_esc(fantTeam)}</div>
              </div>`;
          }
        } else {
          boardHTML += `
            <div class="draft-pick draft-pick--empty">
              <div class="draft-pick-num">${pickLabel}</div>
            </div>`;
        }
      }
      boardHTML += `</div></div>`;
    }
    el.innerHTML = toggleBar + `<div class="draft-board-scroll"><div class="draft-board">${boardHTML}</div></div>`;
  }

  function setViewMode(mode) {
    _viewMode = mode;
    _listPage = 0;
    if (_platform === "mfl" && _mflCache) {
      _renderMFLDraftBoard();
    } else if (_platform === "yahoo" && _yahooCache) {
      _renderYahooDraftBoard();
    } else if (_platform === "yahoo") {
      const token = _initToken;
      _loadYahooDraft(_leagueId, _leagueKey, token);
    } else if (_platform === "sleeper" && _draftData) {
      const el = document.getElementById("dtab-draft");
      _render(el);
    }
  }

  function setLayoutMode(mode) {
    _layoutMode = mode;
    _listPage   = 0;
    if (_platform === "mfl" && _mflCache) {
      _renderMFLDraftBoard();
    } else if (_platform === "yahoo" && _yahooCache) {
      _renderYahooDraftBoard();
    } else if (_platform === "sleeper" && _draftData) {
      const el = document.getElementById("dtab-draft");
      _render(el);
    }
  }

  function setAuctionSort(sort) {
    _auctionSort = sort;
    if (_platform === "mfl" && _mflCache) _renderMFLDraftBoard();
  }

  // ── Shared paginated list renderer ────────────────────────
  // rows: array of HTML strings. page: current 0-based page. header: header HTML.
  // onPageChange: JS expression like "DLRDraft.setListPage" called with new page number.
  const PAGE_SIZE = 25;
  function _buildPaginatedListHTML(rows, page, header, onPageChange) {
    const totalPages = Math.ceil(rows.length / PAGE_SIZE);
    const safePage   = Math.max(0, Math.min(page, totalPages - 1));
    const slice      = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
    const pagination = totalPages > 1 ? `
      <div class="draft-pagination">
        <button class="draft-toggle-btn" ${safePage === 0 ? "disabled" : ""}
          onclick="${onPageChange}(${safePage - 1})">‹ Prev</button>
        <span class="dim" style="font-size:.85rem">Page ${safePage + 1} of ${totalPages}</span>
        <button class="draft-toggle-btn" ${safePage >= totalPages - 1 ? "disabled" : ""}
          onclick="${onPageChange}(${safePage + 1})">Next ›</button>
      </div>` : "";
    return `
      <div class="draft-auction-list">
        ${header}
        ${slice.join("")}
      </div>
      ${pagination}`;
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

  return {
    init, reset, switchSeason, switchDraft, setViewMode, setLayoutMode, setAuctionSort,
    setListPage(page) {
      _listPage = page;
      if (_platform === "yahoo" && _yahooCache) { _renderYahooDraftBoard(); }
      else if (_platform === "mfl" && _mflCache) { _renderMFLDraftBoard(); }
      else if (_platform === "sleeper" && _draftData) { const el = document.getElementById("dtab-draft"); _render(el); }
    },
    _mflSetActiveSet(idx) {
      if (!_mflCache) return;
      if (_viewMode === "auction") _mflCache._activeAuctionSetIdx = idx;
      else                         _mflCache._activeDraftSetIdx   = idx;
      _renderMFLDraftBoard();
    }
  };

})();
