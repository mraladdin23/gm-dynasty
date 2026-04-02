// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Trophy Room
//  Visual trophy case showing championships, runner-ups,
//  and career milestones from the user's league history.
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

    const leagues = profile.leagues || {};
    const stats   = profile.stats   || {};
    const all     = Object.values(leagues);

    if (!all.length) {
      el.innerHTML = `<div class="tr-empty">Import your leagues to populate your trophy room.</div>`;
      return;
    }

    // Collect all awards
    const champs    = all.filter(l => l.isChampion || l.playoffFinish === 1).sort((a, b) => (b.season||"").localeCompare(a.season||""));
    const runners   = all.filter(l => l.playoffFinish === 2).sort((a, b) => (b.season||"").localeCompare(a.season||""));
    const thirds    = all.filter(l => l.playoffFinish === 3).sort((a, b) => (b.season||"").localeCompare(a.season||""));
    const playoffs  = all.filter(l => l.playoffFinish && l.playoffFinish <= 7 && l.playoffFinish > 3);
    const allSeasons = [...new Set(all.map(l => l.season).filter(Boolean))].sort((a,b) => b.localeCompare(a));

    // Milestones
    const totalWins  = stats.totalWins   || 0;
    const totalGames = totalWins + (stats.totalLosses || 0);
    const winPct     = totalGames > 0 ? (totalWins / totalGames * 100).toFixed(1) : "0.0";
    const dscore     = stats.dynastyScore || 0;

    el.innerHTML = `
      <div class="tr-header">
        <div>
          <h2 class="tr-title">🏆 Trophy Room</h2>
          <p class="tr-subtitle">${profile.username}'s career achievements</p>
        </div>
        <div class="tr-dynasty-score">
          <div class="tr-ds-val">${dscore}</div>
          <div class="tr-ds-lbl">Dynasty Score</div>
        </div>
      </div>

      <!-- Career banner stats -->
      <div class="tr-banner">
        <div class="tr-banner-stat">
          <div class="tr-banner-val">${champs.length}</div>
          <div class="tr-banner-lbl">🏆 Championships</div>
        </div>
        <div class="tr-banner-stat">
          <div class="tr-banner-val">${runners.length}</div>
          <div class="tr-banner-lbl">🥈 Runner-Ups</div>
        </div>
        <div class="tr-banner-stat">
          <div class="tr-banner-val">${thirds.length}</div>
          <div class="tr-banner-lbl">🥉 3rd Place</div>
        </div>
        <div class="tr-banner-stat">
          <div class="tr-banner-val">${stats.playoffAppearances || 0}</div>
          <div class="tr-banner-lbl">🏅 Playoff Apps</div>
        </div>
        <div class="tr-banner-stat">
          <div class="tr-banner-val">${winPct}%</div>
          <div class="tr-banner-lbl">📊 Win Rate</div>
        </div>
        <div class="tr-banner-stat">
          <div class="tr-banner-val">${allSeasons.length}</div>
          <div class="tr-banner-lbl">📅 Seasons</div>
        </div>
      </div>

      <!-- Championship shelf -->
      ${champs.length ? `
      <div class="tr-section">
        <div class="tr-section-title">Championship Seasons</div>
        <div class="tr-trophy-shelf">
          ${champs.map(l => _trophyCard(l, "champion")).join("")}
        </div>
      </div>` : ""}

      <!-- Runner-up shelf -->
      ${runners.length ? `
      <div class="tr-section">
        <div class="tr-section-title">Runner-Up Finishes</div>
        <div class="tr-trophy-shelf">
          ${runners.map(l => _trophyCard(l, "runner")).join("")}
        </div>
      </div>` : ""}

      <!-- 3rd place -->
      ${thirds.length ? `
      <div class="tr-section">
        <div class="tr-section-title">Third Place Finishes</div>
        <div class="tr-trophy-shelf">
          ${thirds.map(l => _trophyCard(l, "third")).join("")}
        </div>
      </div>` : ""}

      <!-- Year-by-year timeline -->
      <div class="tr-section">
        <div class="tr-section-title">Career Timeline</div>
        <div class="tr-timeline">
          ${allSeasons.map(season => {
            const seasonLeagues = all.filter(l => l.season === season);
            return `
              <div class="tr-year-block">
                <div class="tr-year-label">${season}</div>
                <div class="tr-year-leagues">
                  ${seasonLeagues.map(l => {
                    const finish = l.playoffFinish;
                    const icon   = finish === 1 ? "🏆" : finish === 2 ? "🥈" : finish === 3 ? "🥉" : finish && finish <= 7 ? "🏅" : "";
                    const rec    = `${l.wins||0}–${l.losses||0}`;
                    return `
                      <div class="tr-timeline-league">
                        <div class="tr-tl-name">${_esc(l.leagueName||"—")}</div>
                        <div class="tr-tl-meta">
                          <span class="tr-tl-rec">${rec}</span>
                          ${icon ? `<span class="tr-tl-finish">${icon}</span>` : ""}
                          <span class="tr-tl-type dim">${l.leagueType||""}</span>
                        </div>
                      </div>`;
                  }).join("")}
                </div>
              </div>`;
          }).join("")}
        </div>
      </div>

      <!-- Empty state if no trophies at all -->
      ${!champs.length && !runners.length && !thirds.length ? `
      <div class="tr-empty-trophies">
        <div style="font-size:3rem;margin-bottom:var(--space-3)">🏟</div>
        <div style="font-weight:700;margin-bottom:var(--space-2)">The shelf is empty — for now</div>
        <div class="dim" style="font-size:.88rem">Your championships and playoff results will appear here as you add leagues.</div>
      </div>` : ""}
    `;
  }

  function _trophyCard(league, type) {
    const icons  = { champion:"🏆", runner:"🥈", third:"🥉" };
    const colors = { champion:"var(--color-gold)", runner:"#94a3b8", third:"#cd7f32" };
    const icon   = icons[type]  || "🏅";
    const color  = colors[type] || "var(--color-text-dim)";

    return `
      <div class="tr-trophy-card" style="border-color:${color}33">
        <div class="tr-trophy-icon" style="color:${color}">${icon}</div>
        <div class="tr-trophy-season" style="color:${color}">${league.season}</div>
        <div class="tr-trophy-league">${_esc(league.leagueName || "—")}</div>
        <div class="tr-trophy-rec dim">${league.wins||0}–${league.losses||0}</div>
      </div>`;
  }

  function _esc(s) {
    return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  return { init };

})();
