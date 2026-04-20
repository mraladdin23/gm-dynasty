// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Hallway
//  Browse other managers' public lockers
//  Lives in the Hallway nav view
// ─────────────────────────────────────────────────────────

const DLRHallway = (() => {

  let _debounce  = null;
  let _cache     = {};
  let _pinned    = [];   // usernames the current user has pinned
  let _allUsers  = [];   // full result set for pagination
  let _page      = 0;

  const PIN_KEY  = "dlr_hallway_pins";
  const PAGE_SIZE = 12;  // 4 cols × 3 rows desktop; overridden to 5 on mobile via _getPageSize()

  function _getPageSize() {
    return window.innerWidth <= 768 ? 4 : 12;
  }

  // ── Init (called when hallway view becomes active) ────────
  async function init() {
    // Try Firebase first, fall back to localStorage
    const fbPins = await _loadPinsFromFirebase();
    _pinned = fbPins !== null ? fbPins : _loadPinsLocal();
    // Sync to localStorage as cache
    _savePinsLocal(_pinned);
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
      dynastyScore:    stats.dynastyScore  || 0,
      seasonsPlayed:   new Set(Object.values(data.leagues || {}).map(l => l.season).filter(Boolean)).size,
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

  function _renderGrid(el, users, page = 0) {
    if (users === "loading") {
      el.innerHTML = `<div class="hallway-searching"><div class="spinner"></div> Loading lockers…</div>`;
      return;
    }
    if (!users.length) {
      el.innerHTML = `<div class="hallway-empty">No managers found.</div>`;
      return;
    }

    _allUsers = users;
    _page     = page;

    const pageSize   = _getPageSize();
    const totalPages = Math.ceil(users.length / pageSize);
    const pageUsers  = users.slice(page * pageSize, (page + 1) * pageSize);

    const paginationHtml = totalPages > 1 ? `
      <div class="hallway-pagination">
        <button class="hallway-page-btn" ${page === 0 ? "disabled" : ""}
          onclick="DLRHallway.goToPage(${page - 1})">‹ Prev</button>
        <span class="hallway-page-info">Page ${page + 1} of ${totalPages}</span>
        <button class="hallway-page-btn" ${page >= totalPages - 1 ? "disabled" : ""}
          onclick="DLRHallway.goToPage(${page + 1})">Next ›</button>
      </div>` : "";

    el.innerHTML = `
      ${pageUsers.map(u => _lockerCard(u)).join("")}
      ${paginationHtml}`;
  }

  function goToPage(page) {
    const el = document.getElementById("hallway-results");
    if (!el) return;
    _renderGrid(el, _allUsers, page);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function _lockerCard(u) {
    const initials   = (u.username || "?")[0].toUpperCase();
    const avatarUrl  = u.avatarUrl || (u.sleeperAvatar
      ? `https://sleepercdn.com/avatars/thumbs/${u.sleeperAvatar}` : "");
    const isPinned   = _pinned.includes(u.username);
    const teamLogo   = u.favoriteNflTeam
      ? `https://a.espncdn.com/i/teamlogos/nfl/500/${u.favoriteNflTeam.toLowerCase()}.png` : "";

    return `
      <div class="hallway-locker" onclick="DLRHallway.openLocker('${_esc(u.username)}')">
        ${teamLogo ? `<img class="hl-team-logo" src="${teamLogo}" onerror="this.style.display='none'" loading="lazy"/>` : ""}
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
        <div class="hl-stats">
          <span class="hl-stat"><span class="hl-stat-val">🏆 ${u.championships}</span><span class="hl-stat-lbl">Titles</span></span>
          <span class="hl-stat"><span class="hl-stat-val">${u.winPct !== null ? u.winPct + "%" : "—"}</span><span class="hl-stat-lbl">Win%</span></span>
          <span class="hl-stat"><span class="hl-stat-val">${u.dynastyScore || "—"}</span><span class="hl-stat-lbl">Dyn. Score</span></span>
          <span class="hl-stat"><span class="hl-stat-val">${u.seasonsPlayed || "—"}</span><span class="hl-stat-lbl">Yrs Played</span></span>
        </div>
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

    const myLeagueKeys  = new Set(Object.keys(Auth.getCurrentProfile()?.leagues || {}));
    const seenDynasty   = {};
    const commonLeagues = Object.entries(data.leagues)
      .filter(([key]) => myLeagueKeys.has(key))
      .map(([, l]) => l)
      .sort((a, b) => (b.season||"").localeCompare(a.season||""))
      .filter(l => {
        const isDynasty = l.leagueType === 'dynasty' || l.leagueType === 'keeper';
        if (!isDynasty) return true;
        const nameKey = (l.leagueName || '').toLowerCase().trim();
        if (seenDynasty[nameKey]) return false;
        seenDynasty[nameKey] = true;
        return true;
      });

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
            <div class="ms-stat-card"><div class="ms-stat-val">${data.totalWins}–${data.totalLosses}</div><div class="ms-stat-lbl">Record</div></div>
            <div class="ms-stat-card"><div class="ms-stat-val">${data.winPct !== null ? data.winPct+"%" : "—"}</div><div class="ms-stat-lbl">Win%</div></div>
            <div class="ms-stat-card"><div class="ms-stat-val">${data.championships||0}</div><div class="ms-stat-lbl">🏆 Titles</div></div>
            <div class="ms-stat-card"><div class="ms-stat-val">${data.dynastyScore||"—"}</div><div class="ms-stat-lbl">Dyn. Score</div></div>
            <div class="ms-stat-card"><div class="ms-stat-val">${data.seasonsPlayed||0}</div><div class="ms-stat-lbl">Yrs Played</div></div>
            <div class="ms-stat-card"><div class="ms-stat-val">${data.leagueCount}</div><div class="ms-stat-lbl">Lg. Seasons</div></div>
          </div>
          ${commonLeagues.length ? `
          <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-text-dim);margin-bottom:var(--space-3)">Common Leagues</div>
          ${commonLeagues.map(l => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);font-size:.85rem">
              <div>
                <div style="font-weight:600">${_esc(l.leagueName||"—")}</div>
                <div class="dim" style="font-size:.72rem">${l.season||"—"} · ${l.leagueType||"—"}</div>
              </div>
              <div style="text-align:right">
                <div style="font-family:var(--font-display);font-weight:700">${l.wins||0}–${l.losses||0}</div>
                ${l.isChampion ? `<div style="color:var(--color-gold);font-size:.7rem">🏆 Champion</div>` : ""}
              </div>
            </div>`).join("")}` : `
          <div style="font-size:.83rem;color:var(--color-text-dim);padding:var(--space-4) 0;">No leagues in common.</div>`}
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  }

  function togglePin(username) {
    const idx = _pinned.indexOf(username);
    if (idx >= 0) _pinned.splice(idx, 1);
    else          _pinned.push(username);
    _savePinsLocal(_pinned);
    _savePinsToFirebase(_pinned);  // fire and forget — no await needed
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

  async function _loadPinsFromFirebase() {
    try {
      const username = Auth.getCurrentProfile()?.username;
      if (!username) return null;
      const data = await GMDB._restGet(`gmd/users/${username.toLowerCase()}/hallwayPins`);
      if (Array.isArray(data)) return data;
      if (data && typeof data === 'object') return Object.values(data);
      return [];
    } catch(e) { return null; }
  }

  async function _savePinsToFirebase(pins) {
    try {
      const username = Auth.getCurrentProfile()?.username;
      if (!username) return;
      await GMDB._restPut(`gmd/users/${username.toLowerCase()}/hallwayPins`, pins);
    } catch(e) {}
  }

  function _loadPinsLocal() {
    try { return JSON.parse(localStorage.getItem(PIN_KEY) || "[]"); } catch(e) { return []; }
  }

  function _savePinsLocal(pins) {
    try { localStorage.setItem(PIN_KEY, JSON.stringify(pins)); } catch(e) {}
  }

  function _esc(s) {
    return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  return { init, search, openLocker, togglePin, isPinned, goToPage };

})();
