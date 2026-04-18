// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Cloudflare Worker
// ─────────────────────────────────────────────────────────

export default {
  async fetch(req, env, ctx) {
    const url  = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (path === "/auth/yahoo/login")    return yahooLogin(env);
      if (path === "/auth/yahoo/callback") return yahooCallback(req, env);

      if (path === "/auth/yahoo/refresh" && req.method === "POST") {
        const { refresh_token } = await req.json();
        if (!refresh_token) {
          return new Response(JSON.stringify({ error: "Missing refresh_token" }), { status: 400, headers: corsHeaders() });
        }
        const tokenRes = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
          method: "POST",
          headers: {
            "Authorization": "Basic " + btoa(`${env.YAHOO_CLIENT_ID}:${env.YAHOO_CLIENT_SECRET}`),
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token })
        });
        const tokenText = await tokenRes.text();
        let tokenData;
        try { tokenData = JSON.parse(tokenText); } catch {
          return new Response(JSON.stringify({ error: "Refresh parse error", raw: tokenText }), { status: 500, headers: corsHeaders() });
        }
        if (tokenData.error) {
          return new Response(JSON.stringify(tokenData), { status: 400, headers: corsHeaders() });
        }
        return new Response(JSON.stringify({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || refresh_token,
          expires_in: tokenData.expires_in
        }), { headers: corsHeaders() });
      }

      if (path === "/yahoo/leagues" && req.method === "POST") {
        const { access_token } = await req.json();
        if (!access_token) return new Response(JSON.stringify({ error: "Missing access_token" }), { status: 400, headers: corsHeaders() });
        const userRes = await fetch(
          "https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_codes=nfl/leagues?format=json",
          { headers: { Authorization: `Bearer ${access_token}`, Accept: "application/json" } }
        );
        if (!userRes.ok) {
          const errText = await userRes.text();
          return new Response(JSON.stringify({ error: "Yahoo API error", detail: errText.slice(0,300) }), { status: 400, headers: corsHeaders() });
        }
        const userData = await userRes.json();
        if (!userData?.fantasy_content) return new Response(JSON.stringify({ error: "Bad Yahoo response", raw: userData }), { headers: corsHeaders() });
        const leagues = [];
        try {
          const users = userData?.fantasy_content?.users;
          const user  = users?.["0"]?.user;
          const games = user?.["1"]?.games;
          if (games) {
            const gameCount = games?.count || 0;
            for (let g = 0; g < gameCount; g++) {
              const game = games[String(g)]?.game;
              if (!game) continue;
              const season = game[0]?.season;
              const leaguesObj = game[1]?.leagues;
              if (!leaguesObj) continue;
              const leagueCount = leaguesObj.count || 0;
              for (let l = 0; l < leagueCount; l++) {
                const league = leaguesObj[String(l)]?.league?.[0];
                if (!league) continue;
                leagues.push({ league_id: league.league_id, name: league.name, season: season || league.season, num_teams: league.num_teams, league_key: league.league_key });
              }
            }
          }
        } catch(e) {
          return new Response(JSON.stringify({ error: "Parse error", detail: e.message }), { status: 500, headers: corsHeaders() });
        }
        return new Response(JSON.stringify(leagues), { headers: corsHeaders() });
      }

      if (path === "/yahoo/leagueBundle" && req.method === "POST") {
        const { access_token, league_key } = await req.json();
        if (!access_token || !league_key) return new Response(JSON.stringify({ error: "Missing access_token or league_key" }), { status: 400, headers: corsHeaders() });
        return yahooLeagueBundle(access_token, league_key);
      }

      if (path === "/yahoo/playerStats" && req.method === "POST") {
        const { access_token, league_key, player_ids } = await req.json();
        if (!access_token || !league_key || !Array.isArray(player_ids)) {
          return new Response(JSON.stringify({ error: "Missing access_token, league_key, or player_ids" }), { status: 400, headers: corsHeaders() });
        }
        return yahooPlayerStats(access_token, league_key, player_ids);
      }

      if (path === "/yahoo/matchupDetail" && req.method === "POST") {
        const { access_token, league_key, week } = await req.json();
        if (!access_token || !league_key || !week) {
          return new Response(JSON.stringify({ error: "Missing access_token, league_key, or week" }), { status: 400, headers: corsHeaders() });
        }
        return yahooMatchupDetail(access_token, league_key, week);
      }

      if (path === "/mfl/userLeagues" && req.method === "POST") {
        const { username, password } = await req.json();
        if (!username || !password) return new Response(JSON.stringify({ error: "Missing credentials" }), { status: 400, headers: corsHeaders() });
        const currentYear = new Date().getFullYear();
        const loginRes = await fetch(`https://api.myfantasyleague.com/${currentYear}/login?USERNAME=${encodeURIComponent(username)}&PASSWORD=${encodeURIComponent(password)}&XML=1`, { headers: mflHeaders() });
        const loginXml = await loginRes.text();
        const cookieMatch = loginXml.match(/MFL_USER_ID="([^"]+)"/);
        if (!cookieMatch) return new Response(JSON.stringify({ error: "MFL login failed — check username and password", loginResponse: loginXml.slice(0, 300) }), { status: 200, headers: corsHeaders() });
        const cookieValue = cookieMatch[1];

        // ── Fetch all leagues in one shot using SINCE= parameter ──────────────
        // MFL supports TYPE=myleagues&SINCE=YYYY to return leagues across all years
        // from that year to present — one request instead of 27.
        // Falls back to year-by-year batching if the single request fails or returns
        // nothing (some MFL account configurations don't support SINCE=).
        const allLeagues = [];

        let usedSince = false;
        try {
          const sinceUrl = `https://api.myfantasyleague.com/${currentYear}/export?TYPE=myleagues&SINCE=1999&JSON=1`;
          const sinceRes = await fetch(sinceUrl, { headers: mflHeaders({ Cookie: `MFL_USER_ID=${cookieValue}` }) });
          const sinceText = await sinceRes.text();
          let sinceData;
          try { sinceData = JSON.parse(sinceText); } catch(e) {}
          if (sinceData?.leagues?.league) {
            const list = Array.isArray(sinceData.leagues.league)
              ? sinceData.leagues.league
              : [sinceData.leagues.league];
            // SINCE= responses include a season field on each league
            list.forEach(l => { if (l.league_id || l.id) allLeagues.push(l); });
            usedSince = allLeagues.length > 0;
          }
        } catch(e) {}

        // Fallback: year-by-year batching if SINCE= returned nothing
        if (!usedSince) {
          const years = [];
          for (let y = currentYear; y >= 2005; y--) years.push(y);  // 2005 covers most dynasty leagues

          const BATCH_SIZE    = 4;
          const BATCH_DELAY_MS = 150;

          for (let i = 0; i < years.length; i += BATCH_SIZE) {
            const batch = years.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.allSettled(
              batch.map(async y => {
                const r    = await fetch(`https://api.myfantasyleague.com/${y}/export?TYPE=myleagues&JSON=1`,
                  { headers: mflHeaders({ Cookie: `MFL_USER_ID=${cookieValue}` }) });
                const text = await r.text();
                let data;
                try { data = JSON.parse(text); } catch(e) { return []; }
                if (!data || typeof data !== "object") return [];
                const list = data?.leagues?.league
                  ? (Array.isArray(data.leagues.league) ? data.leagues.league : [data.leagues.league])
                  : [];
                return list.map(l => ({ ...l, season: String(y) }));
              })
            );
            batchResults.forEach(r => { if (r.status === "fulfilled") allLeagues.push(...r.value); });

            if (i + BATCH_SIZE < years.length) {
              await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
            }
          }
        }

        // Deduplicate by league_id + season
        const seen = new Map();
        for (const l of allLeagues) {
          const id  = l.league_id || l.id;
          const key = `${id}_${l.season}`;
          if (id && !seen.has(key)) seen.set(key, l);
        }
        return new Response(JSON.stringify([...seen.values()]), { headers: corsHeaders() });
      }

      // Standalone login — returns cookie so the client can reuse it across bundle calls
      // instead of re-logging in for every league (28 leagues = 28 logins otherwise).
      if (path === "/mfl/login" && req.method === "POST") {
        const { username, password, year } = await req.json();
        if (!username || !password) return new Response(JSON.stringify({ error: "Missing credentials" }), { status: 400, headers: corsHeaders() });
        const yr       = year || new Date().getFullYear();
        const loginRes = await fetch(`https://api.myfantasyleague.com/${yr}/login?USERNAME=${encodeURIComponent(username)}&PASSWORD=${encodeURIComponent(password)}&XML=1`, { headers: mflHeaders() });
        const loginXml = await loginRes.text();
        const m        = loginXml.match(/MFL_USER_ID="([^"]+)"/);
        if (!m) return new Response(JSON.stringify({ error: "MFL login failed", loginResponse: loginXml.slice(0, 300) }), { status: 200, headers: corsHeaders() });
        return new Response(JSON.stringify({ cookie: m[1] }), { headers: corsHeaders() });
      }

      if (path === "/mfl/bundle" && req.method === "POST") {
        const { leagueId, year, username, password, cookie } = await req.json();
        if (!leagueId) return new Response(JSON.stringify({ error: "Missing leagueId" }), { status: 400, headers: corsHeaders() });
        let cookieHeader = "";
        // Accept pre-obtained cookie directly (preferred — avoids redundant logins)
        if (cookie) {
          cookieHeader = `MFL_USER_ID=${cookie}`;
        } else if (username && password) {
          const yr = year || new Date().getFullYear();
          const loginRes = await fetch(`https://api.myfantasyleague.com/${yr}/login?USERNAME=${encodeURIComponent(username)}&PASSWORD=${encodeURIComponent(password)}&XML=1`, { headers: mflHeaders() });
          const loginXml = await loginRes.text();
          const m = loginXml.match(/MFL_USER_ID="([^"]+)"/);
          if (m) cookieHeader = `MFL_USER_ID=${m[1]}`;
        }
        return mflBundle(leagueId, year, cookieHeader);
      }

      // On-demand: fetch a single week of liveScoring (for matchups tab week picker)
      if (path === "/mfl/liveScoring" && req.method === "POST") {
        const { leagueId, year, week, username, password } = await req.json();
        if (!leagueId) return new Response(JSON.stringify({ error: "Missing leagueId" }), { status: 400, headers: corsHeaders() });
        let cookieHeader = "";
        if (username && password) {
          const yr = year || new Date().getFullYear();
          const loginRes = await fetch(`https://api.myfantasyleague.com/${yr}/login?USERNAME=${encodeURIComponent(username)}&PASSWORD=${encodeURIComponent(password)}&XML=1`, { headers: mflHeaders() });
          const loginXml = await loginRes.text();
          const m = loginXml.match(/MFL_USER_ID="([^"]+)"/);
          if (m) cookieHeader = `MFL_USER_ID=${m[1]}`;
        }
        const season  = year || new Date().getFullYear();
        const headers = mflHeaders(cookieHeader ? { Cookie: cookieHeader } : {});
        const weekParam = week ? `&W=${week}` : "";
        const r    = await fetch(`https://api.myfantasyleague.com/${season}/export?TYPE=liveScoring&L=${leagueId}${weekParam}&JSON=1`, { headers });
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch(e) { data = {}; }
        return new Response(JSON.stringify(data), { headers: corsHeaders() });
      }

      // On-demand: fetch a specific playoff bracket by bracket_id
      if (path === "/mfl/playoffBracket" && req.method === "POST") {
        const { leagueId, year, bracketId, username, password } = await req.json();
        if (!leagueId) return new Response(JSON.stringify({ error: "Missing leagueId" }), { status: 400, headers: corsHeaders() });
        let cookieHeader = "";
        if (username && password) {
          const yr = year || new Date().getFullYear();
          const loginRes = await fetch(`https://api.myfantasyleague.com/${yr}/login?USERNAME=${encodeURIComponent(username)}&PASSWORD=${encodeURIComponent(password)}&XML=1`, { headers: mflHeaders() });
          const loginXml = await loginRes.text();
          const m = loginXml.match(/MFL_USER_ID="([^"]+)"/);
          if (m) cookieHeader = `MFL_USER_ID=${m[1]}`;
        }
        const season  = year || new Date().getFullYear();
        const headers = mflHeaders(cookieHeader ? { Cookie: cookieHeader } : {});
        const bracketParam = bracketId ? `&BRACKET_ID=${bracketId}` : "";
        const r    = await fetch(`https://api.myfantasyleague.com/${season}/export?TYPE=playoffBracket&L=${leagueId}${bracketParam}&JSON=1`, { headers });
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch(e) { data = {}; }
        return new Response(JSON.stringify(data), { headers: corsHeaders() });
      }

      // On-demand: fetch auction results directly (fallback when bundle value is null)
      if (path === "/mfl/auctionResults" && req.method === "POST") {
        const { leagueId, year, cookie, username, password } = await req.json();
        if (!leagueId) return new Response(JSON.stringify({ error: "Missing leagueId" }), { status: 400, headers: corsHeaders() });
        const season = year || new Date().getFullYear();
        let cookieHdr = "";
        if (cookie) {
          cookieHdr = `MFL_USER_ID=${cookie}`;
        } else if (username && password) {
          const loginRes = await fetch(`https://api.myfantasyleague.com/${season}/login?USERNAME=${encodeURIComponent(username)}&PASSWORD=${encodeURIComponent(password)}&XML=1`, { headers: mflHeaders() });
          const loginXml = await loginRes.text();
          const m = loginXml.match(/MFL_USER_ID="([^"]+)"/);
          if (m) cookieHdr = `MFL_USER_ID=${m[1]}`;
        }
        const headers = mflHeaders(cookieHdr ? { Cookie: cookieHdr } : {});
        const r    = await fetch(`https://api.myfantasyleague.com/${season}/export?TYPE=auctionResults&L=${leagueId}&JSON=1`, { headers });
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch(e) { data = {}; }
        return new Response(JSON.stringify(data), { headers: corsHeaders() });
      }

      // On-demand: fetch full MFL player universe (cached by client per session).
      // Pass leagueId to include league-custom players (draft picks, custom roster spots).
      if (path === "/mfl/players" && req.method === "POST") {
        const { year, leagueId } = await req.json();
        const season = year || new Date().getFullYear();
        // Including &L=leagueId causes MFL to return custom players defined for that league
        // (e.g. "2025 Rookie, 4.01" draft pick proxies). Falls back gracefully if no leagueId.
        const leagueParam = leagueId ? `&L=${encodeURIComponent(leagueId)}` : "";
        const r = await fetch(
          `https://api.myfantasyleague.com/${season}/export?TYPE=players${leagueParam}&JSON=1`,
          { headers: mflHeaders() }
        );
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch(e) { data = {}; }
        return new Response(JSON.stringify(data), { headers: corsHeaders() });
      }

      // On-demand: fetch rosters for a specific week so IR/Taxi status is accurate.
      // The bundle's TYPE=rosters fetch has no W= param and returns current-snapshot
      // status which may not reflect end-of-season slot assignments.
      if (path === "/mfl/rosters" && req.method === "POST") {
        const { leagueId, year, week, cookie, username, password } = await req.json();
        if (!leagueId) return new Response(JSON.stringify({ error: "Missing leagueId" }), { status: 400, headers: corsHeaders() });
        const season = year || new Date().getFullYear();
        let cookieHdr = "";
        if (cookie) {
          cookieHdr = `MFL_USER_ID=${cookie}`;
        } else if (username && password) {
          const loginRes = await fetch(`https://api.myfantasyleague.com/${season}/login?USERNAME=${encodeURIComponent(username)}&PASSWORD=${encodeURIComponent(password)}&XML=1`, { headers: mflHeaders() });
          const loginXml = await loginRes.text();
          const m = loginXml.match(/MFL_USER_ID="([^"]+)"/);
          if (m) cookieHdr = `MFL_USER_ID=${m[1]}`;
        }
        const headers   = mflHeaders(cookieHdr ? { Cookie: cookieHdr } : {});
        const weekParam = week ? `&W=${week}` : "";
        const r    = await fetch(`https://api.myfantasyleague.com/${season}/export?TYPE=rosters&L=${leagueId}${weekParam}&JSON=1`, { headers });
        const text = await r.text();
        let data;
        try { data = JSON.parse(text); } catch(e) { data = {}; }
        return new Response(JSON.stringify(data), { headers: corsHeaders() });
      }

      return new Response("Worker running", { headers: corsHeaders() });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders() });
    }
  }
};

