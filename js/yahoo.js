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
    localStorage.setItem(KEY_ACCESS,  accessToken);
    if (refreshToken) localStorage.setItem(KEY_REFRESH, refreshToken);
    localStorage.setItem(KEY_EXPIRES, String(Date.now() + (Number(expiresIn) || 3600) * 1000));
    // Also keep sessionStorage copy for backward compat
    sessionStorage.setItem("dlr_yahoo_access_token",  accessToken);
    sessionStorage.setItem("dlr_yahoo_refresh_token", refreshToken || "");
  }

  /**
   * Returns a valid access token, refreshing if needed.
   * Throws if no tokens are stored or refresh fails.
   */
  async function _getValidToken() {
    const access    = localStorage.getItem(KEY_ACCESS)  || sessionStorage.getItem("dlr_yahoo_access_token");
    const refresh   = localStorage.getItem(KEY_REFRESH) || sessionStorage.getItem("dlr_yahoo_refresh_token");
    const expiresAt = Number(localStorage.getItem(KEY_EXPIRES) || 0);

    if (!access) throw new Error("No Yahoo access token — please reconnect Yahoo.");

    // If token is still valid (with 2-minute buffer), use it
    if (expiresAt && Date.now() < expiresAt - 120_000) return access;

    // Token expired or expiry unknown — try to refresh
    if (!refresh) {
      throw new Error("Yahoo token expired — please reconnect Yahoo.");
    }

    try {
      const res = await fetch(`${BASE}/auth/yahoo/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refresh })
      });
      if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);
      const data = await res.json();
      if (!data.access_token) throw new Error("No access token in refresh response");

      // Store refreshed tokens
      storeTokens(data.access_token, data.refresh_token || refresh, data.expires_in || 3600);
      return data.access_token;
    } catch(e) {
      console.error("[Yahoo] Token refresh failed:", e.message);
      throw new Error("Yahoo token expired — please reconnect Yahoo.");
    }
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
   * The worker (yahooLeagueBundle) already parses Yahoo's deeply-nested JSON and
   * returns flat arrays for teams, standings, rosters, matchups, draft, and
   * transactions. This function just validates shape and fills in any gaps so
   * downstream tab modules always get a consistent object regardless of which
   * worker version returned the data.
   *
   * Field contract (all arrays use camelCase IDs):
   *   teams[]      — { id, name, owner_name, ownerName }
   *   standings[]  — { teamId, wins, losses, ties, ptsFor, ptsAgainst, rank }
   *   rosters[]    — { teamId, players: [playerId, ...], playerDetails: [{id,name,position,nflTeam,status},...] }
   *   matchups[]   — { week, home: {teamId, score}, away: {teamId, score} }
   *   draft[]      — { pick, round, teamId, playerId, name, position, cost }
   *   transactions[] — { id, type, status, timestamp, teamId, description }
   */
  function normalizeBundle(raw) {
    if (!raw) return {};

    // Worker already returns flat arrays — pass them through with shape guarantee.
    // Defensively handle both camelCase (new worker) and snake_case (legacy paths).
    const _arr = v => (Array.isArray(v) ? v : v ? [v] : []);
    const _int = v => parseInt(v ?? 0) || 0;
    const _flt = v => parseFloat(v ?? 0) || 0;
    const _str = v => v != null ? String(v) : "";

    // Teams — normalize to { id, name, owner_name, ownerName }
    const teams = _arr(raw.teams).map(t => ({
      id:         _str(t.id         ?? t.team_id),
      name:       t.name            || `Team ${t.id ?? t.team_id}`,
      owner_name: t.owner_name      || t.ownerName || "",
      ownerName:  t.ownerName       || t.owner_name || "",
    }));

    // Standings — normalize to { teamId, wins, losses, ties, ptsFor, ptsAgainst, rank }
    const standings = _arr(raw.standings).map((s, i) => ({
      teamId:     _str(s.teamId     ?? s.team_id),
      wins:       _int(s.wins),
      losses:     _int(s.losses),
      ties:       _int(s.ties),
      ptsFor:     _flt(s.ptsFor     ?? s.points_for),
      ptsAgainst: _flt(s.ptsAgainst ?? s.points_against),
      rank:       _int(s.rank)      || i + 1,
    }));

    // Rosters — normalize to { teamId, players: [id,...], playerDetails: [...] }
    // Worker returns playerDetails when it expands roster with player info.
    const rosters = _arr(raw.rosters).map(r => ({
      teamId:        _str(r.teamId ?? r.team_id),
      players:       _arr(r.players).map(p => _str(p)),
      playerDetails: _arr(r.playerDetails).map(p => ({
        id:       _str(p.id       ?? p.player_id),
        name:     p.name          || "",
        position: p.position      || "?",
        nflTeam:  p.nflTeam       || p.team || "—",
        status:   p.status        || "",
      })),
    }));

    // Matchups — normalize to { week, home: {teamId, score}, away: {teamId, score} }
    const matchups = _arr(raw.matchups).map(mu => ({
      week: _int(mu.week),
      home: { teamId: _str(mu.home?.teamId ?? mu.home?.team_id), score: _flt(mu.home?.score) },
      away: { teamId: _str(mu.away?.teamId ?? mu.away?.team_id), score: _flt(mu.away?.score) },
    }));

    // Draft — normalize to { pick, round, teamId, playerId, name, position, cost }
    const draft = _arr(raw.draft).map(p => ({
      pick:     _int(p.pick),
      round:    _int(p.round),
      teamId:   _str(p.teamId   ?? p.team_id),
      playerId: _str(p.playerId ?? p.player_id),
      name:     p.name          || "",
      position: p.position      || "?",
      cost:     p.cost != null  ? _int(p.cost) : null,
    }));

    // Transactions — already parsed by worker, pass through with shape guarantee
    const transactions = _arr(raw.transactions).map(tx => ({
      id:          _str(tx.id),
      type:        tx.type        || "",
      status:      tx.status      || "",
      timestamp:   tx.timestamp   || "",
      teamId:      _str(tx.teamId ?? tx.team_id),
      description: tx.description || "",
    }));

    return {
      league:       raw.league       || null,
      teams,
      standings,
      rosters,
      matchups,
      draft,
      transactions,
      players:      _arr(raw.players),
      futurePicks:  _arr(raw.futurePicks),
      auctions:     _arr(raw.auctions),
      rules:        raw.rules        || {},
    };
  }

  return { login, getLeagues, getLeagueBundle, storeTokens };
})();