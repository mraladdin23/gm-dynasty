// ─────────────────────────────────────────────────────────
// Dynasty Locker Room — Normalized MFL Frontend API
// ─────────────────────────────────────────────────────────

const MFLAPI = (() => {

  // 🔥 IMPORTANT — ALREADY FILLED IN
  const BASE = "https://mfl-proxy.mraladdin23.workers.dev";

  async function fetchJSON(path) {
    const res = await fetch(`${BASE}${path}`, {
      signal: AbortSignal.timeout(12000)
    });

    if (!res.ok) {
      throw new Error(`Request failed: ${res.status}`);
    }

    return res.json();
  }

  // ─────────────────────────────────────────
  // CORE
  // ─────────────────────────────────────────

  async function getLeagueBundle(leagueId, year) {
    return fetchJSON(`/bundle?leagueId=${leagueId}&year=${year}`);
  }

  // ─────────────────────────────────────────
  // DERIVED HELPERS (THIS IS WHERE MAGIC HAPPENS)
  // ─────────────────────────────────────────

  function buildDraftBoard(bundle) {
    const { draft, players } = bundle;

    return draft.map(p => {
      const player = players.find(pl => pl.id === p.playerId);

      return {
        round: p.round,
        pick: p.pick,
        teamId: p.teamId,
        playerName: player?.name || "Unknown",
        position: player?.position || null
      };
    });
  }

  function getTeam(bundle, teamId) {
    return bundle.teams.find(t => t.id === teamId);
  }

  function getRoster(bundle, teamId) {
    const roster = bundle.rosters.find(r => r.teamId === teamId);
    if (!roster) return [];

    return roster.players.map(pid =>
      bundle.players.find(p => p.id === pid)
    ).filter(Boolean);
  }

  function getMatchupsForWeek(bundle, week) {
    return bundle.matchups.filter(m => m.week === week);
  }

  function getStandingsMap(bundle) {
    const map = {};
    bundle.standings.forEach(s => {
      map[s.teamId] = s;
    });
    return map;
  }

  function buildRookieDraftBoard(bundle) {
    return bundle.futurePicks.map(p => ({
      round: p.round,
      pick: p.pick,
      teamId: p.teamId
    }));
  }

  // ─────────────────────────────────────────
  // EXPORTS
  // ─────────────────────────────────────────

  return {
    getLeagueBundle,
    buildDraftBoard,
    buildRookieDraftBoard,
    getTeam,
    getRoster,
    getMatchupsForWeek,
    getStandingsMap
  };

})();