// ─────────────────────────────────────────────────────────
//  MFL API — Normalized frontend module
//  Works with worker endpoints: /mfl/userLeagues, /mfl/bundle
// ─────────────────────────────────────────────────────────

const MFLAPI = (() => {
  const BASE_URL = "https://mfl-proxy.mraladdin23.workers.dev";

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

  // ───────── LOGIN (returns cookie for reuse) ─────────
  async function login(username, password, year) {
    const data = await post("/mfl/login", { username, password, year });
    if (data?.error) throw new Error(data.error);
    return data?.cookie || null;
  }

  // ───────── GET FULL LEAGUE BUNDLE ─────────
  // Accepts either object form: getLeagueBundle({ leagueId, year, ... })
  // OR positional form: getLeagueBundle(leagueId, year) for convenience.
  // Pass `cookie` (from login()) to skip redundant re-authentication.
  async function getLeagueBundle(leagueIdOrObj, yearArg, usernameArg, passwordArg) {
    let leagueId, year, username, password, cookie;

    if (leagueIdOrObj && typeof leagueIdOrObj === "object") {
      ({ leagueId, year, username, password, cookie } = leagueIdOrObj);
    } else {
      leagueId = leagueIdOrObj;
      year     = yearArg;
      username = usernameArg;
      password = passwordArg;
    }

    if (!leagueId) throw new Error("Missing leagueId");

    return post("/mfl/bundle", { leagueId, year, username, password, cookie });
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
    const leagueInfo    = bundle?.league?.league || {};
    const standingsSort = (leagueInfo.standingsSort || "H2H").toUpperCase();

    // ── Eliminator leagues ────────────────────────────────────────────────────
    // franchises_eliminated on league.league = classic eliminator/survivor.
    // One team is eliminated per week (usually for losing), players stay rostered.
    const eliminatedRaw = leagueInfo.franchises_eliminated;
    if (eliminatedRaw && String(eliminatedRaw).trim()) {
      const eliminatedIds = String(eliminatedRaw).trim().split(/[\s,]+/).filter(Boolean);
      const rawFranchises = leagueInfo?.franchises?.franchise;
      const allArr = rawFranchises
        ? (Array.isArray(rawFranchises) ? rawFranchises : [rawFranchises])
        : [];
      const allIds = allArr.map(f => String(f.id));
      const eliminatedSet = new Set(eliminatedIds.map(String));
      const winner = allIds.find(id => !eliminatedSet.has(id)) || null;

      // Rank: winner = 1, last-eliminated = 2, first-eliminated = last
      const ranked = winner ? [winner] : [];
      for (let i = eliminatedIds.length - 1; i >= 0; i--) ranked.push(String(eliminatedIds[i]));

      const ptsByFid = {};
      const rawStd = bundle?.standings?.leagueStandings?.franchise;
      if (rawStd) {
        const sArr = Array.isArray(rawStd) ? rawStd : [rawStd];
        sArr.forEach(s => {
          ptsByFid[String(s.id)] = {
            ptsFor:     parseFloat(s.pf || s.PF || s.ptsFor || s.pointsFor || 0),
            ptsAgainst: parseFloat(s.pa || s.PA || s.ptsAgainst || s.pointsAgainst || 0),
          };
        });
      }

      return ranked.map((fid, i) => ({
        franchiseId:    fid,
        wins:           0,
        losses:         0,
        ties:           0,
        ptsFor:         ptsByFid[fid]?.ptsFor || 0,
        ptsAgainst:     ptsByFid[fid]?.ptsAgainst || 0,
        rank:           i + 1,
        isEliminator:   true,
        isGuillotine:   false,
        eliminated:     i > 0,
        // i=0 is winner (not eliminated). i=1 is last-eliminated (highest week).
        // eliminatedIds is in elimination order: [0]=first out, [last]=last out.
        // ranked reverses that: ranked[1] = eliminatedIds[last], ranked[2] = eliminatedIds[last-1], etc.
        // So for rank i>0: the index into eliminatedIds is (eliminatedIds.length - i).
        // Week eliminated = that index + 1 (week numbers are 1-based).
        weekEliminated: i > 0 ? (eliminatedIds.length - i + 1) : null,
      }));
    }

    // ── Standard + Guillotine leagues ────────────────────────────────────────
    // Guillotine: franchise_eliminated field lives on each standings entry
    // (not on league.league). Lowest scorer each week is eliminated and their
    // players return to free agency. Detected when any standings row has
    // franchise_eliminated set.
    const raw = bundle?.standings?.leagueStandings?.franchise;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];

    const isGuillotine = arr.some(
      s => s.eliminated != null && s.eliminated !== ""
        || s.franchise_eliminated != null  // legacy field name, keep as fallback
        || s.franchiseEliminated  != null
    );

    if (isGuillotine) {
      // MFL guillotine standings:
      //   eliminated = "" or absent → team still alive
      //   eliminated = "N"          → week number they were eliminated
      // Rank: alive teams first (sorted by ptsFor desc), then eliminated
      // in reverse order of elimination week (last eliminated = better rank).
      const alive      = arr.filter(s => {
        const w = s.eliminated ?? s.franchise_eliminated ?? s.franchiseEliminated ?? "";
        return w === "" || w == null;
      });
      const eliminated = arr.filter(s => {
        const w = s.eliminated ?? s.franchise_eliminated ?? s.franchiseEliminated ?? "";
        return w !== "" && w != null;
      });

      alive.sort((a, b) =>
        parseFloat(b.pf || b.PF || 0) - parseFloat(a.pf || a.PF || 0)
      );
      eliminated.sort((a, b) => {
        const wA = parseInt(a.eliminated || a.franchise_eliminated || a.franchiseEliminated || 0);
        const wB = parseInt(b.eliminated || b.franchise_eliminated || b.franchiseEliminated || 0);
        return wB - wA;  // higher week = survived longer = better rank
      });

      const ranked = [...alive, ...eliminated];
      return ranked.map((s, i) => {
        const weekOut = parseInt(s.eliminated || s.franchise_eliminated || s.franchiseEliminated || 0);
        return {
          franchiseId:    String(s.id),
          wins:           parseInt(s.wins   || s.W || s.h2hw || 0),
          losses:         parseInt(s.losses || s.L || s.h2hl || 0),
          ties:           parseInt(s.ties   || s.T || s.h2ht || 0),
          ptsFor:         parseFloat(s.pf   || s.PF || 0),
          ptsAgainst:     parseFloat(s.pa   || s.PA || 0),
          rank:           i + 1,
          isEliminator:   false,
          isGuillotine:   true,
          eliminated:     weekOut > 0,
          weekEliminated: weekOut || null,
        };
      });
    }

    // ── Standard leagues ─────────────────────────────────────────────────────
    const mapped = arr.map((s, i) => ({
      franchiseId:  s.id,
      wins:         parseInt(s.wins   || s.W || s.h2hw || s.allPlayW || 0),
      losses:       parseInt(s.losses || s.L || s.h2hl || s.allPlayL || 0),
      ties:         parseInt(s.ties   || s.T || s.h2ht || s.allPlayT || 0),
      ptsFor:       parseFloat(s.pf   || s.PF || s.ptsFor  || s.pointsFor  || 0),
      ptsAgainst:   parseFloat(s.pa   || s.PA || s.ptsAgainst || s.pointsAgainst || 0),
      rank:         parseInt(s.rank || i + 1),
      isEliminator: false,
      isGuillotine: false,
      eliminated:   false,
    }));

    if (standingsSort === "PTS" || standingsSort === "POINTS") {
      return mapped.sort((a, b) => b.ptsFor - a.ptsFor);
    }
    return mapped.sort((a, b) => b.wins - a.wins || b.ptsFor - a.ptsFor);
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
   * Returns array of player objects for a given team ID (async — fetches player
   * universe from session cache on first call, instant thereafter):
   * [{ id, status, position, team, name, sleeperId }]
   */
  /**
   * Normalizes MFL roster slot status to the three values the rest of the app
   * uses: "IR", "TAXI", or "" (active).
   * MFL API returns: "INJURED_RESERVE", "TAXI_SQUAD", or "" / absent.
   */
  function _normalizeMFLStatus(raw) {
    const s = (raw || "").toUpperCase();
    if (s === "INJURED_RESERVE" || s === "IR") return "IR";
    if (s === "TAXI_SQUAD"      || s === "TAXI") return "TAXI";
    return "";
  }

  /**
   * Returns the latest scored week number from bundle.liveScoring.
   * Falls back to 0 if liveScoring is absent (pre-season / off-season).
   */
  function getLatestScoredWeek(bundle) {
    const week = parseInt(bundle?.liveScoring?.liveScoring?.week || 0);
    return isNaN(week) ? 0 : week;
  }

  /**
   * Fetches rosters for a specific week from the worker's /mfl/rosters endpoint.
   * Returns the same shape as bundle.rosters so getRoster() can consume it.
   * Worker endpoint to add in worker.js:
   *
   *   case "/mfl/rosters": {
   *     const { leagueId, year, week, cookie } = await req.json();
   *     const weekParam = week ? `&W=${week}` : "";
   *     const url = `https://www57.myfantasyleague.com/${year}/export?TYPE=rosters&L=${leagueId}&JSON=1${weekParam}`;
   *     const r = await fetch(url, { headers: { Cookie: cookie || "", "User-Agent": UA } });
   *     const text = await r.text();
   *     try { return new Response(text, { headers: CORS }); }
   *     catch(e) { return new Response('{"rosters":{}}', { headers: CORS }); }
   *   }
   */
  async function getRostersAtWeek(leagueId, year, week, cookie) {
    try {
      return await post("/mfl/rosters", { leagueId, year, week: String(week), cookie });
    } catch(e) {
      console.warn("[MFLAPI] getRostersAtWeek failed, bundle rosters will be used:", e.message);
      return null;
    }
  }

  /**
   * Returns array of player objects for a given team ID (async — fetches player
   * universe from session cache on first call, instant thereafter):
   * [{ id, status, position, team, name, sleeperId }]
   *
   * Pass rostersData to use a week-specific roster snapshot instead of bundle.rosters.
   */
  async function getRoster(bundle, teamId, year, rostersData) {
    // Use week-specific rosters when provided, otherwise fall back to bundle
    const source = rostersData || bundle;
    const raw = source?.rosters?.rosters?.franchise;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const franchise = arr.find(f => String(f.id) === String(teamId));
    if (!franchise) return [];
    const players = franchise.player;
    if (!players) return [];
    const playerArr = Array.isArray(players) ? players : [players];

    // Use session-cached player universe for current names/positions/teams
    const playerLookup = await getPlayers(year);

    return playerArr.map(p => {
      const info = playerLookup[p.id] || {};
      return {
        id:        p.id,
        status:    _normalizeMFLStatus(p.status),
        position:  info.position  || p.position || "?",
        team:      info.team      || p.team     || "FA",
        name:      info.name      || p.name     || `Player ${p.id}`,
        sleeperId: info.sleeperId || null,
      };
    });
  }

  /**
   * Returns matchup array for all weeks (or a single week) from liveScoring data:
   * [{ week, home: { teamId, score }, away: { teamId, score } }]
   *
   * `liveScoringData` can be:
   *   - bundle.liveScoring  (current week from bundle)
   *   - raw response from /mfl/liveScoring endpoint (single week on-demand)
   *
   * MFL liveScoring shape:
   *   { liveScoring: { matchup: [ { franchise: [{id, score, players:{player:[...]}}] } ] } }
   */
  function normalizeMatchups(liveScoringData) {
    const raw = liveScoringData?.liveScoring?.matchup;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const week = liveScoringData?.liveScoring?.week ? parseInt(liveScoringData.liveScoring.week) : 0;
    return arr.map(m => {
      const franchises = m.franchise
        ? (Array.isArray(m.franchise) ? m.franchise : [m.franchise])
        : [];
      const [h, a] = franchises;
      return {
        week,
        home: { teamId: h?.id || "", score: parseFloat(h?.score || 0) },
        away: { teamId: a?.id || "", score: parseFloat(a?.score || 0) }
      };
    }).filter(m => m.home.teamId || m.away.teamId);
  }

  /**
   * Returns detailed per-player scoring for a matchup week.
   * Useful for the matchup detail view (starter breakdown).
   *
   * Returns: [{ week, franchises: [{ id, score, starters: [{id,score}], bench: [{id,score}] }] }]
   */
  function normalizeLiveScoring(liveScoringData) {
    const raw = liveScoringData?.liveScoring?.matchup;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const week = liveScoringData?.liveScoring?.week ? parseInt(liveScoringData.liveScoring.week) : 0;
    return arr.map(m => {
      const franchises = m.franchise
        ? (Array.isArray(m.franchise) ? m.franchise : [m.franchise])
        : [];
      return {
        week,
        franchises: franchises.map(f => {
          const allPlayers = f.players?.player
            ? (Array.isArray(f.players.player) ? f.players.player : [f.players.player])
            : [];
          const starters = allPlayers.filter(p => p.status === "starter")
            .map(p => ({ id: p.id, score: parseFloat(p.score || 0) }));
          const bench = allPlayers.filter(p => p.status !== "starter")
            .map(p => ({ id: p.id, score: parseFloat(p.score || 0) }));
          return {
            id:       f.id    || "",
            score:    parseFloat(f.score || 0),
            starters,
            bench
          };
        })
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

  // ── Cached MFL player universe ───────────────────────────
  // Fetched once per session from /mfl/players and stored in sessionStorage.
  // Key is year+league scoped so custom players (draft picks) for each league are included.
  // The global (no-league) fetch is also cached separately as a fallback.

  let _playersMemCache = null;   // { leagueId|"global": map }

  async function getPlayers(year, leagueId) {
    const season   = year ? String(year) : new Date().getFullYear().toString();
    const cacheKey = `mfl_players_${season}_${leagueId || "global"}`;

    // In-memory cache: keyed by cacheKey to support multiple leagues per session
    if (!_playersMemCache) _playersMemCache = {};
    if (_playersMemCache[cacheKey]) return _playersMemCache[cacheKey];

    // Try sessionStorage first (fast path)
    try {
      const stored = sessionStorage.getItem(cacheKey);
      if (stored) {
        _playersMemCache[cacheKey] = JSON.parse(stored);
        return _playersMemCache[cacheKey];
      }
    } catch(e) {}

    // Ensure cross-platform mappings are loaded
    await DLRPlayers.load();

    // Fetch raw MFL player list from worker — pass leagueId so custom players are included
    const data = await post("/mfl/players", { year: season, leagueId: leagueId || undefined });
    const raw  = data?.players?.player || [];
    const arr  = Array.isArray(raw) ? raw : [raw];

    const map = {};
    arr.forEach(p => {
      if (!p.id) return;

      const rawName     = p.name || "";
      const displayName = mflNameToDisplay(rawName);
      const pos         = _normalizeMFLPos(p.position || "?");

      // Use reliable ID mapping from DynastyProcess CSV when available.
      // Custom/pick players (e.g. "2025 Rookie, 4.01") won't be in the CSV —
      // for those, fall back to MFL's own name + position directly.
      const mapping   = DLRPlayers.getByMflId(p.id);
      const sleeperId = mapping?.sleeper_id || mflNameToSleeperId(rawName, pos);

      // Detect custom/pick players: MFL uses numeric IDs < 1000 or ids like "0836"
      // that look like pick placeholders. We trust MFL's name directly for these.
      const isCustom  = !mapping && (parseInt(p.id) < 10000 || rawName.includes("Pick") || rawName.includes("Round"));

      map[p.id] = {
        name:      mapping?.name || (isCustom ? displayName : null) || displayName || `Player ${p.id}`,
        position:  mapping?.position || pos,
        pos:       mapping?.position || pos,
        team:      mapping?.team || p.team || "FA",
        sleeperId: sleeperId,
        isCustom,
        // Bio fields from CSV
        age:        mapping?.age,
        height:     mapping?.height,
        weight:     mapping?.weight,
        college:    mapping?.college,
        draft_year: mapping?.draft_year,
      };
    });

    _playersMemCache[cacheKey] = map;

    // Also merge into the global cache so lookups without leagueId still hit known players
    const globalKey = `mfl_players_${season}_global`;
    if (leagueId && !_playersMemCache[globalKey]) {
      _playersMemCache[globalKey] = { ...map };
    } else if (leagueId && _playersMemCache[globalKey]) {
      // Merge league-specific entries into global — custom players win over unknowns
      Object.entries(map).forEach(([id, player]) => {
        if (!_playersMemCache[globalKey][id] || player.isCustom) {
          _playersMemCache[globalKey][id] = player;
        }
      });
    }

    // Cache in sessionStorage
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(map));
    } catch(e) {}

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

    // Guillotine detection: franchise_eliminated lives on standings entries, not league.league
    const rawStd = bundle?.standings?.leagueStandings?.franchise;
    const stdArr = rawStd ? (Array.isArray(rawStd) ? rawStd : [rawStd]) : [];
    // Guillotine detection: the 'eliminated' field lives on each standings entry.
    // It is "" for alive teams and "N" (week number string) for eliminated ones.
    const isGuillotine = stdArr.some(
      s => (s.eliminated != null && s.eliminated !== "")  // real MFL field
        || s.franchise_eliminated != null                  // legacy fallback
        || s.franchiseEliminated  != null
    ) && !l.franchises_eliminated;  // not an eliminator league

    return {
      name:          l.name         || "MFL League",
      numTeams:      parseInt(l.franchises) || 12,
      season:        l.baseURL?.match(/\/(\d{4})\//)?.[1] || new Date().getFullYear().toString(),
      playoffTeams:  parseInt(l.playoffTeams || l.settings?.playoffTeams || 0) || null,
      franchises:    l.franchises,
      standingsSort: l.standingsSort || "H2H",
      isEliminator:  !!(l.franchises_eliminated && String(l.franchises_eliminated).trim()),
      isGuillotine,
    };
  }

  /**
   * Returns auction draft results array: [{ franchiseId, playerId, amount }]
   * from bundle.auctionResults (TYPE=auctionResults)
   */
  function getAuctionResults(bundle) {
    const raw = bundle?.auctionResults?.auctionResults?.auction;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map(a => ({
      franchiseId: String(a.franchise || a.franchiseId || ""),
      playerId:    String(a.player    || a.playerId    || ""),
      amount:      parseFloat(a.amount || a.bid || a.winningBid || 0),
    })).filter(a => a.playerId);
  }

  /**
   * Returns division info from bundle.league.league.divisions.
   * { divisions: [{ id, name }], franchiseDivision: { franchiseId: divisionId } }
   */
  function getDivisions(bundle) {
    const leagueInfo = bundle?.league?.league || {};
    const rawDivs    = leagueInfo.divisions?.division;
    const divisions  = rawDivs
      ? (Array.isArray(rawDivs) ? rawDivs : [rawDivs]).map(d => ({
          id:   String(d.id),
          name: d.name || `Division ${d.id}`
        }))
      : [];

    // Build franchise → division map
    const rawFranchises = leagueInfo.franchises?.franchise;
    const franchiseDivision = {};
    if (rawFranchises) {
      const arr = Array.isArray(rawFranchises) ? rawFranchises : [rawFranchises];
      arr.forEach(f => {
        if (f.division != null) {
          franchiseDivision[String(f.id)] = String(f.division);
        }
      });
    }

    return { divisions, franchiseDivision };
  }

  /**
   * Returns the division ID for a given franchise ID, or null if undivided.
   */
  function getFranchiseDivision(bundle, franchiseId) {
    if (!franchiseId) return null;
    const { franchiseDivision } = getDivisions(bundle);
    return franchiseDivision[String(franchiseId)] || null;
  }

  /**
   * Returns all franchise IDs in the same division as `franchiseId`.
   * Returns null if the league has no divisions.
   */
  function getDivisionFranchises(bundle, franchiseId) {
    if (!franchiseId) return null;
    const { divisions, franchiseDivision } = getDivisions(bundle);
    if (!divisions.length) return null;   // no divisions defined
    const myDiv = franchiseDivision[String(franchiseId)];
    if (!myDiv) return null;
    return Object.entries(franchiseDivision)
      .filter(([, divId]) => divId === myDiv)
      .map(([fid]) => fid);
  }

  /**
   * Filters standings to only the user's division, if divisions exist.
   * Returns { standings, divisionName, hasDivisions }
   * If no divisions, returns all standings with hasDivisions=false.
   */
  function filterStandingsByDivision(bundle, standings, myRosterId) {
    const { divisions, franchiseDivision } = getDivisions(bundle);
    if (!divisions.length || !myRosterId) {
      return { standings, divisionName: null, hasDivisions: false, allDivisions: divisions };
    }
    const myDiv = franchiseDivision[String(myRosterId)];
    if (!myDiv) {
      return { standings, divisionName: null, hasDivisions: true, allDivisions: divisions };
    }
    const divInfo    = divisions.find(d => d.id === myDiv);
    const divName    = divInfo?.name || `Division ${myDiv}`;
    const filtered   = standings.filter(s => franchiseDivision[String(s.franchiseId)] === myDiv);
    return { standings: filtered, divisionName: divName, hasDivisions: true, allDivisions: divisions };
  }

  /**
   * For multi-unit drafts: given draftUnits array and myRosterId,
   * returns the index of the unit that contains the user's team.
   * Returns 0 (first unit) if no match or no divisions defined.
   *
   * MFL draftUnit shape: { id, unit (division id), draftPick: [...{franchise}] }
   */
  function getMyDraftUnitIndex(draftUnits, bundle, myRosterId) {
    if (!myRosterId || !draftUnits?.length) return 0;
    const myDiv = getFranchiseDivision(bundle, myRosterId);

    // First try: match by unit field (division ID)
    if (myDiv) {
      const byDiv = draftUnits.findIndex(u => String(u.unit || u.id) === String(myDiv));
      if (byDiv >= 0) return byDiv;
    }

    // Second try: match by whether any pick in the unit belongs to our franchise
    const byPick = draftUnits.findIndex(u => {
      const picks = u.draftPick ? (Array.isArray(u.draftPick) ? u.draftPick : [u.draftPick]) : [];
      return picks.some(p => String(p.franchise || p.franchiseId || "") === String(myRosterId));
    });
    return byPick >= 0 ? byPick : 0;
  }

  /**
   * Fetches auction results directly (TYPE=auctionResults) as a fallback when
   * the bundle doesn't include them. Returns { auctionResults: { auction: [...] } }
   */
  async function getAuctionResultsDirect(leagueId, year) {
    return post("/mfl/auctionResults", { leagueId, year });
  }

  /**
   * For guillotine leagues: when 2 teams remain and both show eliminated:"",
   * resolves winner vs last-eliminated using liveScoring total scores.
   * Pass aliveTeamIds = [id1, id2] and liveData from getLiveScoring.
   * Returns { winnerId, eliminatedId } or null if unresolvable.
   */
  function resolveGuillotineFinal(aliveTeamIds, liveData) {
    if (!Array.isArray(aliveTeamIds) || aliveTeamIds.length !== 2) return null;
    const ls  = liveData?.liveScoring;
    if (!ls) return null;
    const raw = ls.franchise;
    if (!raw) return null;
    const arr = Array.isArray(raw) ? raw : [raw];
    const scores = {};
    arr.forEach(f => {
      const id = String(f.id || "");
      if (aliveTeamIds.includes(id)) scores[id] = parseFloat(f.score || 0);
    });
    const [a, b] = aliveTeamIds;
    if (scores[a] == null || scores[b] == null) return null;
    const winnerId     = scores[a] >= scores[b] ? a : b;
    const eliminatedId = winnerId === a ? b : a;
    return { winnerId, eliminatedId };
  }

  // ── Canonical MFL position normalizer ───────────────────────
  function _normalizeMFLPos(raw) {
    const s = String(raw || "").toUpperCase().trim();
    if (s === "PK")    return "K";
    if (s === "PN")    return "P";
    if (s === "COACH") return "COACH";
    if (s === "DEF")   return "DEF";
    return s || "?";
  }

  // Canonical display order for slot types in matchup cards
  const _SLOT_ORDER = ["QB","RB","WR","TE","K","P","DEF","COACH","SF","FLEX"];
  function _slotSortKey(s) {
    const i = _SLOT_ORDER.indexOf(s);
    return i < 0 ? _SLOT_ORDER.length : i;
  }

  /**
   * Parses the league starters config into an ordered list of slot labels.
   * Output is always sorted in canonical order: QB→RB→WR→TE→K→P→DEF→COACH→SF→FLEX.
   * In all-flex leagues (all mins zero, all maxes full), returns all FLEX slots.
   * In SF-heavy leagues (QB capped below count), SF slots come after DEF/COACH.
   */
  function getStarterSlots(bundle) {
    const startersRaw = bundle?.league?.league?.starters;
    if (!startersRaw) return [];

    const totalCount = parseInt(startersRaw.count || 0);
    if (!totalCount) return [];

    const rawPositions = startersRaw.position;
    if (!rawPositions) return [];
    const posArr = Array.isArray(rawPositions) ? rawPositions : [rawPositions];

    const parsed = posArr.map(p => {
      const name  = _normalizeMFLPos(p.name);
      const limit = String(p.limit || "0");
      const [minStr, maxStr] = limit.includes("-") ? limit.split("-") : [limit, limit];
      const min = parseInt(minStr) || 0;
      const max = parseInt(maxStr) || min;
      return { name, min, max };
    });

    const allMinsZero = parsed.every(p => p.min === 0);

    let slots = [];

    if (!allMinsZero) {
      // ── Case A: some forced positions ────────────────────────
      let namedTotal = 0;
      for (const p of parsed) {
        if (p.min === 0) continue;
        for (let i = 0; i < p.min; i++) { slots.push(p.name); namedTotal++; }
      }
      const hasQBFlex = parsed.some(p => p.name === "QB" && p.min === 0 && p.max > 0);
      for (let i = namedTotal; i < totalCount; i++) {
        slots.push(hasQBFlex ? "SF" : "FLEX");
      }
    } else {
      const qbRule   = parsed.find(p => p.name === "QB");
      const qbMax    = qbRule?.max ?? totalCount;
      const allMaxFull = parsed.every(p => p.max >= totalCount);

      if (allMaxFull) {
        // ── Case C: pure all-flex ─────────────────────────────
        slots = Array(totalCount).fill("FLEX");
      } else {
        // ── Case B: QB capped → SF + FLEX ────────────────────
        const sfCount   = Math.min(qbMax, totalCount);
        const flexCount = totalCount - sfCount;
        slots = [...Array(sfCount).fill("SF"), ...Array(flexCount).fill("FLEX")];
      }
    }

    // Sort into canonical order: QB,RB,WR,TE,K,P,DEF,COACH,SF,FLEX
    slots.sort((a, b) => _slotSortKey(a) - _slotSortKey(b));
    return slots;
  }

  /**
   * Given an ordered starter slot list and a list of player objects,
   * assigns each player to the best-matching slot.
   * Returns an array of { slot, displaySlot, player } in slot order.
   *
   * `slot`        — the canonical slot name from getStarterSlots (QB/RB/SF/FLEX etc.)
   * `displaySlot` — what to show in the center column:
   *                  • named slot → show slot name (QB, RB, WR, TE, K, DEF, COACH, P…)
   *                  • FLEX/SF with a player → show the player's actual position
   *                  • FLEX/SF without a player → show "FLEX" / "SF"
   *
   * Position → valid slots:
   *   QB    → QB, SF, FLEX
   *   RB    → RB, FLEX
   *   WR    → WR, FLEX
   *   TE    → TE, FLEX
   *   K     → K, FLEX        (K can fill FLEX in many leagues)
   *   DEF   → DEF, FLEX
   *   P     → P, FLEX
   *   COACH → COACH, FLEX
   *   ?/other → FLEX only
   *
   * Algorithm: two-pass greedy.
   *   Pass 1: fill named slots (QB, RB, WR, TE, K, DEF, COACH, P) first.
   *   Pass 2: fill SF then FLEX with remaining players.
   * Within each pass, process slots in order.
   */

function assignStartersToSlots(slots, players, playerLookup) {
  const POS_VALID_SLOTS = {
    QB:    ["QB", "SF", "FLEX"],
    RB:    ["RB", "SF", "FLEX"],
    WR:    ["WR", "SF", "FLEX"],
    TE:    ["TE", "SF", "FLEX"],
    K:     ["K",  "FLEX"],
    DEF:   ["DEF","FLEX"],
    P:     ["P",  "FLEX"],
    COACH: ["COACH","FLEX"],
  };

  const enriched = players.map(p => ({
    ...p,
    pos: _normalizeMFLPos(playerLookup?.[p.id]?.pos || playerLookup?.[p.id]?.position || "?")
  }));

  const used = new Array(enriched.length).fill(false);
  const result = slots.map(slot => ({ slot, displaySlot: slot, player: null }));

  // Two-pass for SF precedence:
  // 1. Named slots first (QB, RB, WR, TE, K, etc.)
  // 2. SF slots — QBs get priority, then other skill positions
  // 3. FLEX slots get whatever remains

  // Pass 1: Fill all forced named slots
  const namedSlots = result.map((r, i) => i).filter(i => !["SF", "FLEX"].includes(result[i].slot));
  for (const si of namedSlots) {
    const slot = result[si].slot;
    for (let pi = 0; pi < enriched.length; pi++) {
      if (used[pi]) continue;
      if ((POS_VALID_SLOTS[enriched[pi].pos] || ["FLEX"]).includes(slot)) {
        result[si].player = enriched[pi];
        used[pi] = true;
        break;
      }
    }
  }

  // Pass 2: Fill SF slots — QBs first, then everything else
  const sfSlots = result.map((r, i) => i).filter(i => result[i].slot === "SF");
  for (const si of sfSlots) {
    // First preference: any remaining QB
    let assigned = false;
    for (let pi = 0; pi < enriched.length; pi++) {
      if (used[pi]) continue;
      if (enriched[pi].pos === "QB") {
        result[si].player = enriched[pi];
        used[pi] = true;
        assigned = true;
        break;
      }
    }
    // If no QB left, take any skill position that can fill SF
    if (!assigned) {
      for (let pi = 0; pi < enriched.length; pi++) {
        if (used[pi]) continue;
        const valid = POS_VALID_SLOTS[enriched[pi].pos] || ["FLEX"];
        if (valid.includes("SF")) {
          result[si].player = enriched[pi];
          used[pi] = true;
          break;
        }
      }
    }
  }

  // Pass 3: Fill remaining FLEX slots
  const flexSlots = result.map((r, i) => i).filter(i => result[i].slot === "FLEX");
  for (const si of flexSlots) {
    for (let pi = 0; pi < enriched.length; pi++) {
      if (used[pi]) continue;
      const valid = POS_VALID_SLOTS[enriched[pi].pos] || ["FLEX"];
      if (valid.includes("FLEX")) {
        result[si].player = enriched[pi];
        used[pi] = true;
        break;
      }
    }
  }

  return result;
}
  /**
   * Debug helper — inspect raw bundle from the browser console:
   *   MFLAPI.debugBundle("LEAGUE_ID", "2025").then(r => console.log(JSON.stringify(r._paths, null, 2)))
   */
  async function debugBundle(leagueId, year) {
    const bundle = await getLeagueBundle(leagueId, year);
    const paths = {
      "league.league":                             !!bundle?.league?.league,
      "league.league.franchises_eliminated":       !!(bundle?.league?.league?.franchises_eliminated),
      "league.league.standingsSort":               bundle?.league?.league?.standingsSort || "(none)",
      "standings.leagueStandings.franchise":       !!bundle?.standings?.leagueStandings?.franchise,
      "liveScoring.liveScoring.matchup":           !!bundle?.liveScoring?.liveScoring?.matchup,
      "liveScoring.liveScoring.week":              bundle?.liveScoring?.liveScoring?.week || "(none)",
      "rosters.rosters.franchise":                 !!bundle?.rosters?.rosters?.franchise,
      "draft.draftResults.draftUnit":              !!bundle?.draft?.draftResults?.draftUnit,
      "auctionResults.auctionResults.auction":     !!bundle?.auctionResults?.auctionResults?.auction,
      "transactions.transactions.transaction":     !!bundle?.transactions?.transactions?.transaction,
      "playerScores.playerScores.playerScore":     !!bundle?.playerScores?.playerScores?.playerScore,
      "playoffBrackets.playoffBrackets.bracket":   !!bundle?.playoffBrackets?.playoffBrackets?.bracket,
    };
    const rawF = bundle?.league?.league?.franchises?.franchise;
    const franchises = rawF
      ? (Array.isArray(rawF) ? rawF : [rawF]).map(f => ({
          id: f.id, name: f.name,
          email: f.email || "(none)", owner_name: f.owner_name || "(none)",
          username: f.username || "(none)", is_owner: f.is_owner, is_commish: f.is_commish,
        }))
      : null;
    const { divisions, franchiseDivision } = getDivisions(bundle);
    const summary = {
      _paths: paths,
      _franchiseEmails: franchises,
      _eliminatedIds: bundle?.league?.league?.franchises_eliminated || "(none)",
      _standingsSort: bundle?.league?.league?.standingsSort || "(none)",
      _divisions: divisions.length ? divisions : "(none)",
      _franchiseDivisions: Object.keys(franchiseDivision).length ? franchiseDivision : "(none)",
    };
    console.log("[MFLAPI.debugBundle]", JSON.stringify(summary, null, 2));
    return summary;
  }

  /**
   * Returns playoff brackets metadata from bundle.playoffBrackets:
   * [{ id, name, startWeek, teams }]
   *
   * Real MFL shape:
   *   bundle.playoffBrackets.playoffBrackets.playoffBracket[{id, name, startWeek, teamsInvolved}]
   * (Note: the array key is "playoffBracket" not "bracket")
   */
  function normalizePlayoffBrackets(bundle) {
    const pb  = bundle?.playoffBrackets?.playoffBrackets;
    if (!pb) return [];
    // Try both field names — "playoffBracket" is the real shape, "bracket" is legacy
    const raw = pb.playoffBracket || pb.bracket;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map(b => ({
      id:        String(b.id || b.bracket_id || ""),
      name:      b.name || `Bracket ${b.id || ""}`,
      startWeek: parseInt(b.startWeek || b.start_week || 0),
      teams:     parseInt(b.teamsInvolved || b.teams || 0),
    }));
  }

  /**
   * Normalizes a full playoff bracket result from /mfl/playoffBracket response.
   *
   * Real MFL shape:
   *   { playoffBracket: {
   *       bracket_id: "5",
   *       playoffRound: [
   *         { week: "15", playoffGame: [
   *             { game_id:"1",
   *               home: { franchise_id:"0006", points:"246.84", seed:"3" },
   *               away: { franchise_id:"0001", points:"273.89", seed:"6" }
   *             }, ...
   *         ]},
   *         { week: "16", playoffGame: [
   *             { game_id:"3",
   *               home: { franchise_id:"0012", points:"287.12", seed:"2" },
   *               away: { franchise_id:"0001", winner_of_game:"1", points:"255.49" }
   *             }, ...
   *         ]}
   *       ]
   *   }}
   *
   * Returns: [{
   *   round: N, week: "15",
   *   matchups: [{
   *     gameId, home: {id, score, seed, wonGameId, won}, away: {id, score, seed, wonGameId, won}
   *   }]
   * }]
   */
  function normalizePlayoffBracketResult(data) {
    const pb = data?.playoffBracket;
    if (!pb) return [];

    // Support both old shape (bracket.round) and new real shape (playoffRound)
    const rawRounds = pb.playoffRound || pb.bracket?.round;
    if (!rawRounds) return [];

    const rounds = Array.isArray(rawRounds) ? rawRounds : [rawRounds];

    return rounds.map((r, ri) => {
      const rawGames = r.playoffGame || r.matchup;
      const gamesArr = Array.isArray(rawGames) ? rawGames : (rawGames ? [rawGames] : []);

      const matchups = gamesArr.map(g => {
        const h = g.home || {};
        const a = g.away || {};
        // Real shape uses franchise_id; old shape used id
        const hId    = String(h.franchise_id || h.id || "");
        const aId    = String(a.franchise_id || a.id || "");
        const hScore = parseFloat(h.points || h.score || 0);
        const aScore = parseFloat(a.points || a.score || 0);
        // Winner: compare scores if both played; respect explicit winner field if present
        const hWon = hScore > 0 && aScore > 0 ? hScore > aScore : false;
        const aWon = hScore > 0 && aScore > 0 ? aScore > hScore : false;
        return {
          gameId:   String(g.game_id || g.id || ""),
          home: {
            id:         hId,
            score:      hScore,
            seed:       h.seed ? parseInt(h.seed) : null,
            wonGameId:  String(h.winner_of_game || ""),  // populated in later rounds
            won:        hWon,
          },
          away: {
            id:         aId,
            score:      aScore,
            seed:       a.seed ? parseInt(a.seed) : null,
            wonGameId:  String(a.winner_of_game || ""),
            won:        aWon,
          },
        };
      });

      return { round: ri + 1, week: String(r.week || ""), matchups };
    });
  }

  /**
   * Fetches a single week of liveScoring on-demand from the worker.
   * Returns raw liveScoring data — pass to normalizeMatchups() or normalizeLiveScoring().
   * Omit `week` to get the current week.
   */
  async function getLiveScoring(leagueId, year, week, username, password) {
    return post("/mfl/liveScoring", {
      leagueId,
      year,
      week: week != null ? String(week) : undefined,
      username,
      password
    });
  }

  /**
   * Fetches a specific playoff bracket result on-demand from the worker.
   * Returns raw data — pass to normalizePlayoffBracketResult().
   */
  async function getPlayoffBracket(leagueId, year, bracketId, username, password) {
    return post("/mfl/playoffBracket", { leagueId, year, bracketId, username, password });
  }

/**
   * Convenience: Get enriched player data for any MFL player ID
   * Returns object with name, pos, team, sleeperId, and bio fields
   */
  function getSleeperPlayerData(mflId) {
    const mapping = DLRPlayers.getByMflId(mflId);
    if (mapping) {
      const sleeperP = mapping.sleeper_id ? DLRPlayers.get(mapping.sleeper_id) : null;
      return sleeperP || DLRPlayers.getFullPlayer(mflId, "mfl");
    }
    return DLRPlayers.getFullPlayer(mflId, "mfl");
  }

  // Keep your existing name helpers as fallback
  // (mflNameToSleeperId and mflNameToDisplay can stay unchanged)

  return {
    login,
    getUserLeagues,
    getLeagueBundle,
    getTeams,
    normalizeStandings,
    getStandingsMap,
    getRoster,
    getRostersAtWeek,
    getLatestScoredWeek,
    normalizeLiveScoring,
    normalizeMatchups,
    normalizePlayoffBrackets,
    normalizePlayoffBracketResult,
    getLiveScoring,
    getPlayoffBracket,
    getPlayers,
    getLeagueInfo,
    getAuctionResults,
    getAuctionResultsDirect,
    resolveGuillotineFinal,
    getStarterSlots,
    assignStartersToSlots,
    buildMFLToSleeperIndex,
    mflNameToSleeperId,
    mflNameToDisplay,
    getPlayerScores,
    debugBundle,
    // Division helpers
    getDivisions,
    getFranchiseDivision,
    getDivisionFranchises,
    filterStandingsByDivision,
    getMyDraftUnitIndex,
  };
})();

