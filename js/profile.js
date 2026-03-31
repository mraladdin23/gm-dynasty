// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Profile Module
//  League rendering, filter system, archive/active split,
//  commissioner badges, pinning, custom labels, edit profile.
// ─────────────────────────────────────────────────────────

const Profile = (() => {

  const CURRENT_SEASON = new Date().getFullYear().toString();
  let _activeFilter    = "all";
  let _allLeagues      = {};   // { leagueKey: leagueData }
  let _leagueMeta      = {};   // { leagueKey: { pinned, archived, customLabel, commishGroup } }
  let _currentUsername = null;

  // ── Platform linking ───────────────────────────────────

  async function linkSleeper(gmdUsername, sleeperUsername) {
    if (!sleeperUsername?.trim()) throw new Error("Enter your Sleeper username.");
    const result = await SleeperAPI.importUserLeagues(sleeperUsername.trim());
    if (Object.keys(result.leagues).length === 0) {
      throw new Error(`No leagues found for Sleeper user "${sleeperUsername}".`);
    }
    await GMDB.linkPlatform(gmdUsername, "sleeper", {
      sleeperUserId:    result.sleeperUserId,
      sleeperUsername:  result.sleeperUsername,
      displayName:      result.displayName,
      avatar:           result.avatar,
      mostRecentSeason: result.mostRecentSeason
    });
    await GMDB.saveLeagues(gmdUsername, result.leagues);
    await GMDB.recomputeStats(gmdUsername);
    return result;
  }

  async function linkMFL(gmdUsername, email, password, leagueIds = []) {
    if (!email?.trim()) throw new Error("Enter your MFL username.");
    const result = await MFLAPI.importUserLeagues(email.trim(), password?.trim() || "", leagueIds);
    if (Object.keys(result.leagues).length === 0) {
      throw new Error("No MFL leagues found. Add your league IDs (from the MFL URL) to the League IDs field.");
    }
    await GMDB.linkPlatform(gmdUsername, "mfl", {
      mflEmail:    email.trim(),
      mflUsername: result.mflUsername
    });
    await GMDB.saveLeagues(gmdUsername, result.leagues);
    await GMDB.recomputeStats(gmdUsername);
    return result;
  }

  // ── League meta (pins, labels, archive) ───────────────

  async function loadLeagueMeta(username) {
    try {
      const data = await GMDB._restGet(`gmd/users/${username.toLowerCase()}/leagueMeta`);
      _leagueMeta = data || {};
    } catch (_) {
      _leagueMeta = {};
    }
  }

  async function saveLeagueMeta(username, leagueKey, meta) {
    _leagueMeta[leagueKey] = { ...(_leagueMeta[leagueKey] || {}), ...meta };
    await GMDB._restPut(
      `gmd/users/${username.toLowerCase()}/leagueMeta/${leagueKey}`,
      _leagueMeta[leagueKey]
    );
  }

  // ── Main locker render ─────────────────────────────────

  async function renderLocker(profile) {
    if (!profile) return;
    _currentUsername = profile.username;
    _allLeagues      = profile.leagues || {};

    await loadLeagueMeta(profile.username);

    document.getElementById("locker-display-name").textContent = profile.username;
    document.getElementById("nav-username").textContent = "@" + profile.username;

    if (profile.bio) {
      document.getElementById("locker-tagline").textContent = profile.bio;
    }

    _renderStatsRow(profile.stats || {});
    _renderPlatformsBadges(profile.platforms || {});
    _renderLeagueFilters();
    _renderLeagues();
  }

  function _renderStatsRow(stats) {
    const el = document.getElementById("locker-stats-row");
    if (!el) return;
    const totalGames = (stats.totalWins || 0) + (stats.totalLosses || 0);
    const winPct = totalGames > 0
      ? ((stats.totalWins / totalGames) * 100).toFixed(1) + "%"
      : "—";
    const trophies = [
      stats.championships > 0 ? `🏆 ${stats.championships}` : null,
      stats.runnerUps     > 0 ? `🥈 ${stats.runnerUps}`     : null,
      stats.thirdPlace    > 0 ? `🥉 ${stats.thirdPlace}`     : null,
    ].filter(Boolean).join(" ");
    el.innerHTML = `
      <span class="locker-stat"><strong>${stats.totalWins || 0}W–${stats.totalLosses || 0}L</strong></span>
      <span class="locker-stat-sep">·</span>
      <span class="locker-stat">${winPct} win rate</span>
      ${trophies ? `<span class="locker-stat-sep">·</span><span class="locker-stat">${trophies}</span>` : ""}
      <span class="locker-stat-sep">·</span>
      <span class="locker-stat">⭐ ${stats.dynastyScore || 0} pts</span>
    `;
  }

  function _renderPlatformsBadges(platforms) {
    const container = document.getElementById("platforms-list");
    if (!container) return;
    const connected = Object.entries(platforms).filter(([, p]) => p.linked);
    if (connected.length === 0) {
      container.innerHTML = `<p class="empty-state">No platforms connected. <a href="#" id="link-platforms-btn">Link leagues →</a></p>`;
      document.getElementById("link-platforms-btn")?.addEventListener("click", e => {
        e.preventDefault();
        AppState.showOnboarding();
      });
      return;
    }
    container.innerHTML = connected.map(([platform, data]) => `
      <div class="platform-badge">
        <span class="platform-badge-name">${_platformLabel(platform)}</span>
        <span class="platform-badge-user">${_platformUser(platform, data)}</span>
      </div>
    `).join("");
  }

  // ── Filter bar ─────────────────────────────────────────
  // Filters are multi-select — clicking toggles them, "All" clears all
  let _activeFilters = new Set(); // empty = show all

  function _renderLeagueFilters() {
    const customLabels  = new Set();
    const commishGroups = new Set();
    Object.values(_leagueMeta).forEach(m => {
      if (m.customLabel)  customLabels.add(m.customLabel);
      if (m.commishGroup) commishGroups.add(m.commishGroup);
    });

    const filterBar = document.getElementById("league-filters");
    if (!filterBar) return;

    // Rebuild entire filter bar so multi-select wiring is clean
    filterBar.innerHTML = `
      <button class="filter-tab active" data-filter="all">All</button>
      <button class="filter-tab" data-filter="active">Active</button>
      <button class="filter-tab" data-filter="owner">🏈 Owner</button>
      <button class="filter-tab" data-filter="pinned">📌 Pinned</button>
      <button class="filter-tab" data-filter="dynasty">Dynasty</button>
      <button class="filter-tab" data-filter="redraft">Redraft</button>
      <button class="filter-tab" data-filter="keeper">Keeper</button>
      <button class="filter-tab" data-filter="commissioner">👑 Commish</button>
      <div class="filter-divider"></div>
      <button class="filter-tab" data-filter="archived">📦 Archived</button>
    `;

    // Add dynamic label/group filters before the divider
    customLabels.forEach(label => {
      const btn = document.createElement("button");
      btn.className = "filter-tab filter-tab--dynamic";
      btn.dataset.filter = `label:${label}`;
      btn.textContent = `🏷 ${label}`;
      filterBar.insertBefore(btn, filterBar.querySelector(".filter-divider"));
    });
    commishGroups.forEach(group => {
      const btn = document.createElement("button");
      btn.className = "filter-tab filter-tab--dynamic";
      btn.dataset.filter = `group:${group}`;
      btn.textContent = `⚡ ${group}`;
      filterBar.insertBefore(btn, filterBar.querySelector(".filter-divider"));
    });

    // Multi-select wiring
    filterBar.querySelectorAll(".filter-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        const f = tab.dataset.filter;
        if (f === "all") {
          // Clear all active filters
          _activeFilters.clear();
          filterBar.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
          tab.classList.add("active");
        } else if (f === "archived") {
          // Archived is exclusive — clears others
          _activeFilters.clear();
          _activeFilters.add("archived");
          filterBar.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
          tab.classList.add("active");
        } else {
          // Toggle this filter
          filterBar.querySelector('[data-filter="all"]')?.classList.remove("active");
          filterBar.querySelector('[data-filter="archived"]')?.classList.remove("active");
          _activeFilters.delete("archived");

          if (_activeFilters.has(f)) {
            _activeFilters.delete(f);
            tab.classList.remove("active");
          } else {
            _activeFilters.add(f);
            tab.classList.add("active");
          }

          // If nothing selected, reset to "All"
          if (_activeFilters.size === 0) {
            filterBar.querySelector('[data-filter="all"]')?.classList.add("active");
          }
        }
        _renderLeagues();
      });
    });
  }

  // ── League grid rendering ──────────────────────────────

  // Group all league seasons into franchises using prev_league_id lineage.
  // Sleeper import stores franchiseId = oldest leagueId in the chain.
  // All seasons with the same franchiseId belong to one franchise card.
  // Seasons without franchiseId (old imports) show as individual cards.
  function _buildFranchises() {
    const franchises = {};

    Object.entries(_allLeagues).forEach(([key, league]) => {
      // Use franchiseId if present (set during import via prev_league_id chain)
      // Fall back to the league's own key so it shows as a solo card
      const fid = league.franchiseId || key;

      if (!franchises[fid]) {
        franchises[fid] = { franchiseId: fid, seasons: [], latestKey: key };
      }

      franchises[fid].seasons.push({ key, league, meta: _leagueMeta[key] || {} });
    });

    // For each franchise, sort seasons newest first and set latestKey
    Object.values(franchises).forEach(f => {
      f.seasons.sort((a, b) =>
        (b.league.season || "0").localeCompare(a.league.season || "0")
      );
      f.latestKey = f.seasons[0].key;
    });

    return franchises;
  }

  function _renderLeagues() {
    const grid         = document.getElementById("leagues-grid");
    const archivedSec  = document.getElementById("archived-section");
    const archivedGrid = document.getElementById("archived-grid");
    const archivedCount= document.getElementById("archived-count");
    if (!grid) return;

    const allEntries = Object.entries(_allLeagues);
    if (allEntries.length === 0) {
      grid.innerHTML = `<p class="empty-state">No leagues imported yet.</p>`;
      if (archivedSec) archivedSec.classList.add("hidden");
      return;
    }

    // Build franchise groups
    const franchises = _buildFranchises();
    const franchiseList = Object.values(franchises);

    // Determine the most recent season present in the data
    // (may be 2025 even though calendar year is 2026 if no leagues started yet)
    const allSeasons = Object.values(_allLeagues).map(l => l.season).filter(Boolean);
    const newestSeason = allSeasons.length
      ? allSeasons.reduce((a, b) => a > b ? a : b)
      : CURRENT_SEASON;

    // For each franchise, determine if active or archived
    const active   = [];
    const archived = [];

    franchiseList.forEach(f => {
      const latestLeague = _allLeagues[f.latestKey];
      const meta         = _leagueMeta[f.latestKey] || {};
      // Active = has a season matching the newest season in the data
      const hasCurrentSeason = f.seasons.some(s => s.league.season === newestSeason);
      const isArchived = meta.archived || !hasCurrentSeason;

      if (isArchived) {
        archived.push(f);
      } else {
        active.push(f);
      }
    });

    // Apply multi-select filters
    const isArchived = _activeFilters.has("archived");
    const filtered = isArchived ? [] : _applyFranchiseFilter(active);

    // Sort: pinned first, then by latest season desc
    filtered.sort((a, b) => {
      const aPinned = (_leagueMeta[a.latestKey]?.pinned) ? 1 : 0;
      const bPinned = (_leagueMeta[b.latestKey]?.pinned) ? 1 : 0;
      if (bPinned !== aPinned) return bPinned - aPinned;
      return (_allLeagues[b.latestKey]?.season || "0").localeCompare(_allLeagues[a.latestKey]?.season || "0");
    });

    if (isArchived) {
      grid.innerHTML = "";
      if (archivedSec) archivedSec.classList.add("hidden");
      if (archived.length === 0) {
        grid.innerHTML = `<p class="empty-state">No archived leagues.</p>`;
      } else {
        grid.innerHTML = archived.map(f => _franchiseCardHTML(f)).join("");
        _wireCardEvents(grid);
      }
      return;
    }

    if (filtered.length === 0) {
      grid.innerHTML = `<p class="empty-state">No leagues match this filter.</p>`;
    } else {
      grid.innerHTML = filtered.map(f => _franchiseCardHTML(f)).join("");
      _wireCardEvents(grid);
    }

    // Archived accordion
    if (archived.length > 0) {
      if (archivedSec) archivedSec.classList.remove("hidden");
      if (archivedCount) archivedCount.textContent = `${archived.length}`;
      if (archivedGrid) {
        archivedGrid.innerHTML = archived.map(f => _franchiseCardHTML(f, true)).join("");
        _wireCardEvents(archivedGrid);
      }
    } else {
      if (archivedSec) archivedSec.classList.add("hidden");
    }
  }

  function _applyFranchiseFilter(franchises) {
    if (_activeFilters.size === 0) return franchises;
    return franchises.filter(f => {
      // Franchise passes if it matches ALL active filters
      return [..._activeFilters].every(filter => _franchiseMatchesFilter(f, filter));
    });
  }

  function _franchiseMatchesFilter(f, filter) {
    const latest = _allLeagues[f.latestKey];
    const meta   = _leagueMeta[f.latestKey] || {};
    // Determine the most recent season in the data
    const allSeasons = Object.values(_allLeagues).map(l => l.season).filter(Boolean);
    const newestSeason = allSeasons.length ? allSeasons.reduce((a, b) => a > b ? a : b) : CURRENT_SEASON;

    switch(filter) {
      case "active":       return f.seasons.some(s => s.league.season === newestSeason);
      case "owner":        return f.seasons.some(s => s.league.wins > 0 || s.league.losses > 0 || s.league.ties > 0 || (s.league.pointsFor > 0));
      case "pinned":       return !!meta.pinned;
      case "dynasty":      return latest?.leagueType === "dynasty";
      case "redraft":      return latest?.leagueType === "redraft";
      case "keeper":       return latest?.leagueType === "keeper";
      case "commissioner": return f.seasons.some(s => s.league.isCommissioner);
      default:
        if (filter.startsWith("label:")) return meta.customLabel === filter.slice(6);
        if (filter.startsWith("group:")) return meta.commishGroup === filter.slice(6);
        return true;
    }
  }

  // ── Franchise card HTML ────────────────────────────────

  function _franchiseCardHTML(franchise, isArchived = false) {
    const key      = franchise.latestKey;
    const league   = _allLeagues[key];
    const meta     = _leagueMeta[key] || {};
    const seasons  = franchise.seasons;

    if (!league) return "";

    // Aggregate career stats across all seasons of this franchise
    const totalWins   = seasons.reduce((s, x) => s + (x.league.wins   || 0), 0);
    const totalLosses = seasons.reduce((s, x) => s + (x.league.losses || 0), 0);
    const titles      = seasons.filter(x => x.league.playoffFinish === 1 || x.league.isChampion).length;
    const runnerUps   = seasons.filter(x => x.league.playoffFinish === 2).length;
    const isCommish   = seasons.some(x => x.league.isCommissioner);

    const pinned      = meta.pinned       ? "league-card--pinned"   : "";
    const archivedCls = isArchived        ? "league-card--archived" : "";
    const champCls    = titles > 0        ? "league-card--champion" : "";
    const pinnedBadge = meta.pinned       ? `<span class="league-pin-badge">📌</span>` : "";
    const label       = meta.customLabel  ? `<span class="league-tag league-tag--label">🏷 ${_escHtml(meta.customLabel)}</span>` : "";
    const group       = meta.commishGroup ? `<span class="league-tag league-tag--group">⚡ ${_escHtml(meta.commishGroup)}</span>` : "";
    const commishBadge = isCommish        ? `<span class="league-tag league-tag--commish">👑 Commish</span>` : "";

    // Season pills — show each season, highlight current
    const seasonPills = seasons.slice(0, 6).map(s => {
      const isCurrent = s.league.season === CURRENT_SEASON;
      const finish    = s.league.playoffFinish;
      const icon      = { 1:"🏆", 2:"🥈", 3:"🥉" }[finish] || "";
      return `<span class="season-pill ${isCurrent ? "season-pill--current" : ""}" 
        data-key="${s.key}" title="${s.league.season}: ${s.league.wins}W–${s.league.losses}L${icon ? " "+icon : ""}">
        ${s.league.season}${icon}
      </span>`;
    }).join("");

    const moreSeasons = seasons.length > 6 ? `<span class="season-pill season-pill--more">+${seasons.length - 6}</span>` : "";

    return `
      <div class="league-card ${pinned} ${archivedCls} ${champCls}" data-key="${key}">
        <div class="league-card-header">
          <span class="league-platform-tag league-platform-tag--${league.platform}">${(league.platform||"").toUpperCase()}</span>
          ${pinnedBadge}
          ${titles > 0 ? `<span class="champion-badge">🏆 ×${titles}</span>` : ""}
          <button class="league-options-btn" data-key="${key}" title="Options">⋯</button>
        </div>
        <div class="league-card-name">${_escHtml(league.leagueName)}</div>
        <div class="league-card-team">${_escHtml(league.teamName || "")}</div>
        <div class="league-tags-row">
          ${commishBadge}${label}${group}
          <span class="league-tag league-tag--type">${league.leagueType || "redraft"}</span>
          <span class="league-tag" style="background:var(--color-surface);color:var(--color-text-dim);">${seasons.length} seasons</span>
        </div>
        <div class="league-card-record">
          <span class="record-wins">${totalWins}W</span>
          <span class="record-sep">–</span>
          <span class="record-losses">${totalLosses}L</span>
          <span class="record-rank"> all-time</span>
          ${runnerUps > 0 ? `<span class="record-rank"> · 🥈×${runnerUps}</span>` : ""}
        </div>
        <div class="season-pills-row">
          ${seasonPills}${moreSeasons}
        </div>
        <div class="league-card-footer">
          <button class="league-chat-btn" data-key="${key}" title="League Chat">💬 Chat</button>
        </div>
      </div>
    `;
  }

  // Keep old _leagueCardHTML for detail panel use
  function _leagueCardHTML(key, league, meta, isArchived) {
    return _franchiseCardHTML({ latestKey: key, seasons: [{ key, league, meta }] }, isArchived);
  }

  function _wireCardEvents(container) {
    container.querySelectorAll(".league-card").forEach(card => {
      const key = card.dataset.key;

      // Click card body → open detail panel
      card.addEventListener("click", e => {
        if (e.target.closest(".league-options-btn") || e.target.closest(".league-chat-btn")) return;
        openLeagueDetail(key);
      });

      // Drag to reorder
      card.draggable = true;
      card.addEventListener("dragstart", e => LeagueGroups.onLeagueDragStart(e, key));
      card.addEventListener("dragend",   e => LeagueGroups.onLeagueDragEnd(e));
      card.addEventListener("dragover",  e => LeagueGroups.onLeagueDragOver(e));
      card.addEventListener("dragleave", e => LeagueGroups.onLeagueDragLeave(e));
      card.addEventListener("drop",      e => LeagueGroups.onLeagueDrop(e, key));

      // Chat button
      card.querySelector(".league-chat-btn")?.addEventListener("click", e => {
        e.stopPropagation();
        openLeagueChat(key, _allLeagues[key]?.leagueName);
      });
    });

    container.querySelectorAll(".league-options-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        openLeagueLabelModal(btn.dataset.key);
      });
    });
  }

  // ── League label modal ─────────────────────────────────

  function openLeagueLabelModal(leagueKey) {
    const league = _allLeagues[leagueKey];
    const meta   = _leagueMeta[leagueKey] || {};
    if (!league) return;

    document.getElementById("label-league-name").textContent = league.leagueName;
    document.getElementById("label-custom-input").value  = meta.customLabel  || "";
    document.getElementById("label-commish-input").value = meta.commishGroup || "";
    document.getElementById("label-pin-check").checked   = !!meta.pinned;
    document.getElementById("label-archive-check").checked = !!meta.archived;

    document.getElementById("label-modal-save").onclick = async () => {
      await saveLeagueMeta(_currentUsername, leagueKey, {
        customLabel:  document.getElementById("label-custom-input").value.trim(),
        commishGroup: document.getElementById("label-commish-input").value.trim(),
        pinned:       document.getElementById("label-pin-check").checked,
        archived:     document.getElementById("label-archive-check").checked
      });
      closeLabelModal();
      _renderLeagueFilters();
      _renderLeagues(_activeFilter);
      showToast("League updated ✓");
    };

    document.getElementById("league-label-modal").classList.remove("hidden");
  }

  function closeLabelModal() {
    document.getElementById("league-label-modal").classList.add("hidden");
  }

  // ── Edit profile modal ─────────────────────────────────

  function openEditProfileModal(profile) {
    document.getElementById("edit-bio").value =
      profile.bio || "";
    document.getElementById("edit-nfl-team").value =
      profile.favoriteNflTeam || "";
    document.getElementById("edit-visibility").value =
      profile.visibility?.profile || "public";

    // Show linked usernames
    const sleeper = profile.platforms?.sleeper;
    const mfl     = profile.platforms?.mfl;
    document.getElementById("sleeper-linked-user").textContent =
      sleeper?.sleeperUsername ? `@${sleeper.sleeperUsername}` : "Not connected";
    document.getElementById("mfl-linked-user").textContent =
      mfl?.mflUsername ? `@${mfl.mflUsername}` : "Not connected";

    document.getElementById("edit-profile-modal").classList.remove("hidden");
  }

  function closeEditProfileModal() {
    document.getElementById("edit-profile-modal").classList.add("hidden");
  }

  async function saveProfileEdits(username) {
    const updates = {
      bio:             document.getElementById("edit-bio").value.trim(),
      favoriteNflTeam: document.getElementById("edit-nfl-team").value,
      "visibility/profile": document.getElementById("edit-visibility").value
    };
    await GMDB.updateUser(username, updates);
    // Update displayed tagline immediately
    if (updates.bio) {
      document.getElementById("locker-tagline").textContent = updates.bio;
    }
    closeEditProfileModal();
  }

  // ── Onboarding league preview ──────────────────────────

  function renderLeaguePreview(containerId, leagues) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const entries = Object.values(leagues);
    if (entries.length === 0) {
      container.innerHTML = `<p class="preview-empty">No leagues found.</p>`;
    } else {
      container.innerHTML = `
        <p class="preview-count">✓ ${entries.length} league${entries.length !== 1 ? "s" : ""} found</p>
        <ul class="preview-list">
          ${entries.slice(0, 5).map(l => `
            <li>${_escHtml(l.leagueName)}
              <span class="preview-season">${l.season}</span>
              ${l.isChampion ? " 🏆" : ""}
            </li>
          `).join("")}
          ${entries.length > 5 ? `<li class="preview-more">+ ${entries.length - 5} more</li>` : ""}
        </ul>
      `;
    }
    container.classList.remove("hidden");
  }

  // ── Archive toggle ─────────────────────────────────────

  function initArchivedToggle() {
    document.getElementById("archived-toggle")?.addEventListener("click", () => {
      const grid    = document.getElementById("archived-grid");
      const chevron = document.querySelector(".archived-chevron");
      const isHidden = grid?.classList.toggle("hidden");
      if (chevron) chevron.textContent = isHidden ? "▼" : "▲";
    });
  }

  // ── Helpers ────────────────────────────────────────────

  function _platformLabel(p) { return { sleeper: "Sleeper", mfl: "MFL" }[p] || p; }
  function _platformUser(p, d) {
    if (p === "sleeper") return d.sleeperUsername || d.displayName || "";
    if (p === "mfl")     return d.mflUsername || "";
    return "";
  }
  function _escHtml(str) {
    return String(str || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ── League detail panel ────────────────────────────────────

  let _detailLeagueKey = null;
  let _detailActiveTab = "overview";

  function openLeagueDetail(leagueKey) {
    const league = _allLeagues[leagueKey];
    if (!league) return;
    _detailLeagueKey = leagueKey;

    // Header
    document.getElementById("detail-league-name").textContent = league.leagueName;
    document.getElementById("detail-league-meta").innerHTML = `
      <span class="league-platform-tag league-platform-tag--${league.platform}">${(league.platform||"").toUpperCase()}</span>
      <span style="color:var(--color-text-dim);font-size:.82rem;">${league.season} · ${league.leagueType} · ${league.totalTeams} teams</span>
      ${league.isCommissioner ? '<span class="league-tag league-tag--commish">👑 Commish</span>' : ""}
    `;

    // Show panel
    document.getElementById("league-detail-panel").classList.remove("hidden");
    document.getElementById("league-detail-backdrop").classList.remove("hidden");

    // Wire tabs
    document.querySelectorAll(".detail-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".detail-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".detail-tab-content").forEach(c => c.classList.remove("active"));
        tab.classList.add("active");
        const name = tab.dataset.dtab;
        document.getElementById(`dtab-${name}`)?.classList.add("active");
        _detailActiveTab = name;
        _renderDetailTab(name, leagueKey, league);
      });
    });

    // Render default tab
    _renderDetailTab("overview", leagueKey, league);
  }

  function closeLeagueDetail() {
    document.getElementById("league-detail-panel")?.classList.add("hidden");
    document.getElementById("league-detail-backdrop")?.classList.add("hidden");
    DLRChat.unsubscribe();
    _detailLeagueKey = null;
  }

  function _renderDetailTab(tab, leagueKey, league) {
    const el = document.getElementById(`dtab-${tab}`);
    if (!el) return;
    if (tab === "overview")   _renderOverview(el, leagueKey, league);
    if (tab === "history")    _renderHistory(el, leagueKey, league);
    if (tab === "standings")  DLRStandings.init(league.leagueId, league);
    if (tab === "matchups")   DLRStandings.initMatchups();
    if (tab === "playoffs")   DLRStandings.initPlayoffs();
    if (tab === "chat")       _renderChat(el, leagueKey, league);
  }

  function _renderOverview(el, leagueKey, league) {
    const finish      = league.playoffFinish;
    const finishLabel = { 1:"🏆 Champion", 2:"🥈 Runner-Up", 3:"🥉 3rd Place", 4:"4th Place", 5:"Made Playoffs" }[finish] || "Missed Playoffs";
    const finishColor = { 1:"var(--color-gold)", 2:"#94a3b8", 3:"#cd7f32" }[finish] || "var(--color-text-dim)";

    el.innerHTML = `
      <div class="detail-stats-grid">
        <div class="detail-stat">
          <div class="detail-stat-val">${league.wins || 0}–${league.losses || 0}${league.ties ? `–${league.ties}` : ""}</div>
          <div class="detail-stat-lbl">Record</div>
        </div>
        <div class="detail-stat">
          <div class="detail-stat-val">#${league.standing || "—"}</div>
          <div class="detail-stat-lbl">Standing</div>
        </div>
        <div class="detail-stat">
          <div class="detail-stat-val">${league.pointsFor ? parseFloat(league.pointsFor).toFixed(1) : "—"}</div>
          <div class="detail-stat-lbl">Points For</div>
        </div>
        <div class="detail-stat">
          <div class="detail-stat-val">${league.pointsAgainst ? parseFloat(league.pointsAgainst).toFixed(1) : "—"}</div>
          <div class="detail-stat-lbl">Points Against</div>
        </div>
      </div>
      <div class="detail-finish" style="border-color:${finishColor};color:${finishColor};">
        ${finishLabel}
      </div>
      <div class="detail-info-row">
        <span class="detail-info-label">Team Name</span>
        <span>${_escHtml(league.teamName || "—")}</span>
      </div>
      <div class="detail-info-row">
        <span class="detail-info-label">League Type</span>
        <span style="text-transform:capitalize;">${league.leagueType || "redraft"}</span>
      </div>
      <div class="detail-info-row">
        <span class="detail-info-label">Commissioner</span>
        <span>${league.isCommissioner ? "👑 Yes" : "No"}</span>
      </div>
      ${league.franchiseId ? `
      <div class="detail-info-row">
        <span class="detail-info-label">Franchise ID</span>
        <span style="font-size:.78rem;color:var(--color-text-dim);">${league.franchiseId}</span>
      </div>` : ""}
    `;
  }

  function _renderHistory(el, leagueKey, league) {
    // Find all seasons of same franchise (same franchiseId)
    const franchiseId = league.franchiseId || league.leagueId;
    const allSeasons  = Object.entries(_allLeagues)
      .filter(([, l]) => l.franchiseId === franchiseId || l.leagueId === league.leagueId)
      .sort((a, b) => (b[1].season || "0").localeCompare(a[1].season || "0"));

    if (allSeasons.length <= 1) {
      el.innerHTML = `<p class="empty-state">Only one season found for this league. Re-import to pull full history via league lineage.</p>`;
      return;
    }

    el.innerHTML = `
      <div class="detail-history-list">
        ${allSeasons.map(([key, s]) => {
          const finish = s.playoffFinish;
          const icon   = { 1:"🏆", 2:"🥈", 3:"🥉" }[finish] || (finish ? "🏅" : "");
          const isCurrent = key === leagueKey;
          return `
            <div class="detail-history-row ${isCurrent ? "detail-history-row--current" : ""}">
              <span class="detail-history-season">${s.season}</span>
              <span class="detail-history-team">${_escHtml(s.teamName || "")}</span>
              <span class="detail-history-record">${s.wins}–${s.losses}</span>
              <span class="detail-history-finish">${icon} ${s.playoffResult || "—"}</span>
            </div>`;
        }).join("")}
      </div>
      <div class="detail-history-summary">
        <span>${allSeasons.length} seasons</span>
        <span>·</span>
        <span>${allSeasons.filter(([,s]) => s.playoffFinish === 1).length} titles</span>
        <span>·</span>
        <span>${(allSeasons.reduce((sum,[,s])=>sum+(s.wins||0),0))}W–${allSeasons.reduce((sum,[,s])=>sum+(s.losses||0),0)}L all-time</span>
      </div>
    `;
  }

  async function _renderStandings(el, leagueKey, league) {
    el.innerHTML = `<p class="empty-state" style="padding:var(--space-6);">Loading standings…</p>`;
    try {
      const standings = await SleeperAPI.getStandings(league.leagueId);
      if (!standings.length) {
        el.innerHTML = `<p class="empty-state">No standings available.</p>`;
        return;
      }
      el.innerHTML = `
        <div class="detail-standings">
          <div class="detail-standings-header">
            <span>#</span><span>Team</span><span>W–L</span><span>PF</span>
          </div>
          ${standings.map(s => `
            <div class="detail-standings-row ${s.userId === league.ownerId ? "detail-standings-row--me" : ""}">
              <span class="detail-rank">${s.rank}</span>
              <span class="detail-team-name">${_escHtml(s.teamName)}</span>
              <span class="detail-record">${s.wins}–${s.losses}</span>
              <span class="detail-pts">${s.ptsFor.toFixed(1)}</span>
            </div>`).join("")}
        </div>`;
    } catch(err) {
      el.innerHTML = `<p class="empty-state">Could not load standings: ${err.message}</p>`;
    }
  }

  function _renderChat(el, leagueKey, league) {
    // Chat is rendered in the dtab-chat container which has chat-panel-body inside
    DLRChat.init(leagueKey, league.leagueName);
  }

  function openLeagueChat(leagueKey, leagueName) {
    // Now opens league detail panel on chat tab instead of separate panel
    openLeagueDetail(leagueKey);
    // Switch to chat tab
    setTimeout(() => {
      document.querySelector('[data-dtab="chat"]')?.click();
    }, 50);
  }

  function closeLeagueChat() {
    closeLeagueDetail();
  }

  // ── Public API ─────────────────────────────────────────
  return {
    linkSleeper,
    linkMFL,
    renderLocker,
    renderLeaguePreview,
    openEditProfileModal,
    closeEditProfileModal,
    saveProfileEdits,
    openLeagueLabelModal,
    closeLabelModal,
    initArchivedToggle,
    openLeagueDetail,
    closeLeagueDetail,
    openLeagueChat,
    closeLeagueChat
  };

})();
