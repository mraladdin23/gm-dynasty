// ─────────────────────────────────────────────────────────
//  Yahoo Fantasy API — Normalized frontend module
//  Works with worker endpoints: /auth/yahoo/login, /yahoo/leagues
// ─────────────────────────────────────────────────────────

const YahooAPI = (() => {
  const BASE = "https://mfl-proxy.mraladdin23.workers.dev";

  /**
   * Redirects user to Yahoo login
   */
  function login() {
    window.location.href = `${BASE}/auth/yahoo/login`;
  }

  /**
   * Fetches all leagues for logged-in user
   */
  async function getLeagues() {
    try {
      const res = await fetch(`${BASE}/yahoo/leagues`, { credentials: "include" });
      if (!res.ok) throw new Error(`Yahoo worker error ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) return [];

      return data.map(league => ({
        platform: "yahoo",
        leagueId: league.leagueId,
        leagueName: league.leagueName,
        season: league.season,
        numTeams: league.numTeams,
        bundle: null // Placeholder for normalized league data
      }));
    } catch (err) {
      console.error("YahooAPI error:", err.message);
      return [];
    }
  }

  /**
   * Fetch a full normalized bundle for a given Yahoo league
   */
  async function getLeagueBundle(leagueKey) {
    try {
      // Yahoo API: fetch league info + everything
      const res = await fetch(`${BASE}/yahoo/leagueBundle?leagueKey=${leagueKey}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Yahoo worker error ${res.status}`);
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

  return { login, getLeagues, getLeagueBundle };
})();