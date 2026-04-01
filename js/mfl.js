// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — MyFantasyLeague (MFL) API
//  FINAL VERSION — Uses Cloudflare Worker API Layer
// ─────────────────────────────────────────────────────────

const MFLAPI = (() => {

  // ── Configuration ──────────────────────────────────────
  const BASE = "https://mfl-proxy.mraladdin23.workers.dev";

  // ── Fetch helper ───────────────────────────────────────
  async function fetchJSON(path) {
    const res = await fetch(`${BASE}${path}`, {
      signal: AbortSignal.timeout(12000)
    });

    if (!res.ok) {
      throw new Error(`Request failed: ${res.status}`);
    }

    return res.json();
  }

  // ── Core Endpoints ─────────────────────────────────────

  async function getLeagueBundle(leagueId, year) {
    const data = await fetchJSON(`/leagueBundle?leagueId=${leagueId}&year=${year}`);

    return {
      league: data.league,
      standings: normalizeStandings(data.standings),
      rosters: data.rosters
    };
  }

  async function getLeague(leagueId, year) {
    const data = await fetchJSON(`/league?leagueId=${leagueId}&year=${year}`);
    return data?.league || null;
  }

  async function getStandings(leagueId, year) {
    const data = await fetchJSON(`/standings?leagueId=${leagueId}&year=${year}`);
    return normalizeStandings(data?.leagueStandings);
  }

  async function getRosters(leagueId, year) {
    const data = await fetchJSON(`/rosters?leagueId=${leagueId}&year=${year}`);
    return data?.rosters || null;
  }

  async function getPlayers(year) {
    const data = await fetchJSON(`/players?year=${year}`);
    return data?.players || null;
  }

  async function searchLeagues(username, year) {
    const data = await fetchJSON(`/leagueSearch?user=${encodeURIComponent(username)}&year=${year}`);

    const leagues = data?.leagues?.league;
    if (!leagues) return [];

    const arr = Array.isArray(leagues) ? leagues : [leagues];

    return arr.map(l => ({
      leagueId: l.league_id || l.id,
      leagueName: l.name,
      year
    }));
  }

  // ── Franchise Matching ─────────────────────────────────

  function findMyFranchise(league, username) {
    const franchises = league?.franchises?.franchise;
    if (!franchises) return null;

    const arr = Array.isArray(franchises) ? franchises : [franchises];
    const search = username.toLowerCase();

    const match = arr.find(f => {
      const owner = (f.owner_name || "").toLowerCase();
      const team = (f.name || "").toLowerCase();
      return owner.includes(search) || team.includes(search);
    });

    return match ? { franchiseId: match.id, teamName: match.name } : null;
  }

  // ── Normalize helpers ──────────────────────────────────

  function normalizeStandings(standings) {
    if (!standings) return [];

    const list = standings.franchise;
    if (!list) return [];

    const arr = Array.isArray(list) ? list : [list];

    return arr.map((s, i) => ({
      franchiseId: s.id,
      wins: parseInt(s.W || s.h2hw || 0),
      losses: parseInt(s.L || s.h2hl || 0),
      ties: parseInt(s.T || s.h2ht || 0),
      ptsFor: parseFloat(s.PF || s.pf || 0),
      ptsAgainst: parseFloat(s.PA || s.pa || 0),
      rank: i + 1
    }));
  }

  // ── High-level import (optimized) ──────────────────────

  async function importUserLeagues(username, leagueIds = []) {
    const currentYear = new Date().getFullYear();
    const years = [
      currentYear,
      currentYear - 1,
      currentYear - 2,
      currentYear - 3
    ];

    const results = [];

    for (const leagueId of leagueIds) {
      for (const year of years) {
        try {
          const bundle = await getLeagueBundle(leagueId, year);
          if (!bundle.league) continue;

          const me = findMyFranchise(bundle.league, username);
          if (!me) continue;

          const myStanding = bundle.standings.find(s => s.franchiseId === me.franchiseId);

          results.push({
            leagueId,
            year,
            leagueName: bundle.league.name,
            teamName: me.teamName,
            wins: myStanding?.wins || 0,
            losses: myStanding?.losses || 0,
            rank: myStanding?.rank || null
          });

        } catch (e) {
          console.warn(`[MFL] Failed ${leagueId} ${year}:`, e.message);
        }
      }
    }

    return results;
  }

  // ── Public API ─────────────────────────────────────────

  return {
    getLeagueBundle,
    getLeague,
    getStandings,
    getRosters,
    getPlayers,
    searchLeagues,
    findMyFranchise,
    importUserLeagues
  };

})();
