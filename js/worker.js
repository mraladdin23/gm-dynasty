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

      // ── Yahoo: fetch user's leagues with access token ────
      if (path === "/yahoo/leagues" && req.method === "POST") {
        const { access_token } = await req.json();
        if (!access_token) {
          return new Response(JSON.stringify({ error: "Missing access_token" }), {
            status: 400, headers: corsHeaders()
          });
        }

        const userRes = await fetch(
          "https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_codes=nfl/leagues?format=json",
          { headers: { Authorization: `Bearer ${access_token}` } }
        );

        if (!userRes.ok) {
          const errText = await userRes.text();
          return new Response(JSON.stringify({ error: "Yahoo API error", detail: errText.slice(0,300) }), {
            status: 400, headers: corsHeaders()
          });
        }

        const userData = await userRes.json();
        const leagues  = [];

        try {
          const users = userData?.fantasy_content?.users;
          const user  = users?.["0"]?.user;
          const games = user?.["1"]?.games;
          if (games) {
            const gameCount = games?.count || 0;
            for (let g = 0; g < gameCount; g++) {
              const game = games[String(g)]?.game;
              if (!game) continue;
              const season     = game[0]?.season;
              const leaguesObj = game[1]?.leagues;
              if (!leaguesObj) continue;
              const leagueCount = leaguesObj.count || 0;
              for (let l = 0; l < leagueCount; l++) {
                const league = leaguesObj[String(l)]?.league?.[0];
                if (!league) continue;
                leagues.push({
                  league_id:  league.league_id,
                  name:       league.name,
                  season:     season || league.season,
                  num_teams:  league.num_teams,
                  league_key: league.league_key
                });
              }
            }
          }
        } catch(e) {
          return new Response(JSON.stringify({ error: "Parse error", detail: e.message }), {
            status: 500, headers: corsHeaders()
          });
        }

        return new Response(JSON.stringify(leagues), { headers: corsHeaders() });
      }

      // ── Yahoo: full league bundle ────────────────────────
      if (path === "/yahoo/leagueBundle" && req.method === "POST") {
        const { access_token, league_key } = await req.json();
        if (!access_token || !league_key) {
          return new Response(JSON.stringify({ error: "Missing access_token or league_key" }), {
            status: 400, headers: corsHeaders()
          });
        }
        return yahooLeagueBundle(access_token, league_key);
      }

      // ── MFL: get user's leagues ──────────────────────────
      if (path === "/mfl/userLeagues" && req.method === "POST") {
        const { username, password } = await req.json();

        if (!username || !password) {
          return new Response(JSON.stringify({ error: "Missing credentials" }), {
            status: 400, headers: corsHeaders()
          });
        }

        // Step 1: Login to get session cookie
        const currentYear = new Date().getFullYear();
        const loginRes = await fetch(
          `https://api.myfantasyleague.com/${currentYear}/login?USERNAME=${encodeURIComponent(username)}&PASSWORD=${encodeURIComponent(password)}&XML=1`
        );
        const loginXml = await loginRes.text();

        const cookieMatch = loginXml.match(/MFL_USER_ID="([^"]+)"/);
        if (!cookieMatch) {
          return new Response(JSON.stringify({
            error: "MFL login failed — check username and password",
            loginResponse: loginXml.slice(0, 300)
          }), { status: 200, headers: corsHeaders() });
        }
        const cookieValue = cookieMatch[1];

        // Step 2: Fetch leagues for all years
        const startYear = 1999;
        const years = [];
        for (let y = currentYear; y >= startYear; y--) years.push(y);

        const allLeagues = [];
        const results = await Promise.allSettled(
          years.map(y =>
            fetch(
              `https://api.myfantasyleague.com/${y}/export?TYPE=myleagues&JSON=1`,
              { headers: { Cookie: `MFL_USER_ID=${cookieValue}` } }
            )
            .then(r => r.json())
            .then(data => {
              const list = data?.leagues?.league
                ? (Array.isArray(data.leagues.league)
                    ? data.leagues.league
                    : [data.leagues.league])
                : [];
              return list.map(l => ({ ...l, season: String(y) }));
            })
            .catch(() => [])
          )
        );

        results.forEach(r => {
          if (r.status === "fulfilled") allLeagues.push(...r.value);
        });

        // Deduplicate by league_id + season
        const seen = new Map();
        for (const l of allLeagues) {
          const id  = l.league_id || l.id;
          const key = `${id}_${l.season}`;
          if (id && !seen.has(key)) seen.set(key, l);
        }

        return new Response(JSON.stringify([...seen.values()]), { headers: corsHeaders() });
      }

      // ── MFL: full league bundle ──────────────────────────
      if (path === "/mfl/bundle" && req.method === "POST") {
        const { leagueId, year, username, password } = await req.json();

        if (!leagueId) {
          return new Response(JSON.stringify({ error: "Missing leagueId" }), {
            status: 400, headers: corsHeaders()
          });
        }

        // Login first to get cookie if credentials provided
        let cookieHeader = "";
        if (username && password) {
          const yr = year || new Date().getFullYear();
          const loginRes = await fetch(
            `https://api.myfantasyleague.com/${yr}/login?USERNAME=${encodeURIComponent(username)}&PASSWORD=${encodeURIComponent(password)}&XML=1`
          );
          const loginXml = await loginRes.text();
          const m = loginXml.match(/MFL_USER_ID="([^"]+)"/);
          if (m) cookieHeader = `MFL_USER_ID=${m[1]}`;
        }

        return mflBundle(leagueId, year, cookieHeader);
      }

      return new Response("Worker running", { headers: corsHeaders() });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500, headers: corsHeaders()
      });
    }
  }
};

