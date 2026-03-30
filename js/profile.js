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
      sleeperUserId:   result.sleeperUserId,
      sleeperUsername: result.sleeperUsername,
      displayName:     result.displayName,
      avatar:          result.avatar
    });
    await GMDB.saveLeagues(gmdUsername, result.leagues);
    await GMDB.recomputeStats(gmdUsername);
    return result;
  }

  async function linkMFL(gmdUsername, mflUsername) {
    if (!mflUsername?.trim()) throw new Error("Enter your MFL username.");
    const result = await MFLAPI.importUserLeagues(mflUsername.trim());
    if (Object.keys(result.leagues).length === 0) {
      throw new Error(`No MFL leagues found for "${mflUsername}".`);
    }
    await GMDB.linkPlatform(gmdUsername, "mfl", { mflUsername: result.mflUsername });
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
    _renderLeagues("all");
  }

  function _renderStatsRow(stats) {
    const el = document.getElementById("locker-stats-row");
    if (!el) return;
    const totalGames = (stats.totalWins || 0) + (stats.totalLosses || 0);
    const winPct = totalGames > 0
      ? ((stats.totalWins / totalGames) * 100).toFixed(1) + "%"
      : "—";
    el.innerHTML = `
      <span class="locker-stat"><strong>${stats.totalWins || 0}W–${stats.totalLosses || 0}L</strong></span>
      <span class="locker-stat-sep">·</span>
      <span class="locker-stat">${winPct} win rate</span>
      <span class="locker-stat-sep">·</span>
      <span class="locker-stat">🏆 ${stats.championships || 0} titles</span>
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

  function _renderLeagueFilters() {
    // Collect custom labels and commish groups from meta
    const customLabels  = new Set();
    const commishGroups = new Set();

    Object.values(_leagueMeta).forEach(m => {
      if (m.customLabel)  customLabels.add(m.customLabel);
      if (m.commishGroup) commishGroups.add(m.commishGroup);
    });

    // Build dynamic filter buttons after the static ones
    const filterBar = document.getElementById("league-filters");
    if (!filterBar) return;

    // Remove any previously added dynamic filters
    filterBar.querySelectorAll(".filter-tab--dynamic").forEach(el => el.remove());

    // Add custom labels
    customLabels.forEach(label => {
      const btn = document.createElement("button");
      btn.className = "filter-tab filter-tab--dynamic";
      btn.dataset.filter = `label:${label}`;
      btn.textContent = `🏷 ${label}`;
      filterBar.insertBefore(btn, filterBar.querySelector(".filter-divider"));
    });

    // Add commish groups
    commishGroups.forEach(group => {
      const btn = document.createElement("button");
      btn.className = "filter-tab filter-tab--dynamic";
      btn.dataset.filter = `group:${group}`;
      btn.textContent = `⚡ ${group}`;
      filterBar.insertBefore(btn, filterBar.querySelector(".filter-divider"));
    });

    // Wire up all filter tabs
    filterBar.querySelectorAll(".filter-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        filterBar.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        _activeFilter = tab.dataset.filter;
        _renderLeagues(_activeFilter);
      });
    });
  }

  // ── League grid rendering ──────────────────────────────

  function _renderLeagues(filter) {
    const grid         = document.getElementById("leagues-grid");
    const archivedSec  = document.getElementById("archived-section");
    const archivedGrid = document.getElementById("archived-grid");
    const archivedCount= document.getElementById("archived-count");
    if (!grid) return;

    const entries = Object.entries(_allLeagues);
    if (entries.length === 0) {
      grid.innerHTML = `<p class="empty-state">No leagues imported yet.</p>`;
      if (archivedSec) archivedSec.classList.add("hidden");
      return;
    }

    // Split active vs archived
    const active   = [];
    const archived = [];

    entries.forEach(([key, league]) => {
      const meta       = _leagueMeta[key] || {};
      const isArchived = meta.archived || league.season !== CURRENT_SEASON;
      if (isArchived) {
        archived.push([key, league, meta]);
      } else {
        active.push([key, league, meta]);
      }
    });

    // Apply filter to active leagues
    const filtered = _applyFilter(active, filter);

    // Sort: pinned first, then by season desc
    filtered.sort((a, b) => {
      const aPinned = a[2].pinned ? 1 : 0;
      const bPinned = b[2].pinned ? 1 : 0;
      if (bPinned !== aPinned) return bPinned - aPinned;
      return (b[1].season || "0").localeCompare(a[1].season || "0");
    });

    if (filter === "archived") {
      grid.innerHTML = "";
      if (archivedSec) archivedSec.classList.add("hidden");
      if (archived.length === 0) {
        grid.innerHTML = `<p class="empty-state">No archived leagues.</p>`;
      } else {
        grid.innerHTML = archived.map(([key, league, meta]) =>
          _leagueCardHTML(key, league, meta, true)
        ).join("");
        _wireCardEvents(grid);
      }
      return;
    }

    // Active grid
    if (filtered.length === 0) {
      grid.innerHTML = `<p class="empty-state">No leagues match this filter.</p>`;
    } else {
      grid.innerHTML = filtered.map(([key, league, meta]) =>
        _leagueCardHTML(key, league, meta, false)
      ).join("");
      _wireCardEvents(grid);
    }

    // Archived section
    if (archived.length > 0) {
      if (archivedSec) archivedSec.classList.remove("hidden");
      if (archivedCount) archivedCount.textContent = `${archived.length}`;
      if (archivedGrid) {
        archivedGrid.innerHTML = archived.map(([key, league, meta]) =>
          _leagueCardHTML(key, league, meta, true)
        ).join("");
        _wireCardEvents(archivedGrid);
      }
    } else {
      if (archivedSec) archivedSec.classList.add("hidden");
    }
  }

  function _applyFilter(entries, filter) {
    if (filter === "all" || filter === "archived") return entries;
    if (filter === "active")      return entries.filter(([,l]) => l.season === CURRENT_SEASON);
    if (filter === "pinned")      return entries.filter(([k]) => _leagueMeta[k]?.pinned);
    if (filter === "dynasty")     return entries.filter(([,l]) => l.leagueType === "dynasty");
    if (filter === "redraft")     return entries.filter(([,l]) => l.leagueType === "redraft");
    if (filter === "keeper")      return entries.filter(([,l]) => l.leagueType === "keeper");
    if (filter === "commissioner")return entries.filter(([,l]) => l.isCommissioner);
    if (filter.startsWith("label:")) {
      const label = filter.slice(6);
      return entries.filter(([k]) => _leagueMeta[k]?.customLabel === label);
    }
    if (filter.startsWith("group:")) {
      const group = filter.slice(6);
      return entries.filter(([k]) => _leagueMeta[k]?.commishGroup === group);
    }
    return entries;
  }

  // ── League card HTML ───────────────────────────────────

  function _leagueCardHTML(key, league, meta, isArchived) {
    const pinned    = meta.pinned    ? "league-card--pinned" : "";
    const archived  = isArchived     ? "league-card--archived" : "";
    const champion  = league.isChampion ? "league-card--champion" : "";
    const label     = meta.customLabel  ? `<span class="league-tag league-tag--label">🏷 ${_escHtml(meta.customLabel)}</span>` : "";
    const group     = meta.commishGroup ? `<span class="league-tag league-tag--group">⚡ ${_escHtml(meta.commishGroup)}</span>` : "";
    const pinnedBadge = meta.pinned    ? `<span class="league-pin-badge">📌</span>` : "";
    const commishBadge = league.isCommissioner
      ? `<span class="league-tag league-tag--commish">👑 Commish</span>` : "";
    const wins   = league.wins   || 0;
    const losses = league.losses || 0;
    const ties   = league.ties   || 0;

    return `
      <div class="league-card ${pinned} ${archived} ${champion}" data-key="${key}">
        <div class="league-card-header">
          <span class="league-platform-tag league-platform-tag--${league.platform}">${(league.platform||"").toUpperCase()}</span>
          <span class="league-season">${league.season || ""}</span>
          ${league.isChampion ? `<span class="champion-badge">🏆</span>` : ""}
          ${pinnedBadge}
          <button class="league-options-btn" data-key="${key}" title="Options">⋯</button>
        </div>
        <div class="league-card-name">${_escHtml(league.leagueName)}</div>
        <div class="league-card-team">${_escHtml(league.teamName || "")}</div>
        <div class="league-tags-row">
          ${commishBadge}${label}${group}
          <span class="league-tag league-tag--type">${league.leagueType || "redraft"}</span>
        </div>
        <div class="league-card-record">
          <span class="record-wins">${wins}W</span>
          <span class="record-sep">–</span>
          <span class="record-losses">${losses}L</span>
          ${ties ? `<span class="record-sep">–</span><span class="record-ties">${ties}T</span>` : ""}
          ${league.standing ? `<span class="record-rank">&nbsp;· #${league.standing}/${league.totalTeams}</span>` : ""}
        </div>
        ${league.pointsFor ? `
        <div class="league-card-pts">
          <span>${parseFloat(league.pointsFor).toFixed(1)} PF</span>
          <span class="pts-sep">·</span>
          <span>${parseFloat(league.pointsAgainst || 0).toFixed(1)} PA</span>
        </div>` : ""}
        <div class="league-card-footer">
          <button class="league-chat-btn" data-key="${key}" title="League Chat">💬 Chat</button>
        </div>
      </div>
    `;
  }

  function _wireCardEvents(container) {
    container.querySelectorAll(".league-card").forEach(card => {
      const key = card.dataset.key;
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

  // ── League chat ────────────────────────────────────────────

  function openLeagueChat(leagueKey, leagueName) {
    const panel    = document.getElementById("chat-panel");
    const backdrop = document.getElementById("chat-panel-backdrop");
    const title    = document.getElementById("chat-panel-title");
    if (!panel) return;
    if (title) title.textContent = leagueName || "League Chat";
    panel.classList.remove("hidden");
    if (backdrop) backdrop.classList.remove("hidden");
    DLRChat.init(leagueKey, leagueName);
  }

  function closeLeagueChat() {
    document.getElementById("chat-panel")?.classList.add("hidden");
    document.getElementById("chat-panel-backdrop")?.classList.add("hidden");
    DLRChat.unsubscribe();
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
    openLeagueChat,
    closeLeagueChat
  };

})();
