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
    const leagueInfo    = bundle?.league?.league || {};
    const standingsSort = (leagueInfo.standingsSort || "H2H").toUpperCase();

    // ── Eliminator / Survivor leagues ────────────────────────────────────────
    // franchises_eliminated = space-separated IDs, in elimination order (first out = first).
    // The ID absent from the list is the winner (rank 1).
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
        eliminated:     i > 0,
        // weekEliminated: eliminatedIds[0] = out first (round 1), [last] = out last
        weekEliminated: i > 0 ? (eliminatedIds.length - (i - 1)) : null,
      }));
    }

    // ── Standard leagues ─────────────────────────────────────────────────────
    const raw = bundle?.standings?.leagueStandings?.franchise;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const mapped = arr.map((s, i) => ({
      franchiseId: s.id,
      wins:        parseInt(s.wins   || s.W || s.h2hw || s.allPlayW || 0),
      losses:      parseInt(s.losses || s.L || s.h2hl || s.allPlayL || 0),
      ties:        parseInt(s.ties   || s.T || s.h2ht || s.allPlayT || 0),
      ptsFor:      parseFloat(s.pf   || s.PF || s.ptsFor  || s.pointsFor  || 0),
      ptsAgainst:  parseFloat(s.pa   || s.PA || s.ptsAgainst || s.pointsAgainst || 0),
      rank:        parseInt(s.rank || i + 1)
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
   * Uses TYPE=schedule (all weeks) when available, falls back to TYPE=scoreboard (current week).
   */
  function normalizeMatchups(bundle) {
    // Prefer schedule — has all weeks, home/away designation, and scores
    // MFL TYPE=schedule shape: { schedule: { matchupList: { matchup: [{week, home, away}] } } }
    // Each matchup: { home: { id, score }, away: { id, score }, week }
    const scheduleRaw = bundle?.schedule?.schedule?.matchupList?.matchup;
    if (scheduleRaw) {
      const arr = Array.isArray(scheduleRaw) ? scheduleRaw : [scheduleRaw];
      const result = [];
      arr.forEach(m => {
        // MFL schedule matchup: { week, home: {id, score}, away: {id, score} }
        const week = parseInt(m.week || 0);
        // Handle both nested and flat formats
        const homeId    = m.home?.id    || m.homeTeam?.id    || "";
        const awayId    = m.away?.id    || m.awayTeam?.id    || "";
        const homeScore = parseFloat(m.home?.score    || m.homeTeam?.score    || 0);
        const awayScore = parseFloat(m.away?.score    || m.awayTeam?.score    || 0);
        if (homeId || awayId) {
          result.push({ week, home: { teamId: homeId, score: homeScore }, away: { teamId: awayId, score: awayScore } });
        }
      });
      if (result.length > 0) return result;
    }

    // Fallback: scoreboard (current week only)
    const raw = bundle?.matchups?.scoreboard?.matchup;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map(m => {
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
      name:          l.name         || "MFL League",
      numTeams:      parseInt(l.franchises) || 12,
      season:        l.baseURL?.match(/\/(\d{4})\//)?.[1] || new Date().getFullYear().toString(),
      playoffTeams:  parseInt(l.playoffTeams || l.settings?.playoffTeams || 0) || null,
      franchises:    l.franchises,
      standingsSort: l.standingsSort || "H2H",
      isEliminator:  !!(l.franchises_eliminated && String(l.franchises_eliminated).trim()),
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
      "league.league":                           !!bundle?.league?.league,
      "league.league.franchises_eliminated":     !!(bundle?.league?.league?.franchises_eliminated),
      "league.league.standingsSort":             bundle?.league?.league?.standingsSort || "(none)",
      "standings.leagueStandings.franchise":     !!bundle?.standings?.leagueStandings?.franchise,
      "schedule.schedule.matchupList.matchup":   !!bundle?.schedule?.schedule?.matchupList?.matchup,
      "matchups.scoreboard.matchup":             !!bundle?.matchups?.scoreboard?.matchup,
      "rosters.rosters.franchise":               !!bundle?.rosters?.rosters?.franchise,
      "players.players.player":                  !!(bundle?.players?.players?.player),
      "draft.draftResults.draftUnit":            !!bundle?.draft?.draftResults?.draftUnit,
      "auctionResults.auctionResults.auction":   !!bundle?.auctionResults?.auctionResults?.auction,
      "salaries.salaries.leagueUnit.player":     !!(bundle?.salaries?.salaries?.leagueUnit?.player),
      "salaries.salaries.leagueUnit.salary":     !!(bundle?.salaries?.salaries?.leagueUnit?.salary),
      "transactions.transactions.transaction":   !!bundle?.transactions?.transactions?.transaction,
      "playerScores.playerScores.playerScore":   !!bundle?.playerScores?.playerScores?.playerScore,
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

function buildEmailList({ mflEmail = "", mflUsername = "", mflAdditionalEmails = [] } = {}) {
    const primary  = mflEmail.trim().toLowerCase();
    const extras   = (Array.isArray(mflAdditionalEmails) ? mflAdditionalEmails : [])
      .map(e => e.trim().toLowerCase()).filter(Boolean);
    const allEmails = [...new Set([primary, ...extras].filter(Boolean))];
    const allUsernames = [...new Set(
      allEmails.map(e => e.includes("@") ? e.split("@")[0] : e)
        .concat(mflUsername ? [mflUsername.toLowerCase()] : [])
    )];
    return { allEmails, allUsernames };
  }

  /**
   * Finds the user's franchise in a bundle.
   * Checks (in order):
   *   1. Franchise email list (comma-separated) exact match
   *   2. Franchise email username prefix match
   *   3. owner_name / username field match
   *   4. is_owner === "1"
   *   5. is_commish === "1" fallback
   * Returns { franchiseId, teamName } or null.
   */
  function findMyFranchise(bundle, allEmails, allUsernames) {
    const leagueInfo   = bundle?.league?.league || {};
    const rawFranchises = leagueInfo?.franchises?.franchise;
    if (!rawFranchises) return null;
    const franchArr = Array.isArray(rawFranchises) ? rawFranchises : [rawFranchises];

    const match = franchArr.find(f => {
      // MFL can store multiple emails comma-separated in f.email
      const fEmails  = (f.email || "").toLowerCase().split(",").map(e => e.trim()).filter(Boolean);
      const fUser    = (f.username   || "").toLowerCase();
      const fOwner   = (f.owner_name || "").toLowerCase();

      // 1. Exact email match (any slot)
      if (allEmails.some(e => fEmails.includes(e))) return true;
      // 2. Username prefix match against any franchise email slot
      if (allEmails.some(e => fEmails.some(fe => fe.split("@")[0] === e.split("@")[0]))) return true;
      // 3. owner_name / username field
      if (allUsernames.some(u => fUser === u || fOwner.includes(u))) return true;
      // 4. is_owner flag
      if (f.is_owner === "1") return true;
      return false;
    }) || franchArr.find(f => f.is_commish === "1"); // 5. commish fallback

    if (!match) return null;
    return { franchiseId: match.id, teamName: match.name || `Team ${match.id}` };
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
    getAuctionResults,
    buildMFLToSleeperIndex,
    mflNameToSleeperId,
    mflNameToDisplay,
    getPlayerScores,
    buildEmailList,
    findMyFranchise,
    debugBundle,
  };
})();

