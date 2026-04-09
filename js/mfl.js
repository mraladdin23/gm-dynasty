// ─────────────────────────────────────────────────────────
//  MFL API — Normalized frontend module
//  Works with worker endpoints: /mfl/userLeagues, /mfl/bundle
// ─────────────────────────────────────────────────────────

const MFLAPI = (() => {
  const BASE_URL = "https://api.dynastylockerroom.com";

  // ───────── GENERIC POST HELPER ─────────
  async function post(endpoint, body) {
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000)
      });

      const text = await res.text();

      if (!res.ok) {
        throw new Error(`MFL Worker ${res.status}: ${text.slice(0, 200)}`);
      }

      try {
        return JSON.parse(text);
      } catch(e) {
        throw new Error(`MFL response not JSON: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      console.error("[MFL] POST error:", err);
      throw err;
    }
  }

  // ───────── LOGIN + GET LEAGUES ─────────
  async function getUserLeagues({ username, password, year }) {
    if (!username || !password) {
      throw new Error("Missing username or password");
    }

    const data = await post("/mfl/userLeagues", { username, password, year });
    return Array.isArray(data) ? data : (data?.leagues || []);
  }

  // ───────── GET FULL LEAGUE BUNDLE ─────────
  // Accepts either object form: getLeagueBundle({ leagueId, year, ... })
  // OR positional form: getLeagueBundle(leagueId, year) for convenience
  async function getLeagueBundle(leagueIdOrObj, yearArg, usernameArg, passwordArg) {
    let leagueId, year, username, password;

    if (leagueIdOrObj && typeof leagueIdOrObj === "object") {
      ({ leagueId, year, username, password } = leagueIdOrObj);
    } else {
      leagueId = leagueIdOrObj;
      year     = yearArg;
      username = usernameArg;
      password = passwordArg;
    }

    if (!leagueId) throw new Error("Missing leagueId");

    return post("/mfl/bundle", { leagueId, year, username, password });
  }

  // ───────── BUNDLE HELPERS ─────────
  // The worker returns raw MFL API shape. These helpers normalize it for the tabs.
  //
  // Raw shape from worker:
  //   bundle.league.league          → league info object
  //   bundle.rosters.rosters.franchise[]   → array of { id, player: [...] }
  //   bundle.standings.leagueStandings.franchise[] → array of standings rows
  //   bundle.matchups.scoreboard.matchup[] → array of matchup objects
  //   bundle.players.players.player[]      → array of player objects

  /**
   * Returns array of team objects normalized for tab use:
   * [{ id, name, owner_name }]
   */
  function getTeams(bundle) {
    const f = bundle?.league?.league?.franchises?.franchise;
    if (!f) return [];
    const arr = Array.isArray(f) ? f : [f];
    return arr.map(t => ({
      id:         t.id,
      name:       t.name       || `Team ${t.id}`,
      owner_name: t.owner_name || t.ownerName || ""
    }));
  }

  /**
   * Returns standings array normalized for rendering:
   * [{ franchiseId, wins, losses, ties, ptsFor, ptsAgainst, rank }]
   */
  function normalizeStandings(bundle) {
    const raw = bundle?.standings?.leagueStandings?.franchise;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map((s, i) => ({
      franchiseId: s.id,
      wins:        parseInt(s.wins   || s.W || s.h2hw || s.allPlayW || 0),
      losses:      parseInt(s.losses || s.L || s.h2hl || s.allPlayL || 0),
      ties:        parseInt(s.ties   || s.T || s.h2ht || s.allPlayT || 0),
      ptsFor:      parseFloat(s.pf   || s.PF || s.ptsFor  || s.pointsFor  || 0),
      ptsAgainst:  parseFloat(s.pa   || s.PA || s.ptsAgainst || s.pointsAgainst || 0),
      rank:        parseInt(s.rank || i + 1)
    })).sort((a, b) => b.wins - a.wins || b.ptsFor - a.ptsFor);
  }

  /**
   * Returns standings keyed by franchiseId for O(1) lookup:
   * { "0001": { wins, losses, ... }, ... }
   */
  function getStandingsMap(bundle) {
    const map = {};
    normalizeStandings(bundle).forEach(s => { map[s.franchiseId] = s; });
    return map;
  }

  /**
   * Returns array of player objects for a given team ID:
   * [{ id, status, position, team, name }]
   */
  function getRoster(bundle, teamId) {
    const raw = bundle?.rosters?.rosters?.franchise;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const franchise = arr.find(f => String(f.id) === String(teamId));
    if (!franchise) return [];
    const players = franchise.player;
    if (!players) return [];
    const playerArr = Array.isArray(players) ? players : [players];

    // Build player name/pos lookup from bundle.players if available
    const playerLookup = _buildPlayerLookup(bundle);

    return playerArr.map(p => {
      const info = playerLookup[p.id] || {};
      return {
        id:       p.id,
        status:   (p.status || "").toUpperCase(),   // "IR", "TAXI", or ""
        position: info.position || p.position || "?",
        team:     info.team     || p.team     || "FA",
        name:     info.name     || p.name     || `Player ${p.id}`
      };
    });
  }

  /**
   * Returns matchup array normalized for rendering:
   * [{ week, home: { teamId, score }, away: { teamId, score } }]
   */
  function normalizeMatchups(bundle) {
    const raw = bundle?.matchups?.scoreboard?.matchup;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];

    return arr.map(m => {
      // MFL matchup shape: { matchup_id, week, franchise: [{id, score}, {id, score}] }
      const teams = m.franchise
        ? (Array.isArray(m.franchise) ? m.franchise : [m.franchise])
        : [];
      const [h, a] = teams;
      return {
        week: parseInt(m.week || 0),
        home: { teamId: h?.id || "", score: parseFloat(h?.score || 0) },
        away: { teamId: a?.id || "", score: parseFloat(a?.score || 0) }
      };
    });
  }

  // ── MFL → Sleeper player ID mapper ──────────────────────
  // Builds a name-based index from Sleeper DB to match MFL players.
  // MFL names: "Mahomes, Patrick" → normalize → "patrickmahomes"
  // Sleeper: search_full_name = "patrickmahomes"
  let _mflToSleeperCache = null;

  function buildMFLToSleeperIndex() {
    if (_mflToSleeperCache) return _mflToSleeperCache;
    const sleeperPlayers = DLRPlayers.all();
    const SKILL = new Set(["QB", "RB", "WR", "TE"]);
    const index = {};  // normalized name → sleeperId
    Object.entries(sleeperPlayers).forEach(([sid, p]) => {
      // Only index skill position players to avoid wrong matches (K, DEF, DL, LB etc.)
      const pos = (p.fantasy_positions?.[0] || p.position || "").toUpperCase();
      if (!SKILL.has(pos)) return;
      if (p.search_full_name) {
        index[p.search_full_name] = sid;
      } else if (p.first_name && p.last_name) {
        const key = (p.first_name + p.last_name).toLowerCase().replace(/[^a-z]/g, "");
        index[key] = sid;
      }
    });
    _mflToSleeperCache = index;
    return index;
  }

  function mflNameToSleeperId(mflName, position) {
    if (!mflName) return null;
    // Only match skill positions
    const SKILL = new Set(["QB", "RB", "WR", "TE"]);
    if (position && !SKILL.has(position.toUpperCase())) return null;
    // MFL format: "Last, First" or "First Last"
    let normalized;
    if (mflName.includes(",")) {
      const [last, first] = mflName.split(",").map(s => s.trim());
      normalized = (first + last).toLowerCase().replace(/[^a-z]/g, "");
    } else {
      normalized = mflName.toLowerCase().replace(/[^a-z]/g, "");
    }
    const index = buildMFLToSleeperIndex();
    return index[normalized] || null;
  }

  function mflNameToDisplay(mflName) {
    if (!mflName) return "";
    if (mflName.includes(",")) {
      const [last, first] = mflName.split(",").map(s => s.trim());
      return `${first} ${last}`;
    }
    return mflName;
  }
  function _buildPlayerLookup(bundle) {
    const raw = bundle?.players?.players?.player;
    if (!raw) return {};
    const arr = Array.isArray(raw) ? raw : [raw];
    const map = {};
    arr.forEach(p => {
      if (p.id) {
        map[p.id] = {
          name:     p.name     || "",
          position: p.position || "?",
          team:     p.team     || "FA"
        };
      }
    });
    return map;
  }

  /**
   * Returns player scores map: { mflPlayerId: totalPoints }
   * from bundle.playerScores (YTD season total)
   */
  function getPlayerScores(bundle) {
    const raw = bundle?.playerScores?.playerScores?.playerScore;
    if (!raw) return {};
    const arr = Array.isArray(raw) ? raw : [raw];
    const map = {};
    arr.forEach(p => {
      if (p.id) map[String(p.id)] = parseFloat(p.score || 0);
    });
    return map;
  }

  /**
   * Extracts top-level league info from bundle:
   * { name, numTeams, season, playoffTeams }
   */
  function getLeagueInfo(bundle) {
    const l = bundle?.league?.league || {};
    return {
      name:         l.name         || "MFL League",
      numTeams:     parseInt(l.franchises) || 12,
      season:       l.baseURL?.match(/\/(\d{4})\//)?.[1] || new Date().getFullYear().toString(),
      playoffTeams: parseInt(l.playoffTeams || l.settings?.playoffTeams || 0) || null,
      franchises:   l.franchises   // raw franchises object for name lookups
    };
  }

  return {
    getUserLeagues,
    getLeagueBundle,
    getTeams,
    normalizeStandings,
    getStandingsMap,
    getRoster,
    normalizeMatchups,
    getLeagueInfo,
    buildMFLToSleeperIndex,
    mflNameToSleeperId,
    mflNameToDisplay,
    getPlayerScores,
  };
})();