async function mflBundle(leagueId, year, cookieHeader) {
  const season  = year || new Date().getFullYear();
  const headers = mflHeaders(cookieHeader ? { Cookie: cookieHeader } : {});
  const base    = `https://api.myfantasyleague.com/${season}/export`;
  // NOTE: `players` (full MFL player universe ~500KB) and `salaries` are excluded from the
  // bundle — players are resolved via the Sleeper DB on the frontend; salaries not yet used.
  // `schedule` and `scoreboard` are replaced by `liveScoring` which covers all weeks + live data.
  // `playoffBrackets` lists all brackets defined by the commish; individual bracket results
  // are fetched on-demand via /mfl/playoffBracket.
  const endpoints = {
    league:          `${base}?TYPE=league&L=${leagueId}&JSON=1`,
    rosters:         `${base}?TYPE=rosters&L=${leagueId}&JSON=1`,
    standings:       `${base}?TYPE=leagueStandings&L=${leagueId}&JSON=1`,
    liveScoring:     `${base}?TYPE=liveScoring&L=${leagueId}&JSON=1`,
    draft:           `${base}?TYPE=draftResults&L=${leagueId}&JSON=1`,
    auctionResults:  `${base}?TYPE=auctionResults&L=${leagueId}&JSON=1`,
    transactions:    `${base}?TYPE=transactions&L=${leagueId}&JSON=1`,
    playerScores:    `${base}?TYPE=playerScores&L=${leagueId}&SEASON=${season}&WEEK=YTD&JSON=1`,
    playoffBrackets: `${base}?TYPE=playoffBrackets&L=${leagueId}&JSON=1`,
  };
  const results = await Promise.allSettled(
    Object.entries(endpoints).map(async ([key, url]) => {
      const r    = await fetch(url, { headers });
      const text = await r.text();
      // MFL sometimes returns plain text like "No" or "No\n\n" for endpoints
      // that don't apply to a league (e.g. auctionResults on a snake draft league,
      // or liveScoring before the season starts). Safely skip those.
      try {
        const data = JSON.parse(text);
        return [key, data];
      } catch(e) {
        // Non-JSON response — treat as empty for this key
        return [key, null];
      }
    })
  );
  const bundle = {};
  for (const r of results) {
    if (r.status === "fulfilled") { const [key, data] = r.value; bundle[key] = data; }
  }
  return new Response(JSON.stringify(bundle), { headers: corsHeaders() });
}

