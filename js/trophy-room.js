// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Trophy Room
// ─────────────────────────────────────────────────────────

const DLRTrophyRoom = (() => {

  async function init() {
    const el = document.getElementById("trophy-room-container");
    if (!el) return;

    const profile = Auth.getCurrentProfile();
    if (!profile) { el.innerHTML = `<div class="tr-empty">Sign in to see your trophy room.</div>`; return; }

    const all   = Object.values(profile.leagues || {});
    const stats = profile.stats || {};

    if (!all.length) { el.innerHTML = `<div class="tr-empty">Import your leagues to populate your trophy room.</div>`; return; }

    // Only leagues where user actually managed a team (has myRosterId or teamName)
    const managed = all.filter(l => l.teamName || l.myRosterId);

    const champs   = managed.filter(l => l.isChampion || l.playoffFinish === 1).sort((a,b) => (b.season||"").localeCompare(a.season||""));
    const runners  = managed.filter(l => l.playoffFinish === 2).sort((a,b) => (b.season||"").localeCompare(a.season||""));
    const thirds   = managed.filter(l => l.playoffFinish === 3).sort((a,b) => (b.season||"").localeCompare(a.season||""));

    const totalWins  = stats.totalWins   || 0;
    const totalGames = totalWins + (stats.totalLosses || 0);
    const winPct     = totalGames > 0 ? (totalWins / totalGames * 100).toFixed(1) : "0.0";
    const dscore     = stats.dynastyScore || 0;

    // Career timeline — group managed leagues by season, newest first
    const seasonMap = {};
    managed.forEach(l => {
      if (!l.season) return;
      if (!seasonMap[l.season]) seasonMap[l.season] = [];
      seasonMap[l.season].push(l);
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
        <div class="tr-banner-stat"><div class="tr-banner-val">${runners.length}</div><div class="tr-banner-lbl">🥈 Runner-Ups</div></div>
        <div class="tr-banner-stat"><div class="tr-banner-val">${thirds.length}</div><div class="tr-banner-lbl">🥉 3rd Place</div></div>
        <div class="tr-banner-stat"><div class="tr-banner-val">${stats.playoffAppearances||0}</div><div class="tr-banner-lbl">🏅 Playoff Apps</div></div>
        <div class="tr-banner-stat"><div class="tr-banner-val">${winPct}%</div><div class="tr-banner-lbl">📊 Win Rate</div></div>
        <div class="tr-banner-stat"><div class="tr-banner-val">${stats.seasonsPlayed||seasons.length}</div><div class="tr-banner-lbl">📅 Seasons</div></div>
      </div>

      ${champs.length ? `
      <div class="tr-section">
        <div class="tr-section-title">Championship Seasons</div>
        <div class="tr-trophy-grid">${champs.map(l => _card(l,"champion")).join("")}</div>
      </div>` : ""}

      ${runners.length ? `
      <div class="tr-section">
        <div class="tr-section-title">Runner-Up Finishes</div>
        <div class="tr-trophy-grid">${runners.map(l => _card(l,"runner")).join("")}</div>
      </div>` : ""}

      ${thirds.length ? `
      <div class="tr-section">
        <div class="tr-section-title">Third Place Finishes</div>
        <div class="tr-trophy-grid">${thirds.map(l => _card(l,"third")).join("")}</div>
      </div>` : ""}

      ${!champs.length && !runners.length && !thirds.length ? `
      <div class="tr-empty-trophies">
        <div style="font-size:3rem;margin-bottom:var(--space-3)">🏟</div>
        <div style="font-weight:700;margin-bottom:var(--space-2)">The shelf is empty — for now</div>
        <div class="dim" style="font-size:.88rem">Your championships and playoff results will appear here once imported.</div>
      </div>` : ""}

      <div class="tr-section">
        <div class="tr-section-title">Career Timeline</div>
        <div class="tr-timeline-grid">
          ${seasons.map(season => {
            const leagues = seasonMap[season];
            return `
              <div class="tr-season-card">
                <div class="tr-season-year">${season}</div>
                ${leagues.map(l => {
                  const finish = l.playoffFinish;
                  const icon = finish===1?"🏆":finish===2?"🥈":finish===3?"🥉":finish&&finish<=7?"🏅":"";
                  return `
                    <div class="tr-season-league">
                      <div class="tr-sl-header">
                        <div class="tr-sl-name">${_esc(l.leagueName||"—")}</div>
                        ${icon?`<span class="tr-sl-icon">${icon}</span>`:""}
                      </div>
                      <div class="tr-sl-meta">
                        <span class="tr-sl-rec">${l.wins||0}–${l.losses||0}</span>
                        ${l.leagueType?`<span class="tr-sl-type">${l.leagueType}</span>`:""}
                        ${l.teamName?`<span class="tr-sl-team dim">${_esc(l.teamName)}</span>`:""}
                      </div>
                    </div>`;
                }).join("")}
              </div>`;
          }).join("")}
        </div>
      </div>
    `;
  }

  function _card(l, type) {
    const cfg = {
      champion: { icon:"🏆", color:"var(--color-gold)" },
      runner:   { icon:"🥈", color:"#94a3b8" },
      third:    { icon:"🥉", color:"#cd7f32" }
    }[type] || { icon:"🏅", color:"var(--color-text-dim)" };

    return `
      <div class="tr-trophy-card" style="border-color:${cfg.color}44">
        <div class="tr-trophy-icon">${cfg.icon}</div>
        <div class="tr-trophy-season" style="color:${cfg.color}">${l.season||"—"}</div>
        <div class="tr-trophy-league">${_esc(l.leagueName||"—")}</div>
        <div class="tr-trophy-rec dim">${l.wins||0}–${l.losses||0}</div>
        ${l.teamName?`<div class="tr-trophy-team dim" style="font-size:.65rem">${_esc(l.teamName)}</div>`:""}
      </div>`;
  }

  function _esc(s) { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  return { init };
})();
