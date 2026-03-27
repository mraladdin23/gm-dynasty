// ─────────────────────────────────────────────────────────
//  GM Dynasty — Profile Module
//  Handles: platform linking UI, league import, profile rendering.
//  Sits between the API modules and the DOM.
// ─────────────────────────────────────────────────────────

const Profile = (() => {

  // ── Onboarding: link platforms ─────────────────────────

  /**
   * Link a Sleeper account for the current user.
   * Fetches leagues, saves platform + league data to Firebase.
   * Returns the import result for UI rendering.
   */
  async function linkSleeper(gmdUsername, sleeperUsername) {
    if (!sleeperUsername?.trim()) throw new Error("Enter your Sleeper username.");

    const result = await SleeperAPI.importUserLeagues(sleeperUsername.trim());

    if (Object.keys(result.leagues).length === 0) {
      throw new Error(`No leagues found for Sleeper user "${sleeperUsername}". Check the username and try again.`);
    }

    // Save platform link
    await GMDB.linkPlatform(gmdUsername, "sleeper", {
      sleeperUserId:   result.sleeperUserId,
      sleeperUsername: result.sleeperUsername,
      displayName:     result.displayName,
      avatar:          result.avatar
    });

    // Save leagues
    await GMDB.saveLeagues(gmdUsername, result.leagues);

    // Recompute career stats
    await GMDB.recomputeStats(gmdUsername);

    return result;
  }

  /**
   * Link an MFL account for the current user.
   */
  async function linkMFL(gmdUsername, mflUsername) {
    if (!mflUsername?.trim()) throw new Error("Enter your MFL username.");

    const result = await MFLAPI.importUserLeagues(mflUsername.trim());

    if (Object.keys(result.leagues).length === 0) {
      throw new Error(`No MFL leagues found for "${mflUsername}". Verify your username and that your leagues are public.`);
    }

    // Save platform link
    await GMDB.linkPlatform(gmdUsername, "mfl", {
      mflUsername: result.mflUsername
    });

    // Save leagues (merge — don't overwrite Sleeper leagues)
    await GMDB.saveLeagues(gmdUsername, result.leagues);

    // Recompute career stats
    await GMDB.recomputeStats(gmdUsername);

    return result;
  }

  // ── Locker rendering ───────────────────────────────────

  /**
   * Render the current user's locker with their profile data.
   */
  function renderLocker(profile) {
    if (!profile) return;

    // Identity
    const displayName = profile.username;
    document.getElementById("locker-display-name").textContent = displayName;
    document.getElementById("locker-avatar-initials").textContent =
      displayName.slice(0, 2).toUpperCase();
    document.getElementById("nav-username").textContent = "@" + displayName;

    if (profile.bio) {
      document.getElementById("locker-tagline").textContent = profile.bio;
    }

    // Platforms
    renderPlatformsSummary(profile.platforms || {});

    // Leagues
    renderLeaguesGrid(profile.leagues || {});
  }

  function renderPlatformsSummary(platforms) {
    const container = document.getElementById("platforms-list");
    if (!container) return;

    const connected = Object.entries(platforms).filter(([, p]) => p.linked);
    if (connected.length === 0) {
      container.innerHTML = `<p class="empty-state">No platforms connected yet. <a href="#" id="link-platforms-btn">Link your leagues →</a></p>`;
      document.getElementById("link-platforms-btn")?.addEventListener("click", e => {
        e.preventDefault();
        AppState.showOnboarding();
      });
      return;
    }

    container.innerHTML = connected.map(([platform, data]) => `
      <div class="platform-badge">
        <span class="platform-badge-name">${_platformLabel(platform)}</span>
        <span class="platform-badge-user">${_platformDisplayUser(platform, data)}</span>
      </div>
    `).join("");
  }

  function renderLeaguesGrid(leagues) {
    const grid = document.getElementById("leagues-grid");
    if (!grid) return;

    const entries = Object.entries(leagues);
    if (entries.length === 0) {
      grid.innerHTML = `<p class="empty-state">No leagues imported yet.</p>`;
      return;
    }

    // Sort: most recent season first
    entries.sort((a, b) => (b[1].season || "0").localeCompare(a[1].season || "0"));

    grid.innerHTML = entries.map(([key, league]) => `
      <div class="league-card ${league.isChampion ? "league-card--champion" : ""}">
        <div class="league-card-header">
          <span class="league-platform-tag league-platform-tag--${league.platform}">${league.platform.toUpperCase()}</span>
          <span class="league-season">${league.season}</span>
          ${league.isChampion ? `<span class="champion-badge">🏆 Champion</span>` : ""}
        </div>
        <div class="league-card-name">${_escHtml(league.leagueName)}</div>
        <div class="league-card-team">${_escHtml(league.teamName)}</div>
        <div class="league-card-record">
          <span class="record-wins">${league.wins}W</span>
          <span class="record-sep">–</span>
          <span class="record-losses">${league.losses}L</span>
          ${league.ties ? `<span class="record-sep">–</span><span class="record-ties">${league.ties}T</span>` : ""}
          ${league.standing ? `<span class="record-rank">&nbsp;· #${league.standing} of ${league.totalTeams}</span>` : ""}
        </div>
        ${league.pointsFor ? `
        <div class="league-card-pts">
          <span>${parseFloat(league.pointsFor).toFixed(1)} PF</span>
          <span class="pts-sep">|</span>
          <span>${parseFloat(league.pointsAgainst).toFixed(1)} PA</span>
        </div>` : ""}
      </div>
    `).join("");
  }

  // ── League preview (onboarding) ────────────────────────

  function renderLeaguePreview(containerId, leagues) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const entries = Object.values(leagues);
    if (entries.length === 0) {
      container.innerHTML = `<p class="preview-empty">No leagues found.</p>`;
    } else {
      container.innerHTML = `
        <p class="preview-count">${entries.length} league${entries.length !== 1 ? "s" : ""} found</p>
        <ul class="preview-list">
          ${entries.slice(0, 5).map(l => `
            <li>${_escHtml(l.leagueName)} <span class="preview-season">${l.season}</span>
              ${l.isChampion ? " 🏆" : ""}
            </li>
          `).join("")}
          ${entries.length > 5 ? `<li class="preview-more">+ ${entries.length - 5} more</li>` : ""}
        </ul>
      `;
    }
    container.classList.remove("hidden");
  }

  // ── Stats card ─────────────────────────────────────────

  function renderStatsCard(stats) {
    // Will be used in Phase 2 locker header
    // For now returns a plain object summary
    return {
      record:       `${stats.totalWins}–${stats.totalLosses}`,
      winPct:       `${(stats.winPct * 100).toFixed(1)}%`,
      championships: stats.championships,
      dynastyScore:  stats.dynastyScore
    };
  }

  // ── Helpers ────────────────────────────────────────────

  function _platformLabel(platform) {
    return { sleeper: "Sleeper", mfl: "MFL" }[platform] || platform;
  }

  function _platformDisplayUser(platform, data) {
    if (platform === "sleeper") return data.sleeperUsername || data.displayName || "";
    if (platform === "mfl")     return data.mflUsername || "";
    return "";
  }

  function _escHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Public API ─────────────────────────────────────────
  return {
    linkSleeper,
    linkMFL,
    renderLocker,
    renderPlatformsSummary,
    renderLeaguesGrid,
    renderLeaguePreview,
    renderStatsCard
  };

})();
