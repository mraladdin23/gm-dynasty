// ─────────────────────────────────────────────────────────
//  GM Dynasty — Sleeper API Module
//  Adapted from SleeperBid's sleeper.js.
//  Public API — no auth required, username-based lookup.
//  Docs: https://docs.sleeper.com
// ─────────────────────────────────────────────────────────

const SleeperAPI = (() => {

  const BASE = "https://api.sleeper.app/v1";

  // ── Low-level fetch ────────────────────────────────────
  async function _get(path) {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Sleeper API error ${res.status}: ${path}`);
    }
    return res.json();
  }

  // ── User ───────────────────────────────────────────────

  /**
   * Look up a Sleeper user by username.
   * Returns { user_id, username, display_name, avatar, ... } or null.
   */
  async function getUser(sleeperUsername) {
    return _get(`/user/${sleeperUsername}`);
  }

  // ── Leagues ────────────────────────────────────────────

  /**
   * Get all leagues for a Sleeper user in a given sport/season.
   * Returns array of league objects.
   */
  async function getUserLeagues(sleeperUserId, sport = "nfl", season = null) {
    const yr = season || new Date().getFullYear().toString();
    return _get(`/user/${sleeperUserId}/leagues/${sport}/${yr}`) || [];
  }

  /**
   * Get a single league's details.
   */
  async function getLeague(leagueId) {
    return _get(`/league/${leagueId}`);
  }

  /**
   * Get all rosters in a league.
   * Each roster has: roster_id, owner_id, players[], starters[], wins, losses, ties, fpts, fpts_against
   */
  async function getRosters(leagueId) {
    return _get(`/league/${leagueId}/rosters`) || [];
  }

  /**
   * Get all users (managers) in a league.
   * Returns array with user_id, display_name, metadata.team_name, avatar
   */
  async function getLeagueUsers(leagueId) {
    return _get(`/league/${leagueId}/users`) || [];
  }

  /**
   * Get league matchups for a given week.
   */
  async function getMatchups(leagueId, week) {
    return _get(`/league/${leagueId}/matchups/${week}`) || [];
  }

  /**
   * Get playoff bracket for a league.
   * type: "winners" | "losers"
   */
  async function getBracket(leagueId, type = "winners") {
    return _get(`/league/${leagueId}/playoffs/${type}_bracket`) || [];
  }

  /**
   * Get all transactions (trades, waivers, FA) for a week.
   */
  async function getTransactions(leagueId, round) {
    return _get(`/league/${leagueId}/transactions/${round}`) || [];
  }

  // ── Standings / stats helpers ──────────────────────────

  /**
   * Build standings for a league.
   * Merges roster records with user display names and team names.
   * Returns sorted array: { rank, userId, displayName, teamName, wins, losses, ties, ptsFor, ptsAgainst }
   */
  async function getStandings(leagueId) {
    const [rosters, users] = await Promise.all([
      getRosters(leagueId),
      getLeagueUsers(leagueId)
    ]);

    const userMap = {};
    for (const u of users) {
      userMap[u.user_id] = {
        displayName: u.display_name || u.user_id,
        teamName:    u.metadata?.team_name || "Team " + u.display_name,
        avatar:      u.avatar
      };
    }

    const standings = rosters.map(r => {
      const u = userMap[r.owner_id] || {};
      return {
        rosterId:      r.roster_id,
        userId:        r.owner_id,
        displayName:   u.displayName || "Unknown",
        teamName:      u.teamName    || "Unknown Team",
        avatar:        u.avatar      || "",
        wins:          r.settings?.wins          || 0,
        losses:        r.settings?.losses        || 0,
        ties:          r.settings?.ties          || 0,
        ptsFor:        (r.settings?.fpts         || 0) + (r.settings?.fpts_decimal  || 0) / 100,
        ptsAgainst:    (r.settings?.fpts_against || 0) + (r.settings?.fpts_against_decimal || 0) / 100,
        streak:        r.metadata?.streak_str    || ""
      };
    });

    // Sort: wins desc → ptsFor desc
    standings.sort((a, b) =>
      b.wins - a.wins || b.ptsFor - a.ptsFor
    );

    return standings.map((s, i) => ({ rank: i + 1, ...s }));
  }

  // ── Champion detection ─────────────────────────────────

  /**
   * Try to determine if a given userId won the championship.
   * Checks winners bracket — final game winner.
   * Returns true/false/null (null = bracket not available).
   */
  async function isChampion(leagueId, userId) {
    const bracket = await getBracket(leagueId, "winners");
    if (!bracket || bracket.length === 0) return null;

    // The championship game is the highest round
    const maxRound = Math.max(...bracket.map(g => g.r));
    const finalGame = bracket.find(g => g.r === maxRound);
    if (!finalGame) return null;

    const [rosters] = await Promise.all([getRosters(leagueId)]);
    const winnerRoster = rosters.find(r => r.roster_id === finalGame.w);
    return winnerRoster?.owner_id === userId;
  }

  // ── Full import for a user ─────────────────────────────

  /**
   * Fetch all leagues for a Sleeper user and shape them into
   * the gmd/users/{username}/leagues/ schema.
   *
   * Returns: { leagueKey: leagueData } map ready for GMDB.saveLeagues()
   * Also returns sleeperUserId for platform linking.
   */
  async function importUserLeagues(sleeperUsername, seasons = null) {
    // Resolve seasons to import (default: current + prior year)
    const currentYear = new Date().getFullYear();
    const targetSeasons = seasons || [
      currentYear.toString(),
      (currentYear - 1).toString()
    ];

    // Get Sleeper user
    const sleeperUser = await getUser(sleeperUsername);
    if (!sleeperUser) throw new Error(`Sleeper user "${sleeperUsername}" not found.`);

    const leaguesMap = {};

    for (const season of targetSeasons) {
      const leagues = await getUserLeagues(sleeperUser.user_id, "nfl", season);

      for (const league of leagues) {
        // Get the user's roster in this league for record
        const rosters = await getRosters(league.league_id);
        const myRoster = rosters.find(r => r.owner_id === sleeperUser.user_id);
        if (!myRoster) continue;

        // Get users for team name
        const leagueUsers = await getLeagueUsers(league.league_id);
        const me = leagueUsers.find(u => u.user_id === sleeperUser.user_id);

        const wins   = myRoster.settings?.wins   || 0;
        const losses = myRoster.settings?.losses || 0;
        const ties   = myRoster.settings?.ties   || 0;

        // Determine standings position
        const standings = await getStandings(league.league_id);
        const myStanding = standings.find(s => s.userId === sleeperUser.user_id);
        const rank = myStanding?.rank || null;

        // Detect champion (best effort)
        const champion = await isChampion(league.league_id, sleeperUser.user_id);

        const key = `sleeper_${league.league_id}`;
        leaguesMap[key] = {
          platform:      "sleeper",
          leagueId:      league.league_id,
          leagueName:    league.name,
          season,
          leagueType:    _mapLeagueType(league.settings?.type),
          totalTeams:    league.total_rosters || 12,
          teamName:      me?.metadata?.team_name || me?.display_name || "My Team",
          wins,
          losses,
          ties,
          pointsFor:     (myRoster.settings?.fpts || 0) + (myRoster.settings?.fpts_decimal || 0) / 100,
          pointsAgainst: (myRoster.settings?.fpts_against || 0) + (myRoster.settings?.fpts_against_decimal || 0) / 100,
          standing:      rank,
          isChampion:    champion === true,
          playoffResult: _mapPlayoffResult(champion, rank, league)
        };
      }
    }

    return {
      sleeperUserId:   sleeperUser.user_id,
      sleeperUsername: sleeperUser.username,
      displayName:     sleeperUser.display_name,
      avatar:          sleeperUser.avatar,
      leagues:         leaguesMap
    };
  }

  // ── Type mapping helpers ───────────────────────────────

  function _mapLeagueType(type) {
    const map = { 0: "redraft", 1: "keeper", 2: "dynasty" };
    return map[type] || "redraft";
  }

  function _mapPlayoffResult(isChamp, rank, league) {
    if (isChamp === true) return "champion";
    // Rough heuristic: top 2 = finalist, etc.
    if (rank === 2) return "finalist";
    if (rank <= 4)  return "semifinal";
    return null;
  }

  // ── Public API ─────────────────────────────────────────
  return {
    getUser,
    getUserLeagues,
    getLeague,
    getRosters,
    getLeagueUsers,
    getMatchups,
    getBracket,
    getTransactions,
    getStandings,
    isChampion,
    importUserLeagues
  };

})();
