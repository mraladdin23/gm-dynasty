// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Roster View
//  - Starters + bench combined, grouped by position,
//    ordered by Sleeper rank within each position group
//  - IR and Taxi Squad shown separately
//  - Click any player to open player card modal
// ─────────────────────────────────────────────────────────

const DLRRoster = (() => {

  let _leagueId   = null;
  let _platform   = "sleeper";
  let _rosterData = null;
  let _players    = {};
  let _initToken  = 0;
  let _filter     = "all";
  let _leagueKey  = null;   // Yahoo full league key e.g. "nfl.l.12345"
  let _myRosterId = null;   // current user's team ID — used to default-filter

  const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const POS_COLOR = {
    QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff",
    TE:"#ffc94d", K:"#9ca3af", DEF:"#9ca3af"
  };

  let _season = null;

  // ── Init ─────────────────────────────────────────────────
  async function init(leagueId, platform, season, leagueKey, myRosterId) {
    _leagueId   = leagueId;
    _platform   = platform || "sleeper";
    _season     = season   || new Date().getFullYear().toString();
    _leagueKey  = leagueKey || null;
    _myRosterId = myRosterId || null;
    _rosterData = null;
    _filter     = "all";
    _initToken++;
    const token = _initToken;

    const el = document.getElementById("dtab-roster");
    if (!el) return;

    if (_platform !== "sleeper") {
      const loadMsg = _platform === "yahoo" ? "Loading Yahoo rosters…" : "Loading MFL rosters…";
      el.innerHTML = _loadingHTML(loadMsg);
      try {
        if (_platform === "mfl") {
          await _loadMFLData(leagueId, token);
        } else {
          await _loadYahooData(leagueId, token);
        }
      } catch(e) {
        if (token !== _initToken) return;
        el.innerHTML = _errorHTML(`Could not load ${_platform.toUpperCase()} rosters: ` + e.message);
      }
      return;
    }

    el.innerHTML = _loadingHTML("Loading rosters…");

    try {
      await _loadData(leagueId, token);
    } catch(e) {
      if (token !== _initToken) return;
      el.innerHTML = _errorHTML("Could not load rosters: " + e.message);
    }
  }

  function reset() {
    _leagueId    = null;
    _rosterData  = null;
    _myRosterId  = null;
    _filter      = "all";
    _leagueKey  = null;
    _initToken++;
  }

  // ── Load data ─────────────────────────────────────────────
  async function _loadData(leagueId, token) {
    const el = document.getElementById("dtab-roster");

    // Load player DB first (may already be cached)
    _players = await _getPlayers(el, token);
    if (token !== _initToken) return;

    const [league, rosters, users] = await Promise.all([
      SleeperAPI.getLeague(leagueId),
      SleeperAPI.getRosters(leagueId),
      SleeperAPI.getLeagueUsers(leagueId)
    ]);
    if (token !== _initToken) return;

    const userMap = {};
    (users || []).forEach(u => { userMap[u.user_id] = u; });

    const teams = (rosters || []).map(r => {
      const u = userMap[r.owner_id] || {};
      return {
        roster_id: r.roster_id,
        owner_id:  r.owner_id,
        teamName:  u.metadata?.team_name || u.display_name || u.username || `Team ${r.roster_id}`,
        username:  u.username || "",
        avatar:    u.avatar || null,
        players:   r.players  || [],
        reserve:   r.reserve  || [],
        taxi:      r.taxi     || [],
        wins:      r.settings?.wins   || 0,
        losses:    r.settings?.losses || 0,
        fpts:      (r.settings?.fpts || 0) + (r.settings?.fpts_decimal || 0) / 100,
      };
    }).sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);

    _rosterData = { teams, league };
    _render();
  }

  async function _getPlayers(el, token) {
    try {
      // Use DLRPlayers module (IndexedDB-backed, no quota issues)
      if (el) el.innerHTML = _loadingHTML("Loading player database…");
      const players = await DLRPlayers.load();
      return players;
    } catch(e) {
      console.warn("[Roster] Player load failed:", e.message);
      return {};
    }
  }

  // ── Render ────────────────────────────────────────────────
  function _render() {
    const el = document.getElementById("dtab-roster");
    if (!el || !_rosterData) return;
    const { teams } = _rosterData;

    const opts = [
      `<option value="all">All Teams (${teams.length})</option>`,
      ...teams.map(t =>
        `<option value="${t.roster_id}" ${String(t.roster_id) === String(_filter) ? "selected" : ""}>${_esc(t.teamName)}</option>`
      )
    ].join("");

    el.innerHTML = `
      <div class="roster-toolbar">
        <select class="roster-team-select" onchange="DLRRoster.setFilter(this.value)">
          ${opts}
        </select>
      </div>
      <div id="roster-cards-container">
        ${teams.map(t => _teamCardHTML(t)).join("")}
      </div>`;

    _applyFilter();
  }

  function setFilter(val) {
    _filter = val === "all" ? "all" : String(val);
    _applyFilter();
  }

  function _applyFilter() {
    document.querySelectorAll(".roster-team-card").forEach(card => {
      const rid = String(card.dataset.rosterId);
      const show = _filter === "all" || String(_filter) === rid;
      card.style.display = show ? "" : "none";
    });
  }

  // ── Team card ─────────────────────────────────────────────
  function _teamCardHTML(team) {
    const initial = (team.teamName || "?")[0].toUpperCase();
    const isMe    = _myRosterId && String(team.roster_id) === String(_myRosterId);
    const avatar  = team.avatar
      ? `<img src="https://sleepercdn.com/avatars/thumbs/${team.avatar}" class="roster-avatar" onerror="this.style.display='none'">`
      : `<div class="roster-avatar-placeholder" style="${isMe ? "background:var(--color-gold);color:#000;" : ""}">${initial}</div>`;

    // Main roster = players minus reserve and taxi
    const reserveSet = new Set(team.reserve);
    const taxiSet    = new Set(team.taxi);
    const mainRoster = team.players.filter(id => !reserveSet.has(id) && !taxiSet.has(id));

    // Group main roster by position, sorted by rank within group
    const byPos = {};
    POS_ORDER.forEach(p => { byPos[p] = []; });
    byPos["—"] = [];

    mainRoster.forEach(id => {
      const p   = _players[id] || {};
      const pos = (p.fantasy_positions?.[0] || p.position || "—").toUpperCase();
      const grp = POS_ORDER.includes(pos) ? pos : "—";
      byPos[grp].push({ id, player: p, rank: p.search_rank || p.rank || 9999 });
    });

    // Sort each group by rank
    Object.values(byPos).forEach(arr => arr.sort((a, b) => a.rank - b.rank));

    // Build position group sections
    let rosterHTML = "";
    for (const pos of [...POS_ORDER, "—"]) {
      const group = byPos[pos];
      if (!group.length) continue;
      rosterHTML += `
        <div class="roster-pos-group">
          <div class="roster-pos-header" style="color:${POS_COLOR[pos] || "var(--color-text-dim)"}">
            ${pos}
            <span class="roster-pos-count">${group.length}</span>
          </div>
          ${group.map(({ id }) => _playerRowHTML(id)).join("")}
        </div>`;
    }

    // IR
    let irHTML = "";
    if (team.reserve.length) {
      irHTML = `
        <div class="roster-special-section">
          <div class="roster-special-label">🏥 Injured Reserve</div>
          ${team.reserve.map(id => _playerRowHTML(id, "ir")).join("")}
        </div>`;
    }

    // Taxi
    let taxiHTML = "";
    if (team.taxi.length) {
      taxiHTML = `
        <div class="roster-special-section">
          <div class="roster-special-label">🚕 Taxi Squad</div>
          ${team.taxi.map(id => _playerRowHTML(id, "taxi")).join("")}
        </div>`;
    }

    return `
      <div class="roster-team-card" data-roster-id="${team.roster_id}">
        <div class="roster-team-header">
          <div class="roster-team-identity">
            ${avatar}
            <div>
              <div class="roster-team-name">${_esc(team.teamName)}</div>
              <div class="roster-team-record">${team.wins}–${team.losses} · ${team.fpts.toFixed(1)} PF · ${team.players.length} players</div>
            </div>
          </div>
          ${team.reserve.length || team.taxi.length ? `
          <div class="roster-team-counts">
            ${team.reserve.length ? `<span class="roster-count-badge roster-count-badge--ir">🏥 ${team.reserve.length}</span>` : ""}
            ${team.taxi.length ? `<span class="roster-count-badge roster-count-badge--taxi">🚕 ${team.taxi.length}</span>` : ""}
          </div>` : ""}
        </div>
        <div class="roster-body">
          <div class="roster-positions">${rosterHTML}</div>
          ${irHTML}${taxiHTML}
        </div>
      </div>`;
  }

  // ── Player row — works for Sleeper, MFL, and Yahoo IDs ───
  function _playerRowHTML(playerId, slot) {
    const isMfl   = playerId?.toString().startsWith("mfl_");
    const isYahoo = playerId?.toString().startsWith("yahoo_");

    // Resolve best available player object via DLRPlayers
    let p;
    if (isMfl) {
      const mflId = playerId.replace("mfl_", "");
      p = DLRPlayers.getFullPlayer(mflId, "mfl");
    } else if (isYahoo) {
      // Yahoo IDs don't map to DynastyProcess — use the stub in _players if present
      p = _players[playerId] || {};
    } else {
      // Sleeper: prefer full Sleeper record from the loaded DB
      p = _players[playerId] || DLRPlayers.get(playerId) || {};
    }

    const name    = p.first_name ? `${p.first_name} ${p.last_name}`.trim() : playerId;
    const pos     = (p.fantasy_positions?.[0] || p.position || "—").toUpperCase();
    const nflTeam = p.team || "FA";
    const color   = POS_COLOR[pos] || "#9ca3af";

    // Photo: resolve Sleeper CDN ID for all platforms
    let photoPid = null;
    if (isMfl) {
      photoPid = DLRPlayers.getSleeperIdFromMfl(playerId.replace("mfl_", "")) || null;
    } else if (!isYahoo) {
      photoPid = playerId;  // Sleeper ID is already the photo key
    }

    const photoHTML = photoPid
      ? `<img src="https://sleepercdn.com/content/nfl/players/thumb/${photoPid}.jpg" onerror="this.style.display='none'" loading="lazy" />`
      : `<div class="roster-player-photo-fallback" style="color:${color};">${pos}</div>`;

    // Player card click: pass the original playerId — playercard.js resolves
    // the Sleeper ID internally for stats. This means mfl_ IDs work correctly.
    const cardId = playerId;

    // Bio string via DLRPlayers.formatBio — works for both Sleeper and CSV-mapped players
    const mapping = isMfl ? DLRPlayers.getByMflId(playerId.replace("mfl_", "")) : null;
    const bioStr  = DLRPlayers.formatBio(p, mapping);

    return `
      <div class="roster-player-row" onclick="DLRPlayerCard.show('${_escAttr(cardId)}','${_escAttr(name)}')">
        <div class="roster-player-photo">${photoHTML}</div>
        <div class="roster-player-info">
          <div class="roster-player-name">${_esc(name)}</div>
          <div class="roster-player-meta">
            <span class="roster-nfl-team">${nflTeam}</span>
            ${bioStr ? `<span class="roster-bio dim" style="font-size:.72rem;color:var(--color-text-dim)">${bioStr}</span>` : ""}
          </div>
        </div>
      </div>`;
  }

  // ── Helpers ────────────────────────────────────────────
  async function _loadYahooData(leagueId, token) {
    // Use stored leagueKey (full "nfl.l.XXXXX" format required by Yahoo API)
    const leagueKey = _leagueKey || `nfl.l.${leagueId}`;
    const bundle = await YahooAPI.getLeagueBundle(leagueKey);
    if (token !== _initToken) return;

    const teams     = bundle.teams     || [];
    const rosters   = bundle.rosters   || [];
    const standings = bundle.standings || [];

    const standingsMap = {};
    standings.forEach(s => { standingsMap[s.team_id] = s; });

    const rosterMap = {};
    rosters.forEach(r => { rosterMap[r.team_id] = r.player || []; });

    const mappedTeams = teams.map(t => {
      const s       = standingsMap[t.id] || {};
      const players = rosterMap[t.id]    || [];
      return {
        roster_id: t.id,
        owner_id:  t.id,
        teamName:  t.name       || `Team ${t.id}`,
        username:  (t.owner_name || "").toLowerCase(),
        avatar:    null,
        players:   players.map(pid => `yahoo_${pid}`),
        reserve:   [],
        taxi:      [],
        wins:      s.wins       || 0,
        losses:    s.losses     || 0,
        fpts:      s.points_for || 0
      };
    }).sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);

    // Yahoo player IDs don't map to DynastyProcess — stub entries so _playerRowHTML degrades gracefully
    const yahooPlayerLookup = {};
    mappedTeams.forEach(t => {
      t.players.forEach(pid => {
        yahooPlayerLookup[pid] = {
          first_name: pid.replace("yahoo_", "Player "),
          last_name: "",
          position: "?",
          fantasy_positions: ["?"],
          team: "—",
          search_rank: 9999
        };
      });
    });
    Object.assign(_players, yahooPlayerLookup);

    _rosterData = { teams: mappedTeams, league: bundle.league || {} };
    _render();
  }

  async function _loadMFLData(leagueId, token) {
    const season = _season || new Date().getFullYear().toString();

    // Load DLRPlayers (Sleeper DB + DynastyProcess mappings) first
    await DLRPlayers.load();
    if (token !== _initToken) return;

    // Single bundle fetch — contains everything
    const bundle = await MFLAPI.getLeagueBundle(leagueId, season);
    if (token !== _initToken) return;

    // Use MFLAPI helpers to normalize the raw worker response
    const bundleTeams  = MFLAPI.getTeams(bundle);
    const standingsMap = MFLAPI.getStandingsMap(bundle);

    // Pre-warm session-cached player universe (used by getRoster internally)
    await MFLAPI.getPlayers(season);
    if (token !== _initToken) return;

    // Fetch rosters at the latest scored week so IR/Taxi status is end-of-season accurate.
    // Falls back to bundle.rosters if the endpoint fails or returns no franchise data.
    const latestWeek = MFLAPI.getLatestScoredWeek(bundle);
    let weekRosters = null;
    if (latestWeek > 0) {
      const fetched = await MFLAPI.getRostersAtWeek(leagueId, season, latestWeek);
      if (token !== _initToken) return;
      // Only use if the response actually contains franchise roster data
      const hasFranchises = fetched?.rosters?.rosters?.franchise;
      weekRosters = hasFranchises ? fetched : null;
    }

    const teams = await Promise.all(bundleTeams.map(async t => {
      const s = standingsMap[t.id] || {};
      const mflPlayers = await MFLAPI.getRoster(bundle, t.id, season, weekRosters);

      const mainRoster = mflPlayers.filter(p => p.status !== "IR" && p.status !== "TAXI");
      const irRoster   = mflPlayers.filter(p => p.status === "IR");
      const taxiRoster = mflPlayers.filter(p => p.status === "TAXI");

      return {
        roster_id: t.id,
        owner_id:  t.id,
        teamName:  t.name || `Team ${t.id}`,
        username:  (t.owner_name || t.ownerName || t.id).toLowerCase(),
        avatar:    null,
        mflPlayers,
        players:   mainRoster.map(p => `mfl_${p.id}`),
        reserve:   irRoster.map(p => `mfl_${p.id}`),
        taxi:      taxiRoster.map(p => `mfl_${p.id}`),
        wins:      s.wins   || 0,
        losses:    s.losses || 0,
        fpts:      s.ptsFor || 0
      };
    }));
    if (token !== _initToken) return;

    teams.sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);

    // Populate _players with mfl_-keyed stubs so _teamCardHTML can read
    // pos and rank for position grouping. getFullPlayer() is the source of truth.
    const mflPlayerUniverse = await MFLAPI.getPlayers(season);
    if (token !== _initToken) return;
    Object.entries(mflPlayerUniverse).forEach(([mflId, p]) => {
      const key  = `mfl_${mflId}`;
      const full = DLRPlayers.getFullPlayer(mflId, "mfl");
      _players[key] = {
        first_name:        full.first_name || "",
        last_name:         full.last_name  || "",
        position:          full.position   || p.pos || p.position || "?",
        fantasy_positions: full.fantasy_positions || [full.position || p.pos || "?"],
        team:              full.team       || p.team || "FA",
        search_rank:       full.search_rank || 9999,
        age:               full.age        || null,
        injury_status:     full.injury_status || null,
      };
    });

    _rosterData = { teams, league: MFLAPI.getLeagueInfo(bundle) };
    _filter = "all";
    _render();
  }

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

  return { init, reset, setFilter };

})();
