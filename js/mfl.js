// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — MFL API
//  Worker: https://mfl-proxy.mraladdin23.workers.dev
//  Primary endpoint: /bundle?leagueId=&year=
//  Returns normalized: { league, teams, rosters, matchups,
//                        standings, players, draft, futurePicks }
// ─────────────────────────────────────────────────────────

const MFLAPI = (() => {

  const BASE = "https://mfl-proxy.mraladdin23.workers.dev";

  async function fetchJSON(path) {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`MFL worker error ${res.status}`);
    return res.json();
  }

  async function getLeagueBundle(leagueId, year) {
    return fetchJSON(`/bundle?leagueId=${leagueId}&year=${year}`);
  }

  async function searchLeagues(username, year) {
    try {
      const data = await fetchJSON(`/leagueSearch?user=${encodeURIComponent(username)}&year=${year}`);
      const leagues = data?.leagues?.league;
      if (!leagues) return [];
      const arr = Array.isArray(leagues) ? leagues : [leagues];
      return arr.map(l => ({ leagueId: String(l.league_id || l.id), leagueName: l.name, year: String(year) }));
    } catch(e) { return []; }
  }

  function findMyFranchise(bundle, username) {
    const teams  = bundle.teams || [];
    const search = (username || "").toLowerCase();
    const match  = teams.find(t =>
      (t.owner_name || t.ownerName || "").toLowerCase().includes(search) ||
      (t.name || "").toLowerCase().includes(search)
    );
    return match ? { teamId: match.id, teamName: match.name } : null;
  }

  function normalizeStandings(bundle) {
    return (bundle.standings || []).map((s, i) => ({
      teamId:     s.teamId  || s.id,
      wins:       parseInt(s.wins   || s.W  || 0),
      losses:     parseInt(s.losses || s.L  || 0),
      ties:       parseInt(s.ties   || s.T  || 0),
      ptsFor:     parseFloat(s.ptsFor     || s.PF || 0),
      ptsAgainst: parseFloat(s.ptsAgainst || s.PA || 0),
      rank:       s.rank || (i + 1)
    }));
  }

  async function importUserLeagues(username, leagueIds = []) {
    const currentYear = new Date().getFullYear();
    const years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];
    const results = [];

    for (const leagueId of leagueIds) {
      for (const year of years) {
        try {
          const bundle = await getLeagueBundle(leagueId, year);
          if (!bundle) continue;
          // bundle may be empty for years the league doesn't exist
          const hasData = bundle.teams?.length || bundle.league?.name;
          if (!hasData) continue;

          const me = findMyFranchise(bundle, username);
          if (!me) continue;

          const standings = normalizeStandings(bundle);
          const mySt = standings.find(s => s.teamId === me.teamId);

          results.push({
            leagueId:    String(leagueId),
            year:        String(year),
            leagueName:  bundle.league?.name || `League ${leagueId}`,
            teamName:    me.teamName,
            franchiseId: me.teamId,
            wins:        mySt?.wins       || 0,
            losses:      mySt?.losses     || 0,
            ties:        mySt?.ties       || 0,
            ptsFor:      mySt?.ptsFor     || 0,
            ptsAgainst:  mySt?.ptsAgainst || 0,
            rank:        mySt?.rank       || null,
            totalTeams:  (bundle.teams || []).length || 12,
            playoffFinish: null
          });
        } catch(e) {
          console.warn(`[MFL] Skip ${leagueId}/${year}:`, e.message);
        }
      }
    }
    return results;
  }

  // Derived helpers used by league tabs
  function getTeam(bundle, teamId) {
    return (bundle.teams || []).find(t => t.id === teamId);
  }

  function getRoster(bundle, teamId) {
    const roster = (bundle.rosters || []).find(r => r.teamId === teamId);
    if (!roster) return [];
    return (roster.players || [])
      .map(pid => (bundle.players || []).find(p => p.id === pid))
      .filter(Boolean);
  }

  function getMatchupsForWeek(bundle, week) {
    return (bundle.matchups || []).filter(m => Number(m.week) === Number(week));
  }

  function getStandingsMap(bundle) {
    const map = {};
    (bundle.standings || []).forEach(s => { map[s.teamId || s.id] = s; });
    return map;
  }

  function buildDraftBoard(bundle) {
    return (bundle.draft || []).map(p => {
      const player = (bundle.players || []).find(pl => pl.id === p.playerId);
      return { round: p.round, pick: p.pick, teamId: p.teamId,
               playerName: player?.name || "Unknown", position: player?.position || null };
    });
  }

  function buildRookieDraftBoard(bundle) {
    return (bundle.futurePicks || []).map(p =>
      ({ round: p.round, pick: p.pick, teamId: p.teamId })
    );
  }

  return {
    fetchJSON,
    getLeagueBundle,
    searchLeagues,
    findMyFranchise,
    normalizeStandings,
    importUserLeagues,
    getTeam, getRoster, getMatchupsForWeek, getStandingsMap,
    buildDraftBoard, buildRookieDraftBoard
  };

})();
