// ─────────────────────────────────────────────────────────
//  Yahoo Fantasy API — Normalized frontend module
//  Works with worker endpoints: /auth/yahoo/login, /yahoo/leagues
// ─────────────────────────────────────────────────────────

const YahooAPI = (() => {
  const BASE = "https://mfl-proxy.mraladdin23.workers.dev";

  // ── Token storage keys ────────────────────────────────────
  const KEY_ACCESS    = "dlr_yahoo_access_token";
  const KEY_REFRESH   = "dlr_yahoo_refresh_token";
  const KEY_EXPIRES   = "dlr_yahoo_expires_at";   // absolute ms timestamp

  /**
   * Stores tokens after OAuth callback. Call this from app.js when
   * the #yahoo_token= hash is received.
   */
  function storeTokens(accessToken, refreshToken, expiresIn) {
    localStorage.setItem(KEY_ACCESS, accessToken);
    // Always write refresh token slot — clear stale value if Yahoo didn't send one.
    // Yahoo only issues a refresh token on first authorization; reconnects may omit it.
    // Keeping a stale refresh token is worse than having none (it causes failed refresh
    // attempts which throw "token expired" instead of falling back to the access token).
    if (refreshToken) {
      localStorage.setItem(KEY_REFRESH, refreshToken);
      sessionStorage.setItem("dlr_yahoo_refresh_token", refreshToken);
    } else {
      localStorage.removeItem(KEY_REFRESH);
      sessionStorage.removeItem("dlr_yahoo_refresh_token");
    }
    // Guard against NaN/invalid expiresIn — default to 3600s
    const ttl = Number(expiresIn);
    const expiresAt = Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : 3600) * 1000;
    localStorage.setItem(KEY_EXPIRES, String(expiresAt));
    // sessionStorage copy for backward compat
    sessionStorage.setItem("dlr_yahoo_access_token", accessToken);
  }

  /**
   * Returns a valid access token, refreshing if needed.
   * Throws only if no token is stored at all.
   *
   * Strategy:
   *   1. If token clearly still valid (>2 min left), use directly.
   *   2. If expiry unknown (0), use optimistically.
   *   3. If expired AND we have a refresh token, try to refresh.
   *   4. If refresh fails or no refresh token, use access token optimistically
   *      rather than throwing — Yahoo tokens often remain valid past stated expiry,
   *      and the actual API call will surface a real error if truly invalid.
   */
  async function _getValidToken() {
    const access    = localStorage.getItem(KEY_ACCESS)  || sessionStorage.getItem("dlr_yahoo_access_token");
    const refresh   = localStorage.getItem(KEY_REFRESH) || sessionStorage.getItem("dlr_yahoo_refresh_token");
    const expiresAt = Number(localStorage.getItem(KEY_EXPIRES) || 0);

    if (!access) throw new Error("No Yahoo access token — please reconnect Yahoo.");

    // Token still valid (or expiry unknown) — use it directly
    if (!expiresAt || Date.now() < expiresAt - 120_000) return access;

    // Token is past stated expiry — try refresh if we have a token
    const hasRefresh = refresh && refresh.length > 0;
    if (hasRefresh) {
      try {
        const res = await fetch(`${BASE}/auth/yahoo/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refresh })
        });
        if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
        const data = await res.json();
        if (!data.access_token) throw new Error("No access_token in refresh response");
        storeTokens(data.access_token, data.refresh_token || refresh, data.expires_in || 3600);
        return data.access_token;
      } catch(e) {
        console.warn("[Yahoo] Token refresh failed, using access token optimistically:", e.message);
        // Fall through — try the access token anyway rather than hard-failing
      }
    }

    // No refresh token or refresh failed — use access token optimistically.
    // Yahoo tokens often remain valid beyond the stated 1-hour expiry.
    // The actual API call will return a 401 if truly invalid.
    console.warn("[Yahoo] Using access token optimistically (expired or no refresh token)");
    return access;
  }

  /**
   * Redirects user to Yahoo login
   */
  function login() {
    window.location.href = `${BASE}/auth/yahoo/login`;
  }

  /**
   * Fetches all leagues for logged-in user using stored access token
   */
  async function getLeagues() {
    const token = await _getValidToken();

    try {
      const res = await fetch(`${BASE}/yahoo/leagues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Yahoo worker error ${res.status}`);
      }
      const data = await res.json();
      // Response is either array (old) or {leagues, displayName} (new)
      const leagueArr   = Array.isArray(data) ? data : (data.leagues || []);
      const displayName = data.displayName || "";
      if (displayName) sessionStorage.setItem("dlr_yahoo_display_name", displayName);

      if (!Array.isArray(leagueArr)) return [];

      return leagueArr.map(league => ({
        platform:   "yahoo",
        leagueId:   league.league_id  || league.leagueId,
        leagueKey:  league.league_key || league.leagueKey,
        leagueName: league.name       || league.leagueName,
        season:     league.season,
        numTeams:   league.num_teams  || league.numTeams || 12,
      }));
    } catch (err) {
      console.error("YahooAPI.getLeagues error:", err.message);
      throw err;
    }
  }

  /**
   * Fetch a full normalized bundle for a given Yahoo league key
   */
  async function getLeagueBundle(leagueKey) {
    const token = await _getValidToken();

    try {
      const res = await fetch(`${BASE}/yahoo/leagueBundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token, league_key: leagueKey })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Yahoo worker error ${res.status}`);
      }
      const raw = await res.json();
      return normalizeBundle(raw);
    } catch (err) {
      console.error("YahooAPI getLeagueBundle error:", err.message);
      throw err;  // re-throw so callers can show error UI
    }
  }

  /**
   * Normalize Yahoo bundle into frontend-friendly structure.
   *
   * The worker (yahooLeagueBundle) parses Yahoo's deeply-nested JSON and returns
   * flat arrays plus top-level metadata. This function validates shape, fills gaps,
   * and passes through all new worker fields so tab modules get a consistent object.
   *
   * Field contract (all arrays use camelCase IDs):
   *   myTeamId     — team_id of the logged-in user's team (null if unknown)
   *   currentWeek  — most-recently-scored week number
   *   leagueMeta   — { current_week, end_week, playoff_start_week, num_playoff_teams, uses_playoff, scoring_type, season, ... }
   *   teams[]      — { id, name, owner_name, ownerName, isMyTeam, faab, clinched }
   *   standings[]  — { teamId, wins, losses, ties, ptsFor, ptsAgainst, rank, playoffSeed, clinched }
   *   rosters[]    — { teamId, players: [playerId, ...] }
   *   matchups[]   — { week, home: {teamId, score}, away: {teamId, score}, winnerTeamId, status, isTied }
   *   allMatchups  — { [week]: matchups[] } — all weeks including playoffs
   *   draft[]      — { pick, round, teamId, playerId, name, position, cost }
   *   transactions[] — { id, type, status, timestamp, teamId, description, moves: [{pid,name,action,destTeamId}] }
   */
  function normalizeBundle(raw) {
    if (!raw) return {};

    const _arr = v => (Array.isArray(v) ? v : v ? [v] : []);
    const _int = v => parseInt(v ?? 0) || 0;
    const _flt = v => parseFloat(v ?? 0) || 0;
    const _str = v => v != null ? String(v) : "";

    // Teams — preserve all new flags from worker
    const teams = _arr(raw.teams).map(t => ({
      id:         _str(t.id         ?? t.team_id),
      name:       t.name            || `Team ${t.id ?? t.team_id}`,
      owner_name: t.owner_name      || t.ownerName || "",
      ownerName:  t.ownerName       || t.owner_name || "",
      isMyTeam:   !!(t.isMyTeam),
      faab:       t.faab            != null ? _int(t.faab) : null,
      clinched:   !!(t.clinched),
    }));

    // Standings — preserve new fields
    const standings = _arr(raw.standings).map((s, i) => ({
      teamId:      _str(s.teamId     ?? s.team_id),
      wins:        _int(s.wins),
      losses:      _int(s.losses),
      ties:        _int(s.ties),
      ptsFor:      _flt(s.ptsFor     ?? s.points_for),
      ptsAgainst:  _flt(s.ptsAgainst ?? s.points_against),
      rank:        _int(s.rank)      || i + 1,
      playoffSeed: _int(s.playoffSeed ?? s.playoff_seed),
      clinched:    !!(s.clinched),
    }));

    // Rosters
    const rosters = _arr(raw.rosters).map(r => ({
      teamId:        _str(r.teamId ?? r.team_id),
      players:       _arr(r.players).map(p => _str(p)),
      playerDetails: _arr(r.playerDetails).map(d => ({
        id:       _str(d.id),
        name:     d.name     || "",
        position: d.position || "?",
        nflTeam:  d.nflTeam  || "",
        status:   d.status   || "",
      })),
    }));

    // Matchups — normalize single-week array (current week)
    const _normMu = mu => ({
      week:        _int(mu.week),
      home:        { teamId: _str(mu.home?.teamId ?? mu.home?.team_id), score: _flt(mu.home?.score) },
      away:        { teamId: _str(mu.away?.teamId ?? mu.away?.team_id), score: _flt(mu.away?.score) },
      winnerTeamId: mu.winnerTeamId ? _str(mu.winnerTeamId) : null,
      status:      mu.status || "",
      isTied:      !!(mu.isTied),
    });
    const matchups = _arr(raw.matchups).map(_normMu);

    // allMatchups — { [week]: matchups[] } — normalize each week's array
    const allMatchups = {};
    if (raw.allMatchups && typeof raw.allMatchups === "object") {
      Object.entries(raw.allMatchups).forEach(([week, wMus]) => {
        allMatchups[week] = _arr(wMus).map(_normMu);
      });
    }

    // Draft
    const draft = _arr(raw.draft).map(p => ({
      pick:       _int(p.pick),
      round:      _int(p.round),
      teamId:     _str(p.teamId   ?? p.team_id),
      playerId:   _str(p.playerId ?? p.player_id),
      name:       p.name          || "",
      position:   p.position      || "?",
      cost:       p.cost != null  ? _int(p.cost) : null,
      isKeeper:   !!(p.isKeeper   ?? p.is_keeper),
    }));

    // Detect keeper league: worker cross-references draft picks against players;status=K.
    // keeperCount > 0 means Yahoo confirmed keepers exist for this league.
    // Fallback: cost=0 pattern for auction keeper leagues.
    const hasKeeperPicks = draft.some(p => p.isKeeper)
      || _int(raw.keeperCount) > 0
      || draft.filter(p => p.cost === 0 && p.round > 1).length >= 2;

    // Transactions — preserve moves array for DynastyProcess resolution
    const transactions = _arr(raw.transactions).map(tx => ({
      id:          _str(tx.id),
      type:        tx.type        || "",
      status:      tx.status      || "",
      timestamp:   tx.timestamp   || "",
      teamId:      _str(tx.teamId ?? tx.team_id),
      description: tx.description || "",
      moves:       _arr(tx.moves).map(m => ({
        pid:        _str(m.pid),
        name:       m.name       || "",
        action:     m.action     || "",
        destTeamId: m.destTeamId ? _str(m.destTeamId) : null,
      })),
    }));

    // leagueMeta — structured league settings from worker
    const lm = raw.leagueMeta || {};
    const leagueMeta = {
      current_week:       _int(lm.current_week),
      start_week:         _int(lm.start_week)         || 1,
      end_week:           _int(lm.end_week)            || 17,
      is_finished:        _int(lm.is_finished),
      playoff_start_week: _int(lm.playoff_start_week),
      num_playoff_teams:  _int(lm.num_playoff_teams),
      uses_playoff:       _int(lm.uses_playoff),
      uses_roster_import:  lm.uses_roster_import != null ? _int(lm.uses_roster_import) : null,
      scoring_type:        lm.scoring_type || "head",
      season:              lm.season       || "",
      name:                lm.name         || "",
    };

    return {
      league:       raw.league       || null,
      leagueMeta,
      myTeamId:     raw.myTeamId     ? _str(raw.myTeamId) : null,
      currentWeek:  _int(raw.currentWeek || lm.current_week),
      teams,
      standings,
      rosters,
      matchups,
      allMatchups,
      draft,
      transactions,
      players:      _arr(raw.players),
      futurePicks:  _arr(raw.futurePicks),
      auctions:     _arr(raw.auctions),
      rules:           raw.rules        || {},
      hasKeeperPicks,
    };
  }

  /**
   * Fetch starters + weekly points for both teams in a specific matchup week.
   * Called lazily when the user expands a matchup card.
   * Returns { home: [{pid, name, pos, slot, score, isStarter}], away: [...] }
   */
  async function getMatchupRoster(leagueKey, week, homeTeamKey, awayTeamKey) {
    const token = await _getValidToken();
    try {
      const res = await fetch(`${BASE}/yahoo/matchupRoster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token:  token,
          league_key:    leagueKey,
          week,
          home_team_key: homeTeamKey,
          away_team_key: awayTeamKey,
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Yahoo worker error ${res.status}`);
      }
      return await res.json();
    } catch(err) {
      console.error("YahooAPI.getMatchupRoster error:", err.message);
      throw err;
    }
  }

  return { login, getLeagues, getLeagueBundle, getMatchupRoster, storeTokens, _getValidToken, _workerBase: BASE };
})();