// ── MFL Bundle ──────────────────────────────────────────
async function mflBundle(leagueId, year, cookieHeader) {
  const season = year || new Date().getFullYear();
  const headers = cookieHeader ? { Cookie: cookieHeader } : {};
  const base = `https://api.myfantasyleague.com/${season}/export`;

  const endpoints = {
    league:    `${base}?TYPE=league&L=${leagueId}&JSON=1`,
    rosters:   `${base}?TYPE=rosters&L=${leagueId}&JSON=1`,
    standings: `${base}?TYPE=leagueStandings&L=${leagueId}&JSON=1`,
    matchups:  `${base}?TYPE=scoreboard&L=${leagueId}&JSON=1`,
    players:   `${base}?TYPE=players&JSON=1`,
    draft:     `${base}?TYPE=draftResults&L=${leagueId}&JSON=1`,
    transactions: `${base}?TYPE=transactions&L=${leagueId}&JSON=1`,
  };

  const results = await Promise.allSettled(
    Object.entries(endpoints).map(async ([key, url]) => {
      const r = await fetch(url, { headers });
      return [key, await r.json()];
    })
  );

  const bundle = {};
  for (const r of results) {
    if (r.status === "fulfilled") {
      const [key, data] = r.value;
      bundle[key] = data;
    }
  }

  return new Response(JSON.stringify(bundle), { headers: corsHeaders() });
}

