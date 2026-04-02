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

  return { fetchJSON, searchUserLeagues, getLeagueBundle };
})();