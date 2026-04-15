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
    // ... (unchanged - keep your existing normalizeStandings function)
    const leagueInfo    = bundle?.league?.league || {};
    const standingsSort = (leagueInfo.standingsSort || "H2H").toUpperCase();

    const eliminatedRaw = leagueInfo.franchises_eliminated;
    if (eliminatedRaw && String(eliminatedRaw).trim()) {
      // eliminator logic (unchanged)
      const eliminatedIds = String(eliminatedRaw).trim().split(/[\s,]+/).filter(Boolean);
      // ... rest of eliminator code remains exactly as you had it
      // (I'm omitting the full body here to keep this response reasonable, but keep your original)
    }

    // guillotine + standard logic (keep your original)
    // ...
    return mapped; // placeholder - use your existing return
  }

  function getStandingsMap(bundle) {
    const map = {};
    normalizeStandings(bundle).forEach(s => { map[s.franchiseId] = s; });
    return map;
  }

  // ... (keep all your other existing functions unchanged until getStarterSlots)

  // ── UPDATED: getStarterSlots + assignStartersToSlots ─────────────────────
  function _normalizeMFLPos(raw) {
    const s = String(raw || "").toUpperCase().trim();
    if (s === "PK")    return "K";
    if (s === "PN")    return "P";
    if (s === "COACH") return "COACH";
    if (s === "DEF")   return "DEF";
    return s || "?";
  }

  const _SLOT_ORDER = ["QB","RB","WR","TE","K","P","DEF","COACH","SF","FLEX"];
  function _slotSortKey(s) {
    const i = _SLOT_ORDER.indexOf(s);
    return i < 0 ? _SLOT_ORDER.length : i;
  }

  /**
   * Returns ordered starter slots for MFL leagues (handles min/max limits + SF logic).
   */
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
      for (let i = 0; i < p.min; i++) {
        namedSlots.push(p.name);
      }
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

  // ── Keep the rest of your file exactly as it was ───────────────────────
  // (getRoster, normalizeMatchups, normalizeLiveScoring, getPlayers, etc.)

  // ... (all your other functions remain unchanged)

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
    getStarterSlots,           // ← updated
    assignStartersToSlots,     // ← updated
    buildMFLToSleeperIndex,
    mflNameToSleeperId,
    mflNameToDisplay,
    getPlayerScores,
    debugBundle,
    getDivisions,
    getFranchiseDivision,
    getDivisionFranchises,
    filterStandingsByDivision,
    getMyDraftUnitIndex,
  };
})();