// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Trophy Room
// ─────────────────────────────────────────────────────────

const DLRTrophyRoom = (() => {

  async function init() {
    const el = document.getElementById("trophy-room-container");
    if (!el) return;

    const profile = Auth.getCurrentProfile();
    if (!profile) {
      el.innerHTML = `<div class="tr-empty">Sign in to see your trophy room.</div>`;
      return;
    }

    const all   = Object.values(profile.leagues || {});
    const stats = profile.stats || {};

    if (!all.length) {
      el.innerHTML = `<div class="tr-empty">Import your leagues to populate your trophy room.</div>`;
      return;
    }

    // Owner leagues: has a roster assigned OR has played games
    // New leagues (no games yet) qualify if myRosterId is set
    // Commish-only leagues have no myRosterId and no record
    const managed = all.filter(l =>
      l.myRosterId || (l.wins || 0) > 0 || (l.losses || 0) > 0 || (l.pointsFor || 0) > 0
    );

    const champs  = managed.filter(l => l.isChampion || l.playoffFinish === 1)
                           .sort((a,b) => (b.season||"").localeCompare(a.season||""));
    const runners = managed.filter(l => l.playoffFinish === 2)
                           .sort((a,b) => (b.season||"").localeCompare(a.season||""));
    const thirds  = managed.filter(l => l.playoffFinish === 3)
                           .sort((a,b) => (b.season||"").localeCompare(a.season||""));

    const totalWins   = stats.totalWins   || 0;
    const totalLosses = stats.totalLosses || 0;
    const totalGames  = totalWins + totalLosses;
    const winPct      = totalGames > 0 ? (totalWins / totalGames * 100).toFixed(1) : "0.0";
    const dscore      = stats.dynastyScore || 0;

    // Timeline — group managed leagues by season only
    const seasonMap = {};
    const TYPE_ORDER = { dynasty: 0, salary: 1, keeper: 2, redraft: 3 };
    managed.forEach(l => {
      if (!l.season) return;
      if (!seasonMap[l.season]) seasonMap[l.season] = [];
      seasonMap[l.season].push(l);
    });
    // Sort each season's leagues by type order, then alphabetically
    Object.values(seasonMap).forEach(arr => {
      arr.sort((a, b) => {
        const ao = TYPE_ORDER[a.leagueType] ?? 99;
        const bo = TYPE_ORDER[b.leagueType] ?? 99;
        if (ao !== bo) return ao - bo;
        return (a.leagueName || "").localeCompare(b.leagueName || "");
      });
    });
    const seasons = Object.keys(seasonMap).sort((a,b) => b.localeCompare(a));

    el.innerHTML = `
      <div class="tr-header">
        <div>
          <h2 class="tr-title">🏆 Trophy Room</h2>
          <p class="tr-subtitle">${_esc(profile.username)}'s career achievements</p>
        </div>
        <div class="tr-dynasty-score">
          <div class="tr-ds-val">${dscore}</div>
          <div class="tr-ds-lbl">Dynasty Score</div>
        </div>
      </div>

      <div class="tr-banner">
        <div class="tr-banner-stat"><div class="tr-banner-val">${champs.length}</div><div class="tr-banner-lbl">🏆 Titles</div></div>
        <div class="tr-banner-stat"><div class="tr-banner-val">${runners.length}</div><div class="tr-banner-lbl">🥈 Runner-Up</div></div>
        <div class="tr-banner-stat"><div class="tr-banner-val">${thirds.length}</div><div class="tr-banner-lbl">🥉 3rd Place</div></div>
        <div class="tr-banner-stat"><div class="tr-banner-val">${stats.playoffAppearances||0}</div><div class="tr-banner-lbl">🏅 Playoffs</div></div>
        <div class="tr-banner-stat"><div class="tr-banner-val">${winPct}%</div><div class="tr-banner-lbl">Win Rate</div></div>
        <div class="tr-banner-stat"><div class="tr-banner-val">${totalWins}–${totalLosses}</div><div class="tr-banner-lbl">Record</div></div>
      </div>

      ${champs.length ? `
      <div class="tr-section">
        <div class="tr-section-title">Championships</div>
        <div class="tr-trophy-shelf">${champs.map(l => _trophyCard(l,"🏆","var(--color-gold)")).join("")}</div>
      </div>` : ""}

      ${runners.length ? `
      <div class="tr-section">
        <div class="tr-section-title">Runner-Up Finishes</div>
        <div class="tr-trophy-shelf">${runners.map(l => _trophyCard(l,"🥈","#94a3b8")).join("")}</div>
      </div>` : ""}

      ${thirds.length ? `
      <div class="tr-section">
        <div class="tr-section-title">Third Place</div>
        <div class="tr-trophy-shelf">${thirds.map(l => _trophyCard(l,"🥉","#cd7f32")).join("")}</div>
      </div>` : ""}

      ${!champs.length && !runners.length && !thirds.length ? `
      <div class="tr-empty-trophies">
        <div style="font-size:3rem;margin-bottom:var(--space-3)">🏟</div>
        <div style="font-weight:700;margin-bottom:var(--space-2)">The shelf is empty — for now</div>
        <div class="dim" style="font-size:.85rem">Playoff results appear here once leagues are imported.</div>
      </div>` : ""}

      <div class="tr-section">
        <div class="tr-section-title">Career Timeline</div>
        ${seasons.map(season => {
          const ls = seasonMap[season];
          return `
            <div class="tr-year-row">
              <div class="tr-year-badge">${season}</div>
              <div class="tr-year-leagues">
                ${ls.map(l => {
                  const finish = l.playoffFinish;
                  const icon   = finish===1?"🏆":finish===2?"🥈":finish===3?"🥉":finish&&finish<=7?"🏅":"";
                  const recColor = l.wins > l.losses ? "var(--color-green)" : l.wins < l.losses ? "var(--color-red)" : "var(--color-text-muted)";
                  return `
                    <div class="tr-tl-row">
                      <div class="tr-tl-name">${_esc(l.leagueName||"—")}</div>
                      <div class="tr-tl-right">
                        <span class="tr-tl-rec" style="color:${recColor}">${l.wins||0}–${l.losses||0}</span>
                        ${icon ? `<span class="tr-tl-icon">${icon}</span>` : ""}
                        ${l.leagueType ? `<span class="tr-tl-type">${l.leagueType}</span>` : ""}
                      </div>
                    </div>`;
                }).join("")}
              </div>
            </div>`;
        }).join("")}
      </div>`;
  }

  function _trophyCard(l, icon, color) {
    return `
      <div class="tr-trophy-card" style="border-color:${color}44">
        <div class="tr-trophy-icon">${icon}</div>
        <div class="tr-trophy-season" style="color:${color}">${l.season||"—"}</div>
        <div class="tr-trophy-league">${_esc(l.leagueName||"—")}</div>
        <div class="tr-trophy-rec dim">${l.wins||0}–${l.losses||0}</div>
        ${l.teamName ? `<div class="tr-trophy-team dim">${_esc(l.teamName)}</div>` : ""}
      </div>`;
  }

  function _esc(s) {
    return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  return { init };
})();
