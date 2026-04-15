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

  async function login(username, password, year) {
    const data = await post("/mfl/login", { username, password, year });
    if (data?.error) throw new Error(data.error);
    return data?.cookie || null;
  }

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

  function normalizeStandings(bundle) {
    const leagueInfo    = bundle?.league?.league || {};
    const standingsSort = (leagueInfo.standingsSort || "H2H").toUpperCase();

    const eliminatedRaw = leagueInfo.franchises_eliminated;
    if (eliminatedRaw && String(eliminatedRaw).trim()) {
      const eliminatedIds = String(eliminatedRaw).trim().split(/[\s,]+/).filter(Boolean);
      const rawFranchises = leagueInfo?.franchises?.franchise;
      const allArr = rawFranchises ? (Array.isArray(rawFranchises) ? rawFranchises : [rawFranchises]) : [];
      const allIds = allArr.map(f => String(f.id));
      const eliminatedSet = new Set(eliminatedIds.map(String));
      const winner = allIds.find(id => !eliminatedSet.has(id)) || null;

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
        weekEliminated: i > 0 ? (eliminatedIds.length - i + 1) : null,
      }));
    }

    const raw = bundle?.standings?.leagueStandings?.franchise;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];

    const isGuillotine = arr.some(s => 
      s.eliminated != null && s.eliminated !== "" ||
      s.franchise_eliminated != null ||
      s.franchiseEliminated != null
    );

    if (isGuillotine) {
      const alive = arr.filter(s => {
        const w = s.eliminated ?? s.franchise_eliminated ?? s.franchiseEliminated ?? "";
        return w === "" || w == null;
      });
      const eliminated = arr.filter(s => {
        const w = s.eliminated ?? s.franchise_eliminated ?? s.franchiseEliminated ?? "";
        return w !== "" && w != null;
      });

      alive.sort((a, b) => parseFloat(b.pf || b.PF || 0) - parseFloat(a.pf || a.PF || 0));
      eliminated.sort((a, b) => {
        const wA = parseInt(a.eliminated || a.franchise_eliminated || a.franchiseEliminated || 0);
        const wB = parseInt(b.eliminated || b.franchise_eliminated || b.franchiseEliminated || 0);
        return wB - wA;
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

  function getStandingsMap(bundle) {
    const map = {};
    normalizeStandings(bundle).forEach(s => { map[s.franchiseId] = s; });
    return map;
  }

  function getLatestScoredWeek(bundle) {
    const week = parseInt(bundle?.liveScoring?.liveScoring?.week || 0);
    return isNaN(week) ? 0 : week;
  }

  async function getRostersAtWeek(leagueId, year, week, cookie) {
    try {
      return await post("/mfl/rosters", { leagueId, year, week: String(week), cookie });
    } catch(e) {
      console.warn("[MFLAPI] getRostersAtWeek failed, bundle rosters will be used:", e.message);
      return null;
    }
  }

  async function getRoster(bundle, teamId, year, rostersData, leagueId) {
    const source = rostersData || bundle;
    const raw = source?.rosters?.rosters?.franchise;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const franchise = arr.find(f => String(f.id) === String(teamId));
    if (!franchise) return [];
    const players = franchise.player;
    if (!players) return [];
    const playerArr = Array.isArray(players) ? players : [players];

    const playerLookup = await getPlayers(year, leagueId);

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

  function _normalizeMFLStatus(raw) {
    const s = (raw || "").toUpperCase();
    if (s === "INJURED_RESERVE" || s === "IR") return "IR";
    if (s === "TAXI_SQUAD"      || s === "TAXI") return "TAXI";
    return "";
  }

  function normalizeMatchups(liveScoringData) {
    const raw = liveScoringData?.liveScoring?.matchup;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const week = liveScoringData?.liveScoring?.week ? parseInt(liveScoringData.liveScoring.week) : 0;
    return arr.map(m => {
      const franchises = m.franchise ? (Array.isArray(m.franchise) ? m.franchise : [m.franchise]) : [];
      const [h, a] = franchises;
      return {
        week,
        home: { teamId: h?.id || "", score: parseFloat(h?.score || 0) },
        away: { teamId: a?.id || "", score: parseFloat(a?.score || 0) }
      };
    }).filter(m => m.home.teamId || m.away.teamId);
  }

  function normalizeLiveScoring(liveScoringData) {
    const raw = liveScoringData?.liveScoring?.matchup;
    if (!raw) return [];
    const arr = Array.isArray(raw) ? raw : [raw];
    const week = liveScoringData?.liveScoring?.week ? parseInt(liveScoringData.liveScoring.week) : 0;
    return arr.map(m => {
      const franchises = m.franchise ? (Array.isArray(m.franchise) ? m.franchise : [m.franchise]) : [];
      return {
        week,
        franchises: franchises.map(f => {
          const allPlayers = f.players?.player ? (Array.isArray(f.players.player) ? f.players.player : [f.players.player]) : [];
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

  // ── Player universe (with leagueId for custom players) ─────────────────────
  let _playersMemCache = null;

  async function getPlayers(year, leagueId = null) {
    const season = year || new Date().getFullYear().toString();
    const cacheKey = leagueId ? `mfl_players_${season}_${leagueId}` : `mfl_players_${season}`;

    if (_playersMemCache && _playersMemCache[cacheKey]) {
      return _playersMemCache[cacheKey];
    }

    try {
      const body = { year: season };
      if (leagueId) body.leagueId = leagueId;

      const data = await post("/mfl/players", body);
      const raw = data?.players?.player;
      if (!raw) return {};

      const arr = Array.isArray(raw) ? raw : [raw];
      const map = {};
      arr.forEach(p => {
        if (p.id) {
          map[p.id] = {
            name:     p.name     || "",
            position: p.position || "?",
            pos:      p.position || "?",
            team:     p.team     || "FA",
            sleeperId: p.sleeperId || null
          };
        }
      });

      if (!_playersMemCache) _playersMemCache = {};
      _playersMemCache[cacheKey] = map;
      return map;
    } catch(e) {
      console.warn("[MFLAPI] getPlayers failed:", e.message);
      return {};
    }
  }

  // ── Starter Slots (fixed for your SF/flex example) ───────────────────────
  function _normalizeMFLPos(raw) {
    const s = String(raw || "").toUpperCase().trim();
    if (s === "PK") return "K";
    if (s === "PN") return "P";
    if (s === "COACH") return "COACH";
    if (s === "DEF") return "DEF";
    return s || "?";
  }

  const _SLOT_ORDER = ["QB","RB","WR","TE","K","P","DEF","COACH","SF","FLEX"];
  function _slotSortKey(s) {
    const i = _SLOT_ORDER.indexOf(s);
    return i < 0 ? _SLOT_ORDER.length : i;
  }

  function getStarterSlots(bundle) {
    const startersRaw = bundle?.league?.league?.starters;
    if (!startersRaw) return [];

    const totalCount = parseInt(startersRaw.count || 0);
    if (!totalCount) return [];

    const rawPositions = startersRaw.position;
    const posArr = Array.isArray(rawPositions) ? rawPositions : [rawPositions];

    const parsed = posArr.map(p => {
      const name = _normalizeMFLPos(p.name);
      const limit = String(p.limit || "0");
      const [minStr, maxStr] = limit.includes("-") ? limit.split("-") : [limit, limit];
      const min = parseInt(minStr) || 0;
      const max = parseInt(maxStr) || min;
      return { name, min, max };
    });

    const qbRule = parsed.find(p => p.name === "QB") || { min: 0, max: totalCount };
    const sumMins = parsed.reduce((sum, p) => sum + p.min, 0);
    const flexSlots = totalCount - sumMins;

    const sfCount = Math.max(0, Math.min(qbRule.max - qbRule.min, flexSlots));

    const namedSlots = [];
    for (const p of parsed) {
      for (let i = 0; i < p.min; i++) namedSlots.push(p.name);
    }

    const flexPart = [
      ...Array(sfCount).fill("SF"),
      ...Array(flexSlots - sfCount).fill("FLEX")
    ];

    let slots = [...namedSlots, ...flexPart];

    if (sumMins === 0) {
      const sfCountZero = qbRule.max;
      const flexCountZero = totalCount - sfCountZero;
      slots = [...Array(sfCountZero).fill("SF"), ...Array(flexCountZero).fill("FLEX")];
    }

    slots.sort((a, b) => _slotSortKey(a) - _slotSortKey(b));
    return slots;
  }

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

    // Pass 1: forced named slots
    const namedSlots = result.map((r, i) => i).filter(i => !["SF", "FLEX"].includes(result[i].slot));
    for (const si of namedSlots) {
      const slot = result[si].slot;
      for (let pi = 0; pi < enriched.length; pi++) {
        if (used[pi]) continue;
        if ((POS_VALID_SLOTS[enriched[pi].pos] || ["FLEX"]).includes(slot)) {
          result[si].player = enriched[pi];
          if (["FLEX", "SF"].includes(result[si].slot)) {
            result[si].displaySlot = enriched[pi].pos;
          }
          used[pi] = true;
          break;
        }
      }
    }

    // Pass 2: SF slots (QBs first)
    const sfSlots = result.map((r, i) => i).filter(i => result[i].slot === "SF");
    for (const si of sfSlots) {
      let assigned = false;
      for (let pi = 0; pi < enriched.length; pi++) {
        if (used[pi]) continue;
        if (enriched[pi].pos === "QB") {
          result[si].player = enriched[pi];
          result[si].displaySlot = enriched[pi].pos;
          used[pi] = true;
          assigned = true;
          break;
        }
      }
      if (!assigned) {
        for (let pi = 0; pi < enriched.length; pi++) {
          if (used[pi]) continue;
          if ((POS_VALID_SLOTS[enriched[pi].pos] || ["FLEX"]).includes("SF")) {
            result[si].player = enriched[pi];
            result[si].displaySlot = enriched[pi].pos;
            used[pi] = true;
            break;
          }
        }
      }
    }

    // Pass 3: FLEX slots
    const flexSlotsIdx = result.map((r, i) => i).filter(i => result[i].slot === "FLEX");
    for (const si of flexSlotsIdx) {
      for (let pi = 0; pi < enriched.length; pi++) {
        if (used[pi]) continue;
        if ((POS_VALID_SLOTS[enriched[pi].pos] || ["FLEX"]).includes("FLEX")) {
          result[si].player = enriched[pi];
          result[si].displaySlot = enriched[pi].pos;
          used[pi] = true;
          break;
        }
      }
    }

    return result;
  }

  // ── On-demand helpers ─────────────────────────────────────────────────────
  async function getLiveScoring(leagueId, year, week, username, password) {
    return post("/mfl/liveScoring", {
      leagueId, year, week: week != null ? String(week) : undefined, username, password
    });
  }

  async function getPlayoffBracket(leagueId, year, bracketId, username, password) {
    return post("/mfl/playoffBracket", { leagueId, year, bracketId, username, password });
  }

  async function getAuctionResultsDirect(leagueId, year, cookie, username, password) {
    return post("/mfl/auctionResults", { leagueId, year, cookie, username, password });
  }

  // ── Division helpers ──────────────────────────────────────────────────────
  function getDivisions(bundle) {
    const divisionsRaw = bundle?.league?.league?.divisions?.division;
    if (!divisionsRaw) return { divisions: [], franchiseDivision: {} };

    const divArr = Array.isArray(divisionsRaw) ? divisionsRaw : [divisionsRaw];
    const divisions = divArr.map(d => ({ id: String(d.id), name: d.name || `Division ${d.id}` }));

    const franchiseDivision = {};
    const franchises = bundle?.league?.league?.franchises?.franchise || [];
    const fArr = Array.isArray(franchises) ? franchises : [franchises];
    fArr.forEach(f => {
      if (f.id && f.division) franchiseDivision[String(f.id)] = String(f.division);
    });

    return { divisions, franchiseDivision };
  }

  function getFranchiseDivision(bundle, franchiseId) {
    const { franchiseDivision } = getDivisions(bundle);
    return franchiseDivision[String(franchiseId)] || null;
  }

  function getDivisionFranchises(bundle, franchiseId) {
    const { divisions, franchiseDivision } = getDivisions(bundle);
    if (!divisions.length) return null;
    const myDiv = franchiseDivision[String(franchiseId)];
    if (!myDiv) return null;
    return Object.entries(franchiseDivision)
      .filter(([, divId]) => divId === myDiv)
      .map(([fid]) => fid);
  }

  function filterStandingsByDivision(bundle, standings, myRosterId) {
    const { divisions, franchiseDivision } = getDivisions(bundle);
    if (!divisions.length || !myRosterId) {
      return { standings, divisionName: null, hasDivisions: false, allDivisions: divisions };
    }
    const myDiv = franchiseDivision[String(myRosterId)];
    if (!myDiv) {
      return { standings, divisionName: null, hasDivisions: true, allDivisions: divisions };
    }
    const divInfo = divisions.find(d => d.id === myDiv);
    const divName = divInfo?.name || `Division ${myDiv}`;
    const filtered = standings.filter(s => franchiseDivision[String(s.franchiseId)] === myDiv);
    return { standings: filtered, divisionName: divName, hasDivisions: true, allDivisions: divisions };
  }

  function getMyDraftUnitIndex(draftUnits, bundle, myRosterId) {
    if (!myRosterId || !draftUnits?.length) return 0;
    const myDiv = getFranchiseDivision(bundle, myRosterId);
    if (myDiv) {
      const byDiv = draftUnits.findIndex(u => String(u.unit || u.id) === String(myDiv));
      if (byDiv >= 0) return byDiv;
    }
    const byPick = draftUnits.findIndex(u => {
      const picks = u.draftPick ? (Array.isArray(u.draftPick) ? u.draftPick : [u.draftPick]) : [];
      return picks.some(p => String(p.franchise || p.franchiseId || "") === String(myRosterId));
    });
    return byPick >= 0 ? byPick : 0;
  }

  // Debug helper
  async function debugBundle(leagueId, year) {
    const bundle = await getLeagueBundle(leagueId, year);
    console.log("[MFLAPI.debugBundle]", bundle);
    return bundle;
  }

  // ── Public API ───────────────────────────────────────────────────────────
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
    getLeagueInfo: (bundle) => bundle?.league?.league || {},
    getAuctionResultsDirect,          // ← fixed (now defined)
    resolveGuillotineFinal,
    getStarterSlots,
    assignStartersToSlots,
    getDivisions,
    getFranchiseDivision,
    getDivisionFranchises,
    filterStandingsByDivision,
    getMyDraftUnitIndex,
    debugBundle,
  };
})();