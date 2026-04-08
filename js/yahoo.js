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
      return {};
    }
  }

  /**
   * Normalize Yahoo response into frontend-friendly structure
   */
  function normalizeBundle(raw) {
    if (!raw) return {};

    const bundle = {
      league: raw.league || null,
      teams: [],
      rosters: [],
      standings: [],
      matchups: [],
      players: [],
      draft: [],
      futurePicks: [],
      transactions: raw.transactions || [],
      auctions: raw.auctions || [],
      rules: raw.rules || {}
    };

    // Teams / Franchises
    if (raw.teams?.team) {
      const arr = Array.isArray(raw.teams.team) ? raw.teams.team : [raw.teams.team];
      bundle.teams = arr.map(t => ({
        id: t.team_id,
        name: t.name,
        owner_name: t.owner_name,
        ownerName: t.owner_name
      }));
    }

    // Rosters
    if (raw.rosters?.franchise) {
      const arr = Array.isArray(raw.rosters.franchise) ? raw.rosters.franchise : [raw.rosters.franchise];
      bundle.rosters = arr.map(r => ({
        teamId: r.team_id,
        players: r.player ? (Array.isArray(r.player) ? r.player.map(p => p.player_id) : [r.player.player_id]) : []
      }));
    }

    // Players
    if (raw.players?.player) {
      const arr = Array.isArray(raw.players.player) ? raw.players.player : [raw.players.player];
      bundle.players = arr.map(p => ({
        id: p.player_id,
        name: p.name,
        position: p.position,
        team: p.team,
        status: p.status
      }));
    }

    // Standings
    if (raw.standings?.franchise) {
      const arr = Array.isArray(raw.standings.franchise) ? raw.standings.franchise : [raw.standings.franchise];
      bundle.standings = arr.map((s, i) => ({
        teamId: s.team_id,
        wins: parseInt(s.wins || 0),
        losses: parseInt(s.losses || 0),
        ties: parseInt(s.ties || 0),
        ptsFor: parseFloat(s.points_for || 0),
        ptsAgainst: parseFloat(s.points_against || 0),
        rank: i + 1
      }));
    }

    // Matchups
    if (raw.matchups?.matchup) {
      const arr = Array.isArray(raw.matchups.matchup) ? raw.matchups.matchup : [raw.matchups.matchup];
      bundle.matchups = arr.map(mu => {
        const home = mu.home_team || {};
        const away = mu.away_team || {};
        return {
          week: mu.week || 0,
          home: { teamId: home.team_id || "", score: parseFloat(home.score || 0) },
          away: { teamId: away.team_id || "", score: parseFloat(away.score || 0) }
        };
      });
    }

    // Draft
    if (raw.draft?.pick) {
      const arr = Array.isArray(raw.draft.pick) ? raw.draft.pick : [raw.draft.pick];
      bundle.draft = arr.map(p => ({
        round: parseInt(p.round || 0),
        pick: parseInt(p.pick || 0),
        teamId: p.team_id,
        playerId: p.player_id
      }));
    }

    // Future Picks
    if (raw.futurePicks?.pick) {
      const arr = Array.isArray(raw.futurePicks.pick) ? raw.futurePicks.pick : [raw.futurePicks.pick];
      bundle.futurePicks = arr.map(p => ({
        round: parseInt(p.round || 0),
        teamId: p.team_id,
        originalTeamId: p.original_team_id
      }));
    }

    return bundle;
  }

  return { login, getLeagues, getLeagueBundle, storeTokens };
})();