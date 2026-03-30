// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Sleeper API
//  Full league import with:
//  - Commissioner detection via is_owner field
//  - prev_league_id lineage chaining (links seasons together)
//  - Accurate playoff finish detection (1st/2nd/3rd)
//  - Historical season import (follows lineage chain back)
// ─────────────────────────────────────────────────────────

const SleeperAPI = (() => {

  const BASE = "https://api.sleeper.app/v1";

  // ── Low-level fetch ────────────────────────────────────
  async function _get(path) {
    const res = await fetch(`${BASE}${path}`);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`Sleeper API ${res.status}: ${path}`);
    }
    return res.json();
  }

  // ── User ───────────────────────────────────────────────
  async function getUser(username) {
    return _get(`/user/${username}`);
  }

  // ── Leagues ────────────────────────────────────────────
  async function getUserLeagues(userId, sport = "nfl", season = null) {
    const yr = season || new Date().getFullYear().toString();
    return _get(`/user/${userId}/leagues/${sport}/${yr}`) || [];
  }

  async function getLeague(leagueId) {
    return _get(`/league/${leagueId}`);
  }

  async function getRosters(leagueId) {
    return _get(`/league/${leagueId}/rosters`) || [];
  }

  async function getLeagueUsers(leagueId) {
    return _get(`/league/${leagueId}/users`) || [];
  }

  async function getMatchups(leagueId, week) {
    return _get(`/league/${leagueId}/matchups/${week}`) || [];
  }

  async function getBracket(leagueId, type = "winners") {
    return _get(`/league/${leagueId}/playoffs/${type}_bracket`) || [];
  }

  async function getTransactions(leagueId, round) {
    return _get(`/league/${leagueId}/transactions/${round}`) || [];
  }

  // ── Standings ──────────────────────────────────────────
  async function getStandings(leagueId) {
    const [rosters, users] = await Promise.all([
      getRosters(leagueId),
      getLeagueUsers(leagueId)
    ]);

    const userMap = {};
    for (const u of users) {
      userMap[u.user_id] = {
        displayName: u.display_name || u.user_id,
        teamName:    u.metadata?.team_name || u.display_name || "",
        avatar:      u.avatar,
        isOwner:     u.is_owner === true
      };
    }

    const standings = rosters.map(r => {
      const u = userMap[r.owner_id] || {};
      return {
        rosterId:    r.roster_id,
        userId:      r.owner_id,
        displayName: u.displayName || "Unknown",
        teamName:    u.teamName    || "Unknown Team",
        avatar:      u.avatar      || "",
        isOwner:     u.isOwner     || false,
        wins:        r.settings?.wins   || 0,
        losses:      r.settings?.losses || 0,
        ties:        r.settings?.ties   || 0,
        ptsFor:      (r.settings?.fpts         || 0) + (r.settings?.fpts_decimal         || 0) / 100,
        ptsAgainst:  (r.settings?.fpts_against || 0) + (r.settings?.fpts_against_decimal || 0) / 100,
        streak:      r.metadata?.streak_str || ""
      };
    });

    standings.sort((a, b) => b.wins - a.wins || b.ptsFor - a.ptsFor);
    return standings.map((s, i) => ({ rank: i + 1, ...s }));
  }

  // ── Playoff finish detection ───────────────────────────
  /**
   * Returns the playoff finish for a user: 1, 2, 3, or null.
   * Uses winners bracket to find championship and consolation games.
   */
  async function getPlayoffFinish(leagueId, userId) {
    const [bracket, rosters] = await Promise.all([
      getBracket(leagueId, "winners"),
      getRosters(leagueId)
    ]);

    if (!bracket || bracket.length === 0) return null;

    // Build roster_id → user_id map
    const rosterToUser = {};
    for (const r of rosters) {
      if (r.owner_id) rosterToUser[r.roster_id] = r.owner_id;
    }

    // Find my roster_id
    const myRoster = rosters.find(r => r.owner_id === userId);
    if (!myRoster) return null;
    const myRosterId = myRoster.roster_id;

    // Find the highest round (championship round)
    const maxRound = Math.max(...bracket.map(g => g.r));

    // Championship game = highest round, p=1 (or no p field)
    const champGame = bracket.find(g => g.r === maxRound && (g.p === 1 || !g.p));

    // 3rd place game = highest round, p=3
    const thirdGame = bracket.find(g => g.r === maxRound && g.p === 3);

    if (champGame) {
      if (champGame.w === myRosterId) return 1; // champion
      if (champGame.l === myRosterId) return 2; // runner-up
    }
    if (thirdGame) {
      if (thirdGame.w === myRosterId) return 3; // 3rd place
      if (thirdGame.l === myRosterId) return 4; // 4th place
    }

    // Made playoffs but didn't place top 4
    const anyGame = bracket.find(g => g.w === myRosterId || g.l === myRosterId);
    if (anyGame) return 5; // made playoffs

    return null; // missed playoffs
  }

  // ── Commissioner detection ─────────────────────────────
  /**
   * Checks if a given userId is the commissioner (is_owner) of a league.
   * Uses the league users endpoint — is_owner is the authoritative field.
   */
  async function isCommissioner(leagueId, userId) {
    try {
      const users = await getLeagueUsers(leagueId);
      const me = users.find(u => String(u.user_id) === String(userId));
      return me?.is_owner === true;
    } catch (_) { return false; }
  }

  // ── League lineage (prev_league_id chain) ──────────────
  /**
   * Given a current league, follow prev_league_id chain backwards
   * to collect all historical season IDs of the same league.
   * Returns array of leagueIds oldest-first.
   */
  async function getLeagueLineage(currentLeagueId) {
    const chain = [currentLeagueId];
    let current = await getLeague(currentLeagueId);
    let safety  = 0;

    while (current?.previous_league_id && safety < 15) {
      const prevId = current.previous_league_id;
      if (chain.includes(prevId)) break; // guard against loops
      chain.unshift(prevId); // prepend — oldest first
      current = await getLeague(prevId);
      safety++;
    }

    return chain;
  }

  // ── Full import ────────────────────────────────────────
  /**
   * Import all leagues for a user.
   * - Fetches current season leagues
   * - For each league, follows prev_league_id chain to get full history
   * - Groups all seasons under a franchiseId
   * - Correctly detects commissioner and playoff finishes
   */
  async function importUserLeagues(sleeperUsername) {
    const currentYear = new Date().getFullYear();

    const sleeperUser = await getUser(sleeperUsername);
    if (!sleeperUser) throw new Error(`Sleeper user "${sleeperUsername}" not found.`);

    const userId = sleeperUser.user_id;

    // Get current season leagues as the starting point
    const currentLeagues = await getUserLeagues(userId, "nfl", currentYear.toString());

    // Also check prior year in case current season hasn't started
    let allCurrentLeagues = [...currentLeagues];
    if (currentLeagues.length === 0) {
      const priorLeagues = await getUserLeagues(userId, "nfl", (currentYear - 1).toString());
      allCurrentLeagues = [...priorLeagues];
    }

    const leaguesMap  = {};
    const seenLeagueIds = new Set();

    for (const league of allCurrentLeagues) {
      // Get full lineage for this league
      const lineage = await getLeagueLineage(league.league_id);

      // Use the root (oldest) league ID as the franchiseId
      const franchiseId = lineage[0];

      // Process each season in the lineage
      for (const leagueId of lineage) {
        if (seenLeagueIds.has(leagueId)) continue;
        seenLeagueIds.add(leagueId);

        try {
          const [leagueData, rosters, leagueUsers] = await Promise.all([
            getLeague(leagueId),
            getRosters(leagueId),
            getLeagueUsers(leagueId)
          ]);

          if (!leagueData) continue;

          const myRoster = rosters.find(r => r.owner_id === userId);
          if (!myRoster) continue; // user wasn't in this league season

          const me = leagueUsers.find(u => u.user_id === userId);
          const isComm = me?.is_owner === true;

          const wins   = myRoster.settings?.wins   || 0;
          const losses = myRoster.settings?.losses || 0;
          const ties   = myRoster.settings?.ties   || 0;

          // Get standings for rank
          const standings  = await getStandings(leagueId);
          const myStanding = standings.find(s => s.userId === userId);
          const rank       = myStanding?.rank || null;

          // Get playoff finish (1=champ, 2=runner-up, 3=third, etc.)
          const finish = await getPlayoffFinish(leagueId, userId);

          const season = leagueData.season || currentYear.toString();
          const key    = `sleeper_${leagueId}`;

          leaguesMap[key] = {
            platform:       "sleeper",
            leagueId,
            franchiseId,               // links all seasons of same league
            leagueName:     leagueData.name,
            season,
            leagueType:     _mapLeagueType(leagueData.settings?.type),
            totalTeams:     leagueData.total_rosters || 12,
            teamName:       me?.metadata?.team_name || me?.display_name || "My Team",
            isCommissioner: isComm,
            wins,
            losses,
            ties,
            pointsFor:      (myRoster.settings?.fpts         || 0) + (myRoster.settings?.fpts_decimal         || 0) / 100,
            pointsAgainst:  (myRoster.settings?.fpts_against || 0) + (myRoster.settings?.fpts_against_decimal || 0) / 100,
            standing:       rank,
            playoffFinish:  finish,    // 1=champion, 2=runner-up, 3=third, null=missed
            isChampion:     finish === 1,
            playoffResult:  _finishLabel(finish)
          };
        } catch (err) {
          console.warn(`[Sleeper] Skipping league ${leagueId}:`, err.message);
        }
      }
    }

    return {
      sleeperUserId:   userId,
      sleeperUsername: sleeperUser.username,
      displayName:     sleeperUser.display_name,
      avatar:          sleeperUser.avatar,
      leagues:         leaguesMap
    };
  }

  // ── Helpers ────────────────────────────────────────────

  function _mapLeagueType(type) {
    return { 0: "redraft", 1: "keeper", 2: "dynasty" }[type] || "redraft";
  }

  function _finishLabel(finish) {
    return { 1: "champion", 2: "finalist", 3: "third", 4: "fourth" }[finish] || null;
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
    getPlayoffFinish,
    isCommissioner,
    getLeagueLineage,
    importUserLeagues
  };

})();
