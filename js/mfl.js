// ─────────────────────────────────────────────────────────
//  GM Dynasty — MyFantasyLeague (MFL) API Module
//  MFL has a JSON API at api.myfantasyleague.com.
//  Auth: uses franchise credentials OR public read access.
//  Docs: https://www03.myfantasyleague.com/2024/api_info
//
//  CORS note: MFL does not send CORS headers for direct
//  browser requests. A lightweight proxy is needed for
//  production. See CORS_PROXY below — swap in your own
//  or use the Cloudflare Worker stub included in /functions/.
// ─────────────────────────────────────────────────────────

const MFLAPI = (() => {

  // ── Configuration ──────────────────────────────────────
  // MFL API base. Their JSON API appends ?JSON=1 to XML endpoints.
  const MFL_BASE = "https://api.myfantasyleague.com";

  // CORS proxy for browser requests.
  // In dev you can use a public proxy; for production deploy a
  // Cloudflare Worker (see /functions/mfl-proxy.js).
  // Set to "" to disable proxying (only works if MFL ever adds CORS).
  const CORS_PROXY = "https://corsproxy.io/?";

  function _url(year, path, params = {}) {
    const qs = new URLSearchParams({ JSON: "1", ...params }).toString();
    const direct = `${MFL_BASE}/${year}/export?TYPE=${path}&${qs}`;
    return CORS_PROXY ? `${CORS_PROXY}${encodeURIComponent(direct)}` : direct;
  }

  // ── Low-level fetch ────────────────────────────────────
  async function _get(year, type, params = {}) {
    const url = _url(year, type, params);
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`MFL API error ${res.status}: ${type}`);
    }
    const data = await res.json();
    // MFL wraps responses: { version, encoding, [type]: { ... } }
    return data;
  }

  // ── League search by username ──────────────────────────

  /**
   * Search for leagues associated with an MFL username.
   * MFL doesn't have a direct "get all leagues for user" endpoint,
   * so we use their leagueSearch endpoint filtered by franchise owner.
   * Returns array of { leagueId, name, year } objects.
   */
  async function searchLeaguesByUser(mflUsername, year = null) {
    const currentYear = new Date().getFullYear();
    const searchYears = year ? [year] : [
      currentYear.toString(),
      (currentYear - 1).toString()
    ];

    const results = [];

    for (const yr of searchYears) {
      try {
        const data = await _get(yr, "leagueSearch", { SEARCH: mflUsername });
        const leagues = data?.leagues?.league;
        if (!leagues) continue;

        const arr = Array.isArray(leagues) ? leagues : [leagues];
        for (const l of arr) {
          results.push({
            leagueId:   l.league_id || l.id,
            leagueName: l.name,
            year:       yr,
            url:        l.url
          });
        }
      } catch (_) {
        // Year not found or rate limited — skip
      }
    }

    return results;
  }

  // ── League details ─────────────────────────────────────

  /**
   * Get full league details.
   */
  async function getLeague(leagueId, year = null) {
    const yr = year || new Date().getFullYear().toString();
    const data = await _get(yr, "league", { L: leagueId });
    return data?.league || null;
  }

  /**
   * Get all franchises (teams) in a league.
   * Returns array of franchise objects with id, name, ownedBy fields.
   */
  async function getFranchises(leagueId, year = null) {
    const yr = year || new Date().getFullYear().toString();
    const data = await _get(yr, "league", { L: leagueId });
    const franchises = data?.league?.franchises?.franchise;
    if (!franchises) return [];
    return Array.isArray(franchises) ? franchises : [franchises];
  }

  // ── Rosters ────────────────────────────────────────────

  /**
   * Get rosters for all franchises in a league.
   * Returns: [{ franchiseId, players: [{ id, status, ... }] }]
   */
  async function getRosters(leagueId, year = null) {
    const yr = year || new Date().getFullYear().toString();
    const data = await _get(yr, "rosters", { L: leagueId });
    const franchises = data?.rosters?.franchise;
    if (!franchises) return [];
    const arr = Array.isArray(franchises) ? franchises : [franchises];
    return arr.map(f => ({
      franchiseId: f.id,
      players:     Array.isArray(f.player) ? f.player : (f.player ? [f.player] : [])
    }));
  }

  // ── Standings ──────────────────────────────────────────

  /**
   * Get full standings for a league.
   * Returns sorted array matching gmd schema shape.
   */
  async function getStandings(leagueId, year = null) {
    const yr = year || new Date().getFullYear().toString();

    const [leagueData, standingsData] = await Promise.all([
      _get(yr, "league",    { L: leagueId }),
      _get(yr, "standings", { L: leagueId })
    ]);

    const franchises = leagueData?.league?.franchises?.franchise;
    const franchiseArr = franchises
      ? (Array.isArray(franchises) ? franchises : [franchises])
      : [];

    // Build a franchise name/owner map
    const franchiseMap = {};
    for (const f of franchiseArr) {
      franchiseMap[f.id] = {
        teamName: f.name,
        owner:    f.owner_name || f.ownedBy || ""
      };
    }

    const standings = standingsData?.standings?.franchise;
    if (!standings) return [];
    const arr = Array.isArray(standings) ? standings : [standings];

    const shaped = arr.map(s => {
      const info = franchiseMap[s.id] || {};
      return {
        franchiseId:  s.id,
        teamName:     info.teamName || "Unknown Team",
        owner:        info.owner    || "",
        wins:         parseInt(s.h2hw  || 0),
        losses:       parseInt(s.h2hl  || 0),
        ties:         parseInt(s.h2ht  || 0),
        ptsFor:       parseFloat(s.pf  || 0),
        ptsAgainst:   parseFloat(s.pa  || 0),
        streak:       s.streak         || "",
        vp:           parseFloat(s.vp  || 0)   // "victory points" if used
      };
    });

    // Sort: wins desc → ptsFor desc
    shaped.sort((a, b) => b.wins - a.wins || b.ptsFor - a.ptsFor);
    return shaped.map((s, i) => ({ rank: i + 1, ...s }));
  }

  // ── Matchup results ────────────────────────────────────

  /**
   * Get weekly results for a given week.
   */
  async function getResults(leagueId, week, year = null) {
    const yr = year || new Date().getFullYear().toString();
    const data = await _get(yr, "weeklyResults", { L: leagueId, W: week });
    const matchups = data?.weeklyResults?.matchup;
    if (!matchups) return [];
    return Array.isArray(matchups) ? matchups : [matchups];
  }

  /**
   * Get playoff bracket structure.
   */
  async function getPlayoffBracket(leagueId, year = null) {
    const yr = year || new Date().getFullYear().toString();
    const data = await _get(yr, "playoffResults", { L: leagueId });
    return data?.playoffResults || null;
  }

  // ── Champion detection ─────────────────────────────────

  /**
   * Try to detect the champion franchise ID from playoff results.
   * Returns the winning franchise ID or null if not determinable.
   */
  async function getChampionFranchiseId(leagueId, year = null) {
    const bracket = await getPlayoffBracket(leagueId, year);
    if (!bracket) return null;

    // MFL playoff results have a "playoffGame" array; the championship
    // is typically the game with the highest week number.
    const games = bracket.playoffGame;
    if (!games) return null;
    const arr = Array.isArray(games) ? games : [games];
    const finalGame = arr.reduce((prev, cur) =>
      parseInt(cur.week) > parseInt(prev.week) ? cur : prev
    , arr[0]);

    return finalGame?.winner || null;
  }

  // ── Full import for a user ─────────────────────────────

  /**
   * Find all leagues for an MFL username and shape them into
   * the gmd/users/{username}/leagues/ schema.
   *
   * Returns: { leagueKey: leagueData } map ready for GMDB.saveLeagues()
   */
  async function importUserLeagues(mflUsername, years = null) {
    const currentYear = new Date().getFullYear();
    const searchYears = years || [
      currentYear.toString(),
      (currentYear - 1).toString()
    ];

    // Find leagues for this username
    const foundLeagues = [];
    for (const yr of searchYears) {
      const leagues = await searchLeaguesByUser(mflUsername, yr);
      for (const l of leagues) foundLeagues.push({ ...l, year: yr });
    }

    if (foundLeagues.length === 0) {
      throw new Error(`No MFL leagues found for username "${mflUsername}".`);
    }

    const leaguesMap = {};

    for (const league of foundLeagues) {
      const { leagueId, year } = league;
      try {
        // Get standings + franchises in parallel
        const [standings, franchises, championFranchiseId] = await Promise.all([
          getStandings(leagueId, year),
          getFranchises(leagueId, year),
          getChampionFranchiseId(leagueId, year)
        ]);

        // Find MY franchise (by owner name match)
        const myFranchise = franchises.find(f =>
          (f.owner_name || f.ownedBy || "").toLowerCase() === mflUsername.toLowerCase() ||
          (f.name || "").toLowerCase().includes(mflUsername.toLowerCase())
        );

        if (!myFranchise) continue;

        const myStanding = standings.find(s => s.franchiseId === myFranchise.id);
        const isChampion = myFranchise.id === championFranchiseId;
        const rank = myStanding?.rank || null;

        // League type detection from league name/settings heuristic
        const leagueDetail = await getLeague(leagueId, year);
        const leagueType   = _detectLeagueType(leagueDetail);

        const key = `mfl_${year}_${leagueId}`;
        leaguesMap[key] = {
          platform:      "mfl",
          leagueId,
          leagueName:    league.leagueName,
          season:        year,
          leagueType,
          totalTeams:    franchises.length,
          teamName:      myFranchise.name   || "My Team",
          wins:          myStanding?.wins    || 0,
          losses:        myStanding?.losses  || 0,
          ties:          myStanding?.ties    || 0,
          pointsFor:     myStanding?.ptsFor  || 0,
          pointsAgainst: myStanding?.ptsAgainst || 0,
          standing:      rank,
          isChampion:    isChampion,
          playoffResult: _mapPlayoffResult(isChampion, rank)
        };
      } catch (err) {
        console.warn(`[MFL] Skipping league ${leagueId} (${year}):`, err.message);
      }
    }

    return {
      mflUsername,
      leagues: leaguesMap
    };
  }

  // ── Type/result helpers ────────────────────────────────

  function _detectLeagueType(leagueData) {
    if (!leagueData) return "redraft";
    const name = (leagueData.name || "").toLowerCase();
    const keeperType = leagueData.keeperType || "";
    if (keeperType === "unlimited" || name.includes("dynasty")) return "dynasty";
    if (keeperType || name.includes("keeper"))                   return "keeper";
    return "redraft";
  }

  function _mapPlayoffResult(isChamp, rank) {
    if (isChamp)  return "champion";
    if (rank === 2) return "finalist";
    if (rank <= 4)  return "semifinal";
    return null;
  }

  // ── Public API ─────────────────────────────────────────
  return {
    searchLeaguesByUser,
    getLeague,
    getFranchises,
    getRosters,
    getStandings,
    getResults,
    getPlayoffBracket,
    getChampionFranchiseId,
    importUserLeagues
  };

})();
