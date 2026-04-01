// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — MyFantasyLeague (MFL) API
//
//  MFL CORS POLICY: MFL explicitly blocks all browser JS
//  calls from outside myfantasyleague.com. All requests
//  MUST go through a server-side proxy.
//
//  MFL AUTH: Uses email + password → returns a cookie.
//  The cookie must be passed on all subsequent requests.
//
//  PROXY: Set MFL_PROXY_URL to your Cloudflare Worker URL.
//  The worker in /functions/mfl-proxy.js handles this.
//
//  FINDING USER LEAGUES: Use the `myleagues` export type,
//  which returns all leagues for an authenticated user.
// ─────────────────────────────────────────────────────────

const MFLAPI = (() => {

  // ── Configuration ──────────────────────────────────────
  // CORS proxy chain — tries each in order until one works
  const MFL_PROXIES = [
    "https://corsproxy.io/?",
    "https://api.allorigins.win/raw?url=",
    "https://proxy.cors.sh/",
    "https://thingproxy.freeboard.io/fetch/",
  ];

  const MFL_API_HOST  = "https://api.myfantasyleague.com";

  // ── Proxy fetch with fallback chain ──────────────────────
  async function _proxyFetch(url, options = {}) {
    let lastErr = null;
    for (const proxy of MFL_PROXIES) {
      try {
        const proxied = proxy + encodeURIComponent(url);
        const res = await fetch(proxied, { ...options, signal: AbortSignal.timeout(12_000) });
        if (res.status === 429) throw new Error("MFL rate limit hit — please wait a moment and try again.");
        if (res.status === 404) return null;
        if (res.status === 403 || res.status === 408 || !res.ok) {
          lastErr = new Error(`Proxy ${proxy} returned ${res.status}`);
          continue; // try next proxy
        }
        return res;
      } catch(e) {
        lastErr = e;
        if (e.message.includes("rate limit")) throw e; // don't retry rate limits
        // continue to next proxy
      }
    }
    throw new Error(`All MFL proxies failed. Last error: ${lastErr?.message}`);
  }

  // ── Login → get auth cookie ────────────────────────────
  /**
   * Authenticate with MFL using email + password.
   * Returns the MFL_USER_ID cookie value needed for subsequent calls,
   * or throws a descriptive error.
   *
   * MFL login endpoint: /year/login?USERNAME=email&PASSWORD=pass&XML=1
   * Returns: <status cookie_name="MFL_USER_ID" cookie_value="..." />
   */
  async function login(email, password) {
    const year = new Date().getFullYear();
    const url  = `${MFL_API_HOST}/${year}/login?USERNAME=${encodeURIComponent(email)}&PASSWORD=${encodeURIComponent(password)}&XML=1`;

    const res = await _proxyFetch(url);
    if (!res) throw new Error("MFL login failed: no response");

    // MFL login returns XML even with JSON=1 flag omitted
    const text = await res.text();
    console.log("[MFL] Login response:", text.slice(0, 200));

    // Parse cookie from XML response
    // MFL returns: <status MFL_USER_ID="abc123">OK</status>
    // OR:          <status cookie_name="MFL_USER_ID" cookie_value="abc123" .../>
    const directMatch  = text.match(/MFL_USER_ID="([^"]+)"/);
    const cookieMatch  = directMatch || text.match(/cookie_value="([^"]+)"/);
    if (!cookieMatch) {
      // Check for error
      if (text.includes('<error') || text.includes('error status')) {
        throw new Error("Invalid MFL email or password.");
      }
      throw new Error("MFL login did not return a valid session. Check your credentials.");
    }

    return cookieMatch[1]; // the cookie value
  }

  // ── Get user's leagues ─────────────────────────────────
  // myleagues requires a real browser session cookie which we can't set.
  // Instead use leagueSearch (public, no auth) to find leagues by username,
  // then verify franchise ownership via the league franchises endpoint.
  async function getMyLeagues(mflUsername, years = null) {
    const currentYear = new Date().getFullYear();
    const searchYears = years || [
      currentYear.toString(),
      (currentYear - 1).toString(),
      (currentYear - 2).toString(),
      (currentYear - 3).toString(),
      (currentYear - 4).toString(),
    ];
    const allLeagues = [];
    const seen = new Set();

    for (const year of searchYears) {
      try {
        // leagueSearch is public — no auth needed
        const url     = `${MFL_API_HOST}/${year}/export?TYPE=leagueSearch&SEARCH=${encodeURIComponent(mflUsername)}&JSON=1`;
        const res     = await _proxyFetch(url).catch(() => null);
        if (!res) continue;
        const data    = await res.json().catch(() => null);
        if (!data) continue;
        console.log(`[MFL] leagueSearch ${year}:`, JSON.stringify(data).slice(0, 300));

        const leagues = data?.leagues?.league;
        if (!leagues) continue;
        const arr = Array.isArray(leagues) ? leagues : [leagues];

        for (const l of arr) {
          const id = l.league_id || l.id;
          if (!id || seen.has(`${year}_${id}`)) continue;
          seen.add(`${year}_${id}`);
          allLeagues.push({
            leagueId:   id,
            leagueName: l.name,
            year
          });
        }
      } catch(e) {
        console.warn(`[MFL] leagueSearch ${year}:`, e.message);
      }
    }

    return allLeagues;
  }

  // Find the user's franchise ID within a league
  // MFL franchise objects have: id, name, owner_name, owners (object with owner details)
  async function findMyFranchise(leagueId, year, mflUsername) {
    try {
      const url     = `${MFL_API_HOST}/${year}/export?TYPE=league&L=${leagueId}&JSON=1`;
      const res     = await _proxyFetch(url).catch(() => null);
      if (!res) return null;
      const data       = await res.json().catch(() => null);
      if (!data) return null;
      const franchises = data?.league?.franchises?.franchise;
      if (!franchises) return null;
      const arr = Array.isArray(franchises) ? franchises : [franchises];

      // Log all franchises so we can see what names MFL is returning
      console.log(`[MFL] League ${leagueId} (${year}) franchises:`,
        arr.map(f => ({
          id:         f.id,
          name:       f.name,
          owner_name: f.owner_name,
          owners:     f.owners
        }))
      );

      const search = mflUsername.toLowerCase();

      // Try multiple match strategies in order of specificity
      const me = arr.find(f => {
        const ownerName  = (f.owner_name || "").toLowerCase();
        const teamName   = (f.name       || "").toLowerCase();
        // Also check nested owners object which may have username field
        const ownerObj   = f.owners?.owner;
        const ownerArr   = ownerObj ? (Array.isArray(ownerObj) ? ownerObj : [ownerObj]) : [];
        const ownerNames = ownerArr.map(o => (o.name || o.username || "").toLowerCase());

        return ownerName.includes(search)
          || teamName.includes(search)
          || ownerNames.some(n => n.includes(search));
      });

      if (!me) {
        console.warn(`[MFL] No franchise matched "${mflUsername}" in league ${leagueId}. ` +
          `Try one of the owner names shown above.`);
        return null;
      }

      return { franchiseId: me.id, teamName: me.name };
    } catch(e) {
      console.warn(`[MFL] findMyFranchise error:`, e.message);
      return null;
    }
  }

  // ── Get league details ─────────────────────────────────
  async function getLeague(leagueId, year, cookieValue = null) {
    const auth = cookieValue ? `&MFL_USER_ID=${cookieValue}` : "";
    const url  = `${MFL_API_HOST}/${year}/export?TYPE=league&L=${leagueId}&JSON=1${auth}`;
    const res  = await _proxyFetch(url).catch(() => null);
    if (!res) return null;
    const data = await res.json().catch(() => null);
    return data?.league || null;
  }

  async function getStandings(leagueId, year, cookieValue = null) {
    const auth = cookieValue ? `&MFL_USER_ID=${cookieValue}` : "";
    const url  = `${MFL_API_HOST}/${year}/export?TYPE=leagueStandings&L=${leagueId}&JSON=1${auth}`;
    const res  = await _proxyFetch(url).catch(() => null);
    if (!res) return [];
    const data = await res.json().catch(() => null);
    const standings = data?.leagueStandings?.franchise;
    if (!standings) return [];
    const arr = Array.isArray(standings) ? standings : [standings];
    return arr.map((s, i) => ({
      franchiseId:  s.id,
      wins:         parseInt(s.h2hw  || s.W  || 0),
      losses:       parseInt(s.h2hl  || s.L  || 0),
      ties:         parseInt(s.h2ht  || s.T  || 0),
      ptsFor:       parseFloat(s.pf  || s.PF || 0),
      ptsAgainst:   parseFloat(s.pa  || s.PA || 0),
      rank:         i + 1
    }));
  }

  async function getPlayoffResults(leagueId, year, cookieValue = null) {
    const auth = cookieValue ? `&MFL_USER_ID=${cookieValue}` : "";
    const url  = `${MFL_API_HOST}/${year}/export?TYPE=playoffResults&L=${leagueId}&JSON=1${auth}`;
    const res  = await _proxyFetch(url).catch(() => null);
    if (!res) return null;
    const data = await res.json().catch(() => null);
    return data?.playoffResults || null;
  }

  // ── Detect playoff finish ──────────────────────────────
  async function getPlayoffFinish(leagueId, year, franchiseId, cookieValue = null) {
    try {
      const results = await getPlayoffResults(leagueId, year, cookieValue);
      if (!results) return null;

      const games = results.playoffGame;
      if (!games) return null;
      const arr = Array.isArray(games) ? games : [games];

      // Sort by week descending — last game is final
      arr.sort((a, b) => parseInt(b.week) - parseInt(a.week));

      // Championship game (highest week, away/home includes our franchise)
      const champGame = arr[0];
      if (!champGame) return null;

      const winners  = [champGame.winner].flat();
      const losers   = [champGame.loser].flat();

      if (winners.includes(franchiseId)) return 1;
      if (losers.includes(franchiseId))  return 2;

      // Check 3rd place game (same week, different game)
      const thirdGame = arr.find(g =>
        g.week === champGame.week && g !== champGame
      );
      if (thirdGame) {
        if ([thirdGame.winner].flat().includes(franchiseId)) return 3;
        if ([thirdGame.loser].flat().includes(franchiseId))  return 4;
      }

      // Made playoffs (appeared in any game)
      if (arr.some(g => [...[g.winner].flat(), ...[g.loser].flat()].includes(franchiseId))) {
        return 5;
      }
    } catch(e) {
      console.warn("[MFL] getPlayoffFinish:", e.message);
    }
    return null;
  }

  // ── Full import ────────────────────────────────────────
  // MFL blocks browser cookie headers and leagueSearch matches league names, not owners.
  // Best approach: user provides their league IDs directly, we find their franchise within each.
  // If league IDs not provided, fall back to leagueSearch by username.
  async function importUserLeagues(emailOrUsername, password, knownLeagueIds = []) {
    if (!emailOrUsername?.trim()) throw new Error("Enter your MFL username or email.");

    const mflUsername = emailOrUsername.includes("@")
      ? emailOrUsername.split("@")[0]
      : emailOrUsername;

    // Step 1: optional login to verify credentials
    if (password?.trim()) {
      try {
        await login(emailOrUsername.trim(), password.trim());
        console.log("[MFL] Login verified");
      } catch(e) {
        console.warn("[MFL] Login failed:", e.message);
      }
    }

    // Step 2: Build list of league+year pairs to process
    const toProcess = []; // [{ leagueId, leagueName, year }]

    // If user provided known league IDs, search those across all years
    if (knownLeagueIds.length) {
      const currentYear = new Date().getFullYear();
      const years = [currentYear, currentYear-1, currentYear-2, currentYear-3, currentYear-4].map(String);
      for (const leagueId of knownLeagueIds) {
        for (const year of years) {
          try {
            const data = await getLeague(leagueId, year);
            if (data) {
              // Don't break — collect ALL years for this league ID
              toProcess.push({ leagueId, leagueName: data.name || `League ${leagueId}`, year });
            }
          } catch(e) {}
        }
      }
    }

    // Fallback: leagueSearch by username
    if (!toProcess.length) {
      const found = await getMyLeagues(mflUsername);
      toProcess.push(...found);
    }

    if (!toProcess.length) {
      throw new Error(
        `No MFL leagues found. Try entering your MFL league IDs directly in the ` +
        `"League IDs" field (e.g. 21600). You can find these in your MFL league URL.`
      );
    }

    const leaguesMap = {};

    for (const { leagueId, leagueName, year } of toProcess) {
      try {
        const [leagueData, standings] = await Promise.all([
          getLeague(leagueId, year),
          getStandings(leagueId, year)
        ]);
        if (!leagueData) continue;

        // Find the user's franchise — try multiple name formats
        const franchiseInfo = await findMyFranchise(leagueId, year, mflUsername);
        if (!franchiseInfo) {
          console.warn(`[MFL] Could not match franchise for "${mflUsername}" in league ${leagueId} (${year})`);
          continue;
        }

        const { franchiseId, teamName } = franchiseInfo;
        const myStanding = standings.find(s => s.franchiseId === franchiseId);
        const finish     = await getPlayoffFinish(leagueId, year, franchiseId);

        const franchises   = leagueData?.franchises?.franchise;
        const franchiseArr = franchises ? (Array.isArray(franchises) ? franchises : [franchises]) : [];
        const leagueType   = _detectLeagueType(leagueData, leagueName);

        const key = `mfl_${year}_${leagueId}`;
        leaguesMap[key] = {
          platform:       "mfl",
          leagueId,
          franchiseId:    `mfl__${leagueId}`,   // stable across years — same ID every season
          leagueName:     leagueData.name || leagueName,
          season:         year,
          leagueType,
          totalTeams:     franchiseArr.length || 12,
          teamName:       teamName || "My Team",
          isCommissioner: false,
          wins:           myStanding?.wins      || 0,
          losses:         myStanding?.losses    || 0,
          ties:           myStanding?.ties      || 0,
          pointsFor:      myStanding?.ptsFor    || 0,
          pointsAgainst:  myStanding?.ptsAgainst || 0,
          standing:       myStanding?.rank      || null,
          playoffFinish:  finish,
          isChampion:     finish === 1,
          playoffResult:  _finishLabel(finish)
        };
      } catch(e) {
        console.warn(`[MFL] Skipping ${leagueId} (${year}):`, e.message);
      }
    }

    return { mflUsername, leagues: leaguesMap };
  }

  // ── MFL franchise linking by league name ─────────────────
  // MFL doesn't have a prev_league_id chain like Sleeper.
  // We group seasons of the same franchise by matching league name (normalized).
  // The franchiseId = normalized name key so profile.js can group them.
  function _mflFranchiseId(leagueName) {
    return "mfl__" + (leagueName || "")
      .toLowerCase()
      .replace(/\b(20\d{2}|season\s*\d+|s\d+|year\s*\d+)\b/gi, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .trim();
  }

  function _detectLeagueType(leagueData, name = "") {
    const lname = (name || leagueData?.name || "").toLowerCase();

    // Name-based (most reliable)
    if (lname.includes("dynasty"))       return "dynasty";
    if (lname.includes("keeper"))        return "keeper";

    // MFL keeperType field — values vary: "unlimited", "1", "5", "no", "0", ""
    const kt = String(leagueData?.keeperType || "").toLowerCase().trim();
    if (kt === "unlimited")              return "dynasty";
    if (kt && kt !== "0" && kt !== "no" && kt !== "" && kt !== "false") return "keeper";

    return "redraft";
  }

  function _finishLabel(finish) {
    return { 1:"champion", 2:"finalist", 3:"third", 4:"fourth" }[finish] || null;
  }

  // ── Public API ─────────────────────────────────────────
  return {
    login,
    getMyLeagues,
    findMyFranchise,
    getLeague,
    getStandings,
    getPlayoffResults,
    getPlayoffFinish,
    importUserLeagues
  };

})();
