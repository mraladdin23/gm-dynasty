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
        weekEliminated: i > 0 ? (eliminatedIds.length - (i - 1)) : null,
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
      s => s.franchise_eliminated != null || s.franchiseEliminated != null
    );

    if (isGuillotine) {
      // Build elimination order from standings entries.
      // franchise_eliminated = the week they were eliminated (or 0/null if still alive).
      // Rank: still-alive teams first (sorted by ptsFor desc), then eliminated
      // in reverse order of elimination week (last eliminated = best rank).
      const ptsByFid = {};
      arr.forEach(s => { ptsByFid[String(s.id)] = s; });

      const alive      = arr.filter(s => !s.franchise_eliminated && !s.franchiseEliminated);
      const eliminated = arr.filter(s =>  s.franchise_eliminated ||  s.franchiseEliminated);

      // Sort alive by ptsFor desc, eliminated by weekEliminated desc (last out = higher rank)
      alive.sort((a, b) =>
        parseFloat(b.pf || b.PF || 0) - parseFloat(a.pf || a.PF || 0)
      );
      eliminated.sort((a, b) => {
        const wA = parseInt(a.franchise_eliminated || a.franchiseEliminated || 0);
        const wB = parseInt(b.franchise_eliminated || b.franchiseEliminated || 0);
        return wB - wA;  // higher week = survived longer = better rank
      });

      const ranked = [...alive, ...eliminated];
      return ranked.map((s, i) => {
        const weekOut = parseInt(s.franchise_eliminated || s.franchiseEliminated || 0);
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
  async function getRoster(bundle, teamId, year) {
    const raw = bundle?.rosters?.rosters?.franchise;
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
        status:    (p.status || "").toUpperCase(),   // "IR", "TAXI", or ""
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
  // Key is year-scoped so rookies are always current within a browser session.
  let _playersMemCache = null;  // in-memory reference for the current page load

  async function getPlayers(year) {
    if (_playersMemCache) return _playersMemCache;

    const season   = year || new Date().getFullYear().toString();
    const cacheKey = `mfl_players_${season}`;

    // Try sessionStorage — survives tab switches within the same session
    try {
      const stored = sessionStorage.getItem(cacheKey);
      if (stored) {
        _playersMemCache = JSON.parse(stored);
        return _playersMemCache;
      }
    } catch(e) {}

    // Fetch from worker
    const data = await post("/mfl/players", { year: season });
    const raw  = data?.players?.player;
    if (!raw) return {};

    const arr = Array.isArray(raw) ? raw : [raw];
    const map = {};
    arr.forEach(p => {
      if (p.id) {
        const displayName = mflNameToDisplay(p.name);
        const sleeperId   = mflNameToSleeperId(p.name, p.position);
        const pos         = (p.position || "?").toUpperCase();
        map[p.id] = {
          name:      displayName || p.name || "",
          position:  pos,   // used by getRoster()
          pos:       pos,   // used by draft.js render
          team:      p.team || "FA",
          sleeperId,
        };
      }
    });

    _playersMemCache = map;
    try { sessionStorage.setItem(cacheKey, JSON.stringify(map)); } catch(e) {}
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
    const isGuillotine = stdArr.some(
      s => s.franchise_eliminated != null || s.franchiseEliminated != null
    ) && !l.franchises_eliminated;

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
    const summary = {
      _paths: paths,
      _franchiseEmails: franchises,
      _eliminatedIds: bundle?.league?.league?.franchises_eliminated || "(none)",
      _standingsSort: bundle?.league?.league?.standingsSort || "(none)",
    };
    console.log("[MFLAPI.debugBundle]", JSON.stringify(summary, null, 2));
    return summary;
  }

  /**
   * Returns playoff brackets metadata from bundle.playoffBrackets:
   * [{ id, name, rounds, teams }]
   */
  function normalizePlayoffBrackets(bundle) {
    const raw = bundle?.playoffBrackets?.playoffBrackets?.bracket;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map(b => ({
      id:     String(b.id     || b.bracket_id || ""),
      name:   b.name          || `Bracket ${b.id || ""}`,
      rounds: parseInt(b.rounds || 0),
      teams:  parseInt(b.teams  || 0),
    }));
  }

  /**
   * Normalizes a full playoff bracket result from /mfl/playoffBracket response.
   * Returns: [{ round, matchups: [{ home: {id, score, won}, away: {id, score, won} }] }]
   *
   * MFL shape: { playoffBracket: { bracket: { round: [{matchup:[{away,home,winner}]}] } } }
   */
  function normalizePlayoffBracketResult(data) {
    const raw = data?.playoffBracket?.bracket?.round;
    if (!raw) return [];
    const rounds = Array.isArray(raw) ? raw : [raw];
    return rounds.map((r, ri) => {
      const matchups = Array.isArray(r.matchup) ? r.matchup : (r.matchup ? [r.matchup] : []);
      return {
        round: ri + 1,
        matchups: matchups.map(m => {
          const winner = String(m.winner || "");
          const homeId = String(m.home?.id || m.home || "");
          const awayId = String(m.away?.id || m.away || "");
          return {
            home: { id: homeId, score: parseFloat(m.home?.score || 0), won: winner === homeId },
            away: { id: awayId, score: parseFloat(m.away?.score || 0), won: winner === awayId },
          };
        })
      };
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

  return {
    login,
    getUserLeagues,
    getLeagueBundle,
    getTeams,
    normalizeStandings,
    getStandingsMap,
    getRoster,
    normalizeLiveScoring,
    normalizeMatchups,
    normalizePlayoffBrackets,
    normalizePlayoffBracketResult,
    getLiveScoring,
    getPlayoffBracket,
    getPlayers,
    getLeagueInfo,
    getAuctionResults,
    buildMFLToSleeperIndex,
    mflNameToSleeperId,
    mflNameToDisplay,
    getPlayerScores,
    debugBundle,
  };
})();