// ── Yahoo League Bundle ─────────────────────────────────
// Fetches standings, rosters, matchups, and settings for one league
async function yahooLeagueBundle(accessToken, leagueKey) {
  const base    = "https://fantasysports.yahooapis.com/fantasy/v2";
  const authHdr = { Authorization: `Bearer ${accessToken}` };

  // Fetch all sub-resources in parallel
  const [settingsRes, standingsRes, rostersRes, matchupsRes] = await Promise.allSettled([
    fetch(`${base}/league/${leagueKey}/settings?format=json`,   { headers: authHdr }),
    fetch(`${base}/league/${leagueKey}/standings?format=json`,  { headers: authHdr }),
    fetch(`${base}/league/${leagueKey}/teams/roster?format=json`,{ headers: authHdr }),
    fetch(`${base}/league/${leagueKey}/scoreboard?format=json`, { headers: authHdr }),
  ]);

  async function toJson(settled) {
    if (settled.status !== "fulfilled") return null;
    const r = settled.value;
    if (!r.ok) return null;
    try { return await r.json(); } catch { return null; }
  }

  const [settingsData, standingsData, rostersData, matchupsData] = await Promise.all([
    toJson(settingsRes),
    toJson(standingsRes),
    toJson(rostersRes),
    toJson(matchupsRes),
  ]);

  // Extract the league object from whichever call succeeded
  const leagueRaw =
    standingsData?.fantasy_content?.league ||
    settingsData?.fantasy_content?.league  ||
    null;

  // --- Teams + Standings ---
  // Yahoo standings: fantasy_content.league[1].standings[0].teams
  let teams     = [];
  let standings = [];
  try {
    const teamsObj = leagueRaw?.[1]?.standings?.[0]?.teams || {};
    const count    = teamsObj.count || 0;
    for (let i = 0; i < count; i++) {
      const team     = teamsObj[String(i)]?.team;
      if (!team) continue;
      const info     = team[0];          // array of metadata objects
      const statsObj = team[2]?.team_standings;

      // info is an array; find objects by known keys
      const findVal = (arr, key) => {
        for (const obj of arr) {
          if (obj && typeof obj === "object" && key in obj) return obj[key];
        }
        return null;
      };

      const teamId   = findVal(info, "team_id");
      const teamName = findVal(info, "name");
      const managers = findVal(info, "managers");
      const ownerName = managers?.[0]?.manager?.nickname || "";

      teams.push({ id: teamId, name: teamName, owner_name: ownerName });
      standings.push({
        team_id:       teamId,
        wins:          parseInt(statsObj?.outcome_totals?.wins   || 0),
        losses:        parseInt(statsObj?.outcome_totals?.losses || 0),
        ties:          parseInt(statsObj?.outcome_totals?.ties   || 0),
        points_for:    parseFloat(statsObj?.points_for           || 0),
        points_against:parseFloat(statsObj?.points_against       || 0),
      });
    }
  } catch(e) { /* leave empty */ }

  // --- Rosters ---
  let rosters = [];
  try {
    const rosLeague = rostersData?.fantasy_content?.league;
    const rosTeams  = rosLeague?.[1]?.teams || {};
    const count     = rosTeams.count || 0;
    for (let i = 0; i < count; i++) {
      const team    = rosTeams[String(i)]?.team;
      if (!team) continue;
      const teamId  = team[0]?.[0]?.team_id || team[0]?.team_id;
      const roster  = team[1]?.roster;
      const players = roster?.[0]?.players || {};
      const playerIds = [];
      const pCount  = players.count || 0;
      for (let j = 0; j < pCount; j++) {
        const p = players[String(j)]?.player?.[0];
        if (p) {
          const pid = (Array.isArray(p) ? p.find(x => x?.player_id)?.player_id : p?.player_id);
          if (pid) playerIds.push(String(pid));
        }
      }
      rosters.push({ team_id: teamId, player: playerIds });
    }
  } catch(e) { /* leave empty */ }

  // --- Matchups ---
  let matchups = [];
  try {
    const muLeague  = matchupsData?.fantasy_content?.league;
    const scoreboard= muLeague?.[1]?.scoreboard;
    const week      = scoreboard?.week;
    const matchupsObj = scoreboard?.["0"]?.matchups || {};
    const count     = matchupsObj.count || 0;
    for (let i = 0; i < count; i++) {
      const mu     = matchupsObj[String(i)]?.matchup;
      if (!mu) continue;
      const muTeams = mu["0"]?.teams || {};
      const t0 = muTeams["0"]?.team;
      const t1 = muTeams["1"]?.team;
      const id0 = t0?.[0]?.[0]?.team_id || t0?.[0]?.team_id;
      const id1 = t1?.[0]?.[0]?.team_id || t1?.[0]?.team_id;
      const sc0 = parseFloat(t0?.[1]?.team_points?.total || 0);
      const sc1 = parseFloat(t1?.[1]?.team_points?.total || 0);
      matchups.push({
        week,
        home_team: { team_id: id0, score: sc0 },
        away_team: { team_id: id1, score: sc1 },
      });
    }
  } catch(e) { /* leave empty */ }

  // --- League settings ---
  const leagueInfo = leagueRaw?.[0] || {};

  const bundle = {
    league:   leagueInfo,
    teams,
    standings,
    rosters,
    matchups,
    players:  [],   // Yahoo doesn't have a bulk player endpoint; player cards use Sleeper DB
    draft:    [],
    futurePicks: [],
    transactions: []
  };

  return new Response(JSON.stringify(bundle), { headers: corsHeaders() });
}

// ── Yahoo Auth ───────────────────────────────────────────
function yahooLogin(env) {
  return Response.redirect(
    `https://api.login.yahoo.com/oauth2/request_auth` +
    `?client_id=${env.YAHOO_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(env.YAHOO_REDIRECT_URI)}` +
    `&response_type=code&scope=fspt-r`,
    302
  );
}

async function yahooCallback(req, env) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return new Response("Missing code", { status: 400 });

  const tokenRes = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + btoa(`${env.YAHOO_CLIENT_ID}:${env.YAHOO_CLIENT_SECRET}`),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: env.YAHOO_REDIRECT_URI
    })
  });

  const tokenText = await tokenRes.text();
  let tokenData;
  try {
    tokenData = JSON.parse(tokenText);
  } catch(e) {
    return new Response("Token parse error: " + tokenText, { status: 500 });
  }

  if (tokenData.error) {
    return new Response(`Yahoo auth error: ${tokenData.error} — ${tokenData.error_description || ""}`, { status: 400 });
  }

  const accessToken  = tokenData.access_token;
  const refreshToken = tokenData.refresh_token || "";
  const expiresIn    = tokenData.expires_in || 3600;

  const appUrl = `https://dynastylockerroom.com/#yahoo_token=${encodeURIComponent(accessToken)}&yahoo_refresh=${encodeURIComponent(refreshToken)}&yahoo_expires=${expiresIn}`;
  return Response.redirect(appUrl, 302);
}

// ── CORS ─────────────────────────────────────────────────
function corsHeaders() {
  return {
    "Content-Type":                 "application/json",
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
