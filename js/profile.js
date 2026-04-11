// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Profile Module
//  League rendering, filter system, archive/active split,
//  commissioner badges, pinning, custom labels, edit profile.
// ─────────────────────────────────────────────────────────

const Profile = (() => {

  const CURRENT_SEASON = new Date().getFullYear().toString();
  // 10 per page on desktop (2 cols × 5), 5 on mobile (1 col × 5)
  function _getPageSize() {
    return window.innerWidth <= 640 ? 5 : 10;
  }

  let _activeFilter    = "all";
  let _activeFilters   = new Set();
  let _allLeagues      = {};
  let _leagueMeta      = {};
  let _currentUsername = null;
  let _currentProfile  = null;
  let _currentPage     = 0;
  let _archivedPage    = 0;
  let _filteredCache   = [];
  let _archivedCache   = [];

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

  async function linkMFL(gmdUsername, email, password) {
    if (!email?.trim())    throw new Error("Enter your MFL email address.");
    if (!password?.trim()) throw new Error("Enter your MFL password.");

    const mflEmail    = email.trim().toLowerCase();
    const mflUsername = mflEmail.includes("@") ? mflEmail.split("@")[0] : mflEmail;

    // ───────── STEP 1: FETCH ALL USER LEAGUES VIA CREDENTIALS ─────────
    // myleagues returns { league_id, franchise_id, season, ... } for every
    // league/season the user belongs to.  franchise_id is the 4-digit padded
    // ID that links the user to their specific franchise — same value used as
    // `id` in every other league-specific API call (rosters, standings, etc).
    let leagues;
    try {
      leagues = await MFLAPI.getUserLeagues({ username: mflUsername, password });
    } catch (err) {
      throw new Error("Could not connect to MFL. Check your email and password.");
    }

    if (!leagues.length) {
      throw new Error("No MFL leagues found. Check your email and password.");
    }

    // ───────── STEP 2: FETCH BUNDLE PER LEAGUE AND BUILD MAP ─────────
    const leaguesMap = {};

    for (const l of leagues) {
      const leagueId   = String(l.league_id || l.id || "");
      const season     = String(l.season || new Date().getFullYear());
      // franchise_id from myleagues is the authoritative user↔franchise link.
      // It's a 4-digit zero-padded number e.g. "0035".  It matches the `id`
      // field on every franchise object in every bundle for this league.
      const myFranchiseId = l.franchise_id ? String(l.franchise_id) : null;

      if (!leagueId) continue;

      try {
        const bundle = await MFLAPI.getLeagueBundle({
          leagueId,
          year: season,
          username: mflUsername,
          password
        });

        const leagueInfo    = bundle?.league?.league || {};
        const leagueName    = leagueInfo?.name || `League ${leagueId}`;

        // Read team name from bundle.league.league.franchises.franchise[].name
        const franchisesRaw = leagueInfo?.franchises?.franchise;
        const franchisesArr = franchisesRaw
          ? (Array.isArray(franchisesRaw) ? franchisesRaw : [franchisesRaw])
          : [];
        const myFranchise   = myFranchiseId
          ? franchisesArr.find(f => String(f.id) === myFranchiseId)
          : null;

        // Read record from standings using the same franchise id
        const standingsRaw  = bundle?.standings?.leagueStandings?.franchise;
        const standingsArr  = standingsRaw
          ? (Array.isArray(standingsRaw) ? standingsRaw : [standingsRaw])
          : [];
        const mySt          = myFranchiseId
          ? (standingsArr.find(f => String(f.id) === myFranchiseId) || {})
          : {};

        // Dynasty chaining key: same league_id across seasons = same dynasty.
        // All season entries for a given league_id roll up together.
        const dynChainId = `mfl__${leagueId}`;
        const key        = `mfl_${season}_${leagueId}`;

        leaguesMap[key] = {
          platform:       "mfl",
          leagueId,
          franchiseId:    dynChainId,           // dynasty chain key (stable across years)
          leagueName,
          season,
          leagueType:     _detectMFLLeagueType(leagueName),
          totalTeams:     Number(leagueInfo?.franchises) || 12,
          teamName:       myFranchise?.name     || "",
          isCommissioner: myFranchise?.is_commish === "1",
          myRosterId:     myFranchiseId         || null,  // 4-digit franchise id e.g. "0035"
          wins:           Number(mySt.h2hw      || mySt.wins   || 0),
          losses:         Number(mySt.h2hl      || mySt.losses || 0),
          ties:           Number(mySt.h2ht      || mySt.ties   || 0),
          pointsFor:      Number(mySt.pf        || mySt.PF     || 0),
          pointsAgainst:  Number(mySt.pa        || mySt.PA     || 0),
          standing:       Number(mySt.rank)     || null,
          playoffFinish:  null,
          isChampion:     false
        };

      } catch (err) {
        // Skip leagues that fail to fetch; don't abort the whole import
        console.warn(`[MFL] Skipped league ${leagueId} (${season}):`, err.message);
      }
    }

    if (Object.keys(leaguesMap).length === 0) {
      throw new Error("Failed to load any MFL leagues. Check your connection and try again.");
    }

    // ───────── STEP 3: SAVE ─────────
    await GMDB.linkPlatform(gmdUsername, "mfl", {
      mflEmail,
      mflUsername,
      linked: true
    });

    await GMDB.saveLeagues(gmdUsername, leaguesMap);
    await GMDB.recomputeStats(gmdUsername);

    // Credentials are NEVER stored
    return { leagues: leaguesMap, mflUsername };
  }

  // ── Link Yahoo ────────────────────────────────────────────
  async function linkYahoo(gmdUsername) {
    if (!gmdUsername) throw new Error("Not logged in.");

    // Fetch leagues from worker (tokens are stored server-side in KV)
    const yahooLeagues = await YahooAPI.getLeagues();
    if (!yahooLeagues.length) {
      throw new Error("No Yahoo leagues found. Make sure you completed the Yahoo authorization.");
    }

    const leaguesMap = {};
    for (const l of yahooLeagues) {
      const key        = `yahoo_${l.season}_${l.leagueId}`;
      const leagueName = l.leagueName || `League ${l.leagueId}`;
      // Chain by normalized league name so same dynasty across seasons links together
      const normalizedName = leagueName.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
      const franchiseId = `yahoo__${normalizedName}`;
      leaguesMap[key] = {
        platform:      "yahoo",
        leagueId:      String(l.leagueId),
        leagueKey:     l.leagueKey || `nfl.l.${l.leagueId}`,  // full Yahoo key e.g. "423.l.12345"
        franchiseId,
        leagueName,
        season:        String(l.season || new Date().getFullYear()),
        leagueType:    _detectLeagueType(leagueName),
        totalTeams:    l.numTeams || 12,
        teamName:      "",
        isCommissioner: false,
        myRosterId:    null,
        wins:          0, losses: 0, ties: 0,
        pointsFor: 0, pointsAgainst: 0
      };
    }

    await GMDB.linkPlatform(gmdUsername, "yahoo", { linked: true });
    await GMDB.saveLeagues(gmdUsername, leaguesMap);
    await GMDB.recomputeStats(gmdUsername);
    return { leagues: leaguesMap };
  }

  function _detectLeagueType(name) {
    const n = name.toLowerCase();
    if (n.includes("dynasty")) return "dynasty";
    if (n.includes("keeper"))  return "keeper";
    return "redraft";
  }

  function _detectMFLLeagueType(name) {
    const n = name.toLowerCase();
    if (n.includes("dynasty")) return "dynasty";
    if (n.includes("keeper"))  return "keeper";
    return "redraft";
  }

  // ── League meta (pins, labels, archive) ───────────────

  // ── League meta: localStorage-first, Firebase backup ─────
  const _metaLSKey = () => `dlr_leagueMeta_${_currentUsername || "anon"}`;

  async function loadLeagueMeta(username) {
    try {
      const lsRaw  = localStorage.getItem(`dlr_leagueMeta_${username.toLowerCase()}`);
      const lsData = lsRaw ? JSON.parse(lsRaw) : {};
      const fbData = await GMDB.getLeagueMeta(username).catch(() => ({}));

      // Merge personal: Firebase wins over localStorage
      _leagueMeta = { ...lsData, ...fbData };

      // Also fetch shared commish settings for all leagues and overlay them
      const leagueIds = Object.values(_allLeagues).map(l => l.leagueId).filter(Boolean);
      if (leagueIds.length) {
        const shared = await GMDB.getSharedLeagueSettings(leagueIds).catch(() => ({}));
        // For each league, overlay shared commish fields onto the personal meta
        Object.entries(_allLeagues).forEach(([key, league]) => {
          const s = shared[league.leagueId];
          if (!s) return;
          _leagueMeta[key] = {
            ...(_leagueMeta[key] || {}),
            // Shared fields overlay — don't overwrite personal fields
            ...(s.leagueTypeOverride  != null ? { leagueTypeOverride:  s.leagueTypeOverride  } : {}),
            ...(s.auctionEnabled      != null ? { auctionEnabled:      s.auctionEnabled      } : {}),
            ...(s.auctionIncludePicks != null ? { auctionIncludePicks: s.auctionIncludePicks } : {}),
            ...(s.commishGroup        != null ? { commishGroup:        s.commishGroup        } : {}),
          };
          // Apply type override to the league object too
          if (s.leagueTypeOverride && _allLeagues[key]) {
            _allLeagues[key].leagueType = s.leagueTypeOverride;
          }
        });
      }

      try { localStorage.setItem(`dlr_leagueMeta_${username.toLowerCase()}`, JSON.stringify(_leagueMeta)); } catch(e) {}
    } catch(err) {
      console.error("[DLR] loadLeagueMeta FAILED:", err.message);
      _leagueMeta = {};
    }
  }

  async function saveLeagueMeta(username, leagueKey, updates) {
    const existing = _leagueMeta[leagueKey] || {};
    const merged   = { ...existing, ...updates };
    Object.keys(merged).forEach(k => {
      if (merged[k] === null || merged[k] === undefined || merged[k] === "") delete merged[k];
    });
    _leagueMeta[leagueKey] = merged;

    try { localStorage.setItem(`dlr_leagueMeta_${username.toLowerCase()}`, JSON.stringify(_leagueMeta)); } catch(e) {}

    // Pass leagueId and isCommissioner so DB layer can write shared fields
    const league = _allLeagues[leagueKey];
    const withMeta = {
      ...merged,
      _leagueId:       league?.leagueId       || null,
      isCommissioner:  league?.isCommissioner  || false
    };
    try { await GMDB.saveLeagueMetaEntry(username, leagueKey, withMeta); } catch(e) {

    }
  }

  // ── Eager MFL identity resolution ────────────────────────
  // Runs non-blocking after renderLocker. Finds all MFL leagues missing
  // myRosterId and resolves them in the background, then persists to
  // gmd/users/{u}/leagues/{key} so they load correctly on next visit.
  // ── Public: sync MFL team identities (foreground, for Sync button) ────
  // Runs the same resolution as the background version but returns a promise
  // so the caller can show loading state and wait for completion.
  async function syncMFLTeams() {
    // Re-fetch each MFL league and refresh teamName + record using the
    // stored myRosterId (franchise_id).  No email matching needed —
    // myRosterId was set from the authoritative myleagues response on import.
    if (!_currentUsername || !_currentProfile?.platforms?.mfl?.linked) return 0;

    const allMFL = Object.entries(_allLeagues).filter(([, l]) => l.platform === "mfl");
    if (!allMFL.length) return 0;

    let matched = 0;
    const CONCURRENCY = 4;
    for (let i = 0; i < allMFL.length; i += CONCURRENCY) {
      const batch = allMFL.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map(async ([leagueKey, league]) => {
        const myRosterId = league.myRosterId;
        if (!myRosterId) return;   // can't resolve without a stored roster id

        try {
          const bundle       = await MFLAPI.getLeagueBundle(league.leagueId, league.season);
          const leagueInfo   = bundle?.league?.league || {};
          const franchisesRaw = leagueInfo?.franchises?.franchise;
          const franchisesArr = franchisesRaw
            ? (Array.isArray(franchisesRaw) ? franchisesRaw : [franchisesRaw])
            : [];
          const myFranchise  = franchisesArr.find(f => String(f.id) === String(myRosterId)) || {};

          const standingsMap = MFLAPI.getStandingsMap(bundle);
          const mySt         = standingsMap[String(myRosterId)] || {};

          if (_allLeagues[leagueKey]) {
            _allLeagues[leagueKey].teamName    = myFranchise.name  || _allLeagues[leagueKey].teamName;
            _allLeagues[leagueKey].wins        = mySt.wins         || _allLeagues[leagueKey].wins    || 0;
            _allLeagues[leagueKey].losses      = mySt.losses       || _allLeagues[leagueKey].losses  || 0;
            _allLeagues[leagueKey].ties        = mySt.ties         || _allLeagues[leagueKey].ties    || 0;
            _allLeagues[leagueKey].standing    = mySt.rank         || _allLeagues[leagueKey].standing || null;
            _allLeagues[leagueKey].pointsFor   = mySt.ptsFor       || _allLeagues[leagueKey].pointsFor || 0;
            GMDB.saveLeague(_currentUsername, leagueKey, { ..._allLeagues[leagueKey] }).catch(() => {});
            matched++;
          }
        } catch(e) { /* skip failed league */ }
      }));
    }
    _renderLeagues();
    return matched;
  }

  // ── Main locker render ─────────────────────────────────

  async function renderLocker(profile) {
    if (!profile) return;
    _currentUsername = profile.username;
    _currentProfile  = profile;
    _allLeagues      = profile.leagues || {};

    await loadLeagueMeta(profile.username);

    // Apply any stored type overrides to in-memory league data
    Object.entries(_leagueMeta).forEach(([key, meta]) => {
      if (meta?.leagueTypeOverride && _allLeagues[key]) {
        _allLeagues[key].leagueType = meta.leagueTypeOverride;
      }
    });

    document.getElementById("locker-display-name").textContent = profile.username;
    document.getElementById("nav-username").textContent = "@" + profile.username;

    // Populate mobile nav identity bar
    const navIdName   = document.getElementById("nav-id-name");
    const navIdMeta   = document.getElementById("nav-id-meta");
    const navIdDscore = document.getElementById("nav-id-dscore");
    const navAvatar   = document.getElementById("nav-avatar");
    if (navIdName) navIdName.textContent = profile.username;
    if (navIdMeta && profile.stats) {
      const w = profile.stats.totalWins        || 0;
      const l = profile.stats.totalLosses      || 0;
      const c = profile.stats.championships    || 0;
      navIdMeta.innerHTML = `
        <span class="nav-id-record">${w}–${l}</span>
        ${c > 0 ? `<span class="nav-id-trophy">🏆${c > 1 ? c : ""}</span>` : ""}`;
    }
    if (navIdDscore && profile.stats?.dynastyScore) {
      navIdDscore.innerHTML = `<span class="nav-id-dscore-val">⚡ ${profile.stats.dynastyScore}</span>`;
    }
    if (navAvatar) {
      if (profile.avatarUrl) {
        navAvatar.innerHTML = `<img src="${profile.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%" onerror="this.parentElement.innerHTML='${(profile.username||"?")[0].toUpperCase()}'"/>`;
      } else {
        navAvatar.textContent = (profile.username || "?")[0].toUpperCase();
      }
    }

    if (profile.bio) {
      document.getElementById("locker-tagline").textContent = profile.bio;
    }

    // ── Avatar / profile photo ──────────────────────────────
    _renderAvatar(profile);

    // ── Team logo / jersey in header background ─────────────
    _renderTeamBranding(profile.favoriteNflTeam || "");

    _renderStatsRow(profile.stats || {});
    _renderPlatformsBadges(profile.platforms || {});
    _renderLeagueFilters();
    _renderLeagues();
    _renderCareerSummary(profile);

    // Non-blocking: resolve MFL team identities in the background for any
    // leagues that are missing myRosterId (never had Overview opened).
    // Cards re-render automatically when resolution completes.
    _resolveMFLIdentities(profile.username, profile.platforms?.mfl).catch(() => {});
  }

  function _renderAvatar(profile) {
    const el = document.getElementById("locker-avatar");
    if (!el) return;
    const initEl = document.getElementById("locker-avatar-initials");

    if (profile.avatarUrl) {
      el.style.backgroundImage = `url(${profile.avatarUrl})`;
      el.style.backgroundSize  = "cover";
      el.style.backgroundPosition = "center";
      if (initEl) initEl.style.display = "none";
    } else if (profile.platforms?.sleeper?.avatar) {
      // Use Sleeper avatar
      const src = `https://sleepercdn.com/avatars/thumbs/${profile.platforms.sleeper.avatar}`;
      el.style.backgroundImage = `url(${src})`;
      el.style.backgroundSize  = "cover";
      el.style.backgroundPosition = "center";
      if (initEl) initEl.style.display = "none";
    } else {
      el.style.backgroundImage = "";
      if (initEl) {
        initEl.style.display = "";
        initEl.textContent   = (profile.username || "?")[0].toUpperCase();
      }
    }

    // Make avatar clickable to upload photo
    el.title   = "Click to change profile photo";
    el.style.cursor = "pointer";
    el.onclick = () => _openPhotoUpload();
  }

  function _renderTeamBranding(teamAbbr) {
    const header = document.querySelector(".locker-header");
    if (!header) return;

    // Remove old branding
    header.querySelector(".locker-team-logo")?.remove();

    if (!teamAbbr) return;

    // ESPN CDN for team logos
    const logoUrl = `https://a.espncdn.com/i/teamlogos/nfl/500/${teamAbbr.toLowerCase()}.png`;

    const logoEl = document.createElement("div");
    logoEl.className = "locker-team-logo";
    logoEl.innerHTML = `
      <img src="${logoUrl}"
        alt="${teamAbbr}"
        onerror="this.parentElement.style.display='none'"
        loading="lazy" />`;

    // Insert as FIRST child so it's behind other header content in paint order
    // (absolute positioned so it doesn't affect layout)
    header.insertBefore(logoEl, header.firstChild);
  }

  function _openPhotoUpload() {
    const input = document.createElement("input");
    input.type   = "file";
    input.accept = "image/*";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 500_000) {
        showToast("Image must be under 500KB. Try a smaller photo.", "error");
        return;
      }

      const reader = new FileReader();
      reader.onload = async (ev) => {
        const dataUrl = ev.target.result;
        try {
          await GMD.child(`users/${_currentUsername}/avatarUrl`).set(dataUrl);
          // Update in-memory profile
          if (_currentProfile) _currentProfile.avatarUrl = dataUrl;
          _renderAvatar(_currentProfile || { avatarUrl: dataUrl, username: _currentUsername });
          showToast("Profile photo updated ✓");
        } catch(err) {
          console.error("[Avatar] Save failed:", err);
          showToast("Failed to save photo — try a smaller image", "error");
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
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

  // ── Career Summary ──────────────────────────────────────

  function _renderCareerSummary(profile) {
    // Career summary is now a modal — just precompute the data
    const allLeagues   = Object.values(_allLeagues);
    // Owner = has a roster (myRosterId set by Sleeper owner_id or co_owners check)
    // Include new leagues with no games yet — exclude commish-only (no myRosterId, no record)
    const ownerLeagues = allLeagues.filter(l =>
      l.myRosterId || (l.wins || 0) > 0 || (l.losses || 0) > 0 || (l.pointsFor || 0) > 0
    );
    if (!ownerLeagues.length) return;

    // Store for modal use
    _careerLeagues = ownerLeagues;

    // Wire Career Summary button
    document.getElementById("career-summary-btn")?.addEventListener("click", () => {
      _openCareerSummaryModal();
    });
  }

  let _careerLeagues = [];

  function _openCareerSummaryModal() {
    const leagues = _careerLeagues;
    if (!leagues.length) return;

    const modal = document.getElementById("career-summary-modal");
    if (!modal) return;
    modal.classList.remove("hidden");

    // Wire tabs (fresh each open)
    document.querySelectorAll(".cs-tab").forEach(tab => {
      const fresh = tab.cloneNode(true);
      tab.parentNode.replaceChild(fresh, tab);
    });
    document.querySelectorAll(".cs-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".cs-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".cs-panel").forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById(`cs-${tab.dataset.cstab}`)?.classList.add("active");
      });
    });

    // Recompute stats
    const w        = leagues.reduce((s, l) => s + (l.wins   || 0), 0);
    const lo       = leagues.reduce((s, l) => s + (l.losses || 0), 0);
    const champs   = leagues.filter(l => l.playoffFinish === 1 || l.isChampion).length;
    const runners  = leagues.filter(l => l.playoffFinish === 2).length;
    const thirds   = leagues.filter(l => l.playoffFinish === 3).length;
    const playoffs = leagues.filter(l => l.playoffFinish != null && l.playoffFinish <= 7).length;
    const tot      = w + lo;
    const winPct   = tot > 0 ? ((w / tot) * 100).toFixed(1) : "—";
    const seasons  = new Set(leagues.map(l => l.season).filter(Boolean)).size;
    const dscore   = Math.round((tot > 0 ? w / tot : 0) * 100 + champs * 20 + runners * 10 + thirds * 5 + playoffs * 2 + seasons * 2);

    const stats = { totalWins: w, totalLosses: lo, winPct, championships: champs, runnerUps: runners, thirdPlace: thirds, playoffAppearances: playoffs, leaguesPlayed: leagues.length, dynastyScore: dscore };

    _renderCSOverall(leagues, stats);
    _renderCSAnnual(leagues);
    _renderCSType(leagues);
    _renderCSMatrix(leagues);

    // Reset to overall tab
    document.querySelectorAll(".cs-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".cs-panel").forEach(p => p.classList.remove("active"));
    document.querySelector('[data-cstab="overall"]')?.classList.add("active");
    document.getElementById("cs-overall")?.classList.add("active");
  }

  function _renderCSOverall(leagues, stats) {
    const el = document.getElementById("cs-overall");
    if (!el) return;

    el.innerHTML = `
      <div class="cs-stats-grid">
        <div class="cs-stat">
          <div class="cs-stat-val">${stats.leaguesPlayed || leagues.length}</div>
          <div class="cs-stat-lbl">Seasons</div>
        </div>
        <div class="cs-stat">
          <div class="cs-stat-val">${stats.totalWins || 0}–${stats.totalLosses || 0}</div>
          <div class="cs-stat-lbl">All-Time Record</div>
        </div>
        <div class="cs-stat">
          <div class="cs-stat-val">${stats.winPct || "—"}%</div>
          <div class="cs-stat-lbl">Win Rate</div>
        </div>
        <div class="cs-stat">
          <div class="cs-stat-val" style="color:var(--color-gold)">${stats.dynastyScore || 0}</div>
          <div class="cs-stat-lbl">Dynasty Score</div>
        </div>
      </div>
      <div class="cs-stats-grid" style="margin-top:var(--space-3);">
        <div class="cs-stat">
          <div class="cs-stat-val">${stats.playoffAppearances || 0}</div>
          <div class="cs-stat-lbl">Playoff Apps</div>
        </div>
        <div class="cs-stat">
          <div class="cs-stat-val" style="color:var(--color-gold)">🏆 ${stats.championships || 0}</div>
          <div class="cs-stat-lbl">Championships</div>
        </div>
        <div class="cs-stat">
          <div class="cs-stat-val">🥈 ${stats.runnerUps || 0}</div>
          <div class="cs-stat-lbl">Runner-Ups</div>
        </div>
        <div class="cs-stat">
          <div class="cs-stat-val">🥉 ${stats.thirdPlace || 0}</div>
          <div class="cs-stat-lbl">3rd Place</div>
        </div>
      </div>`;
  }

  function _renderCSAnnual(leagues) {
    const el = document.getElementById("cs-annual");
    if (!el) return;

    // Group by season
    const bySeason = {};
    leagues.forEach(l => {
      const s = l.season || "Unknown";
      if (!bySeason[s]) bySeason[s] = [];
      bySeason[s].push(l);
    });

    const seasons = Object.keys(bySeason).sort((a, b) => b.localeCompare(a));

    el.innerHTML = `
      <div class="cs-table-wrap">
        <table class="cs-table">
          <thead>
            <tr><th>Season</th><th>Leagues</th><th>W–L</th><th>Win%</th><th>Titles</th><th>Playoffs</th></tr>
          </thead>
          <tbody>
            ${seasons.map(s => {
              const rows = bySeason[s];
              const w    = rows.reduce((sum, l) => sum + (l.wins   || 0), 0);
              const lo   = rows.reduce((sum, l) => sum + (l.losses || 0), 0);
              const tot  = w + lo;
              const pct  = tot > 0 ? ((w / tot) * 100).toFixed(0) + "%" : "—";
              const titles = rows.filter(l => l.playoffFinish === 1 || l.isChampion).length;
              const playoffs = rows.filter(l => l.playoffFinish != null && l.playoffFinish <= 7).length;
              return `<tr>
                <td class="cs-season">${s}</td>
                <td class="dim">${rows.length}</td>
                <td><span class="cs-record">${w}–${lo}</span></td>
                <td class="dim">${pct}</td>
                <td>${titles > 0 ? `<span style="color:var(--color-gold)">🏆 ×${titles}</span>` : "—"}</td>
                <td class="dim">${playoffs > 0 ? `${playoffs}/${rows.length}` : "—"}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`;
  }

  function _renderCSType(leagues) {
    const el = document.getElementById("cs-type");
    if (!el) return;

    const types = ["dynasty", "salary", "redraft", "keeper"];
    const byType = {};
    types.forEach(t => { byType[t] = leagues.filter(l => l.leagueType === t); });
    byType["other"] = leagues.filter(l => !types.includes(l.leagueType));

    const rows = [...types, "other"].map(type => {
      const rows = byType[type];
      if (!rows.length) return "";
      const w   = rows.reduce((s, l) => s + (l.wins   || 0), 0);
      const lo  = rows.reduce((s, l) => s + (l.losses || 0), 0);
      const tot = w + lo;
      const pct = tot > 0 ? ((w / tot) * 100).toFixed(0) + "%" : "—";
      const titles  = rows.filter(l => l.playoffFinish === 1 || l.isChampion).length;
      const playoffs = rows.filter(l => l.playoffFinish != null && l.playoffFinish <= 7).length;
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      return `<tr>
        <td class="cs-season" style="text-transform:capitalize;">${label}</td>
        <td class="dim">${rows.length}</td>
        <td><span class="cs-record">${w}–${lo}</span></td>
        <td class="dim">${pct}</td>
        <td>${titles > 0 ? `<span style="color:var(--color-gold)">🏆 ×${titles}</span>` : "—"}</td>
        <td class="dim">${playoffs > 0 ? `${playoffs}/${rows.length}` : "—"}</td>
      </tr>`;
    }).filter(Boolean).join("");

    el.innerHTML = `
      <div class="cs-table-wrap">
        <table class="cs-table">
          <thead>
            <tr><th>Type</th><th>Seasons</th><th>W–L</th><th>Win%</th><th>Titles</th><th>Playoffs</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function _renderCSMatrix(leagues) {
    const el = document.getElementById("cs-matrix");
    if (!el) return;

    const types   = ["dynasty","salary","redraft","keeper","other"];
    const seasons = [...new Set(leagues.map(l => l.season).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    const typeLeagues = (t) => leagues.filter(l => t === "other" ? !["dynasty","salary","redraft","keeper"].includes(l.leagueType) : l.leagueType === t);

    // Only include types that have data
    const activeTypes = types.filter(t => typeLeagues(t).length > 0);

    function cell(rows) {
      if (!rows.length) return `<td class="cs-matrix-empty">—</td>`;
      const w   = rows.reduce((s, l) => s + (l.wins   || 0), 0);
      const lo  = rows.reduce((s, l) => s + (l.losses || 0), 0);
      const tot = w + lo;
      const pct = tot > 0 ? ((w / tot) * 100).toFixed(0) : "0";
      const titles = rows.filter(l => l.playoffFinish === 1 || l.isChampion).length;
      return `<td class="cs-matrix-cell">
        <span class="cs-mx-record">${w}–${lo}</span>
        <span class="cs-mx-pct">${pct}%</span>
        ${titles > 0 ? `<span class="cs-mx-title">🏆</span>` : ""}
      </td>`;
    }

    el.innerHTML = `
      <div class="cs-table-wrap">
        <table class="cs-table cs-matrix-table">
          <thead>
            <tr>
              <th>Season</th>
              ${activeTypes.map(t => `<th style="text-transform:capitalize">${t}</th>`).join("")}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${seasons.map(s => {
              const seasonLeagues = leagues.filter(l => l.season === s);
              const w  = seasonLeagues.reduce((sum, l) => sum + (l.wins   || 0), 0);
              const lo = seasonLeagues.reduce((sum, l) => sum + (l.losses || 0), 0);
              const tot = w + lo;
              const pct = tot > 0 ? ((w / tot) * 100).toFixed(0) : "0";
              return `<tr>
                <td class="cs-season">${s}</td>
                ${activeTypes.map(t => cell(seasonLeagues.filter(l => t === "other" ? !["dynasty","salary","redraft","keeper"].includes(l.leagueType) : l.leagueType === t))).join("")}
                <td class="cs-matrix-cell cs-matrix-total">
                  <span class="cs-mx-record">${w}–${lo}</span>
                  <span class="cs-mx-pct">${pct}%</span>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
          <tfoot>
            <tr style="border-top:2px solid var(--color-border)">
              <td class="cs-season">All-time</td>
              ${activeTypes.map(t => cell(typeLeagues(t))).join("")}
              ${cell(leagues)}
            </tr>
          </tfoot>
        </table>
      </div>`;
  }

  // ── Filter bar ─────────────────────────────────────────
  function _renderLeagueFilters() {
    const customLabels  = new Set();
    const commishGroups = new Set();

    Object.values(_leagueMeta).forEach(m => {
      if (m && m.customLabel  && m.customLabel.trim())  customLabels.add(m.customLabel.trim());
      if (m && m.commishGroup && m.commishGroup.trim()) commishGroups.add(m.commishGroup.trim());
    });

    // Show/hide group buttons
    document.getElementById("filter-groups-btn")?.style.setProperty("display", customLabels.size > 0 ? "" : "none");
    document.getElementById("filter-commish-btn")?.style.setProperty("display", commishGroups.size > 0 ? "" : "none");

    // Populate groups panel
    const groupsList = document.getElementById("filter-groups-list");
    if (groupsList) {
      groupsList.innerHTML = [...customLabels].map(l =>
        `<button class="filter-chip" data-filter="label:${_escHtml(l)}" onclick="Profile.toggleFilter('label:${_escHtml(l)}')">🏷 ${_escHtml(l)}</button>`
      ).join("");
    }
    const commishList = document.getElementById("filter-commish-list");
    if (commishList) {
      commishList.innerHTML = [...commishGroups].map(g =>
        `<button class="filter-chip" data-filter="group:${_escHtml(g)}" onclick="Profile.toggleFilter('group:${_escHtml(g)}')">⚡ ${_escHtml(g)}</button>`
      ).join("");
    }

    // Wire checkboxes in main panel
    document.querySelectorAll("#filter-panel-main input[type=checkbox]").forEach(cb => {
      cb.addEventListener("change", () => {
        const f = cb.dataset.filter;
        if (f === "all") {
          _activeFilters.clear();
          document.querySelectorAll("#filter-panel-main input[type=checkbox]").forEach(x => {
            x.checked = x.dataset.filter === "all";
          });
        } else {
          // Uncheck "all" when specific filter selected
          document.querySelector('#filter-panel-main input[data-filter="all"]').checked = false;
          if (cb.checked) _activeFilters.add(f);
          else _activeFilters.delete(f);
          if (_activeFilters.size === 0) {
            document.querySelector('#filter-panel-main input[data-filter="all"]').checked = true;
          }
        }
        _updateFilterBtnCount();
        _renderLeagues();
      });
    });

    // Wire legacy hidden filterBar so existing click handlers still work
    const filterBar = document.getElementById("league-filters");
    if (filterBar && !filterBar.dataset.wired) {
      filterBar.dataset.wired = "1";
      filterBar.querySelectorAll(".filter-tab").forEach(tab => {
        tab.addEventListener("click", () => {
          const f = tab.dataset.filter;
          if (f === "all") { _activeFilters.clear(); }
          else if (_activeFilters.has(f)) _activeFilters.delete(f);
          else _activeFilters.add(f);
          _renderLeagues();
        });
      });
    }
  }

  function _updateFilterBtnCount() {
    const countEl = document.getElementById("filter-main-count");
    if (!countEl) return;
    const n = _activeFilters.size;
    countEl.textContent = n;
    countEl.style.display = n > 0 ? "" : "none";
    // Update archived button highlight
    document.getElementById("filter-archived-btn")?.classList.toggle("filter-btn--active",
      _activeFilters.has("archived"));
  }

  function toggleFilterPanel(name) {
    const panels = ["main","groups","commish"];
    panels.forEach(p => {
      const el = document.getElementById(`filter-panel-${p}`);
      if (!el) return;
      if (p === name) el.classList.toggle("hidden");
      else el.classList.add("hidden");
    });
    // Update button active states
    panels.forEach(p => {
      document.getElementById(`filter-${p}-btn`)?.classList.toggle("filter-btn--active",
        !document.getElementById(`filter-panel-${p}`)?.classList.contains("hidden"));
    });
  }

  function toggleFilter(f) {
    if (f === "archived") {
      if (_activeFilters.has("archived")) _activeFilters.delete("archived");
      else _activeFilters.add("archived");
      document.getElementById("filter-archived-btn")?.classList.toggle("filter-btn--active", _activeFilters.has("archived"));
    } else {
      if (_activeFilters.has(f)) _activeFilters.delete(f);
      else _activeFilters.add(f);
      // Sync checkbox if panel exists
      const cb = document.querySelector(`#filter-panel-main input[data-filter="${CSS.escape(f)}"]`);
      if (cb) cb.checked = _activeFilters.has(f);
      // Sync chip
      document.querySelectorAll(`.filter-chip[data-filter="${CSS.escape(f)}"]`).forEach(c =>
        c.classList.toggle("filter-chip--active", _activeFilters.has(f)));
      _updateFilterBtnCount();
    }
    _renderLeagues();
  }

  function clearFilters() {
    _activeFilters.clear();
    document.querySelectorAll("#filter-panel-main input[type=checkbox]").forEach(cb => {
      cb.checked = cb.dataset.filter === "all";
    });
    document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("filter-chip--active"));
    _updateFilterBtnCount();
    _renderLeagues();
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

    // Determine active season using the 1/15 rule:
    // After Jan 15 → look for current-year leagues as "active"
    // Before Jan 15 → look for prior-year leagues as "active"
    // BUT if no leagues exist for that year in stored data, fall back
    // to the most recent season actually present in the data
    const ruleSeason = typeof getActiveSeason === "function"
      ? getActiveSeason()
      : String(new Date().getFullYear() - 1);

    // Check if any leagues exist for the rule season
    const hasRuleSeasonLeagues = franchiseList.some(f =>
      f.seasons.some(s => s.league.season === ruleSeason)
    );

    // If no leagues yet for the rule season, use the most recent season in data
    const activeSeason = hasRuleSeasonLeagues
      ? ruleSeason
      : (Object.values(_allLeagues).map(l => l.season).filter(Boolean)
          .sort((a, b) => b.localeCompare(a))[0] || ruleSeason);

    // For each franchise, determine if active or archived
    const active   = [];
    const archived = [];

    franchiseList.forEach(f => {
      const meta = _leagueMeta[f.latestKey] || {};
      // Active = latest season of THIS franchise matches the active season
      // (using latestKey which is the newest season)
      const latestLeagueSeason = _allLeagues[f.latestKey]?.season;
      const hasActiveSeason = latestLeagueSeason === activeSeason;
      const isArchived = meta.archived || !hasActiveSeason;

      if (isArchived) {
        archived.push(f);
      } else {
        active.push(f);
      }
    });

    const wantArchived  = _activeFilters.has("archived");
    const otherFilters  = new Set([..._activeFilters].filter(f => f !== "archived"));

    // Main grid always shows active leagues (+ archived when "Archived" filter selected)
    let pool = [];
    if (wantArchived && otherFilters.size === 0) {
      pool = archived;
    } else if (wantArchived && otherFilters.size > 0) {
      pool = [...active, ...archived];
    } else {
      pool = active; // "All" = active only; archived lives in the accordion below
    }

    const filtered = _applyFranchiseFilter(pool, otherFilters);

    // Sort: pinned first, then alphabetical
    filtered.sort((a, b) => {
      const aPinned = (_leagueMeta[a.latestKey]?.pinned) ? 1 : 0;
      const bPinned = (_leagueMeta[b.latestKey]?.pinned) ? 1 : 0;
      if (bPinned !== aPinned) return bPinned - aPinned;
      const aName = (_allLeagues[a.latestKey]?.leagueName || "").toLowerCase();
      const bName = (_allLeagues[b.latestKey]?.leagueName || "").toLowerCase();
      return aName.localeCompare(bName);
    });

    if (filtered.length === 0) {
      grid.innerHTML = `<p class="empty-state">No leagues match this filter.</p>`;
      _hidePagination();
      _updateJumpDropdown([]);
    } else {
      const prevLen   = _filteredCache.length;
      _filteredCache  = filtered;
      _archivedCache  = archived;
      // Only reset to page 0 when the list composition changes, not on background re-renders.
      if (filtered.length !== prevLen) {
        _currentPage  = 0;
        _archivedPage = 0;
      }
      // Clamp in case page is now out of bounds
      const maxPage = Math.max(0, Math.ceil(filtered.length / _getPageSize()) - 1);
      if (_currentPage > maxPage) _currentPage = maxPage;
      _renderPage(grid, _filteredCache, _currentPage, "leagues-pagination", "page-info", false);
      _updateJumpDropdown(wantArchived ? [..._filteredCache, ...archived] : _filteredCache);
    }

    // Always hide the archived accordion — use the 📦 Archived filter button instead
    if (archivedSec) archivedSec.classList.add("hidden");
  }

  function _renderPage(gridEl, items, page, paginationId, infoId, isArchived) {
    if (!gridEl) return;
    const total    = items.length;
    const pages    = Math.ceil(total / _getPageSize());
    const start    = page * _getPageSize();
    const slice    = items.slice(start, start + _getPageSize());

    gridEl.innerHTML = slice.map(f => _franchiseCardHTML(f, isArchived)).join("");
    _wireCardEvents(gridEl);

    const pag    = document.getElementById(paginationId);
    const info   = document.getElementById(infoId);
    const prev   = pag?.querySelector("[id$='-prev']") || document.getElementById("page-prev");
    const next   = pag?.querySelector("[id$='-next']") || document.getElementById("page-next");

    if (total <= _getPageSize()) {
      if (pag) pag.style.display = "none";
    } else {
      if (pag) pag.style.display = "flex";
      if (info) info.textContent = `${start + 1}–${Math.min(start + _getPageSize(), total)} of ${total}`;
      if (prev) prev.disabled = page === 0;
      if (next) next.disabled = page >= pages - 1;
    }
  }

  function _hidePagination() {
    document.getElementById("leagues-pagination").style.display  = "none";
    document.getElementById("archived-pagination").style.display = "none";
  }

  function changePage(delta, isArchived = false) {
    if (isArchived) {
      _archivedPage = Math.max(0, _archivedPage + delta);
      const grid = document.getElementById("archived-grid");
      _renderPage(grid, _archivedCache, _archivedPage, "archived-pagination", "arch-page-info", true);
    } else {
      _currentPage = Math.max(0, _currentPage + delta);
      const grid = document.getElementById("leagues-grid");
      _renderPage(grid, _filteredCache, _currentPage, "leagues-pagination", "page-info", false);
    }
  }

  function _noOp() {}

  function _updateJumpDropdown(allFranchises) {
    const sel = document.getElementById("league-jump-select");
    const bar = document.getElementById("league-search-bar");
    if (!sel) return;

    // Deduplicate by latestKey, then build one entry per franchise
    const seen = new Set();
    const all  = [];
    allFranchises.forEach(f => {
      if (seen.has(f.latestKey)) return;
      seen.add(f.latestKey);
      const league = _allLeagues[f.latestKey];
      if (league) all.push({ key: f.latestKey, name: league.leagueName, season: league.season });
    });
    all.sort((a, b) => a.name.localeCompare(b.name));

    sel.innerHTML = `<option value="">Jump to league…</option>` +
      all.map(l => `<option value="${l.key}">${_escHtml(l.name)} (${l.season})</option>`).join("");

    if (bar) bar.style.display = all.length > 0 ? "" : "none";
  }

  function jumpToLeague(leagueKey) {
    if (!leagueKey) return;
    openLeagueDetail(leagueKey);
    // Reset select
    const sel = document.getElementById("league-jump-select");
    if (sel) sel.value = "";
  }

  function _applyFranchiseFilter(franchises, filterSet) {
    const fs = filterSet || _activeFilters;
    const active = new Set([...fs].filter(f => f !== "archived"));
    if (active.size === 0) return franchises;
    return franchises.filter(f =>
      [...active].every(filter => _franchiseMatchesFilter(f, filter))
    );
  }

  function _franchiseMatchesFilter(f, filter) {
    const latest = _allLeagues[f.latestKey];
    const meta   = _leagueMeta[f.latestKey] || {};

    switch(filter) {
      case "active": {
        const ruleSeason = typeof getActiveSeason === "function" ? getActiveSeason() : CURRENT_SEASON;
        // If no leagues exist for the rule season, fall back to latest season in data
        const hasRuleSeason = Object.values(_allLeagues).some(l => l.season === ruleSeason);
        const checkSeason   = hasRuleSeason
          ? ruleSeason
          : (Object.values(_allLeagues).map(l => l.season).filter(Boolean).sort((a, b) => b.localeCompare(a))[0] || ruleSeason);
        return f.seasons.some(s => s.league.season === checkSeason);
      }
      case "owner":        return f.seasons.some(s => s.league.myRosterId || s.league.wins > 0 || s.league.losses > 0 || s.league.ties > 0 || (s.league.pointsFor > 0));
      case "pinned":       return !!meta.pinned;
      case "dynasty":      return latest?.leagueType === "dynasty";
      case "salary":       return latest?.leagueType === "salary";
      case "redraft":      return latest?.leagueType === "redraft";
      case "keeper":       return latest?.leagueType === "keeper";
      case "commissioner": return f.seasons.some(s => s.league.isCommissioner);
      default:
        if (filter.startsWith("label:"))    return meta.customLabel === filter.slice(6);
        if (filter.startsWith("group:"))    return meta.commishGroup === filter.slice(6);
        if (filter.startsWith("platform:")) return latest?.platform === filter.slice(9);
        return true;
    }
  }

  // ── Franchise card HTML — compact horizontal row ──────────

  function _franchiseCardHTML(franchise, isArchived = false) {
    const key     = franchise.latestKey;
    const league  = _allLeagues[key];
    const meta    = _leagueMeta[key] || {};
    const seasons = franchise.seasons;

    if (!league) return "";

    const totalWins   = seasons.reduce((s, x) => s + (x.league.wins   || 0), 0);
    const totalLosses = seasons.reduce((s, x) => s + (x.league.losses || 0), 0);
    const titles      = seasons.filter(x => x.league.playoffFinish === 1 || x.league.isChampion).length;
    const runnerUps   = seasons.filter(x => x.league.playoffFinish === 2).length;
    const thirds      = seasons.filter(x => x.league.playoffFinish === 3).length;
    const isCommish   = seasons.some(x => x.league.isCommissioner);

    // Current season record
    const currentSeason = seasons.find(s => s.league.season === league.season);
    const cW  = currentSeason?.league.wins   || 0;
    const cL  = currentSeason?.league.losses || 0;
    const cPF = currentSeason?.league.pointsFor ? parseFloat(currentSeason.league.pointsFor).toFixed(0) : "—";

    // Playoff finish icon for current season
    const finish     = league.playoffFinish;
    const finishIcon = { 1:"🏆", 2:"🥈", 3:"🥉" }[finish] || (finish && finish <= 7 ? "🏅" : "");

    // Best teamName: prefer latest season that actually has one
    const bestTeamName = seasons.reduce((found, s) =>
      found || (s.league.teamName && s.league.teamName !== "My Team" ? s.league.teamName : null)
    , null) || league.teamName || "";
    const tags = [];
    if (isCommish)         tags.push(`<span class="lrow-tag lrow-tag--commish">👑</span>`);
    if (meta.pinned)       tags.push(`<span class="lrow-tag">📌</span>`);
    if (titles > 0)        tags.push(`<span class="lrow-tag lrow-tag--gold">🏆 ${titles}</span>`);
    if (runnerUps > 0)     tags.push(`<span class="lrow-tag">🥈 ${runnerUps}</span>`);
    if (thirds > 0)        tags.push(`<span class="lrow-tag">🥉 ${thirds}</span>`);
    if (meta.customLabel)  tags.push(`<span class="lrow-tag lrow-tag--label">🏷 ${_escHtml(meta.customLabel)}</span>`);
    if (meta.commishGroup) tags.push(`<span class="lrow-tag lrow-tag--group">⚡ ${_escHtml(meta.commishGroup)}</span>`);

    // Abbreviate type to 3 chars max
    const typeShort = { dynasty:"DYN", salary:"SAL", redraft:"RDR", keeper:"KEP" }[league.leagueType] || (league.leagueType||"RDR").slice(0,3).toUpperCase();
    const platShort = (league.platform||"").slice(0,3).toUpperCase();
    const typeBadge = `<span class="lrow-type lrow-type--${league.leagueType || "redraft"}">${typeShort}</span>`;
    const platBadge = `<span class="lrow-plat lrow-plat--${league.platform}">${platShort}</span>`;

    // Championship badges for name row
    const champBadges = [
      titles    > 0 ? `<span class="lrow-champ-badge lrow-champ-badge--gold">🏆${titles > 1 ? titles : ""}</span>` : "",
      runnerUps > 0 ? `<span class="lrow-champ-badge">🥈${runnerUps > 1 ? runnerUps : ""}</span>` : "",
    ].filter(Boolean).join("");

    return `
      <div class="league-row ${isArchived ? "league-row--archived" : ""} ${titles > 0 ? "league-row--champion" : ""}" data-key="${key}">
        <div class="lrow-left">
          ${platBadge}
          ${typeBadge}
        </div>
        <div class="lrow-name-col">
          <div class="lrow-name">
            ${_escHtml(league.leagueName)}
          </div>
          <div class="lrow-team-row">
            <span class="lrow-team">${_escHtml(bestTeamName)}</span>
            ${champBadges}
          </div>
        </div>
        <div class="lrow-alltime-col">
          <div class="lrow-record">${totalWins}–${totalLosses}</div>
          <div class="lrow-season-label">${cW}–${cL}${finishIcon ? " " + finishIcon : ""}</div>
        </div>
        <div class="lrow-actions">
          <button class="lrow-options-btn league-options-btn" data-key="${key}" title="Options">⋯</button>
        </div>
      </div>`;
  }

  function _wireCardEvents(container) {
    container.querySelectorAll(".league-row").forEach(row => {
      const key = row.dataset.key;

      row.addEventListener("click", e => {
        if (e.target.closest(".lrow-options-btn") || e.target.closest(".lrow-chat-btn")) return;
        openLeagueDetail(key);
      });

      // Drag to reorder
      row.draggable = true;
      row.addEventListener("dragstart", e => LeagueGroups.onLeagueDragStart(e, key));
      row.addEventListener("dragend",   e => LeagueGroups.onLeagueDragEnd(e));
      row.addEventListener("dragover",  e => LeagueGroups.onLeagueDragOver(e));
      row.addEventListener("dragleave", e => LeagueGroups.onLeagueDragLeave(e));
      row.addEventListener("drop",      e => LeagueGroups.onLeagueDrop(e, key));

      row.querySelector(".lrow-chat-btn")?.addEventListener("click", e => {
        e.stopPropagation();
        openLeagueChat(key, _allLeagues[key]?.leagueName);
      });

      row.querySelector(".lrow-options-btn")?.addEventListener("click", e => {
        e.stopPropagation();
        openLeagueLabelModal(key);
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
    document.getElementById("label-pin-check").checked     = !!meta.pinned;
    document.getElementById("label-archive-check").checked = !!meta.archived;
    document.getElementById("label-auction-check").checked = !!meta.auctionEnabled;
    document.getElementById("label-picks-check").checked   = !!meta.auctionIncludePicks;

    // Type override — show current effective type
    const typeEl = document.getElementById("label-type-override");
    if (typeEl) typeEl.value = meta.leagueTypeOverride || "";

    document.getElementById("label-modal-save").onclick = () => _saveLeagueLabelModal();
    document.getElementById("league-label-modal").classList.remove("hidden");
    // Store the current leagueKey so _saveLeagueLabelModal can access it
    document.getElementById("league-label-modal").dataset.leagueKey = leagueKey;
  }

  async function _saveLeagueLabelModal() {
    const modal     = document.getElementById("league-label-modal");
    const leagueKey = modal?.dataset.leagueKey;
    if (!leagueKey) { showToast("Error: no league key — please close and reopen the ⋯ options", "error"); return; }
    if (!_currentUsername) { showToast("Error: not logged in", "error"); return; }
    const saveBtn  = document.getElementById("label-modal-save");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Saving…"; }
    const typeOverride = document.getElementById("label-type-override")?.value || "";
    const commishGroup = document.getElementById("label-commish-input")?.value?.trim() || "";
    const customLabel  = document.getElementById("label-custom-input")?.value?.trim()  || "";
    try {
      await saveLeagueMeta(_currentUsername, leagueKey, {
        customLabel,
        commishGroup,
        pinned:              document.getElementById("label-pin-check")?.checked     || false,
        archived:            document.getElementById("label-archive-check")?.checked || false,
        auctionEnabled:      document.getElementById("label-auction-check")?.checked || false,
        auctionIncludePicks: document.getElementById("label-picks-check")?.checked   || false,
        leagueTypeOverride:  typeOverride || null
      });

      // Propagate leagueTypeOverride to all seasons in the same franchise chain
      if (typeOverride) {
        const franchise = Object.values(_buildFranchises()).find(f =>
          f.seasons.some(s => s.key === leagueKey)
        );
        if (franchise) {
          const otherKeys = franchise.seasons
            .map(s => s.key)
            .filter(k => k !== leagueKey);
          for (const k of otherKeys) {
            const existingMeta = _leagueMeta[k] || {};
            // Only propagate if the other season doesn't have its own explicit override
            if (!existingMeta.leagueTypeOverride) {
              await saveLeagueMeta(_currentUsername, k, {
                ...existingMeta,
                leagueTypeOverride: typeOverride
              });
            }
          }
        }
      }
      // Force re-read from Firebase to verify
      await loadLeagueMeta(_currentUsername);
      // Apply type override to all affected leagues in local state
      if (typeOverride) {
        const franchise = Object.values(_buildFranchises()).find(f =>
          f.seasons.some(s => s.key === leagueKey)
        );
        const keysToUpdate = franchise
          ? franchise.seasons.map(s => s.key)
          : [leagueKey];
        keysToUpdate.forEach(k => {
          if (_allLeagues[k]) _allLeagues[k].leagueType = typeOverride;
        });
      }
      closeLabelModal();
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
      _renderLeagueFilters();
      _renderLeagues();
      if (_detailLeagueKey === leagueKey) _buildDetailTabs(leagueKey);
      showToast("League updated ✓");
    } catch(err) {
      console.error("[DLR] saveLeagueMeta failed:", err);
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
      showToast("Save failed: " + err.message, "error");
    }
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
    const yahoo   = profile.platforms?.yahoo;
    document.getElementById("sleeper-linked-user").textContent =
      sleeper?.sleeperUsername ? `@${sleeper.sleeperUsername}` : "Not connected";
    document.getElementById("mfl-linked-user").textContent =
      mfl?.mflEmail ? mfl.mflEmail : (mfl?.mflUsername ? `@${mfl.mflUsername}` : "Not connected");
    const yahooEl = document.getElementById("yahoo-linked-user");
    if (yahooEl) yahooEl.textContent = yahoo?.linked ? "Connected" : "Not connected";

    // Pre-populate MFL email field
    if (mfl?.mflEmail || mfl?.mflUsername) {
      const emailInput = document.getElementById("mfl-email-input");
      if (emailInput && !emailInput.value) emailInput.value = mfl.mflEmail || mfl.mflUsername;
    }

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
    // Update displayed elements immediately
    if (updates.bio) {
      document.getElementById("locker-tagline").textContent = updates.bio;
    }
    // Re-render team logo watermark
    _renderTeamBranding(updates.favoriteNflTeam || "");
    // Update in-memory profile
    if (_currentProfile) {
      _currentProfile.bio             = updates.bio;
      _currentProfile.favoriteNflTeam = updates.favoriteNflTeam;
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
    if (p === "mfl")     return d.mflEmail || d.mflUsername || "";
    return "";
  }
  function _escHtml(str) {
    return String(str || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ── League detail panel ────────────────────────────────────

  let _detailLeagueKey = null;
  let _detailLeague    = null;

  function openLeagueDetail(leagueKey) {
    const league = _allLeagues[leagueKey];
    if (!league) return;

    const franchiseId      = league.franchiseId || league.leagueId;
    const franchiseSeasons = Object.entries(_allLeagues)
      .filter(([, l]) => (l.franchiseId || l.leagueId) === franchiseId)
      .sort((a, b) => (b[1].season || "0").localeCompare(a[1].season || "0"));

    _detailLeagueKey = leagueKey;
    _detailLeague    = league;
    window._detailLeagueKey = leagueKey;
    DLRStandings.reset();

    // Header
    document.getElementById("detail-league-name").textContent = league.leagueName;
    document.getElementById("detail-league-meta").innerHTML = `
      <span class="league-platform-tag league-platform-tag--${league.platform}">${(league.platform||"").toUpperCase()}</span>
      <span style="color:var(--color-text-dim);font-size:.82rem;">${league.leagueType} · ${league.totalTeams} teams</span>
      ${league.isCommissioner ? '<span class="league-tag league-tag--commish">👑 Commish</span>' : ""}
    `;

    // Season pills
    const seasonSel = document.getElementById("detail-season-selector");
    if (seasonSel) {
      if (franchiseSeasons.length > 1) {
        seasonSel.style.display = "";
        seasonSel.innerHTML = franchiseSeasons.map(([k, l]) =>
          `<button class="season-pill ${k === leagueKey ? "season-pill--current" : ""}"
            data-key="${k}" onclick="Profile.switchDetailSeason('${k}')">${l.season}</button>`
        ).join("");
      } else {
        seasonSel.style.display = "none";
      }
    }

    // Reset dropdown to overview and rebuild tabs for this league
    _buildDetailTabs(leagueKey);
    const sel = document.getElementById("detail-tab-select");
    if (sel) sel.value = "overview";

    // Show panel
    document.getElementById("league-detail-panel").classList.remove("hidden");
    document.getElementById("league-detail-backdrop").classList.remove("hidden");

    // Pre-initialize auction module so canNominate/isRostered work on all tabs
    const meta3       = _leagueMeta[leagueKey] || {};
    const isSalary3   = meta3.leagueTypeOverride === "salary" || league.leagueType === "salary";
    const auctionOn3  = meta3.auctionEnabled || isSalary3;

    // Compute franchiseId once — used by both auction preInit and salary preloadCap
    const franchise4   = Object.values(_buildFranchises()).find(f => f.seasons.some(s => s.key === leagueKey));
    const franchiseId4 = franchise4?.franchiseId || leagueKey;

    if (auctionOn3) {
      const sleeperUid = league.sleeperUserId
        || _currentProfile?.platforms?.sleeper?.sleeperUserId
        || null;
      DLRAuction.preInit(leagueKey, league.leagueId, league.isCommissioner,
        league.myRosterId || null, league.teamName || "My Team",
        league.platform || "sleeper", sleeperUid, franchiseId4);
    }

    // Silently preload salary cap data so Teams tab always has cap figures
    const isSalary4 = (meta3.leagueTypeOverride === "salary") || league.leagueType === "salary";
    if (isSalary4 || meta3.auctionEnabled) {
      DLRSalaryCap.preloadCap(leagueKey, league.leagueId, franchiseId4).catch(() => {});
    }

    // Show overview content
    document.querySelectorAll(".detail-tab-content").forEach(c => c.classList.remove("active"));
    document.getElementById("dtab-overview")?.classList.add("active");
    _renderDetailTab("overview", leagueKey, league);
  }

  function onDetailTabChange(tabName) {
    document.querySelectorAll(".detail-tab-content").forEach(c => c.classList.remove("active"));
    document.getElementById(`dtab-${tabName}`)?.classList.add("active");
    _renderDetailTab(tabName, _detailLeagueKey, _detailLeague);
    // Expose current league key for chat monitor, clear badge when chat opens
    window._detailLeagueKey = _detailLeagueKey;
    if (tabName === "chat" && _detailLeagueKey) {
      if (typeof markChatSeen === "function") markChatSeen(_detailLeagueKey);
    }
  }

  // Build the tab dropdown based on league type and settings
  function _buildDetailTabs(leagueKey) {
    const sel = document.getElementById("detail-tab-select");
    if (!sel) return;
    const meta = _leagueMeta[leagueKey] || {};
    const league = _allLeagues[leagueKey] || _detailLeague || {};

    // Find franchise-level type override (any season)
    const franchise = Object.values(_buildFranchises()).find(f => f.seasons.some(s => s.key === leagueKey));
    const effectiveType = (franchise?.seasons || []).reduce((found, s) =>
      found || _leagueMeta[s.key]?.leagueTypeOverride, null
    ) || league.leagueType || "";

    const isSalary    = effectiveType === "salary";
    const auctionOn   = meta.auctionEnabled || isSalary; // commish can enable for any platform

    const tabs = [
      { val: "overview",     label: "Overview" },
      { val: "standings",    label: "Standings" },
      { val: "matchups",     label: "Matchups" },
      { val: "playoffs",     label: "Playoffs" },
      { val: "roster",       label: isSalary ? "Roster & Salaries" : "Rosters" },
      { val: "freeagents",   label: "Players" },
      { val: "draft",        label: "Draft" },
      { val: "transactions", label: "Transactions" },
      { val: "analytics",    label: "Analytics" },
      { val: "rules",        label: "Rules" },
      { val: "chat",         label: "Chat" },
    ];

    // Conditionally inject Auction tab after Free Agents
    if (auctionOn) {
      tabs.splice(tabs.findIndex(t => t.val === "freeagents") + 1, 0,
        { val: "auction", label: "Auction" }
      );
    }

    const currentVal = sel.value;
    sel.innerHTML = tabs.map(t =>
      `<option value="${t.val}">${t.label}</option>`
    ).join("");

    // Restore current selection if still valid
    if ([...sel.options].some(o => o.value === currentVal)) {
      sel.value = currentVal;
    }
  }

  function switchDetailSeason(newKey) {
    const newLeague = _allLeagues[newKey];
    if (!newLeague) return;

    _detailLeagueKey = newKey;
    _detailLeague    = newLeague;

    document.querySelectorAll("#detail-season-selector .season-pill").forEach(p => {
      p.classList.toggle("season-pill--current", p.dataset.key === newKey);
    });

    document.getElementById("detail-league-meta").innerHTML = `
      <span class="league-platform-tag league-platform-tag--${newLeague.platform}">${(newLeague.platform||"").toUpperCase()}</span>
      <span style="color:var(--color-text-dim);font-size:.82rem;">${newLeague.leagueType} · ${newLeague.totalTeams} teams</span>
      ${newLeague.isCommissioner ? '<span class="league-tag league-tag--commish">👑 Commish</span>' : ""}
    `;

    DLRStandings.reset();

    // Re-render current dropdown-selected tab
    const activeTab = document.getElementById("detail-tab-select")?.value || "overview";
    document.querySelectorAll(".detail-tab-content").forEach(c => c.classList.remove("active"));
    document.getElementById(`dtab-${activeTab}`)?.classList.add("active");
    _renderDetailTab(activeTab, newKey, newLeague);
  }

  function closeLeagueDetail() {
    document.getElementById("league-detail-panel")?.classList.add("hidden");
    document.getElementById("league-detail-backdrop")?.classList.add("hidden");
    DLRChat.unsubscribe();
    DLRStandings.reset();
    DLRRoster.reset();
    DLRDraft.reset();
    DLRAnalytics.reset();
    DLRRules.reset();
    DLRFreeAgents.reset();
    DLRSalaryCap.reset();
    DLRAuction.reset();
    _detailLeagueKey = null;
    _detailLeague    = null;
    window._detailLeagueKey = null;
  }

  async function _renderDetailTab(tab, leagueKey, league) {
    const el = document.getElementById(`dtab-${tab}`);
    if (!el) return;
    // Always set the league context so matchups/playoffs work independently
    DLRStandings.setLeague(league.leagueId, league.platform, league.season, league.leagueKey || leagueKey);
    if (tab === "overview")    await _renderOverview(el, leagueKey, league);
    if (tab === "standings")   DLRStandings.init(league.leagueId, league.platform, league.season, league.leagueKey || leagueKey, league.myRosterId || null);
    if (tab === "matchups")    DLRStandings.initMatchups();
    if (tab === "playoffs")    DLRStandings.initPlayoffs();
    if (tab === "roster") {
      // For salary cap leagues, roster tab shows salary cap view (in dtab-salary)
      const franchise2 = Object.values(_buildFranchises()).find(f => f.seasons.some(s => s.key === leagueKey));
      const effectiveType2 = (franchise2?.seasons || []).reduce((found, s) =>
        found || _leagueMeta[s.key]?.leagueTypeOverride, null
      ) || league.leagueType || "";
      if (effectiveType2 === "salary") {
        // Swap active div to dtab-salary so salary cap module renders correctly
        document.querySelectorAll(".detail-tab-content").forEach(c => c.classList.remove("active"));
        document.getElementById("dtab-salary")?.classList.add("active");
        const franchiseId2 = franchise2?.franchiseId || leagueKey;
        DLRSalaryCap.init(leagueKey, league.leagueId, league.isCommissioner, franchiseId2, league.platform, league.season, league.leagueKey || leagueKey);
      } else {
        DLRRoster.init(league.leagueId, league.platform, league.season, league.leagueKey || leagueKey, league.myRosterId || null);
      }
    }
    if (tab === "salary") {
      // Legacy path — redirect to roster tab
      const sel = document.getElementById("detail-tab-select");
      if (sel) { sel.value = "roster"; onDetailTabChange("roster"); }
    }
    if (tab === "freeagents") {
      const meta2 = _leagueMeta[leagueKey] || {};
      const franchise3 = Object.values(_buildFranchises()).find(f => f.seasons.some(s => s.key === leagueKey));
      const isSalary3 = (franchise3?.seasons || []).reduce((f, s) =>
        f || _leagueMeta[s.key]?.leagueTypeOverride, null) === "salary"
        || league.leagueType === "salary";
      const auctionOn = meta2.auctionEnabled || isSalary3;
      const incPicks  = meta2.auctionIncludePicks || false;
      DLRFreeAgents.init(league.leagueId, leagueKey, auctionOn, incPicks,
        league.myRosterId || null, league.teamName || "My Team",
        league.platform || "sleeper", league.leagueKey || leagueKey, league.season);
    }
    if (tab === "draft")         DLRDraft.init(league.leagueId, league.platform, league.season, league.leagueKey || leagueKey, league.myRosterId || null);
    if (tab === "transactions")  DLRTransactions.init(league.leagueId, league.platform, league.season, league.leagueKey || leagueKey, league.myRosterId || null);
    if (tab === "analytics")     DLRAnalytics.init(league.leagueId, league.platform, _currentUsername, league.myRosterId || null, league.season || null);
    if (tab === "rules")         DLRRules.init(league.leagueId, leagueKey, league.isCommissioner);
    if (tab === "auction") {
      const sleeperUid2 = league.sleeperUserId
        || _currentProfile?.platforms?.sleeper?.sleeperUserId
        || null;
      const franchise5  = Object.values(_buildFranchises()).find(f => f.seasons.some(s => s.key === leagueKey));
      const franchiseId5 = franchise5?.franchiseId || leagueKey;
      DLRAuction.init(
        leagueKey,
        league.leagueId,
        league.isCommissioner,
        league.myRosterId    || null,
        league.teamName      || "My Team",
        league.platform      || "sleeper",
        sleeperUid2,
        franchiseId5
      );
    }
    if (tab === "chat")        _renderChat(el, leagueKey, league);
  }

  async function _renderOverview(el, leagueKey, league) {
    // For MFL: always live-fetch if we don't have good standing data stored
    const needsLiveFetch = league.platform === "mfl" && (
      !league.wins ||
      !league.teamName ||
      league.teamName === "My Team" ||
      league.teamName === ""
    );

    if (needsLiveFetch) {
      el.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Loading overview…</span></div>`;
      try {
        const bundle       = await MFLAPI.getLeagueBundle(league.leagueId, league.season);
        const standingsMap = MFLAPI.getStandingsMap(bundle);

        // Use stored myRosterId (franchise_id) — set authoritatively on import.
        const myTeamId = league.myRosterId;
        if (myTeamId) {
          const leagueInfo    = bundle?.league?.league || {};
          const franchisesRaw = leagueInfo?.franchises?.franchise;
          const franchisesArr = franchisesRaw
            ? (Array.isArray(franchisesRaw) ? franchisesRaw : [franchisesRaw])
            : [];
          const myFranchise = franchisesArr.find(f => String(f.id) === String(myTeamId)) || {};
          const mySt        = standingsMap[String(myTeamId)] || {};

          league = {
            ...league,
            teamName:      myFranchise.name  || league.teamName || "",
            wins:          mySt.wins         || 0,
            losses:        mySt.losses       || 0,
            ties:          mySt.ties         || 0,
            pointsFor:     mySt.ptsFor       || 0,
            pointsAgainst: mySt.ptsAgainst   || 0,
            standing:      mySt.rank         || null,
          };

          if (_allLeagues[leagueKey]) {
            Object.assign(_allLeagues[leagueKey], {
              teamName:      league.teamName,
              wins:          league.wins,
              losses:        league.losses,
              ties:          league.ties,
              standing:      league.standing,
              pointsFor:     league.pointsFor,
              pointsAgainst: league.pointsAgainst,
            });
          }
          if (_detailLeagueKey === leagueKey) {
            _detailLeague = { ..._detailLeague, ...league };
          }
          if (_currentUsername) {
            _renderLeagues();
            GMDB.saveLeague(_currentUsername, leagueKey, { ..._allLeagues[leagueKey] }).catch(() => {});
          }
        }
      } catch(e) { /* render with what we have */ }
    }

    _renderOverviewHTML(el, leagueKey, league);
  }

  function _renderOverviewHTML(el, leagueKey, league) {
    const finish      = league.playoffFinish;
    const finishLabel = { 1:"🏆 Champion", 2:"🥈 Runner-Up", 3:"🥉 3rd Place", 4:"4th Place", 5:"5th Place", 6:"6th Place", 7:"Made Playoffs" }[finish] || (league.status === "complete" ? "Missed Playoffs" : "Season in Progress");
    const finishColor = { 1:"var(--color-gold)", 2:"#94a3b8", 3:"#cd7f32" }[finish] || "var(--color-text-dim)";

    // Franchise all-time stats
    const franchiseId = league.franchiseId || league.leagueId;
    const allSeasons  = Object.entries(_allLeagues)
      .filter(([, l]) => (l.franchiseId || l.leagueId) === franchiseId)
      .sort((a, b) => (b[1].season || "0").localeCompare(a[1].season || "0"));

    const totalWins   = allSeasons.reduce((s, [,l]) => s + (l.wins   || 0), 0);
    const totalLosses = allSeasons.reduce((s, [,l]) => s + (l.losses || 0), 0);
    const titles      = allSeasons.filter(([,l]) => l.playoffFinish === 1 || l.isChampion).length;
    const runnerUps   = allSeasons.filter(([,l]) => l.playoffFinish === 2).length;
    const hasHistory  = allSeasons.length > 1;

    el.innerHTML = `
      <!-- This season -->
      <div class="overview-section-title">This Season (${league.season})</div>
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
      <div class="detail-finish" style="border-color:${finishColor};color:${finishColor};">${finishLabel}</div>

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

      ${hasHistory ? `
      <!-- Franchise history -->
      <div class="overview-section-title" style="margin-top:var(--space-5);">
        Franchise History
        <span style="font-size:.75rem;font-weight:400;color:var(--color-text-dim);">
          ${totalWins}W–${totalLosses}L all-time
          ${titles > 0 ? ` · 🏆×${titles}` : ""}
          ${runnerUps > 0 ? ` · 🥈×${runnerUps}` : ""}
        </span>
      </div>
      <div class="detail-history-list">
        ${allSeasons.map(([key, s]) => {
          const f    = s.playoffFinish;
          const icon = { 1:"🏆", 2:"🥈", 3:"🥉" }[f] || (f && f <= 7 ? "🏅" : "");
          return `
            <div class="detail-history-row ${key === leagueKey ? "detail-history-row--current" : ""}"
              onclick="Profile.switchDetailSeason('${key}')" style="cursor:pointer;">
              <span class="detail-history-season">${s.season}</span>
              <span class="detail-history-team">${_escHtml(s.teamName && s.teamName !== "My Team" ? s.teamName : (s.leagueName || ""))}</span>
              <span class="detail-history-record">${s.wins}–${s.losses}</span>
              <span class="detail-history-finish">${icon} ${s.playoffResult || (s.status === "complete" ? "—" : "active")}</span>
            </div>`;
        }).join("")}
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
              <span class="detail-history-team">${_escHtml(s.teamName && s.teamName !== "My Team" ? s.teamName : (s.leagueName || ""))}</span>
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
    linkYahoo,
    renderLocker,
    renderLeaguePreview,
    openEditProfileModal,
    closeEditProfileModal,
    saveProfileEdits,
    openLeagueLabelModal,
    closeLabelModal,
    saveLeagueLabelModal: _saveLeagueLabelModal,
    initArchivedToggle,
    openLeagueDetail,
    closeLeagueDetail,
    onDetailTabChange,
    switchDetailSeason,
    openCareerSummary: _openCareerSummaryModal,
    openLeagueChat,
    closeLeagueChat,
    changePage,
    setPageSize: _noOp,
    jumpToLeague,
    toggleFilterPanel,
    toggleFilter,
    clearFilters,
    syncMFLTeams
  };

})();
