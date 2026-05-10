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

    const myProfile     = Auth.getCurrentProfile();
    const myLeagues     = myProfile?.leagues || {};
    const myLeagueKeys  = new Set(Object.keys(myLeagues));

    // ── Build common leagues (deduped display rows) ──────────────────────────
    // Also build a map from display key → all matching league keys (for H2H
    // aggregation across dynasty chain seasons).
    const seenDynasty    = {};
    const chainLeagueMap = {}; // displayKey → [{ leagueId, platform, season, myRosterId, theirRosterId, leagueKey }]

    const commonLeagues = Object.entries(data.leagues)
      .filter(([key]) => myLeagueKeys.has(key))
      .map(([key, l]) => ({ key, ...l }))
      .sort((a, b) => (b.season||"").localeCompare(a.season||""))
      .filter(l => {
        const isDynasty = l.leagueType === 'dynasty' || l.leagueType === 'keeper';
        if (!isDynasty) return true;
        const nameKey = (l.leagueName || '').toLowerCase().trim();
        if (seenDynasty[nameKey]) return false;
        seenDynasty[nameKey] = true;
        return true;
      });

    // For each displayed league row, collect all seasons of that chain
    // (same platform + same leagueName for dynasty/keeper, or exact key match for redraft)
    commonLeagues.forEach(displayLeague => {
      const isDynasty = displayLeague.leagueType === 'dynasty' || displayLeague.leagueType === 'keeper';
      const nameKey   = (displayLeague.leagueName || '').toLowerCase().trim();
      const displayKey = displayLeague.key;

      // Gather all matching keys from both users' perspectives
      const matchingKeys = Object.keys(myLeagues).filter(k => {
        const ml = myLeagues[k];
        if (ml.platform !== displayLeague.platform) return false;
        if (!myLeagueKeys.has(k) || !data.leagues[k]) return false; // must be common
        if (!isDynasty) return k === displayKey;
        return (ml.leagueName || '').toLowerCase().trim() === nameKey;
      });

      chainLeagueMap[displayKey] = matchingKeys.map(k => ({
        leagueKey:          k,
        leagueId:           myLeagues[k].leagueId,
        platform:           myLeagues[k].platform,
        season:             myLeagues[k].season,
        myRosterId:         myLeagues[k].myRosterId    || null,
        theirRosterId:      data.leagues[k]?.myRosterId || null,
        // Fallback user IDs for resolving missing roster IDs on the fly (Sleeper only)
        mySleeperUserId:    myLeagues[k].sleeperUserId    || myProfile?.platforms?.sleeper?.sleeperUserId || null,
        theirSleeperUserId: data.leagues[k]?.sleeperUserId || null,
        leagueKey_yahoo:    myLeagues[k].leagueKey || null,
      }));
    });

    // ── Render modal immediately with H2H placeholders ───────────────────────
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
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:var(--space-3)">
            <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--color-text-dim)">Common Leagues</div>
            <div id="hl-h2h-combined" style="display:flex;align-items:center;gap:var(--space-3)">
              <div style="display:flex;align-items:center;gap:4px"><div class="spinner spinner--sm"></div></div>
            </div>
          </div>
          <div id="hl-common-leagues">
            ${commonLeagues.map(l => `
              <div class="hl-common-row" id="hl-row-${_esc(l.key)}" style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);font-size:.85rem">
                <div>
                  <div style="font-weight:600">${_esc(l.leagueName||"—")}</div>
                  <div class="dim" style="font-size:.72rem">${l.season||"—"} · ${l.leagueType||"—"}${(l.leagueType==='dynasty'||l.leagueType==='keeper') && (chainLeagueMap[l.key]?.length||0) > 1 ? ` · ${chainLeagueMap[l.key].length} seasons` : ""}</div>
                </div>
                <div style="display:flex;align-items:center;gap:var(--space-4)">
                  <div style="text-align:right">
                    <div style="font-family:var(--font-display);font-weight:700">${l.wins||0}–${l.losses||0}</div>
                    ${l.isChampion ? `<div style="color:var(--color-gold);font-size:.7rem">🏆 Champion</div>` : ""}
                  </div>
                  <div class="hl-h2h" id="hl-h2h-${_esc(l.key)}" style="text-align:right;min-width:52px">
                    <div style="display:flex;align-items:center;gap:4px;justify-content:flex-end">
                      <div class="spinner spinner--sm"></div>
                    </div>
                  </div>
                </div>
              </div>`).join("")}
          </div>` : `
          <div style="font-size:.83rem;color:var(--color-text-dim);padding:var(--space-4) 0;">No leagues in common.</div>`}
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });

    // ── Load H2H records async, patch each row when ready ───────────────────
    if (commonLeagues.length) {
      _loadAllH2H(commonLeagues, chainLeagueMap, modal);
    }
  }

  // ── H2H loading orchestrator ─────────────────────────────────────────────
  // Fires one H2H computation per displayed league row concurrently,
  // patching each row's placeholder as results arrive.
  // When all rows are done, patches a combined total row.
  async function _loadAllH2H(commonLeagues, chainLeagueMap, modal) {
    let combinedWins = 0, combinedLosses = 0, combinedFound = false;

    await Promise.allSettled(commonLeagues.map(async displayLeague => {
      const displayKey = displayLeague.key;
      const seasons    = chainLeagueMap[displayKey] || [];

      if (!modal.isConnected) return;

      try {
        const h2h = await _computeH2HForChain(seasons);
        _patchH2HCell(displayKey, h2h, modal);
        if (h2h) {
          combinedWins   += h2h.wins;
          combinedLosses += h2h.losses;
          combinedFound   = true;
        }
      } catch(e) {
        _patchH2HCell(displayKey, null, modal);
      }
    }));

    // Patch the combined total header once all rows are done
    if (!modal.isConnected) return;
    const combined = modal.querySelector("#hl-h2h-combined");
    if (!combined) return;
    if (!combinedFound || (combinedWins === 0 && combinedLosses === 0)) {
      combined.remove();
      return;
    }
    const winColor = combinedWins > combinedLosses ? "var(--color-green)"
                   : combinedLosses > combinedWins ? "var(--color-red)"
                   : "var(--color-text-dim)";
    combined.innerHTML = `
      <span style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-dim)">Overall H2H</span>
      <span style="font-family:var(--font-display);font-weight:800;font-size:1rem;color:${winColor}">${combinedWins}–${combinedLosses}</span>`;
  }

  // ── Compute H2H across all seasons for one chain ─────────────────────────
  // Returns { wins, losses, pf, pa } from the current user's perspective,
  // or null if we couldn't determine (missing roster IDs, no data, etc.)
  async function _computeH2HForChain(seasons) {
    let totalWins = 0, totalLosses = 0, totalPF = 0, totalPA = 0, found = false;

    await Promise.allSettled(seasons.map(async s => {
      // For Sleeper: attempt to resolve missing roster IDs on the fly via user ID
      if (s.platform === "sleeper" && (!s.myRosterId || !s.theirRosterId)) {
        if (s.mySleeperUserId || s.theirSleeperUserId) {
          try {
            const rosters = await SleeperAPI.getRosters(s.leagueId);
            if (!s.myRosterId && s.mySleeperUserId) {
              const r = rosters.find(r => String(r.owner_id) === String(s.mySleeperUserId));
              if (r) s = { ...s, myRosterId: r.roster_id };
            }
            if (!s.theirRosterId && s.theirSleeperUserId) {
              const r = rosters.find(r => String(r.owner_id) === String(s.theirSleeperUserId));
              if (r) s = { ...s, theirRosterId: r.roster_id };
            }
          } catch(e) { /* can't resolve, will skip below */ }
        }
      }

      if (!s.myRosterId || !s.theirRosterId) {
        console.log(`[H2H] Skipping ${s.leagueId} (${s.season}) — could not resolve rosterId. mine=${s.myRosterId} theirs=${s.theirRosterId}`);
        return;
      }
      if (String(s.myRosterId) === String(s.theirRosterId)) return;

      let result = null;
      try {
        if      (s.platform === "sleeper") result = await _h2hSleeper(s);
        else if (s.platform === "mfl")     result = await _h2hMFL(s);
        else if (s.platform === "yahoo")   result = await _h2hYahoo(s);
      } catch(e) {
        console.warn(`[H2H] Error computing ${s.platform} ${s.leagueId}:`, e.message);
      }

      if (result) {
        totalWins   += result.wins;
        totalLosses += result.losses;
        totalPF     += result.pf;
        totalPA     += result.pa;
        found = true;
      }
    }));

    if (!found) return null;
    return { wins: totalWins, losses: totalLosses, pf: totalPF, pa: totalPA };
  }

  // ── Sleeper H2H ───────────────────────────────────────────────────────────
  // Fetches all regular-season weeks in parallel, finds weeks where the two
  // roster IDs share a matchup_id.
  async function _h2hSleeper({ leagueId, season, myRosterId, theirRosterId }) {
    // Get the league to find how many weeks were played and when playoffs started
    let totalWeeks = 17;
    let playoffStart = 99;
    try {
      const league = await SleeperAPI.getLeague(leagueId);
      // leg = last scored week; use it as the max week to fetch
      totalWeeks   = league?.settings?.leg || league?.settings?.week || 17;
      // playoff_week_start is the most reliable field; fall back to common alternatives
      playoffStart = league?.settings?.playoff_week_start
                  || league?.settings?.playoff_start
                  || league?.settings?.playoffs_start
                  || 99;
      // Cap to regular season only (exclude playoff matchups from H2H)
      if (playoffStart < 99) totalWeeks = Math.min(totalWeeks, playoffStart - 1);
    } catch(e) { /* use defaults */ }

    const weeks = Array.from({ length: Math.max(1, totalWeeks) }, (_, i) => i + 1);

    const results = await Promise.allSettled(
      weeks.map(w => SleeperAPI.getMatchups(leagueId, w))
    );

    let wins = 0, losses = 0, pf = 0, pa = 0;
    const myId    = String(myRosterId);
    const theirId = String(theirRosterId);

    results.forEach(r => {
      if (r.status !== "fulfilled" || !Array.isArray(r.value)) return;
      const mine   = r.value.find(m => String(m.roster_id) === myId);
      const theirs = r.value.find(m => String(m.roster_id) === theirId);
      if (!mine || !theirs) return;
      if (mine.matchup_id == null || mine.matchup_id !== theirs.matchup_id) return;

      const myPts    = mine.points  || 0;
      const theirPts = theirs.points || 0;
      pf += myPts;
      pa += theirPts;
      if      (myPts > theirPts) wins++;
      else if (theirPts > myPts) losses++;
    });

    return { wins, losses, pf, pa };
  }

  // ── MFL H2H ───────────────────────────────────────────────────────────────
  // Fetches all regular-season weeks via getLiveScoring in parallel,
  // finds weeks where the two franchise IDs appear as home/away in the same matchup.
  async function _h2hMFL({ leagueId, season, myRosterId, theirRosterId }) {
    // Fetch the bundle just to get week range — reuse if already cached by standings tab
    let startWeek = 1, endWeek = 17, playoffStart = 99;
    try {
      const bundle     = await MFLAPI.getLeagueBundle(leagueId, season);
      const l          = bundle?.league?.league || {};
      startWeek        = Math.max(1, parseInt(l.startWeek || l.firstRegularSeasonWeek || 1));
      playoffStart     = parseInt(l.lastRegularSeasonWeek || l.endWeek || 17) + 1;
      endWeek          = playoffStart - 1;
    } catch(e) { /* use defaults */ }

    const weeks = Array.from({ length: endWeek - startWeek + 1 }, (_, i) => startWeek + i);

    const results = await Promise.allSettled(
      weeks.map(w => MFLAPI.getLiveScoring(leagueId, season, w))
    );

    let wins = 0, losses = 0, pf = 0, pa = 0;
    const myId    = String(myRosterId);
    const theirId = String(theirRosterId);

    results.forEach(r => {
      if (r.status !== "fulfilled") return;
      const matchups = MFLAPI.normalizeMatchups(r.value);
      matchups.forEach(m => {
        const hId = String(m.home?.teamId || "");
        const aId = String(m.away?.teamId || "");

        const iAmHome   = hId === myId   && aId === theirId;
        const iAmAway   = aId === myId   && hId === theirId;
        if (!iAmHome && !iAmAway) return;

        const myPts    = iAmHome ? m.home.score : m.away.score;
        const theirPts = iAmHome ? m.away.score : m.home.score;
        if (myPts === 0 && theirPts === 0) return; // unplayed week

        pf += myPts;
        pa += theirPts;
        if      (myPts > theirPts) wins++;
        else if (theirPts > myPts) losses++;
      });
    });

    return { wins, losses, pf, pa };
  }

  // ── Yahoo H2H ─────────────────────────────────────────────────────────────
  // Fetches the league bundle (allMatchups already included) and scans
  // regular-season weeks for matchups between the two team IDs.
  async function _h2hYahoo({ leagueId, season, myRosterId, theirRosterId, leagueKey_yahoo }) {
    const yahooKey = leagueKey_yahoo || `nfl.l.${leagueId}`;
    let bundle;
    try {
      bundle = await YahooAPI.getLeagueBundle(yahooKey);
    } catch(e) { return null; }

    const lm           = bundle.leagueMeta || {};
    const playoffStart = lm.playoff_start_week || 99;
    const allMatchups  = bundle.allMatchups || {};

    let wins = 0, losses = 0, pf = 0, pa = 0;
    const myId    = String(myRosterId);
    const theirId = String(theirRosterId);

    Object.entries(allMatchups).forEach(([weekStr, weekMus]) => {
      const week = parseInt(weekStr);
      if (week >= playoffStart) return; // regular season only

      (weekMus || []).forEach(m => {
        const hId = String(m.home?.teamId || "");
        const aId = String(m.away?.teamId || "");

        const iAmHome = hId === myId   && aId === theirId;
        const iAmAway = aId === myId   && hId === theirId;
        if (!iAmHome && !iAmAway) return;

        const myPts    = iAmHome ? (m.home?.score || 0) : (m.away?.score || 0);
        const theirPts = iAmHome ? (m.away?.score || 0) : (m.home?.score || 0);
        if (myPts === 0 && theirPts === 0) return; // unplayed

        pf += myPts;
        pa += theirPts;
        if      (myPts > theirPts) wins++;
        else if (theirPts > myPts) losses++;
      });
    });

    return { wins, losses, pf, pa };
  }

  // ── Patch H2H cell in place ───────────────────────────────────────────────
  function _patchH2HCell(displayKey, h2h, modal) {
    const cell = modal.querySelector(`#hl-h2h-${CSS.escape(displayKey)}`);
    if (!cell) return;

    if (!h2h || (h2h.wins === 0 && h2h.losses === 0 && h2h.pf === 0)) {
      cell.innerHTML = `<span style="font-size:.72rem;color:var(--color-text-dim)">—</span>`;
      return;
    }

    const pfStr = h2h.pf   > 0 ? h2h.pf.toFixed(1)  : null;
    const paStr = h2h.pa   > 0 ? h2h.pa.toFixed(1)   : null;
    const winColor = h2h.wins > h2h.losses
      ? "var(--color-green)"
      : h2h.losses > h2h.wins
        ? "var(--color-red)"
        : "var(--color-text-dim)";

    cell.innerHTML = `
      <div style="text-align:right">
        <div style="font-family:var(--font-display);font-weight:700;font-size:.85rem;color:${winColor}"
             title="Head-to-head record">
          H2H ${h2h.wins}–${h2h.losses}
        </div>
        ${pfStr && paStr ? `<div style="font-size:.68rem;color:var(--color-text-dim)">${pfStr}–${paStr} pts</div>` : ""}
      </div>`;
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