async function yahooLeagueBundle(accessToken, leagueKey) {
  const base    = "https://fantasysports.yahooapis.com/fantasy/v2";
  const authHdr = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

  // ── Helper: extract Yahoo player_id from player_key (e.g. "449.p.32723" → "32723")
  // The DynastyProcess CSV uses bare numeric IDs, not Yahoo's prefixed player_key format.
  function yahooPlayerId(playerKey) {
    if (!playerKey) return null;
    const s = String(playerKey);
    // player_key format: "{game_id}.p.{numeric_id}" — take everything after last dot
    const parts = s.split(".");
    return parts[parts.length - 1] || s;
  }

  // ── Helper: find a key in Yahoo's mixed array/object structures ──────────
  const findVal = (arr, key) => {
    if (!Array.isArray(arr)) return arr?.[key] ?? null;
    for (const obj of arr) { if (obj && typeof obj === "object" && key in obj) return obj[key]; }
    return null;
  };

  // ── Fetch all bundle endpoints in parallel ────────────────────────────────
  // scoreboard with no week param returns the current/most-recent week.
  // We also fetch settings so we can get playoff_start_week, current_week, end_week.
  const [settingsRes, standingsRes, rostersRes, matchupsRes, transactionsRes, draftRes] =
    await Promise.allSettled([
      fetch(`${base}/league/${leagueKey}/settings?format=json`,                          { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/standings?format=json`,                         { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/teams;out=roster?format=json`,                  { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/scoreboard?format=json`,                        { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/transactions;types=add,drop,trade?format=json`, { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/draftresults;out=draft_results?format=json`,     { headers: authHdr }),
    ]);

  async function toJson(s) {
    if (s.status !== "fulfilled") return null;
    const r = s.value;
    if (!r.ok) return null;
    try { return await r.json(); } catch { return null; }
  }

  const [settingsData, standingsData, rostersData, matchupsData, transactionsData, draftData] =
    await Promise.all([toJson(settingsRes), toJson(standingsRes), toJson(rostersRes), toJson(matchupsRes), toJson(transactionsRes), toJson(draftRes)]);

  // Use standings response for league meta; fall back to settings
  const leagueRaw = standingsData?.fantasy_content?.league || settingsData?.fantasy_content?.league || null;

  // ── League settings — extract from settings endpoint ─────────────────────
  // settings response: league[0] has meta, league[1].settings has rules
  const settLeague   = settingsData?.fantasy_content?.league || leagueRaw;
  const settMeta     = settLeague?.[0] || {};
  const settRules    = settLeague?.[1]?.settings?.[0] || {};
  const leagueMeta = {
    name:               findVal([settMeta], "name")                || "",
    current_week:       parseInt(findVal([settMeta], "current_week") || settRules.current_week || 1),
    start_week:         parseInt(findVal([settMeta], "start_week")   || settRules.start_week   || 1),
    end_week:           parseInt(findVal([settMeta], "end_week")     || settRules.end_week      || 17),
    is_finished:        parseInt(findVal([settMeta], "is_finished")  || 0),
    playoff_start_week: parseInt(settRules.playoff_start_week || 0),
    num_playoff_teams:  parseInt(settRules.num_playoff_teams  || 0),
    uses_playoff:       parseInt(settRules.uses_playoff       || 0),
    scoring_type:       findVal([settMeta], "scoring_type")         || "head",
    draft_status:       findVal([settMeta], "draft_status")         || "",
    season:             findVal([settMeta], "season")               || "",
    faab_balance:       null,   // per-team
    // League type detection fields
    uses_roster_import: parseInt(settRules.uses_roster_import || 0),  // 1 = keeper (players carry over)
    is_auction_draft:   parseInt(settRules.is_auction_draft   || 0),  // 1 = auction
    draft_type:         settRules.draft_type || "",                    // "self"=salary/keeper, "live"=live
  };

  // ── Teams + Standings ─────────────────────────────────────────────────────
  // standings response: league[1].standings[0].teams is the teams object.
  // Each team entry: team[0] = array of info objects (name, team_id, managers, etc)
  //                 team[1] = team_points  (may be absent in some responses)
  //                 team[2] = team_standings (rank, outcome_totals, points_for/against)
  // is_owned_by_current_login = 1 appears in team[0] info array when this is the
  // logged-in user's team — critical for identifying "my team" in the UI.
  let teams = [], standings = [], myTeamId = null;
  try {
    const teamsObj = leagueRaw?.[1]?.standings?.[0]?.teams || {};
    const count = teamsObj.count || 0;
    for (let i = 0; i < count; i++) {
      const team = teamsObj[String(i)]?.team;
      if (!team) continue;
      const info    = team[0];   // array of {team_id}, {name}, {managers}, {is_owned_by_current_login}, etc.
      const statsObj = team[2]?.team_standings;
      const teamId   = String(findVal(info, "team_id") || "");
      const teamName = findVal(info, "name") || `Team ${teamId}`;
      const managers = findVal(info, "managers");
      const manager  = managers?.[0]?.manager || {};
      const ownerName = manager.nickname || manager.guid || "";
      const isMyTeam  = !!(findVal(info, "is_owned_by_current_login") || manager.is_current_login);
      const faab      = parseInt(findVal(info, "faab_balance") ?? -1);
      const clinched  = !!(findVal(info, "clinched_playoffs"));
      if (isMyTeam) myTeamId = teamId;

      teams.push({
        id: teamId, name: teamName,
        owner_name: ownerName, ownerName: ownerName,
        isMyTeam, faab: faab >= 0 ? faab : null, clinched,
      });
      standings.push({
        teamId,
        wins:        parseInt(statsObj?.outcome_totals?.wins        || 0),
        losses:      parseInt(statsObj?.outcome_totals?.losses      || 0),
        ties:        parseInt(statsObj?.outcome_totals?.ties        || 0),
        ptsFor:      parseFloat(statsObj?.points_for                || 0),
        ptsAgainst:  parseFloat(statsObj?.points_against            || 0),
        rank:        parseInt(statsObj?.rank || i + 1),
        playoffSeed: parseInt(statsObj?.playoff_seed                || 0),
        clinched,
      });
    }
  } catch(e) {}

  // ── Rosters ───────────────────────────────────────────────────────────────
  // teams;out=roster: rostersData.fantasy_content.league[1].teams[i].team
  // team[0] = array of info (including team_id)
  // team[1].roster[0].players[j].player[0] = array of player info objects
  //   player_key: "449.p.32723"  — strip to "32723" for DynastyProcess lookup
  //   display_position, eligible_positions, name.full, editorial_team_abbr, status
  // playerDetails carries Yahoo-native bio so the frontend has a fallback for
  // players that don't resolve via DynastyProcess (e.g. DEF teams, kickers).
  let rosters = [];
  try {
    const rosLeague = rostersData?.fantasy_content?.league;
    const rosTeams  = rosLeague?.[1]?.teams || {};
    const count = rosTeams.count || 0;
    for (let i = 0; i < count; i++) {
      const team   = rosTeams[String(i)]?.team;
      if (!team) continue;
      // team[0] is an array of info objects for this team
      const teamInfo = Array.isArray(team[0]) ? team[0] : [team[0]];
      const teamId   = String(findVal(teamInfo, "team_id") || "");
      const roster   = team[1]?.roster;
      const players  = roster?.[0]?.players || {};
      const playerIds     = [];
      const playerDetails = [];
      const pCount = players.count || 0;
      for (let j = 0; j < pCount; j++) {
        const p = players[String(j)]?.player;
        if (!p) continue;
        // player[0] = array of info objects, player[1] = selected_position
        const pInfo = Array.isArray(p[0]) ? p[0] : [p[0]];
        const rawId = findVal(pInfo, "player_id") || findVal(pInfo, "player_key");
        const pid   = yahooPlayerId(rawId);
        if (!pid) continue;
        playerIds.push(pid);
        // Extract Yahoo-native bio — used as fallback when DynastyProcess has no match
        const nameObj = findVal(pInfo, "name");
        const fullName   = (typeof nameObj === "object" ? nameObj?.full : nameObj) || "";
        const dispPos    = findVal(pInfo, "display_position") || findVal(pInfo, "eligible_positions") || "";
        const pos        = typeof dispPos === "object" ? (dispPos?.position || "") : dispPos;
        const nflTeam    = findVal(pInfo, "editorial_team_abbr") || "";
        const statusVal  = findVal(pInfo, "status") || "";
        if (fullName || pos) {
          playerDetails.push({ id: pid, name: fullName, position: pos, nflTeam, status: statusVal });
        }
      }
      rosters.push({ teamId, players: playerIds, playerDetails });
    }
  } catch(e) {}

  // ── Matchups (current/most-recent week scoreboard) ────────────────────────
  // scoreboard response: league[1].scoreboard.week = current week number
  //   scoreboard["0"].matchups[i].matchup["0"].teams["0"/"1"].team
  //   team[0] = array of info including team_id, team_key, name
  //   team[1].team_points.total = score for that week
  //   matchup.winner_team_key = team_key of winner (or "" if tied/in-progress)
  let matchups = [];
  let currentWeek = leagueMeta.current_week;
  try {
    const muLeague   = matchupsData?.fantasy_content?.league;
    const scoreboard = muLeague?.[1]?.scoreboard;
    const sbWeek     = parseInt(scoreboard?.week || 0);
    if (sbWeek) currentWeek = sbWeek;
    const matchupsObj = scoreboard?.["0"]?.matchups || {};
    const count = matchupsObj.count || 0;
    for (let i = 0; i < count; i++) {
      const mu = matchupsObj[String(i)]?.matchup;
      if (!mu) continue;
      const muTeams      = mu["0"]?.teams || {};
      const t0           = muTeams["0"]?.team;
      const t1           = muTeams["1"]?.team;
      const t0Info       = Array.isArray(t0?.[0]) ? t0[0] : [t0?.[0]].filter(Boolean);
      const t1Info       = Array.isArray(t1?.[0]) ? t1[0] : [t1?.[0]].filter(Boolean);
      const id0          = String(findVal(t0Info, "team_id") || "");
      const id1          = String(findVal(t1Info, "team_id") || "");
      const sc0          = parseFloat(t0?.[1]?.team_points?.total || 0);
      const sc1          = parseFloat(t1?.[1]?.team_points?.total || 0);
      const winnerKey    = mu.winner_team_key || "";
      const winnerTeamId = winnerKey ? String(winnerKey).split(".").pop() : null;
      matchups.push({
        week:       sbWeek,
        home:       { teamId: id0, score: sc0 },
        away:       { teamId: id1, score: sc1 },
        winnerTeamId,
        status:     mu.status || "",
        isTied:     !!(mu.is_tied),
      });
    }
  } catch(e) {}

  // ── All-weeks scoreboard (fetch weeks 1 → end_week in parallel) ───────────
  // This powers the week picker and playoffs view. Capped at 17 regular weeks
  // plus up to 4 playoff weeks. Each per-week fetch is the same scoreboard
  // endpoint with ;week={n}. We only fetch if we know the week range.
  let allMatchups = {};  // { [week]: matchups[] }
  try {
    const endWeek = leagueMeta.end_week || leagueMeta.current_week || 17;
    const weeks   = Array.from({ length: endWeek }, (_, i) => i + 1);
    const weekResults = await Promise.allSettled(
      weeks.map(w =>
        fetch(`${base}/league/${leagueKey}/scoreboard;week=${w}?format=json`, { headers: authHdr })
          .then(r => r.ok ? r.json() : null).catch(() => null)
      )
    );
    weeks.forEach((w, idx) => {
      const data = weekResults[idx]?.status === "fulfilled" ? weekResults[idx].value : null;
      if (!data) return;
      const sb = data?.fantasy_content?.league?.[1]?.scoreboard;
      if (!sb) return;
      const muObj = sb?.["0"]?.matchups || {};
      const wMatchups = [];
      const count = muObj.count || 0;
      for (let i = 0; i < count; i++) {
        const mu = muObj[String(i)]?.matchup;
        if (!mu) continue;
        const muTeams   = mu["0"]?.teams || {};
        const t0        = muTeams["0"]?.team;
        const t1        = muTeams["1"]?.team;
        const t0Info    = Array.isArray(t0?.[0]) ? t0[0] : [t0?.[0]].filter(Boolean);
        const t1Info    = Array.isArray(t1?.[0]) ? t1[0] : [t1?.[0]].filter(Boolean);
        const id0       = String(findVal(t0Info, "team_id") || "");
        const id1       = String(findVal(t1Info, "team_id") || "");
        const sc0       = parseFloat(t0?.[1]?.team_points?.total || 0);
        const sc1       = parseFloat(t1?.[1]?.team_points?.total || 0);
        const winnerKey = mu.winner_team_key || "";
        wMatchups.push({
          week:        w,
          home:        { teamId: id0, score: sc0 },
          away:        { teamId: id1, score: sc1 },
          winnerTeamId: winnerKey ? String(winnerKey).split(".").pop() : null,
          status:      mu.status || "",
          isTied:      !!(mu.is_tied),
        });
      }
      if (wMatchups.length) allMatchups[w] = wMatchups;
    });
  } catch(e) {}

  // ── Transactions ──────────────────────────────────────────────────────────
  // Store player_id (bare numeric) separately from display name so the frontend
  // can resolve via DynastyProcess CSV (byYahoo[player_id]).
  let transactions = [];
  try {
    const txLeague = transactionsData?.fantasy_content?.league;
    const txObj    = txLeague?.[1]?.transactions || {};
    const txCount  = txObj.count || 0;
    for (let i = 0; i < txCount; i++) {
      const tx = txObj[String(i)]?.transaction;
      if (!tx) continue;
      const meta    = tx[0];
      const txId    = findVal(meta, "transaction_id");
      const txType  = findVal(meta, "type");
      const status  = findVal(meta, "status");
      const ts      = findVal(meta, "timestamp");
      // trader_team_key = trade, destination_team_key = add, source_team_key = drop
      const traderKey  = findVal(meta, "trader_team_key");
      const destKey    = findVal(meta, "destination_team_key");
      const srcKey     = findVal(meta, "source_team_key");
      const teamKey    = traderKey || destKey || srcKey || null;
      const teamId     = teamKey ? String(teamKey).split(".").pop() : null;

      // players: each entry has player[0] = info array, player[1].transaction_data[0] = action details
      const playersObj = tx[1]?.players || {};
      const pCount     = playersObj.count || 0;
      const moves = [];
      const descParts = [];
      for (let p = 0; p < pCount; p++) {
        const pData = playersObj[String(p)]?.player;
        if (!pData) continue;
        const pInfo  = Array.isArray(pData[0]) ? pData[0] : [pData[0]];
        // full_name / ascii_first work for skill players; DEF/ST entries use name.full
        // or editorial_team_full_name (e.g. "New England Patriots")
        const nameObj  = findVal(pInfo, "name");
        const nameStr  = typeof nameObj === "object" ? (nameObj?.full || nameObj?.ascii_first || "") : (nameObj || "");
        const pName    = findVal(pInfo, "full_name") || findVal(pInfo, "ascii_first")
                      || nameStr
                      || findVal(pInfo, "editorial_team_full_name")
                      || findVal(pInfo, "editorial_team_abbr")
                      || "";
        const rawPid = findVal(pInfo, "player_id") || findVal(pInfo, "player_key");
        const pid    = yahooPlayerId(rawPid);
        // transaction_data may be array or single object
        const txData = pData[1]?.transaction_data;
        const txDetail = Array.isArray(txData) ? txData[0] : (txData || {});
        // Yahoo returns "add" or "drop" (sometimes "added"/"dropped" in older responses)
        let action = (txDetail.type || "").toLowerCase().replace(/ped$/, "p").replace(/ed$/, "");
        if (action === "dro") action = "drop";  // safety for edge cases
        // Per-player team resolution: for drops, use source_team_key on the move itself
        const moveDestKey = txDetail.destination_team_key || "";
        const moveSrcKey  = txDetail.source_team_key      || "";
        const moveDestId  = moveDestKey ? String(moveDestKey).split(".").pop() : null;
        const moveSrcId   = moveSrcKey  ? String(moveSrcKey).split(".").pop()  : null;
        const dispPos  = findVal(pInfo, "display_position") || findVal(pInfo, "eligible_positions") || "";
        const pPos     = typeof dispPos === "object" ? (dispPos?.position || "") : dispPos;
        moves.push({ pid, name: pName, position: pPos || undefined, action, destTeamId: moveDestId, srcTeamId: moveSrcId });
        const sym = action === "add" ? "+" : action === "drop" ? "-" : "~";
        if (pName) descParts.push(`${sym}${pName}`);
      }
      transactions.push({
        id: txId, type: txType, status, timestamp: ts, teamId,
        description: descParts.join(", "),
        moves,
      });
    }
  } catch(e) {}

  // ── Draft results ─────────────────────────────────────────────────────────
  // Yahoo draftresults endpoint returns picks in one of several shapes depending
  // on league age and type. We try the most common shapes in order:
  //
  //   Shape 1 (flat array):   { draft_results: [ {pick,round,team_key,player_key}, ... ] }
  //   Shape 2 (flat object):  { draft_results: { count:N, "0":{...}, "1":{...}, ... } }
  //   Shape 3 (nested array): fantasy_content.league[1].draft_results[0].draft_result = array
  //   Shape 4 (nested obj):   fantasy_content.league[1].draft_results[0].draft_result = count-keyed obj
  //   Shape 5 (nested alt):   fantasy_content.league[1].draft_results = count-keyed obj
  let draft = [];
  try {
    let draftArr = [];

    // ── Shape 1 / 2: draft_results directly on the response object ──────────
    if (draftData?.draft_results !== undefined) {
      const dr = draftData.draft_results;
      if (Array.isArray(dr)) {
        draftArr = dr;
      } else if (dr && typeof dr === "object") {
        const count = parseInt(dr.count) || Object.keys(dr).filter(k => k !== "count").length;
        for (let i = 0; i < count; i++) { if (dr[String(i)]) draftArr.push(dr[String(i)]); }
      }
    }

    // ── Shape 3 / 4 / 5: nested under fantasy_content.league ────────────────
    if (!draftArr.length) {
      const dLeague  = draftData?.fantasy_content?.league;
      const dLeague1 = Array.isArray(dLeague) ? dLeague[1] : dLeague?.[1];
      const dResults = dLeague1?.draft_results;

      let dContainer;
      if (Array.isArray(dResults)) {
        dContainer = dResults[0];
      } else if (dResults && typeof dResults === "object") {
        dContainer = dResults.draft_result !== undefined ? dResults : (dResults["0"] || dResults);
      }

      const draftRaw = dContainer?.draft_result;

      if (Array.isArray(draftRaw)) {
        draftArr = draftRaw.map(e => e?.draft_result || e).filter(Boolean);
      } else if (draftRaw && typeof draftRaw === "object") {
        const rawKeys = Object.keys(draftRaw);
        const count = parseInt(draftRaw.count) || rawKeys.filter(k => k !== "count").length;
        for (let i = 0; i < count; i++) {
          const entry = draftRaw[String(i)];
          if (!entry) continue;
          draftArr.push(entry.draft_result || entry);
        }
      }
    }

    draftArr.forEach((pick, i) => {
      if (!pick) return;
      const rawPid = pick.player_key || pick.player_id;
      const rawTid = pick.team_key   || pick.team_id;
      draft.push({
        pick:     parseInt(pick.pick   || i + 1),
        round:    parseInt(pick.round  || 1),
        teamId:   String(rawTid || "").split(".").pop(),
        playerId: yahooPlayerId(rawPid),
        name:     pick.player_name || pick.name || "",
        position: pick.position    || "?",
        cost:     pick.cost != null ? parseInt(pick.cost) : null,
      });
    });
  } catch(e) { console.error("[Worker] Draft parse error:", e.message); }

  return new Response(JSON.stringify({
    league:      leagueRaw?.[0] || {},
    leagueMeta,          // structured league settings (current_week, playoff_start_week, etc.)
    myTeamId,            // team_id of the logged-in user's team (null if not found)
    currentWeek,         // most-recently-scored week
    teams, standings, rosters, matchups,
    allMatchups,         // { [week]: matchups[] } — all weeks including playoffs
    transactions, draft,
    players: [], futurePicks: [],
  }), { headers: corsHeaders() });
}

// ── Yahoo player season stats ─────────────────────────────────────────────────
// Fetches YTD fantasy points for a list of player IDs from the Yahoo Fantasy API.
// Yahoo allows up to 25 player keys per request via the players sub-resource.
// Returns { [playerId]: totalPts } where playerId is the bare numeric ID.
//
// Endpoint: GET /league/{key}/players;player_keys={k1,k2,...};out=stats;type=season_stats
// Response shape (per player):
//   fantasy_content.league[1].players[i].player[0] = info array (player_id, etc.)
//   fantasy_content.league[1].players[i].player[1].player_stats[0].stats = stat array
//   Each stat: { stat_id: "11", value: "247" } — we sum stat_id 0 which is total pts.
//   Alternatively player[1].player_points.total may be present in some response shapes.
async function yahooPlayerStats(accessToken, leagueKey, playerIds) {
  const base    = "https://fantasysports.yahooapis.com/fantasy/v2";
  const authHdr = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  const gameId  = leagueKey.split(".")[0];   // e.g. "449" from "449.l.123456"

  // Build full Yahoo player keys from bare numeric IDs
  const playerKeys = playerIds.map(id => `${gameId}.p.${id}`);

  // Batch into groups of 25 (Yahoo API limit per request)
  const BATCH = 25;
  const batches = [];
  for (let i = 0; i < playerKeys.length; i += BATCH) {
    batches.push(playerKeys.slice(i, i + BATCH));
  }

  const results = await Promise.allSettled(
    batches.map(batch => {
      const keysParam = batch.join(",");
      const url = `${base}/league/${leagueKey}/players;player_keys=${keysParam};out=stats?format=json`;
      return fetch(url, { headers: authHdr })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null);
    })
  );

  // Parse each batch response into { playerId → totalPts }
  const statsMap = {};
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value) continue;
    try {
      const playersObj = result.value?.fantasy_content?.league?.[1]?.players;
      if (!playersObj) continue;
      const count = playersObj.count || 0;
      for (let i = 0; i < count; i++) {
        const entry = playersObj[String(i)]?.player;
        if (!entry) continue;
        // entry[0] = info array, entry[1] = stats container
        const pInfo = Array.isArray(entry[0]) ? entry[0] : [entry[0]];
        const rawId = pInfo.find(o => o?.player_id != null)?.player_id
                   || pInfo.find(o => o?.player_key != null)?.player_key;
        if (!rawId) continue;
        // Strip game prefix — "449.p.32723" → "32723", bare numeric stays as-is
        const pid = String(rawId).includes(".") ? String(rawId).split(".").pop() : String(rawId);

        // Try player_points.total first (simpler), then sum from stats array
        const statsContainer = entry[1];
        let total = parseFloat(statsContainer?.player_points?.total ?? NaN);
        if (isNaN(total)) {
          const statsArr = statsContainer?.player_stats?.[0]?.stats?.stat;
          if (Array.isArray(statsArr)) {
            // stat_id "0" is the total fantasy points in Yahoo's stat system
            const totStat = statsArr.find(s => String(s.stat_id) === "0");
            total = totStat ? parseFloat(totStat.value || 0) : 0;
          } else {
            total = 0;
          }
        }
        if (pid && total >= 0) statsMap[pid] = total;
      }
    } catch(e) {}
  }

  return new Response(JSON.stringify(statsMap), { headers: corsHeaders() });
}

// ── Yahoo per-week matchup player detail ─────────────────────────────────────
// Fetches player-level scores for every matchup in a given week.
// Uses: GET /league/{key}/scoreboard;week={w};out=matchup_grade,players,stats
// Returns:
//   { matchups: [ { homeId, awayId, home: [{pid, name, pos, slot, pts, isStarter}], away: [...] } ] }
//
// Yahoo encodes the starting lineup inside each team's roster entry:
//   team[1].roster[0].players[i].player[1].selected_position[0].position = "QB" | "BN" etc.
//   player_points.total = fantasy points for that week
async function yahooMatchupDetail(accessToken, leagueKey, week) {
  const base    = "https://fantasysports.yahooapis.com/fantasy/v2";
  const authHdr = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

  // Fetch scoreboard with players+stats out for the specified week
  // This is the most efficient single call — returns scores + rosters in one shot
  const url = `${base}/league/${leagueKey}/scoreboard;week=${week};out=players,stats?format=json`;
  let data;
  try {
    const res = await fetch(url, { headers: authHdr });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return new Response(JSON.stringify({ error: `Yahoo API ${res.status}`, detail: txt.slice(0, 200) }), { status: 200, headers: corsHeaders() });
    }
    data = await res.json();
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 200, headers: corsHeaders() });
  }

  const findVal = (arr, key) => {
    if (!Array.isArray(arr)) return arr?.[key] ?? null;
    for (const obj of arr) { if (obj && typeof obj === "object" && key in obj) return obj[key]; }
    return null;
  };
  const yahooPlayerId = k => {
    if (!k) return "";
    const s = String(k);
    return s.includes(".") ? s.split(".").pop() : s;
  };

  const sb = data?.fantasy_content?.league?.[1]?.scoreboard;
  if (!sb) return new Response(JSON.stringify({ matchups: [] }), { headers: corsHeaders() });

  const muObj  = sb?.["0"]?.matchups || {};
  const count  = muObj.count || 0;
  const result = [];

  for (let i = 0; i < count; i++) {
    const mu = muObj[String(i)]?.matchup;
    if (!mu) continue;
    const muTeams = mu["0"]?.teams || {};

    const parseSide = (teamSlot) => {
      const t      = muTeams[String(teamSlot)]?.team;
      if (!t) return { teamId: "", players: [] };
      const tInfo  = Array.isArray(t[0]) ? t[0] : [t[0]].filter(Boolean);
      const teamId = String(findVal(tInfo, "team_id") || "");

      // t[1] may hold roster directly or be team_points; roster is in t[1].roster or t[2].roster
      const rosterContainer = t[1]?.roster || t[2]?.roster;
      const playersObj = rosterContainer?.[0]?.players || {};
      const pCount = playersObj.count || 0;
      const players = [];

      for (let j = 0; j < pCount; j++) {
        const p = playersObj[String(j)]?.player;
        if (!p) continue;
        const pInfo = Array.isArray(p[0]) ? p[0] : [p[0]].filter(Boolean);
        const rawId = findVal(pInfo, "player_id") || findVal(pInfo, "player_key");
        const pid   = yahooPlayerId(rawId);
        if (!pid) continue;

        const nameObj  = findVal(pInfo, "name");
        const name     = (typeof nameObj === "object" ? nameObj?.full : nameObj) || findVal(pInfo, "full_name") || "";
        const dispPos  = findVal(pInfo, "display_position") || findVal(pInfo, "eligible_positions") || "";
        const pos      = (typeof dispPos === "object" ? (dispPos?.position || "") : dispPos).split(",")[0].trim();
        const nflTeam  = findVal(pInfo, "editorial_team_abbr") || "";

        // selected_position is in p[1].selected_position[0].position
        const selPos = p[1]?.selected_position;
        const slotRaw = (Array.isArray(selPos) ? selPos[0] : selPos)?.position || "";
        const slot    = String(slotRaw).toUpperCase();
        const isStarter = slot !== "BN" && slot !== "IR" && slot !== "";

        // player_points: in p[2] or p[3] — search for player_points key
        let pts = 0;
        for (let k = 1; k < p.length; k++) {
          const pp = p[k]?.player_points;
          if (pp != null) { pts = parseFloat(pp.total ?? pp ?? 0) || 0; break; }
          // also check player_stats total
          const ps = p[k]?.player_stats;
          if (ps) {
            const statsArr = ps?.[0]?.stats?.stat || ps?.stats?.stat;
            if (Array.isArray(statsArr)) {
              const totStat = statsArr.find(s => String(s.stat_id) === "0");
              if (totStat) { pts = parseFloat(totStat.value || 0) || 0; break; }
            }
          }
        }

        players.push({ pid, name, pos, nflTeam, slot, isStarter, pts });
      }

      return { teamId, players };
    };

    const homeTeam  = parseSide(0);
    const awayTeam  = parseSide(1);
    const winnerKey = mu.winner_team_key || "";

    result.push({
      homeId: homeTeam.teamId,
      awayId: awayTeam.teamId,
      winnerTeamId: winnerKey ? String(winnerKey).split(".").pop() : null,
      home: homeTeam.players,
      away: awayTeam.players,
    });
  }

  return new Response(JSON.stringify({ matchups: result }), { headers: corsHeaders() });
}

function yahooLogin(env) {
  return Response.redirect(
    `https://api.login.yahoo.com/oauth2/request_auth?client_id=${env.YAHOO_CLIENT_ID}&redirect_uri=${encodeURIComponent(env.YAHOO_REDIRECT_URI)}&response_type=code&scope=fspt-r`,
    302
  );
}

async function yahooCallback(req, env) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return new Response("Missing code", { status: 400 });
  const tokenRes = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
    method: "POST",
    headers: { "Authorization": "Basic " + btoa(`${env.YAHOO_CLIENT_ID}:${env.YAHOO_CLIENT_SECRET}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: env.YAHOO_REDIRECT_URI })
  });
  const tokenText = await tokenRes.text();
  let tokenData;
  try { tokenData = JSON.parse(tokenText); } catch(e) { return new Response("Token parse error: " + tokenText, { status: 500 }); }
  if (tokenData.error) return new Response(`Yahoo auth error: ${tokenData.error} — ${tokenData.error_description || ""}`, { status: 400 });
  const appUrl = `https://dynastylockerroom.com/#yahoo_token=${encodeURIComponent(tokenData.access_token)}&yahoo_refresh=${encodeURIComponent(tokenData.refresh_token || "")}&yahoo_expires=${tokenData.expires_in || 3600}`;
  return Response.redirect(appUrl, 302);
}

// MFL grants better rate limits to identified clients.
// Always include this on every outbound MFL API request.
function mflHeaders(extra = {}) {
  return {
    "User-Agent": "DynastyLockerRoom/1.0 (dynastylockerroom.com)",
    ...extra
  };
}

function corsHeaders() {
  return {
    "Content-Type":                 "application/json",
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
