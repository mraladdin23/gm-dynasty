// ─────────────────────────────────────────────────────────
//  MFL API — Normalized frontend module
//  Works with worker endpoints: /userLeagues, /bundle, /mfl/import
// ─────────────────────────────────────────────────────────

const MFLAPI = (() => {
  const BASE_URL = "https://mfl-proxy.mraladdin23.workers.dev";

  // ───────── GENERIC POST HELPER ─────────
  async function post(endpoint, body) {
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000)
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`MFL Worker Error ${res.status}: ${text}`);
      }

      return await res.json();
    } catch (err) {
      console.error("MFL POST Error:", err);
      throw err;
    }
  }

  // ───────── LOGIN + GET LEAGUES ─────────
  async function getUserLeagues({ username, password, year }) {
    if (!username || !password) {
      throw new Error("Missing username or password");
    }

    const data = await post("/mfl/userLeagues", { username, password, year });

    // Handle debug response format {leagues: [...], debug: {...}}
    if (data?.debug) {
      console.log("[MFL] Debug info:", JSON.stringify(data.debug).slice(0, 2000));
    }

    // Return the leagues array whether it's wrapped or bare
    return Array.isArray(data) ? data : (data?.leagues || []);
  }

  // ───────── GET FULL LEAGUE DATA ─────────
  async function getLeagueBundle({
    leagueId,
    year,
    username,
    password
  }) {
    if (!leagueId) {
      throw new Error("Missing leagueId");
    }

    return post("/mfl/bundle", {
      leagueId,
      year,
      username,
      password
    });
  }

  return {
    getUserLeagues,
    getLeagueBundle
  };
})();