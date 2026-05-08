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
    // Correct Sleeper endpoint: /league/{id}/winners_bracket or /losers_bracket
    return _get(`/league/${leagueId}/${type}_bracket`) || [];
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
  // ── Playoff finish detection ───────────────────────────
  // KEY INSIGHT from SleeperBid: ALL placement games are in the winners bracket.
  // p=1 = Championship, p=3 = 3rd place, p=5 = 5th place.
  // w = winning roster_id, l = losing roster_id, t1/t2 = competing roster_ids.
  async function getPlayoffFinish(leagueId, userId) {
    const [winners, rosters] = await Promise.all([
      getBracket(leagueId, "winners"),
      getRosters(leagueId)
    ]);

    if (!winners || !winners.length) return null;

    const myRoster = rosters.find(r => r.owner_id === userId);
    if (!myRoster) return null;
    const rid = myRoster.roster_id;

    // Placement games have p field
    const champGame = winners.find(m => m.p === 1);
    const thirdGame = winners.find(m => m.p === 3);
    const fifthGame = winners.find(m => m.p === 5);

    if (champGame) {
      if (champGame.w === rid) return 1; // champion
      if (champGame.l === rid) return 2; // runner-up
    }
    if (thirdGame) {
      if (thirdGame.w === rid) return 3;
      if (thirdGame.l === rid) return 4;
    }
    if (fifthGame) {
      if (fifthGame.w === rid) return 5;
      if (fifthGame.l === rid) return 6;
    }

    // Appeared in any playoff game (including regular bracket rounds with no p)
    const inPlayoffs = winners.some(m =>
      m.t1 === rid || m.t2 === rid || m.w === rid || m.l === rid
    );
    if (inPlayoffs) return 7; // made playoffs but early exit

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
  async function getLeagueLineage(currentLeagueId) {
    const chain   = [currentLeagueId];
    let   current = await getLeague(currentLeagueId);
    let   safety  = 0;

    while (safety < 15) {
      const prevId = current?.previous_league_id;
      // Sleeper uses "0" or 0 as sentinel for "no previous league"
      if (!prevId || prevId === "0" || prevId === 0) break;
      if (chain.includes(String(prevId))) break; // guard loops
      chain.unshift(String(prevId));
      current = await getLeague(String(prevId));
      safety++;
    }

    return chain; // oldest first
  }

  // ── Batch helper — run promises N at a time ───────────
  async function _batch(items, concurrency, fn) {
    const results = [];
    for (let i = 0; i < items.length; i += concurrency) {
      const chunk = items.slice(i, i + concurrency);
      results.push(...await Promise.allSettled(chunk.map(fn)));
    }
    return results;
  }

  // ── Process one league into the leaguesMap ─────────────
  async function _processLeague(leagueId, franchiseId, userId, currentYear, mostRecentSeason, leaguesMap) {
    try {
      const [leagueData, rosters, leagueUsers] = await Promise.all([
        getLeague(leagueId),
        getRosters(leagueId),
        getLeagueUsers(leagueId)
      ]);
      if (!leagueData) return;

      const me        = leagueUsers.find(u => u.user_id === userId);
      const isComm    = me?.is_owner === true;
      const myRoster  = rosters.find(r => r.owner_id === userId)
                     || rosters.find(r => (r.co_owners||[]).includes(userId));
      const isCoOwner = !rosters.find(r => r.owner_id === userId) && !!myRoster;

      if (!myRoster && !isComm) return;

      const season = leagueData.season || currentYear.toString();
      const status = leagueData.status;

      const wins       = myRoster?.settings?.wins   || 0;
      const losses     = myRoster?.settings?.losses || 0;
      const ties       = myRoster?.settings?.ties   || 0;
      const ptsFor     = (myRoster?.settings?.fpts         || 0) + (myRoster?.settings?.fpts_decimal         || 0) / 100;
      const ptsAgainst = (myRoster?.settings?.fpts_against || 0) + (myRoster?.settings?.fpts_against_decimal || 0) / 100;

      const [standings, finish] = await Promise.all([
        myRoster ? getStandings(leagueId) : Promise.resolve([]),
        (status === "complete" && myRoster) ? getPlayoffFinish(leagueId, userId) : Promise.resolve(null)
      ]);

      const myStanding = standings.find(s => s.userId === userId);
      const rank       = myStanding?.rank || null;

      leaguesMap[`sleeper_${leagueId}`] = {
        platform:       "sleeper",
        leagueId,
        franchiseId,
        leagueName:     leagueData.name,
        season,
        status,
        mostRecentSeason,
        leagueType:     _mapLeagueType(leagueData.settings?.type),
        totalTeams:     leagueData.total_rosters || 12,
        teamName: (() => {
          if (me?.metadata?.team_name) return me.metadata.team_name;
          if (me?.display_name)        return me.display_name;
          if (isCoOwner) {
            const primaryUser = leagueUsers.find(u => u.user_id === myRoster?.owner_id);
            return primaryUser?.metadata?.team_name || primaryUser?.display_name || "My Team";
          }
          return isComm ? "Commissioner" : "My Team";
        })(),
        isCommissioner: isComm,
        isCoOwner:      isCoOwner || false,
        myRosterId:     myRoster?.roster_id || null,
        sleeperUserId:  userId,
        wins, losses, ties,
        pointsFor:      ptsFor,
        pointsAgainst:  ptsAgainst,
        standing:       rank,
        playoffFinish:  finish,
        isChampion:     finish === 1,
        playoffResult:  _finishLabel(finish)
      };
    } catch (err) {
      console.warn(`[Sleeper] Skipping ${leagueId}:`, err.message);
    }
  }

  // ── Full import (first-time sync, all years) ───────────
  async function importUserLeagues(sleeperUsername) {
    const currentYear = new Date().getFullYear();

    const sleeperUser = await getUser(sleeperUsername);
    if (!sleeperUser) throw new Error(`Sleeper user "${sleeperUsername}" not found.`);
    const userId = sleeperUser.user_id;

    // ── Step 1: Fetch all years in parallel (2017–present) ─
    const yearsToFetch = [];
    for (let y = currentYear; y >= 2017; y--) yearsToFetch.push(y.toString());

    const allStartingLeagueIds = new Set();
    let mostRecentSeason = (currentYear - 1).toString();

    const yearResults = await _batch(yearsToFetch, 8, async (year) => {
      const leagues = await getUserLeagues(userId, "nfl", year);
      return { year, leagues: leagues || [] };
    });
    for (const r of yearResults) {
      if (r.status !== "fulfilled") continue;
      const { year, leagues } = r.value;
      if (leagues.length && year > mostRecentSeason) mostRecentSeason = year;
      leagues.forEach(l => allStartingLeagueIds.add(l.league_id));
    }

    // ── Step 2: Resolve lineage chains in parallel ────────
    const lineageResults = await _batch([...allStartingLeagueIds], 6, async (id) => {
      const lineage = await getLeagueLineage(id);
      return { lineage };
    });

    const seenLeagueIds  = new Set();
    const leaguesToProcess = [];
    for (const r of lineageResults) {
      if (r.status !== "fulfilled") continue;
      const { lineage } = r.value;
      const franchiseId = lineage[0];
      for (const leagueId of lineage) {
        if (seenLeagueIds.has(leagueId)) continue;
        seenLeagueIds.add(leagueId);
        leaguesToProcess.push({ leagueId, franchiseId });
      }
    }

    // ── Step 3: Process all leagues in parallel (8 at a time) ─
    const leaguesMap = {};
    await _batch(leaguesToProcess, 8, ({ leagueId, franchiseId }) =>
      _processLeague(leagueId, franchiseId, userId, currentYear, mostRecentSeason, leaguesMap)
    );

    return {
      sleeperUserId:   userId,
      sleeperUsername: sleeperUser.username,
      displayName:     sleeperUser.display_name,
      avatar:          sleeperUser.avatar,
      mostRecentSeason,
      leagues:         leaguesMap
    };
  }

  // ── Refresh current season only ────────────────────────
  // Fast update: only fetches the active season, updates records
  // for known leagues, and discovers any new leagues from this year.
  // Does NOT walk prev_league_id chains — relies on existing franchiseIds
  // already stored in Firebase.
  async function refreshCurrentSeason(sleeperUserId, sleeperUsername, existingLeagues) {
    const currentYear    = new Date().getFullYear();
    const activeSeason   = getActiveSeason(); // respects Jan-15 cutoff
    const seasonsToCheck = new Set([activeSeason, currentYear.toString()]);

    // ── Step 1: Get this season's leagues from Sleeper ────
    const thisYearLeagues = await getUserLeagues(sleeperUserId, "nfl", activeSeason);
    const thisYearIds     = new Set((thisYearLeagues || []).map(l => l.league_id));

    // Build the set of leagueIds to refresh:
    // - All existing Sleeper leagues from active/current season
    // - Any new leagues from this year not yet in the profile
    const existingSleeperLeagues = Object.entries(existingLeagues || {})
      .filter(([, l]) => l.platform === "sleeper");

    const toRefresh = new Map(); // leagueId → franchiseId

    // Add existing active-season leagues
    for (const [, l] of existingSleeperLeagues) {
      if (seasonsToCheck.has(String(l.season))) {
        toRefresh.set(l.leagueId, l.franchiseId || l.leagueId);
      }
    }

    // Add brand-new leagues from this year (not yet in profile)
    const existingIds = new Set(existingSleeperLeagues.map(([, l]) => l.leagueId));
    for (const id of thisYearIds) {
      if (!existingIds.has(id)) {
        // New league — use itself as franchiseId placeholder; full sync will fix lineage
        toRefresh.set(id, id);
      }
    }

    // ── Step 2: Process all in parallel ──────────────────
    const leaguesMap = {};
    const mostRecentSeason = activeSeason;

    await _batch([...toRefresh.entries()], 8, ([leagueId, franchiseId]) =>
      _processLeague(leagueId, franchiseId, sleeperUserId, currentYear, mostRecentSeason, leaguesMap)
    );

    return {
      sleeperUserId,
      sleeperUsername,
      mostRecentSeason,
      leagues: leaguesMap,
      newCount: [...thisYearIds].filter(id => !existingIds.has(id)).length
    };
  }

  // ── Helpers ────────────────────────────────────────────

  function _mapLeagueType(type) {
    return { 0: "redraft", 1: "keeper", 2: "dynasty" }[type] || "redraft";
  }

  function _finishLabel(finish) {
    return { 1:"champion", 2:"finalist", 3:"third", 4:"fourth", 5:"fifth", 6:"sixth", 7:"playoffs" }[finish] || null;
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
    importUserLeagues,
    refreshCurrentSeason
  };

})();

// ── Season utility (exported for use across modules) ──────
// After Jan 15 of the new year, the current active season is
// the new year. Before Jan 15, the active season is last year.
function getActiveSeason() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1; // 1-based
  const day   = now.getDate();
  // After Jan 15: current year is active season
  if (month > 1 || (month === 1 && day >= 15)) return year.toString();
  return (year - 1).toString();
}
