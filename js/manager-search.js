// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Manager Search
//  Search for other DLR users by username
//  View their public locker stats
// ─────────────────────────────────────────────────────────

const DLRManagerSearch = (() => {

  let _debounce = null;
  let _cache    = {};

  function open() {
    const panel = document.getElementById("manager-search-panel");
    const back  = document.getElementById("ms-backdrop");
    panel?.classList.remove("ms-panel--hidden");
    back?.classList.remove("hidden");
    document.getElementById("ms-input")?.focus();
  }

  function close() {
    document.getElementById("manager-search-panel")?.classList.add("ms-panel--hidden");
    document.getElementById("ms-backdrop")?.classList.add("hidden");
    const input = document.getElementById("ms-input");
    if (input) input.value = "";
    const results = document.getElementById("ms-results");
    if (results) results.innerHTML = "";
  }

  function search(query) {
    clearTimeout(_debounce);
    const el = document.getElementById("ms-results");
    if (!el) return;
    if (!query || query.trim().length < 2) {
      el.innerHTML = `<div class="ms-hint">Type at least 2 characters to search.</div>`;
      return;
    }
    el.innerHTML = `<div class="ms-searching"><div class="spinner" style="width:18px;height:18px"></div> Searching…</div>`;
    _debounce = setTimeout(() => _doSearch(query.trim().toLowerCase()), 400);
  }

  async function _doSearch(query) {
    const el = document.getElementById("ms-results");
    if (!el) return;

    // Check cache
    if (_cache[query]) { _renderResults(el, _cache[query]); return; }

    try {
      // Search DLR Firebase for matching usernames
      const snap = await GMD.child("users").orderByKey()
        .startAt(query).endAt(query + "\uf8ff").limitToFirst(10).once("value");
      const raw = snap.val() || {};
      const users = Object.entries(raw).map(([username, data]) => ({
        username,
        bio:            data.bio         || "",
        favoriteNflTeam: data.favoriteNflTeam || "",
        avatarUrl:      data.avatarUrl   || "",
        sleeperAvatar:  data.platforms?.sleeper?.avatar || "",
        stats:          data.stats       || {},
        leagueCount:    Object.keys(data.leagues || {}).length
      }));

      // Also try Sleeper username lookup as fallback
      if (!users.length) {
        try {
          const sleeperUser = await fetch(`https://api.sleeper.app/v1/user/${encodeURIComponent(query)}`).then(r => r.ok ? r.json() : null);
          if (sleeperUser?.username) {
            users.push({
              username:    sleeperUser.username.toLowerCase(),
              bio:         "",
              favoriteNflTeam: "",
              avatarUrl:   "",
              sleeperAvatar: sleeperUser.avatar || "",
              stats:       {},
              leagueCount: 0,
              sleeperOnly: true
            });
          }
        } catch(e) {}
      }

      _cache[query] = users;
      _renderResults(el, users);
    } catch(e) {
      el.innerHTML = `<div class="ms-error">Search failed: ${e.message}</div>`;
    }
  }

  function _renderResults(el, users) {
    if (!users.length) {
      el.innerHTML = `<div class="ms-empty">No managers found. They may not have a DLR account yet.</div>`;
      return;
    }

    el.innerHTML = users.map(u => {
      const initials   = (u.username || "?")[0].toUpperCase();
      const avatarUrl  = u.avatarUrl || (u.sleeperAvatar ? `https://sleepercdn.com/avatars/thumbs/${u.sleeperAvatar}` : "");
      const totalGames = (u.stats.totalWins || 0) + (u.stats.totalLosses || 0);
      const winPct     = totalGames > 0
        ? ((u.stats.totalWins || 0) / totalGames * 100).toFixed(1) + "%" : "—";
      const champs     = u.stats.championships || 0;

      const teamLogoUrl = u.favoriteNflTeam
        ? `https://a.espncdn.com/i/teamlogos/nfl/500/${u.favoriteNflTeam.toLowerCase()}.png` : "";

      return `
        <div class="ms-result-row" onclick="DLRManagerSearch.viewLocker('${u.username}')">
          <div class="ms-avatar" style="${avatarUrl ? `background-image:url(${avatarUrl});background-size:cover;background-position:center` : ""}">
            ${avatarUrl ? "" : `<span>${initials}</span>`}
          </div>
          <div class="ms-info">
            <div class="ms-username">${_esc(u.username)}</div>
            ${u.bio ? `<div class="ms-bio dim">${_esc(u.bio.slice(0, 60))}</div>` : ""}
            ${u.sleeperOnly ? `<div class="ms-bio dim">Sleeper user · not on DLR yet</div>` : ""}
          </div>
          <div class="ms-stats">
            ${champs > 0 ? `<span class="ms-stat-pill">🏆 ${champs}</span>` : ""}
            ${totalGames > 0 ? `<span class="ms-stat-pill">${winPct} W%</span>` : ""}
            ${u.leagueCount > 0 ? `<span class="ms-stat-pill">${u.leagueCount} leagues</span>` : ""}
          </div>
          ${teamLogoUrl ? `<img class="ms-team-logo" src="${teamLogoUrl}" onerror="this.style.display='none'" loading="lazy"/>` : ""}
        </div>`;
    }).join("");
  }

  async function viewLocker(username) {
    close();
    // Show a modal with the other manager's public stats
    const snap = await GMD.child(`users/${username.toLowerCase()}`).once("value");
    const data = snap.val();
    if (!data) { showToast("Could not load this manager's profile.", "error"); return; }

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id = "ms-locker-modal";
    modal.style.zIndex = "900";

    const stats       = data.stats || {};
    const leagues     = data.leagues || {};
    const totalGames  = (stats.totalWins || 0) + (stats.totalLosses || 0);
    const winPct      = totalGames > 0 ? ((stats.totalWins || 0) / totalGames * 100).toFixed(1) + "%" : "—";
    const avatarUrl   = data.avatarUrl || (data.platforms?.sleeper?.avatar ? `https://sleepercdn.com/avatars/thumbs/${data.platforms.sleeper.avatar}` : "");
    const initials    = (username || "?")[0].toUpperCase();

    // Build recent leagues (current season only)
    const currentYear = new Date().getFullYear().toString();
    const prevYear    = (new Date().getFullYear() - 1).toString();
    const recentLeagues = Object.values(leagues)
      .filter(l => l.season === currentYear || l.season === prevYear)
      .sort((a, b) => (b.season || "").localeCompare(a.season || ""))
      .slice(0, 8);

    modal.innerHTML = `
      <div class="modal-box modal-box--wide">
        <div class="modal-header">
          <h3>👤 ${_esc(username)}'s Locker</h3>
          <button class="modal-close" onclick="document.getElementById('ms-locker-modal').remove()">✕</button>
        </div>
        <div class="modal-body">
          <div class="ms-profile-header">
            <div class="ms-avatar ms-avatar--lg" style="${avatarUrl ? `background-image:url(${avatarUrl});background-size:cover;background-position:center` : ""}">
              ${avatarUrl ? "" : `<span style="font-size:1.4rem">${initials}</span>`}
            </div>
            <div>
              <div style="font-weight:800;font-size:1.1rem">${_esc(username)}</div>
              ${data.bio ? `<div class="dim" style="font-size:.85rem;margin-top:4px">${_esc(data.bio)}</div>` : ""}
            </div>
          </div>

          <div class="ms-stats-grid">
            <div class="ms-stat-card"><div class="ms-stat-val">${stats.seasonsPlayed || 0}</div><div class="ms-stat-lbl">Seasons</div></div>
            <div class="ms-stat-card"><div class="ms-stat-val">${stats.totalWins||0}–${stats.totalLosses||0}</div><div class="ms-stat-lbl">Record</div></div>
            <div class="ms-stat-card"><div class="ms-stat-val">${winPct}</div><div class="ms-stat-lbl">Win %</div></div>
            <div class="ms-stat-card"><div class="ms-stat-val">${stats.championships||0}</div><div class="ms-stat-lbl">🏆 Titles</div></div>
            <div class="ms-stat-card"><div class="ms-stat-val">${stats.playoffApps||0}</div><div class="ms-stat-lbl">Playoff Apps</div></div>
            <div class="ms-stat-card"><div class="ms-stat-val">${Object.keys(leagues).length}</div><div class="ms-stat-lbl">Total Seasons</div></div>
          </div>

          ${recentLeagues.length ? `
          <div style="margin-top:var(--space-5)">
            <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-text-dim);margin-bottom:var(--space-3)">Recent Leagues</div>
            ${recentLeagues.map(l => `
              <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);font-size:.85rem;">
                <div>
                  <div style="font-weight:600">${_esc(l.leagueName || "—")}</div>
                  <div class="dim" style="font-size:.72rem">${l.season} · ${l.leagueType || "—"}</div>
                </div>
                <div style="text-align:right">
                  <div style="font-family:var(--font-display);font-weight:700">${l.wins||0}–${l.losses||0}</div>
                  ${l.isChampion ? `<div style="color:var(--color-gold);font-size:.7rem">🏆 Champion</div>` : ""}
                </div>
              </div>`).join("")}
          </div>` : ""}
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  }

  function _esc(s) {
    return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  return { open, close, search, viewLocker };

})();
