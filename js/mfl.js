// ─────────────────────────────────────────────────────────
//  MFL API — Normalized frontend module
//  Works with worker endpoints: /userLeagues, /bundle
// ─────────────────────────────────────────────────────────

const MFLAPI = (() => {
  const BASE = "https://mfl-proxy.mraladdin23.workers.dev";

  async function fetchJSON(path) {
    const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`MFL worker error ${res.status}`);
    return res.json();
  }

  async function searchUserLeagues(username, year) {
    const data = await fetchJSON(`/userLeagues?username=${encodeURIComponent(username)}&year=${year}`);
    return Array.isArray(data) ? data : [];
  }

  async function getLeagueBundle(leagueId, year) {
    const raw = await fetchJSON(`/bundle?leagueId=${leagueId}&year=${year}`);
    return normalizeBundle(raw);
  }

  function normalizeBundle(raw) {
    if (!raw) return {};

    const bundle = {
      league: raw.league?.league || null,
      teams: [],
      rosters: [],
      standings: [],
      matchups: [],
      players: [],
      draft: [],
      futurePicks: [],
      transactions: raw.transactions?.transaction || [],
      auctions: raw.auctions?.auction || [],
      rules: raw.rules?.settings || {}
    };

    // Teams from league
    const franchises = raw.league?.franchises?.franchise;
    if (franchises) {
      const arr = Array.isArray(franchises) ? franchises : [franchises];
      bundle.teams = arr.map(t => ({
        id: t.id,
        name: t.name || `Team ${t.id}`,
        owner_name: t.owner_name || "",
        ownerName: t.owner_name || ""
      }));
    }

    // Rosters
    const rosters = raw.rosters?.rosters?.franchise;
    if (rosters) {
      const arr = Array.isArray(rosters) ? rosters : [rosters];
      bundle.rosters = arr.map(r => {
        const players = r.player ? (Array.isArray(r.player) ? r.player : [r.player]) : [];
        return { teamId: r.id, players: players.map(p => p.id) };
      });
    }

    // Players
    const players = raw.players?.players?.player;
    if (players) {
      const arr = Array.isArray(players) ? players : [players];
      bundle.players = arr.map(p => ({
        id: p.id,
        name: p.name || "",
        position: p.position || "",
        team: p.team || "FA",
        status: p.status || ""
      }));
    }

    // Standings
    const standings = raw.standings?.leagueStandings?.franchise;
    if (standings) {
      const arr = Array.isArray(standings) ? standings : [standings];
      bundle.standings = arr.map((s, i) => ({
        teamId: s.id,
        wins: parseInt(s.W || s.h2hw || 0),
        losses: parseInt(s.L || s.h2hl || 0),
        ties: parseInt(s.T || s.h2ht || 0),
        ptsFor: parseFloat(s.PF || s.pf || 0),
        ptsAgainst: parseFloat(s.PA || s.pa || 0),
        rank: i + 1
      }));
    }

    // Matchups
    const scoreboards = raw.matchups?.scoreboard;
    if (scoreboards) {
      const week = parseInt(scoreboards.week || 0);
      const matches = scoreboards.matchup ? (Array.isArray(scoreboards.matchup) ? scoreboards.matchup : [scoreboards.matchup]) : [];
      bundle.matchups = matches.map(mu => {
        const teams = mu.franchise ? (Array.isArray(mu.franchise) ? mu.franchise : [mu.franchise]) : [];
        return {
          week,
          home: { teamId: teams[0]?.id || "", score: parseFloat(teams[0]?.score || 0) },
          away: { teamId: teams[1]?.id || "", score: parseFloat(teams[1]?.score || 0) }
        };
      });
    }

    // Draft
    const draftUnits = raw.draft?.draftResults?.draftUnit;
    if (draftUnits) {
      const units = Array.isArray(draftUnits) ? draftUnits : [draftUnits];
      bundle.draft = units.flatMap(u => {
        const picks = u.draftPick ? (Array.isArray(u.draftPick) ? u.draftPick : [u.draftPick]) : [];
        return picks.map(p => ({
          round: parseInt(p.round || 0),
          pick: parseInt(p.pick || 0),
          teamId: p.franchise || "",
          playerId: p.player || ""
        }));
      });
    }

    // Future Picks
    const fPicks = raw.futurePicks?.futureDraftPicks?.franchise;
    if (fPicks) {
      const arr = Array.isArray(fPicks) ? fPicks : [fPicks];
      bundle.futurePicks = arr.flatMap(fr => {
        const picks = fr.futureDraftPick ? (Array.isArray(fr.futureDraftPick) ? fr.futureDraftPick : [fr.futureDraftPick]) : [];
        return picks.map(p => ({
          teamId: fr.id,
          round: parseInt(p.round || 0),
          originalTeamId: p.original_franchise || fr.id
        }));
      });
    }

    return bundle;
  }

  // ── searchLeagues alias (old name still used by profile.js) ─
  async function searchLeagues(username, year) {
    return searchUserLeagues(username, year);
  }

  // ── Derived helpers from bundle ──────────────────────────
  function normalizeStandings(bundle) {
    return (bundle.standings || []).map((s, i) => ({
      teamId:     s.teamId,
      wins:       s.wins       || 0,
      losses:     s.losses     || 0,
      ties:       s.ties       || 0,
      ptsFor:     s.ptsFor     || 0,
      ptsAgainst: s.ptsAgainst || 0,
      rank:       s.rank       || (i + 1)
    }));
  }

  function getStandingsMap(bundle) {
    const map = {};
    (bundle.standings || []).forEach(s => { map[s.teamId] = s; });
    return map;
  }

  function getRoster(bundle, teamId) {
    const roster = (bundle.rosters || []).find(r => r.teamId === teamId);
    if (!roster) return [];
    return (roster.players || [])
      .map(pid => (bundle.players || []).find(p => p.id === pid))
      .filter(Boolean);
  }

  function findMyFranchise(bundle, username) {
    const search = (username || "").toLowerCase();
    return (bundle.teams || []).find(t =>
      (t.owner_name || "").toLowerCase().includes(search) ||
      (t.name       || "").toLowerCase().includes(search)
    ) || null;
  }

  // ── importUserLeagues: search by username + fetch bundles ─
  async function importUserLeagues(username, leagueIds = []) {
    const currentYear = new Date().getFullYear();
    const years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3];
    const results = [];

    for (const leagueId of leagueIds) {
      for (const year of years) {
        try {
          const bundle = await getLeagueBundle(leagueId, year);
          if (!bundle?.teams?.length && !bundle?.league) continue;

          const me = findMyFranchise(bundle, username);
          if (!me) continue;

          const standings = normalizeStandings(bundle);
          const mySt = standings.find(s => s.teamId === me.id);

          results.push({
            leagueId:    String(leagueId),
            year:        String(year),
            leagueName:  bundle.league?.name || `League ${leagueId}`,
            teamName:    me.name,
            franchiseId: me.id,
            wins:        mySt?.wins        || 0,
            losses:      mySt?.losses      || 0,
            ties:        mySt?.ties        || 0,
            ptsFor:      mySt?.ptsFor      || 0,
            ptsAgainst:  mySt?.ptsAgainst  || 0,
            rank:        mySt?.rank        || null,
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

  return {
    fetchJSON,
    searchUserLeagues,
    searchLeagues,       // alias
    getLeagueBundle,
    normalizeStandings,
    getStandingsMap,
    getRoster,
    findMyFranchise,
    importUserLeagues
  };
})();