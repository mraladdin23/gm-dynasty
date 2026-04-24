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

      if (path === "/yahoo/matchupRoster" && req.method === "POST") {
        const { access_token, league_key, week, home_team_key, away_team_key } = await req.json();
        if (!access_token || !league_key || !week || !home_team_key || !away_team_key) {
          return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: corsHeaders() });
        }
        return yahooMatchupRoster(access_token, league_key, week, home_team_key, away_team_key);
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

      // ── Tournament: fetch draft picks for one league ──────────────────────────
      if (path === "/tournament/draft" && req.method === "POST") {
        const { leagueId, platform, year, yahooToken, mflCookie } = await req.json();
        if (!leagueId || !platform) {
          return new Response(JSON.stringify({ error: "Missing leagueId or platform" }), { status: 400, headers: corsHeaders() });
        }
        return tournamentDraft(leagueId, platform, year, yahooToken, mflCookie);
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
  const [settingsRes, standingsRes, rostersRes, matchupsRes, transactionsRes, draftRes, keepersRes] =
    await Promise.allSettled([
      fetch(`${base}/league/${leagueKey}/settings?format=json`,                          { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/standings?format=json`,                         { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/teams;out=roster?format=json`,                  { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/scoreboard?format=json`,                        { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/transactions;types=add,drop,trade?format=json`, { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/draftresults?format=json`,                      { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/players;status=K?format=json`,                  { headers: authHdr }),
    ]);

  // Track whether any Yahoo call returned 401 (expired/invalid token)
  let yahooUnauthorized = false;

  async function toJson(s) {
    if (s.status !== "fulfilled") return null;
    const r = s.value;
    if (r.status === 401) { yahooUnauthorized = true; return null; }
    if (!r.ok) return null;
    try { return await r.json(); } catch { return null; }
  }

  const [settingsData, standingsData, rostersData, matchupsData, transactionsData, draftData, keepersData] =
    await Promise.all([toJson(settingsRes), toJson(standingsRes), toJson(rostersRes), toJson(matchupsRes), toJson(transactionsRes), toJson(draftRes), toJson(keepersRes)]);

  // If Yahoo rejected our token, surface a real 401 so the frontend can show
  // a reconnect prompt instead of silently rendering an empty bundle.
  if (yahooUnauthorized && !standingsData && !settingsData && !rostersData) {
    return new Response(JSON.stringify({ error: "yahoo_token_expired", message: "Yahoo token expired — please reconnect Yahoo." }), { status: 401, headers: corsHeaders() });
  }

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

  // ── All-weeks scoreboard (batched sequential fetching) ──────────────────────
  // Fetches weeks in small batches with delays between batches to avoid Yahoo
  // rate limiting. Firing all weeks in parallel (17 requests at once) reliably
  // triggers Yahoo's undocumented rate limiter (HTTP 999 / silent failures).
  // Strategy: 3 weeks at a time, 300ms between batches, 1 retry per failed week.
  let allMatchups = {};  // { [week]: matchups[] }
  try {
    const fetchThrough = Math.min(
      leagueMeta.current_week || 1,
      leagueMeta.end_week     || 17
    );
    const weeks = Array.from({ length: fetchThrough }, (_, i) => i + 1);

    const WEEK_BATCH  = 3;    // parallel requests per batch
    const WEEK_DELAY  = 300;  // ms between batches
    const RETRY_DELAY = 800;  // ms before retrying a failed week

    async function fetchWeek(w) {
      const url = `${base}/league/${leagueKey}/scoreboard;week=${w}?format=json`;
      try {
        const r = await fetch(url, { headers: authHdr });
        if (r.ok) return await r.json();
        await new Promise(res => setTimeout(res, RETRY_DELAY));
        const r2 = await fetch(url, { headers: authHdr });
        return r2.ok ? await r2.json() : null;
      } catch { return null; }
    }

    function parseWeekData(data, w) {
      if (!data) return;
      const sb    = data?.fantasy_content?.league?.[1]?.scoreboard;
      const muObj = sb?.["0"]?.matchups || {};
      const count = muObj.count || 0;
      const wMatchups = [];
      for (let i = 0; i < count; i++) {
        const mu = muObj[String(i)]?.matchup;
        if (!mu) continue;
        const muTeams = mu["0"]?.teams || {};
        const t0      = muTeams["0"]?.team;
        const t1      = muTeams["1"]?.team;
        const t0Info  = Array.isArray(t0?.[0]) ? t0[0] : [t0?.[0]].filter(Boolean);
        const t1Info  = Array.isArray(t1?.[0]) ? t1[0] : [t1?.[0]].filter(Boolean);
        const id0     = String(findVal(t0Info, "team_id") || "");
        const id1     = String(findVal(t1Info, "team_id") || "");
        const sc0     = parseFloat(t0?.[1]?.team_points?.total || 0);
        const sc1     = parseFloat(t1?.[1]?.team_points?.total || 0);
        const winnerKey = mu.winner_team_key || "";
        wMatchups.push({
          week:         w,
          home:         { teamId: id0, score: sc0 },
          away:         { teamId: id1, score: sc1 },
          winnerTeamId: winnerKey ? String(winnerKey).split(".").pop() : null,
          status:       mu.status || "",
          isTied:       !!(mu.is_tied),
        });
      }
      if (wMatchups.length) allMatchups[w] = wMatchups;
    }

    for (let i = 0; i < weeks.length; i += WEEK_BATCH) {
      const batch   = weeks.slice(i, i + WEEK_BATCH);
      const results = await Promise.all(batch.map(w => fetchWeek(w)));
      batch.forEach((w, idx) => parseWeekData(results[idx], w));
      if (i + WEEK_BATCH < weeks.length) {
        await new Promise(res => setTimeout(res, WEEK_DELAY));
      }
    }
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

  // ── Keeper player IDs ────────────────────────────────────────────────────
  // players;status=K returns keeper-designated players. Non-keeper leagues
  // return empty or 4xx — keepersData will be null and keeperPlayerIds stays empty.
  const keeperPlayerIds = new Set();
  try {
    const kLeague  = keepersData?.fantasy_content?.league;
    const kLeague1 = Array.isArray(kLeague) ? kLeague[1] : kLeague?.[1];
    const kPlayers = kLeague1?.players || {};
    const kCount   = parseInt(kPlayers.count) || 0;
    for (let i = 0; i < kCount; i++) {
      const entry = kPlayers[String(i)]?.player;
      if (!entry) continue;
      const pInfo = Array.isArray(entry[0]) ? entry[0] : [entry[0]];
      const rawId = pInfo.find(o => o?.player_id != null)?.player_id
                 || pInfo.find(o => o?.player_key != null)?.player_key;
      if (rawId) keeperPlayerIds.add(yahooPlayerId(String(rawId)));
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
  //   Shape 5 (nested alt):   fantasy_content.league[1].draft_results = count-keyed obj (no draft_result wrapper)
  //
  // Keeper detection: Yahoo sets is_keeper=1 on keeper picks in keeper/salary leagues.
  // Falls back to cost-based heuristic on the frontend (yahoo.js normalizeBundle).
  let draft = [];
  let draftArr = [];
  try {

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
        dContainer = dResults;
      }

      if (dContainer) {
        const draftRaw = dContainer.draft_result;
        if (Array.isArray(draftRaw)) {
          draftArr = draftRaw.map(e => e?.draft_result || e).filter(Boolean);
        } else if (draftRaw && typeof draftRaw === "object") {
          const count = parseInt(draftRaw.count) || Object.keys(draftRaw).filter(k => k !== "count").length;
          for (let i = 0; i < count; i++) {
            const entry = draftRaw[String(i)];
            if (entry) draftArr.push(entry.draft_result || entry);
          }
        } else {
          // Shape 5: dContainer itself is count-keyed (no draft_result wrapper)
          const numericKeys = Object.keys(dContainer).filter(k => !isNaN(k));
          if (numericKeys.length > 0) {
            numericKeys.forEach(k => {
              const entry = dContainer[k];
              if (entry) draftArr.push(entry.draft_result || entry);
            });
          }
        }
      }
    }

    // Temporary: log draft shape to Worker console for diagnosis
    console.log("[Yahoo draft] topLevelKeys:", draftData ? Object.keys(draftData) : null);
    console.log("[Yahoo draft] picks parsed:", draftArr.length);
    if (!draftArr.length && draftData) {
      const fc  = draftData?.fantasy_content?.league;
      const fc1 = Array.isArray(fc) ? fc[1] : fc?.[1];
      console.log("[Yahoo draft] fc.league[1] keys:", fc1 ? Object.keys(fc1) : "none");
      console.log("[Yahoo draft] draft_results sample:", JSON.stringify(fc1?.draft_results)?.slice(0, 400));
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
        isKeeper: parseInt(pick.is_keeper || 0) === 1 || keeperPlayerIds.has(yahooPlayerId(pick.player_key || pick.player_id)),
      });
    });
  } catch(e) { /* draft parse error */ }



  return new Response(JSON.stringify({
    league:      leagueRaw?.[0] || {},
    leagueMeta,          // structured league settings (current_week, playoff_start_week, etc.)
    myTeamId,            // team_id of the logged-in user's team (null if not found)
    currentWeek,         // most-recently-scored week
    teams, standings, rosters, matchups,
    allMatchups,         // { [week]: matchups[] } — all weeks including playoffs
    transactions, draft,
    keeperCount: keeperPlayerIds.size,
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

// ── Yahoo matchup roster ─────────────────────────────────────────────────────
// Fetches the weekly roster for both teams showing who started vs sat.
// Individual fantasy points are NOT fetched — Yahoo requires applying per-league
// scoring rules to raw stat categories, which varies by league configuration.
// Returns starters and bench with player name, position, and slot only.
async function yahooMatchupRoster(accessToken, leagueKey, week, homeTeamKey, awayTeamKey) {
  const base    = "https://fantasysports.yahooapis.com/fantasy/v2";
  const authHdr = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

  function yahooPlayerId(playerKey) {
    if (!playerKey) return null;
    const parts = String(playerKey).split(".");
    return parts[parts.length - 1] || String(playerKey);
  }

  const findVal = (arr, key) => {
    if (!Array.isArray(arr)) return arr?.[key] ?? null;
    for (const obj of arr) { if (obj && typeof obj === "object" && key in obj) return obj[key]; }
    return null;
  };

  async function fetchRoster(teamKey) {
    const url = `${base}/team/${teamKey}/roster;week=${week}?format=json`;
    try {
      const r = await fetch(url, { headers: authHdr });
      if (!r.ok) return [];
      const data    = await r.json();
      const roster  = data?.fantasy_content?.team?.[1]?.roster;
      const players = roster?.[0]?.players || {};
      const count   = players.count || 0;
      const result  = [];
      for (let i = 0; i < count; i++) {
        const p = players[String(i)]?.player;
        if (!p) continue;
        const pInfo    = Array.isArray(p[0]) ? p[0] : [p[0]];
        const rawId    = findVal(pInfo, "player_id") || findVal(pInfo, "player_key");
        const pid      = yahooPlayerId(rawId);
        if (!pid) continue;
        const nameObj  = findVal(pInfo, "name");
        const fullName = (typeof nameObj === "object" ? nameObj?.full : nameObj) || "";
        const dispPos  = findVal(pInfo, "display_position") || "";
        const pos      = typeof dispPos === "object" ? (dispPos?.position || "") : dispPos;
        // selected_position lives at p[1].selected_position[0].position
        const selRaw   = p[1]?.selected_position;
        const selArr   = Array.isArray(selRaw) ? selRaw : (selRaw ? [selRaw] : []);
        const slot     = selArr[0]?.position || selArr.find?.(x => x?.position)?.position || "BN";
        result.push({ pid, name: fullName, pos, slot,
          isStarter: slot !== "BN" && slot !== "IR" && slot !== "TAXI" });
      }
      return result;
    } catch { return []; }
  }

  const [home, away] = await Promise.all([
    fetchRoster(homeTeamKey),
    fetchRoster(awayTeamKey),
  ]);

  return new Response(JSON.stringify({ home, away }), { headers: corsHeaders() });
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
  const appUrl = `https://dynastylockerroom.com/?yahoo_token=${encodeURIComponent(tokenData.access_token)}&yahoo_refresh=${encodeURIComponent(tokenData.refresh_token || "")}&yahoo_expires=${tokenData.expires_in || 3600}`;
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

// ── Tournament: draft picks fetcher ──────────────────────────────────────────
// Fetches and normalizes draft picks for a single league.
// Returns { picks: [{ overall, round, pick, teamId, playerId, name, position, cost }] }
async function tournamentDraft(leagueId, platform, year, yahooToken, mflCookie) {
  const season = year || new Date().getFullYear();

  // ── Sleeper ────────────────────────────────────────────────────────────────
  if (platform === "sleeper") {
    try {
      const draftsRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`);
      if (!draftsRes.ok) return new Response(JSON.stringify({ picks: [] }), { headers: corsHeaders() });
      const drafts = await draftsRes.json();
      if (!drafts?.length) return new Response(JSON.stringify({ picks: [] }), { headers: corsHeaders() });

      // Prefer completed startup/snake draft; fall back to any complete draft
      const sorted = [...drafts].sort((a, b) => {
        const rank = t => (t === "snake" || t === "startup") ? 0 : 1;
        return rank(a.type) - rank(b.type) || (a.start_time || 0) - (b.start_time || 0);
      });
      const draft = sorted.find(d => d.status === "complete") || sorted[0];
      if (!draft) return new Response(JSON.stringify({ picks: [] }), { headers: corsHeaders() });

      const picksRes = await fetch(`https://api.sleeper.app/v1/draft/${draft.draft_id}/picks`);
      if (!picksRes.ok) return new Response(JSON.stringify({ picks: [] }), { headers: corsHeaders() });
      const rawPicks = await picksRes.json();
      const teams = draft.settings?.teams || 12;

      const picks = (rawPicks || []).map(p => ({
        // pick_no is Sleeper's true sequential overall pick number.
        // draft_slot is the team's fixed position — not their pick order in snake rounds.
        overall:  p.pick_no || ((p.round - 1) * teams + (p.draft_slot || 1)),
        round:    p.round,
        pick:     p.pick_no ? (p.pick_no - (p.round - 1) * teams) : (p.draft_slot || 1),
        teamId:   String(p.roster_id || ""),
        playerId: p.player_id || "",
        name:     p.metadata ? `${p.metadata.first_name || ""} ${p.metadata.last_name || ""}`.trim() : "",
        position: (p.metadata?.position || "?").toUpperCase(),
        nflTeam:  p.metadata?.team || "FA",
        cost:     null
      })).filter(p => p.teamId && p.teamId !== "undefined");

      // Return slot_to_roster_id and draft_type alongside picks so the frontend
      // can render a proper snake/linear grid with correct column ordering (U1).
      return new Response(JSON.stringify({
        picks,
        slot_to_roster_id: draft.slot_to_roster_id || null,
        draft_type:        draft.type || "snake"
      }), { headers: corsHeaders() });
    } catch(e) {
      return new Response(JSON.stringify({ picks: [], error: e.message }), { headers: corsHeaders() });
    }
  }

  // ── MFL ─────────────────────────────────────────────────────────────────────
  if (platform === "mfl") {
    try {
      const cookieHdr = mflCookie ? `MFL_USER_ID=${mflCookie}` : "";
      const headers   = mflHeaders(cookieHdr ? { Cookie: cookieHdr } : {});

      // Fetch draft results and league (for franchise names)
      const [draftRes, leagueRes] = await Promise.all([
        fetch(`https://api.myfantasyleague.com/${season}/export?TYPE=draftResults&L=${leagueId}&JSON=1`, { headers }),
        fetch(`https://api.myfantasyleague.com/${season}/export?TYPE=league&L=${leagueId}&JSON=1`, { headers })
      ]);

      const draftData  = draftRes.ok  ? await draftRes.json().catch(() => null)  : null;
      const leagueData = leagueRes.ok ? await leagueRes.json().catch(() => null) : null;

      // Build franchise name map
      const nameMap = {};
      const frArr   = leagueData?.league?.franchises?.franchise || [];
      (Array.isArray(frArr) ? frArr : [frArr]).forEach(f => { if (f.id) nameMap[f.id] = f.name || f.id; });

      // MFL draftResults shape: draftResults.draftUnit (array or object) → each unit has draftPick[]
      const units = draftData?.draftResults?.draftUnit;
      const unitArr = Array.isArray(units) ? units : (units ? [units] : []);
      const picks = [];

      unitArr.forEach(unit => {
        const rawPicks = unit.draftPick;
        const pickArr  = Array.isArray(rawPicks) ? rawPicks : (rawPicks ? [rawPicks] : []);
        pickArr.forEach((p, i) => {
          const round   = parseInt(p.round  || 1);
          const pick    = parseInt(p.pick   || i + 1);
          const teamId  = String(p.franchise || p.franchiseId || "");
          const overall = parseInt(p.overall || ((round - 1) * Object.keys(nameMap).length + pick));
          picks.push({
            overall,
            round,
            pick,
            teamId,
            teamName: nameMap[teamId] || teamId,
            playerId: String(p.player || ""),
            name:     p.playerName  || p.name || "",
            position: (p.position   || "?").toUpperCase(),
            cost:     p.price != null ? parseInt(p.price) : null
          });
        });
      });

      return new Response(JSON.stringify({ picks }), { headers: corsHeaders() });
    } catch(e) {
      return new Response(JSON.stringify({ picks: [], error: e.message }), { headers: corsHeaders() });
    }
  }

  // ── Yahoo ────────────────────────────────────────────────────────────────────
  if (platform === "yahoo") {
    if (!yahooToken) return new Response(JSON.stringify({ picks: [], error: "Yahoo token required" }), { headers: corsHeaders() });
    try {
      const base    = "https://fantasysports.yahooapis.com/fantasy/v2";
      const authHdr = { Authorization: `Bearer ${yahooToken}`, Accept: "application/json" };
      const leagueKey = leagueId.includes(".l.") ? leagueId : leagueId;

      // Reuse the existing Yahoo draft parser from yahooLeagueBundle
      // by fetching just the draftresults endpoint
      const r = await fetch(`${base}/league/${leagueKey}/draftresults?format=json`, { headers: authHdr });
      if (!r.ok) return new Response(JSON.stringify({ picks: [] }), { headers: corsHeaders() });
      const draftData = await r.json().catch(() => null);

      // ── Parse using the same multi-shape logic as yahooLeagueBundle ──────────
      function yahooPlayerId(pk) {
        if (!pk) return null;
        const parts = String(pk).split(".");
        return parts[parts.length - 1] || String(pk);
      }

      let draftArr = [];
      if (draftData?.draft_results !== undefined) {
        const dr = draftData.draft_results;
        if (Array.isArray(dr)) draftArr = dr;
        else if (dr && typeof dr === "object") {
          const count = parseInt(dr.count) || Object.keys(dr).filter(k => k !== "count").length;
          for (let i = 0; i < count; i++) { if (dr[String(i)]) draftArr.push(dr[String(i)]); }
        }
      }
      if (!draftArr.length) {
        const dLeague  = draftData?.fantasy_content?.league;
        const dLeague1 = Array.isArray(dLeague) ? dLeague[1] : dLeague?.[1];
        const dResults = dLeague1?.draft_results;
        let dContainer;
        if (Array.isArray(dResults)) dContainer = dResults[0];
        else if (dResults && typeof dResults === "object") dContainer = dResults;
        if (dContainer) {
          const draftRaw = dContainer.draft_result;
          if (Array.isArray(draftRaw)) {
            draftArr = draftRaw.map(e => e?.draft_result || e).filter(Boolean);
          } else if (draftRaw && typeof draftRaw === "object") {
            const count = parseInt(draftRaw.count) || Object.keys(draftRaw).filter(k => k !== "count").length;
            for (let i = 0; i < count; i++) {
              const entry = draftRaw[String(i)];
              if (entry) draftArr.push(entry.draft_result || entry);
            }
          } else {
            const numericKeys = Object.keys(dContainer).filter(k => !isNaN(k));
            numericKeys.forEach(k => {
              const entry = dContainer[k];
              if (entry) draftArr.push(entry.draft_result || entry);
            });
          }
        }
      }

      const picks = draftArr.map((p, i) => {
        if (!p) return null;
        const rawPid = p.player_key || p.player_id;
        const rawTid = p.team_key   || p.team_id;
        return {
          overall:  parseInt(p.pick  || i + 1),
          round:    parseInt(p.round || 1),
          pick:     parseInt(p.pick  || i + 1),
          teamId:   String(rawTid || "").split(".").pop(),
          playerId: yahooPlayerId(rawPid),
          name:     p.player_name || p.name || "",
          position: (p.position   || "?").toUpperCase(),
          cost:     p.cost != null ? parseInt(p.cost) : null
        };
      }).filter(Boolean);

      return new Response(JSON.stringify({ picks }), { headers: corsHeaders() });
    } catch(e) {
      return new Response(JSON.stringify({ picks: [], error: e.message }), { headers: corsHeaders() });
    }
  }

  return new Response(JSON.stringify({ picks: [], error: "Unsupported platform: " + platform }), { headers: corsHeaders() });
}

// ── Tournament: AI recap generator ────────────────────────────────────────────
// Calls Claude API with a structured weekly summary and returns markdown recap.
async function tournamentRecap(body, env) {
  const { tournamentName, week, year, totalMatchups, closestGames, biggestBlowouts, highestScorer, avgScore } = body;

  if (!env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), { status: 500, headers: corsHeaders() });
  }

  const prompt = `You are a fun, witty fantasy football analyst writing a brief weekly recap for a large multi-league tournament called "${tournamentName || "the tournament"}".

Week ${week || "?"} Summary Data:
- ${totalMatchups || 0} total matchups across leagues
- Average score: ${avgScore || "N/A"} pts
- Closest games: ${(closestGames || []).join("; ") || "N/A"}
- Biggest blowouts: ${(biggestBlowouts || []).join("; ") || "N/A"}
- Highest scorer: ${highestScorer || "N/A"}

Write a 3-4 paragraph weekly recap in an engaging, sports-analyst style. Mention the closest game, the biggest blowout, and the top scorer. Keep it punchy and fun — like an ESPN segment. Use **bold** for team names and scores. Keep total length under 300 words.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 600,
        messages:   [{ role: "user", content: prompt }]
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      return new Response(JSON.stringify({ error: "Claude API error", detail: errText.slice(0, 300) }), { status: 500, headers: corsHeaders() });
    }

    const data   = await r.json();
    const recap  = data?.content?.[0]?.text || "";
    return new Response(JSON.stringify({ recap }), { headers: corsHeaders() });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders() });
  }
}

function corsHeaders() {
  return {
    "Content-Type":                 "application/json",
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
