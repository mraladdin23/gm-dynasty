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

      // On-demand: fetch full MFL player universe (cached by client per session)
      if (path === "/mfl/players" && req.method === "POST") {
        const { year } = await req.json();
        const season = year || new Date().getFullYear();
        const r = await fetch(
          `https://api.myfantasyleague.com/${season}/export?TYPE=players&JSON=1`,
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

  const [settingsRes, standingsRes, rostersRes, matchupsRes, transactionsRes, draftRes] =
    await Promise.allSettled([
      fetch(`${base}/league/${leagueKey}/settings?format=json`,                          { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/standings?format=json`,                         { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/teams;out=roster?format=json`,                  { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/scoreboard?format=json`,                        { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/transactions;types=add,drop,trade?format=json`, { headers: authHdr }),
      fetch(`${base}/league/${leagueKey}/draftresults?format=json`,                      { headers: authHdr }),
    ]);

  async function toJson(s) {
    if (s.status !== "fulfilled") return null;
    const r = s.value;
    if (!r.ok) return null;
    try { return await r.json(); } catch { return null; }
  }

  const [settingsData, standingsData, rostersData, matchupsData, transactionsData, draftData] =
    await Promise.all([toJson(settingsRes), toJson(standingsRes), toJson(rostersRes), toJson(matchupsRes), toJson(transactionsRes), toJson(draftRes)]);

  const findVal = (arr, key) => {
    if (!Array.isArray(arr)) return null;
    for (const obj of arr) { if (obj && typeof obj === "object" && key in obj) return obj[key]; }
    return null;
  };

  const leagueRaw = standingsData?.fantasy_content?.league || settingsData?.fantasy_content?.league || null;

  // Teams + Standings — use camelCase to match frontend normalizeBundle
  let teams = [], standings = [];
  try {
    const teamsObj = leagueRaw?.[1]?.standings?.[0]?.teams || {};
    const count = teamsObj.count || 0;
    for (let i = 0; i < count; i++) {
      const team = teamsObj[String(i)]?.team;
      if (!team) continue;
      const info = team[0];
      const statsObj = team[2]?.team_standings;
      const teamId = findVal(info, "team_id");
      const teamName = findVal(info, "name");
      const managers = findVal(info, "managers");
      const ownerName = managers?.[0]?.manager?.nickname || "";
      teams.push({ id: teamId, name: teamName, owner_name: ownerName });
      standings.push({
        teamId,
        wins:       parseInt(statsObj?.outcome_totals?.wins   || 0),
        losses:     parseInt(statsObj?.outcome_totals?.losses || 0),
        ties:       parseInt(statsObj?.outcome_totals?.ties   || 0),
        ptsFor:     parseFloat(statsObj?.points_for           || 0),
        ptsAgainst: parseFloat(statsObj?.points_against       || 0),
        rank:       parseInt(statsObj?.rank || i + 1)
      });
    }
  } catch(e) {}

  // Rosters — camelCase
  let rosters = [];
  try {
    const rosLeague = rostersData?.fantasy_content?.league;
    const rosTeams  = rosLeague?.[1]?.teams || {};
    const count = rosTeams.count || 0;
    for (let i = 0; i < count; i++) {
      const team   = rosTeams[String(i)]?.team;
      if (!team) continue;
      const teamId = team[0]?.[0]?.team_id || team[0]?.team_id;
      const roster = team[1]?.roster;
      const players = roster?.[0]?.players || {};
      const playerIds = [];
      const pCount = players.count || 0;
      for (let j = 0; j < pCount; j++) {
        const p = players[String(j)]?.player?.[0];
        if (p) {
          const pid = Array.isArray(p) ? p.find(x => x?.player_id)?.player_id : p?.player_id;
          if (pid) playerIds.push(String(pid));
        }
      }
      rosters.push({ teamId, players: playerIds });
    }
  } catch(e) {}

  // Matchups — camelCase home/away with teamId
  let matchups = [];
  try {
    const muLeague    = matchupsData?.fantasy_content?.league;
    const scoreboard  = muLeague?.[1]?.scoreboard;
    const week        = scoreboard?.week;
    const matchupsObj = scoreboard?.["0"]?.matchups || {};
    const count = matchupsObj.count || 0;
    for (let i = 0; i < count; i++) {
      const mu = matchupsObj[String(i)]?.matchup;
      if (!mu) continue;
      const muTeams = mu["0"]?.teams || {};
      const t0 = muTeams["0"]?.team, t1 = muTeams["1"]?.team;
      const id0 = t0?.[0]?.[0]?.team_id || t0?.[0]?.team_id;
      const id1 = t1?.[0]?.[0]?.team_id || t1?.[0]?.team_id;
      const sc0 = parseFloat(t0?.[1]?.team_points?.total || 0);
      const sc1 = parseFloat(t1?.[1]?.team_points?.total || 0);
      matchups.push({ week, home: { teamId: id0, score: sc0 }, away: { teamId: id1, score: sc1 } });
    }
  } catch(e) {}

  // Transactions
  let transactions = [];
  try {
    const txLeague = transactionsData?.fantasy_content?.league;
    const txObj    = txLeague?.[1]?.transactions || {};
    const txCount  = txObj.count || 0;
    for (let i = 0; i < txCount; i++) {
      const tx = txObj[String(i)]?.transaction;
      if (!tx) continue;
      const meta   = tx[0];
      const txId   = findVal(meta, "transaction_id");
      const txType = findVal(meta, "type");
      const status = findVal(meta, "status");
      const ts     = findVal(meta, "timestamp");
      const teamKey = findVal(meta, "trader_team_key") || findVal(meta, "destination_team_key") || findVal(meta, "source_team_key") || null;
      const teamId  = teamKey ? String(teamKey).split(".").pop() : null;
      const playersObj = tx[1]?.players || {};
      const pCount = playersObj.count || 0;
      const playerParts = [];
      for (let p = 0; p < pCount; p++) {
        const pData = playersObj[String(p)]?.player;
        if (!pData) continue;
        const pInfo = Array.isArray(pData[0]) ? pData[0] : [pData[0]];
        const pName = findVal(pInfo, "full_name") || findVal(pInfo, "ascii_first") || "";
        const action = pData[1]?.transaction_data?.[0]?.type || "";
        if (pName) playerParts.push(`${action === "add" ? "+" : action === "drop" ? "-" : "~"}${pName}`);
      }
      transactions.push({ id: txId, type: txType, status, timestamp: ts, teamId, description: playerParts.join(", ") });
    }
  } catch(e) {}

  // Draft results (including auction cost)
  let draft = [];
  try {
    const dLeague  = draftData?.fantasy_content?.league;
    const draftObj = dLeague?.[1]?.draft_results?.[0]?.draft_result;
    if (draftObj) {
      const draftArr = Array.isArray(draftObj) ? draftObj : [draftObj];
      draftArr.forEach((pick, i) => {
        if (!pick) return;
        draft.push({
          pick:     parseInt(pick.pick || i + 1),
          round:    parseInt(pick.round || 1),
          teamId:   String(pick.team_key || "").split(".").pop(),
          playerId: pick.player_key,
          name:     pick.player_name || "",
          position: pick.position   || "?",
          cost:     pick.cost != null ? parseInt(pick.cost) : null,
        });
      });
    }
  } catch(e) {}

  return new Response(JSON.stringify({
    league: leagueRaw?.[0] || {},
    teams, standings, rosters, matchups, transactions, draft,
    players: [], futurePicks: [],
  }), { headers: corsHeaders() });
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
