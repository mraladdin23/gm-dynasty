// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Hallway
//  Browse other managers' public lockers
//  Lives in the Hallway nav view
// ─────────────────────────────────────────────────────────

const DLRHallway = (() => {

  let _debounce  = null;
  let _cache     = {};
  let _pinned    = [];   // usernames the current user has pinned

  const PIN_KEY  = "dlr_hallway_pins";

  // ── Init (called when hallway view becomes active) ────────
  async function init() {
    _pinned = _loadPins();
    const el = document.getElementById("hallway-results");
    if (!el) return;

    if (_pinned.length) {
      _renderGrid(el, "loading");
      const users = await Promise.all(_pinned.map(u => _fetchUser(u)));
      _renderGrid(el, users.filter(Boolean));
    } else {
      el.innerHTML = `
        <div class="hallway-empty">
          <div style="font-size:2.5rem;margin-bottom:var(--space-3)">🚪</div>
          <div style="font-weight:700;font-size:1.1rem;margin-bottom:var(--space-2)">The Hallway</div>
          <div style="color:var(--color-text-dim);font-size:.88rem">
            Search for a manager to view their locker.<br>
            Pin lockers you visit often for quick access.
          </div>
        </div>`;
    }
  }

  function search(query) {
    clearTimeout(_debounce);
    const el = document.getElementById("hallway-results");
    if (!el) return;

    if (!query || query.trim().length < 2) {
      init(); // reset to pinned lockers
      return;
    }

    el.innerHTML = `<div class="hallway-searching"><div class="spinner"></div> Searching…</div>`;
    _debounce = setTimeout(() => _doSearch(query.trim().toLowerCase()), 350);
  }

  async function _doSearch(query) {
    const el = document.getElementById("hallway-results");
    if (!el) return;

    if (_cache[query]) { _renderGrid(el, _cache[query]); return; }

    try {
      // Search Firebase users by username prefix
      const snap = await GMD.child("users")
        .orderByKey()
        .startAt(query)
        .endAt(query + "\uf8ff")
        .limitToFirst(12)
        .once("value");

      const raw   = snap.val() || {};
      const users = Object.entries(raw).map(([username, data]) =>
        _formatUser(username, data)
      );

      _cache[query] = users;
      _renderGrid(el, users.length ? users : []);
    } catch(e) {
      el.innerHTML = `<div class="hallway-empty" style="color:var(--color-red)">
        Search failed: ${e.message}<br>
        <span style="font-size:.8rem;color:var(--color-text-dim)">Check Firebase rules allow reading gmd/users</span>
      </div>`;
    }
  }

  function _formatUser(username, data) {
    const stats      = data.stats || {};
    const totalGames = (stats.totalWins || 0) + (stats.totalLosses || 0);
    return {
      username,
      bio:             data.bio           || "",
      favoriteNflTeam: data.favoriteNflTeam || "",
      avatarUrl:       data.avatarUrl     || "",
      sleeperAvatar:   data.platforms?.sleeper?.avatar || "",
      totalWins:       stats.totalWins    || 0,
      totalLosses:     stats.totalLosses  || 0,
      winPct:          totalGames > 0 ? (stats.totalWins / totalGames * 100).toFixed(1) : null,
      championships:   stats.championships || 0,
      seasonsPlayed:   stats.seasonsPlayed || 0,
      leagueCount:     Object.keys(data.leagues || {}).length,
      leagues:         data.leagues       || {}
    };
  }

  async function _fetchUser(username) {
    try {
      const snap = await GMD.child(`users/${username.toLowerCase()}`).once("value");
      const data  = snap.val();
      if (!data) return null;
      return _formatUser(username, data);
    } catch(e) { return null; }
  }

  function _renderGrid(el, users) {
    if (users === "loading") {
      el.innerHTML = `<div class="hallway-searching"><div class="spinner"></div> Loading lockers…</div>`;
      return;
    }
    if (!users.length) {
      el.innerHTML = `<div class="hallway-empty">No managers found.</div>`;
      return;
    }

    el.innerHTML = users.map(u => _lockerCard(u)).join("");
  }

  function _lockerCard(u) {
    const initials   = (u.username || "?")[0].toUpperCase();
    const avatarUrl  = u.avatarUrl || (u.sleeperAvatar
      ? `https://sleepercdn.com/avatars/thumbs/${u.sleeperAvatar}` : "");
    const isPinned   = _pinned.includes(u.username);
    const teamLogo   = u.favoriteNflTeam
      ? `https://a.espncdn.com/i/teamlogos/nfl/500/${u.favoriteNflTeam.toLowerCase()}.png` : "";

    // Recent leagues for locker room "card" look
    const currentYear = new Date().getFullYear().toString();
    const prevYear    = (new Date().getFullYear() - 1).toString();
    const recentLeagues = Object.values(u.leagues)
      .filter(l => l.season === currentYear || l.season === prevYear)
      .sort((a, b) => (b.season||"").localeCompare(a.season||""))
      .slice(0, 3);

    return `
      <div class="hallway-locker" onclick="DLRHallway.openLocker('${_esc(u.username)}')">
        <!-- Team logo watermark -->
        ${teamLogo ? `<img class="hl-team-logo" src="${teamLogo}" onerror="this.style.display='none'" loading="lazy"/>` : ""}

        <!-- Nameplate -->
        <div class="hl-nameplate">
          <div class="hl-avatar" style="${avatarUrl ? `background-image:url(${avatarUrl});background-size:cover;background-position:center` : ""}">
            ${avatarUrl ? "" : `<span>${initials}</span>`}
          </div>
          <div class="hl-identity">
            <div class="hl-username">${_esc(u.username)}</div>
            ${u.bio ? `<div class="hl-bio">${_esc(u.bio.slice(0,50))}</div>` : ""}
          </div>
          <button class="hl-pin-btn ${isPinned ? "hl-pin-btn--active" : ""}"
            onclick="event.stopPropagation();DLRHallway.togglePin('${_esc(u.username)}')"
            title="${isPinned ? "Unpin" : "Pin to hallway"}">
            ${isPinned ? "📌" : "📍"}
          </button>
        </div>

        <!-- Stats shelf -->
        <div class="hl-stats">
          ${u.championships > 0 ? `<span class="hl-stat"><span class="hl-stat-val">🏆 ${u.championships}</span><span class="hl-stat-lbl">Titles</span></span>` : ""}
          ${u.winPct !== null ? `<span class="hl-stat"><span class="hl-stat-val">${u.winPct}%</span><span class="hl-stat-lbl">Win%</span></span>` : ""}
          ${u.seasonsPlayed > 0 ? `<span class="hl-stat"><span class="hl-stat-val">${u.seasonsPlayed}</span><span class="hl-stat-lbl">Seasons</span></span>` : ""}
        </div>

        <!-- Recent leagues clipboard -->
        ${recentLeagues.length ? `
        <div class="hl-leagues">
          ${recentLeagues.map(l => `
            <div class="hl-league-row">
              <span class="hl-league-name">${_esc(l.leagueName || "—")}</span>
              <span class="hl-league-rec">${l.wins||0}–${l.losses||0}</span>
              ${l.isChampion ? `<span style="color:var(--color-gold);font-size:.7rem">🏆</span>` : ""}
            </div>`).join("")}
        </div>` : ""}
      </div>`;
  }

  async function openLocker(username) {
    // Fetch full user data and show modal
    const data = await _fetchUser(username);
    if (!data) { showToast("Could not load this manager's locker.", "error"); return; }

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.id        = "hallway-locker-modal";
    modal.style.zIndex = "900";

    const avatarUrl = data.avatarUrl || (data.sleeperAvatar
      ? `https://sleepercdn.com/avatars/thumbs/${data.sleeperAvatar}` : "");
    const initials  = (username || "?")[0].toUpperCase();
    const isPinned  = _pinned.includes(username);

    const recentLeagues = Object.values(data.leagues)
      .sort((a, b) => (b.season||"").localeCompare(a.season||""))
      .slice(0, 10);

    modal.innerHTML = `
      <div class="modal-box modal-box--wide">
        <div class="modal-header">
          <div style="display:flex;align-items:center;gap:var(--space-3)">
            <div class="ms-avatar ms-avatar--lg" style="${avatarUrl ? `background-image:url(${avatarUrl});background-size:cover;background-position:center` : ""}">
              ${avatarUrl ? "" : `<span style="font-size:1.4rem">${initials}</span>`}
            </div>
            <div>
              <div style="font-weight:800;font-size:1.1rem">${_esc(username)}</div>
              ${data.bio ? `<div class="dim" style="font-size:.83rem;margin-top:2px">${_esc(data.bio)}</div>` : ""}
            </div>
            <button class="hl-pin-btn ${isPinned ? "hl-pin-btn--active" : ""}"
              style="margin-left:var(--space-2)"
              onclick="DLRHallway.togglePin('${_esc(username)}');this.textContent=DLRHallway.isPinned('${_esc(username)}')?'📌':'📍'"
              title="${isPinned ? "Unpin" : "Pin"}">
              ${isPinned ? "📌" : "📍"}
            </button>
          </div>
          <button class="modal-close" onclick="document.getElementById('hallway-locker-modal').remove()">✕</button>
        </div>
        <div class="modal-body">
          <div class="ms-stats-grid" style="margin-bottom:var(--space-5)">
            <div class="ms-stat-card"><div class="ms-stat-val">${data.seasonsPlayed||0}</div><div class="ms-stat-lbl">Seasons</div></div>
            <div class="ms-stat-card"><div class="ms-stat-val">${data.totalWins}–${data.totalLosses}</div><div class="ms-stat-lbl">Record</div></div>
            <div class="ms-stat-card"><div class="ms-stat-val">${data.winPct !== null ? data.winPct+"%" : "—"}</div><div class="ms-stat-lbl">Win%</div></div>
            <div class="ms-stat-card"><div class="ms-stat-val">${data.championships||0}</div><div class="ms-stat-lbl">🏆 Titles</div></div>
            <div class="ms-stat-card"><div class="ms-stat-val">${data.leagueCount}</div><div class="ms-stat-lbl">Total Seasons</div></div>
          </div>
          ${recentLeagues.length ? `
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-text-dim);margin-bottom:var(--space-3)">League History</div>
          ${recentLeagues.map(l => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);font-size:.85rem">
              <div>
                <div style="font-weight:600">${_esc(l.leagueName||"—")}</div>
                <div class="dim" style="font-size:.72rem">${l.season||"—"} · ${l.leagueType||"—"}</div>
              </div>
              <div style="text-align:right">
                <div style="font-family:var(--font-display);font-weight:700">${l.wins||0}–${l.losses||0}</div>
                ${l.isChampion ? `<div style="color:var(--color-gold);font-size:.7rem">🏆 Champion</div>` : ""}
              </div>
            </div>`).join("")}` : ""}
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  }

  function togglePin(username) {
    const idx = _pinned.indexOf(username);
    if (idx >= 0) _pinned.splice(idx, 1);
    else          _pinned.push(username);
    _savePins(_pinned);
    // Re-render pin buttons without full reload
    document.querySelectorAll(".hl-pin-btn").forEach(btn => {
      const card = btn.closest("[onclick*='openLocker']");
      if (!card) return;
      const onc = card.getAttribute("onclick") || "";
      const match = onc.match(/'([^']+)'/);
      if (match && match[1] === username) {
        const pinned = _pinned.includes(username);
        btn.textContent = pinned ? "📌" : "📍";
        btn.classList.toggle("hl-pin-btn--active", pinned);
      }
    });
  }

  function isPinned(username) { return _pinned.includes(username); }

  function _loadPins() {
    try { return JSON.parse(localStorage.getItem(PIN_KEY) || "[]"); } catch(e) { return []; }
  }

  function _savePins(pins) {
    try { localStorage.setItem(PIN_KEY, JSON.stringify(pins)); } catch(e) {}
  }

  function _esc(s) {
    return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  return { init, search, openLocker, togglePin, isPinned };

})();
