// ─────────────────────────────────────────────────────────
//  GM Dynasty — Tournament Module
//  F5 Phase 1: Foundation
//  Admin setup, role management, lifecycle, registration,
//  CSV export/import, auto-discovery
//  Firebase path: gmd/tournaments/{tournamentId}/
// ─────────────────────────────────────────────────────────

const DLRTournament = (() => {

  // ── Constants ──────────────────────────────────────────
  const STATUSES = ["draft", "registration_open", "active", "playoffs", "completed"];
  const STATUS_LABELS = {
    draft:             "Draft",
    registration_open: "Registration Open",
    active:            "In Season",
    playoffs:          "Playoffs",
    completed:         "Completed"
  };
  const STATUS_ICONS = {
    draft:             "📝",
    registration_open: "📬",
    active:            "🏈",
    playoffs:          "🏆",
    completed:         "✅"
  };

  // Standard registration fields — always on form, always required
  const STD_FIELDS = ["displayName", "email"];
  const STD_FIELD_LABELS = {
    displayName: "Display Name",
    email:       "Email Address"
  };
  // Optional platform fields — used for DLR identity matching
  const PLATFORM_FIELDS = ["sleeperUsername", "mflEmail", "yahooUsername"];
  const PLATFORM_FIELD_LABELS = {
    sleeperUsername: "Sleeper Username",
    mflEmail:        "MFL Email Address",
    yahooUsername:   "Yahoo Username"
  };
  // Optional extra fields
  const OPT_FIELDS = ["teamName", "twitterHandle", "gender"];
  const OPT_FIELD_LABELS = {
    teamName:        "Team Name",
    twitterHandle:   "Twitter/X Handle",
    gender:          "Gender (Male / Female)"
  };
  // All optional fields in display order
  const ALL_OPT_FIELDS = [...PLATFORM_FIELDS, ...OPT_FIELDS];
  const ALL_OPT_LABELS = { ...PLATFORM_FIELD_LABELS, ...OPT_FIELD_LABELS };
  // Helper: get label for any field key
  function _fieldLabel(f) {
    return STD_FIELD_LABELS[f] || ALL_OPT_LABELS[f] || _camelToLabel(f);
  }

  // ── State ──────────────────────────────────────────────
  let _currentUsername    = null;
  let _tournaments        = {};
  let _activeTournamentId = null;
  let _activeAdminTab     = "overview";
  let _activeUserTab      = "info";
  let _tournamentYear     = null;   // global year filter — null = latest
  let _rulesEditorYear    = null;   // year currently shown in admin rules editor
  let _viewingAsUser      = false;  // admin clicked "View" (participant mode)

  // ── Firebase helpers ───────────────────────────────────
  function _tRef(tid)        { return GMD.child(`tournaments/${tid}`); }
  function _tMetaRef(tid)    { return GMD.child(`tournaments/${tid}/meta`); }
  function _tPlayoffsRef(tid, year){ return year ? GMD.child(`tournaments/${tid}/playoffs/${year}`) : GMD.child(`tournaments/${tid}/playoffs`); }
  function _tScoringRef(tid)    { return GMD.child(`tournaments/${tid}/scoringSettings`); }
  function _tLeaguesRef(tid) { return GMD.child(`tournaments/${tid}/leagues`); }
  function _tRolesRef(tid)   { return GMD.child(`tournaments/${tid}/roles`); }
  function _tRegsRef(tid)    { return GMD.child(`tournaments/${tid}/registrations`); }
  function _tFormRef(tid)    { return GMD.child(`tournaments/${tid}/registrationForm`); }

  function _genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ── Public init ────────────────────────────────────────
  async function init(username) {
    _currentUsername = username;
    await _renderView();
  }

  // ── Load all tournaments visible to this user ──────────
  async function _loadTournaments() {
    const snap = await GMD.child("tournaments").once("value");
    const all  = snap.val() || {};
    // User sees tournaments where:
    //   - they are admin/sub-admin, OR
    //   - tournament is in My Tournaments (auto-discovered), OR
    //   - status is not "draft"
    _tournaments = {};
    for (const [tid, t] of Object.entries(all)) {
      if (!t || !t.meta) continue;
      const isAdmin    = t.roles?.[_currentUsername]?.role === "admin";
      const isSubAdmin = t.roles?.[_currentUsername]?.role === "sub_admin";
      const isDiscovered = t.meta.discoveredBy?.[_currentUsername];
      const notDraft      = t.meta.status !== "draft";
      const hasStandings  = t.standingsCache && Object.keys(t.standingsCache).length > 0;
      if (isAdmin || isSubAdmin || isDiscovered || notDraft || hasStandings) {
        _tournaments[tid] = t;
      }
    }
    return _tournaments;
  }

  // ── Auto-discovery: called from profile.js on sync ─────
  // Pass in the user's leagues object from Firebase
  async function runDiscovery(username, userLeagues) {
    try {
      const snap = await GMD.child("tournaments").once("value");
      const all  = snap.val() || {};
      const updates = {};

      for (const [tid, t] of Object.entries(all)) {
        if (!t?.meta || !t?.leagues) continue;
        if (t.meta.status === "draft") continue;

        // Build set of league IDs registered in this tournament
        const tLeagueIds = new Set(
          Object.values(t.leagues).map(l => String(l.leagueId || ""))
        );

        // Check if any of the user's leagues match
        const matched = Object.values(userLeagues || {}).some(l => {
          const lid = l.leagueId || l.league_id || String(l.key || "").replace(/^[a-z]+_\d*_?/, "");
          return tLeagueIds.has(String(lid));
        });

        if (matched) {
          updates[`tournaments/${tid}/meta/discoveredBy/${username}`] = true;
        }
      }

      if (Object.keys(updates).length) {
        await GMD.update(updates);
        console.log(`[Tournament] Auto-discovered ${Object.keys(updates).length} tournament(s) for ${username}`);
      }
    } catch(err) {
      console.warn("[Tournament] Discovery error:", err.message);
    }
  }

  // ── Landing view tab state ─────────────────────────────
  let _landingTab = "all"; // "mine" | "all" | "managing"

  // ── Main render ────────────────────────────────────────
  async function _renderView(tab) {
    if (tab) _landingTab = tab;
    const container = document.getElementById("view-tournament");
    if (!container) return;
    container.innerHTML = `<div class="trn-loading"><div class="spinner"></div> Loading tournaments…</div>`;

    try {
      await _loadTournaments();
    } catch(err) {
      container.innerHTML = `<div class="trn-empty">Failed to load tournaments: ${_esc(err.message)}</div>`;
      return;
    }

    const allEntries   = Object.entries(_tournaments);
    const myEntries    = allEntries.filter(([, t]) =>
      t.meta?.discoveredBy?.[_currentUsername] || t.roles?.[_currentUsername]
    );
    const adminEntries = allEntries.filter(([, t]) =>
      t.roles?.[_currentUsername]?.role === "admin" ||
      t.roles?.[_currentUsername]?.role === "sub_admin"
    );

    // Tab counts inline in select options — badges not needed

    container.innerHTML = `
      <div class="trn-container">
        <div class="trn-header">
          <div class="trn-header-left">
            <h2 class="trn-title">🏆 Tournaments</h2>
            <p class="trn-subtitle">Large-scale multi-platform competition</p>
          </div>
          <button class="btn-primary btn-sm" id="trn-create-btn">+ New Tournament</button>
        </div>

        <div class="trn-filter-row">
          <select class="trn-filter-select" id="trn-landing-select">
            <option value="all"      ${_landingTab === "all"      ? "selected" : ""}>All Tournaments</option>
            <option value="mine"     ${_landingTab === "mine"     ? "selected" : ""}>My Tournaments${myEntries.length     ? ` (${myEntries.length})`    : ""}</option>
            <option value="managing" ${_landingTab === "managing" ? "selected" : ""}>Managing${adminEntries.length ? ` (${adminEntries.length})` : ""}</option>
          </select>
        </div>

        <div id="trn-landing-body"></div>
      </div>
    `;

    document.getElementById("trn-create-btn")?.addEventListener("click", () => _openCreateModal());

    document.getElementById("trn-landing-select")?.addEventListener("change", function() {
      _landingTab = this.value;
      _renderLandingBody(allEntries, myEntries, adminEntries);
    });

    _renderLandingBody(allEntries, myEntries, adminEntries);
  }

  function _renderLandingBody(allEntries, myEntries, adminEntries) {
    const body = document.getElementById("trn-landing-body");
    if (!body) return;

    let entries, emptyIcon, emptyTitle, emptySub;

    if (_landingTab === "mine") {
      entries   = myEntries;
      emptyIcon = "🏆";
      emptyTitle = "No tournaments yet";
      emptySub  = "Sync your leagues to auto-discover tournaments you're part of, or create one.";
    } else if (_landingTab === "managing") {
      entries   = adminEntries;
      emptyIcon = "🛠";
      emptyTitle = "You're not managing any tournaments";
      emptySub  = "Create a new tournament to get started.";
    } else {
      entries   = allEntries;
      emptyIcon = "🏆";
      emptyTitle = "No tournaments found";
      emptySub  = "Be the first to create one.";
    }

    if (!entries.length) {
      body.innerHTML = `
        <div class="trn-empty">
          <div class="trn-empty-icon">${emptyIcon}</div>
          <div class="trn-empty-title">${emptyTitle}</div>
          <div class="trn-empty-sub">${emptySub}</div>
        </div>`;
      return;
    }

    const isManagingTab = _landingTab === "managing";
    body.innerHTML = `
      <div class="trn-cards-grid">
        ${entries.map(([tid, t]) => {
          const isAdmin = t.roles?.[_currentUsername]?.role === "admin" ||
                          t.roles?.[_currentUsername]?.role === "sub_admin";
          return _renderTournamentCard(tid, t, isManagingTab || isAdmin);
        }).join("")}
      </div>`;

    body.querySelectorAll("[data-trn-open]").forEach(btn => {
      btn.addEventListener("click", () => {
        _viewingAsUser = true;
        _openTournamentView(btn.dataset.trnOpen);
      });
    });
    body.querySelectorAll("[data-trn-manage]").forEach(btn => {
      btn.addEventListener("click", () => {
        _viewingAsUser = false;
        _openTournamentView(btn.dataset.trnManage);
      });
    });
  }

  function _renderTournamentCard(tid, t, isAdmin = false) {
    const meta   = t.meta || {};
    const status = meta.status || "draft";
    const leagueCount = t.leagues ? Object.keys(t.leagues).length : 0;
    const regCount    = t.registrations ? Object.keys(t.registrations).length : 0;

    return `
      <div class="trn-card" data-tid="${_esc(tid)}">
        <div class="trn-card-header">
          <div class="trn-card-name">${_esc(meta.name || "Untitled Tournament")}</div>
          <span class="trn-status-badge trn-status-${status}">
            ${STATUS_ICONS[status] || ""} ${STATUS_LABELS[status] || status}
          </span>
        </div>
        <div class="trn-card-meta">
          <span>🏟 ${leagueCount} league${leagueCount !== 1 ? "s" : ""}</span>
          <span>👥 ${regCount} registered</span>
        </div>
        ${meta.tagline ? `<div class="trn-card-tagline">${_esc(meta.tagline)}</div>` : ""}
        <div class="trn-card-actions">
          ${isAdmin ? `
            <button class="btn-primary btn-sm" data-trn-manage="${_esc(tid)}">🛠 Manage</button>
            <button class="btn-secondary btn-sm" data-trn-open="${_esc(tid)}">👁 View</button>
          ` : `
            <button class="btn-secondary btn-sm" data-trn-open="${_esc(tid)}">View</button>
          `}
        </div>
      </div>`;
  }

  // ── Create tournament modal ────────────────────────────
  function _openCreateModal() {
    _showModal(`
      <div class="modal-header">
        <h3>Create Tournament</h3>
        <button class="modal-close" id="trn-modal-close">✕</button>
      </div>
      <div class="modal-body trn-form-body">
        <div class="form-group">
          <label>Tournament Name <span class="required">*</span></label>
          <input type="text" id="trn-new-name" placeholder="e.g. Scott Fish Bowl 2025" maxlength="80" />
        </div>
        <div class="form-group">
          <label>Tagline</label>
          <input type="text" id="trn-new-tagline" placeholder="Short description shown on the card" maxlength="120" />
        </div>
        <div class="form-group">
          <label>Registration Type</label>
          <select id="trn-new-reg-type">
            <option value="open">Open — anyone with the link</option>
            <option value="invite">Invite Only</option>
          </select>
        </div>
        <div id="trn-create-error" class="auth-error hidden"></div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="trn-modal-cancel">Cancel</button>
        <button class="btn-primary"   id="trn-modal-confirm">Create Tournament</button>
      </div>
    `);

    document.getElementById("trn-modal-cancel")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-close")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-confirm")?.addEventListener("click", _doCreate);
  }

  async function _doCreate() {
    const name     = document.getElementById("trn-new-name")?.value.trim();
    const tagline  = document.getElementById("trn-new-tagline")?.value.trim();
    const regType  = document.getElementById("trn-new-reg-type")?.value || "open";
    const errEl    = document.getElementById("trn-create-error");

    if (!name) {
      if (errEl) { errEl.textContent = "Tournament name is required."; errEl.classList.remove("hidden"); }
      return;
    }

    const btn = document.getElementById("trn-modal-confirm");
    if (btn) { btn.disabled = true; btn.textContent = "Creating…"; }

    try {
      const tid = _genId();
      const now = Date.now();
      const tournament = {
        meta: {
          name,
          tagline:     tagline || "",
          status:      "draft",
          regType,
          createdAt:   now,
          createdBy:   _currentUsername,
          registrationForm: {
            fields:        STD_FIELDS,
            optionalFields: [],
            customQuestions: []
          }
        },
        leagues: {},
        registrations: {},
        roles: {
          [_currentUsername]: { role: "admin", grantedAt: now }
        }
      };

      await _tRef(tid).set(tournament);
      _closeModal();
      showToast(`Tournament "${name}" created ✓`);
      _tournaments[tid] = tournament;
      _activeTournamentId = tid;
      _writePublicSummary(tid, tournament);
      _openTournamentView(tid);
    } catch(err) {
      if (btn) { btn.disabled = false; btn.textContent = "Create Tournament"; }
      if (errEl) { errEl.textContent = err.message; errEl.classList.remove("hidden"); }
    }
  }

  // ── Tournament detail view ─────────────────────────────
  async function _openTournamentView(tid) {
    _activeTournamentId = tid;
    const container = document.getElementById("view-tournament");
    if (!container) return;

    // Reload fresh from Firebase
    let snap;
    try {
      snap = await _tRef(tid).once("value");
    } catch(err) {
      showToast("Failed to load tournament", "error");
      return;
    }
    const t = snap.val();
    if (!t) { showToast("Tournament not found", "error"); return; }
    _tournaments[tid] = t;

    const isAdmin      = t.roles?.[_currentUsername]?.role === "admin";
    const isSubAdmin   = t.roles?.[_currentUsername]?.role === "sub_admin";
    const canAdmin     = isAdmin || isSubAdmin;
    // Admin can choose to view as participant via the card's "View" button
    const showAdminNav = canAdmin && !_viewingAsUser;
    const meta         = t.meta || {};

    // Derive available years from standingsCache for the global year selector
    const scEntries    = Object.entries(t.standingsCache || {});
    const hasNewKeys   = scEntries.some(([k]) => /^\d{4}_/.test(k));
    const yearEntries  = hasNewKeys ? scEntries.filter(([k]) => /^\d{4}_/.test(k)) : scEntries;
    const availableYrs = [...new Set(yearEntries.map(([, lc]) => lc.year).filter(Boolean))].sort((a,b) => b-a);
    if (!_tournamentYear || !availableYrs.includes(_tournamentYear)) {
      _tournamentYear = availableYrs[0] || null;
    }
    // Keep _standingsYear in sync
    _standingsYear = _tournamentYear;

    // Year selector only shown in user/view mode
    const yearSel = (!showAdminNav && availableYrs.length > 1) ? `
      <div class="trn-year-selector">
        <select id="trn-global-year" class="trn-filter-select">
          ${availableYrs.map(y => `<option value="${y}" ${y === _tournamentYear ? "selected" : ""}>${y}</option>`).join("")}
        </select>
      </div>` : (!showAdminNav && availableYrs.length === 1) ? `<div class="trn-year-selector"><span class="trn-year-label">${availableYrs[0]}</span></div>` : "";

    // Build tab options based on mode
    const hasPlayoffConfig = !!(Object.keys(t.playoffs||{}).some(k => /^\d{4}$/.test(k)
      ? (t.playoffs[k]?.mode) : k === "mode"));
    const adminOpts = `
      <option value="overview"      ${_activeAdminTab === "overview"      ? "selected" : ""}>📊 Overview</option>
      <option value="leagues"       ${_activeAdminTab === "leagues"       ? "selected" : ""}>🏟 Leagues</option>
      <option value="roles"         ${_activeAdminTab === "roles"         ? "selected" : ""}>👤 Roles</option>
      <option value="registration"  ${_activeAdminTab === "registration"  ? "selected" : ""}>📝 Registration Form</option>
      <option value="registrations" ${_activeAdminTab === "registrations" ? "selected" : ""}>📋 Registrants${Object.keys(t.registrations||{}).length ? " (" + Object.keys(t.registrations).length + ")" : ""}</option>
      <option value="participants"  ${_activeAdminTab === "participants"  ? "selected" : ""}>👥 Participants${Object.keys(t.participants||{}).length ? " (" + Object.keys(t.participants).length + ")" : ""}</option>
      <option value="standings"     ${_activeAdminTab === "standings"     ? "selected" : ""}>🏆 Standings</option>
      <option value="playoffs"      ${_activeAdminTab === "playoffs"      ? "selected" : ""}>🥇 Playoffs</option>
      <option value="info_edit"     ${_activeAdminTab === "info_edit"     ? "selected" : ""}>✏ Info / Rules</option>
      <option value="players"       ${_activeAdminTab === "players"       ? "selected" : ""}>👥 Players</option>
      <option value="mostrostered"  ${_activeAdminTab === "mostrostered"  ? "selected" : ""}>🏈 Most Rostered</option>
      <option value="adpvsfinish"   ${_activeAdminTab === "adpvsfinish"   ? "selected" : ""}>🎯 ADP vs Finish</option>`;

    const userOpts = `
      <option value="info"      ${_activeUserTab === "info"      ? "selected" : ""}>ℹ Info</option>
      <option value="rules"     ${_activeUserTab === "rules"     ? "selected" : ""}>📋 Rules</option>
      <option value="standings" ${_activeUserTab === "standings" ? "selected" : ""}>🏆 Standings</option>
      ${hasPlayoffConfig ? `<option value="playoffs" ${_activeUserTab === "playoffs" ? "selected" : ""}>🥇 Playoffs</option>` : ""}
      <option value="draft"         ${_activeUserTab === "draft"         ? "selected" : ""}>📋 Draft</option>
      <option value="matchups"      ${_activeUserTab === "matchups"      ? "selected" : ""}>🏈 Matchups</option>
      <option value="rosters"       ${_activeUserTab === "rosters"       ? "selected" : ""}>🗂 Rosters</option>
      <option value="players"       ${_activeUserTab === "players"       ? "selected" : ""}>👥 Players</option>
      <option value="mostrostered"  ${_activeUserTab === "mostrostered"  ? "selected" : ""}>🏈 Most Rostered</option>
      <option value="adpvsfinish"   ${_activeUserTab === "adpvsfinish"   ? "selected" : ""}>🎯 ADP vs Finish</option>`;
    const regOpen = ["registration_open","active"].includes(meta.status);
    const regBtnHtml = (!showAdminNav && regOpen) ? `<button class="btn-primary btn-sm trn-reg-pill" id="trn-register-pill-btn">📬 Register</button>` : "";

    container.innerHTML = `
      <div class="trn-detail-container">

        <!-- Back + Header -->
        <div class="trn-detail-topbar">
          <button class="btn-ghost btn-sm" id="trn-back-btn">← All Tournaments</button>
          <div style="display:flex;align-items:center;gap:var(--space-2)">
            ${canAdmin && _viewingAsUser ? `<button class="btn-secondary btn-sm" id="trn-switch-manage-btn">🛠 Manage</button>` : ""}
            ${canAdmin && !_viewingAsUser ? `<button class="btn-ghost btn-sm" id="trn-switch-view-btn">👁 View</button>` : ""}
            <span class="trn-status-badge trn-status-${meta.status || "draft"}">
              ${STATUS_ICONS[meta.status] || ""} ${STATUS_LABELS[meta.status] || "Draft"}
            </span>
          </div>
        </div>

        <div class="trn-detail-title-row">
          <div>
            <h2 class="trn-detail-name">${_esc(meta.name || "Untitled")}</h2>
            ${meta.tagline ? `<p class="trn-detail-tagline">${_esc(meta.tagline)}</p>` : ""}
          </div>
          <div style="display:flex;gap:var(--space-2);align-items:center;flex-shrink:0">
            ${regBtnHtml}
            ${canAdmin && !_viewingAsUser ? `<button class="btn-secondary btn-sm" id="trn-edit-meta-btn">✏ Edit</button>` : ""}
          </div>
        </div>

        <!-- Global year + tab nav row -->
        <div class="trn-nav-row">
          ${yearSel}
          <select class="trn-tab-select trn-tab-select--main" id="trn-tab-select">
            ${showAdminNav ? adminOpts : userOpts}
          </select>
        </div>

        <div id="trn-tab-body" class="trn-tab-body"></div>
      </div>
    `;

    document.getElementById("trn-back-btn")?.addEventListener("click", () => _renderView(_landingTab));
    document.getElementById("trn-edit-meta-btn")?.addEventListener("click", () => _openEditMetaModal(tid, t));
    document.getElementById("trn-register-pill-btn")?.addEventListener("click", () => {
      // Open register as a full-page overlay rather than switching tabs
      _openRegisterPage(tid, t);
    });
    document.getElementById("trn-switch-view-btn")?.addEventListener("click", () => {
      _viewingAsUser = true;
      _activeUserTab = "info";
      _openTournamentView(tid);
    });
    document.getElementById("trn-switch-manage-btn")?.addEventListener("click", () => {
      _viewingAsUser = false;
      _openTournamentView(tid);
    });

    // Global year selector
    document.getElementById("trn-global-year")?.addEventListener("change", function() {
      _tournamentYear = parseInt(this.value);
      _standingsYear  = _tournamentYear;
      // Invalidate analytics caches that are year-specific
      _draftCache    = null;
      _matchupsCache = {};
      _recapCache    = {};
      _rostersCache  = null;
      _matchupsWeek  = null; // reset week so it defaults to latest for the new year
      // Re-render current tab with new year
      const curTab = showAdminNav ? _activeAdminTab : _activeUserTab;
      _renderTab(tid, curTab, t, showAdminNav);
    });

    // Tab select
    document.getElementById("trn-tab-select")?.addEventListener("change", function() {
      const tabName = this.value;
      if (showAdminNav) _activeAdminTab = tabName;
      else _activeUserTab = tabName;
      _renderTab(tid, tabName, t, showAdminNav);
    });

    // Render default tab
    const defaultTab = showAdminNav ? _activeAdminTab : _activeUserTab;
    _renderTab(tid, defaultTab, t, showAdminNav);

    // Toast for non-admin users with missing registration fields
    if (!showAdminNav) {
      const form    = t.meta?.registrationForm || {};
      const opts    = form.optionalFields || [];
      const missing = _getMissingFields(t, opts);
      if (missing.length) {
        const labels = missing.map(f => _fieldLabel(f)).join(", ");
        showToast(`Your registration for ${meta.name || "this tournament"} is missing: ${labels}`, "info", 6000);
      }
    }
  }

  // ── Tab router ─────────────────────────────────────────
  // showAdminNav: true = admin manage mode, false = participant view mode
  function _renderTab(tid, tab, t, showAdminNav) {
    const body = document.getElementById("trn-tab-body");
    if (!body) return;

    if (showAdminNav) {
      switch (tab) {
        case "overview":      return _renderAdminOverview(tid, t, body);
        case "leagues":       return _renderLeaguesTab(tid, t, body);
        case "roles":         return _renderRolesTab(tid, t, body);
        case "registration":  return _renderRegistrationFormTab(tid, t, body);
        case "registrations": return _renderRegistrantsTab(tid, t, body);
        case "participants":  return _renderParticipantsTab(tid, t, body);
        case "standings":     return _renderStandingsTab(tid, t, body, true);
        case "playoffs":      return _renderPlayoffsTab(tid, t, body);
        case "draft":         return _renderAnalyticsDraft(tid, t, body);
        case "matchups":      return _renderAnalyticsMatchups(tid, t, body);
        case "rosters":       return _renderAnalyticsRosters(tid, t, body);
        case "info_edit":     return _renderAdminInfoEdit(tid, t, body);
        case "players":       return _renderPlayersTab(tid, t, body);
        case "mostrostered":  return _renderAnalyticsMostRostered(tid, t, body);
        case "adpvsfinish":   return _renderAnalyticsADPvFinish(tid, t, body);
        default:              return _renderAdminOverview(tid, t, body);
      }
    } else {
      switch (tab) {
        case "info":       return _renderInfoTab(t, body, tid);
        case "register":   return _renderRegisterTab(tid, t, body);
        case "rules":      return _renderRulesTab(t, body);
        case "standings":  return _renderStandingsTab(tid, t, body, false);
        case "playoffs":   return _renderPlayoffsTab(tid, t, body);
        case "draft":      return _renderAnalyticsDraft(tid, t, body);
        case "matchups":   return _renderAnalyticsMatchups(tid, t, body);
        case "rosters":    return _renderAnalyticsRosters(tid, t, body);
        case "players":    return _renderPlayersTab(tid, t, body);
        case "mostrostered": return _renderAnalyticsMostRostered(tid, t, body);
        case "adpvsfinish":  return _renderAnalyticsADPvFinish(tid, t, body);
        default:           return _renderInfoTab(t, body, tid);
      }
    }
  }

  // ── Rules editor helpers ───────────────────────────────

  // Build <option> list for the year dropdown in the admin rules editor.
  // Shows all years that already have rules, plus the current calendar year
  // if not already present, sorted descending. Selects _rulesEditorYear or latest.
  function _buildRulesYearOptions(t) {
    const rby  = t.rulesByYear || {};
    const curY = new Date().getFullYear();
    // Include every year that has standings data (i.e. the tournament ran that year)
    const standingsYears = Object.values(t.standingsCache || {})
      .map(lc => lc.year).filter(Boolean).map(Number);
    // Also include the current registration year if set
    const regYear = t.meta?.registrationYear ? parseInt(t.meta.registrationYear) : null;
    const years = [...new Set([...Object.keys(rby).map(Number), ...standingsYears, regYear || curY])]
      .sort((a, b) => b - a);
    if (!_rulesEditorYear || !years.includes(Number(_rulesEditorYear))) {
      _rulesEditorYear = String(years[0]);
    }
    return years.map(y =>
      `<option value="${y}" ${String(y) === String(_rulesEditorYear) ? "selected" : ""}>${y}</option>`
    ).join("");
  }

  // Build the textarea + metadata footer for one year's rules.
  function _buildRulesEditorInner(rules) {
    rules = rules || {};
    return `
      <div class="form-group">
        <label>Rules Document</label>
        <textarea id="trn-rules-input" rows="14"
          placeholder="Enter the full rules for your tournament…&#10;&#10;Use blank lines to separate sections. URLs are auto-linked."
          style="width:100%;resize:vertical;font-family:inherit;font-size:.875rem">${_esc(rules.content || "")}</textarea>
        <span class="field-hint">Plain text — line breaks preserved. URLs become clickable links for participants.</span>
      </div>
      ${rules.updatedAt ? `
        <div style="font-size:.78rem;color:var(--color-text-dim);margin-bottom:var(--space-3)">
          Last updated: ${new Date(rules.updatedAt).toLocaleString()}
          ${rules.updatedBy ? " by @" + _esc(rules.updatedBy) : ""}
          ${rules.version ? " — v" + _esc(String(rules.version)) : ""}
        </div>
      ` : ""}
      <div class="trn-form-actions">
        <button class="btn-primary" id="trn-save-rules-btn">Publish Rules</button>
      </div>`;
  }

  // Bind (or rebind after year change) the save handler.
  function _bindSaveRulesHandler(tid, body) {
    const btn = document.getElementById("trn-save-rules-btn");
    if (!btn) return;
    btn.replaceWith(btn.cloneNode(true));  // strip old listeners
    document.getElementById("trn-save-rules-btn")?.addEventListener("click", async () => {
      const year    = _rulesEditorYear || String(new Date().getFullYear());
      const content = document.getElementById("trn-rules-input")?.value || "";
      const rby     = _tournaments[tid]?.rulesByYear || {};
      const prev    = rby[year] || {};
      const newRules = {
        content,
        version:   (parseInt(prev.version || 0)) + 1,
        updatedAt: Date.now(),
        updatedBy: _currentUsername
      };
      try {
        await GMD.child(`tournaments/${tid}/rulesByYear/${year}`).set(newRules);
        if (!_tournaments[tid].rulesByYear) _tournaments[tid].rulesByYear = {};
        _tournaments[tid].rulesByYear[year] = newRules;
        _writePublicSummary(tid, _tournaments[tid]);
        showToast(`Rules published for ${year} (v${newRules.version}) ✓`);
        // Refresh inner to show updated metadata
        const inner = document.getElementById("trn-rules-editor-inner");
        if (inner) inner.innerHTML = _buildRulesEditorInner(newRules);
        _bindSaveRulesHandler(tid, body);
      } catch(e) { showToast("Failed to publish rules", "error"); }
    });
  }

  // ── Admin: Info / Rules editor ────────────────────────
  function _renderAdminInfoEdit(tid, t, body) {
    const meta  = t.meta  || {};
    // Resolve initial editor year: keep _rulesEditorYear if valid, else latest with content, else current year
    const _rby  = t.rulesByYear || {};
    const _curY = new Date().getFullYear();
    const _rbyYears = Object.keys(_rby).map(Number).sort((a,b) => b-a);
    if (!_rulesEditorYear || !_rbyYears.includes(Number(_rulesEditorYear))) {
      _rulesEditorYear = _rbyYears.length ? String(_rbyYears[0]) : String(_curY);
    }
    const rules = _rby[_rulesEditorYear] || {};
    const social = meta.socialLinks || {};

    body.innerHTML = `
      <!-- Bio / About section -->
      <div class="trn-section-card">
        <div class="trn-section-card-title">Tournament Bio &amp; About</div>
        <div class="form-group">
          <label>Bio / Description</label>
          <textarea id="trn-bio-input" rows="6" placeholder="Write about the tournament — history, format, prizes…"
            style="width:100%;resize:vertical;font-size:.875rem">${_esc(meta.bio || "")}</textarea>
          <span class="field-hint">Supports line breaks. URLs are auto-linked for participants.</span>
        </div>
        <div class="form-group">
          <label>Donation / Entry Fee Link</label>
          <input type="url" id="trn-donation-input" value="${_esc(meta.donationLink || "")}"
            placeholder="https://paypal.me/…" />
          <span class="field-hint">Shown as a button on the Info tab.</span>
        </div>
        <div class="trn-section-card-title" style="margin-top:var(--space-4)">Social Links</div>
        ${["twitter","discord","reddit","instagram","youtube","website"].map(key => `
          <div class="form-group" style="margin-bottom:var(--space-3)">
            <label style="text-transform:capitalize">${key}</label>
            <input type="url" class="trn-social-input" data-social-key="${key}"
              value="${_esc((social[key] || ""))}"
              placeholder="${key === "twitter" ? "https://x.com/…" : key === "discord" ? "https://discord.gg/…" : "https://…"}" />
          </div>`).join("")}
        <div class="trn-form-actions">
          <button class="btn-primary" id="trn-save-info-btn">Save Info</button>
        </div>
      </div>

      <!-- Rules section -->
      <div class="trn-section-card" id="trn-rules-editor-card">
        <div class="trn-section-card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-2)">
          <span>Tournament Rules</span>
          <div style="display:flex;align-items:center;gap:var(--space-2)">
            <label style="font-size:.8rem;font-weight:500;color:var(--color-text-dim)">Year:</label>
            <select id="trn-rules-year-select" style="font-size:.8rem;padding:2px 6px">
              ${_buildRulesYearOptions(t)}
            </select>
          </div>
        </div>
        <div id="trn-rules-editor-inner">
          ${_buildRulesEditorInner(rules)}
        </div>
      </div>
    `;

    // Save info handler
    document.getElementById("trn-save-info-btn")?.addEventListener("click", async () => {
      const bio      = document.getElementById("trn-bio-input")?.value || "";
      const donation = document.getElementById("trn-donation-input")?.value.trim() || "";
      const newSocial = {};
      body.querySelectorAll(".trn-social-input").forEach(inp => {
        const val = inp.value.trim();
        if (val) newSocial[inp.dataset.socialKey] = val;
      });
      try {
        await _tMetaRef(tid).update({
          bio,
          donationLink: donation || null,
          socialLinks:  newSocial
        });
        if (_tournaments[tid]?.meta) {
          _tournaments[tid].meta.bio          = bio;
          _tournaments[tid].meta.donationLink = donation || null;
          _tournaments[tid].meta.socialLinks  = newSocial;
        }
        _writePublicSummary(tid, _tournaments[tid]);
        showToast("Info saved ✓");
      } catch(e) { showToast("Failed to save info", "error"); }
    });

    // Rules year dropdown — reload editor inner HTML on change
    document.getElementById("trn-rules-year-select")?.addEventListener("change", function() {
      _rulesEditorYear = this.value;
      const rby = _tournaments[tid]?.rulesByYear || {};
      const yr  = _rulesEditorYear;
      const inner = document.getElementById("trn-rules-editor-inner");
      if (inner) inner.innerHTML = _buildRulesEditorInner(rby[yr] || {});
      _bindSaveRulesHandler(tid, body);
    });

    // Save rules handler (extracted so year-change can rebind)
    _bindSaveRulesHandler(tid, body);
  }

  // ── Admin: Overview tab ────────────────────────────────
  function _renderAdminOverview(tid, t, body) {
    const meta      = t.meta || {};
    const leagueCount = Object.keys(t.leagues || {}).length;
    const regCount    = Object.keys(t.registrations || {}).length;
    const pendingCount = Object.values(t.registrations || {})
      .filter(r => r.status === "pending").length;
    const roleCount   = Object.keys(t.roles || {}).length;

    const statusIdx = STATUSES.indexOf(meta.status || "draft");
    const canAdvance = statusIdx < STATUSES.length - 1;
    const canRevert  = statusIdx > 0;
    const nextStatus = canAdvance ? STATUSES[statusIdx + 1] : null;

    body.innerHTML = `
      <div class="trn-overview-grid">
        <div class="trn-stat-card">
          <div class="trn-stat-value">${leagueCount}</div>
          <div class="trn-stat-label">Leagues</div>
        </div>
        <div class="trn-stat-card">
          <div class="trn-stat-value">${regCount}</div>
          <div class="trn-stat-label">Registered</div>
        </div>
        <div class="trn-stat-card trn-stat-card--${pendingCount > 0 ? "warn" : "ok"}">
          <div class="trn-stat-value">${pendingCount}</div>
          <div class="trn-stat-label">Pending Review</div>
        </div>
        <div class="trn-stat-card">
          <div class="trn-stat-value">${roleCount}</div>
          <div class="trn-stat-label">Admins/Staff</div>
        </div>
      </div>

      <!-- Lifecycle status control -->
      <div class="trn-section-card">
        <div class="trn-section-card-title">Tournament Lifecycle</div>
        <div class="trn-lifecycle-row">
          ${STATUSES.map((s, i) => `
            <div class="trn-lifecycle-step ${i <= statusIdx ? "done" : ""} ${s === meta.status ? "current" : ""}">
              <div class="trn-lifecycle-dot"></div>
              <div class="trn-lifecycle-label">${STATUS_LABELS[s]}</div>
            </div>
          `).join('<div class="trn-lifecycle-connector"></div>')}
        </div>
        <div class="trn-lifecycle-actions">
          ${canAdvance ? `<button class="btn-primary btn-sm" id="trn-advance-btn">
            Advance to ${STATUS_LABELS[nextStatus]}
          </button>` : ""}
          ${canRevert ? `<button class="btn-secondary btn-sm" id="trn-revert-btn">
            ← Revert to ${STATUS_LABELS[STATUSES[statusIdx - 1]]}
          </button>` : ""}
        </div>
      </div>

      <!-- Quick info -->
      <div class="trn-section-card">
        <div class="trn-section-card-title">Tournament Details</div>
        <div class="trn-detail-rows">
          <div class="trn-detail-row"><span>Registration</span><span>${meta.regType === "invite" ? "Invite Only" : "Open"}</span></div>
          <div class="trn-detail-row">
            <span>Standings Ranking</span>
            <span>
              <div class="trn-yn-toggle">
      		<button 
       		  class="trn-yn-btn ${(meta.rankBy || "record") === "record" ? 'trn-yn-btn--active' : ''}" 
        	  id="trn-rankby-h2h" 
        	  data-val="record">
        	  H2H
      		</button>
      		<button 
        	  class="trn-yn-btn ${meta.rankBy === "pf" ? 'trn-yn-btn--active' : ''}" 
        	  id="trn-rankby-points" 
        	  data-val="pf">
        	  Points
      		</button>
    	      </div>
            </span>
          </div>
          <div class="trn-detail-row">
            <span style="display:flex;align-items:center;gap:5px">
              Median Wins
              <button class="trn-help-btn" title="Each week, any team that beats the median score of all teams across all leagues gets an extra +1 Win credited. Sleeper leagues only.">?</button>
            </span>
            <span>
              <div class="trn-yn-toggle">
                <button class="trn-yn-btn ${meta.medianWins ? 'trn-yn-btn--active' : ''}" id="trn-median-wins-yes" data-val="true">Yes</button>
                <button class="trn-yn-btn ${!meta.medianWins ? 'trn-yn-btn--active' : ''}" id="trn-median-wins-no" data-val="false">No</button>
              </div>
            </span>
          </div>
          <div class="trn-detail-row">
            <span style="display:flex;align-items:center;gap:5px">
              3rd-Round Reversal
              <button class="trn-help-btn" title="After rounds 1 and 2 snake normally, round 3 resets — the team with the last pick in round 2 picks first again in round 3, then the draft continues as snake from there.">?</button>
            </span>
            <span>
              <div class="trn-yn-toggle">
                <button class="trn-yn-btn ${meta.thirdRoundReversal ? 'trn-yn-btn--active' : ''}" id="trn-3rr-yes" data-val="true">Yes</button>
                <button class="trn-yn-btn ${!meta.thirdRoundReversal ? 'trn-yn-btn--active' : ''}" id="trn-3rr-no" data-val="false">No</button>
              </div>
            </span>
          </div>
          <div class="trn-detail-row"><span>Created by</span><span>@${_esc(meta.createdBy || "—")}</span></div>
          <div class="trn-detail-row"><span>Created</span><span>${meta.createdAt ? new Date(meta.createdAt).toLocaleDateString() : "—"}</span></div>
        </div>
      </div>

      <!-- Playoff Configuration -->
      ${_renderPlayoffConfigHTML(tid, t, _playoffYears(t)[0] || null)}

      <!-- Preview as User -->
      <div class="trn-section-card">
        <div class="trn-section-card-title">Admin Tools</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);margin-bottom:var(--space-3)">
          <div style="font-size:.85rem;color:var(--color-text-dim)">
            Preview this tournament as a regular participant (hides admin tabs).
          </div>
          <button class="btn-secondary btn-sm" id="trn-preview-user-btn">
            👁 Preview as User
          </button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3)">
          <div style="font-size:.85rem;color:var(--color-text-dim)">
            Push latest participant data (names, handles, gender) to the public site.
          </div>
          <button class="btn-secondary btn-sm" id="trn-republish-btn">
            🔄 Re-publish Public Summary
          </button>
        </div>
      </div>

      ${pendingCount > 0 ? `
        <div class="trn-alert">
          ⚠️ You have <strong>${pendingCount}</strong> pending registration${pendingCount !== 1 ? "s" : ""} awaiting review.
          <button class="btn-secondary btn-sm" id="trn-goto-regs-btn">Review Now</button>
        </div>
      ` : ""}
    `;

    document.getElementById("trn-advance-btn")?.addEventListener("click", () =>
      _changeStatus(tid, STATUSES[statusIdx + 1])
    );
    document.getElementById("trn-revert-btn")?.addEventListener("click", () =>
      _changeStatus(tid, STATUSES[statusIdx - 1])
    );
    document.getElementById("trn-goto-regs-btn")?.addEventListener("click", () => {
      document.querySelector('.trn-tab[data-tab="registrations"]')?.click();
    });

    // Median wins Yes/No
    const _saveMedianWins = async (val) => {
      try {
        await _tMetaRef(tid).update({ medianWins: val });
        if (_tournaments[tid]?.meta) _tournaments[tid].meta.medianWins = val;
        document.getElementById("trn-median-wins-yes")?.classList.toggle("trn-yn-btn--active",  val);
        document.getElementById("trn-median-wins-no")?.classList.toggle("trn-yn-btn--active",  !val);
        showToast(val ? "Median wins enabled ✓" : "Median wins disabled ✓");
      } catch(e) { showToast("Failed to save", "error"); }
    };
    document.getElementById("trn-median-wins-yes")?.addEventListener("click", () => _saveMedianWins(true));
    document.getElementById("trn-median-wins-no")?.addEventListener("click",  () => _saveMedianWins(false));

    // 3rd-round reversal Yes/No
    const _save3RR = async (val) => {
      try {
        await _tMetaRef(tid).update({ thirdRoundReversal: val });
        if (_tournaments[tid]?.meta) _tournaments[tid].meta.thirdRoundReversal = val;
        document.getElementById("trn-3rr-yes")?.classList.toggle("trn-yn-btn--active",  val);
        document.getElementById("trn-3rr-no")?.classList.toggle("trn-yn-btn--active",  !val);
        showToast(val ? "3rd-round reversal enabled ✓" : "3rd-round reversal disabled ✓");
      } catch(e) { showToast("Failed to save", "error"); }
    };
    document.getElementById("trn-3rr-yes")?.addEventListener("click", () => _save3RR(true));
    document.getElementById("trn-3rr-no")?.addEventListener("click",  () => _save3RR(false));

const _saveRankBy = async (val) => {
  try {
    await _tMetaRef(tid).update({ rankBy: val });
    if (_tournaments[tid]?.meta) _tournaments[tid].meta.rankBy = val;
    document.getElementById("trn-rankby-h2h")?.classList.toggle("trn-yn-btn--active",    val === "record");
    document.getElementById("trn-rankby-points")?.classList.toggle("trn-yn-btn--active", val === "pf");
    _writePublicSummary(tid, _tournaments[tid]);
    showToast(val === "record" ? "Ranking set to H2H ✓" : "Ranking set to Points ✓");
  } catch(e) { showToast("Failed to save ranking method", "error"); }
};
document.getElementById("trn-rankby-h2h")?.addEventListener("click",    () => _saveRankBy("record"));
document.getElementById("trn-rankby-points")?.addEventListener("click", () => _saveRankBy("pf"));

    // Preview as User — switch to participant view mode
    document.getElementById("trn-republish-btn")?.addEventListener("click", async () => {
      const btn = document.getElementById("trn-republish-btn");
      if (btn) { btn.disabled = true; btn.textContent = "Publishing…"; }
      try {
        const snap = await _tRef(tid).once("value");
        _tournaments[tid] = snap.val();
        await _writePublicSummary(tid, _tournaments[tid]);
        await _writePublicADP(tid);
        showToast("Public summary re-published ✓");
      } catch(e) {
        showToast("Re-publish failed", "error");
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "🔄 Re-publish Public Summary"; }
      }
    });

    // Playoff config (F5-P4-A/B/C) event listeners
    _wirePlayoffConfigListeners(tid, t);

    document.getElementById("trn-preview-user-btn")?.addEventListener("click", () => {
      _viewingAsUser = true;
      _openTournamentView(tid);
    });
  }

  // _openTournamentViewAsUser removed — now handled via _viewingAsUser flag in _openTournamentView

  // ── F5-P4 Playoff Configuration ────────────────────────────────────────────
  // Year-scoped: each season's config stored at playoffs/{year}/
  // Backwards compat: flat playoffs/ node (pre-year) read as fallback on first load.
  //
  // Four modes:
  //   total_points   — no rounds; champion = highest cumulative PF through end week
  //   points_rounds  — one pool per round; top N/% advance by score each week
  //   h2h_bracket    — system-managed single-elim bracket, auto-seeded
  //   custom_rounds  — admin authors rules per round (groups, scoring blend, advancement)
  //
  // Qualification composite steps:
  //   top_record / top_pf / wins_threshold (gate) / top_subgroup (reg field filter)
  //
  // Scoring blend per round: weighted (A%+B%=100) or additive (week + avg×X%)

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function _subgroupFields(t) {
    const hardcoded = [
      { key:"gender",     label:"Gender"     },
      { key:"division",   label:"Division"   },
      { key:"conference", label:"Conference" },
    ];
    const optFields = (t?.meta?.registrationForm?.optionalFields || [])
      .filter(f => !["sleeperUsername","mflEmail","yahooUsername","email","twitterHandle"].includes(f))
      .filter(f => !hardcoded.find(h => h.key === f))
      .map(f => ({ key: f, label: _fieldLabel(f) }));
    const customQs = (t?.meta?.registrationForm?.customQuestions || [])
      .map((q, i) => ({ key: `custom_${i}`, label: q.question || `Custom Q${i+1}` }));
    return [...hardcoded, ...optFields, ...customQs];
  }

  // Get sorted playoff year list from t.playoffs (year-keyed map)
  // Returns numeric strings sorted desc. Includes legacy flat node as the active
  // year if no year keys exist.
  // Derive NFL season year(s) from league batch data
  function _nflYearsFromLeagues(t) {
    const batches = t.leagues || {};
    const years = new Set();
    Object.values(batches).forEach(b => {
      if (b && typeof b === "object" && b.year) years.add(String(b.year));
    });
    return [...years].sort((a,b) => b-a);
  }

  function _playoffYears(t) {
    const po = t.playoffs || {};
    const configured = Object.keys(po).filter(k => /^\d{4}$/.test(k));
    const leagueYears = _nflYearsFromLeagues(t);
    return [...new Set([...configured, ...leagueYears])].sort((a,b) => b-a);
  }

  // Get playoff config for a given year (or fallback to flat node)
  function _playoffForYear(t, year) {
    const po = t.playoffs || {};
    if (year && po[year]) return po[year];
    // Fallback: flat node if it has mode/startWeek/qualification set (legacy)
    if (po.mode || po.startWeek || po.qualification) {
      // Shallow copy of flat node (exclude year-keyed children)
      const flat = {};
      Object.entries(po).filter(([k]) => !/^\d{4}$/.test(k)).forEach(([k,v]) => flat[k] = v);
      return flat;
    }
    return {};
  }

  // Week stepper HTML
  function _weekStepperHTML(id, value, label, helpText) {
    const display = value ? `Wk ${value}` : "—";
    return `
      <div class="trn-detail-row">
        <span style="display:flex;align-items:center;gap:5px">
          ${_esc(label)}
          ${helpText ? `<button class="trn-help-btn" title="${_esc(helpText)}">?</button>` : ""}
        </span>
        <span>
          <div class="trn-week-stepper" id="${id}">
            <button class="trn-week-step-btn" data-dir="-1" aria-label="Decrease">−</button>
            <span class="trn-week-step-val" data-raw="${value || 0}">${display}</span>
            <button class="trn-week-step-btn" data-dir="1"  aria-label="Increase">+</button>
          </div>
        </span>
      </div>`;
  }

  // Blend row HTML
  function _blendRowHTML(idPrefix, blend) {
    const enabled = !!(blend?.enabled);
    const mode    = blend?.mode   || "weighted";
    const weight  = blend?.weight ?? 30;
    const formula = mode === "weighted"
      ? `week × ${100-weight}% + avg × ${weight}%`
      : `week score + avg × ${weight}%`;
    return `
      <div class="trn-round-blend-row">
        <label class="trn-round-blend-toggle">
          <input type="checkbox" class="trn-blend-check" ${enabled ? "checked" : ""} />
          <span>Season avg bonus</span>
        </label>
        <div class="trn-blend-weight-wrap" ${enabled ? "" : 'style="display:none"'}>
          <div class="trn-yn-toggle" style="margin-right:var(--space-1)">
            <button class="trn-yn-btn trn-blend-mode-btn trn-blend-mode-weighted
              ${mode==="weighted" ? "trn-yn-btn--active":""}">Weighted</button>
            <button class="trn-yn-btn trn-blend-mode-btn trn-blend-mode-additive
              ${mode==="additive" ? "trn-yn-btn--active":""}">Additive</button>
          </div>
          <input type="number" class="trn-blend-pct"
            min="1" max="99" value="${weight}"
            style="width:46px;font-size:.8rem;padding:2px 5px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center" />
          <span class="trn-blend-pct-label">%</span>
          <span class="trn-blend-formula">${formula}</span>
        </div>
      </div>`;
  }

  // Points-round row
  function _prRoundRowHTML(round, idx, total) {
    const advMethod  = round.advanceMethod || "count";
    const advCount   = round.advanceCount  || 4;
    const advPct     = round.advancePct    || 50;
    const wpr        = round.weeksPerRound || 1;
    const isFinal    = idx === total - 1;

    return `
      <div class="trn-pr-round-row" data-round-idx="${idx}">
        <div class="trn-pr-round-header">
          <span class="trn-pr-round-label">${isFinal ? "🏆 Championship" : `Round ${idx+1}`}</span>
          ${!isFinal ? `<button class="trn-pr-round-remove btn-secondary btn-xs" data-round-idx="${idx}">✕</button>` : ""}
        </div>
        <div class="trn-pr-round-body">
          <div class="trn-pr-advance-row" style="margin-bottom:4px">
            <span class="trn-pr-field-label">Weeks</span>
            <input type="number" class="trn-pr-wpr-input" data-round-idx="${idx}"
              min="1" max="4" value="${wpr}"
              style="width:46px;font-size:.8rem;padding:2px 5px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center" />
            <span style="font-size:.75rem;color:var(--color-text-dim)">per round (scores summed)</span>
          </div>
          ${isFinal
            ? `<div style="font-size:.78rem;color:var(--color-text-dim)">Highest combined score wins.</div>`
            : `<div class="trn-pr-advance-row">
                <span class="trn-pr-field-label">Advance</span>
                <div class="trn-yn-toggle">
                  <button class="trn-yn-btn trn-pr-adv-count-btn ${advMethod==="count"?"trn-yn-btn--active":""}"
                    data-round-idx="${idx}">Top N</button>
                  <button class="trn-yn-btn trn-pr-adv-pct-btn  ${advMethod==="pct"?"trn-yn-btn--active":""}"
                    data-round-idx="${idx}">Top %</button>
                </div>
                <input type="number" class="trn-pr-adv-count-input" data-round-idx="${idx}"
                  min="1" max="999" value="${advCount}"
                  style="width:54px;font-size:.8rem;padding:2px 5px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center;${advMethod!=="count"?"display:none;":""}" />
                <input type="number" class="trn-pr-adv-pct-input" data-round-idx="${idx}"
                  min="1" max="99" value="${advPct}"
                  style="width:46px;font-size:.8rem;padding:2px 5px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center;${advMethod!=="pct"?"display:none;":""}" />
              </div>
`}
          ${_blendRowHTML(`trn-pr-r${idx}`, round.blend)}
        </div>
      </div>`;
  }

  // Custom-round row
  function _crRoundRowHTML(round, idx, total) {
    const groups    = round.groups        || 1;
    const tpg       = round.teamsPerGroup || 8;
    const apg       = round.advPerGroup   || 2;
    const advMethod = round.advMethod     || "top_score";
    const isFinal   = idx === total - 1;

    return `
      <div class="trn-cr-round-row" data-round-idx="${idx}">
        <div class="trn-pr-round-header">
          <span class="trn-pr-round-label">${isFinal ? "🏆 Championship" : `Round ${idx+1}`}</span>
          ${!isFinal ? `<button class="trn-cr-round-remove btn-secondary btn-xs" data-round-idx="${idx}">✕</button>` : ""}
        </div>
        <div class="trn-pr-round-body">
          <div class="trn-cr-fields">
            ${["groups","per-group","adv-per-group"].map((cls,i) => {
              const vals  = [groups, tpg, apg];
              const labs  = ["Groups","Teams / group","Advance / group"];
              const names = ["trn-cr-groups","trn-cr-per-group","trn-cr-adv-per-group"];
              return `<label class="trn-cr-field">
                <span class="trn-pr-field-label">${labs[i]}</span>
                <input type="number" class="${names[i]}" data-round-idx="${idx}"
                  min="1" max="200" value="${vals[i]}"
                  style="width:54px;font-size:.8rem;padding:2px 5px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center"
                  ${isFinal && i===2 ? "disabled" : ""} />
              </label>`;
            }).join("")}
            <label class="trn-cr-field">
              <span class="trn-pr-field-label">Advance by</span>
              <select class="trn-cr-adv-method" data-round-idx="${idx}"
                style="font-size:.8rem;padding:2px 5px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text)">
                <option value="top_score" ${advMethod==="top_score"?"selected":""}>Top Score</option>
                <option value="h2h"       ${advMethod==="h2h"?"selected":""}>H2H Record</option>
              </select>
            </label>
          </div>
          <div class="trn-cr-summary" data-round-idx="${idx}">
            <span class="trn-cr-summary-text">${_crRoundSummary(groups,tpg,apg)}</span>
          </div>

          ${_blendRowHTML(`trn-cr-r${idx}`, round.blend)}
        </div>
      </div>`;
  }

  function _crRoundSummary(g, tpg, apg) {
    return `${g*tpg} teams → top ${apg} from each of ${g} group${g!==1?"s":""} → ${g*apg} advance`;
  }

  // Qualification step card
  // Helper: does the tournament have conferences/divisions configured?
  function _hasDivisions(t) {
    return Object.values(t.leagues || {}).some(b =>
      b && typeof b === "object" && Object.values(b.leagues || {}).some(l => l.division));
  }
  function _hasConferences(t) {
    return Object.values(t.leagues || {}).some(b =>
      b && typeof b === "object" && (b.conference || Object.values(b.leagues || {}).some(l => l.conference)));
  }

  function _qualStepHTML(step, idx, runningTotal, t) {
    const type     = step.type    || "top_pf";
    const count    = step.count   || 2;
    const scope    = step.scope   || "overall";   // "overall" | "conference" | "division"
    const minWins  = step.minWins || 13;
    const subField = step.subField  || "gender";
    const subValue = step.subValue  || "";
    const subMetric= step.subMetric || "pf";
    const subCount = step.subCount  || 2;
    const fields   = _subgroupFields(t);
    const hasDivs  = _hasDivisions(t);
    const hasConfs = _hasConferences(t);
    const typeLabel = {
      top_record:     "Top N by Record",
      top_pf:         "Top N by Points For",
      wins_threshold: "Wins Threshold (gate)",
      top_subgroup:   "Top N from Subgroup",
    };
    // Scoped steps (per-division/conf) show "+N per X" instead of cumulative total
    const isScoped   = (type === "top_record" || type === "top_pf" || type === "top_subgroup") && scope !== "overall";
    const scopeLabel = scope === "division" ? "per div" : scope === "conference" ? "per conf" : null;
    const slotsAdded = type === "wins_threshold" ? 0
      : type === "top_subgroup" ? subCount : count;
    const chipText   = type === "wins_threshold" ? null
      : isScoped ? `+${slotsAdded} ${scopeLabel} *`
      : `+${slotsAdded} → ${runningTotal}`;

    // Scope pill buttons — reused in record, pf, and subgroup bodies
    // Always show all three at full opacity — dimming only when user selects that scope with no groups configured
    const _scopePills = () => `
      <div class="trn-qs-scope-pills" data-step-idx="${idx}">
        <button class="trn-qs-scope-pill ${scope==="overall"    ? "trn-qs-scope-pill--active" : ""}" data-scope="overall"    data-step-idx="${idx}">Overall</button>
        <button class="trn-qs-scope-pill ${scope==="conference" ? "trn-qs-scope-pill--active" : ""}" data-scope="conference" data-step-idx="${idx}"
          ${!hasConfs ? 'title="No conferences configured yet"' : ""}>Conf</button>
        <button class="trn-qs-scope-pill ${scope==="division"   ? "trn-qs-scope-pill--active" : ""}" data-scope="division"   data-step-idx="${idx}"
          ${!hasDivs  ? 'title="No divisions configured yet"'   : ""}>Div</button>
      </div>`;
    return `
      <div class="trn-qual-step-card" data-step-idx="${idx}">
        <div class="trn-qual-step-card-header">
          <span class="trn-qual-step-num-badge">${idx+1}</span>
          <select class="trn-qs-type" data-step-idx="${idx}"
            style="font-size:.8rem;padding:3px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);flex:1;min-width:0">
            ${Object.entries(typeLabel).map(([v,l]) =>
              `<option value="${v}" ${type===v?"selected":""}>${l}</option>`).join("")}
          </select>
          <div class="trn-qs-running-total">
            ${type === "wins_threshold"
              ? `<span class="trn-qs-gate-badge">GATE</span>`
              : isScoped
                ? `<span class="trn-qs-total-chip trn-qs-total-chip--scoped" title="Total depends on number of ${scope}s">${chipText}</span>`
                : `<span class="trn-qs-total-chip">+${slotsAdded} → ${runningTotal}</span>`}
          </div>
          ${type !== "wins_threshold" ? _scopePills() : ""}
          <button class="trn-qs-remove btn-secondary btn-xs" data-step-idx="${idx}">✕</button>
        </div>
        <div class="trn-qual-step-card-body">
          <div class="trn-qs-body-record" ${type==="top_record"?"":"style=\"display:none\""}>
            <div class="trn-qs-inline-label">Take top
              <input type="number" class="trn-qs-count" data-step-idx="${idx}"
                min="1" max="999" value="${count}"
                style="width:54px;font-size:.8rem;padding:2px 5px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center;margin:0 4px" />
              <span style="font-size:.8rem;color:var(--color-text-dim)">by H2H record (not yet qualified)</span>
            </div>
          </div>
          <div class="trn-qs-body-pf" ${type==="top_pf"?"":"style=\"display:none\""}>
            <div class="trn-qs-inline-label">Take top
              <input type="number" class="trn-qs-count" data-step-idx="${idx}"
                min="1" max="999" value="${count}"
                style="width:54px;font-size:.8rem;padding:2px 5px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center;margin:0 4px" />
              <span style="font-size:.8rem;color:var(--color-text-dim)">by Points For (not yet qualified)</span>
            </div>
          </div>
          <div class="trn-qs-body-wins" ${type==="wins_threshold"?"":"style=\"display:none\""}>
            <label class="trn-qs-inline-label">Only teams with ≥
              <input type="number" class="trn-qs-min-wins" data-step-idx="${idx}"
                min="1" max="18" value="${minWins}"
                style="width:46px;font-size:.8rem;padding:2px 5px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center;margin:0 4px" />
              wins are eligible for this and all following steps.
            </label>
          </div>
          <div class="trn-qs-body-subgroup" ${type==="top_subgroup"?"":"style=\"display:none\""}>
            <div class="trn-qs-subgroup-row">
              <span class="trn-pr-field-label">Field</span>
              <select class="trn-qs-sub-field" data-step-idx="${idx}"
                style="font-size:.8rem;padding:3px 5px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text)">
                ${fields.map(f =>
                  `<option value="${_esc(f.key)}" ${subField===f.key?"selected":""}>${_esc(f.label)}</option>`
                ).join("")}
              </select>
              <span class="trn-pr-field-label">=</span>
              <input type="text" class="trn-qs-sub-value" data-step-idx="${idx}"
                value="${_esc(subValue)}" placeholder="e.g. Female"
                style="width:90px;font-size:.8rem;padding:2px 5px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text)" />
              <span class="trn-pr-field-label">Top</span>
              <input type="number" class="trn-qs-sub-count" data-step-idx="${idx}"
                min="1" max="999" value="${subCount}"
                style="width:46px;font-size:.8rem;padding:2px 5px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center" />
              <span class="trn-pr-field-label">by</span>
              <select class="trn-qs-sub-metric" data-step-idx="${idx}"
                style="font-size:.8rem;padding:3px 5px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text)">
                <option value="pf"     ${subMetric==="pf"?"selected":""}>Points For</option>
                <option value="record" ${subMetric==="record"?"selected":""}>H2H Record</option>
              </select>
            </div>
            <div class="trn-qs-subgroup-hint">Value must match registration data exactly (case-sensitive).</div>
          </div>
        </div>
      </div>`;
  }

  // ── Render playoff config ────────────────────────────────────────────────────
  // ── Playoff Config — Section-Nav Layout ──────────────────────────────────────
  // Sections in order: Playoff Format | Qualification Rules | Seeding & Byes | Round Config | Scoring
  // A <select> at the top switches which section panel is visible.
  // This keeps the admin UI scannable on both desktop and mobile.

  function _renderPlayoffConfigHTML(tid, t, activeYear) {
    const years    = _playoffYears(t);
    const po       = _playoffForYear(t, activeYear);
    const meta     = t.meta || {};
    const currentNFLYear = new Date().getMonth() >= 8
      ? new Date().getFullYear() : new Date().getFullYear() - 1;

    // ── Shared data ──────────────────────────────────────
    const mode      = po.mode || (meta.playoffStartWeek ? "h2h_bracket" : "total_points");
    const startWeek = po.startWeek || meta.playoffStartWeek || null;
    const endWeek   = po.endWeek   || null;
    const recognizeLeague = !!po.recognizeLeagueChampions;

    const qual       = po.qualification || {};
    const qualMethod = qual.method   || "composite";
    const qualCount  = qual.count    || 8;
    const qualPerGroup = qual.perGroup || 2;
    const qualSteps  = (qual.steps && qual.steps.length) ? qual.steps : [
      { type:"wins_threshold", minWins:13 },
      { type:"top_pf", count:8 }
    ];
    const _runTotals = (steps) => {
      // Returns running totals for display. Scoped steps (per-division/conference) contribute
      // their count (n per group) to display but are flagged separately so the chip shows
      // "+N per div" instead of a cumulative total that would be misleading.
      let s=0;
      return steps.map(st => {
        if (st.type==="wins_threshold") return s; // gate — no slots
        const isScoped = (st.type==="top_record"||st.type==="top_pf"||st.type==="top_subgroup")
          && (st.scope==="division"||st.scope==="conference");
        const add = st.type==="top_subgroup" ? (st.subCount||2) : (st.count||2);
        if (!isScoped) s += add; // only add to running total when overall
        return s; // for scoped steps: return current sum without adding (chip shows "+N per X" separately)
      });
    };
    const totals = _runTotals(qualSteps);

    const pr = po.pointsRounds || {};
    const prRounds = (pr.rounds && pr.rounds.length) ? pr.rounds : [
      { advanceMethod:"count", advanceCount:4, blend:null },
      { advanceMethod:"count", advanceCount:0, blend:null }
    ];
    const cr = po.customRounds || {};
    const crRounds = (cr.rounds && cr.rounds.length) ? cr.rounds : [
      { groups:4, teamsPerGroup:8, advPerGroup:2, advMethod:"top_score", blend:null },
      { groups:1, teamsPerGroup:8, advPerGroup:1, advMethod:"top_score", blend:null }
    ];

    const seeding    = po.seeding || {};
    const byes       = po.byes    || {};
    const seedMethod = seeding.method || "record";
    const byeType    = byes.type      || "none";
    const byeCount   = byes.count     || 2;
    const byeScope   = byes.scope     || "overall";
    const byeMethod  = byes.method    || "record"; // how to rank teams for bye eligibility
    const bracketSize= po.bracketSize || null;
    const effectiveQ = qualMethod==="composite"
      ? qualSteps.filter(s=>s.type!=="wins_threshold")
          .reduce((s,st)=>s+(st.type==="top_subgroup"?(st.subCount||2):(st.count||2)),0)
      : qualMethod==="top_per_group" ? qualPerGroup*4 : qualCount;
    const totalSlots       = effectiveQ + (byeType==="none"?0:byeCount);
    const suggestedBracket = Math.pow(2, Math.ceil(Math.log2(Math.max(totalSlots,2))));

    const MODE_DESC = {
      total_points:  "Champion = highest cumulative PF through season end week.",
      points_rounds: "Teams qualify, then advance each week by top score. One pool per round.",
      h2h_bracket:   "Standard single-elimination bracket. System manages draws and advancement.",
      custom_rounds: "Author each round manually: groups, teams per group, advancement rules.",
      worldcup:      "World Cup style: admin assigns teams to groups and sets the weekly matchup schedule. Teams play a round-robin regular season, then top finishers advance to an admin-seeded H2H bracket (2 weeks per round)."
    };

    // ── Year bar HTML (rendered outside sections, always visible) ────────────
    const yearBarHTML = `
      <div class="trn-playoff-year-bar trn-pc-year-bar">
        <div class="trn-playoff-year-pills" id="trn-playoff-year-pills">
          ${years.length === 0
            ? `<button class="trn-year-pill trn-year-pill--active" data-year="${currentNFLYear}">${currentNFLYear}</button>`
            : years.map(y => {
                const hasConfig = !!(t.playoffs && typeof (t.playoffs||{})[y] === "object");
                return `<span class="trn-year-pill-wrap">
                  <button class="trn-year-pill ${String(y)===String(activeYear)?"trn-year-pill--active":""}" data-year="${y}">${y}</button>
                  ${hasConfig?`<button class="trn-year-pill-del" data-del-year="${y}" title="Delete ${y} config">✕</button>`:""}
                </span>`;
              }).join("")}
        </div>
        <button class="btn-secondary btn-xs" id="trn-playoff-new-year" title="Start config for next season">+ Season</button>
      </div>
      <div class="trn-playoff-active-year-note" style="margin-bottom:var(--space-2)">
        Editing: <strong id="trn-playoff-editing-year">${activeYear || (years[0] || currentNFLYear)}</strong>
        <span style="font-size:.72rem;color:var(--color-text-dim)">(NFL year auto-detected)</span>
      </div>`;

    // ── Section A: Playoff Format ─────────────────────────────────────────────
    const sectionFormat = `
      <div class="trn-pc-section" id="trn-pc-format">
        <!-- Mode cards -->
        <div class="trn-pc-row-label">Format</div>
        <div class="trn-mode-grid">
          ${[
            { val:"total_points",  icon:"📊", label:"Total Points",  sub:"Highest PF wins"   },
            { val:"points_rounds", icon:"📈", label:"Points Rounds", sub:"Advance by score"  },
            { val:"h2h_bracket",   icon:"🥊", label:"H2H Bracket",   sub:"System bracket"    },
            { val:"custom_rounds", icon:"⚙️", label:"Custom Rounds", sub:"Author each round" },
            { val:"worldcup",      icon:"🌍", label:"World Cup",     sub:"Groups → bracket"  }
          ].map(m=>`
            <button class="trn-mode-card ${mode===m.val?"trn-mode-card--active":""}" data-mode="${m.val}">
              <span class="trn-mode-icon">${m.icon}</span>
              <span class="trn-mode-label">${m.label}</span>
              <span class="trn-mode-sub">${m.sub}</span>
            </button>`).join("")}
        </div>
        <div class="trn-mode-desc" id="trn-mode-desc">${MODE_DESC[mode]}</div>

        <!-- Season weeks -->
        <div class="trn-pc-row-label" style="margin-top:var(--space-3)">Season Weeks</div>
        <div class="trn-detail-rows">
          <div id="trn-start-week-row" ${mode==="total_points"?'style="display:none"':""}>
            ${_weekStepperHTML("trn-start-week-stepper", startWeek, "Playoff Start Week",
              "First week of playoffs. Regular-season standings exclude this week onward.")}
          </div>
          ${_weekStepperHTML("trn-end-week-stepper", endWeek, "Season End Week",
            "Last week counted — typically week 17 or 18.")}
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:var(--space-2)">
          <button class="btn-primary btn-sm" id="trn-weeks-save">Save Weeks</button>
        </div>

        <!-- League Champions -->
        <div class="trn-pc-row-label" style="margin-top:var(--space-3)">League Champions</div>
        <div class="trn-detail-rows">
          <div class="trn-detail-row">
            <span style="display:flex;align-items:center;gap:5px">Recognize League Champions
              <button class="trn-help-btn" title="Surface each league's platform champion in standings, independent of the tournament champion.">?</button>
            </span>
            <span>
              <div class="trn-yn-toggle">
                <button class="trn-yn-btn ${recognizeLeague?"trn-yn-btn--active":""}"  id="trn-league-champ-yes">Yes</button>
                <button class="trn-yn-btn ${!recognizeLeague?"trn-yn-btn--active":""}" id="trn-league-champ-no">No</button>
              </div>
            </span>
          </div>
        </div>
      </div>`;

    // ── Section B: Qualification Rules ────────────────────────────────────────
    const showQual = mode !== "total_points";
    const sectionQual = `
      <div class="trn-pc-section" id="trn-pc-qual" ${showQual?"":'style="display:none"'}>
        ${!showQual?`<div class="trn-pc-na-note">Qualification rules don't apply in Total Points mode — the full field competes.</div>`:`
        <div class="trn-detail-rows" style="margin-bottom:var(--space-3)">
          <div class="trn-detail-row">
            <span>Method</span>
            <span>
              <select id="trn-qual-method"
                style="font-size:.82rem;padding:3px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text)">
                <option value="top_record"    ${qualMethod==="top_record"?"selected":""}>Top X by Record</option>
                <option value="top_pf"        ${qualMethod==="top_pf"?"selected":""}>Top X by Points For</option>
                <option value="top_per_group" ${qualMethod==="top_per_group"?"selected":""}>Top X per Division / Conf</option>
                <option value="composite"     ${qualMethod==="composite"?"selected":""}>Composite Steps (custom)</option>
                <option value="manual"        ${qualMethod==="manual"?"selected":""}>Manual Override</option>
              </select>
            </span>
          </div>
          <div id="trn-qual-count-row" class="trn-detail-row"
            ${["top_record","top_pf"].includes(qualMethod)?"":'style="display:none"'}>
            <span>Qualifiers</span>
            <span><input type="number" id="trn-qual-count" min="2" max="999" value="${qualCount}"
              style="width:60px;font-size:.82rem;padding:2px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center" /></span>
          </div>
          <div id="trn-qual-pergroup-row" class="trn-detail-row"
            ${qualMethod==="top_per_group"?"":'style="display:none"'}>
            <span>Qualifiers per Division / Conf</span>
            <span><input type="number" id="trn-qual-pergroup" min="1" max="20" value="${qualPerGroup}"
              style="width:60px;font-size:.82rem;padding:2px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center" /></span>
          </div>
          <div id="trn-qual-manual-note" class="trn-detail-row"
            ${qualMethod==="manual"?"":'style="display:none"'}>
            <span style="color:var(--color-text-dim);font-size:.82rem;grid-column:1/-1">Hand-pick qualifiers when building the bracket.</span>
          </div>
        </div>
        <div id="trn-qual-composite-section" ${qualMethod==="composite"?"":'style="display:none"'}>
          <div id="trn-qual-steps-list" class="trn-qual-steps-list">
            ${qualSteps.map((s,i)=>_qualStepHTML(s,i,totals[i],t)).join("")}
          </div>
          <div class="trn-qual-total-row">
            Overall qualifier slots: <strong id="trn-qual-total-count">${totals[totals.length-1]||0}</strong>
            <span style="font-size:.72rem;color:var(--color-text-dim);margin-left:4px">+ steps marked * add N per division/conference (total depends on your group count)</span>
          </div>
          <div class="trn-rounds-actions" style="margin-top:var(--space-2)">
            <div style="display:flex;gap:var(--space-1);flex-wrap:wrap">
              <button class="btn-secondary btn-xs" id="trn-qs-add-record">+ Record</button>
              <button class="btn-secondary btn-xs" id="trn-qs-add-pf">+ Points For</button>
              <button class="btn-secondary btn-xs" id="trn-qs-add-wins">+ Wins Gate</button>
              <button class="btn-secondary btn-xs" id="trn-qs-add-subgroup">+ Subgroup</button>
            </div>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:var(--space-3)">
          <button class="btn-primary btn-sm" id="trn-qual-save">Save Qualification Rules</button>
        </div>`}
      </div>`;

    // ── Section C: Seeding & Byes ─────────────────────────────────────────────
    const showSeeding = mode !== "total_points";
    const sectionSeeding = `
      <div class="trn-pc-section" id="trn-pc-seeding" ${showSeeding?"":'style="display:none"'}>
        ${!showSeeding?`<div class="trn-pc-na-note">Seeding & byes don't apply in Total Points mode.</div>`:`
        <div class="trn-detail-rows">
          <!-- Seeding method — H2H bracket only -->
          <div id="trn-seed-method-row" ${mode==="h2h_bracket"?"":'style="display:none"'}>
            <div class="trn-detail-row">
              <span>Seeding Method</span>
              <span>
                <select id="trn-seed-method"
                  style="font-size:.82rem;padding:3px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text)">
                  <option value="record"     ${seedMethod==="record"?"selected":""}>By Record</option>
                  <option value="pf"         ${seedMethod==="pf"?"selected":""}>By Points For</option>
                  <option value="qual_order" ${seedMethod==="qual_order"?"selected":""}>By Qualification Order</option>
                  <option value="manual"     ${seedMethod==="manual"?"selected":""}>Manual</option>
                </select>
              </span>
            </div>
          </div>
          <div class="trn-detail-row">
            <span>Byes</span>
            <span>
              <div class="trn-yn-toggle">
                <button class="trn-yn-btn ${byeType==="none"?"trn-yn-btn--active":""}"   id="trn-bye-none">None</button>
                <button class="trn-yn-btn ${byeType==="top_n"?"trn-yn-btn--active":""}"  id="trn-bye-topn">Top N Seeds</button>
                <button class="trn-yn-btn ${byeType==="manual"?"trn-yn-btn--active":""}" id="trn-bye-manual">Manual</button>
              </div>
            </span>
          </div>
          <div class="trn-detail-row" id="trn-bye-method-row" ${byeType!=="none"?"":'style="display:none"'}>
            <span style="display:flex;align-items:center;gap:5px">Bye Eligibility Ranked By
              <button class="trn-help-btn" title="How to rank qualified teams to determine who earns a bye. Independent of the seeding method.">?</button>
            </span>
            <span>
              <select id="trn-bye-method"
                style="font-size:.82rem;padding:3px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text)">
                <option value="record" ${byeMethod==="record"?"selected":""}>H2H Record (wins, then PF)</option>
                <option value="pf"     ${byeMethod==="pf"?"selected":""}>Points For (total PF)</option>
              </select>
            </span>
          </div>
          <div class="trn-detail-row" id="trn-bye-count-row" ${byeType!=="none"?"":'style="display:none"'}>
            <span>Number of Byes
              <span class="trn-bye-scope-label" id="trn-bye-count-scope-label">
                ${byeScope==="overall"?"(overall)":byeScope==="conference"?"(per conference)":"(per division)"}
              </span>
            </span>
            <span><input type="number" id="trn-bye-count" min="1" max="9999" value="${byeCount}"
              style="width:72px;font-size:.82rem;padding:2px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center" /></span>
          </div>
          <div class="trn-detail-row" id="trn-bye-scope-row" ${byeType!=="none"?"":'style="display:none"'}>
            <span style="display:flex;align-items:center;gap:5px">Bye Scope
              <button class="trn-help-btn" title="Overall = top N across all qualified teams. Per Division = top N from each division (most common for BOTS-style). Per Conference = top N from each conference.">?</button>
            </span>
            <span>
              <div class="trn-qs-scope-pills" id="trn-bye-scope-pills">
                <button class="trn-qs-scope-pill ${byeScope==="overall"?"trn-qs-scope-pill--active":""}" data-scope="overall">Overall</button>
                <button class="trn-qs-scope-pill ${byeScope==="conference"?"trn-qs-scope-pill--active":""}" data-scope="conference">Conf</button>
                <button class="trn-qs-scope-pill ${byeScope==="division"?"trn-qs-scope-pill--active":""}" data-scope="division">Div</button>
              </div>
            </span>
          </div>
          <!-- Bracket size — H2H bracket only -->
          <div id="trn-bracket-size-row" ${mode==="h2h_bracket"?"":'style="display:none"'}>
            <div class="trn-detail-row">
              <span style="display:flex;align-items:center;gap:5px">Bracket Size
                <button class="trn-help-btn" title="Must be a power of 2.">?</button>
              </span>
              <span style="display:flex;align-items:center;gap:var(--space-2)">
                <input type="number" id="trn-bracket-size" min="4" max="128"
                  value="${bracketSize||suggestedBracket}"
                  style="width:64px;font-size:.82rem;padding:2px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center" />
                <span class="trn-bracket-suggest-chip" title="Suggested from qualifier + bye count">Suggested: ${suggestedBracket}</span>
              </span>
            </div>
          </div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:var(--space-2)">
          <button class="btn-primary btn-sm" id="trn-seeding-save">Save Byes &amp; Seeding</button>
        </div>`}
      </div>`;

    // ── Section D: Round Config ───────────────────────────────────────────────
    const showRounds = ["points_rounds","custom_rounds"].includes(mode);
    const showWC     = mode === "worldcup";

    // ── World Cup config data ─────────────────────────────────────────────────
    const wcGroups         = Array.isArray(po.worldcupGroups) ? po.worldcupGroups : [];
    const wcAdvanceCount   = po.worldcupAdvanceCount  ?? 2;
    const wcWeeksPerRound  = po.worldcupWeeksPerRound  ?? 2;
    const wcRegWeeks       = po.worldcupRegWeeks       ?? 6;
    // wcSchedule: { [gi]: { [weekIndex]: [{home, away}, ...] } }
    const wcSchedule       = po.worldcupSchedule       || {};

    // Build team list grouped by league for <optgroup> dropdowns.
    // Returns array of { leagueName, teams:[{value, label}] } sorted by league name,
    // teams alpha-sorted within each league.
    // label = "Fantasy Team Name (sleeper_handle)" so admins can identify by either.
    const _wcBuildLeagueGroups = (excludeSet) => {
      const byLeague = {};
      Object.values(t.standingsCache||{}).forEach(lc => {
        if (String(lc.year) !== String(activeYear)) return;
        const lgName = lc.leagueName || "Unknown League";
        if (!byLeague[lgName]) byLeague[lgName] = [];
        (lc.teams||[]).forEach(tm => {
          if (!tm.teamName) return;
          if (excludeSet && excludeSet.has(tm.teamName)) return;
          if (byLeague[lgName].some(e => e.value === tm.teamName)) return; // dedupe
          // Show Sleeper handle if it differs from team name (could be username or displayName)
          const handle = tm.sleeperUsername || tm.sleeperDisplayName || "";
          const label  = handle && handle.toLowerCase() !== tm.teamName.toLowerCase()
            ? `${tm.teamName} (${handle})`
            : tm.teamName;
          byLeague[lgName].push({ value: tm.teamName, label });
        });
        byLeague[lgName].sort((a, b) => a.label.localeCompare(b.label));
      });
      return Object.entries(byLeague)
        .sort(([a],[b]) => a.localeCompare(b))
        .map(([leagueName, teams]) => ({ leagueName, teams }));
    };

    // Render <optgroup> HTML for a dropdown, excluding the given members array
    const _wcOptgroupHTML = (excludeMembers) => {
      const excluded = new Set(excludeMembers || []);
      return _wcBuildLeagueGroups(excluded)
        .map(({ leagueName, teams }) => {
          if (!teams.length) return "";
          const opts = teams.map(t => `<option value="${_esc(t.value)}">${_esc(t.label)}</option>`).join("");
          return `<optgroup label="${_esc(leagueName)}">${opts}</optgroup>`;
        }).join("");
    };

    // Render one group card
    const _wcGroupCardHTML = (group, gi) => {
      const members  = group.members || [];
      const advance  = group.advanceCount ?? wcAdvanceCount;
      const memberRows = members.map((name, mi) => `
        <div class="trn-wc-member-row" data-gi="${gi}" data-mi="${mi}">
          <span class="trn-wc-member-name">${_esc(name)}</span>
          <button class="trn-wc-remove-member btn-ghost btn-xs" data-gi="${gi}" data-mi="${mi}" title="Remove">✕</button>
        </div>`).join("");
      return `
        <div class="trn-wc-group-card" data-gi="${gi}">
          <div class="trn-wc-group-header">
            <input class="trn-wc-group-name" type="text" value="${_esc(group.name||('Group '+(gi+1)))}"
              data-gi="${gi}" placeholder="Group name"
              style="font-weight:700;font-size:.85rem;background:transparent;border:none;border-bottom:1px solid var(--color-border);color:var(--color-text);padding:2px 4px;flex:1;min-width:0" />
            <button class="trn-wc-del-group btn-secondary btn-xs" data-gi="${gi}" title="Delete group">🗑</button>
          </div>
          <div class="trn-wc-adv-row">
            <span class="trn-wc-adv-label">Advance to bracket:</span>
            <input type="number" class="trn-wc-adv-count" data-gi="${gi}"
              value="${advance}" min="1" max="${Math.max(1,members.length||8)}"
              title="How many teams from this group advance to the knockout bracket"
              style="width:38px;font-size:.85rem;padding:2px 5px;text-align:center;border:1px solid var(--color-accent,#4f8ef7);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);font-weight:700" />
            <span style="font-size:.72rem;color:var(--color-text-dim)">of ${members.length||"?"}</span>
          </div>
          <div class="trn-wc-members-list" id="trn-wc-members-${gi}">${memberRows || '<div style="font-size:.75rem;color:var(--color-text-dim);padding:4px 2px">No teams yet</div>'}</div>
          <div class="trn-wc-add-row">
            <select class="trn-wc-add-select" data-gi="${gi}">
              <option value="">— Add team —</option>
              ${_wcOptgroupHTML(members)}
            </select>
          </div>
        </div>`;
    };

    // Render the schedule editor for one group
    // Schedule format stored: wcSchedule[gi] = array of weeks, each week = array of {home, away}
    const _wcScheduleForGroup = (gi) => {
      const group   = wcGroups[gi];
      if (!group || !(group.members||[]).length) return `<div class="trn-po-empty">Add teams to this group first, then build the schedule.</div>`;
      const members = group.members;
      const weeks   = wcSchedule[String(gi)] || [];

      const _weekHTML = (weekIdx) => {
        const matchups = (weeks[weekIdx] || []);
        const matchupRows = matchups.map((m, mi) => {
          const homeOpts = members.map(n => `<option value="${_esc(n)}" ${m.home===n?"selected":""}>${_esc(n)}</option>`).join("");
          const awayOpts = members.map(n => `<option value="${_esc(n)}" ${m.away===n?"selected":""}>${_esc(n)}</option>`).join("");
          return `<div class="trn-wc-matchup-row" data-gi="${gi}" data-week="${weekIdx}" data-mi="${mi}">
            <select class="trn-wc-matchup-home" data-gi="${gi}" data-week="${weekIdx}" data-mi="${mi}">${homeOpts}</select>
            <span class="trn-wc-vs">vs</span>
            <select class="trn-wc-matchup-away" data-gi="${gi}" data-week="${weekIdx}" data-mi="${mi}">${awayOpts}</select>
            <button class="trn-wc-del-matchup btn-ghost btn-xs" data-gi="${gi}" data-week="${weekIdx}" data-mi="${mi}" title="Remove">✕</button>
          </div>`;
        }).join("");
        return `<div class="trn-wc-sched-week" data-gi="${gi}" data-week="${weekIdx}">
          <div class="trn-wc-sched-week-header">
            <span class="trn-wc-sched-week-label">Week ${weekIdx+1}</span>
            <button class="trn-wc-add-matchup btn-secondary btn-xs" data-gi="${gi}" data-week="${weekIdx}">+ Game</button>
          </div>
          <div class="trn-wc-matchups-list" id="trn-wc-matchups-${gi}-${weekIdx}">${matchupRows}</div>
        </div>`;
      };

      const weekHTML = Array.from({length: wcRegWeeks}, (_, wi) => _weekHTML(wi)).join("");

      return `
        <div class="trn-wc-sched-group" id="trn-wc-sched-group-${gi}">
          <div class="trn-wc-sched-title">📅 ${_esc(group.name||("Group "+(gi+1)))} Schedule</div>
          <div class="trn-wc-sched-hint">Each team should play every other team twice (${wcRegWeeks}-week regular season). The system uses this schedule to compute W–L records and H2H tiebreakers.</div>
          <div class="trn-wc-sched-autofill-row">
            <button class="btn-secondary btn-xs trn-wc-autofill-btn" data-gi="${gi}">⚡ Auto-fill round-robin</button>
            <span style="font-size:.72rem;color:var(--color-text-dim)">Generates a full double round-robin schedule automatically (each team plays each opponent twice)</span>
          </div>
          <div class="trn-wc-weeks-grid">${weekHTML}</div>
        </div>`;
    };

    // Initially show first group's schedule, or empty state
    const wcFirstGroupSched = showWC && wcGroups.length > 0
      ? _wcScheduleForGroup(0)
      : `<div class="trn-po-empty">Add groups and teams first, then click a group tab to build its schedule.</div>`;

    const wcGroupTabsHTML = showWC ? `
      <div class="trn-wc-group-tabs" id="trn-wc-group-tabs">
        ${wcGroups.map((g,gi) => `
          <button class="trn-wc-group-tab-btn ${gi===0?"trn-wc-group-tab-btn--active":""}" data-gi="${gi}">
            ${_esc(g.name||("Group "+(gi+1)))} <span class="trn-wc-tab-count">${(g.members||[]).length}</span>
          </button>`).join("")}
      </div>` : "";

    const sectionRounds = `
      <div class="trn-pc-section" id="trn-pc-rounds">
        ${!showRounds && !showWC
          ? `<div class="trn-pc-na-note">Round configuration applies to Points Rounds, Custom Rounds, and World Cup modes only.</div>`
          : mode==="points_rounds" ? `
            <div id="trn-pr-rounds-list" class="trn-rounds-list">
              ${prRounds.map((r,i)=>_prRoundRowHTML(r,i,prRounds.length)).join("")}
            </div>
            <div class="trn-rounds-actions">
              <button class="btn-secondary btn-sm" id="trn-pr-add-round">+ Add Round</button>
              <button class="btn-primary btn-sm"   id="trn-pr-save">Save Rounds</button>
            </div>`
          : mode==="custom_rounds" ? `
            <div id="trn-cr-rounds-list" class="trn-rounds-list">
              ${crRounds.map((r,i)=>_crRoundRowHTML(r,i,crRounds.length)).join("")}
            </div>
            <div class="trn-rounds-actions">
              <button class="btn-secondary btn-sm" id="trn-cr-add-round">+ Add Round</button>
              <button class="btn-primary btn-sm"   id="trn-cr-save">Save Rounds</button>
            </div>`
          : /* worldcup */ `
            <!-- ── WC info note ── -->
            <div class="trn-section-help" style="margin-bottom:var(--space-3)">
              <strong>ℹ️ World Cup qualification is set per group.</strong>
              Each group card below has an "Advance to bracket" field — that controls how many teams from each group move on.
              The Qualification Rules and Seeding &amp; Byes sections don't apply in this mode.
            </div>
            <!-- ── WC Global Settings ── -->
            <div class="trn-wc-settings-row">
              <div class="trn-wc-setting">
                <label>Regular season weeks</label>
                <input type="number" id="trn-wc-reg-weeks" min="1" max="18" value="${wcRegWeeks}"
                  style="width:54px;font-size:.82rem;padding:2px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center" />
              </div>
              <div class="trn-wc-setting">
                <label>Default advance per group</label>
                <input type="number" id="trn-wc-default-adv" min="1" max="8" value="${wcAdvanceCount}"
                  style="width:54px;font-size:.82rem;padding:2px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center" />
              </div>
              <div class="trn-wc-setting">
                <label>Bracket: weeks per round</label>
                <input type="number" id="trn-wc-wpr" min="1" max="3" value="${wcWeeksPerRound}"
                  style="width:54px;font-size:.82rem;padding:2px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center" />
              </div>
            </div>

            <!-- ── Groups Header ── -->
            <div class="trn-wc-section-header">
              <span class="trn-pc-row-label" style="margin:0">Groups
                <span class="trn-wc-count-chip">${wcGroups.length} groups · ${wcGroups.reduce((s,g)=>s+(g.members||[]).length,0)} teams</span>
              </span>
              <div style="display:flex;gap:var(--space-2)">
                <button class="btn-secondary btn-sm" id="trn-wc-add-group">+ Add Group</button>
                <button class="btn-primary btn-sm" id="trn-wc-save-groups">💾 Save All</button>
              </div>
            </div>

            <!-- ── Groups Grid ── -->
            <div id="trn-wc-groups-list" class="trn-wc-groups-grid">
              ${wcGroups.length === 0
                ? `<div class="trn-po-empty" style="width:100%;grid-column:1/-1">No groups yet. Click "+ Add Group" to start.</div>`
                : wcGroups.map((g,gi) => _wcGroupCardHTML(g,gi)).join("")}
            </div>

            <!-- ── Schedule Builder ── -->
            <div class="trn-wc-section-header" style="margin-top:var(--space-5)">
              <span class="trn-pc-row-label" style="margin:0">Weekly Schedule
                <span class="trn-wc-count-chip">${wcRegWeeks} weeks</span>
              </span>
            </div>
            <div class="trn-section-help" style="margin-bottom:var(--space-3)">
              Define who plays who each week within each group. Scores are fetched from Sleeper using these matchup assignments — this is how W–L records and H2H tiebreakers are computed.
              Teams play each opponent twice (double round-robin). Use "Auto-fill" to generate the full schedule automatically.
            </div>
            ${wcGroupTabsHTML}
            <div id="trn-wc-sched-area">${wcFirstGroupSched}</div>
            <div class="trn-rounds-actions" style="margin-top:var(--space-3)">
              <button class="btn-primary btn-sm" id="trn-wc-save-schedule">💾 Save Schedule</button>
            </div>`}
      </div>`;

    // ── Section E: Scoring Settings ───────────────────────────────────────────
    const sectionScoring = `
      <div class="trn-pc-section" id="trn-pc-scoring">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:var(--space-1);margin-bottom:var(--space-2)">
          <span style="font-size:.78rem;color:var(--color-text-dim)">
            Syncs from your leagues for the active year. Edit inline, then publish.
          </span>
          <div style="display:flex;gap:var(--space-1)">
            <button class="btn-secondary btn-xs" id="trn-scoring-clear-btn" title="Delete stored scoring data for this year and re-sync from scratch">🗑 Clear &amp; Re-sync</button>
            <button class="btn-secondary btn-xs" id="trn-scoring-sync-btn">↺ Sync Scoring</button>
          </div>
        </div>
        <div id="trn-scoring-admin-body">
          ${_renderScoringAdminBody((t.scoringSettings || {})[activeYear] || null)}
        </div>
      </div>`;

    // ── Outer shell with section-nav select ───────────────────────────────────
    return `
      <div class="trn-section-card trn-pc-card" id="trn-playoff-config-card">
        <div class="trn-pc-header">
          <div class="trn-section-card-title" style="margin-bottom:0">🏆 Playoff Configuration</div>
          ${yearBarHTML}
          <select class="trn-pc-section-select" id="trn-pc-section-select">
            <option value="format">⚙️ Playoff Format</option>
            <option value="qual"   ${(!showQual||showWC)?"disabled":""} title="${showWC?"World Cup: set advance count on each group card instead":""}">📋 Qualification Rules${(!showQual||showWC)?" (n/a)":""}</option>
            <option value="seeding" ${(!showSeeding||showWC)?"disabled":""} title="${showWC?"World Cup: bracket seeding is done manually in the Playoffs → Bracket tab":""}">🏅 Seeding &amp; Byes${(!showSeeding||showWC)?" (n/a)":""}</option>
            <option value="rounds" ${(!showRounds&&!showWC)?"disabled":""}>🔄 Group &amp; Schedule Config${(!showRounds&&!showWC)?" (n/a)":""}</option>
            <option value="scoring">📊 Scoring Settings</option>
          </select>
        </div>
        <div class="trn-pc-body" id="trn-pc-body">
          ${sectionFormat}
          ${sectionQual}
          ${sectionSeeding}
          ${sectionRounds}
          ${sectionScoring}
        </div>
      </div>`;
  }

  // ── Wire playoff config ──────────────────────────────────────────────────────
  function _wirePlayoffConfigListeners(tid, t, initialYear) {
    const MODE_DESC = {
      total_points:  "Champion = highest cumulative PF through season end week.",
      points_rounds: "Teams qualify, then advance each week by top score. One pool per round.",
      h2h_bracket:   "Standard single-elimination bracket. System manages draws and advancement.",
      custom_rounds: "Author each round manually: groups, teams per group, advancement rules.",
      worldcup:      "World Cup style: admin assigns teams to groups and sets the weekly matchup schedule. Teams play a round-robin regular season, then top finishers advance to an admin-seeded H2H bracket (2 weeks per round)."
    };
    const currentNFLYear = String(new Date().getMonth() >= 8
      ? new Date().getFullYear() : new Date().getFullYear() - 1);
    // Use initialYear if provided (passed from _rerender to preserve selection across re-wires)
    let _activePoYear = initialYear
      || (_playoffYears(t).length ? _playoffYears(t)[0] : currentNFLYear);

    const _rerender = async (yearOverride) => {
      const yearToShow = yearOverride || _activePoYear;
      try {
        const snap = await _tRef(tid).once("value");
        if (snap.exists()) _tournaments[tid] = snap.val();
      } catch(e) {}
      const card = document.getElementById("trn-playoff-config-card");
      if (!card) return;
      const newT = _tournaments[tid] || t;
      card.outerHTML = _renderPlayoffConfigHTML(tid, newT, yearToShow);
      // Pass yearToShow so re-wire preserves the currently selected year
      _wirePlayoffConfigListeners(tid, newT, yearToShow);
      // Restore section selection
      const sel = document.getElementById("trn-pc-section-select");
      if (sel && _activePoSection) { sel.value = _activePoSection; _showPCSection(_activePoSection); }
    };

    // ── Section-nav select ──────────────────────────────
    let _activePoSection = "format";

    const _showPCSection = (sec) => {
      ["format","qual","seeding","rounds","scoring"].forEach(s => {
        const el = document.getElementById(`trn-pc-${s}`);
        if (el) el.style.display = s === sec ? "" : "none";
      });
      _activePoSection = sec;
    };

    // Show only the first section initially
    _showPCSection("format");

    document.getElementById("trn-pc-section-select")?.addEventListener("change", function() {
      _showPCSection(this.value);
    });

    // ── Year pills ──────────────────────────────────────
    document.querySelectorAll(".trn-year-pill").forEach(btn => {
      btn.addEventListener("click", async () => {
        _activePoYear = btn.dataset.year;
        await _rerender(_activePoYear);
      });
    });

    document.getElementById("trn-playoff-new-year")?.addEventListener("click", async () => {
      const years       = _playoffYears(_tournaments[tid] || t);
      const leagueYears = _nflYearsFromLeagues(_tournaments[tid] || t).map(Number);
      const maxKnown    = Math.max(...years.map(Number), ...leagueYears, parseInt(currentNFLYear));
      const nextYear    = String(maxKnown + 1);
      if (years.includes(nextYear)) { showToast(`Season ${nextYear} already exists`, "info"); return; }
      const srcYear = years[0];
      const srcData = srcYear ? (_tournaments[tid]?.playoffs?.[srcYear] || {}) : {};
      try {
        await _tPlayoffsRef(tid, nextYear).update(srcData.mode ? srcData : { mode:"total_points" });
        _activePoYear = nextYear;
        await _rerender(_activePoYear);
        showToast(`Season ${nextYear} created ✓`);
      } catch(e) { showToast("Failed to create season", "error"); }
    });

    document.querySelectorAll(".trn-year-pill-del").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const yr = btn.dataset.delYear;
        if (!confirm(`Delete the ${yr} playoff configuration? This cannot be undone.`)) return;
        try {
          await _tPlayoffsRef(tid, yr).remove();
          if (_tournaments[tid]?.playoffs) delete _tournaments[tid].playoffs[yr];
          const remaining = _playoffYears(_tournaments[tid] || t).filter(y => y !== yr);
          _activePoYear = remaining[0] || currentNFLYear;
          await _rerender(_activePoYear);
          showToast(`${yr} config deleted ✓`);
        } catch(e) { showToast("Failed to delete", "error"); }
      });
    });

    // Save helpers
    const _poSave = (updates) => _tPlayoffsRef(tid, _activePoYear).update(updates);
    const _poLocal = () => {
      if (!_tournaments[tid]) _tournaments[tid] = {};
      if (!_tournaments[tid].playoffs) _tournaments[tid].playoffs = {};
      if (!_tournaments[tid].playoffs[_activePoYear]) _tournaments[tid].playoffs[_activePoYear] = {};
      return _tournaments[tid].playoffs[_activePoYear];
    };

    // ── Mode cards ──────────────────────────────────────
    const _updateModeVisibility = (mode) => {
      // Update section-select options availability
      const sel = document.getElementById("trn-pc-section-select");
      if (sel) {
        sel.querySelector('option[value="qual"]')?.toggleAttribute("disabled",    ["total_points","worldcup"].includes(mode));
        sel.querySelector('option[value="seeding"]')?.toggleAttribute("disabled", ["total_points","worldcup"].includes(mode));
        sel.querySelector('option[value="rounds"]')?.toggleAttribute("disabled",  !["points_rounds","custom_rounds","worldcup"].includes(mode));
      }
      document.getElementById("trn-start-week-row")?.style.setProperty("display", mode==="total_points"?"none":"");
      document.getElementById("trn-seed-method-row")?.style.setProperty("display", mode==="h2h_bracket"?"":"none");
      document.getElementById("trn-bracket-size-row")?.style.setProperty("display", mode==="h2h_bracket"?"":"none");
    };

    document.querySelectorAll(".trn-mode-card").forEach(btn => {
      btn.addEventListener("click", async () => {
        const val = btn.dataset.mode;
        document.querySelectorAll(".trn-mode-card").forEach(b =>
          b.classList.toggle("trn-mode-card--active", b.dataset.mode===val));
        const descEl = document.getElementById("trn-mode-desc");
        if (descEl) descEl.textContent = MODE_DESC[val]||"";
        _updateModeVisibility(val);
        try {
          await _poSave({ mode: val });
          Object.assign(_poLocal(), { mode: val });
          showToast("Format saved ✓");
        } catch(e) { showToast("Failed to save format","error"); }
      });
    });

    // ── Week steppers ───────────────────────────────────
    const _wireWeekStepper = (id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const valEl = el.querySelector(".trn-week-step-val");
      el.querySelectorAll(".trn-week-step-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const cur = parseInt(valEl?.dataset.raw)||0;
          const dir = parseInt(btn.dataset.dir);
          let nxt   = cur===0?(dir===1?1:18):cur+dir;
          if (dir===-1&&cur===1) nxt=0;
          nxt = Math.max(0,Math.min(18,nxt));
          if (valEl) { valEl.dataset.raw=nxt; valEl.textContent=nxt?`Wk ${nxt}`:"—"; }
        });
      });
    };
    _wireWeekStepper("trn-start-week-stepper");
    _wireWeekStepper("trn-end-week-stepper");

    document.getElementById("trn-weeks-save")?.addEventListener("click", async () => {
      const sEl = document.querySelector("#trn-start-week-stepper .trn-week-step-val");
      const eEl = document.querySelector("#trn-end-week-stepper .trn-week-step-val");
      const sw  = parseInt(sEl?.dataset.raw)||null;
      const ew  = parseInt(eEl?.dataset.raw)||null;
      if (sw&&ew&&ew<sw) { showToast("End week must be ≥ start week","error"); return; }
      try {
        await _poSave({ startWeek:sw, endWeek:ew });
        await _tMetaRef(tid).update({ playoffStartWeek: sw });
        Object.assign(_poLocal(), { startWeek:sw, endWeek:ew });
        if (_tournaments[tid]?.meta) _tournaments[tid].meta.playoffStartWeek = sw;
        showToast("Weeks saved ✓");
      } catch(e) { showToast("Failed to save weeks","error"); }
    });

    // ── Qualification ───────────────────────────────────
    const qualMethodEl = document.getElementById("trn-qual-method");
    const stepsListEl  = document.getElementById("trn-qual-steps-list");
    const totalCountEl = document.getElementById("trn-qual-total-count");

    const _updateQualVis = (method) => {
      document.getElementById("trn-qual-count-row")?.style.setProperty("display",
        ["top_record","top_pf"].includes(method)?""   :"none");
      document.getElementById("trn-qual-pergroup-row")?.style.setProperty("display",
        method==="top_per_group"               ?""   :"none");
      document.getElementById("trn-qual-composite-section")?.style.setProperty("display",
        method==="composite"                    ?""   :"none");
      document.getElementById("trn-qual-manual-note")?.style.setProperty("display",
        method==="manual"                       ?""   :"none");
    };
    qualMethodEl?.addEventListener("change", ()=>_updateQualVis(qualMethodEl.value));

    const _getSteps = () => Array.from(stepsListEl?.querySelectorAll(".trn-qual-step-card")||[]).map(card => {
      const idx  = card.dataset.stepIdx;
      const type = card.querySelector(".trn-qs-type")?.value||"top_pf";
      const base = { type };
      if (["top_record","top_pf"].includes(type)) {
        base.count = parseInt(card.querySelector(`.trn-qs-count[data-step-idx="${idx}"]`)?.value)||2;
        base.scope = card.querySelector(".trn-qs-scope-pill--active")?.dataset.scope || "overall";
      }
      if (type==="wins_threshold") base.minWins = parseInt(card.querySelector(".trn-qs-min-wins")?.value)||13;
      if (type==="top_subgroup") {
        base.subField  = card.querySelector(".trn-qs-sub-field")?.value||"gender";
        base.subValue  = card.querySelector(".trn-qs-sub-value")?.value||"";
        base.subCount  = parseInt(card.querySelector(".trn-qs-sub-count")?.value)||2;
        base.subMetric = card.querySelector(".trn-qs-sub-metric")?.value||"pf";
        base.scope     = card.querySelector(".trn-qs-scope-pill--active")?.dataset.scope || "overall";
      }
      return base;
    });

    const _refreshTotals = () => {
      let sum = 0;
      stepsListEl?.querySelectorAll(".trn-qual-step-card").forEach(card => {
        const type  = card.querySelector(".trn-qs-type")?.value||"top_pf";
        const idx   = card.dataset.stepIdx;
        const scope = card.querySelector(".trn-qs-scope-pill--active")?.dataset.scope || "overall";
        const isScoped = ["top_record","top_pf","top_subgroup"].includes(type) && scope!=="overall";
        const add   = type==="wins_threshold" ? 0
          : type==="top_subgroup" ? (parseInt(card.querySelector(".trn-qs-sub-count")?.value)||2)
          : (parseInt(card.querySelector(`.trn-qs-count[data-step-idx="${idx}"]`)?.value)||2);
        if (!isScoped) sum += add;
        const chip = card.querySelector(".trn-qs-total-chip");
        if (chip) {
          if (isScoped) { chip.textContent=`+${add} ${scope==="division"?"per div":"per conf"}`; chip.title=`Total depends on # of ${scope}s`; }
          else           { chip.textContent=`+${add} → ${sum}`; chip.title=""; }
        }
      });
      if (totalCountEl) totalCountEl.textContent = sum + (stepsListEl?.querySelectorAll(".trn-qs-scope-pill--active[data-scope='division'], .trn-qs-scope-pill--active[data-scope='conference']").length?"+" : "");
    };

    const _rebuildSteps = (steps) => {
      if (!stepsListEl) return;
      let s=0;
      const tots = steps.map(st => {
        if (st.type==="wins_threshold") return s;
        s += st.type==="top_subgroup"?(st.subCount||2):(st.count||2);
        return s;
      });
      stepsListEl.innerHTML = steps.map((s,i)=>_qualStepHTML(s,i,tots[i],t)).join("");
      _wireStepEvents();
    };

    const _wireStepEvents = () => {
      stepsListEl?.querySelectorAll(".trn-qs-type").forEach(sel => {
        sel.addEventListener("change", () => {
          const idx  = sel.dataset.stepIdx;
          const card = stepsListEl.querySelector(`.trn-qual-step-card[data-step-idx="${idx}"]`);
          if (!card) return;
          const val = sel.value;
          card.querySelectorAll("[class^='trn-qs-body-']").forEach(d=>d.style.display="none");
          const bodyMap={top_record:"record",top_pf:"pf",wins_threshold:"wins",top_subgroup:"subgroup"};
          const show=card.querySelector(`.trn-qs-body-${bodyMap[val]||"pf"}`);
          if (show) show.style.display="";
          const runEl=card.querySelector(".trn-qs-running-total");
          if (val==="wins_threshold") { if(runEl) runEl.innerHTML=`<span class="trn-qs-gate-badge">GATE</span>`; }
          else if (runEl&&!runEl.querySelector(".trn-qs-total-chip")) runEl.innerHTML=`<span class="trn-qs-total-chip">+0 → 0</span>`;
          _refreshTotals();
        });
      });
      stepsListEl?.querySelectorAll(".trn-qs-count,.trn-qs-sub-count,.trn-qs-min-wins")
        .forEach(inp=>inp.addEventListener("input", _refreshTotals));
      stepsListEl?.querySelectorAll(".trn-qs-scope-pill").forEach(pill => {
        pill.addEventListener("click", () => {
          pill.closest(".trn-qs-scope-pills")?.querySelectorAll(".trn-qs-scope-pill")
            .forEach(p=>p.classList.toggle("trn-qs-scope-pill--active", p===pill));
          _refreshTotals();
        });
      });
      stepsListEl?.querySelectorAll(".trn-qs-remove").forEach(btn => {
        btn.addEventListener("click", () => {
          const steps=_getSteps(); if(steps.length<=1) return;
          steps.splice(parseInt(btn.dataset.stepIdx),1); _rebuildSteps(steps);
        });
      });
    };
    _wireStepEvents();

    const _addStep = (s) => { _rebuildSteps([..._getSteps(), s]); };
    document.getElementById("trn-qs-add-record")?.addEventListener("click",   ()=>_addStep({type:"top_record",count:2,scope:"overall"}));
    document.getElementById("trn-qs-add-pf")?.addEventListener("click",       ()=>_addStep({type:"top_pf",count:2,scope:"overall"}));
    document.getElementById("trn-qs-add-wins")?.addEventListener("click",     ()=>_addStep({type:"wins_threshold",minWins:13}));
    document.getElementById("trn-qs-add-subgroup")?.addEventListener("click", ()=>_addStep({type:"top_subgroup",subField:"gender",subValue:"",subCount:2,subMetric:"pf",scope:"overall"}));

    document.getElementById("trn-qual-save")?.addEventListener("click", async () => {
      const method = qualMethodEl?.value||"composite";
      const qualData = { method };
      if (["top_record","top_pf"].includes(method)) qualData.count    = parseInt(document.getElementById("trn-qual-count")?.value)||8;
      else if (method==="top_per_group")            qualData.perGroup = parseInt(document.getElementById("trn-qual-pergroup")?.value)||2;
      else if (method==="composite")                qualData.steps    = _getSteps();
      try {
        await _poSave({qualification:qualData});
        Object.assign(_poLocal(),{qualification:qualData});
        showToast("Qualification saved ✓");
      } catch(e) { showToast("Failed","error"); }
    });

    // ── Byes ────────────────────────────────────────────
    const _saveBye = (val) => {
      ["none","top_n","manual"].forEach(v => {
        document.getElementById(v==="top_n"?"trn-bye-topn":`trn-bye-${v}`)
          ?.classList.toggle("trn-yn-btn--active", val===v);
      });
      const showBye = val!=="none";
      ["trn-bye-method-row","trn-bye-count-row","trn-bye-scope-row"].forEach(id => {
        document.getElementById(id)?.style.setProperty("display", showBye?"":"none");
      });
    };
    document.getElementById("trn-bye-scope-pills")?.querySelectorAll(".trn-qs-scope-pill").forEach(pill=>{
      pill.addEventListener("click", () => {
        document.getElementById("trn-bye-scope-pills")?.querySelectorAll(".trn-qs-scope-pill")
          .forEach(p=>p.classList.toggle("trn-qs-scope-pill--active", p===pill));
        const sv=pill.dataset.scope||"overall";
        const lbl=document.getElementById("trn-bye-count-scope-label");
        if(lbl) lbl.textContent=sv==="overall"?"(overall)":sv==="conference"?"(per conference)":"(per division)";
      });
    });
    document.getElementById("trn-bye-none")?.addEventListener("click",   ()=>_saveBye("none"));
    document.getElementById("trn-bye-topn")?.addEventListener("click",   ()=>_saveBye("top_n"));
    document.getElementById("trn-bye-manual")?.addEventListener("click", ()=>_saveBye("manual"));
    document.getElementById("trn-seeding-save")?.addEventListener("click", async () => {
      const seedMethod  = document.getElementById("trn-seed-method")?.value||"record";
      const byeTypeEl   = document.querySelector(".trn-yn-btn--active[id^='trn-bye-']");
      const byeType     = byeTypeEl?.id==="trn-bye-topn"?"top_n":byeTypeEl?.id==="trn-bye-manual"?"manual":"none";
      const byeCount    = parseInt(document.getElementById("trn-bye-count")?.value)||2;
      const byeScope    = document.querySelector("#trn-bye-scope-pills .trn-qs-scope-pill--active")?.dataset.scope||"overall";
      const byeMethod   = document.getElementById("trn-bye-method")?.value || "record";
      const bracketSize = parseInt(document.getElementById("trn-bracket-size")?.value)||null;
      if (bracketSize&&(bracketSize&(bracketSize-1))!==0) { showToast("Bracket size must be a power of 2","error"); return; }
      try {
        const updates={seeding:{method:seedMethod},byes:{type:byeType,count:byeType!=="none"?byeCount:0,scope:byeScope,method:byeMethod},bracketSize};
        await _poSave(updates); Object.assign(_poLocal(),updates);
        showToast("Byes & seeding saved ✓");
      } catch(e) { showToast("Failed","error"); }
    });

    // ── Blend helpers (defined before PR/CR events that call them) ────────────
    const _wireBlendRow=(container)=>{
      if(!container) return;
      container.querySelectorAll(".trn-blend-check").forEach(cb=>{
        cb.addEventListener("change",()=>{ const wrap=cb.closest(".trn-round-blend-row")?.querySelector(".trn-blend-weight-wrap"); if(wrap) wrap.style.display=cb.checked?"":"none"; });
      });
      container.querySelectorAll(".trn-blend-mode-btn").forEach(btn=>{
        btn.addEventListener("click",()=>{
          const row=btn.closest(".trn-round-blend-row"); const isW=btn.classList.contains("trn-blend-mode-weighted");
          row?.querySelectorAll(".trn-blend-mode-btn").forEach(b=>b.classList.toggle("trn-yn-btn--active",b.classList.contains(isW?"trn-blend-mode-weighted":"trn-blend-mode-additive")));
          const pct=row?.querySelector(".trn-blend-pct"); const fml=row?.querySelector(".trn-blend-formula");
          const _upd=()=>{ const w=parseInt(pct?.value)||30; if(fml) fml.textContent=isW?`week × ${100-w}% + avg × ${w}%`:`week score + avg × ${w}%`; };
          pct?.addEventListener("input",_upd); _upd();
        });
      });
      container.querySelectorAll(".trn-blend-pct").forEach(inp=>{
        inp.addEventListener("input",()=>{
          const row=inp.closest(".trn-round-blend-row"); const fml=row?.querySelector(".trn-blend-formula");
          const isW=row?.querySelector(".trn-blend-mode-weighted")?.classList.contains("trn-yn-btn--active");
          const w=parseInt(inp.value)||30; if(fml) fml.textContent=isW?`week × ${100-w}% + avg × ${w}%`:`week score + avg × ${w}%`;
        });
      });
    };

    const _readBlend=(container)=>{
      const cb=container.querySelector(".trn-blend-check"); const pct=container.querySelector(".trn-blend-pct");
      const isW=container.querySelector(".trn-blend-mode-weighted")?.classList.contains("trn-yn-btn--active");
      if(!cb?.checked) return null;
      return { enabled:true, mode:isW?"weighted":"additive", weight:parseInt(pct?.value)||30 };
    };

    // ── Points Rounds ───────────────────────────────────
    const prList = document.getElementById("trn-pr-rounds-list");
    const _getPRRounds = () => Array.from(prList?.querySelectorAll(".trn-pr-round-row")||[]).map(row=>{
      const idx=row.dataset.roundIdx;
      const byPct=row.querySelector(`.trn-pr-adv-pct-btn[data-round-idx="${idx}"]`)?.classList.contains("trn-yn-btn--active");
      const wpr=parseInt(row.querySelector(".trn-pr-wpr-input")?.value)||1;
      const entry={ advanceMethod:byPct?"pct":"count", advanceCount:parseInt(row.querySelector(".trn-pr-adv-count-input")?.value)||0,
        advancePct:parseInt(row.querySelector(".trn-pr-adv-pct-input")?.value)||50, blend:_readBlend(row) };
      if(wpr>1) entry.weeksPerRound=wpr;
      return entry;
    });
    const _rebuildPR=(rounds)=>{ if(!prList)return; prList.innerHTML=rounds.map((r,i)=>_prRoundRowHTML(r,i,rounds.length)).join(""); _wirePREvents(); };
    const _wirePREvents=()=>{
      _wireBlendRow(prList);
      prList?.querySelectorAll(".trn-pr-adv-count-btn,.trn-pr-adv-pct-btn").forEach(btn=>{
        btn.addEventListener("click",()=>{
          const idx=btn.dataset.roundIdx; const byC=btn.classList.contains("trn-pr-adv-count-btn");
          prList.querySelector(`.trn-pr-adv-count-btn[data-round-idx="${idx}"]`)?.classList.toggle("trn-yn-btn--active",byC);
          prList.querySelector(`.trn-pr-adv-pct-btn[data-round-idx="${idx}"]`)?.classList.toggle("trn-yn-btn--active",!byC);
          const ci=prList.querySelector(`.trn-pr-adv-count-input[data-round-idx="${idx}"]`);
          const pi=prList.querySelector(`.trn-pr-adv-pct-input[data-round-idx="${idx}"]`);
          if(ci) ci.style.display=byC?"":"none"; if(pi) pi.style.display=byC?"none":"";
        });
      });
      prList?.querySelectorAll(".trn-pr-round-remove").forEach(btn=>{
        btn.addEventListener("click",()=>{ const r=_getPRRounds(); if(r.length<=2)return; r.splice(parseInt(btn.dataset.roundIdx),1); _rebuildPR(r); });
      });
    };
    _wirePREvents();
    document.getElementById("trn-pr-add-round")?.addEventListener("click",()=>{
      const r=_getPRRounds(); const prev=r[r.length-2];
      r.splice(r.length-1,0,{advanceMethod:"count",advanceCount:Math.max(1,(prev?.advanceCount||4)-1),blend:null}); _rebuildPR(r);
    });
    document.getElementById("trn-pr-save")?.addEventListener("click", async()=>{
      const rounds=_getPRRounds();
      try { await _poSave({pointsRounds:{rounds}}); Object.assign(_poLocal(),{pointsRounds:{rounds}}); showToast("Rounds saved ✓"); }
      catch(e) { showToast("Failed","error"); }
    });

    // ── Custom Rounds ───────────────────────────────────
    const crList=document.getElementById("trn-cr-rounds-list");
    const _getCRRounds=()=>Array.from(crList?.querySelectorAll(".trn-cr-round-row")||[]).map(row=>({
      groups:parseInt(row.querySelector(".trn-cr-groups")?.value)||1,
      teamsPerGroup:parseInt(row.querySelector(".trn-cr-per-group")?.value)||8,
      advPerGroup:parseInt(row.querySelector(".trn-cr-adv-per-group")?.value)||2,
      advMethod:row.querySelector(".trn-cr-adv-method")?.value||"top_score",
      blend:_readBlend(row)
    }));
    const _rebuildCR=(rounds)=>{ if(!crList)return; crList.innerHTML=rounds.map((r,i)=>_crRoundRowHTML(r,i,rounds.length)).join(""); _wireCREvents(); };
    const _wireCREvents=()=>{
      _wireBlendRow(crList);
      crList?.querySelectorAll(".trn-cr-round-row").forEach(row=>{
        row.querySelectorAll(".trn-cr-groups,.trn-cr-per-group,.trn-cr-adv-per-group").forEach(inp=>{
          inp.addEventListener("input",()=>{
            const idx=parseInt(row.dataset.roundIdx);
            const g=parseInt(row.querySelector(".trn-cr-groups")?.value)||1;
            const tpg=parseInt(row.querySelector(".trn-cr-per-group")?.value)||8;
            const apg=parseInt(row.querySelector(".trn-cr-adv-per-group")?.value)||2;
            const el=crList?.querySelector(`.trn-cr-summary[data-round-idx="${idx}"]`);
            if(el) el.innerHTML=`<span class="trn-cr-summary-text">${_crRoundSummary(g,tpg,apg)}</span>`;
          });
        });
      });
      crList?.querySelectorAll(".trn-cr-round-remove").forEach(btn=>{
        btn.addEventListener("click",()=>{ const r=_getCRRounds(); if(r.length<=2)return; r.splice(parseInt(btn.dataset.roundIdx),1); _rebuildCR(r); });
      });
    };
    _wireCREvents();
    document.getElementById("trn-cr-add-round")?.addEventListener("click",()=>{
      const r=_getCRRounds(); r.splice(r.length-1,0,{groups:1,teamsPerGroup:8,advPerGroup:4,advMethod:"top_score",blend:null}); _rebuildCR(r);
    });
    document.getElementById("trn-cr-save")?.addEventListener("click", async()=>{
      const rounds=_getCRRounds();
      try { await _poSave({customRounds:{rounds}}); Object.assign(_poLocal(),{customRounds:{rounds}}); showToast("Rounds saved ✓"); }
      catch(e) { showToast("Failed","error"); }
    });

    // ── World Cup: Group Builder + Schedule Wiring ───────────────────────────
    // Only wires if #trn-wc-groups-list exists (i.e. worldcup mode is active)
    if (document.getElementById("trn-wc-groups-list")) {

      // ── Helpers ────────────────────────────────────────
      const _wcReadGroups = () => {
        return Array.from(document.querySelectorAll("#trn-wc-groups-list .trn-wc-group-card"))
          .map(card => {
            const gi = card.dataset.gi;
            return {
              name:         card.querySelector(".trn-wc-group-name")?.value.trim() || ("Group "+(parseInt(gi)+1)),
              advanceCount: parseInt(card.querySelector(".trn-wc-adv-count")?.value) || 2,
              members:      Array.from(card.querySelectorAll(".trn-wc-member-name")).map(el => el.textContent.trim())
            };
          });
      };

      // Read the full schedule from the DOM (all weeks, all groups)
      const _wcReadSchedule = () => {
        const sched = {};
        document.querySelectorAll(".trn-wc-sched-week").forEach(weekEl => {
          const gi   = weekEl.dataset.gi;
          const week = weekEl.dataset.week;
          if (!sched[gi]) sched[gi] = {};
          sched[gi][week] = Array.from(weekEl.querySelectorAll(".trn-wc-matchup-row")).map(row => ({
            home: row.querySelector(".trn-wc-matchup-home")?.value || "",
            away: row.querySelector(".trn-wc-matchup-away")?.value || ""
          })).filter(m => m.home && m.away && m.home !== m.away);
        });
        return sched;
      };

      // Re-render a member list for a group card in-place and refresh its dropdown
      const _wcRenderMembers = (gi, members) => {
        // Update member list
        const listEl = document.getElementById(`trn-wc-members-${gi}`);
        if (listEl) {
          listEl.innerHTML = members.length
            ? members.map((name, mi) => `
                <div class="trn-wc-member-row" data-gi="${gi}" data-mi="${mi}">
                  <span class="trn-wc-member-name">${_esc(name)}</span>
                  <button class="trn-wc-remove-member btn-ghost btn-xs" data-gi="${gi}" data-mi="${mi}" title="Remove">✕</button>
                </div>`).join("")
            : '<div style="font-size:.75rem;color:var(--color-text-dim);padding:4px 2px">No teams yet</div>';
        }
        // Refresh dropdown — rebuild with optgroups excluding current members
        const sel = document.querySelector(`.trn-wc-add-select[data-gi="${gi}"]`);
        if (sel) {
          sel.innerHTML = `<option value="">— Add team —</option>` + _wcBuildDropdownOptgroups(members);
        }
        // Update "of N" count label
        const card = document.querySelector(`.trn-wc-group-card[data-gi="${gi}"]`);
        const ofSpan = card?.querySelector(".trn-wc-adv-row span:last-child");
        if (ofSpan) ofSpan.textContent = `of ${members.length||"?"}`;
        // Update max on the advance input
        const advInput = card?.querySelector(".trn-wc-adv-count");
        if (advInput && members.length) advInput.max = members.length;
        _wcWireGroupCard(gi);
      };

      // Build <optgroup> innerHTML for a dropdown, excluding the given member names.
      // Reads live from standingsCache so it's always up to date.
      const _wcBuildDropdownOptgroups = (excludeMembers) => {
        const excluded = new Set(excludeMembers || []);
        const tData    = _tournaments[_activeTournamentId] || t;
        const byLeague = {};
        Object.values(tData.standingsCache||{}).forEach(lc => {
          if (String(lc.year) !== String(_activePoYear)) return;
          const lgName = lc.leagueName || "Unknown League";
          if (!byLeague[lgName]) byLeague[lgName] = [];
          (lc.teams||[]).forEach(tm => {
            if (!tm.teamName || excluded.has(tm.teamName)) return;
            if (byLeague[lgName].some(e => e.value === tm.teamName)) return;
            const handle = tm.sleeperUsername || tm.sleeperDisplayName || "";
            const label  = handle && handle.toLowerCase() !== tm.teamName.toLowerCase()
              ? `${tm.teamName} (${handle})`
              : tm.teamName;
            byLeague[lgName].push({ value: tm.teamName, label });
          });
          byLeague[lgName].sort((a, b) => a.label.localeCompare(b.label));
        });
        return Object.entries(byLeague)
          .sort(([a],[b]) => a.localeCompare(b))
          .map(([lgName, teams]) => {
            if (!teams.length) return "";
            const opts = teams.map(e => `<option value="${_esc(e.value)}">${_esc(e.label)}</option>`).join("");
            return `<optgroup label="${_esc(lgName)}">${opts}</optgroup>`;
          }).join("");
      };

      // Wire remove-member + add-select for one group card
      const _wcWireGroupCard = (gi) => {
        document.querySelectorAll(`.trn-wc-remove-member[data-gi="${gi}"]`).forEach(btn => {
          btn.onclick = () => {
            const mi     = parseInt(btn.dataset.mi);
            const groups = _wcReadGroups();
            if (!groups[gi]) return;
            groups[gi].members.splice(mi, 1);
            _wcRenderMembers(gi, groups[gi].members);
          };
        });
        const addSel = document.querySelector(`.trn-wc-add-select[data-gi="${gi}"]`);
        if (addSel) addSel.onchange = function() {
          const name = this.value; if (!name) return; this.value = "";
          const groups = _wcReadGroups();
          if (!groups[gi]) return;
          if (groups[gi].members.includes(name)) { showToast("Already in this group","info"); return; }
          groups[gi].members.push(name);
          _wcRenderMembers(gi, groups[gi].members);
        };
        const delBtn = document.querySelector(`.trn-wc-del-group[data-gi="${gi}"]`);
        if (delBtn) delBtn.onclick = () => {
          if (!confirm(`Delete ${document.querySelector(`.trn-wc-group-name[data-gi="${gi}"]`)?.value||("Group "+(parseInt(gi)+1))}?`)) return;
          const card = document.querySelector(`.trn-wc-group-card[data-gi="${gi}"]`);
          card?.remove();
          // Re-index remaining cards
          document.querySelectorAll(".trn-wc-group-card").forEach((c, newGi) => {
            c.dataset.gi = newGi;
            c.querySelector(".trn-wc-group-name")?.setAttribute("data-gi", newGi);
            c.querySelector(".trn-wc-adv-count")?.setAttribute("data-gi", newGi);
            c.querySelector(".trn-wc-del-group")?.setAttribute("data-gi", newGi);
            c.querySelector(".trn-wc-add-select")?.setAttribute("data-gi", newGi);
            c.querySelectorAll(".trn-wc-member-row").forEach((r,mi) => {
              r.dataset.gi = newGi; r.querySelector(".trn-wc-remove-member")?.setAttribute("data-gi", newGi);
            });
            if (c.querySelector(".trn-wc-members-list")) c.querySelector(".trn-wc-members-list").id = `trn-wc-members-${newGi}`;
            _wcWireGroupCard(newGi);
          });
          const listEl = document.getElementById("trn-wc-groups-list");
          if (listEl && !listEl.querySelector(".trn-wc-group-card")) {
            listEl.innerHTML = `<div class="trn-po-empty" style="grid-column:1/-1">No groups yet.</div>`;
          }
        };
      };

      // Wire all existing group cards
      document.querySelectorAll(".trn-wc-group-card").forEach(card => _wcWireGroupCard(parseInt(card.dataset.gi)));

      // ── Add Group button ────────────────────────────────
      document.getElementById("trn-wc-add-group")?.addEventListener("click", () => {
        const listEl = document.getElementById("trn-wc-groups-list");
        if (!listEl) return;
        listEl.querySelector(".trn-po-empty")?.remove();
        const gi     = listEl.querySelectorAll(".trn-wc-group-card").length;
        const defAdv = parseInt(document.getElementById("trn-wc-default-adv")?.value) || 2;
        const card   = document.createElement("div");
        card.className = "trn-wc-group-card"; card.dataset.gi = gi;
        card.innerHTML = `
          <div class="trn-wc-group-header">
            <input class="trn-wc-group-name" type="text" value="Group ${gi+1}" data-gi="${gi}"
              style="font-weight:700;font-size:.85rem;background:transparent;border:none;border-bottom:1px solid var(--color-border);color:var(--color-text);padding:2px 4px;flex:1;min-width:0" />
            <button class="trn-wc-del-group btn-secondary btn-xs" data-gi="${gi}" title="Delete group">🗑</button>
          </div>
          <div class="trn-wc-adv-row">
            <span class="trn-wc-adv-label">Advance to bracket:</span>
            <input type="number" class="trn-wc-adv-count" data-gi="${gi}"
              value="${defAdv}" min="1" max="8"
              title="How many teams from this group advance to the knockout bracket"
              style="width:38px;font-size:.85rem;padding:2px 5px;text-align:center;border:1px solid var(--color-accent,#4f8ef7);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);font-weight:700" />
            <span style="font-size:.72rem;color:var(--color-text-dim)">of ?</span>
          </div>
          <div class="trn-wc-members-list" id="trn-wc-members-${gi}">
            <div style="font-size:.75rem;color:var(--color-text-dim);padding:4px 2px">No teams yet</div>
          </div>
          <div class="trn-wc-add-row">
            <select class="trn-wc-add-select" data-gi="${gi}">
              <option value="">— Add team —</option>
              ${_wcBuildDropdownOptgroups([])}
            </select>
          </div>`;
        listEl.appendChild(card);
        _wcWireGroupCard(gi);
      });

      // ── Save All Groups button ──────────────────────────
      document.getElementById("trn-wc-save-groups")?.addEventListener("click", async () => {
        const groups    = _wcReadGroups();
        const defAdv    = parseInt(document.getElementById("trn-wc-default-adv")?.value) || 2;
        const wpr       = parseInt(document.getElementById("trn-wc-wpr")?.value) || 2;
        const regWeeks  = parseInt(document.getElementById("trn-wc-reg-weeks")?.value) || 6;
        try {
          await _poSave({ worldcupGroups: groups, worldcupAdvanceCount: defAdv, worldcupWeeksPerRound: wpr, worldcupRegWeeks: regWeeks });
          Object.assign(_poLocal(), { worldcupGroups: groups, worldcupAdvanceCount: defAdv, worldcupWeeksPerRound: wpr, worldcupRegWeeks: regWeeks });
          showToast(`Groups saved ✓ — ${groups.length} groups, ${groups.reduce((s,g)=>s+(g.members||[]).length,0)} teams`);
        } catch(e) { showToast("Failed: "+e.message, "error"); }
      });

      // ── Group tabs (schedule area) ───────────────────────
      // Build/render schedule HTML for a given group index
      const _wcSchedForGroup = (gi) => {
        const groups  = _wcReadGroups();
        const group   = groups[gi] || (_poLocal().worldcupGroups||[])[gi];
        if (!group || !(group.members||[]).length) return `<div class="trn-po-empty">Add teams to this group first, then build the schedule.</div>`;
        const members  = group.members;
        const regWeeks = parseInt(document.getElementById("trn-wc-reg-weeks")?.value) || (_poLocal().worldcupRegWeeks||6);
        const savedSched = (_poLocal().worldcupSchedule||{})[String(gi)] || {};

        const memberOpts = (sel) => members.map(n => `<option value="${_esc(n)}" ${sel===n?"selected":""}>${_esc(n)}</option>`).join("");

        const weeksHTML = Array.from({length:regWeeks},(_,wi)=>{
          const matchups = savedSched[String(wi)] || [];
          const matchupRows = matchups.map((m,mi)=>`
            <div class="trn-wc-matchup-row" data-gi="${gi}" data-week="${wi}" data-mi="${mi}">
              <select class="trn-wc-matchup-home" data-gi="${gi}" data-week="${wi}" data-mi="${mi}">${memberOpts(m.home)}</select>
              <span class="trn-wc-vs">vs</span>
              <select class="trn-wc-matchup-away" data-gi="${gi}" data-week="${wi}" data-mi="${mi}">${memberOpts(m.away)}</select>
              <button class="trn-wc-del-matchup btn-ghost btn-xs" data-gi="${gi}" data-week="${wi}" data-mi="${mi}" title="Remove">✕</button>
            </div>`).join("");
          return `<div class="trn-wc-sched-week" data-gi="${gi}" data-week="${wi}">
            <div class="trn-wc-sched-week-header">
              <span class="trn-wc-sched-week-label">Week ${wi+1}</span>
              <button class="trn-wc-add-matchup btn-secondary btn-xs" data-gi="${gi}" data-week="${wi}">+ Game</button>
            </div>
            <div class="trn-wc-matchups-list" id="trn-wc-matchups-${gi}-${wi}">${matchupRows}</div>
          </div>`;
        }).join("");

        return `<div class="trn-wc-sched-group" id="trn-wc-sched-group-${gi}">
          <div class="trn-wc-sched-title">📅 ${_esc(group.name||("Group "+(gi+1)))} — ${members.length} teams, ${regWeeks} weeks</div>
          <div class="trn-wc-sched-autofill-row">
            <button class="btn-secondary btn-xs trn-wc-autofill-btn" data-gi="${gi}">⚡ Auto-fill double round-robin</button>
            <span style="font-size:.72rem;color:var(--color-text-dim)">Each team plays every opponent twice (weeks may be added as needed)</span>
          </div>
          <div class="trn-wc-weeks-grid">${weeksHTML}</div>
        </div>`;
      };

      const _wcRenderSchedArea = (gi) => {
        const area = document.getElementById("trn-wc-sched-area");
        if (!area) return;
        area.innerHTML = _wcSchedForGroup(gi);
        _wcWireScheduleArea(gi);
        // update active tab
        document.querySelectorAll(".trn-wc-group-tab-btn").forEach(btn =>
          btn.classList.toggle("trn-wc-group-tab-btn--active", parseInt(btn.dataset.gi) === gi));
      };

      // Wire schedule event listeners for a rendered schedule area
      const _wcWireScheduleArea = (gi) => {
        const area = document.getElementById("trn-wc-sched-area");
        if (!area) return;
        // Add matchup buttons
        area.querySelectorAll(".trn-wc-add-matchup").forEach(btn => {
          btn.onclick = () => {
            const wi     = parseInt(btn.dataset.week);
            const listEl = document.getElementById(`trn-wc-matchups-${gi}-${wi}`);
            if (!listEl) return;
            const members = _wcReadGroups()[gi]?.members || (_poLocal().worldcupGroups||[])[gi]?.members || [];
            if (members.length < 2) { showToast("Need at least 2 teams in this group","info"); return; }
            const mi   = listEl.querySelectorAll(".trn-wc-matchup-row").length;
            const opts  = members.map(n=>`<option value="${_esc(n)}">${_esc(n)}</option>`).join("");
            const row   = document.createElement("div");
            row.className = "trn-wc-matchup-row"; row.dataset.gi=gi; row.dataset.week=wi; row.dataset.mi=mi;
            row.innerHTML = `<select class="trn-wc-matchup-home" data-gi="${gi}" data-week="${wi}" data-mi="${mi}">${opts}</select>
              <span class="trn-wc-vs">vs</span>
              <select class="trn-wc-matchup-away" data-gi="${gi}" data-week="${wi}" data-mi="${mi}">${opts}</select>
              <button class="trn-wc-del-matchup btn-ghost btn-xs" data-gi="${gi}" data-week="${wi}" data-mi="${mi}" title="Remove">✕</button>`;
            listEl.appendChild(row);
            _wcWireScheduleArea(gi);
          };
        });
        // Delete matchup buttons
        area.querySelectorAll(".trn-wc-del-matchup").forEach(btn => {
          btn.onclick = () => {
            btn.closest(".trn-wc-matchup-row")?.remove();
          };
        });
        // Auto-fill button
        area.querySelectorAll(".trn-wc-autofill-btn").forEach(btn => {
          btn.onclick = () => {
            const giBtn   = parseInt(btn.dataset.gi);
            const groups  = _wcReadGroups();
            const members = groups[giBtn]?.members || (_poLocal().worldcupGroups||[])[giBtn]?.members || [];
            if (members.length < 2) { showToast("Need at least 2 teams to auto-fill","info"); return; }
            const regWks  = parseInt(document.getElementById("trn-wc-reg-weeks")?.value) || 6;
            // Generate double round-robin schedule
            // Standard round-robin algorithm (circle method)
            const _genRR = (teams) => {
              const n    = teams.length % 2 === 0 ? teams.length : teams.length + 1; // pad to even
              const all  = [...teams];
              if (all.length % 2 !== 0) all.push("__BYE__");
              const rounds = [];
              const fixed  = all[0];
              const rot    = [...all.slice(1)];
              for (let r = 0; r < n - 1; r++) {
                const week = [];
                const circle = [fixed, ...rot];
                for (let i = 0; i < n / 2; i++) {
                  const h = circle[i], a = circle[n - 1 - i];
                  if (h !== "__BYE__" && a !== "__BYE__") week.push({home:h, away:a});
                }
                rounds.push(week);
                rot.unshift(rot.pop()); // rotate
              }
              return rounds;
            };
            const single  = _genRR(members);
            const dbl     = [...single, ...single.map(week => week.map(m => ({home:m.away, away:m.home})))];
            // Truncate or pad to regWks
            const schedule = {};
            for (let wi = 0; wi < regWks; wi++) {
              schedule[String(wi)] = dbl[wi] || [];
            }
            // Update stored local schedule for this group
            const curSched = _poLocal().worldcupSchedule || {};
            curSched[String(giBtn)] = schedule;
            Object.assign(_poLocal(), { worldcupSchedule: curSched });
            // Re-render
            _wcRenderSchedArea(giBtn);
            showToast(`Schedule auto-filled for Group ${giBtn+1} ✓`);
          };
        });
      };

      // Wire group tabs
      document.querySelectorAll(".trn-wc-group-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          _wcRenderSchedArea(parseInt(btn.dataset.gi));
        });
      });

      // Wire initial schedule area (group 0)
      if (document.querySelectorAll(".trn-wc-group-tab-btn").length > 0) {
        _wcWireScheduleArea(0);
      }

      // ── Save Schedule button ─────────────────────────────
      document.getElementById("trn-wc-save-schedule")?.addEventListener("click", async () => {
        const sched = _wcReadSchedule();
        try {
          await _poSave({ worldcupSchedule: sched });
          Object.assign(_poLocal(), { worldcupSchedule: sched });
          const total = Object.values(sched).reduce((s,wkMap) => s + Object.values(wkMap).reduce((ss,mm) => ss + (mm||[]).length, 0), 0);
          showToast(`Schedule saved ✓ — ${total} matchups across all groups`);
        } catch(e) { showToast("Failed: "+e.message, "error"); }
      });

    } // end worldcup block

    // ── Scoring settings ────────────────────────────────
    const _buildScoringToSync = () => {
      const tData = _tournaments[tid] || t;
      const isBatch = (v) => v && typeof v === "object" && v.leagues !== undefined;
      const toSync = [];
      Object.entries(tData.leagues || {}).filter(([, v]) => isBatch(v)).forEach(([, batch]) => {
        if (String(batch.year) !== String(_activePoYear)) return;
        Object.entries(batch.leagues || {}).forEach(([leagueId, leagueData]) => {
          toSync.push({ leagueId, platform: batch.platform || "sleeper",
            year: batch.year || new Date().getFullYear(),
            leagueName: leagueData?.name || leagueData?.leagueName || leagueId });
        });
      });
      return toSync;
    };

    document.getElementById("trn-scoring-clear-btn")?.addEventListener("click", async () => {
      if (!confirm(`Delete all stored scoring data for ${_activePoYear} and re-sync from your leagues?`)) return;
      const btn = document.getElementById("trn-scoring-clear-btn");
      if (btn) { btn.disabled = true; btn.textContent = "Clearing…"; }
      try {
        await _tScoringRef(tid).child(String(_activePoYear)).remove();
        if (_tournaments[tid]?.scoringSettings) delete _tournaments[tid].scoringSettings[_activePoYear];
        const toSync = _buildScoringToSync();
        if (!toSync.length) { showToast(`No leagues found for year ${_activePoYear}.`, "info"); return; }
        showToast(`Cleared. Re-syncing from ${toSync.length} leagues…`);
        await _syncScoringSettings(tid, toSync, _activePoYear);
        const snap = await _tRef(tid).once("value");
        if (snap.exists()) _tournaments[tid] = snap.val();
        const bodyEl = document.getElementById("trn-scoring-admin-body");
        if (bodyEl) bodyEl.innerHTML = _renderScoringAdminBody((_tournaments[tid].scoringSettings||{})[_activePoYear]||null);
        _wireScoringPublish();
        showToast("Scoring re-synced ✓");
      } catch(e) { showToast("Failed: "+e.message, "error"); }
      finally { if (btn) { btn.disabled=false; btn.textContent="🗑 Clear & Re-sync"; } }
    });

    document.getElementById("trn-scoring-sync-btn")?.addEventListener("click", async () => {
      const btn = document.getElementById("trn-scoring-sync-btn");
      if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
      try {
        const toSync = _buildScoringToSync();
        if (!toSync.length) { showToast(`No leagues found for year ${_activePoYear}.`, "info"); return; }
        await _syncScoringSettings(tid, toSync, _activePoYear);
        const snap = await _tRef(tid).once("value");
        if (snap.exists()) _tournaments[tid] = snap.val();
        const bodyEl = document.getElementById("trn-scoring-admin-body");
        if (bodyEl) bodyEl.innerHTML = _renderScoringAdminBody((_tournaments[tid].scoringSettings||{})[_activePoYear]||null);
        _wireScoringPublish();
        showToast("Scoring synced ✓");
      } catch(e) { showToast("Sync failed: "+e.message, "error"); }
      finally { if (btn) { btn.disabled=false; btn.textContent="↺ Sync Scoring"; } }
    });

    const _wireScoringPublish = () => {
      document.querySelectorAll(".trn-scoring-del-row").forEach(btn => {
        btn.addEventListener("click", async () => {
          const field=btn.dataset.field, platform=btn.dataset.platform;
          if (!confirm(`Remove "${SCORING_KEY_META[field]||field}"?`)) return;
          try { await _tScoringRef(tid).child(_activePoYear).child(platform).child(field).remove(); btn.closest("tr")?.remove(); showToast("Removed ✓"); }
          catch(e) { showToast("Failed: "+e.message, "error"); }
        });
      });
      document.getElementById("trn-scoring-publish-btn")?.addEventListener("click", async () => {
        const inputs=document.querySelectorAll(".trn-scoring-edit-input"); const updates={};
        inputs.forEach(inp=>{ const p=inp.dataset.platform,f=inp.dataset.field,raw=inp.value.trim(),num=parseFloat(raw); if(!updates[p]) updates[p]={}; updates[p][f]=isNaN(num)?raw:num; });
        try { for(const [platform,data] of Object.entries(updates)) await _tScoringRef(tid).child(_activePoYear).child(platform).update(data); showToast("Scoring published ✓"); }
        catch(e) { showToast("Failed: "+e.message, "error"); }
      });
    };
    _wireScoringPublish();

    // ── League champions ────────────────────────────────
    const _saveLeagueChamp = async (val) => {
      try {
        await _poSave({recognizeLeagueChampions:val});
        Object.assign(_poLocal(),{recognizeLeagueChampions:val});
        document.getElementById("trn-league-champ-yes")?.classList.toggle("trn-yn-btn--active", val);
        document.getElementById("trn-league-champ-no")?.classList.toggle("trn-yn-btn--active",!val);
        showToast(val?"League champions recognized ✓":"League champion recognition off ✓");
      } catch(e) { showToast("Failed","error"); }
    };
    document.getElementById("trn-league-champ-yes")?.addEventListener("click",()=>_saveLeagueChamp(true));
    document.getElementById("trn-league-champ-no")?.addEventListener("click", ()=>_saveLeagueChamp(false));
  }

  // ── Scoring admin helpers ────────────────────────────────────────────────────
  // All known Sleeper scoring field labels, in display order
  const SCORING_KEY_META = {
    pass_yd:   "Pass Yards/pt",    pass_td:   "Pass TD",         pass_int:  "Interception",
    pass_2pt:  "Pass 2PT",         rush_yd:   "Rush Yards/pt",   rush_td:   "Rush TD",
    rush_2pt:  "Rush 2PT",         rec:       "Reception (PPR)", rec_yd:    "Rec Yards/pt",
    rec_td:    "Rec TD",           rec_2pt:   "Rec 2PT",         bonus_rec_te: "TE Bonus/rec",
    bonus_rec_rb: "RB Bonus/rec",  bonus_rec_wr: "WR Bonus/rec", fum_lost:  "Fumble Lost",
    fum_rec:   "Fumble Recovery",  xpm:       "XP Made",         fgmiss:    "FG Miss",
    fg_0_19:   "FG 0-19",          fg_20_29:  "FG 20-29",        fg_30_39:  "FG 30-39",
    fg_40_49:  "FG 40-49",         fg_50p:    "FG 50+",          sack:      "Sack",
    int:       "INT (DEF)",         safe:      "Safety",          def_td:    "Def TD",
    pts_allow_0: "PA 0",            pts_allow_1_6: "PA 1-6",      pts_allow_7_13: "PA 7-13",
    pts_allow_14_20: "PA 14-20",    pts_allow_21_27: "PA 21-27",  pts_allow_28_34: "PA 28-34",
    pts_allow_35p: "PA 35+",        _format:   "Format",          _rosterPositions: "Roster Spots",
  };

  function _renderScoringAdminBody(yearData) {
    if (!yearData || !Object.keys(yearData).length) {
      return `<div class="trn-summary-empty">Not yet synced. Click ↺ Sync Scoring or run Sync Standings.</div>`;
    }
    const platforms = Object.keys(yearData).filter(k => !k.startsWith("_"));
    if (!platforms.length) {
      return `<div class="trn-summary-empty">No platform data found. Run Sync Standings.</div>`;
    }
    const showMulti = platforms.length > 1;
    const differs = (key) => {
      const vals = platforms.map(p => String(yearData[p]?.[key] ?? ""));
      return vals.some(v => v !== vals[0]);
    };
    // Collect all non-internal keys
    const allKeys = new Set();
    platforms.forEach(p => Object.keys(yearData[p] || {}).forEach(k => {
      if (!k.startsWith("_") || k === "_format" || k === "_rosterPositions") allKeys.add(k);
    }));
    const knownOrder = Object.keys(SCORING_KEY_META);
    const sortedKeys = [
      ...knownOrder.filter(k => allKeys.has(k)),
      ...[...allKeys].filter(k => !knownOrder.includes(k)).sort()
    ];

    // Source league info line
    const sourceLines = platforms.map(p => {
      const ln = yearData[p]?._sourceLeagueName || yearData[p]?._sourceLeagueId;
      return ln ? `<span style="font-size:.72rem;color:var(--color-text-dim)">${_esc(p.toUpperCase())}: pulled from <strong>${_esc(ln)}</strong></span>` : "";
    }).filter(Boolean).join(" &nbsp;·&nbsp; ");

    const headerCols = showMulti
      ? platforms.map(p => `<th>${p.toUpperCase()}</th><th style="width:20px"></th>`).join("")
      : `<th>Value</th><th style="width:20px"></th>`;

    const rows = sortedKeys.map(k => {
      const vals = platforms.map(p => yearData[p]?.[k]);
      if (vals.every(v => v === undefined || v === null)) return "";
      const diff  = showMulti && differs(k);
      const label = SCORING_KEY_META[k] || k;
      return `<tr class="${diff ? "trn-scoring-diff-row" : ""}" data-scoring-key="${_esc(k)}">
        <td class="trn-scoring-label">${label}</td>
        ${showMulti
          ? platforms.map((p, pi) => `
              <td class="trn-scoring-val">
                <input type="text" class="trn-scoring-edit-input" data-platform="${p}" data-field="${k}"
                  value="${_esc(String(vals[pi] ?? ""))}"
                  style="width:60px;font-size:.78rem;padding:1px 4px;border:1px solid var(--color-border);border-radius:2px;background:var(--color-surface);color:var(--color-text);text-align:center" />
              </td>
              <td><button class="trn-scoring-del-row btn-ghost btn-xs" data-field="${k}" data-platform="${p}" title="Remove this setting">✕</button></td>`).join("")
          : `<td class="trn-scoring-val">
               <input type="text" class="trn-scoring-edit-input" data-platform="${platforms[0]}" data-field="${k}"
                 value="${_esc(String(vals[0] ?? ""))}"
                 style="width:80px;font-size:.78rem;padding:1px 4px;border:1px solid var(--color-border);border-radius:2px;background:var(--color-surface);color:var(--color-text);text-align:center" />
             </td>
             <td><button class="trn-scoring-del-row btn-ghost btn-xs" data-field="${k}" data-platform="${platforms[0]}" title="Remove this setting">✕</button></td>`}
      </tr>`;
    }).filter(Boolean).join("");

    const syncedAt = platforms.map(p => yearData[p]?._syncedAt).filter(Boolean)[0];
    const syncLine = syncedAt
      ? `Last synced: ${new Date(syncedAt).toLocaleDateString()}` : "";

    // Raw API data for debugging
    const rawBlocks = platforms.map(p => {
      const raw = yearData[p]?._rawApi;
      if (!raw) return "";
      let parsed = {};
      try { parsed = JSON.parse(raw); } catch(e) { return ""; }
      // Show all fields including zero-value ones
      const rawRows = Object.entries(parsed)
        .sort(([a],[b]) => a.localeCompare(b))
        .map(([k,v]) => `<tr><td style="padding:2px 6px;font-size:.72rem;color:var(--color-text-dim)">${_esc(k)}</td><td style="padding:2px 6px;font-size:.72rem;font-variant-numeric:tabular-nums">${v}</td></tr>`)
        .join("");
      return `<div style="margin-top:var(--space-2)">
        <div style="font-size:.72rem;font-weight:700;color:var(--color-text-dim);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">${p.toUpperCase()} — Raw API scoring_settings (all fields including zeroes)</div>
        <div style="max-height:200px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius-sm)">
          <table style="width:100%;border-collapse:collapse"><tbody>${rawRows}</tbody></table>
        </div>
      </div>`;
    }).filter(Boolean).join("");

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px;margin-bottom:var(--space-2)">
        <div style="display:flex;flex-direction:column;gap:2px">${syncLine ? `<span style="font-size:.7rem;color:var(--color-text-dim)">${syncLine}</span>` : ""}
          ${sourceLines ? `<span>${sourceLines}</span>` : ""}
        </div>
        <span style="font-size:.7rem;color:var(--color-text-dim)">Edit values inline · ✕ to remove a row</span>
      </div>
      ${showMulti ? `<div class="trn-scoring-diff-note" style="margin-bottom:var(--space-2)">⚠️ Highlighted rows differ between platforms.</div>` : ""}
      <table class="trn-scoring-table">
        <thead><tr><th>Setting</th>${headerCols}</tr></thead>
        <tbody id="trn-scoring-tbody">${rows}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:var(--space-2);flex-wrap:wrap;gap:var(--space-1)">
        <details style="font-size:.75rem;color:var(--color-text-dim)">
          <summary style="cursor:pointer">🔍 View raw API data</summary>
          ${rawBlocks || "<em>No raw data stored. Re-sync to capture it.</em>"}
        </details>
        <button class="btn-primary btn-sm" id="trn-scoring-publish-btn">Publish Scoring Settings</button>
      </div>`;
  }

  // ── Scoring settings sync ────────────────────────────────────────────────────
  // Normalized scoring schema stored at scoringSettings/{year}/{platform}
  // Called from _syncStandings after league data is fetched.
  // Sleeper: fetches /v1/league/{id} for scoring_settings + roster_positions
  // MFL: fetches export?TYPE=rules for scoring rules
  // Writes one entry per platform (settings assumed consistent within platform)
  async function _syncScoringSettings(tid, toSync, year) {
    // Filter to only leagues matching the target year, then pick first per platform
    const yearStr = String(year || new Date().getFullYear());
    const filtered = toSync.filter(l => String(l.year) === yearStr);
    const pool = filtered.length ? filtered : toSync; // fallback to all if none match year
    const byPlatform = {};
    pool.forEach(l => {
      if (!byPlatform[l.platform]) byPlatform[l.platform] = l;
    });
    console.log(`[tournament.js] Scoring sync for year ${yearStr}: using league ${byPlatform.sleeper?.leagueId} (${byPlatform.sleeper?.leagueName || "?"})`);

    const SLEEPER_FIELD_LABELS = {
      pass_yd:0.04, pass_td:4, pass_int:-2, pass_2pt:2,
      rush_yd:0.1,  rush_td:6, rush_2pt:2,
      rec:0,        rec_yd:0.1, rec_td:6, rec_2pt:2,
      bonus_rec_te:0, fum_lost:-2,
      xpm:1, fg_0_19:3, fg_20_29:3, fg_30_39:3, fg_40_49:4, fg_50p:5, fgmiss:-1,
      pts_allow_0:10, pts_allow_1_6:7, pts_allow_7_13:4, pts_allow_14_20:1,
      pts_allow_21_27:0, pts_allow_28_34:-1, pts_allow_35p:-4,
      def_td:6, sack:1, safe:2, int:2, fum_rec:2
    };

    const results = {};

    if (byPlatform.sleeper) {
      try {
        const leagueId = byPlatform.sleeper.leagueId;
        const leagueName = byPlatform.sleeper.leagueName || leagueId;
        const r = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
        if (r.ok) {
          const d = await r.json();
          const ss = d.scoring_settings || {};
          const rp = d.roster_positions || [];
          // Read ALL non-zero values from the API directly
          const settings = {};
          Object.entries(ss).forEach(([k, v]) => {
            if (v !== 0 && v !== null && v !== undefined) settings[k] = v;
          });
          // Derived meta
          settings._ppr             = ss.rec !== undefined ? ss.rec : 0;
          settings._format          = (ss.rec >= 1) ? "PPR" : (ss.rec >= 0.5) ? "Half PPR" : "Standard";
          settings._rosterPositions = rp.filter(p => p !== "BN" && p !== "LB").join(", ");
          settings._sourceLeagueId  = leagueId;
          settings._sourceLeagueName= leagueName;
          settings._platform        = "sleeper";
          settings._syncedAt        = Date.now();
          settings._rawApi          = JSON.stringify(ss); // Store raw for debugging
          results.sleeper = settings;
        }
      } catch(e) { console.warn("[tournament.js] Scoring sync (Sleeper) failed:", e); }
    }

    if (byPlatform.mfl) {
      try {
        const { leagueId } = byPlatform.mfl;
        const yr = byPlatform.mfl.year || year || new Date().getFullYear();
        const r  = await fetch(
          `https://api.myfantasyleague.com/${yr}/export?TYPE=rules&L=${leagueId}&JSON=1`
        );
        if (r.ok) {
          const d = await r.json();
          const rules = d?.rules?.positionRules || [];
          // Flatten MFL rules into key-value pairs
          const settings = { _platform:"mfl", _syncedAt:Date.now() };
          rules.forEach(rule => {
            if (rule.positions && rule.event) {
              const key = `${rule.positions}_${rule.event}`.toLowerCase().replace(/[^a-z0-9_]/g,"_");
              settings[key] = parseFloat(rule.points) || 0;
            }
          });
          settings._format = settings["qb_pass_yards"] ? "Standard/PPR (MFL)" : "MFL";
          results.mfl = settings;
        }
      } catch(e) { console.warn("[tournament.js] Scoring sync (MFL) failed:", e); }
    }

    if (Object.keys(results).length) {
      try {
        await _tScoringRef(tid).child(String(year)).update(results);
      } catch(e) { console.warn("[tournament.js] Scoring settings write failed:", e); }
    }
  }

  // ── Info page auto-summary ────────────────────────────────────────────────────
  // Renders a locked summary block for the info page (public + internal).
  // Two sections: Playoff Structure + Scoring System.
  function _renderTournamentSummary(t, year, tid) {
    const years    = _playoffYears(t);
    const dispYear = year || years[0] || null;
    const po       = _playoffForYear(t, dispYear);
    const scoring  = dispYear ? (t.scoringSettings?.[dispYear] || {}) : {};

    // ── Playoff structure section ────────────────────────
    const modeLabels = {
      total_points:"Total Points", points_rounds:"Points Rounds",
      h2h_bracket:"H2H Bracket",  custom_rounds:"Custom Rounds"
    };
    const modeIcons = {
      total_points:"📊", points_rounds:"📈", h2h_bracket:"🥊", custom_rounds:"⚙️"
    };
    const mode = po.mode || "total_points";
    const sw   = po.startWeek;
    const ew   = po.endWeek;

    // Qualification plain-English
    const _qualSummary = (qual) => {
      if (!qual || !qual.method) return "";
      if (qual.method === "manual") return "Qualifiers hand-picked by admin.";
      if (qual.method === "top_record") return `Top ${qual.count||"?"} by record qualify (overall).`;
      if (qual.method === "top_pf")     return `Top ${qual.count||"?"} by Points For qualify (overall).`;
      if (qual.method === "top_per_group") return `Top ${qual.perGroup||"?"} per division/conference qualify.`;
      if (qual.method === "composite") {
        return (qual.steps||[]).map((s,i) => {
          if (s.type==="wins_threshold") return `⚠️ Minimum ${s.minWins||"?"} wins required`;
          if (s.type==="top_record")     return `${i+1}. Top ${s.count||"?"} by Record ${s.scope && s.scope !== 'overall' ? `(${s.scope === 'division' ? 'per division' : 'per conference'})` : '(overall)'}`;
          if (s.type==="top_pf")         return `${i+1}. Top ${s.count||"?"} by Points For ${s.scope && s.scope !== 'overall' ? `(${s.scope === 'division' ? 'per division' : 'per conference'})` : '(overall)'}`;
          if (s.type==="top_subgroup")   return `${i+1}. Top ${s.subCount||"?"} where ${s.subField||"?"}="${s.subValue||"?"}" by ${s.subMetric==="pf"?"Points For":"Record"}`;
          return "";
        }).filter(Boolean).join(" → ");
      }
      return "";
    };

    // Round summaries
    const _roundSummary = () => {
      if (mode === "total_points") return "";
      if (mode === "h2h_bracket") {
        const bs = po.bracketSize || "?";
        const byes = po.byes?.type !== "none" ? `, ${po.byes?.count||"?"} byes` : "";
        const seed = { record:"by record", pf:"by Points For", qual_order:"by qual. order", manual:"manual" }[po.seeding?.method||"record"];
        return `${bs}-team bracket, seeded ${seed}${byes}.`;
      }
      if (mode === "points_rounds") {
        const rounds = po.pointsRounds?.rounds || [];
        return rounds.slice(0,-1).map((r,i) => {
          const adv = r.advanceMethod==="pct" ? `top ${r.advancePct||"?"}%` : `top ${r.advanceCount||"?"}`;
          const blend = r.blend?.enabled ? ` (${r.blend.mode==="weighted"?`wk×${100-(r.blend.weight||30)}%+avg×${r.blend.weight||30}%`:`wk+avg×${r.blend.weight||30}%`})` : "";
          return `Round ${i+1}: ${adv} advance${blend}`;
        }).join("; ") || "Rounds TBD";
      }
      if (mode === "custom_rounds") {
        const rounds = po.customRounds?.rounds || [];
        return rounds.slice(0,-1).map((r,i) => {
          const sum = `${r.groups*r.teamsPerGroup||"?"} teams, ${r.groups||"?"} groups → ${r.groups*(r.advPerGroup||0)||"?"} advance`;
          return `Round ${i+1}: ${sum}`;
        }).join("; ") || "Rounds TBD";
      }
      return "";
    };

    const qualSummary  = _qualSummary(po.qualification);
    const roundSummary = _roundSummary();
    const weeksLine    = mode === "total_points"
      ? (ew ? `Season through week ${ew}.` : "")
      : [(sw ? `Wk ${sw}` : ""), (ew ? `–${ew}` : "")].filter(Boolean).join(" ") || "";

    // ── Scoring section ──────────────────────────────────
    const platforms = Object.keys(scoring).filter(k => !k.startsWith("_"));
    const _renderScoringTable = () => {
      if (!platforms.length) return `<div class="trn-summary-empty">Scoring settings not yet synced. Run a standings sync to populate.</div>`;

      // Collect all keys across platforms
      const DISPLAY_FIELDS = [
        { key:"pass_yd",   label:"Pass Yards/pt" },
        { key:"pass_td",   label:"Pass TD"        },
        { key:"pass_int",  label:"Interception"   },
        { key:"rush_yd",   label:"Rush Yards/pt"  },
        { key:"rush_td",   label:"Rush TD"        },
        { key:"rec",       label:"Reception"      },
        { key:"rec_yd",    label:"Rec Yards/pt"   },
        { key:"rec_td",    label:"Rec TD"         },
        { key:"bonus_rec_te", label:"TE Bonus"    },
        { key:"fum_lost",  label:"Fumble Lost"    },
        { key:"_format",   label:"Format"         },
        { key:"_rosterPositions", label:"Roster"  },
      ];

      const allPlatforms = Object.keys(scoring);
      const showPlatformCols = allPlatforms.length > 1;

      // Find fields that differ between platforms
      const differs = (key) => {
        const vals = allPlatforms.map(p => String(scoring[p]?.[key]??"-"));
        return vals.some(v => v !== vals[0]);
      };

      const rows = DISPLAY_FIELDS.map(f => {
        const vals = allPlatforms.map(p => {
          const v = scoring[p]?.[f.key];
          return v !== undefined ? (typeof v === "number" ? v : String(v)) : null;
        }).filter(v => v !== null);
        if (!vals.length) return "";
        const diff = showPlatformCols && differs(f.key);
        return `
          <tr class="${diff ? "trn-scoring-diff-row" : ""}">
            <td class="trn-scoring-label">${f.label}</td>
            ${showPlatformCols
              ? allPlatforms.map(p => {
                  const v = scoring[p]?.[f.key];
                  return `<td class="trn-scoring-val">${v !== undefined ? v : "—"}${diff ? `<span class="trn-scoring-platform-tag">${p}</span>` : ""}</td>`;
                }).join("")
              : `<td class="trn-scoring-val">${vals[0]}</td>`}
          </tr>`;
      }).filter(Boolean).join("");

      const headerCols = showPlatformCols
        ? allPlatforms.map(p => `<th>${p.toUpperCase()}</th>`).join("")
        : "<th>Value</th>";

      return `
        <table class="trn-scoring-table">
          <thead><tr><th>Setting</th>${headerCols}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${showPlatformCols ? `<div class="trn-scoring-diff-note">⚠️ Highlighted rows differ between platforms.</div>` : ""}`;
    };

    if (!po.mode && !platforms.length) return ""; // nothing to show yet

    // Auto-generated plain-text representation for the editable override
    const _autoText = [
      po.mode ? [
        `Format: ${modeLabels[mode]||mode}`,
        weeksLine ? `Season: ${weeksLine}` : "",
        qualSummary  ? `Qualification: ${qualSummary}` : "",
        roundSummary ? `Rounds: ${roundSummary}` : ""
      ].filter(Boolean).join("\n") : "",
    ].filter(Boolean).join("\n\n");

    // Check for admin override stored at meta.summaryOverride[year]
    const overrideKey   = dispYear || "default";
    const overrideText  = t.meta?.summaryOverride?.[overrideKey] || null;
    const hasOverride   = !!overrideText;

    // Year pills
    const yearPills = years.length > 1 ? `
      <div class="trn-summary-year-bar">
        ${years.map(y => `
          <button class="trn-summary-year-pill ${String(y)===String(dispYear)?"trn-summary-year-pill--active":""}"
            data-sum-year="${y}">${y}</button>`).join("")}
      </div>` : "";

    // Playoff structure display (auto-generated visual blocks)
    const playoffBlock = po.mode ? `
      <div class="trn-summary-section">
        <div class="trn-summary-section-title">Playoff Structure</div>
        <div class="trn-summary-po-mode">
          <span class="trn-summary-mode-icon">${modeIcons[mode]||"🏆"}</span>
          <span class="trn-summary-mode-label">${modeLabels[mode]||mode}</span>
          ${weeksLine ? `<span class="trn-summary-weeks">${weeksLine}</span>` : ""}
        </div>
        ${qualSummary  ? `<div class="trn-summary-qual">${_esc(qualSummary)}</div>`   : ""}
        ${roundSummary ? `<div class="trn-summary-rounds">${_esc(roundSummary)}</div>` : ""}
      </div>` : "";

    const scoringBlock = `
      <div class="trn-summary-section">
        <div class="trn-summary-section-title">Scoring System</div>
        ${_renderScoringTable()}
      </div>`;

    return `
      <div class="trn-section-card trn-summary-card" id="trn-tournament-summary"
        data-year="${_esc(overrideKey)}" data-auto-text="${_esc(_autoText)}">
        <div class="trn-section-card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>📋 Season Summary</span>
          <div style="display:flex;align-items:center;gap:var(--space-1)">
            ${hasOverride ? `<span class="trn-summary-edited-badge" title="Admin-edited text">✏️ Edited</span>` : ""}
            ${tid ? `<button class="btn-secondary btn-xs" id="trn-summary-edit-btn">Edit</button>` : ""}
          </div>
        </div>
        ${yearPills}

        <!-- Auto-generated structured view (shown when no override or in read mode) -->
        <div id="trn-summary-auto-view" ${hasOverride ? 'style="display:none"' : ""}>
          ${playoffBlock}
          ${scoringBlock}
        </div>

        <!-- Admin override: rendered text (shown when override exists) -->
        ${hasOverride ? `
          <div id="trn-summary-override-view">
            <div class="trn-summary-override-text">${
              overrideText.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
                .replace(/\n/g,"<br>")
            }</div>
            ${scoringBlock}
          </div>` : ""}

        <!-- Edit mode (hidden by default, toggled by Edit button) -->
        ${tid ? `
          <div id="trn-summary-edit-mode" style="display:none">
            <div style="font-size:.78rem;color:var(--color-text-dim);margin-bottom:var(--space-2)">
              Edit the playoff &amp; format summary text. The scoring table is always auto-generated below.
            </div>
            <textarea id="trn-summary-textarea" rows="8"
              style="width:100%;font-size:.82rem;padding:var(--space-2);border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);resize:vertical;box-sizing:border-box"
              placeholder="Describe the playoff structure and format for this season…"
            ></textarea>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:var(--space-2)">
              <button class="btn-secondary btn-xs" id="trn-summary-reset-btn"
                title="Revert to auto-generated text">↺ Reset to Auto</button>
              <div style="display:flex;gap:var(--space-1)">
                <button class="btn-secondary btn-sm" id="trn-summary-cancel-btn">Cancel</button>
                <button class="btn-primary btn-sm"   id="trn-summary-save-btn">Save</button>
              </div>
            </div>
          </div>` : ""}
      </div>
    `;
  }


  async function _changeStatus(tid, newStatus) {
    try {
      const updates = { status: newStatus };
      // Stamp the registration year once when opening registration
      if (newStatus === "registration_open") {
        updates.registrationYear = new Date().getFullYear();
      }
      await _tMetaRef(tid).update(updates);
      showToast(`Status updated to: ${STATUS_LABELS[newStatus]} ✓`);
      // Reload view
      const snap = await _tRef(tid).once("value");
      _tournaments[tid] = snap.val();
      _writePublicSummary(tid, _tournaments[tid]);
      _openTournamentView(tid);
    } catch(err) {
      showToast("Failed to update status", "error");
    }
  }

  // ── Admin: Leagues tab ─────────────────────────────────
  // Leagues are stored as batches: gmd/tournaments/{tid}/leagues/{batchId}
  // Each batch = { platform, year, conferences: bool, leagues: { [leagueId]: {name, conference?} } }

  function _renderLeaguesTab(tid, t, body) {
    const batches = t.leagues || {};
    const batchEntries = Object.entries(batches);

    // Group individual leagues (legacy flat structure) vs batches
    const isBatch = (v) => v && typeof v === "object" && v.leagues !== undefined;
    const realBatches = batchEntries.filter(([, v]) => isBatch(v));
    const legacyLeagues = batchEntries.filter(([, v]) => !isBatch(v));

    // Total league count across all batches
    const totalLeagues = realBatches.reduce((s, [, b]) => s + Object.keys(b.leagues || {}).length, 0)
                       + legacyLeagues.length;

    // Build conferences list for manual assignment
    const allConferences = [...new Set(
      realBatches.flatMap(([, b]) =>
        Object.values(b.leagues || {}).map(l => l.conference).filter(Boolean)
      )
    )];

    body.innerHTML = `
      <div class="trn-section-card">
        <div class="trn-section-card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>League Batches (${totalLeagues} total leagues)</span>
          <div style="display:flex;gap:var(--space-2)">
            <button class="btn-secondary btn-sm" id="trn-sync-standings-btn">↺ Sync Standings</button>
            <button class="btn-primary btn-sm" id="trn-add-batch-btn">+ Add Batch</button>
          </div>
        </div>

        ${realBatches.length ? realBatches.sort((a, b) => (b[1].year || 0) - (a[1].year || 0)).map(([bid, batch]) => `
          <div class="trn-batch-block">
            <div class="trn-batch-header">
              <div class="trn-batch-title">
                <span class="trn-platform-badge trn-platform-${batch.platform || "unknown"}">${(batch.platform || "?").toUpperCase()}</span>
                <span class="trn-batch-year">${batch.year || "—"}</span>
                <span class="trn-batch-count">${Object.keys(batch.leagues || {}).length} leagues</span>
              ${(() => {
                const sc = t.standingsCache || {};
                const ids = Object.keys(batch.leagues || {});
                const nSynced = ids.filter(id => sc[id]?.lastSynced).length;
                const maxSync = ids.reduce((m, id) => Math.max(m, sc[id]?.lastSynced||0), 0);
                return nSynced
                  ? `<span class="trn-batch-sync-tag">✓ ${nSynced}/${ids.length} synced · ${new Date(maxSync).toLocaleDateString()}</span>`
                  : `<span class="trn-batch-sync-tag trn-batch-sync-tag--pending">Not synced</span>`;
              })()}
                ${batch.hasConferences ? `<span class="trn-batch-tag">Conferences</span>` : ""}
              </div>
              <div class="trn-batch-actions">
                <button class="btn-secondary btn-sm" data-edit-batch="${_esc(bid)}">Edit Conferences</button>
                <button class="btn-ghost btn-sm" data-del-batch="${_esc(bid)}">✕</button>
              </div>
            </div>
            <div class="trn-batch-leagues">
              ${Object.entries(batch.leagues || {}).map(([lid, l]) => `
                <div class="trn-batch-league-row">
                  <span class="trn-batch-league-name">${_esc(l.name || lid)}</span>
                  ${l.conference ? `<span class="trn-batch-conf-tag">${_esc(l.conference)}</span>` : ""}
                  <span class="trn-batch-league-id dim">${_esc(String(lid))}</span>
                </div>
              `).join("")}
            </div>
          </div>
        `).join("") : `<div class="trn-empty-inline">No league batches yet. Add a batch to upload league IDs.</div>`}

        ${legacyLeagues.length ? `
          <div class="trn-batch-block">
            <div class="trn-batch-header">
              <div class="trn-batch-title"><span class="trn-batch-tag">Legacy</span> Individual Leagues (${legacyLeagues.length})</div>
            </div>
            <div class="trn-batch-leagues">
              ${legacyLeagues.map(([lid, l]) => `
                <div class="trn-batch-league-row">
                  <span class="trn-platform-badge trn-platform-${l.platform || "unknown"}">${(l.platform || "?").toUpperCase()}</span>
                  <span class="trn-batch-league-name">${_esc(l.name || l.leagueId || lid)}</span>
                  <span class="trn-batch-league-id dim">${_esc(String(l.leagueId || lid))}</span>
                  <button class="btn-ghost btn-sm" data-del-lid="${_esc(lid)}">✕</button>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}
      </div>
    `;

    document.getElementById("trn-add-batch-btn")?.addEventListener("click", () => _openAddBatchModal(tid, t));
    document.getElementById("trn-sync-standings-btn")?.addEventListener("click", () => _syncStandings(tid, t));
    body.querySelectorAll("[data-edit-batch]").forEach(btn =>
      btn.addEventListener("click", () => _openEditConferencesModal(tid, btn.dataset.editBatch, batches[btn.dataset.editBatch]))
    );
    body.querySelectorAll("[data-del-batch]").forEach(btn =>
      btn.addEventListener("click", () => _deleteBatch(tid, btn.dataset.delBatch))
    );
    body.querySelectorAll("[data-del-lid]").forEach(btn =>
      btn.addEventListener("click", () => _deleteLeague(tid, btn.dataset.delLid))
    );
  }

  // ── Add batch modal — bulk upload ──────────────────────
  function _openAddBatchModal(tid, t) {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = currentYear; y >= 2000; y--) years.push(y);

    _showModal(`
      <div class="modal-header">
        <h3>Add League Batch</h3>
        <button class="modal-close" id="trn-modal-close">✕</button>
      </div>
      <div class="modal-body trn-form-body">
        <div class="form-group">
          <label>Platform <span class="required">*</span></label>
          <select id="trn-batch-platform">
            <option value="sleeper">Sleeper</option>
            <option value="mfl">MyFantasyLeague (MFL)</option>
            <option value="yahoo">Yahoo Fantasy</option>
          </select>
        </div>
        <div class="form-group">
          <label>Year <span class="required">*</span></label>
          <select id="trn-batch-year">
            ${years.map(y => `<option value="${y}" ${y === currentYear ? "selected" : ""}>${y}</option>`).join("")}
          </select>
        </div>
        <div class="form-group">
          <label class="trn-field-toggle" style="margin:0">
            <input type="checkbox" id="trn-batch-has-conf" />
            This batch uses conferences
          </label>
        </div>
        <div class="form-group">
          <label>League IDs <span class="required">*</span></label>
          <textarea id="trn-batch-ids" rows="8"
            placeholder="Paste one league ID per line.&#10;&#10;Optionally add a conference in a second column:&#10;123456789&#10;987654321,NFC&#10;111222333,AFC&#10;&#10;Or upload a CSV file below."></textarea>
          <span class="field-hint">One ID per line. Second column (comma-separated) = conference name.</span>
        </div>
        <div class="form-group">
          <label>Or upload a CSV file</label>
          <input type="file" id="trn-batch-csv" accept=".csv,.txt" />
          <span class="field-hint">CSV with league IDs in column 1, optional conference in column 2.</span>
        </div>
        <div id="trn-batch-preview" class="trn-batch-preview hidden"></div>
        <div id="trn-batch-error" class="auth-error hidden"></div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="trn-modal-cancel">Cancel</button>
        <button class="btn-secondary" id="trn-batch-preview-btn">Preview</button>
        <button class="btn-primary"   id="trn-modal-confirm">Import Leagues</button>
      </div>
    `);

    document.getElementById("trn-modal-cancel")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-close")?.addEventListener("click", _closeModal);

    // CSV file → populate textarea
    document.getElementById("trn-batch-csv")?.addEventListener("change", async function() {
      const file = this.files?.[0];
      if (!file) return;
      const text = await file.text();
      document.getElementById("trn-batch-ids").value = text.trim();
    });

    // Preview button — parse IDs and show what will be fetched
    document.getElementById("trn-batch-preview-btn")?.addEventListener("click", () => {
      const raw = document.getElementById("trn-batch-ids")?.value.trim();
      if (!raw) return;
      const parsed = _parseBatchIds(raw);
      const preview = document.getElementById("trn-batch-preview");
      preview.innerHTML = `
        <div class="trn-batch-preview-title">${parsed.length} league ID${parsed.length !== 1 ? "s" : ""} found:</div>
        ${parsed.slice(0, 10).map(r => `<div class="trn-batch-preview-row">
          <span>${_esc(r.leagueId)}</span>
          ${r.conference ? `<span class="trn-batch-conf-tag">${_esc(r.conference)}</span>` : ""}
        </div>`).join("")}
        ${parsed.length > 10 ? `<div class="dim">…and ${parsed.length - 10} more</div>` : ""}
      `;
      preview.classList.remove("hidden");
    });

    document.getElementById("trn-modal-confirm")?.addEventListener("click", () => _doImportBatch(tid, t));
  }

  function _parseBatchIds(raw) {
    return raw.split("\n")
      .map(line => line.trim())
      .filter(line => line && !line.startsWith("#"))
      .map(line => {
        const parts = line.split(/[,\t]/);
        const leagueId   = parts[0]?.trim();
        const conference = parts[1]?.trim() || null;
        return leagueId ? { leagueId, conference } : null;
      })
      .filter(Boolean);
  }

  async function _doImportBatch(tid, t) {
    const platform = document.getElementById("trn-batch-platform")?.value;
    const year     = document.getElementById("trn-batch-year")?.value;
    const hasConf  = document.getElementById("trn-batch-has-conf")?.checked;
    const raw      = document.getElementById("trn-batch-ids")?.value.trim();
    const errEl    = document.getElementById("trn-batch-error");
    const btn      = document.getElementById("trn-modal-confirm");

    if (!raw) {
      errEl.textContent = "Paste or upload league IDs first.";
      errEl.classList.remove("hidden");
      return;
    }

    const parsed = _parseBatchIds(raw);
    if (!parsed.length) {
      errEl.textContent = "No valid league IDs found.";
      errEl.classList.remove("hidden");
      return;
    }

    btn.disabled    = true;
    btn.textContent = `Fetching names… (0/${parsed.length})`;
    errEl.classList.add("hidden");

    // Fetch league names from platform APIs
    const leaguesData = {};
    let done = 0;

    for (const { leagueId, conference } of parsed) {
      let name = leagueId; // fallback
      try {
        if (platform === "sleeper") {
          const r = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
          if (r.ok) {
            const d = await r.json();
            name = d?.name || leagueId;
          }
        } else if (platform === "mfl") {
          const r = await fetch(
            `https://mfl-proxy.mraladdin23.workers.dev/mfl/leagueName`,
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ leagueId, year }) }
          ).catch(() => null);
          // Worker endpoint we'll add — fallback to direct MFL public API
          if (!r || !r.ok) {
            const mflR = await fetch(
              `https://api.myfantasyleague.com/${year}/export?TYPE=league&L=${leagueId}&JSON=1`
            ).catch(() => null);
            if (mflR?.ok) {
              const d = await mflR.json().catch(() => null);
              name = d?.league?.name || leagueId;
            }
          } else {
            const d = await r.json().catch(() => null);
            name = d?.name || leagueId;
          }
        } else if (platform === "yahoo") {
          // Yahoo needs an OAuth token — use stored token if available
          const token = localStorage.getItem("dlr_yahoo_access_token");
          if (token) {
            // Yahoo league key format: {gameId}.l.{leagueId}
            // gameId for NFL varies by year — use stored leagueKey if available
            // For batch import we use leagueId directly as the key fallback
            const leagueKey = leagueId.includes(".l.") ? leagueId : `${leagueId}`;
            const r = await fetch(
              `https://mfl-proxy.mraladdin23.workers.dev/yahoo/leagueName`,
              { method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ access_token: token, league_key: leagueKey }) }
            ).catch(() => null);
            if (r?.ok) {
              const d = await r.json().catch(() => null);
              name = d?.name || leagueId;
            }
          }
        }
      } catch(e) {
        // Name fetch failed — use ID as name, still import
      }

      const entry = { name };
      if (conference) entry.conference = conference;
      leaguesData[leagueId] = entry;

      done++;
      if (btn) btn.textContent = `Fetching names… (${done}/${parsed.length})`;
    }

    // Write batch to Firebase
    const batchId = `${platform}_${year}_${Date.now().toString(36)}`;
    const batch = {
      platform,
      year: parseInt(year),
      hasConferences: hasConf,
      createdAt: Date.now(),
      leagues: leaguesData
    };

    try {
      await _tLeaguesRef(tid).child(batchId).set(batch);
      showToast(`${parsed.length} league${parsed.length !== 1 ? "s" : ""} imported ✓`);
      _closeModal();
      const snap = await _tRef(tid).once("value");
      _tournaments[tid] = snap.val();
      _openTournamentView(tid);
      _activeAdminTab = "leagues";
    } catch(err) {
      btn.disabled    = false;
      btn.textContent = "Import Leagues";
      errEl.textContent = "Failed to save: " + err.message;
      errEl.classList.remove("hidden");
    }
  }

  // ── Edit conferences modal (post-import assignment) ────
  function _openEditConferencesModal(tid, batchId, batch) {
    const leagues = batch.leagues || {};
    const existingConfs = [...new Set(Object.values(leagues).map(l => l.conference).filter(Boolean))];

    _showModal(`
      <div class="modal-header">
        <h3>Edit Conferences — ${_esc(batch.platform?.toUpperCase())} ${batch.year || ""}</h3>
        <button class="modal-close" id="trn-modal-close">✕</button>
      </div>
      <div class="modal-body trn-form-body" style="max-height:60vh;overflow-y:auto">
        <div class="form-group">
          <label class="trn-field-toggle" style="margin:0 0 var(--space-3)">
            <input type="checkbox" id="trn-conf-enabled" ${batch.hasConferences ? "checked" : ""} />
            This batch uses conferences
          </label>
        </div>
        ${Object.entries(leagues).map(([lid, l]) => `
          <div class="trn-conf-row">
            <span class="trn-conf-league-name">${_esc(l.name || lid)}</span>
            <input type="text" class="trn-conf-input" data-lid="${_esc(lid)}"
              value="${_esc(l.conference || "")}"
              placeholder="Conference"
              list="trn-conf-datalist" />
          </div>
        `).join("")}
        <datalist id="trn-conf-datalist">
          ${existingConfs.map(c => `<option value="${_esc(c)}">`).join("")}
        </datalist>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="trn-modal-cancel">Cancel</button>
        <button class="btn-primary"   id="trn-modal-confirm">Save</button>
      </div>
    `);

    document.getElementById("trn-modal-cancel")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-close")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-confirm")?.addEventListener("click", async () => {
      const hasConf  = document.getElementById("trn-conf-enabled")?.checked;
      const updates  = { hasConferences: hasConf };
      document.querySelectorAll(".trn-conf-input").forEach(input => {
        const lid  = input.dataset.lid;
        const conf = input.value.trim() || null;
        updates[`leagues/${lid}/conference`] = conf;
      });
      try {
        await _tLeaguesRef(tid).child(batchId).update(updates);
        showToast("Conferences saved ✓");
        _closeModal();
        const snap = await _tRef(tid).once("value");
        _tournaments[tid] = snap.val();
        _openTournamentView(tid);
        _activeAdminTab = "leagues";
      } catch(err) {
        showToast("Failed to save", "error");
      }
    });
  }

  async function _deleteBatch(tid, batchId) {
    if (!confirm("Remove this entire league batch?")) return;
    try {
      await _tLeaguesRef(tid).child(batchId).remove();
      showToast("Batch removed ✓");
      const snap = await _tRef(tid).once("value");
      _tournaments[tid] = snap.val();
      _openTournamentView(tid);
      _activeAdminTab = "leagues";
    } catch(err) {
      showToast("Failed to remove batch", "error");
    }
  }

  // Legacy single-league delete (for any old flat-structure entries)
  async function _deleteLeague(tid, lid) {
    if (!confirm("Remove this league?")) return;
    try {
      await _tLeaguesRef(tid).child(lid).remove();
      showToast("League removed ✓");
      const snap = await _tRef(tid).once("value");
      _tournaments[tid] = snap.val();
      _openTournamentView(tid);
      _activeAdminTab = "leagues";
    } catch(err) {
      showToast("Failed to remove league", "error");
    }
  }

  // ── Admin: Participants tab ───────────────────────────
  // Participant database — historical and cross-year records.
  // Firebase: gmd/tournaments/{tid}/participants/{pid}

  function _tParticipantsRef(tid) { return GMD.child(`tournaments/${tid}/participants`); }

  function _renderParticipantsTab(tid, t, body) {
    const participants = t.participants || {};
    const pList = Object.entries(participants);
    const linked   = pList.filter(([, p]) => p.dlrLinked);
    const unlinked = pList.filter(([, p]) => !p.dlrLinked);
    const autoReg  = pList.filter(([, p]) => p.autoRegister);

    body.innerHTML = `
      <div class="trn-reg-toolbar">
        <span class="trn-reg-count">
          ${pList.length} total &middot;
          <span style="color:var(--color-green)">${linked.length} DLR linked</span> &middot;
          ${unlinked.length} unlinked &middot;
          ${autoReg.length} auto-register
        </span>
        <div style="display:flex;gap:var(--space-2)">
          <button class="btn-primary btn-sm" id="trn-import-participants-btn">Import CSV</button>
          <button class="btn-secondary btn-sm" id="trn-export-participants-btn">Export CSV</button>
          <button class="btn-ghost btn-sm" id="trn-template-participants-btn" title="Download a blank CSV template with the correct column names">⬇ Template</button>
        </div>
      </div>
      <input type="file" id="trn-participants-csv-input" accept=".csv" style="display:none" />

      ${pList.length ? `
        <div class="trn-reg-toolbar" style="margin-top:0;margin-bottom:var(--space-3)">
          <input type="text" id="trn-participants-search" placeholder="Search name, email, username"
            style="flex:1;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);color:var(--color-text);font-size:.85rem" />
          <select id="trn-participants-filter" style="padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);color:var(--color-text);font-size:.85rem">
            <option value="all">All</option>
            <option value="linked">DLR Linked</option>
            <option value="unlinked">Not Linked</option>
            <option value="auto">Auto-Register</option>
          </select>
        </div>
        <div id="trn-participants-list">
          ${pList.map(([pid, p]) => _renderParticipantRow(tid, pid, p)).join("")}
        </div>
      ` : `
        <div class="trn-empty">
          <div class="trn-empty-icon">👥</div>
          <div class="trn-empty-title">No participants yet</div>
          <div class="trn-empty-sub">Import a CSV of historical participants to build your tournament database.</div>
        </div>
      `}

      <div class="trn-section-card" style="margin-top:var(--space-4)">
        <div class="trn-section-card-title">CSV Import Format</div>
        <div style="font-size:.8rem;color:var(--color-text-dim);line-height:1.8">
          Must have a header row with these column names (case-insensitive):<br>
          <code style="font-size:.78rem;display:block;margin:var(--space-2) 0;padding:var(--space-2) var(--space-3);background:var(--color-bg);border-radius:var(--radius-sm);border:1px solid var(--color-border)">displayName, email, sleeperUsername, mflEmail, yahooUsername, teamName, twitterHandle, gender, years</code>
          <strong>displayName</strong> and <strong>email</strong> are the most important. Platform columns (<strong>sleeperUsername</strong>, <strong>mflEmail</strong>, <strong>yahooUsername</strong>) are used to auto-link participants to their DLR accounts.<br>
          <strong>years</strong> — pipe-separated list of years this person has competed, e.g. <code>2022|2023|2024</code><br>
          All columns are optional except displayName. Download the template to get started.
        </div>
      </div>
    `;

    document.getElementById("trn-import-participants-btn")?.addEventListener("click", () =>
      document.getElementById("trn-participants-csv-input")?.click()
    );
    document.getElementById("trn-participants-csv-input")?.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (file) await _importParticipantsCSV(tid, file);
    });
    document.getElementById("trn-export-participants-btn")?.addEventListener("click", () =>
      _exportParticipantsCSV(t)
    );
    document.getElementById("trn-template-participants-btn")?.addEventListener("click", () => {
      const headers = "displayName,email,sleeperUsername,mflEmail,yahooUsername,teamName,twitterHandle,gender,years";
      const example = "Jane Smith,jane@example.com,janesmith,,,,@janesmith,Female,2023|2024";
      const csv  = headers + "\n" + example + "\n";
      const blob = new Blob([csv], { type: "text/csv" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = "participants_template.csv";
      a.click();
      URL.revokeObjectURL(url);
    });

    const searchAndFilter = () => {
      const q      = (document.getElementById("trn-participants-search")?.value || "").toLowerCase();
      const filter = document.getElementById("trn-participants-filter")?.value || "all";
      document.querySelectorAll(".trn-participant-row").forEach(row => {
        const text     = row.dataset.search || "";
        const isLinked = row.dataset.linked === "1";
        const isAuto   = row.dataset.auto   === "1";
        const matchQ = !q || text.includes(q);
        const matchF = filter === "all"
          || (filter === "linked"   && isLinked)
          || (filter === "unlinked" && !isLinked)
          || (filter === "auto"     && isAuto);
        row.style.display = (matchQ && matchF) ? "" : "none";
      });
    };
    document.getElementById("trn-participants-search")?.addEventListener("input", searchAndFilter);
    document.getElementById("trn-participants-filter")?.addEventListener("change", searchAndFilter);

    body.querySelectorAll("[data-view-participant]").forEach(btn =>
      btn.addEventListener("click", () =>
        _openParticipantDetail(tid, btn.dataset.viewParticipant, participants[btn.dataset.viewParticipant], t)
      )
    );
    body.querySelectorAll("[data-toggle-auto]").forEach(btn =>
      btn.addEventListener("click", () =>
        _toggleAutoRegister(tid, btn.dataset.toggleAuto, participants[btn.dataset.toggleAuto])
      )
    );
  }

  function _renderParticipantRow(tid, pid, p) {
    const searchText = [p.displayName, p.email, p.sleeperUsername, p.teamName, p.dlrUsername]
      .filter(Boolean).join(" ").toLowerCase();
    const yearsStr = Array.isArray(p.years) ? p.years.join(", ") : (p.years || "");
    return `
      <div class="trn-reg-row trn-participant-row ${p.dlrLinked ? "trn-participant--linked" : ""}"
           data-pid="${_esc(pid)}" data-search="${_esc(searchText)}"
           data-linked="${p.dlrLinked ? "1" : "0"}" data-auto="${p.autoRegister ? "1" : "0"}">
        <div class="trn-reg-main">
          <div class="trn-reg-name">
            ${_esc(p.displayName || p.teamName || "Unknown")}
            ${p.dlrLinked
              ? `<span class="trn-dlr-badge">DLR @${_esc(p.dlrUsername || "")}</span>`
              : `<span class="trn-unlinked-badge">Not on DLR</span>`}
          </div>
          <div class="trn-reg-meta">
            ${p.email           ? `${_esc(p.email)} &middot; ` : ""}
            ${p.sleeperUsername ? `Sleeper: ${_esc(p.sleeperUsername)} &middot; ` : ""}
            ${yearsStr          ? `Years: ${_esc(yearsStr)}` : ""}
          </div>
        </div>
        <div class="trn-reg-actions">
          <button class="btn-ghost btn-sm ${p.autoRegister ? "trn-auto-on" : ""}"
                  data-toggle-auto="${_esc(pid)}"
                  title="${p.autoRegister ? "Auto-register ON" : "Enable auto-register"}">🔁</button>
          <button class="btn-secondary btn-sm" data-view-participant="${_esc(pid)}">View</button>
        </div>
      </div>`;
  }

  function _openParticipantDetail(tid, pid, p, t) {
    _showModal(`
      <div class="modal-header">
        <h3>${_esc(p.displayName || p.teamName || "Participant")}</h3>
        <button class="modal-close" id="trn-modal-close">X</button>
      </div>
      <div class="modal-body trn-form-body">
        <div class="${p.dlrLinked ? "trn-dlr-badge" : "trn-unlinked-badge"}" style="margin-bottom:var(--space-3);font-size:.85rem">
          ${p.dlrLinked ? `Linked to DLR @${_esc(p.dlrUsername || "")}` : "Not yet on DLR"}
        </div>
        ${[["Display Name",p.displayName],["Team Name",p.teamName],["Email",p.email],
           ["Sleeper Username",p.sleeperUsername],["MFL Email",p.mflEmail],
           ["Yahoo Username",p.yahooUsername],
           ["Years", Array.isArray(p.years) ? p.years.join(", ") : p.years]
          ].filter(([,v]) => v).map(([label,val]) => `
          <div class="trn-detail-row"><span>${_esc(label)}</span><span>${_esc(String(val))}</span></div>
        `).join("")}
        <div class="trn-detail-row" style="margin-top:var(--space-3)">
          <span>Auto-register future years</span>
          <label style="display:flex;align-items:center;gap:var(--space-2);cursor:pointer">
            <input type="checkbox" id="trn-p-auto" ${p.autoRegister ? "checked" : ""} />
            <span>${p.autoRegister ? "Enabled" : "Disabled"}</span>
          </label>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="trn-modal-cancel">Close</button>
        ${p.email ? `<button class="btn-secondary btn-sm" id="trn-send-invite-btn">Send Invite</button>` : ""}
        <button class="btn-primary" id="trn-save-participant-btn">Save</button>
      </div>
    `);

    document.getElementById("trn-modal-cancel")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-close")?.addEventListener("click", _closeModal);
    document.getElementById("trn-send-invite-btn")?.addEventListener("click", () => {
      const subject = encodeURIComponent("You are invited to " + (t?.meta?.name || "the tournament"));
      const body    = encodeURIComponent("Hi " + (p.displayName || "") + ",\n\nYou are invited to register for this year's tournament at https://dynastylockerroom.com");
      window.open("mailto:" + encodeURIComponent(p.email) + "?subject=" + subject + "&body=" + body, "_blank");
    });
    document.getElementById("trn-save-participant-btn")?.addEventListener("click", async () => {
      const autoReg = document.getElementById("trn-p-auto")?.checked;
      try {
        await _tParticipantsRef(tid).child(pid).update({ autoRegister: autoReg });
        showToast("Saved");
        _closeModal();
        const snap = await _tRef(tid).once("value");
        _tournaments[tid] = snap.val();
        const body = document.getElementById("trn-tab-body");
        if (body) _renderParticipantsTab(tid, _tournaments[tid], body);
      } catch(err) { showToast("Failed to save", "error"); }
    });
  }

  async function _toggleAutoRegister(tid, pid, p) {
    const newVal = !p.autoRegister;
    try {
      await _tParticipantsRef(tid).child(pid).update({ autoRegister: newVal });
      showToast(newVal ? "Auto-register enabled" : "Auto-register disabled");
      const snap = await _tRef(tid).once("value");
      _tournaments[tid] = snap.val();
      const body = document.getElementById("trn-tab-body");
      if (body) _renderParticipantsTab(tid, _tournaments[tid], body);
    } catch(err) { showToast("Failed to update", "error"); }
  }

  // Build the expected CSV columns for this tournament's registration form
  function _getParticipantCsvColumns(t) {
    const opts = t?.meta?.registrationForm?.optionalFields || [];
    // Always include: standard fields + platform fields + enabled optional fields + years
    const cols = [...STD_FIELDS, ...PLATFORM_FIELDS, ...opts, "years"];
    // Deduplicate (in case a platform field is also in opts)
    return [...new Set(cols)];
  }

  async function _importParticipantsCSV(tid, file) {
    const t = _tournaments[tid] || {};
    try {
      const text  = await file.text();
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) { showToast("CSV has no data rows", "error"); return; }

      const fileHeaders = _parseCSVRow(lines[0]).map(h =>
        h.toLowerCase().replace(/[\s_]/g, "").replace(/address$/, "")
      );
      const updates = {};
      let count = 0;

      for (let i = 1; i < lines.length; i++) {
        const vals = _parseCSVRow(lines[i]);
        if (!vals.length) continue;
        const row = {};
        fileHeaders.forEach((h, idx) => { if (vals[idx] !== undefined) row[h] = vals[idx]; });

        // Map normalized header keys to canonical field names
        const get = (...keys) => {
          for (const k of keys) { const v = row[k]; if (v && v.trim()) return v.trim(); }
          return null;
        };

        const pid   = _genId();
        const entry = {
          displayName:     get("displayname", "display") || "",
          email:           get("email", "emailaddress")  || "",
          sleeperUsername: get("sleeperusername", "sleeper") || null,
          mflEmail:        get("mflemail", "mfl")            || null,
          yahooUsername:   get("yahoousername", "yahoo")     || null,
          teamName:        get("teamname", "team")           || null,
          twitterHandle:   get("twitterhandle", "twitter", "x") || null,
          gender:          get("gender") || null,
          years:           row.years ? row.years.split("|").map(y => y.trim()).filter(Boolean) : [],
          autoRegister:    false,
          dlrLinked:       false,
          dlrUsername:     null,
          source:          "csv_import",
          importedAt:      Date.now()
        };

        // Also capture any custom columns from the file that map to custom question fields
        fileHeaders.forEach((h, idx) => {
          if (h.startsWith("custom") && vals[idx]) entry[h] = vals[idx].trim();
        });

        // Treat empty strings as null
        Object.keys(entry).forEach(k => { if (entry[k] === "") entry[k] = null; });

        updates[pid] = entry;
        count++;
      }

      if (!count) { showToast("No valid rows found", "error"); return; }

      // Save to Firebase
      await _tParticipantsRef(tid).update(updates);

      // Refresh local cache immediately so the tab re-renders with saved data
      const freshSnap = await _tRef(tid).once("value");
      _tournaments[tid] = freshSnap.val();
      const tabBody = document.getElementById("trn-tab-body");
      if (tabBody && _activeAdminTab === "participants") {
        _renderParticipantsTab(tid, _tournaments[tid], tabBody);
      }

      showToast(count + " participant" + (count !== 1 ? "s" : "") + " imported — matching DLR accounts...");
      _matchParticipantsToDLR(tid, updates);
    } catch(err) {
      console.error("[Tournament] Import error:", err);
      showToast("Import failed: " + err.message, "error");
    }
  }

  async function _matchParticipantsToDLR(tid, participantsMap) {
    try {
      const usersSnap = await GMD.child("users").once("value");
      const users = usersSnap.val() || {};
      const bySleeperUsername = {};
      const byMflEmail        = {};
      const byYahooUsername   = {};

      for (const [username, u] of Object.entries(users)) {
        // Sleeper: try all known field names the profile might store the handle under
        const sleeper = u?.platforms?.sleeper;
        const s = (sleeper?.sleeperUsername || sleeper?.username || sleeper?.displayName || "").toLowerCase();
        // MFL: email address
        const m = (u?.platforms?.mfl?.mflEmail || "").toLowerCase();
        // Yahoo: username
        const y = (u?.platforms?.yahoo?.username || u?.platforms?.yahoo?.yahooUsername || "").toLowerCase();
        if (s) bySleeperUsername[s] = username;
        if (m) byMflEmail[m]        = username;
        if (y) byYahooUsername[y]   = username;
      }

      console.log("[Tournament] DLR index built — Sleeper:", Object.keys(bySleeperUsername).length,
        "MFL:", Object.keys(byMflEmail).length, "Yahoo:", Object.keys(byYahooUsername).length);

      const matchUpdates = {};
      for (const [pid, p] of Object.entries(participantsMap)) {
        let matched = null;
        if (p.sleeperUsername) matched = bySleeperUsername[p.sleeperUsername.toLowerCase()];
        if (!matched && p.mflEmail)      matched = byMflEmail[p.mflEmail.toLowerCase()];
        if (!matched && p.yahooUsername) matched = byYahooUsername[p.yahooUsername.toLowerCase()];

        console.log("[Tournament] Participant", p.displayName,
          "sleeperUsername:", p.sleeperUsername, "-> matched:", matched);

        if (matched) {
          matchUpdates[pid + "/dlrLinked"]   = true;
          matchUpdates[pid + "/dlrUsername"] = matched;
        }
      }

      if (Object.keys(matchUpdates).length) {
        await _tParticipantsRef(tid).update(matchUpdates);
        const mc = Object.keys(matchUpdates).length / 2;
        showToast(mc + " participant" + (mc !== 1 ? "s" : "") + " matched to DLR accounts ✓");
        const snap = await _tRef(tid).once("value");
        _tournaments[tid] = snap.val();
        const body = document.getElementById("trn-tab-body");
        if (body && _activeAdminTab === "participants") _renderParticipantsTab(tid, _tournaments[tid], body);
      } else {
        showToast("Import complete — no DLR matches found");
      }
    } catch(err) {
      console.error("[Tournament] DLR match error:", err);
      showToast("Match failed: " + err.message, "error");
    }
  }

  function _exportParticipantsCSV(t) {
    const participants = Object.entries(t.participants || {});
    if (!participants.length) { showToast("No participants to export", "info"); return; }
    const headers = ["pid","displayName","email","sleeperUsername","mflEmail","yahooUsername","teamName","years","dlrLinked","dlrUsername","autoRegister"];
    const rows = participants.map(([pid, p]) =>
      headers.map(h => {
        let val = h === "pid" ? pid : (p[h] ?? "");
        if (Array.isArray(val)) val = val.join("|");
        return `"${String(val).replace(/"/g, '""')}"`; 
      }).join(",")
    );
    const csv  = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "participants_" + (t.meta?.name || "tournament").replace(/\s+/g, "_") + ".csv";
    a.click();
    URL.revokeObjectURL(url);
    showToast("CSV exported");
  }

  // ── Standings ──────────────────────────────────────────
  // Firebase: gmd/tournaments/{tid}/standingsCache/{leagueId}
  // { leagueName, platform, year, batchId, conference, division,
  //   teams:[{teamId,teamName,wins,losses,ties,pf,pa}], lastSynced }

  function _tStandingsRef(tid)  { return GMD.child("tournaments/" + tid + "/standingsCache"); }
  function _tAnalyticsRef(tid) { return GMD.child("tournaments/" + tid + "/analyticsCache"); }

  let _standingsSort = { col: "overallRank", dir: "asc" };

  function _rankTeams(teams, rankBy) {
    return [...teams].sort((a, b) => {
      if (rankBy === "pf") return b.pf - a.pf;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.pf - a.pf;
    }).map((t, i) => ({ ...t, computedRank: i + 1 }));
  }

  function _sortRows(rows, col, dir) {
    const mult = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (["teamName","leagueName","conference","division"].includes(col))
        return mult * String(a[col]||"").localeCompare(String(b[col]||""));
      return mult * ((Number(a[col])||0) - (Number(b[col])||0));
    });
  }

  let _standingsYear = null;

  function _renderStandingsTab(tid, t, body, isAdmin) {
    const cache  = t.standingsCache || {};
    const meta   = t.meta || {};
    const rankBy = meta.rankBy || "record";

    // Deduplicate: new year_leagueId keys may coexist with old flat leagueId keys.
    // If any new-format keys exist, discard the old flat ones to avoid doubled rows.
    const allEntriesRaw = Object.entries(cache);
    const hasNewKeys    = allEntriesRaw.some(([k]) => /^\d{4}_/.test(k));
    const allEntries    = hasNewKeys
      ? allEntriesRaw.filter(([k]) => /^\d{4}_/.test(k))
      : allEntriesRaw;

    if (!allEntries.length) {
      body.innerHTML = `
        <div class="trn-empty">
          <div class="trn-empty-icon">&#x1F4CA;</div>
          <div class="trn-empty-title">No standings data yet</div>
          <div class="trn-empty-sub">${isAdmin
            ? "Go to the Leagues tab and click Sync Standings."
            : "The commissioner has not synced standings yet."}</div>
        </div>`;
      return;
    }

    // Available years — year is driven by the global _tournamentYear selector in the header
    const availableYears = [...new Set(allEntries.map(([, lc]) => lc.year).filter(Boolean))].sort((a,b) => b-a);
    if (!_tournamentYear || !availableYears.includes(_tournamentYear)) {
      _tournamentYear = availableYears[0] || null;
      _standingsYear  = _tournamentYear;
    }
    const entries = _tournamentYear
      ? allEntries.filter(([, lc]) => lc.year === _tournamentYear)
      : allEntries;

    // Build participant lookup — keyed by sleeperUsername/displayName/teamName.
    // Keys are sanitized (trimmed, lowercased, Firebase-illegal chars replaced with _)
    // so they match the participantMap keys written by _writePublicSummary.
    const _sk = (s) => String(s).trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_");
    const participants = t.participants || {};
    const displayNameByKey = {}; // sanitized key → participant displayName
    const genderByKey      = {}; // sanitized key → participant gender
    Object.values(participants).forEach(p => {
      const keys = [p.sleeperUsername, p.displayName, p.teamName]
        .filter(Boolean).map(_sk).filter(Boolean);
      keys.forEach(k => {
        if (p.displayName) displayNameByKey[k] = p.displayName;
        if (p.gender)      genderByKey[k]      = p.gender;
      });
    });
    const hasGender = Object.keys(genderByKey).length > 0;
    const twitterByKey = {}; // sanitized key → participant twitterHandle
    Object.values(participants).forEach(p => {
      if (!p.twitterHandle) return;
      const keys = [p.sleeperUsername, p.displayName, p.teamName]
        .filter(Boolean).map(_sk).filter(Boolean);
      keys.forEach(k => { twitterByKey[k] = p.twitterHandle; });
    });

    // Build flat rows
    let allRows = [];
    let lastSynced = 0;
    for (const [cacheKey, lc] of entries) {
      const ranked = _rankTeams(lc.teams || [], rankBy);
      ranked.forEach(team => {
        const _tnKey = _sk(team.teamName || "");
        allRows.push({
          rank:        team.computedRank,
          // Show participant displayName if matched; fall back to what Sleeper returned
          teamName:    displayNameByKey[_tnKey] || team.teamName || "Unknown",
          // Keep original API name for search/matching
          rawTeamName: team.teamName || "Unknown",
          leagueName:  lc.leagueName || cacheKey,
          conference:  lc.conference || "",
          division:    lc.division   || "",
          wins:        team.wins     || 0,
          losses:      team.losses   || 0,
          ties:        team.ties     || 0,
          pf:          team.pf       || 0,
          pa:          team.pa       || 0,
          gender:        genderByKey[_tnKey]   || "",
          twitterHandle: twitterByKey[_tnKey]  || "",
          cacheKey,
          platform:      lc.platform            || ""
        });
      });
      if ((lc.lastSynced||0) > lastSynced) lastSynced = lc.lastSynced;
    }

    // Overall rank
    allRows = _rankTeams(allRows, rankBy).map((r, i) => ({ ...r, overallRank: i + 1 }));
    allRows = _sortRows(allRows, _standingsSort.col, _standingsSort.dir);

    const conferences   = [...new Set(allRows.map(r => r.conference).filter(Boolean))].sort();
    const divisions     = [...new Set(allRows.map(r => r.division).filter(Boolean))].sort();
    const hasConf       = conferences.length > 0;
    const hasDiv        = divisions.length > 0;
    const lastSyncedStr = lastSynced ? new Date(lastSynced).toLocaleString() : "Never";
    // gender is shown as inline badge on team name, not a column
    // twitterHandle is shown as "(@handle)" link inline after the display name
    const extraCols = [];

    body.innerHTML = `
      <div class="trn-standings-toolbar">
        <div style="display:flex;gap:var(--space-2);align-items:center;margin-bottom:var(--space-2)">
          ${hasConf ? `<select id="trn-st-group" class="trn-filter-select" style="min-width:0">
            <option value="flat">All Conferences</option>
            ${conferences.map(conf => `<option value="conf_${_esc(conf)}">${_esc(conf)}</option>`).join("")}
          </select>` : hasDiv ? `<select id="trn-st-group" class="trn-filter-select" style="min-width:0">
            <option value="flat">All Divisions</option>
            ${divisions.map(d => `<option value="div_${_esc(d)}">${_esc(d)}</option>`).join("")}
          </select>` : ""}
        </div>
        <input type="text" id="trn-st-search" placeholder="Search team or league…" class="trn-st-search" />
      </div>
      <div class="trn-standings-meta">
        Last synced: ${_esc(lastSyncedStr)}
        <span style="color:var(--color-text-dim);margin-left:var(--space-3)">
          ${allRows.length} teams &middot; ${entries.length} leagues
        </span>
      </div>
      <div id="trn-standings-wrap">
        ${_buildStandingsTable(allRows, hasConf, hasDiv, "flat", extraCols)}
      </div>
    `;

    const refilter = () => {
      const q    = (document.getElementById("trn-st-search")?.value || "").toLowerCase();
      const grpVal = document.getElementById("trn-st-group")?.value || "flat";
      let rows = allRows;
      if (q) rows = rows.filter(r =>
        r.teamName.toLowerCase().includes(q) ||
        (r.rawTeamName||"").toLowerCase().includes(q) ||
        r.leagueName.toLowerCase().includes(q));
      // Parse grouped conference/division filter
      let grp = "flat";
      if (grpVal.startsWith("conf_")) {
        const confName = grpVal.slice(5);
        rows = rows.filter(r => r.conference === confName);
        grp = "conf";
      } else if (grpVal.startsWith("div_")) {
        const divName = grpVal.slice(4);
        rows = rows.filter(r => r.division === divName);
        grp = "div";
      }
      rows = _sortRows(rows, _standingsSort.col, _standingsSort.dir);
      const wrap = document.getElementById("trn-standings-wrap");
      if (wrap) wrap.innerHTML = _buildStandingsTable(rows, hasConf, hasDiv, grp, extraCols);
      _wireStandingSortHeaders(allRows, hasConf, hasDiv);
    };

    document.getElementById("trn-st-search")?.addEventListener("input", refilter);
    document.getElementById("trn-st-group")?.addEventListener("change", refilter);
    _wireStandingSortHeaders(allRows, hasConf, hasDiv);
  }

  function _wireStandingSortHeaders(allRows, hasConf, hasDiv) {
    document.querySelectorAll("[data-sort-col]").forEach(th => {
      th.classList.toggle("trn-st-sorted", _standingsSort.col === th.dataset.sortCol);
      // clone to remove old listeners
      const fresh = th.cloneNode(true);
      th.parentNode?.replaceChild(fresh, th);
      fresh.addEventListener("click", () => {
        const col = fresh.dataset.sortCol;
        if (_standingsSort.col === col) {
          _standingsSort.dir = _standingsSort.dir === "asc" ? "desc" : "asc";
        } else {
          _standingsSort.col = col;
          _standingsSort.dir = "asc";
        }
        // Re-trigger filter (search field may be set)
        document.getElementById("trn-st-search")?.dispatchEvent(new Event("input"));
      });
    });
  }

  function _buildStandingsTable(rows, hasConf, hasDiv, groupMode, extraCols) {
    const extra = extraCols || [];
    if (!rows.length) return '<div class="empty-state">No teams match your filters.</div>';

    const si = (col) => {
      if (_standingsSort.col !== col) return '<span style="margin-left:3px;font-size:.65rem;opacity:.4">⇅</span>';
      return '<span style="margin-left:3px;font-size:.65rem">' + (_standingsSort.dir === "asc" ? "↑" : "↓") + "</span>";
    };

    const thBase = "cursor:pointer;user-select:none;white-space:nowrap";
    // Explicit widths on th cells — table-layout:fixed uses first row widths
    const thead = "<thead><tr>" +
      '<th class="standings-rank" data-sort-col="overallRank" style="' + thBase + ';width:32px">#' + si("overallRank") + "</th>" +
      '<th data-sort-col="teamName" style="' + thBase + '">Team' + si("teamName") + "</th>" +

      extra.map(col => '<th data-sort-col="' + col.key + '" style="' + thBase + '">' + col.label + si(col.key) + "</th>").join("") +
      '<th class="standings-win"  data-sort-col="wins"   style="' + thBase + ';width:36px">W'  + si("wins")   + "</th>" +
      '<th class="standings-loss" data-sort-col="losses" style="' + thBase + ';width:36px">L'  + si("losses") + "</th>" +
      '<th class="standings-num"  data-sort-col="pf"     style="' + thBase + ';width:64px">PF' + si("pf")     + "</th>" +
      "</tr></thead>";

    const genderBadge = (g) => {
      if (!g) return "";
      if (g === "Male")   return ' <span class="trn-gender-m">M</span>';
      if (g === "Female") return ' <span class="trn-gender-f">F</span>';
      return "";
    };

    const twitterLink = (r) => {
      if (!r.twitterHandle) return "";
      const h = r.twitterHandle.startsWith("@") ? r.twitterHandle.slice(1) : r.twitterHandle;
      return '<a href="https://x.com/' + _esc(h) + '" target="_blank" rel="noopener" class="trn-st-twitter">@' + _esc(h) + '</a>';
    };

    const rowHtml = (r) =>
      "<tr>" +
      '<td class="standings-rank">' + r.overallRank + "</td>" +
      '<td><span class="standings-team-cell"><span class="st-av">' + _esc((r.teamName||"?").slice(0,2).toUpperCase()) + '</span><span class="trn-st-name-wrap"><span class="trn-st-name">' + _esc(r.teamName) + genderBadge(r.gender) + twitterLink(r) + '</span>' +
      (hasConf && r.conference ? '<span class="trn-st-sub">' + _esc(r.conference) + "</span>" : "") +
      (hasDiv  && r.division   ? '<span class="trn-st-sub">' + _esc(r.division)   + "</span>" : "") +
      '<span class="trn-st-sub trn-st-sub--league">' + _esc(r.leagueName) + "</span>" +
      "</span></span></td>" +
      extra.map(col => {
        if (col.key === "twitterHandle") {
          const h = r.twitterHandle || "";
          if (!h) return "<td>—</td>";
          const handle = h.startsWith("@") ? h : "@" + h;
          return '<td><a href="https://x.com/' + _esc(h.replace(/^@/, "")) + '" target="_blank" rel="noopener" style="color:var(--color-accent);text-decoration:none">' + _esc(handle) + "</a></td>";
        }
        return "<td>" + _esc(r[col.key] || "—") + "</td>";
      }).join("") +
      '<td class="standings-win">'  + r.wins + "</td>" +
      '<td class="standings-loss">' + r.losses + "</td>" +
      '<td class="standings-num">'  + r.pf.toFixed(2) + "</td>" +
      "</tr>";

    const tableWrap = (innerRows) =>
      '<div class="standings-table-wrap"><table class="standings-table">' +
      thead + "<tbody>" + innerRows.map(rowHtml).join("") + "</tbody></table></div>";

    if (groupMode === "conf" && hasConf) {
      const grouped = {};
      rows.forEach(r => { const k = r.conference || "No Conference"; (grouped[k] = grouped[k]||[]).push(r); });
      return Object.entries(grouped).map(([g, gr]) =>
        '<div class="trn-st-group-label">' + _esc(g) + "</div>" + tableWrap(gr)
      ).join("");
    }
    if (groupMode === "div" && hasDiv) {
      const grouped = {};
      rows.forEach(r => { const k = r.division || "No Division"; (grouped[k] = grouped[k]||[]).push(r); });
      return Object.entries(grouped).map(([g, gr]) =>
        '<div class="trn-st-group-label">' + _esc(g) + "</div>" + tableWrap(gr)
      ).join("");
    }
    if (groupMode === "gender") {
      const order = ["Male", "Female", ""];
      const grouped = {};
      rows.forEach(r => { const k = r.gender || ""; (grouped[k] = grouped[k]||[]).push(r); });
      return order.filter(k => grouped[k]).map(k =>
        '<div class="trn-st-group-label">' + _esc(k || "Not specified") + "</div>" + tableWrap(grouped[k])
      ).join("");
    }
    return tableWrap(rows);
  }

  // ── Sync standings ─────────────────────────────────────
  async function _syncStandings(tid, t) {
    const batches = t.leagues || {};
    const isBatch = (v) => v && typeof v === "object" && v.leagues !== undefined;
    const realBatches = Object.entries(batches).filter(([, v]) => isBatch(v));

    if (!realBatches.length) { showToast("No league batches to sync", "info"); return; }

    const toSync = [];
    for (const [batchId, batch] of realBatches) {
      for (const [leagueId, l] of Object.entries(batch.leagues || {})) {
        toSync.push({
          leagueId,
          platform:   batch.platform  || "sleeper",
          year:       batch.year      || new Date().getFullYear(),
          batchId,
          conference: l.conference    || null,
          division:   l.division      || null,
          leagueName: l.name          || leagueId
        });
      }
    }

    const total = toSync.length;
    let done = 0;
    const btn = document.getElementById("trn-sync-standings-btn");
    const setP = (msg) => { if (btn) { btn.disabled = true; btn.textContent = msg; } };
    setP("Syncing 0/" + total + "...");

    const sleepers = toSync.filter(l => l.platform === "sleeper");
    const mfls     = toSync.filter(l => l.platform === "mfl");
    const yahoos   = toSync.filter(l => l.platform === "yahoo");
    const cacheUpdates = {};
    const syncWarnings = []; // { platform, message } accumulated during sync

    // Cache key: year_leagueId prevents cross-year collision for same leagueId
    const ck = (l) => l.year + "_" + l.leagueId;
    const playoffWeek = t.meta?.playoffStartWeek || null;

    // Sleeper — parallel
    const medianWins = !!(t.meta?.medianWins);
    await Promise.allSettled(sleepers.map(async (l) => {
      try {
        const data = await _fetchSleeperStandings(l.leagueId, playoffWeek);
        if (data) {
          let { teams, weeklyScores, leagueStatus, playoffWinnerRosterId } = data;
          if (medianWins && weeklyScores) {
            const delta = _computeMedianWins(weeklyScores);
            teams = teams.map(tm => {
              const d = delta[tm.teamId] || { medWins: 0, medLosses: 0 };
              return {
                ...tm,
                wins:   tm.wins   + d.medWins,
                losses: tm.losses + d.medLosses
              };
            });
          }
          // Build champion object: playoff winner if bracket ran, otherwise reg season leader
          let champion = null;
          if (playoffWinnerRosterId) {
            const winnerTeam = teams.find(tm => String(tm.teamId) === playoffWinnerRosterId);
            if (winnerTeam) champion = { ...winnerTeam, isPlayoffChampion: true };
          }
          if (!champion) {
            // Fallback: regular season leader (most wins, then PF)
            const regChamp = [...teams].sort((a,b) =>
              (b.wins||0)-(a.wins||0) || (b.pf||0)-(a.pf||0))[0];
            if (regChamp) champion = { ...regChamp, isPlayoffChampion: false };
          }
          cacheUpdates[ck(l)] = { ...l, teams, leagueStatus: leagueStatus||"", champion, lastSynced: Date.now() };
        }
      } catch(e) { console.warn("[Standings] Sleeper", l.leagueId, e.message); }
      done++; setP("Syncing " + done + "/" + total + "...");
    }));

    // MFL — 3 at a time, 300ms gap
    for (let i = 0; i < mfls.length; i += 3) {
      await Promise.allSettled(mfls.slice(i, i + 3).map(async (l) => {
        try {
          const data = await _fetchMFLStandings(l.leagueId, l.year);
          if (data) cacheUpdates[ck(l)] = { ...l, ...data, lastSynced: Date.now() };
          else syncWarnings.push({ platform: "mfl", message: `League "${l.leagueName || l.leagueId}" returned no data — MFL may require authentication via the worker.` });
        } catch(e) {
          console.warn("[Standings] MFL", l.leagueId, e.message);
          syncWarnings.push({ platform: "mfl", message: `League "${l.leagueName || l.leagueId}" failed: ${e.message}` });
        }
        done++; setP("Syncing " + done + "/" + total + "...");
      }));
      if (i + 3 < mfls.length) await new Promise(r => setTimeout(r, 300));
    }

    // Yahoo — 2 at a time, 600ms gap
    const yahooToken = localStorage.getItem("dlr_yahoo_access_token");
    if (yahoos.length && !yahooToken) {
      showToast("Yahoo standings skipped — connect Yahoo in your profile first", "info");
      syncWarnings.push({ platform: "yahoo", message: `${yahoos.length} Yahoo league${yahoos.length !== 1 ? "s" : ""} skipped — connect Yahoo in your profile first.` });
      done += yahoos.length;
    } else {
      for (let i = 0; i < yahoos.length; i += 2) {
        await Promise.allSettled(yahoos.slice(i, i + 2).map(async (l) => {
          try {
            const data = await _fetchYahooStandings(l.leagueId, yahooToken);
            if (data) cacheUpdates[ck(l)] = { ...l, ...data, lastSynced: Date.now() };
            else syncWarnings.push({ platform: "yahoo", message: `League "${l.leagueName || l.leagueId}" returned no data — Yahoo token may be expired.` });
          } catch(e) {
            console.warn("[Standings] Yahoo", l.leagueId, e.message);
            syncWarnings.push({ platform: "yahoo", message: `League "${l.leagueName || l.leagueId}" failed: ${e.message}` });
          }
          done++; setP("Syncing " + done + "/" + total + "...");
        }));
        if (i + 2 < yahoos.length) await new Promise(r => setTimeout(r, 600));
      }
    }

    if (!Object.keys(cacheUpdates).length) {
      if (btn) { btn.disabled = false; btn.textContent = "Sync Standings"; }
      showToast("No standings data retrieved", "error");
      return;
    }

    try {
      await _tStandingsRef(tid).update(cacheUpdates);
      const snap = await _tRef(tid).once("value");
      _tournaments[tid] = snap.val();
      // Sync scoring settings (fire-and-forget, non-blocking)
      const activeYear = toSync[0]?.year || new Date().getFullYear();
      _syncScoringSettings(tid, toSync, activeYear).catch(e =>
        console.warn("[tournament.js] Scoring settings sync failed:", e));
      if (btn) { btn.disabled = false; btn.textContent = "Sync Standings"; }
      showToast("Standings synced — " + Object.keys(cacheUpdates).length + "/" + total + " leagues");
      _writePublicSummary(tid, _tournaments[tid]);
      // Show cross-platform warning banner if anything was skipped/failed,
      // or if scoring settings differ across platforms
      const scoringDiffs = _getScoringDiffs(_tournaments[tid], toSync[0]?.year || new Date().getFullYear());
      if (syncWarnings.length || scoringDiffs.length) {
        _showSyncWarningBanner(syncWarnings, scoringDiffs);
      }
      const body = document.getElementById("trn-tab-body");
      if (body) _renderLeaguesTab(tid, _tournaments[tid], body);
    } catch(err) {
      if (btn) { btn.disabled = false; btn.textContent = "Sync Standings"; }
      showToast("Failed to save: " + err.message, "error");
    }
  }

  // ── Platform fetchers ──────────────────────────────────

  // ── Cross-platform warning banner (F-X) ────────────────────────────────────
  // Shown after sync if platforms were skipped/failed, or if scoring differs.
  // Inserts a dismissible amber banner above the current tab body.
  function _showSyncWarningBanner(warnings, scoringDiffs) {
    document.getElementById("trn-xplat-banner")?.remove();

    const platLabel = { mfl: "🔵 MFL", yahoo: "🟣 Yahoo", sleeper: "🟢 Sleeper" };
    const warnItems = (warnings || []).map(w =>
      `<li><strong>${platLabel[w.platform] || w.platform}:</strong> ${_esc(w.message)}</li>`
    ).join("");

    const diffChips = (scoringDiffs || []).map(d =>
      `<span class="trn-xplat-diff-chip">⚡ ${_esc(d.label)}: ${d.vals.join(" vs ")}</span>`
    ).join("");

    const hasDiffs = diffChips.length > 0;

    const banner = document.createElement("div");
    banner.id        = "trn-xplat-banner";
    banner.className = "trn-xplat-banner";
    banner.innerHTML = `
      <span class="trn-xplat-banner-icon">⚠️</span>
      <div class="trn-xplat-banner-body">
        ${warnings?.length ? `
          <div class="trn-xplat-banner-title">Cross-platform sync issues</div>
          <ul class="trn-xplat-banner-items">${warnItems}</ul>` : ""}
        ${hasDiffs ? `
          <div class="trn-xplat-banner-title" style="${warnings?.length ? "margin-top:var(--space-2)" : ""}">
            Scoring differences detected between platforms
          </div>
          <div class="trn-xplat-scoring-diffs">${diffChips}</div>
          <div style="font-size:.74rem;color:var(--color-text-dim);margin-top:var(--space-1)">
            These may affect cross-platform fairness. Review in Info / Rules → Scoring Settings.
          </div>` : ""}
      </div>
      <button class="trn-xplat-banner-dismiss" id="trn-xplat-dismiss" title="Dismiss">✕</button>`;

    const tabBody = document.getElementById("trn-tab-body");
    tabBody?.parentNode?.insertBefore(banner, tabBody);
    document.getElementById("trn-xplat-dismiss")?.addEventListener("click", () => banner.remove());
  }

  // Returns array of {label, vals} for scoring fields that differ across platforms.
  // Reads from t.scoringSettings[year]. Returns [] if single-platform or no diffs.
  function _getScoringDiffs(t, year) {
    const scoring   = (t?.scoringSettings || {})[String(year)] || {};
    const platforms = Object.keys(scoring).filter(k => !k.startsWith("_"));
    if (platforms.length < 2) return [];

    const CHECK_FIELDS = [
      { key: "pass_yd",      label: "Pass Yd/pt" },
      { key: "pass_td",      label: "Pass TD"    },
      { key: "pass_int",     label: "INT"         },
      { key: "rush_yd",      label: "Rush Yd/pt" },
      { key: "rush_td",      label: "Rush TD"    },
      { key: "rec",          label: "Rec (PPR)"  },
      { key: "rec_yd",       label: "Rec Yd/pt"  },
      { key: "rec_td",       label: "Rec TD"     },
      { key: "bonus_rec_te", label: "TE Bonus"   },
      { key: "fum_lost",     label: "Fum Lost"   },
      { key: "_format",      label: "Format"     },
    ];

    return CHECK_FIELDS.reduce((acc, f) => {
      const vals = platforms.map(p => {
        const v = scoring[p]?.[f.key];
        return v !== undefined && v !== null ? String(v) : null;
      }).filter(v => v !== null);
      if (vals.length < 2) return acc;
      const unique = [...new Set(vals)];
      if (unique.length > 1) {
        acc.push({
          label: f.label,
          vals:  platforms.map(p => `${p.toUpperCase()}:${scoring[p]?.[f.key] ?? "?"}`)
        });
      }
      return acc;
    }, []);
  }

  async function _fetchSleeperStandings(leagueId, playoffStartWeek) {
    const [rU, rR, rL] = await Promise.all([
      fetch("https://api.sleeper.app/v1/league/" + leagueId + "/users"),
      fetch("https://api.sleeper.app/v1/league/" + leagueId + "/rosters"),
      fetch("https://api.sleeper.app/v1/league/" + leagueId)
    ]);
    if (!rU.ok || !rR.ok) return null;
    const users   = await rU.json();
    const rosters = await rR.json();
    // teamNameMap: the fantasy team name shown in league standings (metadata.team_name preferred)
    // displayNameMap_u: the Sleeper account display name — stored separately so dropdown labels
    //   can show "Team Name (sleeper_handle)" for easier identification.
    const teamNameMap      = {};
    const displayNameMap_u = {};
    const sleeperUsernameMap = {}; // user_id -> username (stable handle)
    (users || []).forEach(u => {
      const fantasyName = (u.metadata?.team_name || "").trim();
      const displayName = (u.display_name || u.username || u.user_id || "").trim();
      teamNameMap[u.user_id]      = fantasyName || displayName;  // prefer league team name
      displayNameMap_u[u.user_id] = displayName;
      if (u.username) sleeperUsernameMap[u.user_id] = u.username.toLowerCase();
    });
    const uMap = teamNameMap; // alias — rest of function uses uMap unchanged

    // Parse league info to determine if playoffs ran and who won
    const leagueInfo = rL.ok ? await rL.json().catch(() => null) : null;
    const leagueStatus = leagueInfo?.status || "";
    const hasPlayoffs  = leagueStatus === "post_season" || leagueStatus === "complete";

    // If the league ran its own playoffs, fetch the winners bracket to find the champion
    let playoffWinnerRosterId = null;
    if (hasPlayoffs) {
      try {
        const rB = await fetch("https://api.sleeper.app/v1/league/" + leagueId + "/winners_bracket");
        if (rB.ok) {
          const bracket = await rB.json();
          // p===1 is the championship game; m.w is the winning roster_id
          const champGame = (bracket || []).find(m => m.p === 1);
          if (champGame?.w != null) playoffWinnerRosterId = String(champGame.w);
        }
      } catch(e) { /* bracket fetch failure is non-fatal */ }
    }


    // so we only count regular season weeks (weeks 1 through playoffStartWeek-1)
    if (playoffStartWeek && playoffStartWeek > 1) {
      const lastRegWeek = playoffStartWeek - 1;
      // Fetch all regular season weeks in parallel
      const weekFetches = [];
      for (let w = 1; w <= lastRegWeek; w++) {
        weekFetches.push(
          fetch("https://api.sleeper.app/v1/league/" + leagueId + "/matchups/" + w)
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        );
      }
      const allWeeks = await Promise.all(weekFetches);

      // Build W/L/PF/PA from matchup results
      const stats = {}; // rosterId -> { wins, losses, ties, pf, pa }
      allWeeks.forEach(weekMatchups => {
        if (!Array.isArray(weekMatchups)) return;
        // Group by matchup_id
        const byMatchup = {};
        weekMatchups.forEach(m => {
          if (!m.matchup_id) return;
          (byMatchup[m.matchup_id] = byMatchup[m.matchup_id] || []).push(m);
        });
        Object.values(byMatchup).forEach(pair => {
          if (pair.length !== 2) return;
          const [a, b] = pair;
          const apts = a.points || 0;
          const bpts = b.points || 0;
          if (!stats[a.roster_id]) stats[a.roster_id] = { wins:0, losses:0, ties:0, pf:0, pa:0 };
          if (!stats[b.roster_id]) stats[b.roster_id] = { wins:0, losses:0, ties:0, pf:0, pa:0 };
          stats[a.roster_id].pf += apts;
          stats[a.roster_id].pa += bpts;
          stats[b.roster_id].pf += bpts;
          stats[b.roster_id].pa += apts;
          if (apts > bpts) { stats[a.roster_id].wins++; stats[b.roster_id].losses++; }
          else if (bpts > apts) { stats[b.roster_id].wins++; stats[a.roster_id].losses++; }
          else { stats[a.roster_id].ties++; stats[b.roster_id].ties++; }
        });
      });

      const teams = (rosters || []).map(r => {
        const s = stats[r.roster_id] || { wins:0, losses:0, ties:0, pf:0, pa:0 };
        return {
          teamId:             String(r.roster_id),
          userId:             String(r.owner_id || ""),
          sleeperUsername:    sleeperUsernameMap[r.owner_id] || "",
          sleeperDisplayName: displayNameMap_u[r.owner_id]   || "",
          teamName:           uMap[r.owner_id] || ("Team " + r.roster_id),
          wins:     s.wins,
          losses:   s.losses,
          ties:     s.ties,
          pf:       parseFloat(s.pf.toFixed(2)),
          pa:       parseFloat(s.pa.toFixed(2))
        };
      });
      // Median wins: pass weeklyScores to allow caller to apply them
      return { teams, weeklyScores: allWeeks, leagueStatus, playoffWinnerRosterId };
    }

    // No playoff week set — fetch all weeks to compute median wins later
    // First determine the current/completed week range from rosters
    const maxWeek = Math.max(...(rosters || []).map(r =>
      (r.settings?.wins || 0) + (r.settings?.losses || 0) + (r.settings?.ties || 0)
    ), 0);

    let weeklyScores = null;
    if (maxWeek > 0) {
      const wFetches = [];
      for (let w = 1; w <= maxWeek; w++) {
        wFetches.push(
          fetch("https://api.sleeper.app/v1/league/" + leagueId + "/matchups/" + w)
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        );
      }
      weeklyScores = await Promise.all(wFetches);
    }

    const teams = (rosters || []).map(r => ({
      teamId:             String(r.roster_id),
      userId:             String(r.owner_id || ""),
      sleeperUsername:    sleeperUsernameMap[r.owner_id] || "",
      sleeperDisplayName: displayNameMap_u[r.owner_id]   || "",
      teamName:           uMap[r.owner_id] || ("Team " + r.roster_id),
      wins:     r.settings?.wins    || 0,
      losses:   r.settings?.losses  || 0,
      ties:     r.settings?.ties    || 0,
      pf:       parseFloat(((r.settings?.fpts || 0) + (r.settings?.fpts_decimal || 0) / 100).toFixed(2)),
      pa:       parseFloat(((r.settings?.fpts_against || 0) + (r.settings?.fpts_against_decimal || 0) / 100).toFixed(2))
    }));
    return { teams, weeklyScores, leagueStatus, playoffWinnerRosterId };
  }

  // ── Compute median wins from weekly matchup arrays ──────
  // For each week, find the median score. Every team that scored above the median
  // gets +1 win credited; every team at or below gets +1 loss.
  // Returns a Map: rosterId (string) → { medWins, medLosses }
  function _computeMedianWins(weeklyScores) {
    const delta = {}; // rosterId → { medWins, medLosses }
    if (!Array.isArray(weeklyScores)) return delta;

    for (const weekMatchups of weeklyScores) {
      if (!Array.isArray(weekMatchups) || !weekMatchups.length) continue;
      // Collect all scores that actually played (matchup_id > 0, points > 0 or explicitly 0)
      const playing = weekMatchups.filter(m => m.matchup_id);
      if (!playing.length) continue;
      const scores = playing.map(m => m.points || 0).sort((a, b) => a - b);
      const mid = Math.floor(scores.length / 2);
      const median = scores.length % 2 === 0
        ? (scores[mid - 1] + scores[mid]) / 2
        : scores[mid];

      playing.forEach(m => {
        const rid = String(m.roster_id);
        if (!delta[rid]) delta[rid] = { medWins: 0, medLosses: 0 };
        if ((m.points || 0) > median) {
          delta[rid].medWins++;
        } else {
          delta[rid].medLosses++;
        }
      });
    }
    return delta;
  }

  async function _fetchMFLStandings(leagueId, year) {
    const hdr = { "User-Agent": "DynastyLockerRoom/1.0" };
    const [rS, rL] = await Promise.all([
      fetch("https://api.myfantasyleague.com/" + year + "/export?TYPE=leagueStandings&L=" + leagueId + "&JSON=1", { headers: hdr }),
      fetch("https://api.myfantasyleague.com/" + year + "/export?TYPE=league&L=" + leagueId + "&JSON=1", { headers: hdr })
    ]);
    if (!rS.ok) return null;
    const sData = await rS.json().catch(() => null);
    const lData = rL.ok ? await rL.json().catch(() => null) : null;
    const nameMap = {};
    const frArr = lData?.league?.franchises?.franchise || [];
    (Array.isArray(frArr) ? frArr : [frArr]).forEach(f => { if (f.id) nameMap[f.id] = f.name || f.id; });
    const stArr = sData?.leagueStandings?.franchise || [];
    const teams = (Array.isArray(stArr) ? stArr : [stArr]).map(s => ({
      teamId:   s.id,
      teamName: nameMap[s.id] || s.id,
      wins:     parseInt(s.h2hw || s.W  || 0),
      losses:   parseInt(s.h2hl || s.L  || 0),
      ties:     parseInt(s.h2ht || s.T  || 0),
      pf:       parseFloat(s.pf  || s.PF || 0),
      pa:       parseFloat(s.pa  || s.PA || 0)
    }));
    return { teams };
  }

  async function _fetchYahooStandings(leagueId, accessToken) {
    if (!accessToken) return null;
    const leagueKey = leagueId.includes(".l.") ? leagueId : leagueId;
    const r = await fetch("https://mfl-proxy.mraladdin23.workers.dev/yahoo/leagueBundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: accessToken, league_key: leagueKey })
    });
    if (!r.ok) return null;
    const bundle = await r.json().catch(() => null);
    if (!bundle?.standings?.length) return null;
    const nameMap = {};
    (bundle.teams || []).forEach(t => { nameMap[String(t.id)] = t.name || t.id; });
    const teams = (bundle.standings || []).map(s => ({
      teamId:   String(s.teamId),
      teamName: nameMap[String(s.teamId)] || ("Team " + s.teamId),
      wins:     s.wins       || 0,
      losses:   s.losses     || 0,
      ties:     s.ties       || 0,
      pf:       s.ptsFor     || 0,
      pa:       s.ptsAgainst || 0
    }));
    return { teams };
  }

  // ── Admin: Roles tab ───────────────────────────────────
  function _renderRolesTab(tid, t, body) {
    const roles = t.roles || {};

    body.innerHTML = `
      <div class="trn-section-card">
        <div class="trn-section-card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>Admin &amp; Staff Roles</span>
          <button class="btn-primary btn-sm" id="trn-add-role-btn">+ Add Staff</button>
        </div>

        <div class="trn-roles-list">
          ${Object.entries(roles).map(([user, r]) => `
            <div class="trn-role-row">
              <div class="trn-role-user">
                <span class="trn-role-avatar">${user.slice(0,2).toUpperCase()}</span>
                <div>
                  <div class="trn-role-name">@${_esc(user)}</div>
                  ${r.scope ? `<div class="trn-role-scope">Scope: ${_esc(r.scope)}</div>` : ""}
                </div>
              </div>
              <div class="trn-role-right">
                <span class="trn-role-badge trn-role-${r.role}">${r.role === "admin" ? "🛡 Admin" : "⚙ Sub-Admin"}</span>
                ${user !== _currentUsername && r.role !== "admin" ? `
                  <button class="btn-ghost btn-sm" data-remove-role="${_esc(user)}">Remove</button>
                ` : ""}
              </div>
            </div>
          `).join("") || `<div class="trn-empty-inline">No staff assigned yet.</div>`}
        </div>

        <div class="trn-section-help">
          <strong>Admin</strong> — full create/edit/delete rights.<br>
          <strong>Sub-Admin</strong> — can manage registrations and standings within their assigned conference/division scope.
        </div>
      </div>
    `;

    document.getElementById("trn-add-role-btn")?.addEventListener("click", () => _openAddRoleModal(tid, t));
    body.querySelectorAll("[data-remove-role]").forEach(btn =>
      btn.addEventListener("click", () => _removeRole(tid, btn.dataset.removeRole))
    );
  }

  function _openAddRoleModal(tid, t) {
    const conferences = [...new Set(Object.values(t.leagues || {}).map(l => l.conference).filter(Boolean))];
    const divisions   = [...new Set(Object.values(t.leagues || {}).map(l => l.division).filter(Boolean))];

    _showModal(`
      <div class="modal-header">
        <h3>Add Staff Member</h3>
        <button class="modal-close" id="trn-modal-close">✕</button>
      </div>
      <div class="modal-body trn-form-body">
        <div class="form-group">
          <label>DLR Username <span class="required">*</span></label>
          <input type="text" id="trn-role-user" placeholder="dlr_username" />
        </div>
        <div class="form-group">
          <label>Role</label>
          <select id="trn-role-type">
            <option value="sub_admin">Sub-Admin</option>
            <option value="admin">Admin (full access)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Scope (Sub-Admin only)</label>
          <input type="text" id="trn-role-scope" placeholder="e.g. NFC East, Division A" maxlength="60" list="trn-scope-list" />
          <datalist id="trn-scope-list">
            ${[...conferences, ...divisions].map(s => `<option value="${_esc(s)}">`).join("")}
          </datalist>
          <span class="field-hint">Leave blank for full tournament access.</span>
        </div>
        <div id="trn-role-error" class="auth-error hidden"></div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="trn-modal-cancel">Cancel</button>
        <button class="btn-primary"   id="trn-modal-confirm">Add Staff</button>
      </div>
    `);

    document.getElementById("trn-modal-cancel")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-close")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-confirm")?.addEventListener("click", async () => {
      const user  = document.getElementById("trn-role-user")?.value.trim().toLowerCase();
      const role  = document.getElementById("trn-role-type")?.value;
      const scope = document.getElementById("trn-role-scope")?.value.trim();
      const errEl = document.getElementById("trn-role-error");

      if (!user) {
        errEl.textContent = "Username is required.";
        errEl.classList.remove("hidden");
        return;
      }

      // Verify user exists
      try {
        const exists = await GMDB.usernameExists(user);
        if (!exists) {
          errEl.textContent = `No DLR account found for "${user}".`;
          errEl.classList.remove("hidden");
          return;
        }

        const roleData = { role, grantedAt: Date.now(), grantedBy: _currentUsername };
        if (scope) roleData.scope = scope;

        await _tRolesRef(tid).child(user).set(roleData);
        showToast(`@${user} added as ${role === "admin" ? "Admin" : "Sub-Admin"} ✓`);
        _closeModal();
        const snap = await _tRef(tid).once("value");
        _tournaments[tid] = snap.val();
        _openTournamentView(tid);
        _activeAdminTab = "roles";
      } catch(err) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    });
  }

  async function _removeRole(tid, username) {
    if (!confirm(`Remove @${username} from this tournament?`)) return;
    try {
      await _tRolesRef(tid).child(username).remove();
      showToast(`@${username} removed ✓`);
      const snap = await _tRef(tid).once("value");
      _tournaments[tid] = snap.val();
      _openTournamentView(tid);
      _activeAdminTab = "roles";
    } catch(err) {
      showToast("Failed to remove staff member", "error");
    }
  }

  // ── Admin: Registration Form Builder ──────────────────
  function _renderRegistrationFormTab(tid, t, body) {
    const form     = t.meta?.registrationForm || {};
    const fields   = form.fields   || STD_FIELDS;
    const optFields = form.optionalFields || [];
    const custom   = form.customQuestions || [];

    body.innerHTML = `
      <div class="trn-section-card">
        <div class="trn-section-card-title">Registration Type</div>
        <div class="trn-reg-type-row">
          <label class="trn-radio-label">
            <input type="radio" name="trn-reg-type" value="open" ${t.meta?.regType !== "invite" ? "checked" : ""} />
            <strong>Open</strong> — anyone with the registration link can apply
          </label>
          <label class="trn-radio-label">
            <input type="radio" name="trn-reg-type" value="invite" ${t.meta?.regType === "invite" ? "checked" : ""} />
            <strong>Invite Only</strong> — admin manually approves all applicants
          </label>
        </div>
      </div>

      <div class="trn-section-card">
        <div class="trn-section-card-title">Standard Fields</div>
        <div class="trn-field-hint">These fields are always collected:</div>
        ${STD_FIELDS.map(f => `
          <div class="trn-field-row trn-field-row--fixed">
            <span class="trn-field-icon">📋</span>
            <span>${STD_FIELD_LABELS[f]}</span>
            <span class="trn-field-required">Required</span>
          </div>
        `).join("")}
      </div>

      <div class="trn-section-card">
        <div class="trn-section-card-title">Platform Fields</div>
        <div class="trn-field-hint">Used for DLR identity matching. Enable the platforms relevant to your tournament.</div>
        ${PLATFORM_FIELDS.map(f => `
          <label class="trn-field-toggle">
            <input type="checkbox" data-opt-field="${f}" ${optFields.includes(f) ? "checked" : ""} />
            ${PLATFORM_FIELD_LABELS[f]}
          </label>
        `).join("")}
      </div>

      <div class="trn-section-card">
        <div class="trn-section-card-title">Extra Fields</div>
        ${OPT_FIELDS.map(f => `
          <label class="trn-field-toggle">
            <input type="checkbox" data-opt-field="${f}" ${optFields.includes(f) ? "checked" : ""} />
            ${OPT_FIELD_LABELS[f]}
          </label>
        `).join("")}
      </div>

      <div class="trn-section-card">
        <div class="trn-section-card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>Custom Questions</span>
          <button class="btn-secondary btn-sm" id="trn-add-question-btn">+ Add Question</button>
        </div>
        <div id="trn-custom-questions">
          ${custom.map((q, i) => _renderCustomQuestionRow(q, i)).join("")}
          ${!custom.length ? `<div class="trn-empty-inline">No custom questions yet.</div>` : ""}
        </div>
      </div>

      <div class="trn-form-actions">
        <button class="btn-primary" id="trn-save-form-btn">Save Registration Form</button>
      </div>
    `;

    document.getElementById("trn-add-question-btn")?.addEventListener("click", () => _addCustomQuestion(tid));
    document.getElementById("trn-save-form-btn")?.addEventListener("click", () => _saveRegistrationForm(tid));

    body.querySelectorAll("[data-del-question]").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.delQuestion);
        const rows = body.querySelectorAll(".trn-custom-question-row");
        if (rows[idx]) rows[idx].remove();
        if (!body.querySelectorAll(".trn-custom-question-row").length) {
          document.getElementById("trn-custom-questions").innerHTML = `<div class="trn-empty-inline">No custom questions yet.</div>`;
        }
      });
    });
  }

  function _renderCustomQuestionRow(q, i) {
    return `
      <div class="trn-custom-question-row" data-qidx="${i}">
        <input type="text" class="trn-q-text" value="${_esc(q.question || "")}" placeholder="Question text" />
        <select class="trn-q-type">
          <option value="text" ${q.type === "text" ? "selected" : ""}>Short text</option>
          <option value="textarea" ${q.type === "textarea" ? "selected" : ""}>Paragraph</option>
          <option value="select" ${q.type === "select" ? "selected" : ""}>Dropdown</option>
        </select>
        <label class="trn-q-required">
          <input type="checkbox" ${q.required ? "checked" : ""} /> Required
        </label>
        <button class="btn-ghost btn-sm" data-del-question="${i}">✕</button>
      </div>`;
  }

  function _addCustomQuestion(tid) {
    const container = document.getElementById("trn-custom-questions");
    if (!container) return;
    const emptyEl = container.querySelector(".trn-empty-inline");
    if (emptyEl) emptyEl.remove();
    const idx = container.querySelectorAll(".trn-custom-question-row").length;
    const row = document.createElement("div");
    row.innerHTML = _renderCustomQuestionRow({ question: "", type: "text", required: false }, idx);
    container.appendChild(row.firstElementChild);
    // Wire new delete btn
    row.querySelector("[data-del-question]")?.addEventListener("click", e => {
      e.currentTarget.closest(".trn-custom-question-row").remove();
    });
  }

  async function _saveRegistrationForm(tid) {
    const regType   = document.querySelector('input[name="trn-reg-type"]:checked')?.value || "open";
    const optFields = [...document.querySelectorAll("[data-opt-field]:checked")].map(c => c.dataset.optField);
    const customRows = [...document.querySelectorAll(".trn-custom-question-row")];
    const customQuestions = customRows.map(row => ({
      question: row.querySelector(".trn-q-text")?.value.trim() || "",
      type:     row.querySelector(".trn-q-type")?.value || "text",
      required: row.querySelector('input[type="checkbox"]')?.checked || false
    })).filter(q => q.question);

    try {
      await _tMetaRef(tid).update({
        regType,
        registrationForm: {
          fields:          STD_FIELDS,
          optionalFields:  optFields,
          customQuestions
        }
      });
      showToast("Registration form saved ✓");
      const snap = await _tRef(tid).once("value");
      _tournaments[tid] = snap.val();
    } catch(err) {
      showToast("Failed to save form", "error");
    }
  }

  // ── Admin: Registrants tab ─────────────────────────────
  function _renderRegistrantsTab(tid, t, body) {
    const regs    = t.registrations || {};
    const regList = Object.entries(regs);
    const pending  = regList.filter(([, r]) => r.status === "pending");
    const approved = regList.filter(([, r]) => r.status === "approved");
    const denied   = regList.filter(([, r]) => r.status === "denied");

    body.innerHTML = `
      <div class="trn-reg-toolbar">
        <span class="trn-reg-count">${regList.length} total · <span class="trn-pending-count">${pending.length} pending</span></span>
        <div style="display:flex;gap:var(--space-2)">
          <button class="btn-secondary btn-sm" id="trn-export-csv-btn">⬇ Export CSV</button>
          <button class="btn-secondary btn-sm" id="trn-import-csv-btn">⬆ Import CSV</button>
          <button class="btn-ghost btn-sm" id="trn-template-reg-btn" title="Download a blank CSV template matching this tournament's registration form">⬇ Template</button>
        </div>
      </div>
      <input type="file" id="trn-csv-import-input" accept=".csv" style="display:none" />

      ${pending.length ? `
        <div class="trn-reg-section-title">⏳ Pending Review (${pending.length})</div>
        ${pending.map(([rid, r]) => _renderRegistrantRow(tid, rid, r, true)).join("")}
      ` : ""}

      ${approved.length ? `
        <div class="trn-reg-section-title">✅ Approved (${approved.length})</div>
        ${approved.map(([rid, r]) => _renderRegistrantRow(tid, rid, r, false)).join("")}
      ` : ""}

      ${denied.length ? `
        <div class="trn-reg-section-title">❌ Denied (${denied.length})</div>
        ${denied.map(([rid, r]) => _renderRegistrantRow(tid, rid, r, false)).join("")}
      ` : ""}

      ${!regList.length ? `
        <div class="trn-empty">No registrations yet.</div>
      ` : ""}
    `;

    document.getElementById("trn-export-csv-btn")?.addEventListener("click", () => _exportRegistrantsCSV(t));
    document.getElementById("trn-import-csv-btn")?.addEventListener("click", () => {
      document.getElementById("trn-csv-import-input")?.click();
    });
    document.getElementById("trn-template-reg-btn")?.addEventListener("click", () => {
      const form    = t.meta?.registrationForm || {};
      const stdCols = ["displayName", "email"];
      const optCols = form.optionalFields || [];
      const customCols = (form.customQuestions || []).map((q, i) => q.question || ("custom_" + i));
      const headers = [...stdCols, ...optCols, ...customCols, "status"];
      const example = headers.map(h => {
        if (h === "displayName")     return "Jane Smith";
        if (h === "email")           return "jane@example.com";
        if (h === "sleeperUsername") return "janesmith";
        if (h === "mflEmail")        return "jane@example.com";
        if (h === "yahooUsername")   return "janesmith";
        if (h === "teamName")        return "Jane's Team";
        if (h === "twitterHandle")   return "@janesmith";
        if (h === "gender")          return "Female";
        if (h === "status")          return "pending";
        return "";
      });
      const csv  = headers.join(",") + "\n" + example.join(",") + "\n";
      const blob = new Blob([csv], { type: "text/csv" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `registrants_template_${(t.meta?.name || "tournament").replace(/\s+/g, "_")}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    });
    document.getElementById("trn-csv-import-input")?.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (file) await _importRegistrantsCSV(tid, file);
    });

    body.querySelectorAll("[data-approve]").forEach(btn =>
      btn.addEventListener("click", () => _setRegistrationStatus(tid, btn.dataset.approve, "approved"))
    );
    body.querySelectorAll("[data-deny]").forEach(btn =>
      btn.addEventListener("click", () => _setRegistrationStatus(tid, btn.dataset.deny, "denied"))
    );
    body.querySelectorAll("[data-view-reg]").forEach(btn =>
      btn.addEventListener("click", () => _openRegistrantDetail(tid, btn.dataset.viewReg, regs[btn.dataset.viewReg]))
    );
  }

  function _renderRegistrantRow(tid, rid, r, showActions) {
    const statusClass = r.status === "approved" ? "trn-reg--approved"
                      : r.status === "denied"   ? "trn-reg--denied"
                      : "trn-reg--pending";
    return `
      <div class="trn-reg-row ${statusClass}">
        <div class="trn-reg-main">
          <div class="trn-reg-name">${_esc(r.displayName || r.teamName || "Unknown")}</div>
          <div class="trn-reg-meta">
            ${r.teamName ? `🏈 ${_esc(r.teamName)} · ` : ""}
            ${r.email    ? `📧 ${_esc(r.email)} · ` : ""}
            ${r.platformUsername ? `👤 ${_esc(r.platformUsername)}` : ""}
          </div>
          <div class="trn-reg-date">${r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : "—"}</div>
        </div>
        <div class="trn-reg-actions">
          <button class="btn-ghost btn-sm" data-view-reg="${_esc(rid)}">View</button>
          ${showActions ? `
            <button class="btn-primary btn-sm" data-approve="${_esc(rid)}">✓ Approve</button>
            <button class="btn-secondary btn-sm" data-deny="${_esc(rid)}">✕ Deny</button>
          ` : `
            <span class="trn-reg-status-label">${r.status}</span>
          `}
        </div>
      </div>`;
  }

  function _openRegistrantDetail(tid, rid, r) {
    const rows = Object.entries(r).filter(([k]) => !["status", "submittedAt", "reviewedAt", "reviewedBy"].includes(k));
    _showModal(`
      <div class="modal-header">
        <h3>Registration: ${_esc(r.displayName || r.teamName || rid)}</h3>
        <button class="modal-close" id="trn-modal-close">✕</button>
      </div>
      <div class="modal-body trn-form-body">
        ${rows.map(([k, v]) => `
          <div class="trn-detail-row">
            <span>${_esc(_camelToLabel(k))}</span>
            <span>${_esc(String(v || "—"))}</span>
          </div>
        `).join("")}
        <div class="trn-detail-row">
          <span>Status</span>
          <span class="trn-reg-status-label">${_esc(r.status || "pending")}</span>
        </div>
        ${r.submittedAt ? `
          <div class="trn-detail-row">
            <span>Submitted</span>
            <span>${new Date(r.submittedAt).toLocaleString()}</span>
          </div>
        ` : ""}
        ${r.inviteLink ? `
          <div class="form-group" style="margin-top:var(--space-4)">
            <label>League Invite Link</label>
            <input type="text" id="trn-invite-link-input" value="${_esc(r.inviteLink || "")}" placeholder="Paste league invite URL here" />
          </div>
        ` : `
          <div class="form-group" style="margin-top:var(--space-4)">
            <label>Send League Invite Link</label>
            <input type="text" id="trn-invite-link-input" placeholder="Paste league invite URL here" />
            <span class="field-hint">The invite link will be saved to the registration record.</span>
          </div>
        `}
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="trn-modal-cancel">Close</button>
        ${r.status === "pending" ? `
          <button class="btn-primary btn-sm" data-approve="${_esc(rid)}">✓ Approve</button>
          <button class="btn-secondary btn-sm" data-deny="${_esc(rid)}">✕ Deny</button>
        ` : ""}
        <button class="btn-primary" id="trn-save-invite-btn">Save Invite Link</button>
        <button class="btn-danger" id="trn-delete-reg-btn" style="margin-left:auto">🗑 Delete</button>
      </div>
    `);

    document.getElementById("trn-modal-cancel")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-close")?.addEventListener("click", _closeModal);
    document.querySelector(`[data-approve="${rid}"]`)?.addEventListener("click", async () => {
      await _setRegistrationStatus(tid, rid, "approved");
      _closeModal();
    });
    document.querySelector(`[data-deny="${rid}"]`)?.addEventListener("click", async () => {
      await _setRegistrationStatus(tid, rid, "denied");
      _closeModal();
    });
    document.getElementById("trn-save-invite-btn")?.addEventListener("click", async () => {
      const link = document.getElementById("trn-invite-link-input")?.value.trim();
      if (!link) return;
      try {
        await _tRegsRef(tid).child(rid).update({ inviteLink: link });
        showToast("Invite link saved ✓");
        _closeModal();
      } catch(err) {
        showToast("Failed to save invite link", "error");
      }
    });

    document.getElementById("trn-delete-reg-btn")?.addEventListener("click", async () => {
      const name = r.displayName || r.teamName || rid;
      if (!confirm(`Delete registration for "${name}"? This cannot be undone.`)) return;
      try {
        await _tRegsRef(tid).child(rid).remove();
        showToast("Registration deleted ✓");
        _closeModal();
        const snap = await _tRef(tid).once("value");
        _tournaments[tid] = snap.val();
        _writePublicSummary(tid, _tournaments[tid]);
        const body = document.getElementById("trn-tab-body");
        if (body) _renderRegistrantsTab(tid, _tournaments[tid], body);
      } catch(err) {
        showToast("Failed to delete registration", "error");
      }
    });
  }

  async function _setRegistrationStatus(tid, rid, status) {
    try {
      await _tRegsRef(tid).child(rid).update({
        status,
        reviewedAt: Date.now(),
        reviewedBy: _currentUsername
      });
      showToast(`Registration ${status} ✓`);
      const snap = await _tRef(tid).once("value");
      _tournaments[tid] = snap.val();
      // Re-render registrants tab in place
      const body = document.getElementById("trn-tab-body");
      if (body) _renderRegistrantsTab(tid, _tournaments[tid], body);
    } catch(err) {
      showToast("Failed to update status", "error");
    }
  }

  // ── CSV Export ─────────────────────────────────────────
  function _exportRegistrantsCSV(t) {
    const regs = Object.entries(t.registrations || {});
    if (!regs.length) { showToast("No registrants to export", "info"); return; }

    // Build header from all keys
    const allKeys = new Set();
    regs.forEach(([, r]) => Object.keys(r).forEach(k => allKeys.add(k)));
    const headers = ["rid", ...allKeys];

    const rows = regs.map(([rid, r]) =>
      headers.map(h => {
        const val = h === "rid" ? rid : (r[h] ?? "");
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      }).join(",")
    );

    const csv  = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `registrants_${t.meta?.name?.replace(/\s+/g, "_") || "tournament"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("CSV exported ✓");
  }

  // ── CSV Import ─────────────────────────────────────────
  async function _importRegistrantsCSV(tid, file) {
    try {
      const text = await file.text();
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) { showToast("CSV has no data rows", "error"); return; }

      // Parse header
      const headers = _parseCSVRow(lines[0]);
      const updates  = {};
      let count = 0;

      for (let i = 1; i < lines.length; i++) {
        const vals = _parseCSVRow(lines[i]);
        if (vals.length < 2) continue;
        const entry = {};
        headers.forEach((h, idx) => { if (h && vals[idx] !== undefined) entry[h] = vals[idx]; });

        const rid = entry.rid || _genId();
        delete entry.rid;
        if (!entry.status) entry.status = "pending";
        if (!entry.submittedAt) entry.submittedAt = Date.now();
        entry.importedAt = Date.now();

        updates[rid] = entry;
        count++;
      }

      if (!count) { showToast("No valid rows found in CSV", "error"); return; }

      await _tRegsRef(tid).update(updates);
      showToast(`${count} registration${count !== 1 ? "s" : ""} imported ✓`);
      const snap = await _tRef(tid).once("value");
      _tournaments[tid] = snap.val();
      _openTournamentView(tid);
      _activeAdminTab = "registrations";
    } catch(err) {
      showToast("Import failed: " + err.message, "error");
    }
  }

  function _parseCSVRow(line) {
    const result = [];
    let current  = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  // ── Edit tournament meta modal ─────────────────────────
  function _openEditMetaModal(tid, t) {
    const meta = t.meta || {};
    _showModal(`
      <div class="modal-header">
        <h3>Edit Tournament</h3>
        <button class="modal-close" id="trn-modal-close">✕</button>
      </div>
      <div class="modal-body trn-form-body">
        <div class="form-group">
          <label>Tournament Name</label>
          <input type="text" id="trn-edit-name" value="${_esc(meta.name || "")}" maxlength="80" />
        </div>
        <div class="form-group">
          <label>Tagline</label>
          <input type="text" id="trn-edit-tagline" value="${_esc(meta.tagline || "")}" maxlength="120" />
        </div>
        <div class="trn-danger-zone">
          <div class="trn-section-card-title" style="color:var(--color-red)">Danger Zone</div>
          <button class="btn-ghost btn-sm trn-danger-btn" id="trn-delete-trn-btn">🗑 Delete Tournament</button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="trn-modal-cancel">Cancel</button>
        <button class="btn-primary"   id="trn-modal-confirm">Save Changes</button>
      </div>
    `);

    document.getElementById("trn-modal-cancel")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-close")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-confirm")?.addEventListener("click", async () => {
      const updates = {
        name:    document.getElementById("trn-edit-name")?.value.trim()    || meta.name,
        tagline: document.getElementById("trn-edit-tagline")?.value.trim() || ""
      };
      try {
        await _tMetaRef(tid).update(updates);
        showToast("Tournament updated ✓");
        _closeModal();
        const snap = await _tRef(tid).once("value");
        _tournaments[tid] = snap.val();
        _writePublicSummary(tid, _tournaments[tid]);
        _openTournamentView(tid);
      } catch(err) {
        showToast("Failed to save", "error");
      }
    });
    document.getElementById("trn-delete-trn-btn")?.addEventListener("click", async () => {
      if (!confirm(`Delete "${meta.name}"? This cannot be undone.`)) return;
      try {
        await _tRef(tid).remove();
        _closeModal();
        showToast("Tournament deleted");
        delete _tournaments[tid];
        _activeTournamentId = null;
        _renderView();
      } catch(err) {
        showToast("Delete failed", "error");
      }
    });
  }

  // ═══════════════════════════════════════════════════════
  //  ANALYTICS — Draft, Matchups, Rosters
  //  Visible to all authenticated tournament viewers.
  //  Firebase cache: gmd/tournaments/{tid}/analyticsCache/
  // ═══════════════════════════════════════════════════════

  const POS_COLOR = { QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff", TE:"#ffc94d", K:"#9ca3af", DEF:"#9ca3af", OL:"#9ca3af" };

  // Returns a Set of sanitized keys that match the current user in the participant map.
  // Used to highlight "you" across analytics tabs.
  function _findMyKeys(t) {
    const _sk  = (s) => String(s).trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_");
    const parts = Object.values(t.participants || {}).filter(p =>
      p.dlrLinked && p.dlrUsername === _currentUsername
    );
    if (!parts.length) return new Set();
    const keys = new Set();
    parts.forEach(p => {
      [p.sleeperUsername, p.displayName, p.teamName].filter(Boolean).forEach(v => keys.add(_sk(v)));
    });
    return keys;
  }

  function _isMyTeam(name, myKeys) {
    if (!myKeys.size || !name) return false;
    const _sk = (s) => String(s).trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_");
    return myKeys.has(_sk(name));
  }
  const PREFERRED_POS_ORDER = ["QB","RB","WR","TE","FLEX","K","DEF","DB","LB","DL","OL"];

  // ── Normalize picks from any platform into a common shape ──
  // { overall, round, pick, teamId, teamName, playerId, name, position, cost }
  function _normalizePicks(rawPicks, platform, teamMap) {
    if (!rawPicks || !rawPicks.length) return [];
    const tName = (id) => teamMap[String(id)] || String(id);

    if (platform === "sleeper") {
      return rawPicks.map(p => {
        const name = p.metadata
          ? `${p.metadata.first_name || ""} ${p.metadata.last_name || ""}`.trim()
          : (p.player_id || "Unknown");
        const pos  = (p.metadata?.position || "?").toUpperCase();
        // Resolve via DLRPlayers if available
        let resolvedName = name, resolvedPos = pos;
        if (typeof DLRPlayers !== "undefined") {
          const dp = DLRPlayers.get(p.player_id);
          if (dp?.first_name) {
            resolvedName = `${dp.first_name} ${dp.last_name}`.trim();
            resolvedPos  = (dp.position || pos).toUpperCase();
          }
        }
        const teams = p.metadata?.teams || 12;
        return {
          overall:  (p.round - 1) * (teams) + (p.draft_slot || 1),
          round:    p.round,
          pick:     p.draft_slot || 1,
          teamId:   String(p.roster_id || ""),
          teamName: tName(p.roster_id),
          playerId: p.player_id || "",
          name:     resolvedName || "Unknown",
          position: resolvedPos,
          cost:     null
        };
      }).filter(p => p.teamId && p.teamId !== "undefined");
    }

    if (platform === "mfl") {
      return rawPicks.map((p, i) => ({
        overall:  parseInt(p.overall || i + 1),
        round:    parseInt(p.round   || 1),
        pick:     parseInt(p.pick    || 1),
        teamId:   String(p.teamId   || ""),
        teamName: tName(p.teamId),
        playerId: String(p.playerId || ""),
        name:     p.name     || "Unknown",
        position: (p.position || "?").toUpperCase(),
        cost:     p.cost != null ? parseInt(p.cost) : null
      })).filter(p => p.teamId);
    }

    if (platform === "yahoo") {
      return rawPicks.map((p, i) => {
        let name = p.name || "", pos = (p.position || "?").toUpperCase();
        if (typeof DLRPlayers !== "undefined" && p.playerId) {
          const map = DLRPlayers.getByYahooId(String(p.playerId));
          const dp  = map?.sleeper_id ? DLRPlayers.get(map.sleeper_id) : null;
          if (dp?.first_name) {
            name = `${dp.first_name} ${dp.last_name}`.trim();
            pos  = (dp.position || pos).toUpperCase();
          } else if (map?.name) {
            name = map.name;
            pos  = (map.position || pos).toUpperCase();
          }
        }
        return {
          overall:  parseInt(p.pick   || i + 1),
          round:    parseInt(p.round  || 1),
          pick:     parseInt(p.pick   || 1),
          teamId:   String(p.teamId  || ""),
          teamName: tName(p.teamId),
          playerId: String(p.playerId || ""),
          name:     name || "Unknown",
          position: pos,
          cost:     p.cost != null ? parseInt(p.cost) : null
        };
      }).filter(p => p.teamId);
    }
    return [];
  }

  // ── Compute tournament-wide ADP from all picks ────────────────────────────
  // Returns Map: playerId → { name, position, picks[], adp, adpRound }
  // Returns array: { playerId, name, position, count, adp, min, max, p25, p75, picks[] }
  function _computeADP(allPicks) {
    const byPlayer = {};
    allPicks.forEach(p => {
      if (!p.playerId) return;
      if (!byPlayer[p.playerId]) byPlayer[p.playerId] = { name: p.name, position: p.position, overalls: [] };
      byPlayer[p.playerId].overalls.push(p.overall);
      if (p.name && p.name !== "Unknown") byPlayer[p.playerId].name = p.name;
    });
    const _pct = (arr, p) => {
      if (arr.length === 1) return arr[0];
      const idx = p * (arr.length - 1);
      const lo  = Math.floor(idx), hi = Math.ceil(idx);
      return +(arr[lo] + (arr[hi] - arr[lo]) * (idx - lo)).toFixed(1);
    };
    return Object.entries(byPlayer).map(([pid, d]) => {
      const sorted = [...d.overalls].sort((a, b) => a - b);
      const adp    = sorted.reduce((s, v) => s + v, 0) / sorted.length;
      return {
        playerId: pid, name: d.name, position: d.position,
        count: sorted.length, adp,
        min: sorted[0], max: sorted[sorted.length - 1],
        p25: _pct(sorted, 0.25), p75: _pct(sorted, 0.75),
        picks: sorted
      };
    }).sort((a, b) => a.adp - b.adp);
  }

  // ── Build participant→teamId mapping from standingsCache ─────────────────
  // Returns { displayName: participantDisplayName } keyed by sanitized Sleeper username / teamName
  function _buildParticipantTeamMap(t) {
    const _sk = (s) => String(s).trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_");
    const participants = t.participants || {};
    const byKey = {}; // sanitizedKey → { displayName, twitterHandle }
    Object.values(participants).forEach(p => {
      const keys = [p.sleeperUsername, p.displayName, p.teamName]
        .filter(Boolean).map(_sk).filter(Boolean);
      keys.forEach(k => { byKey[k] = { displayName: p.displayName || p.teamName || k, twitterHandle: p.twitterHandle || "" }; });
    });
    return byKey;
  }

  // ── ANALYTICS: Draft tab ───────────────────────────────────────────────────
  let _draftCache     = null;  // { picks, adp, byLeague, fetchedAt, tid }
  let _draftLeague    = "all"; // current league filter
  let _draftView      = "adp"; // "adp" | "board" | "card"
  let _draftCardTeam  = null;
  let _draftPosFilter = "all"; // position filter for ADP view
  let _draftSearch    = "";    // team search for board/card
  let _draftListPage  = 1;     // pagination for board list view
  let _draftBoardMode = "grid"; // "grid" | "list" for board view

  async function _renderAnalyticsDraft(tid, t, body) {
    await DLRPlayers.load().catch(() => {});

    body.innerHTML = `<div class="trn-az-loading"><div class="spinner"></div> Loading draft data…</div>`;

    // Use cached data if still fresh for this tournament
    if (_draftCache && _draftCache.tid === tid && (Date.now() - _draftCache.fetchedAt) < 300000) {
      _renderDraftView(tid, t, body, _draftCache);
      return;
    }

    try {
      // Check Firebase cache first
      const snap = await _tAnalyticsRef(tid).child("drafts").once("value");
      const cached = snap.val() || {};

      const batches   = t.leagues || {};
      const isBatch   = (v) => v && typeof v === "object" && v.leagues !== undefined;
      const toFetch   = [];

      for (const [, batch] of Object.entries(batches)) {
        if (!isBatch(batch)) continue;
        for (const [leagueId, l] of Object.entries(batch.leagues || {})) {
          const ck       = `${batch.year}_${leagueId}`;
          const existing = cached[ck];
          // Use cache if < 24h old and has picks
          if (existing?.picks?.length && (Date.now() - (existing.fetchedAt || 0)) < 86400000) continue;
          toFetch.push({ leagueId, platform: batch.platform, year: batch.year, leagueName: l.name || leagueId, cacheKey: ck });
        }
      }

      const yahooToken = localStorage.getItem("dlr_yahoo_access_token");
      const mflCreds   = _getMFLCreds();

      // Fetch missing leagues in batches of 3
      const results = {};
      for (let i = 0; i < toFetch.length; i += 3) {
        const batch = toFetch.slice(i, i + 3);
        await Promise.allSettled(batch.map(async l => {
          try {
            const r = await fetch("https://mfl-proxy.mraladdin23.workers.dev/tournament/draft", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                leagueId:   l.leagueId,
                platform:   l.platform,
                year:       l.year,
                yahooToken: l.platform === "yahoo" ? yahooToken : undefined,
                mflCookie:  l.platform === "mfl"   ? mflCreds?.cookie : undefined
              })
            });
            if (!r.ok) return;
            const data = await r.json();
            if (data.picks) {
              results[l.cacheKey] = {
                ...l,
                picks:             data.picks,
                slot_to_roster_id: data.slot_to_roster_id || null,
                draft_type:        data.draft_type        || null,
                fetchedAt:         Date.now()
              };
            }
          } catch(e) { console.warn("[Draft] fetch error", l.leagueId, e.message); }
        }));
        if (i + 3 < toFetch.length) await new Promise(r => setTimeout(r, 200));
      }

      // Merge with cached, persist new to Firebase
      const allCached = { ...cached, ...results };
      if (Object.keys(results).length) {
        await _tAnalyticsRef(tid).child("drafts").update(results).catch(() => {});
      }

      // Build team name map from standingsCache — keyed as "{leagueId}:{teamId}" to
      // prevent roster_id collisions across leagues (each league reuses IDs 1–12).
      const standings = t.standingsCache || {};
      const teamMap   = {};
      Object.values(standings).forEach(lc => {
        const lcLeagueId = String(lc.leagueId || lc.league_id || "");
        (lc.teams || []).forEach(tm => {
          const qualKey = lcLeagueId ? `${lcLeagueId}:${tm.teamId}` : String(tm.teamId);
          teamMap[qualKey] = tm.teamName;
          // Also store bare key as fallback for legacy data without leagueId
          if (lcLeagueId) teamMap[String(tm.teamId)] = teamMap[String(tm.teamId)] || tm.teamName;
        });
      });

      // Worker picks are already in normalized shape: { overall, round, pick, teamId, playerId, name, position }
      // Just resolve teamNames from standingsCache and participant map, and
      // improve player names via DLRPlayers where possible.
      const pMap = _buildParticipantTeamMap(t);
      const _sk  = (s) => String(s).trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_");
      const byLeague = {};
      let   allPicks = [];

      const activeYear = _tournamentYear || new Date().getFullYear();
      for (const [ck, lc] of Object.entries(allCached)) {
        if (!lc.picks?.length) continue;
        // Only include picks for the currently selected year
        if (lc.year && parseInt(lc.year) !== parseInt(activeYear)) continue;
        const platform   = lc.platform || "sleeper";
        // leagueId embedded in cacheKey is "{year}_{leagueId}" — extract it
        const lcLeagueId = String(lc.leagueId || ck.replace(/^\d+_/, "") || "");

        const normalized = lc.picks.map(p => {
          // Resolve teamName: qualified key first, then bare key, then raw pick name
          const qualKey = lcLeagueId ? `${lcLeagueId}:${p.teamId}` : String(p.teamId);
          let teamName = teamMap[qualKey] || teamMap[String(p.teamId)] || p.teamName || String(p.teamId);
          const key = _sk(teamName);
          if (pMap[key]) teamName = pMap[key].displayName;

          // Resolve player name/pos via DLRPlayers for Sleeper (has playerId)
          let name = p.name || "Unknown";
          let pos  = (p.position || "?").toUpperCase();
          if (platform === "sleeper" && p.playerId && typeof DLRPlayers !== "undefined") {
            const dp = DLRPlayers.get(p.playerId);
            if (dp?.first_name) {
              name = `${dp.first_name} ${dp.last_name}`.trim();
              pos  = (dp.position || pos).toUpperCase();
            }
          } else if (platform === "yahoo" && p.playerId && typeof DLRPlayers !== "undefined") {
            const map = DLRPlayers.getByYahooId(String(p.playerId));
            const dp  = map?.sleeper_id ? DLRPlayers.get(map.sleeper_id) : null;
            if (dp?.first_name) {
              name = `${dp.first_name} ${dp.last_name}`.trim();
              pos  = (dp.position || pos).toUpperCase();
            } else if (map?.name) {
              name = map.name;
              pos  = (map.position || pos).toUpperCase();
            }
          }

          // Resolve NFL team: prefer DLRPlayers lookup, fall back to raw pick field
          let nflTeam = p.nflTeam || "FA";
          if (platform === "sleeper" && p.playerId && typeof DLRPlayers !== "undefined") {
            const dp2 = DLRPlayers.get(p.playerId);
            if (dp2?.team) nflTeam = dp2.team;
          }

          // Use qualified teamId "{leagueId}:{bareId}" so board columns don't collide
          // across leagues. Store the bare original for display purposes if needed.
          const bareTeamId  = String(p.teamId || "");
          const qualTeamId  = lcLeagueId && bareTeamId ? `${lcLeagueId}:${bareTeamId}` : bareTeamId;
          return {
            overall:  parseInt(p.overall || 1),
            round:    parseInt(p.round   || 1),
            pick:     parseInt(p.pick    || 1),
            teamId:   qualTeamId,
            teamName,
            playerId: String(p.playerId || ""),
            name,
            position: pos,
            nflTeam,
            cost:     p.cost != null ? parseInt(p.cost) : null,
            leagueId: lcLeagueId   // carry for downstream use
          };
        }).filter(p => p.teamId && p.teamId !== "undefined" && p.teamId !== "null");

        console.log(`[Draft] ${ck}: ${normalized.length} picks, platform=${platform}, sample:`, normalized[0]);
        byLeague[ck] = {
          ...lc,
          normalizedPicks:   normalized,
          slot_to_roster_id: lc.slot_to_roster_id || null,
          draft_type:        lc.draft_type        || null
        };
        allPicks = allPicks.concat(normalized);
      }

      if (!allPicks.length) {
        body.innerHTML = `
          <div class="trn-empty">
            <div class="trn-empty-icon">📋</div>
            <div class="trn-empty-title">No draft data yet</div>
            <div class="trn-empty-sub">Draft data will appear once leagues have completed their startup drafts. Click Refresh to try again.</div>
            <button class="btn-secondary btn-sm" id="trn-draft-empty-refresh" style="margin-top:var(--space-4)">↺ Refresh</button>
          </div>`;
        document.getElementById("trn-draft-empty-refresh")?.addEventListener("click", () => {
          _draftCache = null;
          _renderAnalyticsDraft(tid, t, body);
        });
        return;
      }
      const adp = _computeADP(allPicks);
      _draftCache = { picks: allPicks, adp, byLeague, fetchedAt: Date.now(), tid, _t: t };
      _renderDraftView(tid, t, body, _draftCache);
      // Sync ADP to public node in the background — non-blocking
      _writePublicADP(tid).catch(() => {});
    } catch(e) {
      body.innerHTML = `<div class="trn-empty">Failed to load draft data: ${_esc(e.message)}</div>`;
    }
  }

  function _getMFLCreds() {
    // Try to get stored MFL credentials from localStorage (set during profile MFL login)
    try {
      const cookie = localStorage.getItem("dlr_mfl_cookie");
      return cookie ? { cookie } : null;
    } catch(e) { return null; }
  }

  function _renderDraftView(tid, t, body, cache) {
    const { picks, adp, byLeague } = cache;
    const leagues = Object.values(byLeague).filter(l => l.normalizedPicks?.length);

    // Build unique team list from all picks, with league name for disambiguation
    const teamSet = {};
    const teamLeagueMap = {}; // teamId → leagueName
    picks.forEach(p => {
      if (p.teamId) {
        teamSet[p.teamId] = p.teamName || p.teamId;
        if (!teamLeagueMap[p.teamId]) {
          // Find which league this teamId belongs to
          for (const l of Object.values(byLeague)) {
            if (l.normalizedPicks?.some(np => np.teamId === p.teamId)) {
              teamLeagueMap[p.teamId] = l.leagueName || "";
              break;
            }
          }
        }
      }
    });
    const teams = Object.entries(teamSet).sort((a, b) => a[1].localeCompare(b[1]));
    const teamLabel = ([id, name]) => teamLeagueMap[id] ? `${name} — ${teamLeagueMap[id]}` : name;

    const leagueOpts = leagues.map(l => `<option value="${_esc(l.cacheKey)}">${_esc(l.leagueName)}</option>`).join("");

    // Auto-select current user's team for card view
    if (_draftView === "card" && !_draftCardTeam) {
      const myKeys = _findMyKeys(t);
      if (myKeys.size) {
        const myTeam = teams.find(([, name]) => _isMyTeam(name, myKeys));
        if (myTeam) _draftCardTeam = myTeam[0];
      }
    }

    const selStyle = "font-size:.82rem;padding:3px 8px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text)";
    const POS_LIST = ["QB","RB","WR","TE","K","DEF"];

    body.innerHTML = `
      <div class="trn-az-toolbar">
        <div class="trn-az-view-pills">
          <button class="trn-az-pill ${_draftView === "adp"   ? "active" : ""}" data-view="adp">📊 ADP</button>
          <button class="trn-az-pill ${_draftView === "board" ? "active" : ""}" data-view="board">📋 Board</button>
          <button class="trn-az-pill ${_draftView === "card"  ? "active" : ""}" data-view="card">🃏 Card</button>
        </div>
        <div style="display:flex;gap:var(--space-2);align-items:center;flex-wrap:wrap">
          ${_draftView === "adp" ? `
            <select id="trn-draft-pos-filter" style="${selStyle}">
              <option value="all" ${_draftPosFilter === "all" ? "selected" : ""}>All Positions</option>
              ${POS_LIST.map(p => `<option value="${p}" ${_draftPosFilter === p ? "selected" : ""}>${p}</option>`).join("")}
            </select>` : ""}
          ${_draftView === "board" ? `
            <select id="trn-draft-league-sel" style="${selStyle}">
              ${leagueOpts}
            </select>
            <div class="draft-layout-toggle">
              <button class="draft-toggle-btn ${_draftBoardMode === "grid" ? "draft-toggle-btn--active" : ""}" id="trn-board-grid-btn" title="Grid view">⊞</button>
              <button class="draft-toggle-btn ${_draftBoardMode === "list" ? "draft-toggle-btn--active" : ""}" id="trn-board-list-btn" title="List view">☰</button>
            </div>` : ""}
          ${_draftView === "card" ? `
            <input type="text" id="trn-draft-team-search" placeholder="Search team…"
              value="${_esc(_draftSearch)}"
              style="${selStyle};min-width:120px" />
            <select id="trn-draft-card-team" style="${selStyle}">
              <option value="">— Select team —</option>
              ${teams.map(([id, name]) => `<option value="${_esc(id)}" ${_draftCardTeam === id ? "selected" : ""}>${_esc(teamLabel([id, name]))}</option>`).join("")}
            </select>` : ""}
          <button class="btn-secondary btn-sm" id="trn-draft-refresh-btn">↺ Refresh</button>
        </div>
      </div>
      <div id="trn-draft-content"></div>
    `;

    body.querySelectorAll(".trn-az-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        _draftView = btn.dataset.view;
        _draftSearch = "";
        _draftListPage = 1;
        // For board view: auto-select first league if none selected or "all" still set
        if (_draftView === "board" && (_draftLeague === "all" || !byLeague[_draftLeague])) {
          _draftLeague = leagues[0]?.cacheKey || _draftLeague;
        }
        _renderDraftView(tid, t, body, cache);
      });
    });
    document.getElementById("trn-board-grid-btn")?.addEventListener("click", () => {
      _draftBoardMode = "grid";
      _renderDraftContent(document.getElementById("trn-draft-content"), cache, t);
    });
    document.getElementById("trn-board-list-btn")?.addEventListener("click", () => {
      _draftBoardMode = "list";
      _draftListPage = 1;
      _renderDraftContent(document.getElementById("trn-draft-content"), cache, t);
    });
    document.getElementById("trn-draft-refresh-btn")?.addEventListener("click", () => {
      _draftCache = null;
      _draftPosFilter = "all";
      _draftSearch = "";
      _renderAnalyticsDraft(tid, t, body);
    });
    document.getElementById("trn-draft-league-sel")?.addEventListener("change", function() {
      _draftLeague = this.value;
      _draftListPage = 1;
      _renderDraftContent(document.getElementById("trn-draft-content"), cache, t);
    });
    document.getElementById("trn-draft-pos-filter")?.addEventListener("change", function() {
      _draftPosFilter = this.value;
      _draftListPage = 1;
      _renderDraftContent(document.getElementById("trn-draft-content"), cache, t);
    });
    // Team search: filter the card-team select options live
    document.getElementById("trn-draft-team-search")?.addEventListener("input", function() {
      _draftSearch = this.value.toLowerCase();
      const sel = document.getElementById("trn-draft-card-team");
      if (!sel) return;
      // Rebuild options filtered by search
      sel.innerHTML = `<option value="">— Select team —</option>` +
        teams.filter(([id, name]) => !_draftSearch || name.toLowerCase().includes(_draftSearch) || (teamLeagueMap[id] || "").toLowerCase().includes(_draftSearch))
          .map(([id, name]) => `<option value="${_esc(id)}" ${_draftCardTeam === id ? "selected" : ""}>${_esc(teamLabel([id, name]))}</option>`).join("");
    });
    document.getElementById("trn-draft-card-team")?.addEventListener("change", function() {
      _draftCardTeam = this.value || null;
      _renderDraftContent(document.getElementById("trn-draft-content"), cache, t);
    });

    _renderDraftContent(document.getElementById("trn-draft-content"), cache, t);
  }

  function _renderDraftContent(el, cache, t) {
    if (!el) return;
    const { picks, adp, byLeague } = cache;

    if (_draftView === "adp") {
      _renderDraftADP(el, adp, t);
    } else if (_draftView === "board") {
      // Always use a specific leagueEntry — "all" falls back to the first available
      const leagueEntry = byLeague[_draftLeague]
        || Object.values(byLeague).find(l => l.normalizedPicks?.length)
        || null;
      const filtered    = leagueEntry ? (leagueEntry.normalizedPicks || []) : picks;
      _renderDraftBoard(el, filtered, leagueEntry);
    } else if (_draftView === "card") {
      _renderDraftCard(el, picks);
    }
  }

  function _renderDraftADP(el, adp, t) {
    if (!adp.length) { el.innerHTML = `<div class="trn-empty">No draft data available yet.</div>`; return; }

    const filtered = (_draftPosFilter && _draftPosFilter !== "all")
      ? adp.filter(p => p.position === _draftPosFilter)
      : adp;

    const totalLeagues = Object.keys(_draftCache?.byLeague || {}).length;

    // Responsive column spec:
    // Mobile (≤640px): 5 cols — #, Player, ADP, Min, Max
    // Desktop:         7 cols — #, Player, Dft, ADP, Min, Range, Max
    const isMobile = window.innerWidth <= 640;
    const COL = isMobile
      ? "28px 1fr 44px 34px 34px"
      : "32px 1fr 36px 52px 40px 40px 76px";
    const header = isMobile ? `
      <div class="draft-auction-header" style="grid-template-columns:${COL};font-size:.7rem">
        <span>#</span><span>Player</span>
        <span style="text-align:right">ADP</span>
        <span style="text-align:right">Min</span>
        <span style="text-align:right">Max</span>
      </div>` : `
      <div class="draft-auction-header" style="grid-template-columns:${COL};font-size:.7rem">
        <span>#</span><span>Player</span>
        <span style="text-align:center">Dft</span>
        <span style="text-align:center">ADP</span>
        <span style="text-align:center">Min</span>
        <span style="text-align:center">Max</span>
        <span style="text-align:center">25-75%</span>
      </div>`;

    // Paginate at 25 rows — declared before rows.map() so it's in scope for rank calc
    const PAGE_SIZE  = 25;

    const rows = filtered.map((p, i) => {
      const col      = POS_COLOR[p.position] || "#9ca3af";
      const clickAttr = p.playerId
        ? `onclick="DLRPlayerCard.show('${_esc(p.playerId)}','${_esc(p.name)}')" style="cursor:pointer"`
        : "";
      const rawPick  = _draftCache?.picks?.find(pk => pk.playerId === p.playerId);
      const nfl      = rawPick?.nflTeam || "FA";
      const mn       = p.min  != null ? p.min  : "—";
      const mx       = p.max  != null ? p.max  : "—";
      const rangeStr = (p.p25 != null && p.p75 != null) ? `${Math.round(p.p25)}–${Math.round(p.p75)}` : "—";
      const statCols = isMobile
        ? `<span style="text-align:right;font-size:.8rem;font-variant-numeric:tabular-nums">${p.adp.toFixed(1)}</span>
           <span class="dim" style="text-align:right;font-size:.76rem;font-variant-numeric:tabular-nums">${mn}</span>
           <span class="dim" style="text-align:right;font-size:.76rem;font-variant-numeric:tabular-nums">${mx}</span>`
        : `<span style="text-align:center;font-size:.8rem;font-variant-numeric:tabular-nums">${p.count}</span>
           <span style="text-align:center;font-size:.8rem;font-variant-numeric:tabular-nums">${p.adp.toFixed(1)}</span>
           <span style="text-align:center;font-size:.8rem;font-variant-numeric:tabular-nums">${mn}</span>           	   	   <span style="text-align:center;font-size:.8rem;font-variant-numeric:tabular-nums">${mx}</span>
           <span style="text-align:center;font-size:.8rem;font-variant-numeric:tabular-nums">${rangeStr}</span>`;
      return `
        <div class="draft-auction-row" style="grid-template-columns:${COL}" ${clickAttr}>
          <span class="draft-auction-rank dim" style="font-size:.75rem">${(_draftListPage - 1) * PAGE_SIZE + i + 1}</span>
          <div>
            <div style="display:flex;align-items:center;gap:4px">
              <span class="draft-pos-badge" style="background:${col}22;color:${col};border-color:${col}55;flex-shrink:0">${_esc(p.position || "?")}</span>
              <span class="draft-auction-name">${_esc(p.name || "Unknown")}</span>              
	      <span class="draft-auction-team" style="font-size:.7;opacity:.75">${_esc(nfl)}</span>
            </div>
          </div>
          ${statCols}
        </div>`;
    });
    const totalPages = Math.ceil(rows.length / PAGE_SIZE);
    const page       = Math.max(1, Math.min(_draftListPage, totalPages));
    const pageRows   = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const pagination = totalPages > 1 ? `
      <div class="draft-pagination">
        <button class="draft-toggle-btn" id="trn-adp-prev" ${page <= 1 ? "disabled" : ""}>‹ Prev</button>
        <span class="dim" style="font-size:.85rem">Page ${page} of ${totalPages}</span>
        <button class="draft-toggle-btn" id="trn-adp-next" ${page >= totalPages ? "disabled" : ""}>Next ›</button>
      </div>` : "";

    el.innerHTML = `
      <div class="trn-az-meta">${adp.length} players drafted · ${filtered.length} shown · ${totalLeagues} leagues</div>
      <div class="draft-auction-list trn-adp-table">
        ${header}
        ${pageRows.join("")}
      </div>
      ${pagination}`;

    el.querySelector("#trn-adp-prev")?.addEventListener("click", () => {
      _draftListPage = Math.max(1, _draftListPage - 1);
      _renderDraftADP(el, adp, t);
    });
    el.querySelector("#trn-adp-next")?.addEventListener("click", () => {
      _draftListPage = Math.min(totalPages, _draftListPage + 1);
      _renderDraftADP(el, adp, t);
    });
  }

  // _renderDraftBoard: renders the draft board in grid or list mode.
  // leagueEntry is the byLeague cache entry for a single league (has slot_to_roster_id,
  // draft_type, normalizedPicks). leagueEntry is always a specific league now.
  // Falls back to heuristic snake detection when slot_to_roster_id is unavailable.
  function _renderDraftBoard(el, picks, leagueEntry) {
    if (!picks.length) { el.innerHTML = `<div class="trn-empty">No picks available for this selection.</div>`; return; }

    const leagueName = leagueEntry?.leagueName || "Draft Board";
    const rounds     = Math.max(...picks.map(p => p.round), 1);

    // ── Column ordering ──────────────────────────────────────────────────────
    // Prefer slot_to_roster_id from the cache entry (passed through from worker for
    // Sleeper leagues). Maps slot number → bare rosterId. Our picks use qualified
    // teamIds "{leagueId}:{rosterId}", so we need to qualify when matching.
    const lcLeagueId       = leagueEntry?.leagueId || "";
    const slotToRosterId   = leagueEntry?.slot_to_roster_id || null;   // {slot: bareRosterId}
    const draftType        = leagueEntry?.draft_type || null;

    // Build teamId→picks-by-round lookup
    const byTeamRound = {};
    picks.forEach(p => {
      if (!byTeamRound[p.teamId]) byTeamRound[p.teamId] = {};
      const existing = byTeamRound[p.teamId][p.round];
      if (!existing || p.overall < existing.overall) byTeamRound[p.teamId][p.round] = p;
    });

    let slotOrder; // ordered array of teamIds for columns
    if (slotToRosterId && Object.keys(slotToRosterId).length) {
      // Use slot_to_roster_id for authoritative column order (same as draft.js)
      slotOrder = Object.entries(slotToRosterId)
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .map(([, bareId]) => {
          const qual = lcLeagueId ? `${lcLeagueId}:${bareId}` : String(bareId);
          // Fall back to bare id if qualified key not found in picks
          return byTeamRound[qual] ? qual : (byTeamRound[String(bareId)] ? String(bareId) : qual);
        });
      // Append any teamIds in picks not covered by slotToRosterId
      Object.keys(byTeamRound).forEach(tid => { if (!slotOrder.includes(tid)) slotOrder.push(tid); });
    } else {
      // Fallback: derive order from round-1 picks sorted by overall
      const r1picks = picks.filter(p => p.round === 1).sort((a, b) => a.overall - b.overall);
      slotOrder = r1picks.map(p => p.teamId);
      Object.keys(byTeamRound).forEach(tid => { if (!slotOrder.includes(tid)) slotOrder.push(tid); });
    }

    // Snake / 3RR detection.
    // For 3RR: read from tournament meta (set by admin) since Sleeper doesn't
    // return this reliably in draft_type. We use the actual pick.pick field
    // (slot within round) for grid column placement — no direction math needed.
    const is3RR   = !!(leagueEntry?.thirdRoundReversal || _draftCache?._t?.meta?.thirdRoundReversal);
    const isSnake = is3RR || (draftType
      ? (draftType === "snake" || draftType === "startup")
      : (() => {
          const r2picks = picks.filter(p => p.round === 2).sort((a, b) => a.overall - b.overall);
          return r2picks.length > 0 && r2picks[0]?.teamId === slotOrder[slotOrder.length - 1];
        })());

    // Build round×slot → pick lookup using the actual pick.pick value (slot within round).
    // This is authoritative regardless of snake/3RR direction since Sleeper sets it correctly.
    const byRoundSlot = {}; // { [round]: { [slot]: pick } }
    picks.forEach(p => {
      if (!p.round || !p.pick) return;
      if (!byRoundSlot[p.round]) byRoundSlot[p.round] = {};
      byRoundSlot[p.round][p.pick] = p;
    });
    const useSlotLookup = picks.some(p => p.pick > 0); // only if pick slot is populated

    const nameOf = (tid) => picks.find(pk => pk.teamId === tid)?.teamName || tid;

    const draftTypeLabel = is3RR ? "↩ 3rd-round reversal" : isSnake ? "🐍 snake" : "📋 linear";
    const metaLine = `${_esc(leagueName)} · ${rounds} rounds · ${slotOrder.length} teams · ${draftTypeLabel}`;

    // ── Grid mode ────────────────────────────────────────────────────────────
    // Each round is displayed left→right in ascending overall pick order.
    // This correctly handles snake (round 2 starts with last slot) and 3RR
    // without any direction math — we just sort picks by overall number.
    // For empty cells (draft in progress), we compute the expected column
    // from slotOrder + direction rules to show who picks next.
    if (_draftBoardMode === "grid") {
      const teamSize = slotOrder.length;

      // Precompute the display order of teamIds for each round.
      // Round 1:  slot 1 → slot N  (L→R)
      // Snake R2: slot N → slot 1  (R→L, last team picks first)
      // Snake R3: slot 1 → slot N  (L→R again)
      // 3RR:  R1 L→R, R2 R→L, R3 L→R (reset to same as R1), R4+ continues snake
      // 3RR direction pattern (verified from actual picks):
      // Slot 1 picks: 1.01, 2.12, 3.12  → R2 reversed, R3 reversed
      // Slot 12 picks: 1.12, 2.01, 3.01 → R2 reversed, R3 reversed
      // Pattern: R1=forward, R2=rev, R3=rev, R4=forward, R5=rev, R6=rev, ...
      // i.e. reversed when (round % 3 !== 1)
      const _roundOrder = (round) => {
        if (is3RR) {
          const reversed = (round % 3 !== 1);
          return reversed ? [...slotOrder].reverse() : [...slotOrder];
        }
        if (isSnake) return (round % 2 === 0) ? [...slotOrder].reverse() : [...slotOrder];
        return [...slotOrder];
      };

      let boardHTML = "";
      for (let round = 1; round <= rounds; round++) {
        const roundOrder = _roundOrder(round);
        const firstOverall = (round - 1) * teamSize + 1;
        boardHTML += `<div class="draft-round"><div class="draft-round-label">Round ${round}</div><div class="draft-picks-row">`;
        roundOrder.forEach((tid, display) => {
          const overallNum = firstOverall + display;
          // Find the pick for this exact overall number (authoritative — handles any draft format)
          const pk = picks.find(p => p.overall === overallNum) || byTeamRound[tid]?.[round];
          if (pk) {
            const col      = POS_COLOR[pk.position] || "#9ca3af";
            const pName    = pk.name || "Unknown";
            const pos      = pk.position || "?";
            const nfl      = pk.nflTeam  || "FA";
            const displayTeam = pk.teamName || nameOf(tid);
            const clickFn  = pk.playerId
              ? `DLRPlayerCard.show('${_esc(pk.playerId)}','${_esc(pName)}')`
              : "";
            // Abbreviated name: "J. Jefferson" from "Justin Jefferson"
            const nameParts = pName.trim().split(/\s+/);
            const shortName = nameParts.length > 1
              ? nameParts[0].charAt(0) + ". " + nameParts.slice(1).join(" ")
              : pName;
            boardHTML += `
              <div class="draft-pick draft-pick--filled"
                ${clickFn ? `onclick="${clickFn}" style="cursor:pointer;background:${col}18;border-color:${col}40"` : `style="background:${col}18;border-color:${col}40"`}
                title="${_esc(pName)} · ${pos} · ${nfl}">
                <div class="draft-pick-num">${overallNum}</div>
                <div class="draft-pick-player">
                  <div class="draft-pick-name">${_esc(shortName)} <span class="draft-pick-pos-team">${pos} · ${nfl}</span></div>
                </div>
                <div class="draft-pick-team">${_esc(displayTeam)}</div>
              </div>`;
          } else {
            boardHTML += `
              <div class="draft-pick draft-pick--empty">
                <div class="draft-pick-num">${overallNum}</div>
                <div class="draft-pick-owner dim">${_esc(nameOf(tid))}</div>
              </div>`;
          }
        });
        boardHTML += `</div></div>`;
      }
      el.innerHTML = `
        <div class="trn-az-meta">${metaLine}</div>
        <div class="trn-az-section draft-board-scroll"><div class="draft-board">${boardHTML}</div></div>`;
      return;
    }

    // ── List mode ────────────────────────────────────────────────────────────
    const sorted = [...picks].sort((a, b) => a.overall - b.overall);
    const PAGE_SIZE  = 25;
    const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
    const page       = Math.max(1, Math.min(_draftListPage, totalPages));
    const pageRows   = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    // 4 columns: pick# | pos badge | player+NFL stacked | team name
    const LIST_COL = "44px 44px 1fr 1fr";
    const header = `<div class="draft-auction-header" style="grid-template-columns:${LIST_COL}">
      <span>Pick</span><span>Pos</span><span>Player</span><span>Team</span>
    </div>`;

    const rows = pageRows.map(p => {
      const col      = POS_COLOR[p.position] || "#9ca3af";
      const pickLabel = p.round && p.pick ? `${p.round}.${String(p.pick).padStart(2,"0")}` : p.overall;
      const clickAttr = p.playerId
        ? `onclick="DLRPlayerCard.show('${_esc(p.playerId)}','${_esc(p.name)}')" style="cursor:pointer"`
        : "";
      return `
        <div class="draft-auction-row" style="grid-template-columns:${LIST_COL}" ${clickAttr}>
          <span class="draft-auction-rank dim">${pickLabel}</span>
          <span class="draft-pos-badge" style="background:${col}22;color:${col};border-color:${col}55">${_esc(p.position || "?")}</span>
          <div>
            <div class="draft-auction-name">${_esc(p.name || "Unknown")}</div>
	    <div class="draft-auction-team" style="font-size:.80rem>${_esc(p.name || "Unknown")}</div>
            <div class="dim" style="font-size:.7rem">${_esc(p.nflTeam || "FA")}</div>
          </div>
        </div>`;
    });

    const pagination = totalPages > 1 ? `
      <div class="draft-pagination">
        <button class="draft-toggle-btn" id="trn-board-prev" ${page <= 1 ? "disabled" : ""}>‹ Prev</button>
        <span class="dim" style="font-size:.85rem">Page ${page} of ${totalPages} · ${sorted.length} picks</span>
        <button class="draft-toggle-btn" id="trn-board-next" ${page >= totalPages ? "disabled" : ""}>Next ›</button>
      </div>` : "";

    el.innerHTML = `
      <div class="trn-az-meta">${metaLine}</div>
      <div class="draft-auction-list">
        ${header}
        ${rows.join("")}
      </div>
      ${pagination}`;

    el.querySelector("#trn-board-prev")?.addEventListener("click", () => {
      _draftListPage = Math.max(1, _draftListPage - 1);
      _renderDraftBoard(el, picks, leagueEntry);
    });
    el.querySelector("#trn-board-next")?.addEventListener("click", () => {
      _draftListPage = Math.min(totalPages, _draftListPage + 1);
      _renderDraftBoard(el, picks, leagueEntry);
    });
  }

  function _renderDraftCard(el, allPicks) {
    if (!_draftCardTeam) {
      el.innerHTML = `<div class="trn-empty" style="padding:var(--space-6)">Select a team above to generate their shareable draft card.</div>`;
      return;
    }
    const myPicks = allPicks.filter(p => p.teamId === _draftCardTeam).sort((a, b) => a.overall - b.overall);
    if (!myPicks.length) { el.innerHTML = `<div class="trn-empty">No picks found for this team.</div>`; return; }

    const teamName   = myPicks[0].teamName || _draftCardTeam;
    const leagueName = _draftCache?.byLeague
      ? (Object.values(_draftCache.byLeague).find(l => l.normalizedPicks?.some(pk => pk.teamId === _draftCardTeam))?.leagueName
         || Object.values(_draftCache.byLeague)[0]?.leagueName
         || "Tournament Draft")
      : "Tournament Draft";

    // ADP lookup for steal/reach badges
    const adpMap = {};
    (_draftCache?.adp || []).forEach(a => { if (a.playerId) adpMap[a.playerId] = a; });

    // Team count for pick label calculation
    const leagueEntry = _draftCache?.byLeague
      ? Object.values(_draftCache.byLeague).find(l => l.normalizedPicks?.some(pk => pk.teamId === _draftCardTeam))
      : null;
    const teamCount = leagueEntry?.slot_to_roster_id
      ? Object.keys(leagueEntry.slot_to_roster_id).length
      : Math.max(...myPicks.map(p => p.pick || 1), 12);

    const _pickLabel = (p) => {
      const round = p.round || Math.ceil(p.overall / teamCount);
      const slot  = p.pick  || (p.overall - (round - 1) * teamCount);
      return `${round}.${String(slot).padStart(2, "0")}`;
    };

    const _pickRow = (p) => {
      const adpEntry = adpMap[p.playerId];
      const isSteal  = adpEntry?.p75 != null && p.overall > adpEntry.p75;
      const isReach  = adpEntry?.p25 != null && p.overall < adpEntry.p25;
      const badge    = isSteal
        ? `<span class="trn-card-badge trn-card-badge--steal">💎 Steal</span>`
        : isReach
        ? `<span class="trn-card-badge trn-card-badge--reach">🚀 Reach</span>`
        : "";
      const col = POS_COLOR[p.position] || "#9ca3af";
      return `
        <div class="trn-share-card-pick">
          <div class="trn-share-card-pick-num">
            <span class="trn-share-card-round">${_pickLabel(p)}</span>
            <span class="trn-share-card-overall">(#${p.overall})</span>
          </div>
          <span class="draft-pos-badge" style="background:${col}22;color:${col};border-color:${col}55;font-size:.6rem;flex-shrink:0;padding:1px 4px">${_esc(p.position || "?")}</span>
          <span class="trn-share-card-player">${_esc(p.name || "Unknown")}</span>
          ${badge}
        </div>`;
    };

    // Two-column split: odd total → left gets the extra pick
    const total      = myPicks.length;
    const leftCount  = Math.ceil(total / 2);
    const leftPicks  = myPicks.slice(0, leftCount);
    const rightPicks = myPicks.slice(leftCount);
    const avgPick    = (myPicks.reduce((s, p) => s + p.overall, 0) / total).toFixed(1);

    el.innerHTML = `
      <div style="display:flex;justify-content:flex-end;margin-bottom:var(--space-3)">
        <button class="btn-primary btn-sm" id="trn-card-download-btn">⬇ Download Card</button>
      </div>
      <div id="trn-share-card" class="trn-share-card">
        <div class="trn-share-card-header">
          <div class="trn-share-card-tournament">${_esc(leagueName)}</div>
          <div class="trn-share-card-team">${_esc(teamName)}</div>
          <div class="trn-share-card-sub">${total} picks · avg pick #${avgPick}</div>
        </div>
        <div class="trn-share-card-body--two-col">
          <div class="trn-share-card-col">${leftPicks.map(_pickRow).join("")}</div>
          <div class="trn-share-card-col">${rightPicks.map(_pickRow).join("")}</div>
        </div>
        <div class="trn-share-card-footer">dynastylockerroom.com</div>
      </div>`;

    document.getElementById("trn-card-download-btn")?.addEventListener("click", () => _downloadDraftCard());
    // Right-click / long-press also triggers save
    document.getElementById("trn-share-card")?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      _downloadDraftCard();
    });
  }

  async function _downloadDraftCard() {
    if (!_draftCardTeam || !_draftCache) return;
    try {
      const allPicks  = _draftCache.picks || [];
      const myPicks   = allPicks.filter(p => p.teamId === _draftCardTeam).sort((a, b) => a.overall - b.overall);
      if (!myPicks.length) return;
      const adpMap    = {};
      (_draftCache.adp || []).forEach(a => { if (a.playerId) adpMap[a.playerId] = a; });
      const teamName  = myPicks[0].teamName || _draftCardTeam;
      const leagueEntry = _draftCache.byLeague
        ? Object.values(_draftCache.byLeague).find(l => l.normalizedPicks?.some(pk => pk.teamId === _draftCardTeam))
        : null;
      const leagueName = leagueEntry?.leagueName || "Tournament Draft";
      const teamCount  = leagueEntry?.slot_to_roster_id
        ? Object.keys(leagueEntry.slot_to_roster_id).length
        : Math.max(...myPicks.map(p => p.pick || 1), 12);

      const _pickLabel = (p) => {
        const round = p.round || Math.ceil(p.overall / teamCount);
        const slot  = p.pick  || (p.overall - (round - 1) * teamCount);
        return `${round}.${String(slot).padStart(2, "0")}`;
      };

      // ── Canvas layout constants ──────────────────────────────────────────
      const DPR    = 2;  // draw at 2× for crisp display
      const W      = 680;
      const ROW_H  = 28;
      const HDR_H  = 72;
      const FTR_H  = 24;
      const PAD    = 20;
      const GAP    = 24; // gap between columns
      const total  = myPicks.length;
      const leftCount  = Math.ceil(total / 2);
      const colRows    = leftCount;  // height determined by left column
      const BODY_H = colRows * ROW_H + PAD;
      const H      = HDR_H + BODY_H + FTR_H;

      const canvas = document.createElement("canvas");
      canvas.width  = W  * DPR;
      canvas.height = H  * DPR;
      const ctx = canvas.getContext("2d");
      ctx.scale(DPR, DPR);

      // Helper: hex → rgba
      const hex2rgba = (hex, a = 1) => {
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return `rgba(${r},${g},${b},${a})`;
      };

      // ── Colour palette (matches DLR dark theme) ─────────────────────────
      const C = {
        bg:       "#0f1923",
        header:   "#1a3a5c",
        surface:  "#1a2535",
        border:   "#2a3f5a",
        text:     "#e2e8f0",
        dim:      "#4a6080",
        muted:    "#8aa3c2",
        gold:     "#f0b429",
        steal:    "#22c55e",
        stealBg:  "rgba(34,197,94,0.12)",
        reach:    "#ef4444",
        reachBg:  "rgba(239,68,68,0.10)",
        POS: { QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff", TE:"#ffc94d", K:"#9ca3af", DEF:"#9ca3af" }
      };

      // ── Background ───────────────────────────────────────────────────────
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);

      // ── Header ───────────────────────────────────────────────────────────
      ctx.fillStyle = C.header;
      ctx.fillRect(0, 0, W, HDR_H);
      // Gold accent line
      ctx.fillStyle = C.gold;
      ctx.fillRect(0, HDR_H - 2, W, 2);

      ctx.fillStyle = C.muted;
      ctx.font = `500 10px 'Barlow', system-ui, sans-serif`;
      ctx.fillText(leagueName.toUpperCase(), PAD, 22);

      ctx.fillStyle = C.text;
      ctx.font = `700 22px 'Barlow Condensed', 'Arial Narrow', system-ui, sans-serif`;
      ctx.fillText(teamName, PAD, 48);

      ctx.fillStyle = C.dim;
      ctx.font = `400 11px 'Barlow', system-ui, sans-serif`;
      const avgPick = (myPicks.reduce((s, p) => s + p.overall, 0) / total).toFixed(1);
      ctx.fillText(`${total} picks · avg pick #${avgPick}`, PAD, 64);

      // ── Body: two columns ────────────────────────────────────────────────
      const colW   = (W - PAD * 2 - GAP) / 2;
      const leftX  = PAD;
      const rightX = PAD + colW + GAP;

      const _drawPick = (p, x, y) => {
        const adpEntry = adpMap[p.playerId];
        const isSteal  = adpEntry?.p75 != null && p.overall > adpEntry.p75;
        const isReach  = adpEntry?.p25 != null && p.overall < adpEntry.p25;
        const posColor = C.POS[p.position] || "#9ca3af";

        // Alternating row bg
        if ((myPicks.indexOf(p) % 2) === 0) {
          ctx.fillStyle = C.surface;
          ctx.fillRect(x, y, colW, ROW_H);
        }

        let cx = x + 4;

        // Pick label: "2.07"
        ctx.fillStyle = C.text;
        ctx.font = `700 11px 'Barlow Condensed', 'Arial Narrow', monospace`;
        ctx.fillText(_pickLabel(p), cx, y + ROW_H * 0.65);
        cx += 34;

        // Overall: "(#7)"
        ctx.fillStyle = C.dim;
        ctx.font = `400 9px 'Barlow', system-ui, sans-serif`;
        ctx.fillText(`(#${p.overall})`, cx, y + ROW_H * 0.65);
        cx += 32;

        // Pos badge background
        ctx.fillStyle = hex2rgba(posColor, 0.18);
        const badgeW = 26, badgeH = 14;
        const badgeY = y + (ROW_H - badgeH) / 2;
        ctx.beginPath();
        ctx.roundRect(cx, badgeY, badgeW, badgeH, 3);
        ctx.fill();
        ctx.strokeStyle = hex2rgba(posColor, 0.45);
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.fillStyle = posColor;
        ctx.font = `700 8.5px 'Barlow', system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(p.position || "?", cx + badgeW / 2, badgeY + 9.5);
        ctx.textAlign = "left";
        cx += badgeW + 5;

        // Player name — clip to available width
        const nameMaxW = colW - cx + x - 4 - (isSteal || isReach ? 46 : 0);
        ctx.fillStyle = C.text;
        ctx.font = `500 11px 'Barlow', system-ui, sans-serif`;
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx, y, nameMaxW, ROW_H);
        ctx.clip();
        ctx.fillText(p.name || "Unknown", cx, y + ROW_H * 0.65);
        ctx.restore();
        cx += nameMaxW + 2;

        // Steal / reach badge
        if (isSteal || isReach) {
          const bColor = isSteal ? C.steal : C.reach;
          const bBg    = isSteal ? C.stealBg : C.reachBg;
          const bLabel = isSteal ? "💎" : "🚀";
          ctx.fillStyle = bBg;
          ctx.beginPath();
          ctx.roundRect(cx, y + (ROW_H - 14) / 2, 22, 14, 3);
          ctx.fill();
          ctx.fillStyle = bColor;
          ctx.font = `10px serif`;
          ctx.fillText(bLabel, cx + 4, y + ROW_H * 0.65);
        }
      };

      for (let i = 0; i < myPicks.length; i++) {
        const isLeft = i < leftCount;
        const row    = isLeft ? i : i - leftCount;
        const x      = isLeft ? leftX : rightX;
        const y      = HDR_H + PAD / 2 + row * ROW_H;
        _drawPick(myPicks[i], x, y);
      }

      // Column divider
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(leftX + colW + GAP / 2, HDR_H + 8);
      ctx.lineTo(leftX + colW + GAP / 2, HDR_H + BODY_H - 8);
      ctx.stroke();

      // ── Footer ───────────────────────────────────────────────────────────
      ctx.fillStyle = C.surface;
      ctx.fillRect(0, H - FTR_H, W, FTR_H);
      ctx.fillStyle = C.dim;
      ctx.font = `400 9px 'Barlow', system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("dynastylockerroom.com", W / 2, H - 8);
      ctx.textAlign = "left";

      // ── Save / share ─────────────────────────────────────────────────────
      const filename = `draft-card-${teamName.replace(/[^a-z0-9]/gi, "-")}.png`;
      // Try Web Share API first (mobile)
      canvas.toBlob(async (blob) => {
        if (navigator.share && navigator.canShare?.({ files: [new File([blob], filename, { type: "image/png" })] })) {
          try {
            await navigator.share({
              files: [new File([blob], filename, { type: "image/png" })],
              title: `${teamName} Draft Card`
            });
            return;
          } catch(e) { /* fall through to download */ }
        }
        // Fallback: trigger download
        const url  = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = filename;
        link.href     = url;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }, "image/png");

    } catch(e) {
      showToast("Download failed: " + e.message, "error");
    }
  }

  // ── ANALYTICS: Matchups tab (+ AI Recap section) ──────────────────────────
  let _matchupsWeek  = null;
  let _matchupsCache = {};   // { [year_week]: { matchups[], fetchedAt } }
  let _recapCache    = {};   // { [year_week]: { content, savedAt } }

  async function _renderAnalyticsMatchups(tid, t, body) {
    const meta         = t.meta || {};
    const playoffWeek  = meta.playoffStartWeek || null;
    const standingsCache = t.standingsCache || {};
    const year         = _standingsYear || new Date().getFullYear();
    const isAdmin      = t.roles?.[_currentUsername]?.role === "admin" ||
                         t.roles?.[_currentUsername]?.role === "sub_admin";

    // Gather all Sleeper league IDs for this year (matchups are Sleeper-only for now)
    const batches  = t.leagues || {};
    const isBatch  = (v) => v && typeof v === "object" && v.leagues !== undefined;
    const sleeperLeagues = [];
    for (const [, batch] of Object.entries(batches)) {
      if (!isBatch(batch) || batch.platform !== "sleeper" || batch.year !== year) continue;
      for (const [lid] of Object.entries(batch.leagues || {})) sleeperLeagues.push(lid);
    }

    if (!sleeperLeagues.length) {
      body.innerHTML = `<div class="trn-empty"><div class="trn-empty-icon">🏈</div><div class="trn-empty-title">No Sleeper leagues for ${year}</div><div class="trn-empty-sub">Matchup highlights require Sleeper leagues synced for this year.</div></div>`;
      return;
    }

    // Figure out available weeks from standingsCache
    const maxRegWeek = playoffWeek ? playoffWeek - 1 : 17;
    // Find highest synced week from standingsCache
    let latestWeek = 1;
    Object.values(standingsCache).forEach(lc => {
      if (lc.year !== year) return;
      (lc.teams || []).forEach(tm => {
        const played = (tm.wins || 0) + (tm.losses || 0) + (tm.ties || 0);
        if (played > latestWeek) latestWeek = played;
      });
    });
    latestWeek = Math.min(latestWeek, maxRegWeek);
    if (!_matchupsWeek || _matchupsWeek > maxRegWeek) _matchupsWeek = latestWeek || 1;

    const weeks = Array.from({ length: maxRegWeek }, (_, i) => i + 1);

    body.innerHTML = `
      <div class="trn-az-toolbar">
        <div style="display:flex;align-items:center;gap:var(--space-3)">
          <label style="font-size:.85rem;color:var(--color-text-dim)">Week</label>
          <select id="trn-mu-week-sel" style="font-size:.85rem;padding:3px 8px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text)">
            ${weeks.map(w => `<option value="${w}" ${w === _matchupsWeek ? "selected" : ""}>Week ${w}${w === latestWeek ? " (latest)" : ""}</option>`).join("")}
          </select>
        </div>
        <button class="btn-secondary btn-sm" id="trn-mu-refresh-btn">↺ Refresh</button>
      </div>
      <div id="trn-mu-content">
        <div class="trn-az-loading"><div class="spinner"></div> Loading matchups…</div>
      </div>`;

    document.getElementById("trn-mu-week-sel")?.addEventListener("change", function() {
      _matchupsWeek = parseInt(this.value);
      _loadAndRenderMatchups(tid, t, sleeperLeagues, year, isAdmin, document.getElementById("trn-mu-content"));
    });
    document.getElementById("trn-mu-refresh-btn")?.addEventListener("click", () => {
      const ck = `${year}_${_matchupsWeek}`;
      delete _matchupsCache[ck];
      // Also clear Firebase cache so fresh data is fetched from Sleeper
      _tAnalyticsRef(tid).child(`weeklyHighlights/${ck}`).remove().catch(() => {});
      _loadAndRenderMatchups(tid, t, sleeperLeagues, year, isAdmin, document.getElementById("trn-mu-content"));
    });

    await _loadAndRenderMatchups(tid, t, sleeperLeagues, year, isAdmin, document.getElementById("trn-mu-content"));
  }

  async function _loadAndRenderMatchups(tid, t, leagueIds, year, isAdmin, el) {
    if (!el) return;
    const ck = `${year}_${_matchupsWeek}`;

    // Check memory cache (scores always present here since we built it this session)
    if (_matchupsCache[ck] && (Date.now() - _matchupsCache[ck].fetchedAt) < 300000) {
      _renderMatchupsContent(tid, t, el, _matchupsCache[ck].matchups, year, isAdmin);
      return;
    }

    // Skip Firebase cache entirely for matchups — stale data may have wrong/missing
    // diff and combined values. Always fetch fresh from Sleeper (fast, public API).
    // Firebase is only used to store for the recap feature, not as a read cache.

    el.innerHTML = `<div class="trn-az-loading"><div class="spinner"></div> Fetching week ${_matchupsWeek} matchups…</div>`;

    // Fetch from Sleeper in parallel (batches of 5)
    const allMatchups = [];
    const standingsCache = t.standingsCache || {};
    // Key teamMap as "{leagueId}:{teamId}" — leagues reuse roster_ids 1-12 so a
    // bare key lets later leagues overwrite earlier ones (B2 fix).
    // Still filter to current year only; also keep bare-key fallback for legacy data.
    const teamMap = {};
    Object.values(standingsCache).forEach(lc => {
      if (lc.year && parseInt(lc.year) !== parseInt(year)) return;
      const lcLeagueId = String(lc.leagueId || lc.league_id || "");
      (lc.teams || []).forEach(tm => {
        const qualKey = lcLeagueId ? `${lcLeagueId}:${tm.teamId}` : String(tm.teamId);
        teamMap[qualKey] = tm.teamName;
        if (lcLeagueId) teamMap[String(tm.teamId)] = teamMap[String(tm.teamId)] || tm.teamName;
      });
    });
    const pMap = _buildParticipantTeamMap(t);
    const _sk  = (s) => String(s).trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_");

    for (let i = 0; i < leagueIds.length; i += 5) {
      const batch = leagueIds.slice(i, i + 5);
      await Promise.allSettled(batch.map(async lid => {
        try {
          const r = await fetch(`https://api.sleeper.app/v1/league/${lid}/matchups/${_matchupsWeek}`);
          if (!r.ok) return;
          const data = await r.json();
          if (!Array.isArray(data)) return;
          // Group by matchup_id
          const byMid = {};
          data.forEach(m => {
            if (!m.matchup_id) return;
            (byMid[m.matchup_id] = byMid[m.matchup_id] || []).push(m);
          });
          console.log(`[Matchups] ${lid} week ${_matchupsWeek}: ${data.length} entries, ${Object.keys(byMid).length} matchups`);
          Object.values(byMid).forEach(pair => {
            if (pair.length !== 2) return;
            const [a, b] = pair;
            // Use points field directly — Sleeper returns it as a float (e.g. 127.46)
            const apts = parseFloat(a.points) || 0;
            const bpts = parseFloat(b.points) || 0;
            // Only skip if BOTH are exactly 0 (unplayed or bye)
            if (apts === 0 && bpts === 0) return;
            // Try qualified key first (prevents roster_id collision across leagues)
            let aName = teamMap[`${lid}:${a.roster_id}`] || teamMap[String(a.roster_id)] || `Team ${a.roster_id}`;
            let bName = teamMap[`${lid}:${b.roster_id}`] || teamMap[String(b.roster_id)] || `Team ${b.roster_id}`;
            const aKey = _sk(aName), bKey = _sk(bName);
            if (pMap[aKey]) aName = pMap[aKey].displayName;
            if (pMap[bKey]) bName = pMap[bKey].displayName;
            const diff = parseFloat((Math.abs(apts - bpts)).toFixed(2));
            allMatchups.push({
              leagueId: lid, week: _matchupsWeek,
              home: { rosterId: String(a.roster_id), name: aName, score: parseFloat(apts.toFixed(2)) },
              away: { rosterId: String(b.roster_id), name: bName, score: parseFloat(bpts.toFixed(2)) },
              diff, combined: parseFloat((apts + bpts).toFixed(2)),
              winner: apts > bpts ? aName : bName
            });
          });
        } catch(e) {}
      }));
      if (i + 5 < leagueIds.length) await new Promise(r => setTimeout(r, 100));
    }

    if (!allMatchups.length) {
      el.innerHTML = `<div class="trn-empty">No matchup data for Week ${_matchupsWeek} yet.</div>`;
      return;
    }

    const payload = { matchups: allMatchups, fetchedAt: Date.now() };
    _matchupsCache[ck] = payload;
    await _tAnalyticsRef(tid).child(`weeklyHighlights/${ck}`).set(payload).catch(() => {});
    _renderMatchupsContent(tid, t, el, allMatchups, year, isAdmin);
  }

  // ── Active section state for matchups dropdown ────────────────────────────
  let _matchupsSection = "highest"; // "highest" | "lowest" | "closest" | "blowouts"

  async function _renderMatchupsContent(tid, t, el, matchups, year, isAdmin) {
    // Recompute diff/combined from raw scores
    const enriched = matchups.map(m => ({
      ...m,
      diff:     Math.abs((m.home?.score || 0) - (m.away?.score || 0)),
      combined: (m.home?.score || 0) + (m.away?.score || 0),
      winner:   m.winner || ((m.home?.score || 0) >= (m.away?.score || 0) ? m.home?.name : m.away?.name)
    })).filter(m => m.home?.score > 0 || m.away?.score > 0);

    const closest  = [...enriched].sort((a, b) =>  a.diff - b.diff).slice(0, 5);
    const blowouts = [...enriched].sort((a, b) =>  b.diff - a.diff).slice(0, 5);

    // Build per-team score list and league name map
    const allTeamScores = [];
    const leagueNameMap = {};
    // Build leagueNameMap from standingsCache where leagueName is already resolved
    Object.values(t.standingsCache || {}).forEach(lc => {
      if (lc.leagueId && lc.leagueName) leagueNameMap[String(lc.leagueId)] = lc.leagueName;
    });
    enriched.forEach(m => {
      if (!leagueNameMap[m.leagueId]) {
        // Fallback: drill into batch structure in t.leagues
        for (const batch of Object.values(t.leagues || {})) {
          const entry = batch.leagues?.[m.leagueId] || batch.leagues?.[String(m.leagueId)];
          if (entry?.name) { leagueNameMap[m.leagueId] = entry.name; break; }
        }
      }
      allTeamScores.push({ name: m.home.name, score: m.home.score, leagueId: m.leagueId });
      allTeamScores.push({ name: m.away.name, score: m.away.score, leagueId: m.leagueId });
    });
    const myKeys = _findMyKeys(t);
    allTeamScores.forEach(ts => { ts.isMe = _isMyTeam(ts.name, myKeys); });
    const byScore       = [...allTeamScores].sort((a, b) => b.score - a.score);
    const highestScores = byScore.slice(0, 5);
    const lowestScores  = byScore.slice(-5).reverse(); // 5 lowest, worst-first

    const ck = `${year}_${_matchupsWeek}`;

    // Lazy-load recap
    if (!_recapCache[ck]) {
      try {
        const snap = await _tAnalyticsRef(tid).child(`recap/${ck}`).once("value");
        const fbRecap = snap.val();
        if (fbRecap?.content) _recapCache[ck] = fbRecap;
      } catch(e) {}
    }
    const recapData = _recapCache[ck] || null;

    // ── Ordinal helper ─────────────────────────────────────────────────────
    const _ord = n => ["1st","2nd","3rd","4th","5th"][n] || `${n+1}th`;

    // ── Score card (highest OR lowest) ────────────────────────────────────
    // rank badge, big score, team name, league name dimmed
    // low=true → score shown in red/dim; rank reads "1st lowest" etc.
    const scoreCard = (ts, i, low = false) => {
      const lname = leagueNameMap[ts.leagueId] || "";
      return `
        <div class="trn-mu-card trn-mu-card--score ${low ? "trn-mu-card--score-low" : ""} ${ts.isMe ? "trn-mu-card--me" : ""}">
          <div class="trn-mu-card-rank">${_ord(i)}</div>
          <div class="trn-mu-card-score-pts ${low ? "trn-mu-card-score-pts--low" : ""}">${ts.score.toFixed(2)}</div>
          <div class="trn-mu-card-score-name">${_esc(ts.name)}${ts.isMe ? ' <span class="trn-you-badge">you</span>' : ""}</div>
          ${lname ? `<div class="trn-mu-card-score-league">${_esc(lname)}</div>` : ""}
        </div>`;
    };

    // ── Matchup card ───────────────────────────────────────────────────────
    // Line 1: winner name (bold) + winning score (green)
    // Line 2: loser name (dimmed) + losing score (dimmed)
    // Line 3 footer: Δ margin centered yellow | league name dimmed right
    const matchupCard = (m) => {
      const homeWon  = m.home.score > m.away.score;
      const winTeam  = homeWon ? m.home : m.away;
      const loseTeam = homeWon ? m.away : m.home;
      const aMeW = _isMyTeam(winTeam.name,  myKeys);
      const aMeL = _isMyTeam(loseTeam.name, myKeys);
      const lname = leagueNameMap[m.leagueId] || "";
      return `
        <div class="trn-mu-card ${aMeW || aMeL ? "trn-mu-card--me" : ""}">
          <div class="trn-mu-card-line trn-mu-card-line--win">
            <span class="trn-mu-card-lname">${_esc(winTeam.name)}${aMeW ? ' <span class="trn-you-badge">you</span>' : ""}</span>
            <span class="trn-mu-card-lscore trn-mu-card-lscore--win">${winTeam.score.toFixed(2)}</span>
          </div>
          <div class="trn-mu-card-line trn-mu-card-line--lose">
            <span class="trn-mu-card-lname">${_esc(loseTeam.name)}${aMeL ? ' <span class="trn-you-badge">you</span>' : ""}</span>
            <span class="trn-mu-card-lscore trn-mu-card-lscore--lose">${loseTeam.score.toFixed(2)}</span>
          </div>
          <div class="trn-mu-card-line trn-mu-card-line--footer">
            <span class="trn-mu-card-margin">Δ${m.diff.toFixed(2)}</span>
          </div>
          ${lname ? `<div class="trn-mu-card-line trn-mu-card-line--league">${_esc(lname)}</div>` : ""}
        </div>`;
    };
    // ── Render sections ────────────────────────────────────────────────────
    const sectionHtml = {
      highest: `<div class="trn-mu-grid">${highestScores.map((ts, i) => scoreCard(ts, i, false)).join("")}</div>`,
      lowest:  `<div class="trn-mu-grid">${lowestScores.map((ts, i)  => scoreCard(ts, i, true)).join("")}</div>`,
      closest: `<div class="trn-mu-grid">${closest.map(m  => matchupCard(m)).join("")}</div>`,
      blowouts:`<div class="trn-mu-grid">${blowouts.map(m => matchupCard(m)).join("")}</div>`
    };

    el.innerHTML = `
      <div class="trn-az-meta">Week ${_matchupsWeek} \u00b7 ${enriched.length} matchups across ${new Set(enriched.map(m => m.leagueId)).size} leagues</div>

      <!-- Section selector — always visible, controls which panel shows -->
      <div class="trn-mu-section-bar">
        <select class="trn-filter-select trn-mu-section-sel" id="trn-mu-section-sel">
          <option value="highest" ${_matchupsSection === "highest"  ? "selected" : ""}>📈 Highest Scoring</option>
          <option value="lowest"  ${_matchupsSection === "lowest"   ? "selected" : ""}>📉 Lowest Scoring</option>
          <option value="closest" ${_matchupsSection === "closest"  ? "selected" : ""}>🔥 Closest Games</option>
          <option value="blowouts"${_matchupsSection === "blowouts" ? "selected" : ""}>💥 Biggest Blowouts</option>
        </select>
      </div>

      <div id="trn-mu-section-panel">
        ${sectionHtml[_matchupsSection] || sectionHtml.highest}
      </div>

      <!-- Score distribution — always shown below -->
      <div class="trn-az-section-title" style="margin-top:var(--space-5)">\ud83d\udcca Score Distribution</div>
      <div class="trn-mu-hist-wrap">
        <canvas id="trn-mu-hist" class="trn-mu-hist"></canvas>
        <div class="trn-mu-hist-legend" id="trn-mu-hist-legend"></div>
      </div>

      <!-- Recap section -->
      <div class="trn-recap-section" id="trn-recap-section">
        <div class="trn-az-section-title" style="margin-top:var(--space-6)">\ud83d\udcdd Weekly Recap</div>
        ${recapData
          ? `<div class="trn-recap-content">${_renderRecapMarkdown(recapData.content)}</div>
             <div class="trn-recap-meta">
               Saved ${new Date(recapData.savedAt).toLocaleString()}
               ${isAdmin ? `<button class="btn-ghost btn-sm" id="trn-recap-edit-btn" style="margin-left:var(--space-3)">\u270f Edit</button>` : ""}
             </div>`
          : isAdmin
            ? `<div class="trn-recap-placeholder">
                 <p style="font-size:.87rem;color:var(--color-text-dim)">
                   Write a recap or generate one with AI \u2014 copy the prompt below, paste it into
                   <a href="https://claude.ai" target="_blank" rel="noopener" style="color:var(--color-accent)">claude.ai</a>,
                   then paste the result back here.
                 </p>
                 <button class="btn-secondary btn-sm" id="trn-recap-prompt-btn">\ud83d\udccb Copy AI Prompt</button>
               </div>`
            : ""
        }
        ${isAdmin ? `<div id="trn-recap-editor" class="trn-recap-editor hidden"></div>` : ""}
      </div>`;

    // Section selector handler — swap panel content, persist choice
    document.getElementById("trn-mu-section-sel")?.addEventListener("change", function() {
      _matchupsSection = this.value;
      const panel = document.getElementById("trn-mu-section-panel");
      if (panel) panel.innerHTML = sectionHtml[_matchupsSection] || sectionHtml.highest;
    });

    requestAnimationFrame(() => _drawScoreHistogram(allTeamScores.map(ts => ts.score)));

    if (isAdmin) {
      document.getElementById("trn-recap-prompt-btn")?.addEventListener("click", () => {
        const prompt = _buildRecapPrompt(t, enriched, allTeamScores, year);
        navigator.clipboard?.writeText(prompt).then(() => showToast("Prompt copied \u2014 paste into claude.ai \u2713"))
          .catch(() => { showToast("Copy failed \u2014 see console", "error"); console.log(prompt); });
        _showRecapEditor(tid, t, enriched, year);
      });
      document.getElementById("trn-recap-edit-btn")?.addEventListener("click", () => {
        _showRecapEditor(tid, t, enriched, year, recapData?.content || "");
      });
    }
  }

  // ── Score histogram (canvas) ───────────────────────────────────────────────
  function _drawScoreHistogram(scores) {
    if (!scores.length) return;
    const canvas = document.getElementById("trn-mu-hist");
    if (!canvas) return;

    const style    = getComputedStyle(document.documentElement);
    const colorBar = style.getPropertyValue("--color-accent").trim()   || "#6c63ff";
    const colorTxt = style.getPropertyValue("--color-text-dim").trim() || "#888";
    const colorGrid= style.getPropertyValue("--color-border").trim()   || "#333";
    const colorMed = style.getPropertyValue("--color-green").trim()    || "#4ade80";

    const DPR = window.devicePixelRatio || 1;
    const W   = canvas.offsetWidth || 400;
    const H   = 180;
    canvas.width  = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width  = W + "px";
    canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(DPR, DPR);

    // Bin into 10-pt buckets
    const minV = Math.floor(Math.min(...scores) / 10) * 10;
    const maxV = Math.ceil(Math.max(...scores)  / 10) * 10;
    const bins = [];
    for (let lo = minV; lo < maxV; lo += 10) bins.push({ lo, count: 0 });
    scores.forEach(s => {
      const idx = Math.min(Math.floor((s - minV) / 10), bins.length - 1);
      if (idx >= 0) bins[idx].count++;
    });
    const maxC = Math.max(...bins.map(b => b.count), 1);

    // Median
    const sorted = [...scores].sort((a, b) => a - b);
    const mid    = sorted.length;
    const median = mid % 2 === 0
      ? (sorted[mid / 2 - 1] + sorted[mid / 2]) / 2
      : sorted[Math.floor(mid / 2)];

    const PL = 28, PR = 12, PT = 14, PB = 32;
    const CW = W - PL - PR;
    const CH = H - PT - PB;
    const BW = CW / (bins.length || 1);

    ctx.clearRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = colorGrid; ctx.lineWidth = 0.5;
    [0, .25, .5, .75, 1].forEach(f => {
      const y = PT + CH - f * CH;
      ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + CW, y); ctx.stroke();
    });

    // Bars
    bins.forEach((b, i) => {
      const x  = PL + i * BW;
      const bH = (b.count / maxC) * CH;
      ctx.fillStyle = colorBar + "cc";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x + 1, PT + CH - bH, BW - 2, bH, 2);
      else ctx.rect(x + 1, PT + CH - bH, BW - 2, bH);
      ctx.fill();
      if (i % 2 === 0) {
        ctx.fillStyle = colorTxt; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(b.lo, x + BW / 2, H - PB + 14);
      }
    });

    // Y-axis labels
    ctx.fillStyle = colorTxt; ctx.font = "9px sans-serif"; ctx.textAlign = "right";
    [0, .25, .5, .75, 1].forEach(f => {
      ctx.fillText(Math.round(f * maxC), PL - 3, PT + CH - f * CH + 3);
    });

    // Median dashed line
    const range = (maxV - minV) || 1;
    const medX  = PL + ((median - minV) / range) * CW;
    ctx.strokeStyle = colorMed; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(medX, PT); ctx.lineTo(medX, PT + CH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = colorMed; ctx.font = "10px sans-serif";
    ctx.textAlign = medX > W / 2 ? "right" : "left";
    ctx.fillText(`med ${median.toFixed(1)}`, medX + (medX > W / 2 ? -4 : 4), PT + 10);

    // Legend
    const leg = document.getElementById("trn-mu-hist-legend");
    if (leg) {
      const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2);
      leg.innerHTML = `
        <span>\ud83d\udcca ${scores.length} scores</span>
        <span>Avg: <strong>${avg}</strong></span>
        <span>Med: <strong>${median.toFixed(2)}</strong></span>
        <span>Hi: <strong>${Math.max(...scores).toFixed(2)}</strong></span>
        <span>Lo: <strong>${Math.min(...scores).toFixed(2)}</strong></span>`;
    }
  }

  function _buildRecapPrompt(t, matchups, allTeamScores, year) {
    // Sort buckets
    const allScores = allTeamScores.map(ts => ts.score);
    const scoreSorted = [...allScores].sort((a, b) => a - b);
    const mid    = scoreSorted.length;
    const median = mid % 2 === 0
      ? (scoreSorted[mid / 2 - 1] + scoreSorted[mid / 2]) / 2
      : scoreSorted[Math.floor(mid / 2)];
    const avg    = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    const hi     = Math.max(...allScores);
    const lo     = Math.min(...allScores);

    const closest  = [...matchups].sort((a, b) => a.diff - b.diff).slice(0, 5).map(m =>
      `  \u2022 ${m.home.name} ${m.home.score.toFixed(2)} \u2013 ${m.away.score.toFixed(2)} ${m.away.name} (margin: ${m.diff.toFixed(2)})`
    );
    const blowouts = [...matchups].sort((a, b) => b.diff - a.diff).slice(0, 5).map(m =>
      `  \u2022 ${m.winner} won ${Math.max(m.home.score, m.away.score).toFixed(2)} \u2013 ${Math.min(m.home.score, m.away.score).toFixed(2)} (margin: ${m.diff.toFixed(2)})`
    );
    const byScore  = [...allTeamScores].sort((a, b) => b.score - a.score);
    const topScorers = byScore.slice(0, 5).map((ts, i) =>
      `  ${["1st","2nd","3rd","4th","5th"][i]}. ${ts.name} \u2014 ${ts.score.toFixed(2)} pts`
    );
    const lowScorers = [...byScore].reverse().slice(0, 5).map((ts, i) =>
      `  ${["1st","2nd","3rd","4th","5th"][i]} lowest. ${ts.name} \u2014 ${ts.score.toFixed(2)} pts`
    );

    // Rough distribution buckets for the prompt
    const buckets = {};
    allScores.forEach(s => {
      const bucket = `${Math.floor(s / 10) * 10}\u2013${Math.floor(s / 10) * 10 + 9}`;
      buckets[bucket] = (buckets[bucket] || 0) + 1;
    });
    const distLines = Object.entries(buckets)
      .sort(([a], [b]) => parseInt(a) - parseInt(b))
      .map(([range, count]) => `  ${range} pts: ${count} team${count !== 1 ? "s" : ""}`)
      .join("\n");

    return `You are a fun, witty fantasy football analyst writing a brief weekly recap for a large multi-league tournament called "${t.meta?.name || "the tournament"}".

Week ${_matchupsWeek} (${year}) Summary:
- ${matchups.length} total matchups across ${new Set(matchups.map(m => m.leagueId)).size} leagues
- ${allScores.length} individual team scores
- Average: ${avg.toFixed(2)} pts | Median: ${median.toFixed(2)} pts | High: ${hi.toFixed(2)} | Low: ${lo.toFixed(2)}

Top scorers this week:
${topScorers.join("\n")}

Lowest scorers this week:
${lowScorers.join("\n")}

Closest games:
${closest.join("\n")}

Biggest blowouts:
${blowouts.join("\n")}

Score distribution:
${distLines}

Write a 3\u20134 paragraph weekly recap in an engaging, sports-analyst style. Highlight the top scorer and give them a moment. Mention the closest game (nail-biter drama) and the biggest blowout. Take a gentle jab at the lowest scorer. Reference the score distribution to set the tone for the week \u2014 was it a high-scoring week, low-scoring, or all over the place? Keep it punchy and fun \u2014 like an ESPN segment. Use **bold** for team names and key scores. Keep total length under 350 words.`;
  }

  function _showRecapEditor(tid, t, matchups, year, existingText = "") {
    const editorEl = document.getElementById("trn-recap-editor");
    if (!editorEl) return;
    editorEl.classList.remove("hidden");
    editorEl.innerHTML = `
      <div style="margin-top:var(--space-4)">
        <label style="font-size:.82rem;font-weight:600;display:block;margin-bottom:var(--space-2)">Paste recap here:</label>
        <textarea id="trn-recap-textarea" rows="10"
          placeholder="Paste the AI-generated recap here, or write your own…"
          style="width:100%;resize:vertical;font-size:.875rem;font-family:inherit">${_esc(existingText)}</textarea>
        <div style="display:flex;gap:var(--space-2);margin-top:var(--space-3)">
          <button class="btn-primary btn-sm" id="trn-recap-save-btn">Save Recap</button>
          <button class="btn-ghost btn-sm" id="trn-recap-cancel-btn">Cancel</button>
        </div>
      </div>`;

    document.getElementById("trn-recap-cancel-btn")?.addEventListener("click", () => {
      editorEl.classList.add("hidden");
    });
    document.getElementById("trn-recap-save-btn")?.addEventListener("click", async () => {
      const content = document.getElementById("trn-recap-textarea")?.value.trim();
      if (!content) { showToast("Recap is empty", "error"); return; }
      const ck      = `${year}_${_matchupsWeek}`;
      const payload = { content, savedAt: Date.now(), savedBy: _currentUsername };
      try {
        await _tAnalyticsRef(tid).child(`recap/${ck}`).set(payload);
        _recapCache[ck] = payload;
        showToast("Recap saved ✓");
        // Re-render the matchups tab to show the saved recap
        const body = document.getElementById("trn-tab-body");
        if (body) _renderAnalyticsMatchups(tid, t, body);
      } catch(e) { showToast("Failed to save: " + e.message, "error"); }
    });
  }

  function _renderRecapMarkdown(text) {
    // Minimal markdown: **bold**, *italic*, newlines, ## headings
    return String(text || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/^## (.+)$/gm, "<h4>$1</h4>")
      .replace(/^### (.+)$/gm, "<h5>$1</h5>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/\n/g, "<br>")
      .replace(/^/, "<p>").replace(/$/, "</p>");
  }

  // ── ANALYTICS: Rosters tab ─────────────────────────────────────────────────
  let _rostersCache = null; // { rows[], fetchedAt, tid }

  async function _renderAnalyticsRosters(tid, t, body) {
    await DLRPlayers.load().catch(() => {});

    body.innerHTML = `<div class="trn-az-loading"><div class="spinner"></div> Loading rosters…</div>`;

    if (_rostersCache && _rostersCache.tid === tid && (Date.now() - _rostersCache.fetchedAt) < 300000) {
      _renderRostersView(body, _rostersCache.rows, t);
      return;
    }

    try {
      const meta         = t.meta || {};
      const rankBy       = meta.rankBy || "record";
      const standingsCache = t.standingsCache || {};
      const year         = _standingsYear || new Date().getFullYear();

      // Get top 10 teams from standings (already ranked)
      const allRows = [];
      for (const [ck, lc] of Object.entries(standingsCache)) {
        if (lc.year !== year) continue;
        (lc.teams || []).forEach(tm => {
          allRows.push({ ...tm, leagueId: lc.leagueId || ck.split("_").slice(1).join("_"), platform: lc.platform, year: lc.year, leagueName: lc.leagueName });
        });
      }
      const ranked = _rankTeams(allRows, rankBy);
      const top10  = ranked.slice(0, 10);

      if (!top10.length) {
        body.innerHTML = `<div class="trn-empty"><div class="trn-empty-icon">🏆</div><div class="trn-empty-title">No standings data yet</div><div class="trn-empty-sub">Sync standings first to see top rosters.</div></div>`;
        return;
      }

      // Fetch rosters for top 10 teams — Sleeper only for now (others need auth)
      const pMap       = _buildParticipantTeamMap(t);
      const _sk        = (s) => String(s).trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_");
      const rosterRows = [];

      // Group top10 by leagueId so we fetch each league once
      const byLeague = {};
      top10.forEach((tm, rank) => {
        const lid = tm.leagueId;
        if (!byLeague[lid]) byLeague[lid] = [];
        byLeague[lid].push({ ...tm, overallRank: rank + 1 });
      });

      await Promise.allSettled(Object.entries(byLeague).map(async ([lid, teams]) => {
        try {
          if (teams[0].platform !== "sleeper") {
            // Non-Sleeper: show standings row only, no roster details
            teams.forEach(tm => rosterRows.push({ ...tm, players: null }));
            return;
          }
          const [rosters, users] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${lid}/rosters`).then(r => r.ok ? r.json() : []),
            fetch(`https://api.sleeper.app/v1/league/${lid}/users`).then(r => r.ok ? r.json() : [])
          ]);
          const userMap = {};
          (users || []).forEach(u => { userMap[u.user_id] = u; });

          teams.forEach(tm => {
            const roster = (rosters || []).find(r => String(r.roster_id) === String(tm.teamId));
            if (!roster) { rosterRows.push({ ...tm, players: null }); return; }
            // Resolve player objects
            const playerIds = [...(roster.starters || []), ...(roster.players || []).filter(pid => !(roster.starters || []).includes(pid))];
            const players = playerIds.map(pid => {
              const p = DLRPlayers.get(pid);
              return p?.first_name ? {
                id:       pid,
                name:     `${p.first_name} ${p.last_name}`.trim(),
                position: (p.position || "?").toUpperCase(),
                team:     p.team || "FA",
                isStarter: (roster.starters || []).includes(pid)
              } : { id: pid, name: `Player ${pid}`, position: "?", team: "?", isStarter: false };
            }).filter(p => p.position !== "?");
            // Override team name from participant map
            const key = _sk(tm.teamName || "");
            const displayName = pMap[key]?.displayName || tm.teamName;
            rosterRows.push({ ...tm, teamName: displayName, players });
          });
        } catch(e) { teams.forEach(tm => rosterRows.push({ ...tm, players: null })); }
      }));

      rosterRows.sort((a, b) => a.overallRank - b.overallRank);
      _rostersCache = { rows: rosterRows, fetchedAt: Date.now(), tid };
      _renderRostersView(body, rosterRows, t);
    } catch(e) {
      body.innerHTML = `<div class="trn-empty">Failed to load rosters: ${_esc(e.message)}</div>`;
    }
  }

  function _renderRostersView(body, rows, t) {
    const year   = _tournamentYear || new Date().getFullYear();
    const myKeys = _findMyKeys(t);
    body.innerHTML = `
      <div class="trn-az-meta">Top ${rows.length} teams · ${year} season</div>
      <div style="display:flex;justify-content:flex-end;margin-bottom:var(--space-3)">
        <button class="btn-secondary btn-sm" id="trn-rosters-refresh-btn">↺ Refresh</button>
      </div>
      <div id="trn-rosters-list" class="trn-rosters-grid">
        ${rows.map(row => _renderRosterCard(row, myKeys)).join("")}
      </div>`;

    document.getElementById("trn-rosters-refresh-btn")?.addEventListener("click", () => {
      _rostersCache = null;
      _renderAnalyticsRosters(body.closest("[id]")?.id ? _activeTournamentId : _activeTournamentId, t, body);
    });
  }

  function _renderRosterCard(row, myKeys) {
    const medals   = ["🥇","🥈","🥉"];
    const medal    = medals[row.overallRank - 1] || `#${row.overallRank}`;
    const isMe     = _isMyTeam(row.teamName || "", myKeys || new Set());
    const youBadge = isMe ? ' <span class="trn-you-badge">you</span>' : "";

    if (!row.players) {
      return `
        <div class="trn-roster-card trn-roster-card--slim ${isMe ? "trn-roster-card--me" : ""}">
          <div class="trn-roster-card-header">
            <span class="trn-roster-rank">${medal}</span>
            <span class="trn-roster-team">${_esc(row.teamName || "Unknown")}${youBadge}</span>

            <span class="trn-platform-badge trn-platform-${row.platform || "unknown"}">${(row.platform || "?").toUpperCase()}</span>
          </div>
          <div style="padding:var(--space-2) var(--space-4);font-size:.78rem;color:var(--color-text-dim)">Roster details require Sleeper authentication.</div>
        </div>`;
    }

    // Group all players (starters + bench together) by position, sorted by rank within group.
    // Matches the same pattern as the league detail roster tab (roster.js).
    const POS_ORDER_TRN = ["QB","RB","WR","TE","K","DEF","DB","LB","DL","OL"];
    const byPos = {};
    POS_ORDER_TRN.forEach(p => { byPos[p] = []; });
    byPos["—"] = [];

    row.players.forEach(p => {
      const pos = (p.position || "—").toUpperCase();
      const grp = byPos[pos] !== undefined ? pos : "—";
      byPos[grp].push({ ...p, rank: p.rank || 9999 });
    });

    // Sort each group by rank
    Object.values(byPos).forEach(arr => arr.sort((a, b) => a.rank - b.rank));

    // Build position group sections — same structure as roster.js
    let posHTML = "";
    for (const pos of [...POS_ORDER_TRN, "—"]) {
      const group = byPos[pos];
      if (!group.length) continue;
      const col = POS_COLOR[pos] || "#9ca3af";
      posHTML += `
        <div class="roster-pos-group">
          <div class="roster-pos-header" style="color:${col}">
            ${_esc(pos)}
            <span class="roster-pos-count">${group.length}</span>
          </div>
          ${group.map(p => {
            const isBench = !p.isStarter;
            const nfl = p.team && p.team !== "FA" ? ` <span class="trn-rp-nfl-inline">${_esc(p.team)}</span>` : "";
            return `
              <div class="roster-player-row trn-roster-player-row${isBench ? " trn-roster-player-row--bench" : ""}">
                <div class="trn-rp-name-line">${_esc(p.name)}${nfl}</div>
              </div>`;
          }).join("")}
        </div>`;
    }

    return `
      <div class="trn-roster-card ${isMe ? "trn-roster-card--me" : ""}">
        <div class="trn-roster-card-header">
          <span class="trn-roster-rank">${medal}</span>
          <span class="trn-roster-team">${_esc(row.teamName || "Unknown")}${youBadge}</span>

        </div>
        <div class="trn-roster-body">
          <div class="roster-positions">${posHTML}</div>
        </div>
      </div>`;
  }

  // ── User: Info tab ─────────────────────────────────────

  // ═══════════════════════════════════════════════════════
  // ANALYTICS: F-AZ Part 2
  // Three new analytics views sharing a common PO data helper.
  // ═══════════════════════════════════════════════════════

  // ── Shared qual engine: compute qualification for one year ──────────────────
  // Pure function — reads from t.standingsCache + t.playoffs[year] config only.
  // No Firebase reads. Returns { qualSet, byeSet, allTeams, qualifiers, mode,
  // overallWinner, _teamKey } using the same logic as _renderPlayoffsTab.
  // Called by _buildPoByYear so analytics tabs share identical qualification logic.

  function _computeQualification(t, year) {
    const yr  = String(year);
    const po  = _playoffForYear(t, yr);
    const mode = po.mode || "total_points";
    const _skQ = (s) => String(s || "").trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_");

    // Build participant name/gender maps (mirrors _renderPlayoffsTab)
    const genderMap = {}, displayNameMap = {};
    const slUGenderMap = {}, slUDisplayMap = {};
    Object.values(t.participants || {}).forEach(p => {
      [p.sleeperUsername, p.displayName, p.teamName].filter(Boolean).forEach(n => {
        const k = _skQ(n);
        if (p.gender)      genderMap[k]     = p.gender;
        if (p.displayName) displayNameMap[k] = p.displayName;
      });
      if (p.sleeperUsername) {
        const k = p.sleeperUsername.toLowerCase();
        if (p.gender)      slUGenderMap[k]  = p.gender;
        if (p.displayName) slUDisplayMap[k] = p.displayName;
      }
    });

    // Assemble allTeams for this year from standingsCache
    const allTeams = [];
    Object.entries(t.standingsCache || {}).forEach(([ck, lc]) => {
      if (String(lc.year) !== yr) return;
      (lc.teams || []).forEach(tm => {
        const gender      = (tm.sleeperUsername ? slUGenderMap[tm.sleeperUsername.toLowerCase()] : null)
          || genderMap[_skQ(tm.teamName)] || genderMap[_skQ(tm.rawTeamName)] || "";
        const displayName = (tm.sleeperUsername ? slUDisplayMap[tm.sleeperUsername.toLowerCase()] : null)
          || displayNameMap[_skQ(tm.teamName)] || displayNameMap[_skQ(tm.rawTeamName)] || tm.teamName || "";
        allTeams.push({ ...tm, displayName,
          leagueName:  lc.leagueName || ck,
          division:    lc.division   || "",
          conference:  lc.conference || "",
          gender,
        });
      });
    });

    const _empty = { qualSet: new Set(), byeSet: new Set(), allTeams: [], qualifiers: [], mode, overallWinner: null, _teamKey: tm => "" };
    if (!allTeams.length) return _empty;

    const _sortByMetric = (teams, metric) => [...teams].sort((a, b) =>
      metric === "record"
        ? ((b.wins||0)-(b.losses||0)) - ((a.wins||0)-(a.losses||0)) || (b.pf||0)-(a.pf||0)
        : (b.pf||0) - (a.pf||0)
    );
    const _teamKey = tm => (tm.leagueName || "") + "|" + (tm.teamId || tm.rawTeamName || tm.teamName);

    const sortedTeams = _sortByMetric(allTeams,
      (mode === "h2h_bracket" || po.seeding?.method === "record") ? "record" : "pf");

    const _groupKey = (tm, scope) => {
      if (scope === "conference") return (tm.conference && tm.conference !== "") ? tm.conference : null;
      return (tm.division && tm.division !== "") ? tm.division : (tm.leagueName || "__none__");
    };
    const allDivisions   = [...new Set(allTeams.map(tm => _groupKey(tm, "division")).filter(Boolean))];
    const allConferences = [...new Set(allTeams.map(tm => _groupKey(tm, "conference")).filter(Boolean))];
    const numDivisions   = allDivisions.length || 1;
    const numConferences = allConferences.length || allDivisions.length || 1;

    const _runCompositeQual = (steps, pool) => {
      const qualified = new Set();
      let eligibleIndices = pool.map((_, i) => i);
      for (const step of steps) {
        if (step.type === "wins_threshold") {
          eligibleIndices = eligibleIndices.filter(i => (pool[i].wins||0) >= (step.minWins||13));
          continue;
        }
        const scope  = step.scope || "overall";
        const count  = step.type === "top_subgroup" ? (step.subCount||2) : (step.count||2);
        const metric = step.type === "top_record" ? "record"
          : step.type === "top_subgroup" ? (step.subMetric || "pf") : "pf";
        const candidates = eligibleIndices.filter(i => !qualified.has(i));
        if (scope === "overall") {
          const sorted = _sortByMetric(candidates.map(i => ({...pool[i], _idx:i})), metric);
          sorted.slice(0, count).forEach(tm => qualified.add(tm._idx));
        } else {
          const groups = {};
          candidates.forEach(i => {
            const g = _groupKey(pool[i], scope) || "__none__";
            if (!groups[g]) groups[g] = [];
            groups[g].push(i);
          });
          Object.values(groups).forEach(groupIndices => {
            let filtered = groupIndices;
            if (step.type === "top_subgroup") {
              filtered = groupIndices.filter(i => {
                const val = step.subField === "gender" ? pool[i].gender : pool[i][step.subField] || "";
                return String(val).toLowerCase() === String(step.subValue||"").toLowerCase();
              });
            }
            const sorted = _sortByMetric(filtered.map(i => ({...pool[i], _idx:i})), metric);
            sorted.slice(0, count).forEach(tm => qualified.add(tm._idx));
          });
        }
      }
      return [...qualified].map(i => pool[i]);
    };

    const _computeQualifiers = () => {
      const q = po.qualification || {};
      if (q.method === "manual")        return sortedTeams;
      if (q.method === "top_record")    return _sortByMetric(sortedTeams, "record").slice(0, q.count||8);
      if (q.method === "top_pf")        return _sortByMetric(sortedTeams, "pf").slice(0, q.count||8);
      if (q.method === "top_per_group") {
        const n = q.perGroup || 2;
        const groups = {};
        sortedTeams.forEach(tm => {
          const g = _groupKey(tm, "division") || "__all__";
          if (!groups[g]) groups[g] = [];
          groups[g].push(tm);
        });
        return Object.values(groups).flatMap(g => _sortByMetric(g, "pf").slice(0, n));
      }
      if (q.method === "composite") return _runCompositeQual(q.steps || [], sortedTeams);
      return sortedTeams; // total_points / unconfigured: all teams
    };

    const qualifiers = _computeQualifiers();
    const qualSet    = new Set(qualifiers.map(_teamKey));

    // Byes
    const byeType  = po.byes?.type  || "none";
    const byeScope = po.byes?.scope || "overall";
    const byeRaw   = byeType !== "none" ? (po.byes?.count || 0) : 0;
    const byeCount = byeRaw > 0
      ? (byeScope === "division"   ? byeRaw * numDivisions
       : byeScope === "conference" ? byeRaw * numConferences : byeRaw) : 0;
    const byeMetric  = (po.byes?.method || "record") === "record" ? "record" : "pf";
    const seededQ    = _sortByMetric([...qualifiers], byeMetric);
    const byeSet = (() => {
      if (!byeCount) return new Set();
      if (byeScope === "overall") return new Set(seededQ.slice(0, byeCount).map(_teamKey));
      const groups = {};
      seededQ.forEach(tm => {
        const g = _groupKey(tm, byeScope) || "__none__";
        if (!groups[g]) groups[g] = [];
        groups[g].push(tm);
      });
      const byeTeams = [];
      Object.values(groups).forEach(g => byeTeams.push(...g.slice(0, byeRaw)));
      return new Set(byeTeams.map(_teamKey));
    })();

    // Overall winner: #1 PF team for total_points; first qualifier for other modes
    const overallWinner = mode === "total_points"
      ? (_sortByMetric(allTeams, "pf")[0] || null)
      : (qualifiers[0] || null);

    return { qualSet, byeSet, allTeams, qualifiers, mode, overallWinner, _teamKey };
  }

  // ── _buildPoByYear: year → { sanitizedKey → {qualified,bye,rank,isTChamp} } ──
  //
  // PRIMARY: reads t.playoffs[year].finalRankings written by the publish button.
  //   finalRankings is the authoritative ordered list (rank 1 = overall champion)
  //   built from the full round simulation at publish time. No re-computation needed.
  //
  // FALLBACK: if finalRankings not yet written (year not yet published), derives
  //   qualification from _computeQualification(). Rank is PF-based only (approximate).
  //   Re-publish the Playoffs tab to get correct round-based rankings.

  function _buildPoByYear(t) {
    const _sk = (s) => String(s || "").trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_");
    const poByYear = {};

    for (const yr of _playoffYears(t)) {
      const po = _playoffForYear(t, yr);
      poByYear[String(yr)] = {};

      // ── Primary: finalRankings written at publish time ─────────────────────
      const fr = po.finalRankings;
      if (Array.isArray(fr) && fr.length) {
        fr.forEach(entry => {
          [entry.displayName, entry.teamName].filter(Boolean).map(_sk).forEach(k => {
            if (!poByYear[String(yr)][k]) {
              poByYear[String(yr)][k] = {
                qualified: !!(entry.qualified),
                bye:       !!(entry.bye),
                rank:      entry.finalRank || null,
                isTChamp:  !!(entry.isTChamp),
                leagueId:  String(entry.leagueId || ""),
                teamId:    String(entry.teamId   || "")
              };
            }
          });
        });
        continue; // done for this year — authoritative data used
      }

      // ── Fallback: derive from qual engine (no round scores, PF-based rank) ─
      const { qualSet, byeSet, allTeams, overallWinner, _teamKey } =
        _computeQualification(t, yr);
      if (!allTeams.length) continue;

      const sorted = [...allTeams].sort((a, b) => (b.pf||0) - (a.pf||0));
      sorted.forEach((tm, idx) => {
        const isQual   = qualSet.has(_teamKey(tm));
        const isBye    = byeSet.has(_teamKey(tm));
        const isTChamp = overallWinner ? (_teamKey(tm) === _teamKey(overallWinner)) : (isQual && idx === 0);
        [tm.displayName, tm.teamName, tm.sleeperUsername].filter(Boolean).map(_sk).forEach(k => {
          if (!poByYear[String(yr)][k]) {
            poByYear[String(yr)][k] = {
              qualified: isQual, bye: isBye, rank: idx + 1, isTChamp,
              leagueId: String(tm.leagueId || ""), teamId: String(tm.teamId || "")
            };
          }
        });
      });

      // Fold in lc.champion entries (league champs not already in the map)
      Object.values(t.standingsCache || {}).forEach(lc => {
        if (String(lc.year) !== String(yr)) return;
        const champ = lc.champion;
        if (!champ) return;
        [champ.teamName, champ.sleeperUsername, champ.displayName].filter(Boolean).map(_sk).forEach(k => {
          if (!poByYear[String(yr)][k]) {
            poByYear[String(yr)][k] = {
              qualified: true, bye: false, rank: null, isTChamp: false,
              leagueId: String(lc.leagueId || lc.league_id || ""),
              teamId:   String(champ.teamId || "")
            };
          }
        });
      });
    }
    return poByYear;
  }

  // ── ANALYTICS: Playoff Appearance Rate ──────────────────────────────────────
  // Cross-year leaderboard. For each participant who has played ≥1 season, shows:
  // seasons played, playoff appearances, appearance rate %, best finish rank,
  // streak (consecutive seasons qualified), total championships.
  // Sorted: appearance rate desc, then seasons desc.
  // Data: standingsCache (seasons) + t.playoffs (qualification). No network calls.

  function _renderAnalyticsPORate(tid, t, body) {
    const _sk    = (s) => String(s || "").trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_");
    const cache  = t.standingsCache || {};
    const parts  = t.participants   || {};
    const poByYear = _buildPoByYear(t);

    // Build participant lookup
    const pLookup = {};
    Object.values(parts).forEach(p => {
      [p.sleeperUsername, p.displayName, p.teamName].filter(Boolean).map(_sk)
        .forEach(k => { pLookup[k] = p; });
    });

    // Build all-time seasons per participant
    const careers = {};
    for (const lc of Object.values(cache)) {
      const year = String(lc.year || "Unknown");
      for (const tm of (lc.teams || [])) {
        let part = null;
        if (tm.sleeperUsername) part = pLookup[_sk(tm.sleeperUsername)];
        if (!part && tm.teamName) part = pLookup[_sk(tm.teamName)];
        const displayName = part?.displayName || tm.teamName || "Unknown";
        const ck = _sk(displayName);
        if (!careers[ck]) careers[ck] = { displayName, gender: part?.gender || "", seasons: new Set(), yearData: {} };
        careers[ck].seasons.add(year);
        if (!careers[ck].yearData[year]) careers[ck].yearData[year] = { qualified: false, bye: false, rank: null, isTChamp: false };
      }
    }

    // Join playoff data
    for (const [yr, entries] of Object.entries(poByYear)) {
      for (const [k, entry] of Object.entries(entries)) {
        if (careers[k]) {
          careers[k].seasons.add(yr);
          if (!careers[k].yearData[yr]) careers[k].yearData[yr] = { qualified: false, bye: false, rank: null, isTChamp: false };
          Object.assign(careers[k].yearData[yr], entry);
        }
      }
    }

    // Compute stats
    const rows = Object.values(careers).map(c => {
      const allYears   = [...c.seasons].sort((a, b) => b - a);
      const poApps     = allYears.filter(yr => c.yearData[yr]?.qualified).length;
      const tChamps    = allYears.filter(yr => c.yearData[yr]?.isTChamp).length;
      const bestRank   = allYears.reduce((best, yr) => {
        const r = c.yearData[yr]?.rank;
        return (r && (!best || r < best)) ? r : best;
      }, null);
      const rate = allYears.length > 0 ? (poApps / allYears.length * 100).toFixed(0) : 0;

      // Streak: count consecutive most-recent seasons with qualification
      let streak = 0;
      for (const yr of allYears) {
        if (c.yearData[yr]?.qualified) streak++;
        else break;
      }

      return { ...c, allYears, totalSeasons: allYears.length, poApps, tChamps, bestRank, rate: parseInt(rate), streak };
    }).filter(r => r.totalSeasons > 0);

    rows.sort((a, b) => {
      if (b.rate !== a.rate) return b.rate - a.rate;
      // Secondary: best finish (lower rank number = better)
      if (a.bestRank !== b.bestRank) {
        if (a.bestRank === null) return 1;
        if (b.bestRank === null) return -1;
        return a.bestRank - b.bestRank;
      }
      return b.totalSeasons - a.totalSeasons;
    });

    if (!rows.length) {
      body.innerHTML = `<div class="trn-empty"><div class="trn-empty-icon">📈</div><div class="trn-empty-title">No data yet</div><div class="trn-empty-sub">Sync standings and publish playoffs to see appearance rates.</div></div>`;
      return;
    }

    const allYearsSet = [...new Set(Object.values(cache).map(lc => lc.year).filter(Boolean))].sort((a, b) => b - a);
    const hasPoData   = Object.keys(poByYear).length > 0;

    const tableRows = rows.map((r, i) => {
      const medal     = ["🥇","🥈","🥉"][i] || "";
      const gBadge    = r.gender === "Male" ? `<span class="trn-gender-m" style="font-size:.65rem">M</span>`
        : r.gender === "Female" ? `<span class="trn-gender-f" style="font-size:.65rem">F</span>` : "";
      const rateColor = r.rate >= 80 ? "#4ade80" : r.rate >= 50 ? "#fbbf24" : "var(--color-text-dim)";
      const streakBadge = r.streak >= 2
        ? `<span class="trn-az-streak-badge">🔥 ${r.streak}</span>` : "";
      const champCell = r.tChamps > 0
        ? `<span class="trn-ph-champ-badge">🏆×${r.tChamps}</span>` : `<span style="color:var(--color-text-dim)">—</span>`;
      const yearPips = allYearsSet.map(yr => {
        const e = r.yearData[yr];
        const cls = !e ? "trn-az-yr-pip--absent"
          : e.isTChamp ? "trn-az-yr-pip--champ"
          : e.qualified ? "trn-az-yr-pip--qual"
          : "trn-az-yr-pip--elim";
        const tip = !e ? `${yr}: did not play`
          : e.isTChamp ? `${yr}: 🏆 Champion`
          : e.qualified ? `${yr}: ✓ Qualified${e.bye ? " (BYE)" : ""}`
          : `${yr}: Eliminated`;
        return `<span class="trn-az-yr-pip ${cls}" title="${tip}"></span>`;
      }).join("");

      return `<tr>
        <td class="trn-ph-col-rank" style="font-size:.8rem">${medal || i + 1}</td>
        <td class="trn-ph-col-name">${_esc(r.displayName)} ${gBadge} ${streakBadge}</td>
        <td class="trn-az-num-cell">${r.totalSeasons}</td>
        <td class="trn-az-num-cell" style="color:${rateColor};font-weight:700">${hasPoData ? r.rate + "%" : "—"}</td>
        <td class="trn-az-num-cell">${hasPoData ? `${r.poApps}/${r.totalSeasons}` : "—"}</td>
        <td class="trn-az-num-cell">${r.bestRank ?? "—"}</td>
        <td>${champCell}</td>
        <td class="trn-az-pips-cell">${yearPips}</td>
      </tr>`;
    }).join("");

    const poNote = !hasPoData
      ? `<div class="trn-xplat-banner" style="margin-bottom:var(--space-3)"><span class="trn-xplat-banner-icon">ℹ️</span><div class="trn-xplat-banner-body"><div class="trn-xplat-banner-title">Playoff data not published</div><div class="trn-xplat-banner-items" style="list-style:none;padding:0">Publish playoffs from the admin Playoffs tab to see qualification rates. Seasons played column is based on standings sync only.</div></div></div>` : "";

    body.innerHTML = `
      ${poNote}
      <div class="trn-az-meta">${rows.length} participant${rows.length !== 1 ? "s" : ""} · ${allYearsSet.length} season${allYearsSet.length !== 1 ? "s" : ""}${hasPoData ? " · " + Object.keys(poByYear).length + " with playoff data" : ""}</div>
      <div class="trn-az-legend">
        <span class="trn-az-yr-pip trn-az-yr-pip--champ"></span> Champion
        <span class="trn-az-yr-pip trn-az-yr-pip--qual"></span> Qualified
        <span class="trn-az-yr-pip trn-az-yr-pip--elim"></span> Eliminated
        <span class="trn-az-yr-pip trn-az-yr-pip--absent"></span> Did not play
        &nbsp;🔥 = active qual. streak
      </div>
      <div style="overflow-x:auto">
        <table class="trn-ph-list-table trn-az-stat-table">
          <thead><tr>
            <th class="trn-ph-col-rank">#</th>
            <th class="trn-ph-col-name">Player</th>
            <th class="trn-az-num-cell trn-ph-th-tip" title="Seasons played">Yrs</th>
            <th class="trn-az-num-cell trn-ph-th-tip" title="Playoff appearance rate">Rate</th>
            <th class="trn-az-num-cell trn-ph-th-tip" title="Appearances / Seasons">Apps</th>
            <th class="trn-az-num-cell trn-ph-th-tip" title="Best playoff seeding rank">Best</th>
            <th class="trn-ph-th-tip" title="Tournament championships">🏆</th>
            <th class="trn-az-pips-cell trn-ph-th-tip" title="Year-by-year history">${allYearsSet.map(y => `<span style="font-size:.65rem;font-weight:600">${String(y).slice(2)}</span>`).join("")}</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
  }

  // ── ANALYTICS: Most Rostered on Playoff Teams ────────────────────────────────
  // For a given year: among all teams that qualified for playoffs, what players
  // appeared on the most of their rosters?
  // Data: t.playoffs[year].standings (qualified teams) + Sleeper /rosters endpoint.
  // Reuses _rostersCache if already fetched for the same year; otherwise fetches fresh.
  // Filterable by position.

  let _mrCache = null; // { data:{pos:{players:[]}}, year, tid, fetchedAt }
  let _mrPos   = "all";

  async function _renderAnalyticsMostRostered(tid, t, body) {
    await DLRPlayers.load().catch(() => {});
    const year     = _tournamentYear || new Date().getFullYear();
    const poByYear = _buildPoByYear(t);
    const poYr     = poByYear[String(year)] || {};

    // Identify playoff-qualified teams this year from standingsCache
    const _sk     = (s) => String(s || "").trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_");
    const scEntries = Object.values(t.standingsCache || {}).filter(lc => lc.year === year);

    // Build set of qualified {leagueId, teamId} pairs
    const qualPairs = []; // { leagueId, teamId, teamName, platform }
    scEntries.forEach(lc => {
      const lid = String(lc.leagueId || lc.league_id || "");
      (lc.teams || []).forEach(tm => {
        const cKey = _sk(tm.teamName || "");
        const byUsername = tm.sleeperUsername ? poYr[_sk(tm.sleeperUsername)] : null;
        const byName     = poYr[cKey];
        const entry      = byUsername || byName;
        if (entry?.qualified) {
          qualPairs.push({ leagueId: lid, teamId: String(tm.teamId), teamName: tm.teamName, platform: lc.platform || "sleeper" });
        }
      });
    });

    if (!qualPairs.length) {
      body.innerHTML = `<div class="trn-empty"><div class="trn-empty-icon">🏈</div><div class="trn-empty-title">No playoff teams found for ${year}</div><div class="trn-empty-sub">Publish playoffs from the admin Playoffs tab first. Make sure standings are synced for ${year}.</div></div>`;
      return;
    }

    body.innerHTML = `<div class="trn-az-loading"><div class="spinner"></div> Fetching playoff rosters…</div>`;

    // Check cache
    if (_mrCache && _mrCache.tid === tid && _mrCache.year === year && (Date.now() - _mrCache.fetchedAt) < 300000) {
      _renderMostRosteredView(body, _mrCache.data, qualPairs.length, year);
      return;
    }

    try {
      // Group qual pairs by leagueId — fetch each league's roster once
      const byLeague = {};
      qualPairs.forEach(p => {
        if (!byLeague[p.leagueId]) byLeague[p.leagueId] = [];
        byLeague[p.leagueId].push(p);
      });

      // player occurrence map: playerId → { name, position, nflTeam, count, teamNames[] }
      const playerMap = {};

      await Promise.allSettled(Object.entries(byLeague).map(async ([lid, teams]) => {
        const platform = teams[0]?.platform || "sleeper";
        try {
          let playerIds_by_teamId = {}; // teamId → [playerId, ...]

          if (platform === "sleeper") {
            const rosters = await fetch(`https://api.sleeper.app/v1/league/${lid}/rosters`).then(r => r.ok ? r.json() : []);
            (rosters || []).forEach(r => {
              playerIds_by_teamId[String(r.roster_id)] = [...new Set([...(r.starters||[]), ...(r.players||[])])];
            });
          } else if (platform === "mfl") {
            const mflCreds = _getMFLCreds();
            if (!mflCreds?.cookie) return; // skip — not authenticated
            const year = teams[0]?.year || _tournamentYear || new Date().getFullYear();
            const resp = await fetch("https://mfl-proxy.mraladdin23.workers.dev/tournament/rosters", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ leagueId: lid, platform: "mfl", year, mflCookie: mflCreds.cookie })
            });
            if (!resp.ok) return;
            const data = await resp.json();
            // Worker returns { rosters: [{teamId, playerIds:[]}] }
            (data.rosters || []).forEach(r => {
              playerIds_by_teamId[String(r.teamId)] = r.playerIds || [];
            });
          } else if (platform === "yahoo") {
            const yahooToken = localStorage.getItem("dlr_yahoo_access_token");
            if (!yahooToken) return; // skip — not authenticated
            const year = teams[0]?.year || _tournamentYear || new Date().getFullYear();
            const resp = await fetch("https://mfl-proxy.mraladdin23.workers.dev/tournament/rosters", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ leagueId: lid, platform: "yahoo", year, yahooToken })
            });
            if (!resp.ok) return;
            const data = await resp.json();
            (data.rosters || []).forEach(r => {
              playerIds_by_teamId[String(r.teamId)] = r.playerIds || [];
            });
          }

          teams.forEach(tm => {
            const pids = playerIds_by_teamId[String(tm.teamId)] || [];
            pids.forEach(pid => {
              if (!pid || pid === "0") return;
              // For Sleeper use DLRPlayers.get; for MFL/Yahoo try both
              let dp = typeof DLRPlayers !== "undefined" ? DLRPlayers.get(String(pid)) : null;
              if (!dp?.first_name && platform === "yahoo") {
                const map = typeof DLRPlayers !== "undefined" ? DLRPlayers.getByYahooId(String(pid)) : null;
                if (map?.sleeper_id) dp = DLRPlayers.get(map.sleeper_id);
              }
              if (!dp?.first_name) return;
              if (!playerMap[pid]) {
                playerMap[pid] = {
                  pid, count: 0, teamNames: [],
                  name:     `${dp.first_name} ${dp.last_name}`.trim(),
                  position: (dp.position || "?").toUpperCase(),
                  nflTeam:  dp.team || "FA"
                };
              }
              playerMap[pid].count++;
              playerMap[pid].teamNames.push(tm.teamName || tm.teamId);
            });
          });
        } catch(e) { console.warn("[MostRostered]", platform, lid, e.message); }
      }));

      // Group by position, sort by count desc
      const byPos = {};
      Object.values(playerMap).forEach(p => {
        if (!byPos[p.position]) byPos[p.position] = [];
        byPos[p.position].push(p);
      });
      Object.values(byPos).forEach(arr => arr.sort((a, b) => b.count - a.count));

      // Also build flat "all" list
      const allPlayers = Object.values(playerMap).sort((a, b) => b.count - a.count);
      const data = { all: allPlayers, ...byPos };

      _mrCache = { data, year, tid, fetchedAt: Date.now() };
      _renderMostRosteredView(body, data, qualPairs.length, year);
    } catch(e) {
      body.innerHTML = `<div class="trn-empty">Failed to load rosters: ${_esc(e.message)}</div>`;
    }
  }

  function _renderMostRosteredView(body, data, qualCount, year) {
    const positions  = ["all", ...Object.keys(data).filter(k => k !== "all").sort()];
    const posOpts    = positions.map(p =>
      `<option value="${_esc(p)}" ${_mrPos === p ? "selected" : ""}>${p === "all" ? "All Positions" : _esc(p)}</option>`
    ).join("");

    const players    = (data[_mrPos] || data["all"] || []).slice(0, 50);
    const maxCount   = players[0]?.count || 1;

    const rows = players.map((p, i) => {
      const col      = POS_COLOR[p.position] || "#9ca3af";
      const pct      = Math.round(p.count / qualCount * 100);
      const barW     = Math.round(p.count / maxCount * 100);
      const teamList = [...new Set(p.teamNames)].slice(0, 6).map(n => `<span class="trn-az-team-chip">${_esc(n)}</span>`).join("");
      return `
        <tr>
          <td class="trn-ph-col-rank" style="font-size:.8rem">${i + 1}</td>
          <td style="padding:8px">
            <div style="display:flex;align-items:center;gap:6px">
              <span class="draft-pos-badge" style="background:${col}22;color:${col};border-color:${col}55;font-size:.65rem;padding:1px 5px;border-radius:4px;border:1px solid;flex-shrink:0">${_esc(p.position)}</span>
              <span style="font-weight:600;font-size:.88rem">${_esc(p.name)}</span>
              <span style="font-size:.72rem;color:var(--color-text-dim)">${_esc(p.nflTeam)}</span>
            </div>
            <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px">${teamList}</div>
          </td>
          <td class="trn-az-num-cell" style="font-weight:700">${p.count}</td>
          <td class="trn-az-num-cell" style="color:var(--color-text-dim)">${pct}%</td>
          <td style="padding:8px;min-width:80px">
            <div class="trn-az-bar-wrap">
              <div class="trn-az-bar" style="width:${barW}%;background:${col}88"></div>
            </div>
          </td>
        </tr>`;
    }).join("");

    const nonSleeper = qualCount === 0;

    body.innerHTML = `
      <div class="trn-az-toolbar">
        <select id="trn-mr-pos" style="padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);color:var(--color-text);font-size:.85rem">${posOpts}</select>
        <button class="btn-secondary btn-sm" id="trn-mr-refresh">↺ Refresh</button>
      </div>
      <div class="trn-az-meta">${qualCount} playoff team${qualCount !== 1 ? "s" : ""} · ${year} season · top ${players.length} players shown · MFL requires cookie, Yahoo requires token</div>
      ${players.length ? `
        <div style="overflow-x:auto">
          <table class="trn-ph-list-table trn-az-stat-table">
            <thead><tr>
              <th class="trn-ph-col-rank">#</th>
              <th>Player</th>
              <th class="trn-az-num-cell trn-ph-th-tip" title="Number of playoff teams rostering this player">Teams</th>
              <th class="trn-az-num-cell trn-ph-th-tip" title="% of playoff teams">%</th>
              <th class="trn-ph-th-tip" title="Ownership bar">Ownership</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>` : `<div class="trn-empty"><div class="trn-empty-icon">🤷</div><div class="trn-empty-title">No roster data for this position</div></div>`}`;

    document.getElementById("trn-mr-pos")?.addEventListener("change", function() {
      _mrPos = this.value;
      _renderMostRosteredView(body, _mrCache?.data || data, qualCount, year);
    });
    document.getElementById("trn-mr-refresh")?.addEventListener("click", () => {
      _mrCache = null;
      _renderAnalyticsMostRostered(_activeTournamentId, _tournaments[_activeTournamentId], body);
    });
  }

  // ── ANALYTICS: ADP vs Finish ─────────────────────────────────────────────────
  // For each drafted player, compare their draft ADP (from _draftCache) against
  // how the team that drafted them finished in the regular season standings.
  // Groups players into buckets: drafted by playoff teams vs eliminated teams.
  // Highlights players who were heavily concentrated on one side.
  // Requires draft data — prompts to load it if not available.

  let _avfPos  = "all";
  let _avfView = "po"; // "po" = sorted by playoff-team ownership%, "elim" = by elim-team%, "diff" = by swing

  async function _renderAnalyticsADPvFinish(tid, t, body) {
    await DLRPlayers.load().catch(() => {});

    if (!_draftCache || _draftCache.tid !== tid) {
      body.innerHTML = `
        <div class="trn-empty">
          <div class="trn-empty-icon">🎯</div>
          <div class="trn-empty-title">Draft data not loaded</div>
          <div class="trn-empty-sub">Load the Draft tab first to fetch pick data, then return here.</div>
          <button class="btn-secondary btn-sm" id="trn-avf-load-draft" style="margin-top:var(--space-4)">Load Draft Data</button>
        </div>`;
      document.getElementById("trn-avf-load-draft")?.addEventListener("click", async () => {
        body.innerHTML = `<div class="trn-az-loading"><div class="spinner"></div> Loading draft data…</div>`;
        await _renderAnalyticsDraft(tid, t, { innerHTML: "" }); // warm the cache silently
        _renderAnalyticsADPvFinish(tid, t, body);
      });
      return;
    }

    const year     = _tournamentYear || new Date().getFullYear();
    const _sk      = (s) => String(s || "").trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_");
    const poByYear = _buildPoByYear(t);
    const poYr     = poByYear[String(year)] || {};
    const hasPoData = Object.keys(poYr).length > 0;

    // Build participant displayName lookup for draft pick teamName resolution
    const pLookup = {};
    Object.values(t.participants || {}).forEach(p => {
      [p.sleeperUsername, p.displayName, p.teamName].filter(Boolean).map(_sk)
        .forEach(k => { pLookup[k] = p; });
    });

    // Build a direct lookup: sanitized key → qualified boolean.
    // Draft picks have teamName = participant displayName (set during draft normalization
    // at line ~5058: if (pMap[key]) teamName = pMap[key].displayName).
    // poYr is already keyed by sanitized displayName/teamName/sleeperUsername from
    // _buildPoByYear, so we can look up pk.teamName directly in poYr.
    // We also cross-reference standingsCache to catch cases where the pick teamName
    // is the raw standingsCache teamName rather than the resolved displayName.
    const teamQualMap = {}; // sanitized key → true/false, covers all key variants

    // Populate from poYr directly — every key that exists in poYr gets its qual status
    Object.entries(poYr).forEach(([k, entry]) => {
      teamQualMap[k] = !!(entry?.qualified);
    });

    // Also map raw standingsCache teamNames → same qual status via sleeperUsername bridge
    const scEntries = Object.values(t.standingsCache || {}).filter(lc => String(lc.year) === String(year));
    scEntries.forEach(lc => {
      (lc.teams || []).forEach(tm => {
        if (teamQualMap[_sk(tm.teamName || "")] !== undefined) return; // already mapped
        // Try to find this team's qual status via sleeperUsername or displayName
        const tryKeys = [
          tm.sleeperUsername,
          tm.teamName,
          pLookup[_sk(tm.sleeperUsername || "")]?.displayName,
          pLookup[_sk(tm.teamName        || "")]?.displayName
        ].filter(Boolean);
        const entry = tryKeys.reduce((found, k) => found !== undefined ? found : teamQualMap[_sk(k)], undefined);
        if (tm.teamName) teamQualMap[_sk(tm.teamName)] = !!(entry);
      });
    });

    // Walk draft picks — for each player tally: poTeamPicks, elimTeamPicks, adpSum, count
    const picks = _draftCache.picks.filter(p => !p.cost); // exclude auction (cost-based) picks
    const playerData = {}; // playerId → { name, position, nflTeam, adp, poCount, elimCount, overalls[] }

    picks.forEach(pk => {
      const pid = pk.playerId || pk.name;
      if (!pid) return;
      const isQual = teamQualMap[_sk(pk.teamName || "")] ?? false;

      if (!playerData[pid]) {
        playerData[pid] = { pid, name: pk.name, position: pk.position, nflTeam: pk.nflTeam || "FA", poCount: 0, elimCount: 0, overalls: [] };
      }
      if (isQual) playerData[pid].poCount++;
      else        playerData[pid].elimCount++;
      playerData[pid].overalls.push(pk.overall || 999);
    });

    // Compute ADP and swing score for each player
    const adp = _draftCache.adp; // pre-computed adp array [{playerId, adp, name, position}]
    const adpMap = {};
    adp.forEach(a => { adpMap[String(a.playerId)] = a.adp; });

    const totalPoTeams   = new Set(picks.filter(pk => teamQualMap[_sk(pk.teamName || "")]).map(pk => pk.teamId)).size;
    const totalElimTeams = new Set(picks.filter(pk => !teamQualMap[_sk(pk.teamName || "")]).map(pk => pk.teamId)).size;

    const allRows = Object.values(playerData).map(p => {
      const playerAdp = adpMap[String(p.pid)] || (p.overalls.reduce((s, v) => s + v, 0) / (p.overalls.length || 1));
      const poPct     = totalPoTeams   > 0 ? +(p.poCount   / totalPoTeams   * 100).toFixed(1) : 0;
      const elimPct   = totalElimTeams > 0 ? +(p.elimCount / totalElimTeams * 100).toFixed(1) : 0;
      const swing     = poPct - elimPct; // positive = PO teams preferred, negative = elim teams preferred
      return { ...p, adp: +playerAdp.toFixed(1), poPct, elimPct, swing, total: p.poCount + p.elimCount };
    }).filter(p => p.total >= 2); // need ≥2 picks to be meaningful

    if (!allRows.length) {
      body.innerHTML = `<div class="trn-empty"><div class="trn-empty-icon">🎯</div><div class="trn-empty-title">Not enough data</div><div class="trn-empty-sub">Need draft picks for ${year} and published playoff standings to compute ADP vs Finish.</div></div>`;
      return;
    }

    const positions  = ["all", ...new Set(allRows.map(p => p.position).filter(Boolean)).values()].sort((a, b) => a === "all" ? -1 : b === "all" ? 1 : a.localeCompare(b));
    const posOpts    = positions.map(p =>
      `<option value="${_esc(p)}" ${_avfPos === p ? "selected" : ""}>${p === "all" ? "All Positions" : _esc(p)}</option>`
    ).join("");

    const viewPills = [
      { v: "po",   label: "🏆 PO-Heavy" },
      { v: "elim", label: "💀 Elim-Heavy" },
      { v: "diff", label: "📊 By Swing" },
    ].map(x =>
      `<button class="trn-az-pill${_avfView === x.v ? " active" : ""}" data-avf-view="${x.v}">${x.label}</button>`
    ).join("");

    // Filter and sort
    const filtered = (_avfPos === "all" ? allRows : allRows.filter(p => p.position === _avfPos))
      .sort((a, b) => _avfView === "po" ? b.poPct - a.poPct : _avfView === "elim" ? b.elimPct - a.elimPct : b.swing - a.swing)
      .slice(0, 40);

    const tableRows = filtered.map((p, i) => {
      const col       = POS_COLOR[p.position] || "#9ca3af";
      const swingColor = p.swing > 15 ? "#4ade80" : p.swing < -15 ? "#f87171" : "var(--color-text-dim)";
      const swingStr  = (p.swing >= 0 ? "+" : "") + p.swing.toFixed(1) + "%";
      const poBar     = Math.round(p.poPct);
      const elimBar   = Math.round(p.elimPct);
      return `
        <tr>
          <td class="trn-ph-col-rank" style="font-size:.8rem">${i + 1}</td>
          <td style="padding:8px">
            <div style="display:flex;align-items:center;gap:6px">
              <span class="draft-pos-badge" style="background:${col}22;color:${col};border-color:${col}55;font-size:.65rem;padding:1px 5px;border-radius:4px;border:1px solid;flex-shrink:0">${_esc(p.position)}</span>
              <span style="font-weight:600;font-size:.88rem">${_esc(p.name)}</span>
              <span style="font-size:.72rem;color:var(--color-text-dim)">${_esc(p.nflTeam)}</span>
            </div>
          </td>
          <td class="trn-az-num-cell trn-ph-th-tip" title="Average draft position">${p.adp}</td>
          <td class="trn-az-num-cell" style="color:#4ade80">${p.poPct}%</td>
          <td class="trn-az-num-cell" style="color:#f87171">${p.elimPct}%</td>
          <td class="trn-az-num-cell" style="color:${swingColor};font-weight:700">${swingStr}</td>
          <td style="padding:6px 8px;min-width:80px">
            <div class="trn-az-split-bar-wrap">
              <div class="trn-az-split-bar-po"   style="width:${poBar}%"></div>
              <div class="trn-az-split-bar-elim" style="width:${elimBar}%"></div>
            </div>
          </td>
        </tr>`;
    }).join("");

    const noPoNote = !hasPoData
      ? `<div class="trn-xplat-banner" style="margin-bottom:var(--space-3)"><span class="trn-xplat-banner-icon">ℹ️</span><div class="trn-xplat-banner-body"><div class="trn-xplat-banner-title">No playoff data</div><div class="trn-xplat-banner-items" style="list-style:none;padding:0">Publish playoffs to split picks into playoff vs eliminated teams. All picks are treated as "eliminated" without this data.</div></div></div>` : "";

    body.innerHTML = `
      ${noPoNote}
      <div class="trn-az-toolbar">
        <div style="display:flex;gap:var(--space-2);flex-wrap:wrap;align-items:center">
          <select id="trn-avf-pos" style="padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius-md);background:var(--color-surface);color:var(--color-text);font-size:.85rem">${posOpts}</select>
          <div class="trn-az-view-pills">${viewPills}</div>
        </div>
      </div>
      <div class="trn-az-meta">${allRows.length} players drafted · ${totalPoTeams} playoff teams · ${totalElimTeams} eliminated teams · ${year}</div>
      <div style="font-size:.75rem;color:var(--color-text-dim);margin-bottom:var(--space-3)">
        <span style="color:#4ade80">●</span> PO% = % of playoff teams that rostered this player &nbsp;
        <span style="color:#f87171">●</span> Elim% = % of eliminated teams &nbsp;
        Swing = PO% − Elim% (positive = playoff teams preferred)
      </div>
      ${filtered.length ? `
        <div style="overflow-x:auto">
          <table class="trn-ph-list-table trn-az-stat-table">
            <thead><tr>
              <th class="trn-ph-col-rank">#</th>
              <th>Player</th>
              <th class="trn-az-num-cell trn-ph-th-tip" title="Average draft position">ADP</th>
              <th class="trn-az-num-cell trn-ph-th-tip" title="% of playoff teams that drafted this player" style="color:#4ade80">PO%</th>
              <th class="trn-az-num-cell trn-ph-th-tip" title="% of eliminated teams that drafted this player" style="color:#f87171">Elim%</th>
              <th class="trn-az-num-cell trn-ph-th-tip" title="PO% minus Elim% — positive means playoff teams preferred this player">Swing</th>
              <th class="trn-ph-th-tip" title="PO (green) vs Elim (red) ownership split">Split</th>
            </tr></thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>` : `<div class="trn-empty"><div class="trn-empty-icon">🤷</div><div class="trn-empty-title">No players for this position filter</div></div>`}`;

    document.getElementById("trn-avf-pos")?.addEventListener("change", function() {
      _avfPos = this.value;
      _renderAnalyticsADPvFinish(tid, t, body);
    });
    body.querySelectorAll("[data-avf-view]").forEach(btn => {
      btn.addEventListener("click", function() {
        _avfView = this.dataset.avfView;
        _renderAnalyticsADPvFinish(tid, t, body);
      });
    });
  }
  // Shared between admin and user modes. Year-agnostic: shows career across ALL
  // years regardless of _tournamentYear. Reads entirely from t.standingsCache
  // and t.participants — no Firebase calls needed.
  //
  // Matching priority: sleeperUsername (stable across name changes) → teamName
  // Both internal app and public site call the same data shape; the public site
  // re-implements a parallel version using _currentT instead of t.

  let _phSearch = ""; // persists within a session
  let _phPage   = 1;

  function _renderPlayersTab(tid, t, body) {
    const _sk    = (s) => String(s || "").trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_");
    const cache  = t.standingsCache  || {};
    const parts  = t.participants    || {};

    // ── Participant lookup ───────────────────────────────────
    const pLookup = {};
    Object.values(parts).forEach(p => {
      [p.sleeperUsername, p.displayName, p.teamName].filter(Boolean).map(_sk)
        .forEach(k => { pLookup[k] = p; });
    });
    const _findPart = (tm) => {
      if (tm.sleeperUsername) { const p = pLookup[_sk(tm.sleeperUsername)]; if (p) return p; }
      if (tm.teamName)        { const p = pLookup[_sk(tm.teamName)];        if (p) return p; }
      return null;
    };

    // ── Build careers from standingsCache ────────────────────
    const careers = {};
    for (const lc of Object.values(cache)) {
      const year   = String(lc.year || "Unknown");
      const lgName = lc.leagueName || "Unknown League";
      const champKey = lc.champion
        ? (_sk(lc.champion.sleeperUsername || "") || _sk(lc.champion.teamName || "")) : null;

      for (const tm of (lc.teams || [])) {
        const part        = _findPart(tm);
        const displayName = part?.displayName || tm.teamName || "Unknown";
        const ck          = _sk(displayName);
        if (!careers[ck]) {
          careers[ck] = { displayName, gender: part?.gender || "", twitter: part?.twitterHandle || "", seasons: {} };
        }
        if (!careers[ck].seasons[year]) careers[ck].seasons[year] = [];
        const isChamp = !!(champKey && (
          (tm.sleeperUsername && _sk(tm.sleeperUsername) === champKey) ||
          (tm.teamName        && _sk(tm.teamName)        === champKey)
        ));
        careers[ck].seasons[year].push({
          leagueName: lgName, teamName: tm.teamName || displayName,
          wins: tm.wins || 0, losses: tm.losses || 0, ties: tm.ties || 0,
          pf: tm.pf || 0, isChamp, platform: lc.platform || "sleeper"
        });
      }
    }

    // ── Playoff data via shared helper (_buildPoByYear) ──────
    // Uses finalRankings if published, otherwise qual-engine fallback.
    const poByYear  = _buildPoByYear(t);
    const hasPoData = Object.keys(poByYear).length > 0;

    // All years across standings + playoff data, newest first — all normalized to strings
    const allYearsSet = [...new Set([
      ...Object.values(cache).map(lc => lc.year).filter(Boolean).map(String),
      ...Object.keys(poByYear)
    ])].sort((a, b) => String(b).localeCompare(String(a)));

    // ── Aggregate career stats ───────────────────────────────
    const playerList = Object.values(careers).map(c => {
      const yearKeys = Object.keys(c.seasons).map(String).sort((a, b) => String(b).localeCompare(String(a)));
      const cKey = _sk(c.displayName);
      let totalLeagues = 0, totalWins = 0, totalLosses = 0, totalPF = 0, totalChamps = 0;
      let playoffApps = 0, tournamentChamps = 0, bestRank = null;
      const yearData = {};

      yearKeys.forEach(yr => {
        c.seasons[yr].forEach(s => {
          totalLeagues++; totalWins += s.wins; totalLosses += s.losses; totalPF += s.pf;
          if (s.isChamp) totalChamps++;
        });
        const poEntry = (poByYear[String(yr)] || {})[cKey];
        yearData[yr] = poEntry || { qualified: false, bye: false, rank: null, isTChamp: false };
        if (poEntry?.qualified)  playoffApps++;
        if (poEntry?.isTChamp)   tournamentChamps++;
        if (poEntry?.rank && (!bestRank || poEntry.rank < bestRank)) bestRank = poEntry.rank;
      });

      // Streak: consecutive most-recent seasons qualified
      let streak = 0;
      for (const yr of yearKeys) {
        if (yearData[yr]?.qualified) streak++;
        else break;
      }

      const winPct = (totalWins + totalLosses) > 0
        ? (totalWins / (totalWins + totalLosses) * 100).toFixed(1) : null;

      return { ...c, yearKeys, yearData,
        totalYears: yearKeys.length, totalLeagues,
        totalWins, totalLosses, totalPF, totalChamps,
        playoffApps, tournamentChamps, bestRank, winPct, streak };
    });

    // ── Sort: tourn champs → years desc → bestRank asc → winPct desc ─────
    playerList.sort((a, b) => {
      if (b.tournamentChamps !== a.tournamentChamps) return b.tournamentChamps - a.tournamentChamps;
      if (b.totalYears !== a.totalYears) return b.totalYears - a.totalYears;
      if (a.bestRank !== b.bestRank) {
        if (a.bestRank === null) return 1;
        if (b.bestRank === null) return -1;
        return a.bestRank - b.bestRank;
      }
      return (parseFloat(b.winPct) || 0) - (parseFloat(a.winPct) || 0);
    });

    if (!playerList.length) {
      body.innerHTML = `
        <div class="trn-empty">
          <div class="trn-empty-icon">👥</div>
          <div class="trn-empty-title">No player history yet</div>
          <div class="trn-empty-sub">Sync standings to populate participant career data.</div>
        </div>`;
      return;
    }

    const PH_PAGE_SIZE = 25;

    // ── Build list row HTML ──────────────────────────────────
    const _renderList = (q, pg) => {
      const filtered = q
        ? playerList.filter(p => p.displayName.toLowerCase().includes(q.toLowerCase()))
        : playerList;
      if (!filtered.length) return `<div class="trn-players-empty">No players match "${_esc(q)}"</div>`;

      const totalPgs  = Math.ceil(filtered.length / PH_PAGE_SIZE);
      const curPg     = Math.max(1, Math.min(pg, totalPgs));
      const slice     = filtered.slice((curPg - 1) * PH_PAGE_SIZE, curPg * PH_PAGE_SIZE);
      const startRank = (curPg - 1) * PH_PAGE_SIZE + 1;

      const pipHeaders = allYearsSet.map(y =>
        `<span style="font-size:.62rem;font-weight:600;display:inline-block;width:14px;text-align:center">${String(y).slice(2)}</span>`
      ).join("");

      const rows = slice.map((p, i) => {
        const rank        = startRank + i;
        const isTChamp    = p.tournamentChamps > 0;
        const isLChamp    = p.totalChamps > 0 && !isTChamp;
        const rowCls      = isTChamp ? "trn-ph-row trn-ph-row--tchamp"
          : isLChamp ? "trn-ph-row trn-ph-row--lchamp" : "trn-ph-row";
        const genderBadge = p.gender === "Male"
          ? `<span class="trn-gender-m" style="font-size:.65rem">M</span>`
          : p.gender === "Female" ? `<span class="trn-gender-f" style="font-size:.65rem">F</span>` : "";
        const champCell = isTChamp
          ? `<span class="trn-ph-champ-badge">🏆 ×${p.tournamentChamps}</span>`
          : p.totalChamps > 0
            ? `<span class="trn-ph-champ-badge" style="background:rgba(99,102,241,.15);color:#a78bfa;border-color:rgba(99,102,241,.3)">🥇 ×${p.totalChamps}</span>`
            : `<span style="color:var(--color-text-dim)">—</span>`;
        const poCell = hasPoData
          ? (p.playoffApps > 0
              ? `<span style="color:#4ade80;font-weight:600">${p.playoffApps}</span><span style="color:var(--color-text-dim)">/${p.totalYears}</span>`
              : `<span style="color:var(--color-text-dim)">0/${p.totalYears}</span>`)
          : `<span style="color:var(--color-text-dim)">—</span>`;
        const bestCell = p.bestRank
          ? (p.bestRank === 1
              ? `<span style="color:var(--color-gold,#d4af37);font-weight:700">1 🏆</span>`
              : `<span style="font-weight:600">${p.bestRank}</span>`)
          : `<span style="color:var(--color-text-dim)">—</span>`;
        const yearPips = allYearsSet.map(yr => {
          const e   = p.yearData[String(yr)];
          const inS = !!(p.seasons[String(yr)]);
          if (!e && !inS) return `<span class="trn-az-yr-pip trn-az-yr-pip--absent" title="${yr}: did not play"></span>`;
          const cls = !e ? "trn-az-yr-pip--absent"
            : e.isTChamp  ? "trn-az-yr-pip--champ"
            : e.qualified ? "trn-az-yr-pip--qual"
            : "trn-az-yr-pip--elim";
          const tip = !e ? `${yr}: played, no PO data`
            : e.isTChamp  ? `${yr}: 🏆 Champion`
            : e.qualified ? `${yr}: ✓ Qualified${e.bye ? " (BYE)" : ""}${e.rank ? " · Rank " + e.rank : ""}`
            : `${yr}: Eliminated`;
          return `<span class="trn-az-yr-pip ${cls}" title="${tip}"></span>`;
        }).join("");

        return `
          <tr class="${rowCls}" data-ph-key="${_esc(_sk(p.displayName))}" role="button" tabindex="0" style="cursor:pointer">
            <td class="trn-ph-col-rank">${rank}</td>
            <td class="trn-ph-col-name">
              <span style="font-weight:600">${_esc(p.displayName)}</span>
              ${genderBadge}
              ${p.streak >= 2 ? `<span class="trn-az-streak-badge">🔥 ${p.streak}</span>` : ""}
              ${p.twitter ? `<a href="https://x.com/${_esc(p.twitter.replace(/^@/,""))}" target="_blank" rel="noopener" class="trn-st-twitter" style="font-size:.68rem" onclick="event.stopPropagation()">@${_esc(p.twitter.replace(/^@/,""))}</a>` : ""}
            </td>
            <td class="trn-ph-col-num" style="text-align:center">${p.totalYears}</td>
            <td class="trn-ph-col-num" style="text-align:center">${p.totalWins}–${p.totalLosses}</td>
            <td class="trn-ph-col-num" style="text-align:center">${p.winPct !== null ? p.winPct + "%" : "—"}</td>
            <td class="trn-ph-col-num" style="text-align:center">${poCell}</td>
            <td class="trn-ph-col-num" style="text-align:center">${bestCell}</td>
            <td class="trn-ph-col-champ" style="text-align:center">${champCell}</td>
            <td class="trn-az-pips-cell">${yearPips}</td>
          </tr>`;
      }).join("");

      const pagination = totalPgs > 1 ? `
        <tr class="trn-ph-pagination-row">
          <td colspan="9">
            <div class="trn-ph-pagination">
              <button class="draft-toggle-btn" id="trn-ph-prev" ${curPg <= 1 ? "disabled" : ""}>‹ Prev</button>
              <span style="font-size:.82rem;color:var(--color-text-dim)">Page ${curPg} of ${totalPgs} · ${filtered.length} players</span>
              <button class="draft-toggle-btn" id="trn-ph-next" ${curPg >= totalPgs ? "disabled" : ""}>Next ›</button>
            </div>
          </td>
        </tr>` : "";

      return `
        <div class="trn-ph-list-wrap">
          ${hasPoData ? `<div class="trn-az-legend" style="margin-bottom:var(--space-2)">
            <span class="trn-az-yr-pip trn-az-yr-pip--champ"></span> Champion &nbsp;
            <span class="trn-az-yr-pip trn-az-yr-pip--qual"></span> Qualified &nbsp;
            <span class="trn-az-yr-pip trn-az-yr-pip--elim"></span> Eliminated &nbsp;
            <span class="trn-az-yr-pip trn-az-yr-pip--absent"></span> No play &nbsp;
            🔥 = active streak
          </div>` : ""}
          <table class="trn-ph-list-table">
            <thead><tr>
              <th class="trn-ph-col-rank">#</th>
              <th class="trn-ph-col-name">Player</th>
              <th class="trn-ph-col-num trn-ph-th-tip" style="text-align:center" title="Seasons played">Yrs</th>
              <th class="trn-ph-col-num trn-ph-th-tip" style="text-align:center" title="Career wins–losses">W–L</th>
              <th class="trn-ph-col-num trn-ph-th-tip" style="text-align:center" title="Win percentage">Win%</th>
              <th class="trn-ph-col-num trn-ph-th-tip" style="text-align:center" title="Playoff appearances / seasons played">PO</th>
              <th class="trn-ph-col-num trn-ph-th-tip" style="text-align:center" title="Best tournament finish rank">Best</th>
              <th class="trn-ph-col-champ trn-ph-th-tip" style="text-align:center" title="🏆 Tournament Champion · 🥇 League Champion">Titles</th>
              <th class="trn-az-pips-cell trn-ph-th-tip" title="Year-by-year playoff history (hover for detail)">${pipHeaders}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
            ${pagination}
          </table>
        </div>`;
    };

    const _refresh = () => {
      const outer = document.getElementById("trn-ph-list-outer");
      if (outer) outer.innerHTML = _renderList(_phSearch, _phPage);
      _wirePhRows(playerList);
    };

    body.innerHTML = `
      <div class="trn-players-toolbar">
        <input type="text" id="trn-ph-search" class="trn-st-search"
          placeholder="Search by name…" value="${_esc(_phSearch)}" />
        <span style="font-size:.8rem;color:var(--color-text-dim);white-space:nowrap">${playerList.length} player${playerList.length !== 1 ? "s" : ""} · all years</span>
      </div>
      <div id="trn-ph-list-outer">${_renderList(_phSearch, _phPage)}</div>`;

    document.getElementById("trn-ph-search")?.addEventListener("input", function() {
      _phSearch = this.value; _phPage = 1;
      _refresh();
    });

    // ── Career modal ─────────────────────────────────────────
    const _openPhModal = (p) => {
      document.getElementById("trn-ph-modal-root")?.remove();
      const twitterLink = p.twitter
        ? `<a href="https://x.com/${_esc(p.twitter.replace(/^@/,""))}" target="_blank" rel="noopener" class="trn-st-twitter" style="margin-left:6px">@${_esc(p.twitter.replace(/^@/,""))}</a>` : "";
      const genderBadge = p.gender === "Male" ? ` <span class="trn-gender-m">M</span>`
        : p.gender === "Female" ? ` <span class="trn-gender-f">F</span>` : "";

      const yearSections = p.yearKeys.map(yr => {
        const poEntry  = p.yearData[String(yr)] || {};
        const leagueRows = p.seasons[String(yr)].map(s => {
          const tiesStr  = s.ties > 0 ? `–${s.ties}` : "";
          const platIcon = { sleeper:"🟢", mfl:"🔵", yahoo:"🟣" }[s.platform] || "⚪";
          // League champ cell
          const lchampCell = s.isChamp
            ? `<span class="trn-ph-champ-badge" style="font-size:.68rem">🥇 Champ</span>`
            : `<span style="color:var(--color-text-dim);font-size:.78rem">—</span>`;
          return `<tr>
            <td class="trn-ph-tbl-league">${platIcon} ${_esc(s.leagueName)}</td>
            <td class="trn-ph-tbl-num">${s.wins}–${s.losses}${tiesStr}</td>
            <td class="trn-ph-tbl-num">${(s.pf || 0).toFixed(1)}</td>
            <td style="padding:5px 6px;text-align:center">${lchampCell}</td>
          </tr>`;
        }).join("");

        // Tournament finish / playoff status for this year — shown as a summary row at bottom
        let finishRow = "";
        if (poEntry.isTChamp) {
          finishRow = `<tr style="background:rgba(212,175,55,.1)"><td colspan="4" style="padding:5px 8px;font-size:.78rem;font-weight:700;color:var(--color-gold,#d4af37)">🏆 Tournament Champion${poEntry.rank ? " · Overall Rank " + poEntry.rank : ""}</td></tr>`;
        } else if (poEntry.qualified) {
          const label = poEntry.bye ? "🌟 Qualified (BYE)" : "✓ Qualified";
          const rankStr = poEntry.rank ? " · Rank " + poEntry.rank : "";
          finishRow = `<tr style="background:rgba(34,197,94,.06)"><td colspan="4" style="padding:5px 8px;font-size:.78rem;color:#4ade80">${label}${rankStr}</td></tr>`;
        } else if (hasPoData) {
          finishRow = `<tr><td colspan="4" style="padding:5px 8px;font-size:.78rem;color:var(--color-text-dim)">Did not qualify</td></tr>`;
        }

        return `
          <div class="trn-ph-year-section">
            <div class="trn-ph-year-label">
              <strong>${_esc(String(yr))}</strong>
              <span style="font-size:.75rem;color:var(--color-text-dim);margin-left:8px">${p.seasons[String(yr)].length} league${p.seasons[String(yr)].length !== 1 ? "s" : ""}</span>
            </div>
            <table class="trn-ph-career-table">
              <thead><tr>
                <th>League</th>
                <th style="text-align:right;width:52px">W–L</th>
                <th style="text-align:right;width:52px">PF</th>
                <th style="text-align:center;width:72px">Lg Champ</th>
              </tr></thead>
              <tbody>${leagueRows}${finishRow}</tbody>
            </table>
          </div>`;
      }).join("");

      const modalRoot = document.createElement("div");
      modalRoot.id        = "trn-ph-modal-root";
      modalRoot.className = "trn-ph-modal-backdrop";
      modalRoot.style.display = "flex";
      modalRoot.innerHTML = `
        <div class="trn-ph-modal">
          <div class="trn-ph-modal-header">
            <span class="trn-ph-modal-title">${_esc(p.displayName)}${genderBadge}${twitterLink}</span>
            <button class="modal-close" id="trn-ph-modal-close">✕</button>
          </div>
          <div class="trn-ph-modal-body">
            <div class="trn-ph-modal-totals">
              <div class="trn-ph-stat"><div class="trn-ph-stat-val">${p.totalYears}</div><div class="trn-ph-stat-lbl">Season${p.totalYears !== 1 ? "s" : ""}</div></div>
              <div class="trn-ph-stat"><div class="trn-ph-stat-val">${p.totalWins}–${p.totalLosses}</div><div class="trn-ph-stat-lbl">Career W–L</div></div>
              <div class="trn-ph-stat"><div class="trn-ph-stat-val">${p.winPct !== null ? p.winPct + "%" : "—"}</div><div class="trn-ph-stat-lbl">Win%</div></div>
              <div class="trn-ph-stat"><div class="trn-ph-stat-val">${p.playoffApps}/${p.totalYears}</div><div class="trn-ph-stat-lbl">PO Apps</div></div>
              <div class="trn-ph-stat"><div class="trn-ph-stat-val">${p.bestRank ?? "—"}</div><div class="trn-ph-stat-lbl">Best Rank</div></div>
              <div class="trn-ph-stat"><div class="trn-ph-stat-val">${p.totalPF ? p.totalPF.toFixed(0) : "—"}</div><div class="trn-ph-stat-lbl">Career PF</div></div>
              ${p.tournamentChamps > 0 ? `<div class="trn-ph-stat"><div class="trn-ph-stat-val">🏆×${p.tournamentChamps}</div><div class="trn-ph-stat-lbl">Tourn.</div></div>` : ""}
              ${p.totalChamps > 0 ? `<div class="trn-ph-stat"><div class="trn-ph-stat-val">🥇×${p.totalChamps}</div><div class="trn-ph-stat-lbl">League</div></div>` : ""}
            </div>
            ${yearSections}
          </div>
        </div>`;

      document.body.appendChild(modalRoot);
      document.body.style.overflow = "hidden";
      const _close = () => { modalRoot.remove(); document.body.style.overflow = ""; };
      document.getElementById("trn-ph-modal-close")?.addEventListener("click", _close);
      modalRoot.addEventListener("click", (e) => { if (e.target === modalRoot) _close(); });
    };

    const _wirePhRows = (list) => {
      body.querySelectorAll(".trn-ph-row").forEach(row => {
        const key = row.dataset.phKey;
        const p   = list.find(pl => _sk(pl.displayName) === key);
        if (!p) return;
        const open = () => _openPhModal(p);
        row.addEventListener("click", open);
        row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") open(); });
      });
      body.querySelector("#trn-ph-prev")?.addEventListener("click", () => { _phPage--; _refresh(); });
      body.querySelector("#trn-ph-next")?.addEventListener("click", () => { _phPage++; _refresh(); });
    };

    _wirePhRows(playerList);
  }

  // ── User: Info tab ─────────────────────────────────────
  // ── Playoffs Tab ─────────────────────────────────────────────────────────────
  // Tabs: Standings (qualifier tags) | mode-specific round tabs | League Champs
  // Admin-only: Publish Playoffs button writes snapshot to publicTournaments/{tid}/playoffs
  function _renderPlayoffsTab(tid, t, body) {
    const years   = _playoffYears(t);
    const activeY = _tournamentYear ? String(_tournamentYear)
      : (years[0] || String(new Date().getMonth() >= 8
          ? new Date().getFullYear() : new Date().getFullYear() - 1));
    const po      = _playoffForYear(t, activeY);
    const mode    = po.mode || "total_points";

    // Build participant lookups (gender + displayName) — not stored in lc.teams
    const _skPo = (s) => String(s||'').trim().toLowerCase().replace(/[.#$\/\[\]]/g, '_');
    const genderMap      = {};
    const displayNameMap = {};
    // Build sleeperUsername → gender/displayName (most stable cross-year key)
    const sleeperUsernameGenderMap      = {};
    const sleeperUsernameDisplayNameMap = {};
    Object.values(t.participants || {}).forEach(p => {
      [p.sleeperUsername, p.displayName, p.teamName].filter(Boolean).forEach(name => {
        const k = _skPo(name);
        if (p.gender)       genderMap[k]      = p.gender;
        if (p.displayName)  displayNameMap[k] = p.displayName;
      });
      // sleeperUsername is a stable login handle that doesn't change when display name changes
      if (p.sleeperUsername) {
        const k = p.sleeperUsername.toLowerCase();
        if (p.gender)      sleeperUsernameGenderMap[k]      = p.gender;
        if (p.displayName) sleeperUsernameDisplayNameMap[k] = p.displayName;
      }
    });
    const _displayName = (tm) =>
      (tm.sleeperUsername ? sleeperUsernameDisplayNameMap[tm.sleeperUsername.toLowerCase()] : null) ||
      displayNameMap[_skPo(tm.teamName)] ||
      displayNameMap[_skPo(tm.rawTeamName)] ||
      tm.teamName || '—';

    // Flat team list for active year from standings cache
    const allTeams = [];
    Object.entries(t.standingsCache || {}).forEach(([ck, lc]) => {
      if (String(lc.year) !== String(activeY)) return;
      (lc.teams || []).forEach(tm => {
        // Try sleeperUsername first (stable login handle, doesn't change with display name)
        // then fall back to display-name based lookup
        const gender      = (tm.sleeperUsername ? sleeperUsernameGenderMap[tm.sleeperUsername.toLowerCase()] : null)
          || genderMap[_skPo(tm.teamName)] || genderMap[_skPo(tm.rawTeamName)] || '';
        const displayName = (tm.sleeperUsername ? sleeperUsernameDisplayNameMap[tm.sleeperUsername.toLowerCase()] : null)
          || displayNameMap[_skPo(tm.teamName)] || displayNameMap[_skPo(tm.rawTeamName)] || tm.teamName || '';
        allTeams.push({
          ...tm,
          displayName,
          leagueName: lc.leagueName || ck,
          division:   lc.division   || '',
          conference: lc.conference || '',
          gender,
        });
      });
    });

    // Sort teams
    const _sortTeams = (teams) => [...teams].sort((a, b) => {
      if (mode === "h2h_bracket" || po.seeding?.method === "record") {
        const ad = (a.wins||0)-(a.losses||0), bd = (b.wins||0)-(b.losses||0);
        if (bd !== ad) return bd - ad;
      }
      return (b.pf||0) - (a.pf||0);
    });
    const sortedTeams = _sortTeams(allTeams);

    // ── Qualification engine ──────────────────────────────
    // Computes which teams qualify based on composite steps, respecting scope.
    // scope:"overall"    → top N across the full field
    // scope:"division"   → top N from each distinct division
    // scope:"conference" → top N from each distinct conference

    // If explicit division/conference fields aren't set, each league = one division
    const _groupKey = (tm, scope) => {
      if (scope === "conference") {
        return (tm.conference && tm.conference !== "") ? tm.conference : null;
      }
      // division scope: use explicit division, fall back to leagueName
      return (tm.division && tm.division !== "") ? tm.division : (tm.leagueName || "__none__");
    };
    const allDivisions   = [...new Set(allTeams.map(tm => _groupKey(tm, "division")).filter(Boolean))];
    const allConferences = [...new Set(allTeams.map(tm => _groupKey(tm, "conference")).filter(Boolean))];
    // If no explicit conferences, conferences scope falls back to leagues too
    const numDivisions   = allDivisions.length || 1;
    const numConferences = allConferences.length || allDivisions.length || 1;

    // Sort helper: by metric desc
    const _sortByMetric = (teams, metric) => [...teams].sort((a, b) =>
      metric === "record"
        ? ((b.wins||0)-(b.losses||0)) - ((a.wins||0)-(a.losses||0)) || (b.pf||0)-(a.pf||0)
        : (b.pf||0) - (a.pf||0)
    );

    // Run composite steps sequentially; each fills slots from not-yet-qualified teams
    const _runCompositeQual = (steps, pool) => {
      const qualified = new Set(); // using index in pool to track
      let eligibleIndices = pool.map((_, i) => i); // indices into pool

      for (const step of steps) {
        if (step.type === "wins_threshold") {
          // Gate: remove ineligible teams from future steps
          eligibleIndices = eligibleIndices.filter(i => (pool[i].wins||0) >= (step.minWins||13));
          continue;
        }

        const scope  = step.scope || "overall";
        const count  = step.type === "top_subgroup" ? (step.subCount||2) : (step.count||2);
        const metric = step.type === "top_record" ? "record"
          : step.type === "top_subgroup" ? (step.subMetric || "pf") : "pf";

        // Eligible unqualified teams for this step
        const candidates = eligibleIndices.filter(i => !qualified.has(i));

        if (scope === "overall") {
          // Take top N from entire candidate pool
          const sorted = _sortByMetric(candidates.map(i => ({...pool[i], _idx:i})), metric);
          sorted.slice(0, count).forEach(tm => qualified.add(tm._idx));

        } else {
          // Take top N per group (division or conference)
          // Uses _groupKey which falls back to leagueName when explicit fields are empty
          const groups = {};
          candidates.forEach(i => {
            const g = _groupKey(pool[i], scope) || "__none__";
            if (!groups[g]) groups[g] = [];
            groups[g].push(i);
          });
          Object.values(groups).forEach(groupIndices => {
            // Apply subgroup filter if applicable
            let filtered = groupIndices;
            if (step.type === "top_subgroup") {
              filtered = groupIndices.filter(i => {
                const val = step.subField === "gender" ? pool[i].gender
                  : pool[i][step.subField] || "";
                return String(val).toLowerCase() === String(step.subValue||"").toLowerCase();
              });
            }
            const sorted = _sortByMetric(filtered.map(i => ({...pool[i], _idx:i})), metric);
            sorted.slice(0, count).forEach(tm => qualified.add(tm._idx));
          });
        }
      }
      return [...qualified].map(i => pool[i]);
    };

    // Compute actual qualifiers based on method
    const _computeQualifiers = () => {
      const q = po.qualification || {};
      if (q.method === "manual") return sortedTeams; // admin picks manually
      if (q.method === "top_record") return _sortByMetric(sortedTeams, "record").slice(0, q.count||8);
      if (q.method === "top_pf")     return _sortByMetric(sortedTeams, "pf").slice(0, q.count||8);
      if (q.method === "top_per_group") {
        const n = q.perGroup || 2;
        const groups = {};
        sortedTeams.forEach(tm => {
          const g = _groupKey(tm, "division") || "__all__";
          if (!groups[g]) groups[g] = [];
          groups[g].push(tm);
        });
        return Object.values(groups).flatMap(g => _sortByMetric(g,"pf").slice(0,n));
      }
      if (q.method === "composite") {
        return _runCompositeQual(q.steps || [], sortedTeams);
      }
      return sortedTeams;
    };

    // Count qualifiers for display (used in notes and publish snapshot)
    const _qualCount = () => {
      const q = po.qualification || {};
      if (q.method === "composite") {
        return (q.steps || []).filter(s => s.type !== "wins_threshold").reduce((sum, st) => {
          const scope = st.scope || "overall";
          const n = st.type === "top_subgroup" ? (st.subCount||2) : (st.count||2);
          if (scope === "division")   return sum + n * numDivisions;
          if (scope === "conference") return sum + n * numConferences;
          return sum + n;
        }, 0);
      }
      if (q.method === "top_per_group") return (q.perGroup||2) * Math.max(numDivisions, numConferences, 1);
      return q.count || (mode === "h2h_bracket" ? (po.bracketSize || 8) : sortedTeams.length);
    };

    const qualifiers = _computeQualifiers();
    const qualCount  = qualifiers.length || _qualCount();
    // League-scoped key: roster IDs like "1","2" are only unique within a league,
    // so we must prefix with leagueName to avoid cross-league collisions.
    const _teamKey = tm => (tm.leagueName || "") + "|" + (tm.teamId || tm.rawTeamName || tm.teamName);
    const qualSet  = new Set(qualifiers.map(_teamKey));

    // byeCount respects scope — "top 2 per division" with 28 divisions = 56 byes total
    const byeType  = po.byes?.type  || "none";
    const byeScope = po.byes?.scope || "overall";
    const byeRaw   = (byeType !== "none") ? (po.byes?.count || 0) : 0;
    const byeCount = byeRaw > 0
      ? (byeScope === "division"   ? byeRaw * numDivisions
       : byeScope === "conference" ? byeRaw * numConferences
       : byeRaw)
      : 0;

    // Compute which teams have a bye — ranked by byes.method (independent of seeding method)
    const byeMetric = (po.byes?.method || "record") === "record" ? "record" : "pf";
    const seedMetric = po.seeding?.method === "record" ? "record" : "pf"; // bracket seeding only
    const seededQualifiers = _sortByMetric([...qualifiers], byeMetric);
    const byeSet = (() => {
      if (!byeCount) return new Set();
      if (byeScope === "overall") {
        // Top N overall
        return new Set(seededQualifiers.slice(0, byeCount).map(_teamKey));
      }
      // Top byeRaw per division/conference group
      const groups = {};
      seededQualifiers.forEach(tm => {
        const g = _groupKey(tm, byeScope) || "__none__";
        if (!groups[g]) groups[g] = [];
        groups[g].push(tm);
      });
      const byeTeams = [];
      Object.values(groups).forEach(group => {
        byeTeams.push(...group.slice(0, byeRaw));
      });
      return new Set(byeTeams.map(_teamKey));
    })();

    // ── Qualification diagnostic tool ──────────────────────
    // Call window.diagQual("partial name") in the browser console to see
    // why a team did or didn't qualify, what gender was resolved, what step picked them.
    window._poQualDiag = {
      year: activeY,
      allTeams: allTeams.map(tm => ({
        teamName:       tm.teamName,
        displayName:    _displayName(tm),
        leagueName:     tm.leagueName,
        gender:         tm.gender,
        sleeperUsername:tm.sleeperUsername || "",
        wins:           tm.wins,
        losses:         tm.losses,
        pf:             tm.pf,
        qualified:      qualSet.has(_teamKey(tm)),
        bye:            byeSet.has(_teamKey(tm)),
        teamKey:        _teamKey(tm)
      })),
      steps: (po.qualification?.steps || []),
      stepResults: (() => {
        if (po.qualification?.method !== "composite") return null;
        const pool = sortedTeams;
        const qualified = new Set();
        const eligibleIndices = pool.map((_, i) => i);
        let eli = [...eligibleIndices];
        return (po.qualification.steps || []).map(step => {
          if (step.type === "wins_threshold") {
            const before = eli.length;
            eli = eli.filter(i => (pool[i].wins||0) >= (step.minWins||13));
            return { step, type: "gate", removed: before - eli.length, remaining: eli.length };
          }
          const scope   = step.scope || "overall";
          const count   = step.type === "top_subgroup" ? (step.subCount||2) : (step.count||2);
          const metric  = step.type === "top_record" ? "record" : step.type === "top_subgroup" ? (step.subMetric||"pf") : "pf";
          const cands   = eli.filter(i => !qualified.has(i));
          const groups  = {};
          cands.forEach(i => {
            const g = _groupKey(pool[i], scope) || "__none__";
            if (!groups[g]) groups[g] = [];
            groups[g].push(i);
          });
          const picked = [];
          Object.entries(groups).forEach(([g, gis]) => {
            let filtered = gis;
            if (step.type === "top_subgroup") {
              filtered = gis.filter(i => {
                const val = step.subField === "gender" ? pool[i].gender : pool[i][step.subField]||"";
                return String(val).toLowerCase() === String(step.subValue||"").toLowerCase();
              });
            }
            const sorted = _sortByMetric(filtered.map(i => ({...pool[i], _idx:i})), metric);
            sorted.slice(0, count).forEach(tm => { qualified.add(tm._idx); picked.push({group:g, team:pool[tm._idx]}); });
          });
          return { step, type: "qual", groups: Object.keys(groups).length, picked: picked.length, pickedTeams: picked.map(p => `${p.group}: ${p.team.teamName} (gender=${p.team.gender}, pf=${p.team.pf})`), candidateCount: cands.length };
        });
      })()
    };
    window.diagQual = (name) => {
      const d = window._poQualDiag;
      if (!d) { console.log("No diag data — open the playoffs tab first"); return; }
      const q = name.toLowerCase();
      const matches = d.allTeams.filter(tm =>
        (tm.teamName||"").toLowerCase().includes(q) ||
        (tm.displayName||"").toLowerCase().includes(q) ||
        (tm.leagueName||"").toLowerCase().includes(q) ||
        (tm.sleeperUsername||"").toLowerCase().includes(q)
      );
      if (!matches.length) { console.log("No teams found matching:", name); return; }
      console.group(`diagQual("${name}") — Year ${d.year}`);
      matches.forEach(tm => {
        console.group(`${tm.displayName} (${tm.teamName})`);
        console.log("League:", tm.leagueName);
        console.log("Gender:", tm.gender || "(empty — no match found)");
        console.log("SleeperUsername:", tm.sleeperUsername || "(not stored — re-sync standings)");
        console.log("Record:", tm.wins + "–" + tm.losses, "| PF:", tm.pf);
        console.log("Qualified:", tm.qualified, "| Bye:", tm.bye);
        console.log("TeamKey:", tm.teamKey);
        console.groupEnd();
      });
      if (d.stepResults) {
        console.group("Step-by-step qualification");
        d.stepResults.forEach((sr, i) => {
          if (sr.type === "gate") console.log(`Step ${i+1} [Gate]: removed ${sr.removed} teams, ${sr.remaining} eligible`);
          else console.log(`Step ${i+1} [${sr.step.type} scope=${sr.step.scope||"overall"}]: ${sr.picked} picked from ${sr.candidateCount} candidates across ${sr.groups} groups`, sr.pickedTeams);
        });
        console.groupEnd();
      }
      console.groupEnd();
    };
    console.log("[GMD Playoffs] Diagnostic ready — call diagQual('name') in console");

    // Build tab list based on mode
    const _buildTabs = () => {
      const tabs = [{ id:"standings", label:"📊 Standings" }];
      if (mode === "total_points") {
        tabs.push({ id:"leaderboard", label:"🏆 Leaderboard" });
      } else if (mode === "points_rounds") {
        (po.pointsRounds?.rounds || []).forEach((_, i) => {
          const isFinal = i === (po.pointsRounds.rounds.length - 1);
          tabs.push({ id:`round_${i}`, label: isFinal ? "🏆 Championship" : `Round ${i+1}` });
        });
      } else if (mode === "h2h_bracket") {
        tabs.push({ id:"bracket", label:"🥊 Bracket" });
      } else if (mode === "custom_rounds") {
        (po.customRounds?.rounds || []).forEach((_, i) => {
          const isFinal = i === (po.customRounds.rounds.length - 1);
          tabs.push({ id:`cround_${i}`, label: isFinal ? "🏆 Championship" : `Round ${i+1}` });
        });
      } else if (mode === "worldcup") {
        // One tab per group, then the bracket
        (po.worldcupGroups || []).forEach((g, gi) => {
          tabs.push({ id:`wcgroup_${gi}`, label:`🌍 ${g.name || ("Group "+(gi+1))}` });
        });
        tabs.push({ id:"wc_bracket", label:"🥊 Bracket" });
      }
      if (po.recognizeLeagueChampions) tabs.push({ id:"league_champs", label:"🏅 League Champs" });
      return tabs;
    };
    const tabs = _buildTabs();
    let _poViewTab = tabs[0].id;

    const _tabBar = (active) => `
      <div class="trn-po-subtab-bar">
        ${tabs.map(tab => `
          <button class="trn-po-subtab-btn ${tab.id===active?"trn-po-subtab-btn--active":""}"
            data-subtab="${tab.id}">${tab.label}</button>`).join("")}
      </div>
      <select class="trn-po-tab-select" id="trn-po-tab-select" aria-label="Select section">
        ${tabs.map(tab => `
          <option value="${tab.id}" ${tab.id===active?"selected":""}>${tab.label}</option>`).join("")}
      </select>`;

    // ── Standings view (all modes) ───────────────────────
    const _renderStandingsView = () => {
      const sw = po.startWeek, ew = po.endWeek;
      const elimCount = sortedTeams.length - qualifiers.length;
      const note = mode === "total_points"
        ? `Champion = highest PF${ew ? ` through Week ${ew}` : ""}.`
        : `${qualifiers.length} qualified · ${elimCount} eliminated${byeCount ? ` · ${byeCount} bye${byeCount!==1?"s":""}` : ""}${sw ? ` · Playoffs Wk ${sw}` : ""}`;

      // Sort: qualified teams first (by PF desc), then eliminated (by PF desc)
      // Per-division rules scatter Q/E throughout sorted order so we group them cleanly
      const qualTeams = sortedTeams.filter(tm => qualSet.has(_teamKey(tm)));
      const elimTeams = sortedTeams.filter(tm => !qualSet.has(_teamKey(tm)));
      const displayTeams = [...qualTeams, ...elimTeams];

      const _row = (tm, i) => {
        const isQ   = i < qualTeams.length;   // first block = qualified
        const isBye = byeSet.has(_teamKey(tm));
        const isChamp = mode === "total_points" && i === 0;
        const rowCls = isChamp ? "trn-po-row--champion"
          : isBye ? "trn-po-row--bye-seed"
          : isQ   ? "trn-po-row--qualified"
          : "trn-po-row--eliminated";
        const badge = isChamp
          ? `<span class="trn-po-badge trn-po-badge--champion">🏆 Champion</span>`
          : isBye
          ? `<span class="trn-po-badge trn-po-badge--bye">BYE</span>`
          : isQ
          ? `<span class="trn-po-badge trn-po-badge--qualified">✓ Qualified</span>`
          : `<span class="trn-po-badge trn-po-badge--eliminated">Eliminated</span>`;
        // Single cut line between the two blocks
        const divider = (i === qualTeams.length && elimTeams.length > 0)
          ? `<tr class="trn-po-cut-row"><td colspan="5"><div class="trn-po-cut-divider">— Qualification Cut Line — ${qualTeams.length} qualified · ${elimTeams.length} eliminated —</div></td></tr>`
          : "";
        // Champion banner row (total_points mode)
        const champBanner = isChamp ? `<tr class="trn-po-row--champion-banner">
          <td colspan="6">
            <div class="trn-po-champion-banner">
              <span class="trn-po-champion-trophy">🏆</span>
              <div class="trn-po-champion-info">
                <div class="trn-po-champion-name">${_esc(_displayName(tm))}</div>
                <div class="trn-po-champion-sub">${_esc(tm.leagueName||"")} · ${(tm.pf||0).toFixed(2)} pts · ${tm.wins??0}–${tm.losses??0}</div>
              </div>
              <span class="trn-po-champion-label">🏆 Tournament Champion</span>
            </div>
          </td>
        </tr>` : "";
        return `${champBanner}${divider}<tr class="${rowCls}">
          <td class="trn-po-rank">${isChamp?"🏆":i+1}</td>
          <td class="trn-po-team-name">
            <div>${_esc(_displayName(tm))}</div>
            <div class="trn-po-team-sub">${_esc(tm.leagueName||"—")}</div>
          </td>
          <td class="trn-po-num">${tm.wins??0}–${tm.losses??0}</td>
          <td class="trn-po-num trn-po-pf">${(tm.pf||0).toFixed(2)}</td>
          <td>${badge}</td>
        </tr>`;
      };

      return `
        <div class="trn-po-tp-note">${note}</div>
        <div class="trn-po-table-wrap">
          <table class="trn-po-table">
            <thead><tr>
              <th>#</th><th>Team</th>
              <th class="trn-po-th-num">W–L</th>
              <th class="trn-po-th-num">PF</th>
              <th>Status</th>
            </tr></thead>
            <tbody>${displayTeams.map(_row).join("")}</tbody>
          </table>
        </div>`;
    };
    // ── Total points leaderboard ─────────────────────────
    const _renderLeaderboard = () => `
      <div class="trn-po-table-wrap">
        <table class="trn-po-table">
          <thead><tr>
            <th>#</th><th>Team</th><th>League</th>
            <th class="trn-po-th-num">W–L</th>
            <th class="trn-po-th-num">Points For</th>
          </tr></thead>
          <tbody>
            ${sortedTeams.slice(0,20).map((tm,i) => `
              <tr class="${i===0?"trn-po-row--champion":""}">
                <td class="trn-po-rank">${i===0?"🏆":i+1}</td>
                <td class="trn-po-team-name">${_esc(_displayName(tm))}</td>
                <td class="trn-po-league">${_esc(tm.leagueName||"—")}</td>
                <td class="trn-po-num">${tm.wins??0}–${tm.losses??0}</td>
                <td class="trn-po-num trn-po-pf">${(tm.pf||0).toFixed(2)}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      ${sortedTeams.length>20?`<div class="trn-po-more">+ ${sortedTeams.length-20} more teams</div>`:""}`;

    // ── Points round tab ─────────────────────────────────
    // Builds a leagueId→teamId map so we can fetch per-week scores from Sleeper
    const leagueIdByTeamKey = {};
    const leagueIdByName    = {};
    Object.entries(t.standingsCache || {}).forEach(([ck, lc]) => {
      if (String(lc.year) !== String(activeY)) return;
      const leagueId = lc.leagueId || ck.replace(/^\d+_/, "");
      leagueIdByName[lc.leagueName || ck] = leagueId;
      (lc.teams || []).forEach(tm => {
        leagueIdByTeamKey[_teamKey({...tm, leagueName: lc.leagueName || ck})] = leagueId;
      });
    });

    // Reg season weeks: playoff start week minus 1. Falls back to wins+losses+ties.
    const regSeasonWeeks = po.startWeek ? (po.startWeek - 1) : null;

    // Cache for fetched weekly scores: "leagueId|week" → {rosterId: score}
    const _weekScoreCache = {};
    const _fetchWeekScores = async (leagueId, week) => {
      const key = leagueId + "|" + week;
      if (_weekScoreCache[key]) return _weekScoreCache[key];
      try {
        const r = await fetch("https://api.sleeper.app/v1/league/" + leagueId + "/matchups/" + week);
        if (!r.ok) return {};
        const data = await r.json();
        const map = {};
        (data || []).forEach(m => { if (m.roster_id) map[String(m.roster_id)] = m.points || 0; });
        _weekScoreCache[key] = map;
        return map;
      } catch(e) { return {}; }
    };

    const _renderPointsRound = (roundIdx) => {
      const rounds = po.pointsRounds?.rounds || [];
      const round  = rounds[roundIdx];
      if (!round) return `<div class="trn-po-empty">Round not configured.</div>`;
      const isFinal = roundIdx === rounds.length - 1;
      // Compute absolute start week for this round (accounting for weeksPerRound of prior rounds)
      let roundStartWeek = po.startWeek || null;
      if (roundStartWeek) { for (let ri = 0; ri < roundIdx; ri++) roundStartWeek += (rounds[ri].weeksPerRound || 1); }
      const wpr     = round.weeksPerRound || 1;
      const weekNum = roundStartWeek; // first week of this round

      // Blend config for this round
      const blend        = round.blend;
      const blendEnabled = !!(blend?.enabled);
      const blendWeight  = blend?.weight ?? 30;
      const blendMode    = blend?.mode || "weighted";

      const historyLabel = roundIdx === 0
        ? "reg season avg"
        : `avg (reg + ${roundIdx} playoff wk${roundIdx !== 1 ? "s" : ""})`;
      const blendNote = !blendEnabled
        ? "Score = this week's points"
        : blendMode === "weighted"
          ? `Score = week × ${100-blendWeight}% + ${historyLabel} × ${blendWeight}%`
          : `Score = week pts + ${historyLabel} × ${blendWeight}%`;

      const tableId  = `trn-po-round-table-${roundIdx}`;
      const loaderId = `trn-po-round-loader-${roundIdx}`;
      // trn-po-col-wk/avg/blend classes only hide on mobile when blend IS active
      // (table gets class trn-po-table--blend so CSS can scope the rule)
      const headerCols = blendEnabled
        ? `<th class="trn-po-th-num trn-po-col-wk">Wk Score</th><th class="trn-po-th-num trn-po-col-avg">Avg/Wk</th><th class="trn-po-th-num trn-po-col-blend">Blend</th>`
        : `<th class="trn-po-th-num">Week Score</th>`;
      const tableClass = blendEnabled ? "trn-po-table trn-po-table--blend" : "trn-po-table";
      const colSpan = blendEnabled ? 7 : 5;

      // Shell renders synchronously; pool/scores filled async
      const shell = `
        <div class="trn-po-round-card ${isFinal?"trn-po-round-card--final":""}">
          <div class="trn-po-round-header">
            <span>${isFinal?"🏆 Championship":`Round ${roundIdx+1}`}</span>
            ${weekNum?`<span class="trn-po-week-tag">${wpr > 1 ? `Weeks ${weekNum}–${weekNum+wpr-1}` : `Week ${weekNum}`}</span>`:""}
          </div>
          <div class="trn-po-round-blend-note">${blendNote}</div>
        </div>
        <div class="trn-po-table-wrap" style="margin-top:var(--space-2)">
          <div id="${loaderId}" style="font-size:.8rem;color:var(--color-text-dim);padding:var(--space-2) 0">
            ⏳ Loading scores…
          </div>
          <div id="${tableId}-bye-bar" style="display:none"></div>
          <table class="${tableClass}" id="${tableId}" style="display:none">
            <thead><tr>
              <th>#</th><th>Team</th>
              ${headerCols}
              <th>Status</th>
            </tr></thead>
            <tbody></tbody>
          </table>
        </div>`;

      // ── Async: fetch all weeks needed, simulate advancement, render ─────
      (async () => {
        try {
          // We need weekly scores for:
          //   - All previous rounds (to correctly simulate who advanced into this round)
          //   - This round (to show/sort by current week combined score)
          const weeksNeeded = [];
          if (po.startWeek) {
            let cursor = po.startWeek;
            for (let ri = 0; ri <= roundIdx; ri++) {
              const rWpr = rounds[ri].weeksPerRound || 1;
              for (let w = 0; w < rWpr; w++) weeksNeeded.push(cursor + w);
              cursor += rWpr;
            }
          } else if (weekNum) {
            for (let w = 0; w < wpr; w++) weeksNeeded.push(weekNum + w);
          }

          // Fetch all needed weeks for all leagues in the full qualifier pool
          const allLeagueIds = [...new Set(qualifiers.map(tm => leagueIdByTeamKey[_teamKey(tm)]).filter(Boolean))];
          const fetchAll = weeksNeeded.flatMap(w => allLeagueIds.map(lid => _fetchWeekScores(lid, w)));
          await Promise.all(fetchAll);

          // Helper: get a team's combined score for a round (one or more consecutive weeks)
          const _weekScore = (tm, startWk, numWks) => {
            const lid = leagueIdByTeamKey[_teamKey(tm)];
            if (!lid || !startWk) return null;
            let total = 0, hasAny = false;
            for (let w = 0; w < numWks; w++) {
              const v = _weekScoreCache[lid + "|" + (startWk + w)]?.[String(tm.teamId)];
              if (v != null) { total += v; hasAny = true; }
            }
            return hasAny ? total : null;
          };

          // ── Simulate advancement through previous rounds using actual scores ──
          // Re-order qualifiers so bye teams always come first, then non-byes sorted
          // by seeding metric. This ensures pool.slice(0, poolByes) == bye teams.
          const _byeFirst = (teams) => {
            const byes_ = _sortByMetric(teams.filter(tm => byeSet.has(_teamKey(tm))), byeMetric);
            const rest_  = _sortByMetric(teams.filter(tm => !byeSet.has(_teamKey(tm))), byeMetric);
            return [...byes_, ...rest_];
          };
          let pool = _byeFirst([...qualifiers]);

          // Build cumulative start weeks for each prior round
          let rCursor = po.startWeek || 0;
          for (let ri = 0; ri < roundIdx; ri++) {
            const r         = rounds[ri];
            const rWpr      = r.weeksPerRound || 1;
            const rWeekNum  = rCursor;
            rCursor += rWpr;

            // Byes only apply to round 0 (global bye config)
            const rPoolByes = ri === 0 ? byeCount : 0;

            const byeSection  = pool.slice(0, rPoolByes);
            const compSection = pool.slice(rPoolByes);
            const competitors = compSection.length;
            const advFromComp = r.advanceMethod === "pct"
              ? Math.round(competitors * (r.advancePct || 50) / 100)
              : (r.advanceCount || 0);

            // Sort competing section by combined round score (desc), then by pf as tiebreak
            const sorted = [...compSection].sort((a, b) => {
              const sa = _weekScore(a, rWeekNum, rWpr) ?? -1;
              const sb = _weekScore(b, rWeekNum, rWpr) ?? -1;
              if (sb !== sa) return sb - sa;
              return (b.pf||0) - (a.pf||0);
            });

            // Next pool = byes + top advFromComp competitive scorers
            pool = [...byeSection, ...sorted.slice(0, advFromComp)];
          }

          // ── Now pool is correct for this round ─────────────────────────
          const isByeRound  = roundIdx === 0 && byeCount > 0;
          const poolByes    = isByeRound ? byeCount : 0;
          const competitors = pool.length - poolByes;
          const advFromComp = isFinal ? 1
            : round.advanceMethod === "pct"
              ? Math.round(competitors * (round.advancePct || 50) / 100)
              : (round.advanceCount || 0);
          const totalAdvancing = poolByes + advFromComp;
          const eliminated     = pool.length - totalAdvancing;

          // Annotate each team with this week's score and blend components
          const regWeeks = regSeasonWeeks || 1;
          const poolScored = pool.map(tm => {
            const wkScore   = _weekScore(tm, weekNum, wpr);
            const regAvgPW  = (tm.pf || 0) / regWeeks;
            const bScore    = !blendEnabled || wkScore == null ? null
              : blendMode === "weighted"
                ? wkScore * (1 - blendWeight/100) + regAvgPW * (blendWeight/100)
                : wkScore + regAvgPW * (blendWeight/100);
            return { ...tm, wkScore, regAvgPW, bScore };
          });

          // Sort: byes stay at top (position 0..poolByes-1);
          // competing section sorted by blend score (or week score) desc
          const byeSection_  = poolScored.slice(0, poolByes);
          const compSection_ = poolScored.slice(poolByes).sort((a, b) => {
            const sa = blendEnabled ? (b.bScore ?? b.wkScore ?? b.pf)
                                    : (b.wkScore ?? b.pf);
            const sb = blendEnabled ? (a.bScore ?? a.wkScore ?? a.pf)
                                    : (a.wkScore ?? a.pf);
            return sa - sb;
          });
          const sortedPool = [...byeSection_, ...compSection_];

          const summary = isByeRound
            ? `${pool.length} total · ${poolByes} byes · ${competitors} competing · ${advFromComp} advance · ${competitors - advFromComp} eliminated`
            : `${pool.length} competing · ${advFromComp} advance · ${eliminated} eliminated`;

          // Update the header meta text
          const headerEl = document.querySelector(`#${tableId}`)?.closest(".trn-po-table-wrap")
            ?.previousElementSibling?.querySelector(".trn-po-round-header");
          if (headerEl) {
            const existing = headerEl.querySelector(".trn-po-round-meta");
            if (existing) existing.textContent = summary;
            else {
              const m = document.createElement("span");
              m.className = "trn-po-round-meta";
              m.textContent = summary;
              headerEl.appendChild(m);
            }
          }

          // Build rows
          const rows = sortedPool.map((tm, i) => {
            const isByeTeam = isByeRound && i < poolByes;
            const compIdx   = i - poolByes;
            const isCompAdv = !isByeTeam && compIdx < advFromComp;
            const isChamp   = isFinal && i === poolByes;
            const rowCls    = isChamp ? "trn-po-row--champion"
              : isByeTeam ? "trn-po-row--bye-seed"
              : isCompAdv ? "trn-po-row--advance"
              : "trn-po-row--cut";
            const badge = isChamp
              ? `<span class="trn-po-badge trn-po-badge--champion">🏆 Champion</span>`
              : isByeTeam ? `<span class="trn-po-badge trn-po-badge--bye">BYE</span>`
              : isCompAdv ? `<span class="trn-po-badge trn-po-badge--advance">↑ Advances</span>`
              : `<span class="trn-po-badge trn-po-badge--eliminated">Eliminated</span>`;
            const cutAfter = !isFinal && !isByeTeam && compIdx === advFromComp - 1;
            const wkCell = isByeTeam
              ? `<td class="trn-po-num dim trn-po-col-wk">—</td>${blendEnabled ? `<td class="trn-po-num dim trn-po-col-avg">—</td><td class="trn-po-num dim trn-po-col-blend">—</td>` : ""}`
              : blendEnabled
                ? `<td class="trn-po-num trn-po-pf trn-po-col-wk">${tm.wkScore != null ? tm.wkScore.toFixed(2) : "—"}</td>
                   <td class="trn-po-num trn-po-col-avg">${tm.regAvgPW.toFixed(2)}</td>
                   <td class="trn-po-num trn-po-pf trn-po-col-blend">${tm.bScore != null ? tm.bScore.toFixed(2) : "—"}</td>`
                : `<td class="trn-po-num trn-po-pf">${tm.wkScore != null ? tm.wkScore.toFixed(2) : "—"}</td>`;
            return `<tr class="${rowCls}">
              <td class="trn-po-rank">${i+1}</td>
              <td class="trn-po-team-name">
                <div>${_esc(_displayName(tm))}</div>
                <div class="trn-po-team-sub">${_esc(tm.leagueName||"—")}</div>
              </td>
              ${wkCell}
              <td>${badge}</td>
            </tr>${cutAfter ? `<tr class="trn-po-cut-row"><td colspan="${colSpan}"><div class="trn-po-cut-divider">— Cut Line — ${advFromComp} advance · ${competitors - advFromComp} eliminated</div></td></tr>` : ""}`;
          }).join("");

          const table  = document.getElementById(tableId);
          const loader = document.getElementById(loaderId);
          if (table) {
            table.querySelector("tbody").innerHTML = rows;
            table.style.display = "";
            // Mark bye rows with a class so they can be toggled
            table.querySelectorAll("tbody tr").forEach((tr, idx) => {
              if (idx < poolByes) tr.classList.add("trn-po-bye-row-data");
            });
          }
          if (loader) loader.style.display = "none";

          // Bye collapse bar
          if (poolByes > 0) {
            const byeBar = document.getElementById(tableId + "-bye-bar");
            if (byeBar) {
              let byesVisible = false;
              const _updateByeBar = () => {
                byeBar.innerHTML = `<button class="trn-po-bye-toggle" onclick="">
                  ${byesVisible ? "▼" : "▶"} ${byesVisible ? "Hide" : "Show"} ${poolByes} bye${poolByes!==1?"s":""} (auto-advance)
                </button>`;
                byeBar.style.display = "";
                table.querySelectorAll(".trn-po-bye-row-data").forEach(tr => {
                  tr.style.display = byesVisible ? "" : "none";
                });
                byeBar.querySelector("button").onclick = () => {
                  byesVisible = !byesVisible;
                  _updateByeBar();
                };
              };
              _updateByeBar(); // start collapsed
            }
          }

        } catch(e) {
          const loader = document.getElementById(loaderId);
          if (loader) loader.textContent = "⚠️ Could not load round data: " + e.message;
          console.error("[Playoffs] Round render error:", e);
        }
      })();

      return shell;
    };


    // ── H2H bracket ──────────────────────────────────────
    const _renderBracket = () => {
      const bracketSize = po.bracketSize || 8;
      const seeds = sortedTeams.slice(0, bracketSize);
      const numRounds = Math.log2(bracketSize);
      const r1Byes = seeds.slice(0, byeCount);
      const r1Players = seeds.slice(byeCount);
      const r1Matchups = [];
      for (let i = 0; i < Math.floor(r1Players.length/2); i++)
        r1Matchups.push({ a:r1Players[i], b:r1Players[r1Players.length-1-i] });
      const getRoundName = (ri, tot) =>
        ri===tot-1?"🏆 Championship":ri===tot-2?"Semifinals":ri===tot-3?"Quarterfinals":`Round ${ri+1}`;
      return `
        <div class="trn-po-bracket-note">
          ${bracketSize}-team bracket · ${byeCount>0?`${byeCount} first-round bye${byeCount!==1?"s":""}`:""} · Seeded by ${po.seeding?.method==="pf"?"Points For":"Record"}
        </div>
        <div class="trn-po-bracket-wrap"><div class="trn-po-bracket">
          <div class="trn-po-bracket-round">
            <div class="trn-po-bracket-round-title">${getRoundName(0,numRounds)}</div>
            ${r1Byes.map(tm=>`<div class="trn-po-matchup trn-po-matchup--bye"><div class="trn-po-matchup-row">
              <span class="trn-po-matchup-seed">#${seeds.indexOf(tm)+1}</span>
              <span class="trn-po-matchup-team trn-po-matchup-team--bye">${_esc(_displayName(tm))}</span>
              <span class="trn-po-badge trn-po-badge--bye" style="margin-left:auto">BYE</span>
            </div></div>`).join("")}
            ${r1Matchups.map(m=>`<div class="trn-po-matchup">
              <div class="trn-po-matchup-row"><span class="trn-po-matchup-seed">#${seeds.indexOf(m.a)+1}</span><span class="trn-po-matchup-team">${_esc(m.a ? _displayName(m.a) : "TBD")}</span><span class="trn-po-matchup-pf">${(m.a?.pf||0).toFixed(1)}</span></div>
              <div class="trn-po-matchup-vs">vs</div>
              <div class="trn-po-matchup-row"><span class="trn-po-matchup-seed">#${seeds.indexOf(m.b)+1}</span><span class="trn-po-matchup-team">${_esc(m.b ? _displayName(m.b) : "TBD")}</span><span class="trn-po-matchup-pf">${(m.b?.pf||0).toFixed(1)}</span></div>
            </div>`).join("")}
          </div>
          ${Array.from({length:numRounds-1},(_,ri)=>`<div class="trn-po-bracket-round">
            <div class="trn-po-bracket-round-title">${getRoundName(ri+1,numRounds)}</div>
            ${Array.from({length:Math.pow(2,numRounds-ri-2)},()=>`<div class="trn-po-matchup trn-po-matchup--tbd">
              <div class="trn-po-matchup-row"><span class="trn-po-matchup-team trn-po-tbd">TBD</span></div>
              <div class="trn-po-matchup-vs">vs</div>
              <div class="trn-po-matchup-row"><span class="trn-po-matchup-team trn-po-tbd">TBD</span></div>
            </div>`).join("")}
          </div>`).join("")}
        </div></div>
        <div class="trn-po-seed-list">
          <div class="trn-po-section-title">Seedings</div>
          ${seeds.map((tm,i)=>`<div class="trn-po-seed-row ${i<byeCount?"trn-po-seed-row--bye":""}">
            <span class="trn-po-seed-num">#${i+1}</span>
            <span class="trn-po-seed-name">${_esc(_displayName(tm))}</span>
            <span class="trn-po-seed-league">${_esc(tm.leagueName||"")}</span>
            <span class="trn-po-seed-record">${tm.wins??0}–${tm.losses??0}</span>
            <span class="trn-po-seed-pf">${(tm.pf||0).toFixed(1)} pts</span>
            ${i<byeCount?`<span class="trn-po-badge trn-po-badge--bye">BYE</span>`:""}
          </div>`).join("")}
        </div>`;
    };

    // ── Custom round tab ─────────────────────────────────
    const _renderCustomRound = (roundIdx) => {
      const rounds = po.customRounds?.rounds || [];
      const round  = rounds[roundIdx];
      if (!round) return `<div class="trn-po-empty">Round not configured.</div>`;
      const isFinal = roundIdx === rounds.length - 1;
      const weekNum = po.startWeek ? po.startWeek + roundIdx : null;
      const pool = sortedTeams.slice(0, round.groups * round.teamsPerGroup);
      return `
        <div class="trn-po-round-card ${isFinal?"trn-po-round-card--final":""}">
          <div class="trn-po-round-header">
            <span>${isFinal?"🏆 Championship":`Round ${roundIdx+1}`}</span>
            ${weekNum?`<span class="trn-po-week-tag">Week ${weekNum}</span>`:""}
            <span class="trn-po-round-meta">${round.groups} group${round.groups!==1?"s":""} of ${round.teamsPerGroup} · ${round.groups*(round.advPerGroup||0)} advance</span>
          </div>
          ${roundIdx===0&&byeCount>0?`<div class="trn-po-bye-row"><span class="trn-po-badge trn-po-badge--bye">BYE</span><span style="font-size:.82rem;color:var(--color-text-dim)"> Top ${byeCount} advance automatically</span></div>`:""}
        </div>
        <div class="trn-po-groups-wrap" style="margin-top:var(--space-2)">
          ${Array.from({length:round.groups},(_,gi)=>{
            const groupTeams = pool.slice(gi*round.teamsPerGroup,(gi+1)*round.teamsPerGroup);
            return `<div class="trn-po-group-card">
              <div class="trn-po-group-title">Group ${gi+1}</div>
              ${groupTeams.map((tm,ti)=>{
                const isByeTeam = roundIdx===0 && sortedTeams.indexOf(tm)<byeCount;
                const adv = isByeTeam || ti<round.advPerGroup;
                return `<div class="trn-po-group-row ${adv?"trn-po-row--advance":"trn-po-row--cut"}">
                  <span class="trn-po-rank">${ti+1}</span>
                  <span class="trn-po-team-name">${_esc(_displayName(tm))}</span>
                  <span class="trn-po-pf" style="margin-left:auto">${(tm.pf||0).toFixed(1)}</span>
                  ${isByeTeam?'<span class="trn-po-badge trn-po-badge--bye">BYE</span>'
                    :adv?'<span class="trn-po-badge trn-po-badge--advance">↑</span>'
                    :'<span class="trn-po-badge trn-po-badge--eliminated">✕</span>'}
                </div>`;
              }).join("")}
            </div>`;
          }).join("")}
        </div>`;
    };

    // ── World Cup: Group standings tab ───────────────────────────────────────
    // Computes W–L records and H2H tiebreakers from the admin-defined schedule
    // by fetching each team's score for the relevant Sleeper week.
    // Groups are shown as a round-robin table with full tiebreaker chain.
    const _renderWCGroup = (gi) => {
      const groups  = po.worldcupGroups || [];
      const group   = groups[gi];
      if (!group) return `<div class="trn-po-empty">Group ${gi+1} not configured. Set it up in Admin → Playoffs → Group &amp; Schedule Config.</div>`;
      const advCount= group.advanceCount ?? (po.worldcupAdvanceCount ?? 2);
      const members = group.members || [];
      if (!members.length) return `<div class="trn-po-empty">No teams assigned to ${_esc(group.name||("Group "+(gi+1)))} yet.</div>`;

      const schedule    = (po.worldcupSchedule || {})[String(gi)] || {};
      const regWeeks    = po.worldcupRegWeeks || 6;
      const startWeekPo = po.startWeek || null; // week 1 of the tournament maps to NFL week = startWeek (if set)

      // tableId for async score loading
      const tableId   = `trn-wc-group-table-${gi}`;
      const loaderId  = `trn-wc-group-loader-${gi}`;

      // Shell renders synchronously; scores loaded async
      const shell = `
        <div class="trn-po-round-card">
          <div class="trn-po-round-header">
            <span>🌍 ${_esc(group.name||("Group "+(gi+1)))}</span>
            <span class="trn-po-round-meta">${members.length} teams · ${advCount} advance · ${regWeeks}-week regular season</span>
          </div>
        </div>
        <div class="trn-po-table-wrap" style="margin-top:var(--space-2)">
          <div id="${loaderId}" style="font-size:.8rem;color:var(--color-text-dim);padding:var(--space-2) 0">
            ⏳ Loading scores…
          </div>
          <table class="trn-po-table trn-wc-group-table" id="${tableId}" style="display:none">
            <thead><tr>
              <th>#</th><th>Team</th>
              <th class="trn-po-th-num" title="Wins in group">W</th>
              <th class="trn-po-th-num" title="Losses in group">L</th>
              <th class="trn-po-th-num" title="Points scored in group games">PF</th>
              <th class="trn-po-th-num" title="Points against in group games">PA</th>
              <th>Status</th>
            </tr></thead>
            <tbody></tbody>
          </table>
          <div id="${tableId}-tiebreak-note" style="font-size:.72rem;color:var(--color-text-dim);margin-top:4px;display:none"></div>
        </div>`;

      // ── Async: fetch scores, compute standings with tiebreakers ─────────────
      (async () => {
        try {
          // Build record map per member: { wins, losses, pf, pa }
          const records = {};
          members.forEach(name => { records[name] = { wins:0, losses:0, pf:0, pa:0, h2h:{} }; });

          // Map from team display name → { teamId, leagueId } via standingsCache
          const _sk = (s) => String(s||"").trim().toLowerCase().replace(/[.#$\/\[\]]/g,"_");
          const teamInfoMap = {}; // displayName -> { teamId, leagueId }
          Object.entries(t.standingsCache||{}).forEach(([ck, lc]) => {
            if (String(lc.year) !== String(activeY)) return;
            const lid = lc.leagueId || ck.replace(/^\d+_/,"");
            (lc.teams||[]).forEach(tm => {
              const dn = tm.teamName || "";
              if (dn) teamInfoMap[dn] = { teamId: String(tm.teamId||""), leagueId: lid };
            });
          });

          // Fetch scores for each scheduled week
          // The schedule week index maps to NFL week: scheduleWeekIndex + 1 (if no startWeek),
          // or startWeek - regWeeks + scheduleWeekIndex (so week 0 = week (startWeek-regWeeks))
          // Most flexible: just use week index + 1 as NFL week offset unless startWeek tells us where group play begins.
          // If startWeek is set, group week 0 = NFL week (startWeek - regWeeks), assuming playoff starts right after group stage.
          const _nflWeek = (wi) => startWeekPo ? (startWeekPo - regWeeks + wi) : (wi + 1);

          // Collect all unique weeks and leagueIds needed
          const weeksNeeded = new Set();
          const leagueIds   = new Set();
          for (let wi = 0; wi < regWeeks; wi++) {
            const wkMatchups = schedule[String(wi)] || [];
            if (wkMatchups.length) {
              weeksNeeded.add(_nflWeek(wi));
              members.forEach(name => {
                const info = teamInfoMap[name];
                if (info?.leagueId) leagueIds.add(info.leagueId);
              });
            }
          }

          // Fetch all needed weekly score maps
          await Promise.all([...leagueIds].flatMap(lid => [...weeksNeeded].map(w => _fetchWeekScores(lid, w))));

          // Now compute W–L from schedule
          let tiebreakUsed = false;
          for (let wi = 0; wi < regWeeks; wi++) {
            const wkMatchups = schedule[String(wi)] || [];
            const nflWk = _nflWeek(wi);
            wkMatchups.forEach(({ home, away }) => {
              if (!home || !away || home === away) return;
              if (!records[home] || !records[away]) return;
              const homeInfo = teamInfoMap[home];
              const awayInfo = teamInfoMap[away];
              const homeScore = homeInfo ? (_weekScoreCache[homeInfo.leagueId+"|"+nflWk]?.[homeInfo.teamId] ?? null) : null;
              const awayScore = awayInfo ? (_weekScoreCache[awayInfo.leagueId+"|"+nflWk]?.[awayInfo.teamId] ?? null) : null;

              if (homeScore !== null && awayScore !== null) {
                records[home].pf += homeScore; records[home].pa += awayScore;
                records[away].pf += awayScore; records[away].pa += homeScore;
                if (homeScore > awayScore) {
                  records[home].wins++; records[away].losses++;
                  records[home].h2h[away] = (records[home].h2h[away]||0) + 1;
                  records[away].h2h[home] = (records[away].h2h[home]||0) - 1;
                } else if (awayScore > homeScore) {
                  records[away].wins++; records[home].losses++;
                  records[away].h2h[home] = (records[away].h2h[home]||0) + 1;
                  records[home].h2h[away] = (records[home].h2h[away]||0) - 1;
                }
              }
            });
          }

          // Sort members: wins desc → H2H record (among tied) → PF desc
          const sorted = [...members].sort((a, b) => {
            const wa = records[a].wins, wb = records[b].wins;
            if (wb !== wa) return wb - wa;
            // H2H tiebreaker (only between the two tied teams)
            tiebreakUsed = true;
            const h2hNet = (records[a].h2h[b]||0) - (records[b].h2h[a]||0);
            if (h2hNet !== 0) return -h2hNet; // positive = a beat b more
            // PF differential in H2H matchups would need score-level data — fallback to total PF
            return records[b].pf - records[a].pf;
          });

          // Build table rows
          const rows = sorted.map((name, i) => {
            const r     = records[name];
            const isAdv = i < advCount;
            const rowCls = isAdv ? "trn-po-row--advance" : "trn-po-row--cut";
            const badge  = isAdv
              ? `<span class="trn-po-badge trn-po-badge--advance">↑ Advances</span>`
              : `<span class="trn-po-badge trn-po-badge--eliminated">Eliminated</span>`;
            const info = teamInfoMap[name] || {};
            const lc   = Object.values(t.standingsCache||{}).find(lc => String(lc.year)===String(activeY) && (lc.teams||[]).some(tm=>tm.teamName===name));
            return `<tr class="${rowCls}">
              <td class="trn-po-rank">${i+1}</td>
              <td class="trn-po-team-name">
                <div>${_esc(name)}</div>
                ${lc ? `<div class="trn-po-team-sub">${_esc(lc.leagueName||"")}</div>` : ""}
              </td>
              <td class="trn-po-num">${r.wins}</td>
              <td class="trn-po-num">${r.losses}</td>
              <td class="trn-po-num trn-po-pf">${r.pf.toFixed(2)}</td>
              <td class="trn-po-num">${r.pa.toFixed(2)}</td>
              <td>${badge}</td>
            </tr>`;
          }).join("");

          const cutRow = advCount < sorted.length
            ? `<tr class="trn-po-cut-row"><td colspan="7"><div class="trn-po-cut-divider">— ${advCount} advance · ${sorted.length-advCount} eliminated —</div></td></tr>`
            : "";

          const tbl    = document.getElementById(tableId);
          const loader = document.getElementById(loaderId);
          if (tbl)    { tbl.querySelector("tbody").innerHTML = rows + cutRow; tbl.style.display = ""; }
          if (loader) loader.style.display = "none";
          const note  = document.getElementById(tableId+"-tiebreak-note");
          if (note)   { note.textContent = tiebreakUsed ? "⚠️ Tiebreaker applied: H2H record, then Points For" : ""; note.style.display = tiebreakUsed ? "" : "none"; }
        } catch(e) {
          const loader = document.getElementById(loaderId);
          if (loader) loader.textContent = "⚠️ Could not load scores: " + e.message;
        }
      })();

      return shell;
    };

    // ── World Cup: Bracket tab ────────────────────────────────────────────────
    // Before bracket is seeded: admin sees group advancers as reference + seed editor.
    // After seeding: renders a visual bracket (same layout as H2H bracket).
    const _renderWCBracket = () => {
      const bracketSeeds = po.worldcupBracket || [];
      const wcWPR        = po.worldcupWeeksPerRound || 2;
      const startWeekPo  = po.startWeek || null;

      const _sk = (s) => String(s||"").trim().toLowerCase().replace(/[.#$\/\[\]]/g,"_");
      const _lookupTeam = (name) => {
        for (const lc of Object.values(t.standingsCache||{})) {
          if (String(lc.year) !== String(activeY)) continue;
          const tm = (lc.teams||[]).find(tm => _sk(tm.teamName) === _sk(name));
          if (tm) return { displayName:name, teamName:tm.teamName, pf:tm.pf||0, wins:tm.wins||0, losses:tm.losses||0, leagueName:lc.leagueName||"", teamId:String(tm.teamId||""), leagueId:String(lc.leagueId||lc.league_id||"") };
        }
        return { displayName:name, teamName:name, pf:0, wins:0, losses:0, leagueName:"", teamId:"", leagueId:"" };
      };

      if (!bracketSeeds.length) {
        // Admin view: let them seed the bracket from group results
        const groups = po.worldcupGroups || [];
        const advancers = groups.flatMap((g,gi) =>
          (g.members||[]).slice(0, g.advanceCount ?? (po.worldcupAdvanceCount??2))
            .map((name,pos) => ({ name, groupName: g.name||("Group "+(gi+1)), pos }))
        );

        if (!tid) return `<div class="trn-po-empty">Bracket not yet seeded. The admin will place teams after group stage.</div>`;

        const groupRef = groups.map((g,gi) => {
          const adv = g.advanceCount ?? (po.worldcupAdvanceCount??2);
          const chips = (g.members||[]).slice(0,adv).map((n,i)=>`<span class="trn-wc-seed-chip">#${i+1} ${_esc(n)}</span>`).join("");
          return `<div style="margin-bottom:var(--space-2)"><div style="font-weight:700;font-size:.82rem;margin-bottom:4px">${_esc(g.name||("Group "+(gi+1)))}</div><div style="display:flex;flex-wrap:wrap;gap:4px">${chips}</div></div>`;
        }).join("");

        const seedRows = advancers.map((tm,i)=>`
          <div class="trn-wc-seed-row" data-idx="${i}">
            <span class="trn-wc-seed-num">${i+1}</span>
            <input type="text" class="trn-wc-seed-input" data-idx="${i}" value="${_esc(tm.name)}"
              placeholder="Team name"
              style="flex:1;font-size:.82rem;padding:3px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text)" />
            <span style="font-size:.72rem;color:var(--color-text-dim)">${_esc(tm.groupName)}</span>
          </div>`).join("");

        return `
          <div class="trn-po-tp-note">
            <strong>Step 1:</strong> Confirm which teams advance in each group (set "Advance to bracket" on each group card in Group &amp; Schedule Config).<br>
            <strong>Step 2:</strong> Once group play ends, come back here and arrange the seed order below.<br>
            <strong>Step 3:</strong> Hit "Save &amp; Lock Bracket" — this creates the knockout bracket.
            ${wcWPR > 1 ? `<br><strong>Each round spans ${wcWPR} weeks</strong> — scores are combined.` : ""}
            ${startWeekPo ? `<br><strong>Bracket begins Week ${startWeekPo}.</strong>` : `<br><em>Tip: Set a Playoff Start Week in Playoff Format so live scores are tracked.</em>`}
          </div>
          ${groups.length ? `
            <div class="trn-section-card" style="margin-bottom:var(--space-3)">
              <div class="trn-section-card-title">Group Advancers — reference</div>
              <div style="font-size:.74rem;color:var(--color-text-dim);margin-bottom:var(--space-2)">Based on saved advance counts. Edit seed order below to set actual bracket matchups.</div>
              ${groupRef}
            </div>` : `
            <div class="trn-section-card" style="margin-bottom:var(--space-3)">
              <div class="trn-po-empty" style="padding:var(--space-4) 0">No groups configured yet. Go to Group &amp; Schedule Config to set up groups and assign teams.</div>
            </div>`}
          <div class="trn-section-card">
            <div class="trn-section-card-title">Bracket Seeds</div>
            <div style="font-size:.74rem;color:var(--color-text-dim);margin-bottom:var(--space-3)">
              Edit the team names in seed order. Matchup pairing: <strong>Seed 1 vs Seed ${advancers.length || "N"}</strong>, <strong>Seed 2 vs Seed ${advancers.length ? advancers.length-1 : "N−1"}</strong>, etc.
              Add rows for any additional teams (wildcards, extra advancers, etc.).
            </div>
            <div id="trn-wc-seed-list" style="display:flex;flex-direction:column;gap:var(--space-2)">
              ${seedRows || `<div style="color:var(--color-text-dim);font-size:.82rem;font-style:italic">No group advancers yet — add groups and set advance counts first, then return here.</div>`}
            </div>
            <div style="display:flex;gap:var(--space-2);margin-top:var(--space-3);flex-wrap:wrap;align-items:center">
              <button class="btn-primary btn-sm" id="trn-wc-seed-save">🔒 Save &amp; Lock Bracket</button>
              <button class="btn-secondary btn-xs" id="trn-wc-seed-add">+ Add Row</button>
              <span style="font-size:.74rem;color:var(--color-text-dim)">After locking, use "✏ Adjust Seeding" to unlock and change the order.</span>
            </div>
          </div>`;
      }

      // Bracket seeded — render visual bracket
      const seeds      = bracketSeeds.map(_lookupTeam);
      const numSeeds   = seeds.length;
      const numRounds  = Math.ceil(Math.log2(Math.max(numSeeds, 2)));
      const wcByeCount = (po.byes?.type !== "none") ? (po.byes?.count || 0) : 0;
      const r1Byes     = seeds.slice(0, wcByeCount);
      const r1Players  = seeds.slice(wcByeCount);
      const r1Matchups = [];
      for (let i = 0; i < Math.floor(r1Players.length/2); i++)
        r1Matchups.push({ a:r1Players[i], b:r1Players[r1Players.length-1-i] });
      const getRoundName = (ri, tot) =>
        ri===tot-1?"🏆 Championship":ri===tot-2?"Semifinals":ri===tot-3?"Quarterfinals":`Round ${ri+1}`;

      return `
        <div class="trn-po-bracket-note">
          ${numSeeds}-team bracket
          ${wcByeCount > 0 ? ` · ${wcByeCount} first-round bye${wcByeCount!==1?"s":""}` : ""}
          · ${wcWPR} week${wcWPR!==1?"s":""}/round
          ${startWeekPo
            ? ` · Round 1: Week${wcWPR > 1 ? `s ${startWeekPo}–${startWeekPo+wcWPR-1}` : " "+startWeekPo}`
            : " · Set Playoff Start Week in Playoff Format to enable live scores"}
        </div>
        ${tid ? `<div style="text-align:right;margin-bottom:var(--space-2)"><button class="btn-secondary btn-xs" id="trn-wc-reseed-btn">✏ Adjust Seeding</button></div>` : ""}
        <div class="trn-po-bracket-wrap"><div class="trn-po-bracket">
          <div class="trn-po-bracket-round">
            <div class="trn-po-bracket-round-title">
              ${getRoundName(0,numRounds)}
              ${startWeekPo ? `<span class="trn-po-week-tag">${wcWPR>1?`Wks ${startWeekPo}–${startWeekPo+wcWPR-1}`:`Wk ${startWeekPo}`}</span>` : ""}
            </div>
            ${r1Byes.map(tm=>`<div class="trn-po-matchup trn-po-matchup--bye"><div class="trn-po-matchup-row">
              <span class="trn-po-matchup-seed">#${seeds.indexOf(tm)+1}</span>
              <span class="trn-po-matchup-team trn-po-matchup-team--bye">${_esc(tm.displayName)}</span>
              <span class="trn-po-badge trn-po-badge--bye" style="margin-left:auto">BYE</span>
            </div></div>`).join("")}
            ${r1Matchups.map(m=>`<div class="trn-po-matchup">
              <div class="trn-po-matchup-row"><span class="trn-po-matchup-seed">#${seeds.indexOf(m.a)+1}</span><span class="trn-po-matchup-team">${_esc(m.a.displayName)}</span><span class="trn-po-matchup-pf">${m.a.pf.toFixed(1)}</span></div>
              <div class="trn-po-matchup-vs">vs</div>
              <div class="trn-po-matchup-row"><span class="trn-po-matchup-seed">#${seeds.indexOf(m.b)+1}</span><span class="trn-po-matchup-team">${_esc(m.b.displayName)}</span><span class="trn-po-matchup-pf">${m.b.pf.toFixed(1)}</span></div>
            </div>`).join("")}
          </div>
          ${Array.from({length:numRounds-1},(_,ri)=>{
            const rStartWk = startWeekPo ? startWeekPo + (ri+1)*wcWPR : null;
            const weekTag  = rStartWk
              ? `<span class="trn-po-week-tag">${wcWPR>1?`Wks ${rStartWk}–${rStartWk+wcWPR-1}`:`Wk ${rStartWk}`}</span>`
              : "";
            return `<div class="trn-po-bracket-round">
              <div class="trn-po-bracket-round-title">${getRoundName(ri+1,numRounds)} ${weekTag}</div>
              ${Array.from({length:Math.pow(2,numRounds-ri-2)},()=>`<div class="trn-po-matchup trn-po-matchup--tbd">
                <div class="trn-po-matchup-row"><span class="trn-po-matchup-team trn-po-tbd">TBD</span></div>
                <div class="trn-po-matchup-vs">vs</div>
                <div class="trn-po-matchup-row"><span class="trn-po-matchup-team trn-po-tbd">TBD</span></div>
              </div>`).join("")}
            </div>`;
          }).join("")}
        </div></div>
        <div class="trn-po-seed-list">
          <div class="trn-po-section-title">Bracket Seeds</div>
          ${seeds.map((tm,i)=>`<div class="trn-po-seed-row ${i<wcByeCount?"trn-po-seed-row--bye":""}">
            <span class="trn-po-seed-num">#${i+1}</span>
            <span class="trn-po-seed-name">${_esc(tm.displayName)}</span>
            <span class="trn-po-seed-league">${_esc(tm.leagueName)}</span>
            <span class="trn-po-seed-record">${tm.wins}–${tm.losses}</span>
            <span class="trn-po-seed-pf">${tm.pf.toFixed(1)} pts</span>
            ${i<wcByeCount?`<span class="trn-po-badge trn-po-badge--bye">BYE</span>`:""}
          </div>`).join("")}
        </div>`;
    };

    // ── League champs ────────────────────────────────────
    const _renderLeagueChamps = () => {
      const _getChamp = (lc) => {
        if (lc.champion) return lc.champion;
        if (!lc.teams?.length) return null;
        return [...lc.teams].sort((a,b)=>(b.wins||0)-(a.wins||0)||(b.pf||0)-(a.pf||0))[0]||null;
      };
      const entries = Object.entries(t.standingsCache||{})
        .filter(([,lc]) => String(lc.year) === String(activeY))
        .sort(([,a],[,b]) => (a.leagueName||"").localeCompare(b.leagueName||""))
        .map(([,lc]) => {
          const champ = _getChamp(lc);
          if (!champ) return null;
          return {
            isPlayoff: champ.isPlayoffChampion === true,
            name: _esc(displayNameMap[_skPo(champ.teamName)] || champ.teamName || "Unknown"),
            league: _esc(lc.leagueName || ""),
            record: `${champ.wins??0}–${champ.losses??0} · ${(champ.pf||0).toFixed(1)} pts`
          };
        }).filter(Boolean);

      if (!entries.length)
        return `<div class="trn-po-empty">No standings data yet. Run Sync Standings first.</div>`;

      // Split into two groups
      const playoffChamps = entries.filter(e => e.isPlayoff);
      const regLeaders    = entries.filter(e => !e.isPlayoff);

      const _card = (e) => `
        <div class="trn-po-champ-card">
          <div class="trn-po-champ-info">
            <div class="trn-po-champ-name">${e.name}</div>
            <div class="trn-po-champ-league">${e.league}</div>
          </div>
          <div class="trn-po-champ-record">${e.record}</div>
        </div>`;

      const _section = (title, icon, items) => items.length === 0 ? "" : `
        <div class="trn-po-champ-section">
          <div class="trn-po-champ-section-title">${icon} ${title}</div>
          <div class="trn-po-champ-grid">
            ${items.map(_card).join("")}
          </div>
        </div>`;

      return _section("League Champions (Playoff Winners)", "🏆", playoffChamps)
           + _section("Regular Season Leaders", "📊", regLeaders);
    }

    // ── Render active tab ─────────────────────────────────
    const _renderContent = (tabId) => {
      if (tabId==="standings")     return _renderStandingsView();
      if (tabId==="leaderboard")   return _renderLeaderboard();
      if (tabId==="bracket")       return _renderBracket();
      if (tabId==="league_champs") return _renderLeagueChamps();
      if (tabId==="wc_bracket")    return _renderWCBracket();
      if (tabId.startsWith("round_"))   return _renderPointsRound(parseInt(tabId.split("_")[1]));
      if (tabId.startsWith("cround_"))  return _renderCustomRound(parseInt(tabId.split("_")[1]));
      if (tabId.startsWith("wcgroup_")) return _renderWCGroup(parseInt(tabId.split("_")[1]));
      return `<div class="trn-po-empty">Unknown tab.</div>`;
    };

    body.innerHTML = `
      <div class="trn-po-container">
        <div class="trn-po-header">
          <div class="trn-po-title">
            ${{total_points:"📊",points_rounds:"📈",h2h_bracket:"🥊",custom_rounds:"⚙️",worldcup:"🌍"}[mode]||"🏆"}
            Playoffs <span class="trn-po-year-badge">${activeY}</span>
          </div>
          <div class="trn-po-mode-chip">${{total_points:"Total Points",points_rounds:"Points Rounds",h2h_bracket:"H2H Bracket",custom_rounds:"Custom Rounds",worldcup:"World Cup"}[mode]||mode}</div>
          ${tid ? `<button class="btn-secondary btn-sm" id="trn-po-publish-btn" style="margin-left:auto">📢 Publish</button>` : ""}
        </div>
        ${_tabBar(_poViewTab)}
        <div id="trn-po-content">${_renderContent(_poViewTab)}</div>
      </div>`;

    body.querySelectorAll(".trn-po-subtab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        _poViewTab = btn.dataset.subtab;
        body.querySelectorAll(".trn-po-subtab-btn").forEach(b =>
          b.classList.toggle("trn-po-subtab-btn--active", b.dataset.subtab===_poViewTab));
        const sel = document.getElementById("trn-po-tab-select");
        if (sel) sel.value = _poViewTab;
        document.getElementById("trn-po-content").innerHTML = _renderContent(_poViewTab);
        _wcWireBracketButtons();
      });
    });
    document.getElementById("trn-po-tab-select")?.addEventListener("change", function() {
      _poViewTab = this.value;
      body.querySelectorAll(".trn-po-subtab-btn").forEach(b =>
        b.classList.toggle("trn-po-subtab-btn--active", b.dataset.subtab===_poViewTab));
      document.getElementById("trn-po-content").innerHTML = _renderContent(_poViewTab);
      _wcWireBracketButtons();
    });

    // Wire WC bracket seed-save + re-seed buttons (called after any WC tab render)
    const _wcWireBracketButtons = () => {
      document.getElementById("trn-wc-seed-save")?.addEventListener("click", async () => {
        const inputs = document.querySelectorAll(".trn-wc-seed-input");
        const seeds  = Array.from(inputs).map(inp => inp.value.trim()).filter(Boolean);
        if (!seeds.length) { showToast("Enter at least one seed","error"); return; }
        try {
          await _tPlayoffsRef(tid, activeY).update({ worldcupBracket: seeds });
          Object.assign(_poLocal(), { worldcupBracket: seeds });
          showToast(`Bracket locked — ${seeds.length} seeds ✓`);
          document.getElementById("trn-po-content").innerHTML = _renderContent("wc_bracket");
          _wcWireBracketButtons();
        } catch(e) { showToast("Failed: "+e.message,"error"); }
      });
      document.getElementById("trn-wc-seed-add")?.addEventListener("click", () => {
        const list = document.getElementById("trn-wc-seed-list");
        if (!list) return;
        const idx = list.querySelectorAll(".trn-wc-seed-row").length;
        const row = document.createElement("div");
        row.className = "trn-wc-seed-row"; row.dataset.idx = idx;
        row.innerHTML = `<span class="trn-wc-seed-num">${idx+1}</span>
          <input type="text" class="trn-wc-seed-input" data-idx="${idx}" value="" placeholder="Team name"
            style="flex:1;font-size:.82rem;padding:3px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text)" />
          <span style="font-size:.72rem;color:var(--color-text-dim)"></span>`;
        list.appendChild(row);
      });
      document.getElementById("trn-wc-reseed-btn")?.addEventListener("click", () => {
        if (!confirm("Clear bracket seeding and re-enter? This only resets the seed order.")) return;
        _tPlayoffsRef(tid, activeY).update({ worldcupBracket: [] }).then(() => {
          Object.assign(_poLocal(), { worldcupBracket: [] });
          document.getElementById("trn-po-content").innerHTML = _renderContent("wc_bracket");
          _wcWireBracketButtons();
        }).catch(e => showToast("Failed: "+e.message,"error"));
      });
    };
    _wcWireBracketButtons();
    // Shared snapshot builder — single source of truth for both manual + auto publish
    const _buildPlayoffSnapshot = () => {
      // Standings: qualified-first (sorted by PF desc), then eliminated (by PF desc)
      // This matches the internal display order
      const qualTeams = sortedTeams.filter(tm => qualSet.has(_teamKey(tm)));
      const elimTeams = sortedTeams.filter(tm => !qualSet.has(_teamKey(tm)));
      const orderedTeams = [...qualTeams, ...elimTeams];

      // Build league champs array from standingsCache (same logic as _renderLeagueChamps)
      const _getChamp = (lc) => {
        if (lc.champion) return lc.champion;
        if (!lc.teams?.length) return null;
        return [...lc.teams].sort((a,b)=>(b.wins||0)-(a.wins||0)||(b.pf||0)-(a.pf||0))[0]||null;
      };
      const leagueChamps = Object.entries(t.standingsCache||{})
        .filter(([,lc]) => String(lc.year) === String(activeY))
        .sort(([,a],[,b]) => (a.leagueName||"").localeCompare(b.leagueName||""))
        .map(([,lc]) => {
          const champ = _getChamp(lc);
          if (!champ) return null;
          return {
            isPlayoff:   champ.isPlayoffChampion === true,
            teamName:    champ.teamName || "",
            displayName: displayNameMap[_skPo(champ.teamName)] || champ.teamName || "Unknown",
            leagueName:  lc.leagueName || "",
            wins:        champ.wins  ?? 0,
            losses:      champ.losses ?? 0,
            pf:          champ.pf    || 0
          };
        }).filter(Boolean);

      // Include per-team weekly scores from cache so public site can sort rounds
      // correctly without needing live Sleeper API access.
      // Structure: weeklyScores[leagueId][week][rosterId] = points
      const weeklyScores = {};
      Object.entries(_weekScoreCache || {}).forEach(([key, scoreMap]) => {
        const [lid, wk] = key.split("|");
        if (!lid || !wk) return;
        if (!weeklyScores[lid]) weeklyScores[lid] = {};
        weeklyScores[lid][wk] = scoreMap;
      });

      // Also include leagueId on each standing entry so public site can look up scores
      const _leagueIdForTeam = (tm) => leagueIdByTeamKey[_teamKey(tm)] || "";

      return {
        mode, year:activeY, qualCount, byeCount,
        startWeek: po.startWeek||null, endWeek: po.endWeek||null,
        rounds: mode==="points_rounds" ? (po.pointsRounds?.rounds||[])
          : mode==="custom_rounds" ? (po.customRounds?.rounds||[]) : [],
        bracketSize: mode==="h2h_bracket" ? (po.bracketSize||null) : null,
        seeding: po.seeding||null, byes: po.byes||null,
        recognizeLeagueChampions: !!(po.recognizeLeagueChampions),
        leagueChamps,
        weeklyScores,
        standings: orderedTeams.map((tm, i) => ({
          rank:        i+1,
          teamName:    tm.teamName,
          displayName: _displayName(tm),
          leagueName:  tm.leagueName,
          division:    tm.division   || "",
          conference:  tm.conference || "",
          wins:        tm.wins,
          losses:      tm.losses,
          pf:          tm.pf,
          teamId:      tm.teamId    || "",
          leagueId:    _leagueIdForTeam(tm),
          qualified:   qualSet.has(_teamKey(tm)),
          bye:         byeSet.has(_teamKey(tm))
        })),
        publishedAt: Date.now()
      };
    };

    document.getElementById("trn-po-publish-btn")?.addEventListener("click", async () => {
      const btn = document.getElementById("trn-po-publish-btn");
      if (btn) { btn.disabled=true; btn.textContent="Fetching scores…"; }
      try {
        // Fetch all playoff weeks for all leagues before building snapshot
        // This ensures _weekScoreCache is populated even if round tabs weren't visited
        if (mode === "points_rounds" && po.startWeek) {
          const rounds_ = po.pointsRounds?.rounds || [];
          // Compute which actual NFL weeks each round spans (weeksPerRound support)
          const weeksNeeded = new Set();
          let weekCursor = po.startWeek;
          for (const r_ of rounds_) {
            const wpr_ = r_.weeksPerRound || 1;
            for (let w = 0; w < wpr_; w++) weeksNeeded.add(weekCursor + w);
            weekCursor += wpr_;
          }
          const allLeagueIds = [...new Set(
            qualifiers.map(tm => leagueIdByTeamKey[_teamKey(tm)]).filter(Boolean)
          )];
          if (btn) btn.textContent = `Fetching ${allLeagueIds.length} leagues × ${weeksNeeded.size} weeks…`;
          await Promise.all(
            [...weeksNeeded].flatMap(w => allLeagueIds.map(lid => _fetchWeekScores(lid, w)))
          );
        }

        if (mode === "h2h_bracket" && po.startWeek) {
          const bracketSize_ = po.bracketSize || qualifiers.length;
          const numRounds_   = Math.ceil(Math.log2(bracketSize_));
          const weeksNeeded_ = Array.from({length: numRounds_}, (_, i) => po.startWeek + i);
          const allLeagueIds = [...new Set(
            qualifiers.map(tm => leagueIdByTeamKey[_teamKey(tm)]).filter(Boolean)
          )];
          if (btn) btn.textContent = `Fetching ${allLeagueIds.length} leagues × ${weeksNeeded_.length} bracket weeks…`;
          await Promise.all(
            weeksNeeded_.flatMap(w => allLeagueIds.map(lid => _fetchWeekScores(lid, w)))
          );
        }

        if (mode === "worldcup") {
          // Fetch group-stage weeks for all groups
          const wcRegWks2  = po.worldcupRegWeeks  || 6;
          const wcStartPo  = po.startWeek         || null;
          const wcSched2   = po.worldcupSchedule  || {};
          const _nflWk2    = (wi) => wcStartPo ? (wcStartPo - wcRegWks2 + wi) : (wi + 1);
          const wcWeeksSet = new Set();
          for (let wi = 0; wi < wcRegWks2; wi++) {
            const wk = _nflWk2(wi);
            if (wk > 0) wcWeeksSet.add(wk);
          }
          const allLidsWC = [...new Set(
            allTeams.map(tm => leagueIdByTeamKey[_teamKey(tm)]).filter(Boolean)
          )];
          if (wcWeeksSet.size && allLidsWC.length) {
            if (btn) btn.textContent = `Fetching group-stage weeks (${allLidsWC.length} leagues × ${wcWeeksSet.size} weeks)…`;
            await Promise.all([...wcWeeksSet].flatMap(w => allLidsWC.map(lid => _fetchWeekScores(lid, w))));
          }
          // Fetch bracket weeks
          const wcBracketSeeds2 = po.worldcupBracket || [];
          const wcWPR2   = po.worldcupWeeksPerRound || 2;
          if (wcBracketSeeds2.length && wcStartPo) {
            const wcNumRounds2 = Math.ceil(Math.log2(Math.max(wcBracketSeeds2.length, 2)));
            const wcBktWeeks2  = Array.from({length: wcNumRounds2}, (_, ri) =>
              Array.from({length: wcWPR2}, (_, wi) => wcStartPo + ri * wcWPR2 + wi)
            ).flat();
            if (btn) btn.textContent = `Fetching bracket weeks (${wcBktWeeks2.length} weeks)…`;
            await Promise.all(wcBktWeeks2.flatMap(w => allLidsWC.map(lid => _fetchWeekScores(lid, w))));
          }
        }

        // Build pre-computed round results: each round gets a sorted results array
        // ready to display on the public site — no re-derivation needed
        const _computedRounds = (() => {
          if (mode !== "points_rounds") return [];
          const rounds_ = po.pointsRounds?.rounds || [];
          const regWeeks_ = po.startWeek ? po.startWeek - 1 : 14;

          // Build bye-first pool (same as _renderPointsRound)
          const _byeFirst_ = (teams) => {
            const b = _sortByMetric(teams.filter(tm => byeSet.has(_teamKey(tm))), byeMetric);
            const r = _sortByMetric(teams.filter(tm => !byeSet.has(_teamKey(tm))), byeMetric);
            return [...b, ...r];
          };

          // Helper: get combined score across one or more consecutive weeks from cache
          const _wsCombined_ = (tm, startWk, numWks) => {
            const lid = leagueIdByTeamKey[_teamKey(tm)];
            if (!lid || !startWk) return null;
            let total = 0, hasAny = false;
            for (let w = 0; w < numWks; w++) {
              const v = _weekScoreCache[lid + "|" + (startWk + w)]?.[String(tm.teamId)];
              if (v != null) { total += v; hasAny = true; }
            }
            return hasAny ? total : null;
          };

          // Pre-compute cumulative week offsets so each round knows its absolute start week
          const _roundStartWeeks_ = (() => {
            const starts = [];
            let cur = po.startWeek || 0;
            for (const r_ of rounds_) { starts.push(cur); cur += (r_.weeksPerRound || 1); }
            return starts;
          })();

          return rounds_.map((round, roundIdx) => {
            const isFinal    = roundIdx === rounds_.length - 1;
            const startWk_   = _roundStartWeeks_[roundIdx];
            const wpr_       = round.weeksPerRound || 1;
            const weekNum_   = startWk_; // first (or only) week — shown as display week
            const blend_     = round.blend;
            const blendEn_   = !!(blend_?.enabled);
            const blendWt_   = blend_?.weight ?? 30;
            const blendMd_   = blend_?.mode || "weighted";

            // Simulate pool through previous rounds (each using its own startWk + wpr)
            let pool_ = _byeFirst_([...qualifiers]);
            for (let ri = 0; ri < roundIdx; ri++) {
              const r_    = rounds_[ri];
              const rWk_  = _roundStartWeeks_[ri];
              const rWpr_ = r_.weeksPerRound || 1;
              const rByes_ = ri === 0 ? byeCount : 0;
              const byeSec_ = pool_.slice(0, rByes_);
              const compSec_ = pool_.slice(rByes_);
              const adv_ = r_.advanceMethod === "pct"
                ? Math.round(compSec_.length * (r_.advancePct || 50) / 100)
                : (r_.advanceCount || 0);
              const sorted_ = [...compSec_].sort((a, b) => {
                const sa = _wsCombined_(a, rWk_, rWpr_) ?? -1;
                const sb = _wsCombined_(b, rWk_, rWpr_) ?? -1;
                return sb !== sa ? sb - sa : (b.pf||0) - (a.pf||0);
              });
              pool_ = [...byeSec_, ...sorted_.slice(0, adv_)];
            }

            const poolByes_    = roundIdx === 0 ? byeCount : 0;
            const competitors_ = pool_.length - poolByes_;
            const advCount_    = isFinal ? 1
              : round.advanceMethod === "pct"
                ? Math.round(competitors_ * (round.advancePct || 50) / 100)
                : (round.advanceCount || 0);

            // Score and sort (combined score across wpr_ weeks)
            const byeSec2_  = pool_.slice(0, poolByes_);
            const compSec2_ = pool_.slice(poolByes_).map(tm => {
              const wkScore   = _wsCombined_(tm, startWk_, wpr_);
              const regAvgPW  = (tm.pf || 0) / Math.max(1, regWeeks_);
              const bScore    = !blendEn_ || wkScore == null ? null
                : blendMd_ === "weighted"
                  ? wkScore * (1 - blendWt_/100) + regAvgPW * (blendWt_/100)
                  : wkScore + regAvgPW * (blendWt_/100);
              return { ...tm, wkScore, regAvgPW, bScore };
            }).sort((a, b) => {
              const sa = blendEn_ ? (b.bScore ?? b.wkScore ?? b.pf) : (b.wkScore ?? b.pf);
              const sb = blendEn_ ? (a.bScore ?? a.wkScore ?? a.pf) : (a.wkScore ?? a.pf);
              return sa - sb;
            });

            const sorted2_ = [...byeSec2_.map(tm => ({
              ...tm, wkScore: null, regAvgPW: (tm.pf||0)/Math.max(1,regWeeks_), bScore: null
            })), ...compSec2_];

            return {
              roundIdx, weekNum: weekNum_, weeksPerRound: wpr_ > 1 ? wpr_ : undefined,
              blendEnabled: blendEn_, blendWeight: blendWt_, blendMode: blendMd_,
              poolByes: poolByes_, advCount: advCount_,
              results: sorted2_.map((tm, i) => ({
                teamName:    tm.teamName,
                displayName: _displayName(tm),
                leagueName:  tm.leagueName,
                teamId:      tm.teamId || "",
                leagueId:    leagueIdByTeamKey[_teamKey(tm)] || "",
                pf:          tm.pf,
                wkScore:     tm.wkScore,
                regAvgPW:    parseFloat((tm.regAvgPW||0).toFixed(2)),
                bScore:      tm.bScore != null ? parseFloat(tm.bScore.toFixed(2)) : null,
                isBye:       i < poolByes_,
                advances:    i < poolByes_ || (i - poolByes_) < advCount_,
                isChamp:     isFinal && i === poolByes_
              }))
            };
          });
        })();

        const snapshot = _buildPlayoffSnapshot();
        snapshot.computedRounds = _computedRounds;
        if (btn) btn.textContent = "Writing…";

        // ── Build finalRankings: authoritative ordered list for analytics tabs ──
        // Rank 1 = overall tournament champion. Works backwards through rounds:
        //   Finals survivors ordered by final-round score → last-round elim → … → non-qualifiers by PF.
        // Written to gmd/tournaments/{tid}/playoffs/{year}/finalRankings so analytics
        // tabs can read from t.playoffs[year].finalRankings without re-simulation.
        const _buildFinalRankings = () => {
          const _leagueIdForTeam = (tm) => leagueIdByTeamKey[_teamKey(tm)] || "";

          if (mode === "points_rounds" && _computedRounds.length) {
            // Work backwards: last round survivors first, then each round's eliminated
            // teams sorted by the score from the round they were eliminated in.
            const allRanked = [];
            const placed    = new Set(); // _teamKey strings already ranked

            // Collect the surviving pool after each round, working backwards
            // computedRounds[i].results has advances:bool per team
            for (let ri = _computedRounds.length - 1; ri >= 0; ri--) {
              const cr       = _computedRounds[ri];
              const isFinal  = ri === _computedRounds.length - 1;

              if (isFinal) {
                // Rank all final-round teams in score order (champion first)
                const finalTeams = [...cr.results].sort((a, b) => {
                  const sa = cr.blendEnabled ? (b.bScore ?? b.wkScore ?? b.pf) : (b.wkScore ?? b.pf);
                  const sb = cr.blendEnabled ? (a.bScore ?? a.wkScore ?? a.pf) : (a.wkScore ?? a.pf);
                  return sa - sb;
                });
                finalTeams.forEach(tm => {
                  const tk = tm.teamName + "|" + tm.leagueId;
                  if (!placed.has(tk)) { allRanked.push({ ...tm, isTChamp: !!(tm.isChamp) }); placed.add(tk); }
                });
              } else {
                // Teams eliminated this round: in this round's results, !advances
                const elimThisRound = cr.results
                  .filter(tm => !tm.advances && !tm.isBye)
                  .sort((a, b) => {
                    const sa = cr.blendEnabled ? (b.bScore ?? b.wkScore ?? b.pf) : (b.wkScore ?? b.pf);
                    const sb = cr.blendEnabled ? (a.bScore ?? a.wkScore ?? a.pf) : (a.wkScore ?? a.pf);
                    return sa - sb;
                  });
                elimThisRound.forEach(tm => {
                  const tk = tm.teamName + "|" + tm.leagueId;
                  if (!placed.has(tk)) { allRanked.push({ ...tm, isTChamp: false }); placed.add(tk); }
                });
              }
            }

            // Non-qualifiers: ranked last by regular-season PF desc
            const nonQual = sortedTeams
              .filter(tm => !qualSet.has(_teamKey(tm)))
              .sort((a, b) => (b.pf||0) - (a.pf||0));
            nonQual.forEach(tm => {
              const tk = _teamKey(tm);
              if (!placed.has(tk)) {
                allRanked.push({ teamName: tm.teamName, displayName: _displayName(tm),
                  leagueId: _leagueIdForTeam(tm), teamId: String(tm.teamId||""),
                  pf: tm.pf, isTChamp: false, advances: false });
                placed.add(tk);
              }
            });

            // Build a quick lookup for qualified/bye from the snapshot standings
            const standingsLookup = {};
            snapshot.standings.forEach(s => {
              standingsLookup[`${s.teamName}|${s.leagueId}`] = s;
            });

            return allRanked.map((tm, i) => {
              const sl  = standingsLookup[`${tm.teamName}|${tm.leagueId}`] || {};
              return {
                finalRank:   i + 1,
                teamName:    tm.teamName    || "",
                displayName: tm.displayName || tm.teamName || "",
                leagueId:    String(tm.leagueId || ""),
                teamId:      String(tm.teamId   || ""),
                qualified:   !!(sl.qualified),
                bye:         !!(sl.bye),
                isTChamp:    !!(tm.isTChamp),
                pf:          tm.pf || sl.pf || 0
              };
            });

          } else if (mode === "total_points") {
            // No rounds: rank by PF desc, champion = #1
            return sortedTeams.map((tm, i) => ({
              finalRank:   i + 1,
              teamName:    tm.teamName    || "",
              displayName: _displayName(tm),
              leagueId:    _leagueIdForTeam(tm),
              teamId:      String(tm.teamId || ""),
              qualified:   true,
              bye:         false,
              isTChamp:    i === 0,
              pf:          tm.pf || 0
            }));

          } else if (mode === "custom_rounds") {
            // Simulate custom rounds using PF-based group advancement.
            // Each round: split pool into groups, top advPerGroup from each advance.
            // Works backwards: final survivors first, then each round's eliminated sorted by PF.
            const crRounds = po.customRounds?.rounds || [];
            if (!crRounds.length) {
              // No round config — fall back to qual/non-qual by PF
              const qual    = sortedTeams.filter(tm =>  qualSet.has(_teamKey(tm)));
              const nonQual = sortedTeams.filter(tm => !qualSet.has(_teamKey(tm)));
              return [...qual, ...nonQual].map((tm, i) => ({
                finalRank:   i + 1,
                teamName:    tm.teamName    || "",
                displayName: _displayName(tm),
                leagueId:    _leagueIdForTeam(tm),
                teamId:      String(tm.teamId || ""),
                qualified:   qualSet.has(_teamKey(tm)),
                bye:         byeSet.has(_teamKey(tm)),
                isTChamp:    i === 0,
                pf:          tm.pf || 0
              }));
            }

            // Simulate each round, track who advances and who was eliminated in which round
            // roundPools[i] = pool entering round i; roundElim[i] = teams eliminated in round i
            const roundPools = [];
            const roundElims = [];

            let crPool = _sortByMetric([...qualifiers], byeMetric); // seeded order
            roundPools.push([...crPool]);

            for (let ri = 0; ri < crRounds.length; ri++) {
              const cr      = crRounds[ri];
              const isFin   = ri === crRounds.length - 1;
              const groups  = cr.groups  || 1;
              const tpg     = cr.teamsPerGroup || Math.ceil(crPool.length / groups);
              const apg     = isFin ? 1 : (cr.advPerGroup || 1);

              // Byes pass round 0
              const byeSec   = ri === 0 ? crPool.slice(0, byeCount) : [];
              const compSec  = ri === 0 ? crPool.slice(byeCount) : [...crPool];

              const advancers = [...byeSec];
              const eliminated = [];

              for (let gi = 0; gi < groups; gi++) {
                const groupTeams = compSec.slice(gi * tpg, (gi + 1) * tpg);
                // Sort group by PF descending
                const sorted = [...groupTeams].sort((a, b) => (b.pf||0) - (a.pf||0));
                advancers.push(...sorted.slice(0, apg));
                eliminated.push(...sorted.slice(apg));
              }

              roundElims.push(eliminated);
              crPool = advancers;
              if (ri < crRounds.length - 1) roundPools.push([...crPool]);
            }

            // Build final rankings working backwards
            const crAllRanked = [];
            const crPlaced    = new Set();

            // Final pool survivors: sorted by PF desc, champion = top
            const finalPool = [...crPool].sort((a, b) => (b.pf||0) - (a.pf||0));
            finalPool.forEach((tm, i) => {
              const tk = _teamKey(tm);
              if (!crPlaced.has(tk)) {
                crAllRanked.push({ ...tm, isTChamp: i === 0 });
                crPlaced.add(tk);
              }
            });

            // Eliminated teams, from last round to first, sorted by PF desc within each round
            for (let ri = crRounds.length - 1; ri >= 0; ri--) {
              const elim = [...(roundElims[ri] || [])].sort((a, b) => (b.pf||0) - (a.pf||0));
              elim.forEach(tm => {
                const tk = _teamKey(tm);
                if (!crPlaced.has(tk)) { crAllRanked.push({ ...tm, isTChamp: false }); crPlaced.add(tk); }
              });
            }

            // Non-qualifiers last
            sortedTeams.filter(tm => !qualSet.has(_teamKey(tm))).forEach(tm => {
              const tk = _teamKey(tm);
              if (!crPlaced.has(tk)) { crAllRanked.push({ ...tm, isTChamp: false }); crPlaced.add(tk); }
            });

            const standingsLookup2 = {};
            snapshot.standings.forEach(s => { standingsLookup2[`${s.teamName}|${s.leagueId}`] = s; });

            return crAllRanked.map((tm, i) => {
              const sl = standingsLookup2[`${tm.teamName}|${_leagueIdForTeam(tm)}`] || {};
              return {
                finalRank:   i + 1,
                teamName:    tm.teamName    || "",
                displayName: tm.displayName || _displayName(tm),
                leagueId:    _leagueIdForTeam(tm),
                teamId:      String(tm.teamId || ""),
                qualified:   !!(sl.qualified ?? qualSet.has(_teamKey(tm))),
                bye:         !!(sl.bye       ?? byeSet.has(_teamKey(tm))),
                isTChamp:    !!(tm.isTChamp),
                pf:          tm.pf || sl.pf || 0
              };
            });

          } else if (mode === "h2h_bracket") {
            // Simulate single-elimination bracket using weekly scores from _weekScoreCache.
            // Seeds: qualifiers sorted by seeding metric. Standard bracket pairing:
            //   #1 vs #bracketSize, #2 vs #(bracketSize-1), etc.
            // If no scores available, falls back to seeding order (higher seed wins).
            const bracketSize = po.bracketSize || qualifiers.length;
            const seeds = _sortByMetric([...qualifiers], (mode === "h2h_bracket" || po.seeding?.method === "record") ? "record" : "pf")
              .slice(0, bracketSize);

            const numRounds = Math.ceil(Math.log2(bracketSize));

            // Helper: score for a team in a specific playoff week
            const _bktScore = (tm, weekNum_) => {
              if (!po.startWeek || !weekNum_) return null;
              const lid = leagueIdByTeamKey[_teamKey(tm)];
              if (!lid) return null;
              return _weekScoreCache[lid + "|" + weekNum_]?.[String(tm.teamId)] ?? null;
            };

            // Simulate bracket: track survivors and elimination order
            // elimRound[n] = array of teams eliminated in bracket round n (0-indexed)
            const elimRound = Array.from({length: numRounds}, () => []);

            // Build round 1 matchups: bye teams advance automatically,
            // then remaining seeds pair as #1 vs last, #2 vs 2nd-last, etc.
            let currentRound = [...seeds]; // ordered by seed
            const byeTeams   = currentRound.slice(0, byeCount);
            const r1Players  = currentRound.slice(byeCount);

            // For each subsequent bracket round
            for (let ri = 0; ri < numRounds; ri++) {
              const weekNum_ = po.startWeek ? po.startWeek + ri : null;
              const nextRound = [];

              if (ri === 0) {
                // Byes auto-advance
                nextRound.push(...byeTeams);
                // Pair remaining: top vs bottom
                const half = Math.floor(r1Players.length / 2);
                for (let mi = 0; mi < half; mi++) {
                  const a = r1Players[mi];
                  const b = r1Players[r1Players.length - 1 - mi];
                  const sa = _bktScore(a, weekNum_) ?? (seeds.indexOf(a) !== -1 ? bracketSize - seeds.indexOf(a) : 0);
                  const sb = _bktScore(b, weekNum_) ?? (seeds.indexOf(b) !== -1 ? bracketSize - seeds.indexOf(b) : 0);
                  if (sa >= sb) { nextRound.push(a); elimRound[ri].push(b); }
                  else          { nextRound.push(b); elimRound[ri].push(a); }
                }
                // Odd team out (if bracketSize not a power of 2): advances automatically
                if (r1Players.length % 2 !== 0) nextRound.push(r1Players[Math.floor(r1Players.length / 2)]);
              } else {
                // Subsequent rounds: pair adjacent teams in current bracket order
                const half = Math.floor(currentRound.length / 2);
                for (let mi = 0; mi < half; mi++) {
                  const a = currentRound[mi * 2];
                  const b = currentRound[mi * 2 + 1];
                  const sa = _bktScore(a, weekNum_) ?? 0;
                  const sb = _bktScore(b, weekNum_) ?? 0;
                  if (sa >= sb) { nextRound.push(a); elimRound[ri].push(b); }
                  else          { nextRound.push(b); elimRound[ri].push(a); }
                }
                if (currentRound.length % 2 !== 0)
                  nextRound.push(currentRound[currentRound.length - 1]);
              }

              currentRound = nextRound;
            }

            // currentRound should now be just the champion(s); build rankings backwards
            const bktAllRanked = [];
            const bktPlaced    = new Set();

            // Champion(s) from final round
            [...currentRound].forEach(tm => {
              const tk = _teamKey(tm);
              if (!bktPlaced.has(tk)) { bktAllRanked.push({ ...tm, isTChamp: true }); bktPlaced.add(tk); }
            });

            // Eliminated teams from last round to first, sorted by score desc within each round
            for (let ri = numRounds - 1; ri >= 0; ri--) {
              const weekNum_ = po.startWeek ? po.startWeek + ri : null;
              const elim = [...(elimRound[ri] || [])].sort((a, b) => {
                const sa = _bktScore(a, weekNum_) ?? 0;
                const sb = _bktScore(b, weekNum_) ?? 0;
                return sb - sa;
              });
              elim.forEach(tm => {
                const tk = _teamKey(tm);
                if (!bktPlaced.has(tk)) { bktAllRanked.push({ ...tm, isTChamp: false }); bktPlaced.add(tk); }
              });
            }

            // Non-qualifiers last by PF
            sortedTeams.filter(tm => !qualSet.has(_teamKey(tm))).forEach(tm => {
              const tk = _teamKey(tm);
              if (!bktPlaced.has(tk)) { bktAllRanked.push({ ...tm, isTChamp: false }); bktPlaced.add(tk); }
            });

            const standingsLookupB = {};
            snapshot.standings.forEach(s => { standingsLookupB[`${s.teamName}|${s.leagueId}`] = s; });

            return bktAllRanked.map((tm, i) => {
              const sl = standingsLookupB[`${tm.teamName}|${_leagueIdForTeam(tm)}`] || {};
              return {
                finalRank:   i + 1,
                teamName:    tm.teamName    || "",
                displayName: tm.displayName || _displayName(tm),
                leagueId:    _leagueIdForTeam(tm),
                teamId:      String(tm.teamId || ""),
                qualified:   !!(sl.qualified ?? qualSet.has(_teamKey(tm))),
                bye:         !!(sl.bye       ?? byeSet.has(_teamKey(tm))),
                isTChamp:    !!(tm.isTChamp),
                pf:          tm.pf || sl.pf || 0
              };
            });

          } else if (mode === "worldcup") {
            // World Cup: simulate group-stage standings, then bracket, to build full ranking.
            const _sk3 = (s) => String(s||"").trim().toLowerCase().replace(/[.#$\/\[\]]/g,"_");
            const wcGroups3    = po.worldcupGroups    || [];
            const wcSched3     = po.worldcupSchedule  || {};
            const wcRegWks3    = po.worldcupRegWeeks  || 6;
            const wcStartPo3   = po.startWeek         || null;
            const wcWPR3       = po.worldcupWeeksPerRound || 2;
            const wcBracket3   = po.worldcupBracket   || [];
            const _nflWk3      = (wi) => wcStartPo3 ? (wcStartPo3 - wcRegWks3 + wi) : (wi + 1);

            // ── Step 1: Compute group standings from schedule ──────────────
            // records[groupIdx][teamName] = { wins, losses, pf, pa, h2h }
            const groupRecords = wcGroups3.map((g, gi) => {
              const members = g.members || [];
              const rec = {};
              members.forEach(n => { rec[n] = { wins:0, losses:0, pf:0, pa:0, h2h:{} }; });
              for (let wi = 0; wi < wcRegWks3; wi++) {
                ((wcSched3[String(gi)]||{})[String(wi)]||[]).forEach(({home,away}) => {
                  if (!home || !away || home===away || !rec[home] || !rec[away]) return;
                  const homeInfo = (() => { for (const lc of Object.values(t.standingsCache||{})) { if(String(lc.year)!==String(activeY))continue; const tm=(lc.teams||[]).find(t2=>_sk3(t2.teamName)===_sk3(home)); if(tm) return {teamId:String(tm.teamId||""),leagueId:String(lc.leagueId||lc.league_id||"")}; } return null; })();
                  const awayInfo = (() => { for (const lc of Object.values(t.standingsCache||{})) { if(String(lc.year)!==String(activeY))continue; const tm=(lc.teams||[]).find(t2=>_sk3(t2.teamName)===_sk3(away)); if(tm) return {teamId:String(tm.teamId||""),leagueId:String(lc.leagueId||lc.league_id||"")}; } return null; })();
                  const nflWk = _nflWk3(wi);
                  const hs = homeInfo ? (_weekScoreCache[homeInfo.leagueId+"|"+nflWk]?.[homeInfo.teamId]??null) : null;
                  const as_ = awayInfo ? (_weekScoreCache[awayInfo.leagueId+"|"+nflWk]?.[awayInfo.teamId]??null) : null;
                  if (hs !== null && as_ !== null) {
                    rec[home].pf += hs; rec[home].pa += as_;
                    rec[away].pf += as_; rec[away].pa += hs;
                    if (hs > as_) { rec[home].wins++; rec[away].losses++; rec[home].h2h[away]=(rec[home].h2h[away]||0)+1; rec[away].h2h[home]=(rec[away].h2h[home]||0)-1; }
                    else if (as_ > hs) { rec[away].wins++; rec[home].losses++; rec[away].h2h[home]=(rec[away].h2h[home]||0)+1; rec[home].h2h[away]=(rec[home].h2h[away]||0)-1; }
                  }
                });
              }
              // Sort members within group
              const sorted = [...members].sort((a,b) => {
                const d = (rec[b]?.wins||0) - (rec[a]?.wins||0); if (d!==0) return d;
                const h = (rec[a]?.h2h[b]||0) - (rec[b]?.h2h[a]||0); if (h!==0) return -h;
                return (rec[b]?.pf||0) - (rec[a]?.pf||0);
              });
              return { sorted, rec };
            });

            // ── Step 2: Identify advancers and eliminated per group ────────
            const wcEliminated = []; // {name, groupIdx, groupRank}
            const wcAdvancers  = []; // {name, groupIdx, groupRank}
            wcGroups3.forEach((g, gi) => {
              const adv = g.advanceCount ?? (po.worldcupAdvanceCount??2);
              const { sorted } = groupRecords[gi];
              sorted.forEach((name,rank) => {
                if (rank < adv) wcAdvancers.push({name,groupIdx:gi,groupRank:rank});
                else            wcEliminated.push({name,groupIdx:gi,groupRank:rank});
              });
            });

            // ── Step 3: Simulate bracket (WC bracket seeded by admin) ──────
            const standingsLookupWC = {};
            snapshot.standings.forEach(s => { standingsLookupWC[`${s.teamName}|${s.leagueId}`] = s; });

            const _bktScoreWC3 = (tm, weekNum_) => {
              if (!wcStartPo3 || !weekNum_) return null;
              const lid = leagueIdByTeamKey[_teamKey(tm)];
              if (!lid) return null;
              let total = 0, hasAny = false;
              for (let w = 0; w < wcWPR3; w++) {
                const v = _weekScoreCache[lid+"|"+(weekNum_+w)]?.[String(tm.teamId)];
                if (v != null) { total += v; hasAny = true; }
              }
              return hasAny ? total : null;
            };

            const wcAllRanked3 = [];
            const wcPlaced3    = new Set();

            if (wcBracket3.length) {
              const wcSeeds3 = wcBracket3.map(name => allTeams.find(t => _sk3(_displayName(t)) === _sk3(name) || _sk3(t.teamName) === _sk3(name)) || {teamName:name,displayName:name,pf:0,teamId:""});
              const wcBktSize3 = wcSeeds3.length;
              const wcNR3 = Math.ceil(Math.log2(Math.max(wcBktSize3,2)));
              const wcByeCount3 = (po.byes?.type!=="none") ? (po.byes?.count||0) : 0;
              const wcElimRnd3 = Array.from({length:wcNR3},()=>[]);
              let wcCur3 = [...wcSeeds3];
              const wcR1B3 = wcCur3.slice(0,wcByeCount3), wcR1P3 = wcCur3.slice(wcByeCount3);
              for (let ri = 0; ri < wcNR3; ri++) {
                const wkN_ = wcStartPo3 ? wcStartPo3 + ri*wcWPR3 : null;
                const next = [];
                if (ri===0) {
                  next.push(...wcR1B3);
                  const half = Math.floor(wcR1P3.length/2);
                  for (let mi=0;mi<half;mi++) {
                    const a=wcR1P3[mi],b=wcR1P3[wcR1P3.length-1-mi];
                    const sa=_bktScoreWC3(a,wkN_)??(wcBktSize3-wcSeeds3.indexOf(a));
                    const sb=_bktScoreWC3(b,wkN_)??(wcBktSize3-wcSeeds3.indexOf(b));
                    if(sa>=sb){next.push(a);wcElimRnd3[ri].push(b);}else{next.push(b);wcElimRnd3[ri].push(a);}
                  }
                  if(wcR1P3.length%2!==0)next.push(wcR1P3[Math.floor(wcR1P3.length/2)]);
                } else {
                  const half=Math.floor(wcCur3.length/2);
                  for(let mi=0;mi<half;mi++){const a=wcCur3[mi*2],b=wcCur3[mi*2+1];const sa=_bktScoreWC3(a,wkN_)??0,sb=_bktScoreWC3(b,wkN_)??0;if(sa>=sb){next.push(a);wcElimRnd3[ri].push(b);}else{next.push(b);wcElimRnd3[ri].push(a);}}
                  if(wcCur3.length%2!==0)next.push(wcCur3[wcCur3.length-1]);
                }
                wcCur3 = next;
              }
              // Champion(s)
              wcCur3.forEach(tm=>{const tk=_teamKey(tm);if(!wcPlaced3.has(tk)){wcAllRanked3.push({...tm,isTChamp:true});wcPlaced3.add(tk);}});
              // Bracket eliminated (deepest round first)
              for(let ri=wcNR3-1;ri>=0;ri--){const wkN_=wcStartPo3?wcStartPo3+ri*wcWPR3:null;[...(wcElimRnd3[ri]||[])].sort((a,b)=>(_bktScoreWC3(b,wkN_)??0)-(_bktScoreWC3(a,wkN_)??0)).forEach(tm=>{const tk=_teamKey(tm);if(!wcPlaced3.has(tk)){wcAllRanked3.push({...tm,isTChamp:false});wcPlaced3.add(tk);}});}
            }

            // Group-stage eliminated (by group order, then rank within group)
            wcEliminated.forEach(({name}) => {
              const tm = allTeams.find(t => _sk3(_displayName(t)) === _sk3(name) || _sk3(t.teamName) === _sk3(name)) || {teamName:name,pf:0};
              const tk = _teamKey(tm);
              if (!wcPlaced3.has(tk)) { wcAllRanked3.push({...tm,isTChamp:false}); wcPlaced3.add(tk); }
            });
            // Any remaining teams (not in any group)
            sortedTeams.forEach(tm => { const tk=_teamKey(tm); if(!wcPlaced3.has(tk)){wcAllRanked3.push({...tm,isTChamp:false});wcPlaced3.add(tk);} });

            return wcAllRanked3.map((tm,i) => {
              const sl = standingsLookupWC[`${tm.teamName}|${_leagueIdForTeam(tm)}`] || {};
              const isAdvancer = wcAdvancers.some(a => _sk3(a.name) === _sk3(_displayName(tm)));
              return { finalRank:i+1, teamName:tm.teamName||"", displayName:tm.displayName||_displayName(tm),
                leagueId:_leagueIdForTeam(tm), teamId:String(tm.teamId||""),
                qualified:isAdvancer, bye:false, isTChamp:!!(tm.isTChamp), pf:tm.pf||sl.pf||0 };
            });

          } else {
            // Unknown mode: qual teams first by PF, then non-qualifiers by PF
            const qual    = sortedTeams.filter(tm =>  qualSet.has(_teamKey(tm)));
            const nonQual = sortedTeams.filter(tm => !qualSet.has(_teamKey(tm)));
            return [...qual, ...nonQual].map((tm, i) => ({
              finalRank:   i + 1,
              teamName:    tm.teamName    || "",
              displayName: _displayName(tm),
              leagueId:    _leagueIdForTeam(tm),
              teamId:      String(tm.teamId || ""),
              qualified:   qualSet.has(_teamKey(tm)),
              bye:         byeSet.has(_teamKey(tm)),
              isTChamp:    i === 0,
              pf:          tm.pf || 0
            }));
          }
        };

        const finalRankings = _buildFinalRankings();
        snapshot.finalRankings = finalRankings; // include in public snapshot too

        // Write to public site
        await GMD.child(`publicTournaments/${tid}/playoffs/${activeY}`).set(snapshot);

        // Write finalRankings to private tournaments path so analytics tabs can read
        // from t.playoffs[year].finalRankings without re-simulation or pub fetches
        await GMD.child(`tournaments/${tid}/playoffs/${activeY}/finalRankings`).set(finalRankings);

        // Update local t so analytics tabs see it immediately without re-loading
        if (!_tournaments[tid])                                _tournaments[tid] = {};
        if (!_tournaments[tid].playoffs)                       _tournaments[tid].playoffs = {};
        if (!_tournaments[tid].playoffs[activeY])              _tournaments[tid].playoffs[activeY] = {};
        _tournaments[tid].playoffs[activeY].finalRankings = finalRankings;

        showToast("Playoffs published ✓");
      } catch(e) { showToast("Publish failed: "+e.message, "error"); }
      finally { if (btn) { btn.disabled=false; btn.textContent="📢 Publish"; } }
    });
  }

  function _renderInfoTab(t, body, tid) {
    const meta = t.meta || {};
    const leagueCount = Object.keys(t.leagues || {}).length;
    const regCount    = Object.keys(t.registrations || {}).length;
    const distinctYears = [...new Set(Object.values(t.standingsCache || {}).map(lc => lc.year).filter(Boolean))].length || null;
    const social      = meta.socialLinks || {};
    // Rules: pick latest year from rulesByYear for the info preview
    const _rbyInfo  = t.rulesByYear || {};
    const _rbyLatestYear = Object.keys(_rbyInfo).map(Number).sort((a,b)=>b-a)[0] || null;
    const rules = _rbyLatestYear ? (_rbyInfo[_rbyLatestYear] || null) : null;

    // Status banner (active/playoffs/completed get a colored banner)
    const bannerColors = {
      active:    "var(--color-green)",
      playoffs:  "var(--color-accent)",
      completed: "var(--color-text-dim)"
    };
    const bannerColor = bannerColors[meta.status] || null;
    const statusBanner = bannerColor ? `
      <div class="trn-info-status-banner" style="border-color:${bannerColor};color:${bannerColor}">
        ${STATUS_ICONS[meta.status] || ""} ${STATUS_LABELS[meta.status] || ""}
      </div>` : "";

    // Bio: newlines → <br>, URLs autolinked
    const rawBio = meta.bio || "";
    const linkedBio = rawBio
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/\n/g, "<br>")
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--color-accent)">$1</a>');

    // Social links
    const socialIcons = { twitter: "𝕏", discord: "💬", reddit: "🤖", website: "🌐", instagram: "📸", youtube: "▶" };
    const socialHtml = Object.entries(social)
      .filter(([, url]) => url)
      .map(([key, url]) => {
        const icon  = socialIcons[key] || "🔗";
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        return `<a href="${_esc(url)}" target="_blank" rel="noopener" class="trn-social-link">${icon} ${label}</a>`;
      }).join("");

    // Rules excerpt (first 3 lines preview)
    const rulesPreview = rules?.content
      ? rules.content.split("\n").slice(0, 3).map(l => _esc(l)).join("<br>") + (rules.content.split("\n").length > 3 ? "<br><em>…</em>" : "")
      : null;

    body.innerHTML = `
      ${statusBanner}

      <div class="trn-info-hero">
        <h3 class="trn-info-name">${_esc(meta.name || "Tournament")}</h3>
        ${meta.tagline ? `<p class="trn-info-tagline">${_esc(meta.tagline)}</p>` : ""}
      </div>

      <div class="trn-info-stats">
        <div class="trn-stat-card">
          <div class="trn-stat-value">${distinctYears || leagueCount}</div>
          <div class="trn-stat-label">${distinctYears ? "Years" : "Leagues"}</div>
        </div>
        <div class="trn-stat-card">
          <div class="trn-stat-value">${regCount}</div>
          <div class="trn-stat-label">Registered</div>
        </div>
        <div class="trn-stat-card">
          <div class="trn-stat-value">${meta.regType === "invite" ? "Invite" : "Open"}</div>
          <div class="trn-stat-label">Registration</div>
        </div>
      </div>

      ${rawBio ? `
        <div class="trn-section-card">
          <div class="trn-section-card-title">About This Tournament</div>
          <div class="trn-info-bio">${linkedBio}</div>
        </div>
      ` : ""}

      ${(() => {
        // Auto-summary: pick year matching _tournamentYear, else latest
        const years = _playoffYears(t);
        const sumYear = _tournamentYear && years.includes(String(_tournamentYear))
          ? String(_tournamentYear) : (years[0] || null);
        return _renderTournamentSummary(t, sumYear, tid);
      })()}

      ${meta.donationLink ? `
        <div class="trn-section-card trn-info-donation">
          <div class="trn-section-card-title">Support the Tournament</div>
          <a href="${_esc(meta.donationLink)}" target="_blank" rel="noopener" class="btn-primary trn-donation-btn">
            💰 Donate / Entry Fee
          </a>
        </div>
      ` : ""}

      ${socialHtml ? `
        <div class="trn-section-card">
          <div class="trn-section-card-title">Follow Us</div>
          <div class="trn-social-links">${socialHtml}</div>
        </div>
      ` : ""}

      ${rulesPreview ? `
        <div class="trn-section-card">
          <div class="trn-section-card-title" style="display:flex;justify-content:space-between;align-items:center">
            <span>Rules</span>
            ${rules?.version ? `<span style="font-size:.75rem;color:var(--color-text-dim)">v${_esc(String(rules.version))}</span>` : ""}
          </div>
          <div class="trn-info-bio trn-rules-preview">${rulesPreview}</div>
          <button class="btn-secondary btn-sm" id="trn-view-rules-btn" style="margin-top:var(--space-3)">View Full Rules</button>
        </div>
      ` : ""}
    `;

    document.getElementById("trn-view-rules-btn")?.addEventListener("click", () => {
      const rulesTab = document.querySelector('.trn-tab[data-tab="rules"]');
      if (rulesTab) { rulesTab.click(); } else { _renderRulesTab(t, body); }
    });

    // ── Summary edit/save/reset (admin only) ────────────
    const _wireSummaryCard = () => {
      const editBtn   = document.getElementById("trn-summary-edit-btn");
      const saveBtn   = document.getElementById("trn-summary-save-btn");
      const cancelBtn = document.getElementById("trn-summary-cancel-btn");
      const resetBtn  = document.getElementById("trn-summary-reset-btn");
      const editMode  = document.getElementById("trn-summary-edit-mode");
      const autoView  = document.getElementById("trn-summary-auto-view");
      const overView  = document.getElementById("trn-summary-override-view");
      const textarea  = document.getElementById("trn-summary-textarea");
      const card      = document.getElementById("trn-tournament-summary");
      const cardYear  = card?.dataset.year || "default";
      const autoText  = card?.dataset.autoText || "";

      editBtn?.addEventListener("click", () => {
        // Pre-fill with override if exists, else auto-text
        const current = t.meta?.summaryOverride?.[cardYear] || autoText;
        if (textarea) textarea.value = current;
        if (editMode) editMode.style.display = "";
        if (editBtn)  editBtn.style.display  = "none";
        if (autoView) autoView.style.display = "none";
        if (overView) overView.style.display = "none";
      });

      cancelBtn?.addEventListener("click", () => {
        if (editMode) editMode.style.display = "none";
        if (editBtn)  editBtn.style.display  = "";
        const hasOverride = !!(t.meta?.summaryOverride?.[cardYear]);
        if (autoView) autoView.style.display = hasOverride ? "none" : "";
        if (overView) overView.style.display = hasOverride ? ""     : "none";
      });

      resetBtn?.addEventListener("click", () => {
        if (textarea) textarea.value = autoText;
        showToast("Auto-generated text loaded — save to apply or cancel to discard");
      });

      saveBtn?.addEventListener("click", async () => {
        if (!tid) return;
        const text = textarea?.value?.trim() || null;
        try {
          const updates = {};
          updates[`summaryOverride/${cardYear}`] = text || null;
          await _tMetaRef(tid).update(updates);
          if (!_tournaments[tid]) _tournaments[tid] = {};
          if (!_tournaments[tid].meta) _tournaments[tid].meta = {};
          if (!_tournaments[tid].meta.summaryOverride) _tournaments[tid].meta.summaryOverride = {};
          _tournaments[tid].meta.summaryOverride[cardYear] = text;
          // Re-render summary card in place
          const newHtml = _renderTournamentSummary(_tournaments[tid], cardYear, tid);
          const tmp = document.createElement("div");
          tmp.innerHTML = newHtml;
          card.replaceWith(tmp.firstElementChild);
          _wireSummaryCard();
          showToast(text ? "Summary saved ✓" : "Summary reset to auto-generated ✓");
        } catch(e) { showToast("Failed to save summary", "error"); }
      });
    };
    _wireSummaryCard();

    // Summary year pills
    document.querySelectorAll(".trn-summary-year-pill").forEach(btn => {
      btn.addEventListener("click", () => {
        const yr = btn.dataset.sumYear;
        const el = document.getElementById("trn-tournament-summary");
        if (!el) return;
        const newHtml = _renderTournamentSummary(t, yr, tid);
        const tmp = document.createElement("div");
        tmp.innerHTML = newHtml;
        el.replaceWith(tmp.firstElementChild);
        _wireSummaryCard();
        document.querySelectorAll(".trn-summary-year-pill").forEach(b =>
          b.classList.toggle("trn-summary-year-pill--active", b.dataset.sumYear === yr));
        // Re-wire year pills after swap
        document.querySelectorAll(".trn-summary-year-pill").forEach(b2 => {
          b2.addEventListener("click", () => {
            const yr2 = b2.dataset.sumYear;
            const el2 = document.getElementById("trn-tournament-summary");
            if (!el2) return;
            const h2 = _renderTournamentSummary(t, yr2, tid);
            const t2 = document.createElement("div");
            t2.innerHTML = h2;
            el2.replaceWith(t2.firstElementChild);
            _wireSummaryCard();
          });
        });
      });
    });
  }

  // ── User: Rules tab ─────────────────────────────────────
  function _renderRulesTab(t, body) {
    const rby   = t.rulesByYear || {};
    const years = Object.keys(rby).map(Number).sort((a, b) => b - a);

    // Determine which year to show: honour _tournamentYear if set + available, else latest
    let selYear = _tournamentYear && rby[_tournamentYear]
      ? String(_tournamentYear)
      : (years.length ? String(years[0]) : null);

    function _renderRulesContent(year) {
      const rules = rby[year] || null;
      const inner = document.getElementById("trn-rules-content");
      if (!inner) return;
      if (!rules?.content) {
        inner.innerHTML = `
          <div class="trn-empty" style="padding:var(--space-4) 0">
            <div class="trn-empty-icon">📋</div>
            <div class="trn-empty-title">No rules for ${year}</div>
            <div class="trn-empty-sub">The commissioner hasn't published rules for this year.</div>
          </div>`;
        return;
      }
      const htmlContent = rules.content
        .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
        .replace(/\n/g, "<br>")
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:var(--color-accent)">$1</a>');
      inner.innerHTML = `
        <div style="display:flex;gap:var(--space-3);align-items:center;margin-bottom:var(--space-3);font-size:.78rem;color:var(--color-text-dim)">
          ${rules.version ? `<span>Version ${_esc(String(rules.version))}</span>` : ""}
          ${rules.updatedAt ? `<span>${new Date(rules.updatedAt).toLocaleDateString()}</span>` : ""}
        </div>
        <div class="trn-info-bio trn-rules-full">${htmlContent}</div>`;
    }

    if (!selYear) {
      body.innerHTML = `
        <div class="trn-empty">
          <div class="trn-empty-icon">📋</div>
          <div class="trn-empty-title">No rules posted yet</div>
          <div class="trn-empty-sub">The commissioner hasn't published rules for this tournament.</div>
        </div>`;
      return;
    }

    const yearOptions = years.map(y =>
      `<option value="${y}" ${String(y) === selYear ? "selected" : ""}>${y}</option>`
    ).join("");

    body.innerHTML = `
      <div class="trn-section-card">
        <div class="trn-section-card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--space-2)">
          <span>Tournament Rules</span>
          ${years.length > 1 ? `
            <div style="display:flex;align-items:center;gap:var(--space-2)">
              <label style="font-size:.8rem;color:var(--color-text-dim)">Year:</label>
              <select id="trn-rules-year-view" style="font-size:.8rem;padding:2px 6px">${yearOptions}</select>
            </div>` : ""}
        </div>
        <div id="trn-rules-content"></div>
      </div>`;

    _renderRulesContent(selYear);

    document.getElementById("trn-rules-year-view")?.addEventListener("change", function() {
      selYear = this.value;
      _renderRulesContent(selYear);
    });
  }

  // ── Register page overlay (opened via pill button) ───────
  function _openRegisterPage(tid, t) {
    const container = document.getElementById("view-tournament");
    if (!container) return;
    const meta = t.meta || {};

    // Save current scroll position, show overlay
    const overlay = document.createElement("div");
    overlay.id = "trn-register-overlay";
    overlay.className = "trn-register-overlay";
    overlay.innerHTML = `
      <div class="trn-register-page">
        <div class="trn-register-page-header">
          <button class="btn-ghost btn-sm" id="trn-reg-back-btn">← Back to ${_esc(meta.name || "Tournament")}</button>
          <h2 style="margin:var(--space-3) 0 0;font-size:1.1rem;font-weight:700">Register for ${_esc(meta.name || "Tournament")} ${meta.registrationYear || new Date().getFullYear()}</h2>
        </div>
        <div id="trn-register-page-body"></div>
      </div>`;
    container.appendChild(overlay);

    document.getElementById("trn-reg-back-btn")?.addEventListener("click", () => {
      overlay.remove();
    });

    // Render the registration form into the page body
    const body = document.getElementById("trn-register-page-body");
    if (body) _renderRegisterTab(tid, t, body);
  }

  // ── User: Register tab ─────────────────────────────────
  function _renderRegisterTab(tid, t, body) {
    const meta    = t.meta || {};
    const form    = meta.registrationForm || {};
    const opts    = form.optionalFields || [];
    const custom  = form.customQuestions || [];
    const allFlds = [...STD_FIELDS, ...opts];

    if (meta.status === "draft") {
      body.innerHTML = `<div class="trn-empty">Registration is not open yet.</div>`;
      return;
    }
    if (meta.status === "completed") {
      body.innerHTML = `<div class="trn-empty">This tournament has concluded.</div>`;
      return;
    }

    // Check if this user is a linked participant with missing fields
    const missingFields = _getMissingFields(t, opts);

    // Pre-fill values from known DLR profile data where possible
    const profile = typeof Auth !== "undefined" ? Auth.getCurrentProfile() : null;
    const prefill = {
      displayName:     profile?.displayName || "",
      email:           profile?.email       || "",
      sleeperUsername: profile?.platforms?.sleeper?.username || "",
      mflEmail:        profile?.platforms?.mfl?.mflEmail     || "",
      yahooUsername:   profile?.platforms?.yahoo?.username   || ""
    };

    body.innerHTML = `
      ${missingFields.length ? `
        <div class="trn-missing-info-banner">
          ⚠️ Your registration is incomplete. Please fill in the highlighted fields below.
          <div class="trn-missing-fields">${missingFields.map(f => _fieldLabel(f)).join(", ")}</div>
        </div>
      ` : ""}

      <div class="trn-section-card">
        <div class="trn-section-card-title">Register for ${_esc(meta.name || "Tournament")} ${meta.registrationYear || new Date().getFullYear()}</div>
        ${allFlds.map(f => {
          const isRequired = STD_FIELDS.includes(f);
          const isMissing  = missingFields.includes(f);
          return `
          <div class="form-group ${isMissing ? "trn-field--missing" : ""}">
            <label>${_esc(_fieldLabel(f))}${isRequired ? ' <span class="required">*</span>' : ""}</label>
            <input type="text" id="trn-reg-${f}"
              placeholder="${_esc(_fieldLabel(f))}"
              value="${_esc(prefill[f] || "")}" />
          </div>`;
        }).join("")}
        ${custom.map((q, i) => `
          <div class="form-group">
            <label>${_esc(q.question)}${q.required ? ' <span class="required">*</span>' : ""}</label>
            ${q.type === "textarea"
              ? `<textarea id="trn-reg-custom-${i}" rows="3" placeholder="Your answer..."></textarea>`
              : `<input type="text" id="trn-reg-custom-${i}" placeholder="Your answer..." />`
            }
          </div>
        `).join("")}
        <div class="form-group">
          <label class="trn-field-toggle" style="margin:0">
            <input type="checkbox" id="trn-reg-auto" />
            Register me for all future years of this tournament automatically
          </label>
          <span class="field-hint">You will still appear in the admin queue each year for confirmation.</span>
        </div>
        <div id="trn-reg-error" class="auth-error hidden"></div>
        <div class="trn-form-actions">
          <button class="btn-primary" id="trn-submit-reg-btn">Submit Registration</button>
        </div>
      </div>
    `;

    document.getElementById("trn-submit-reg-btn")?.addEventListener("click", () =>
      _submitRegistration(tid, t, allFlds, custom)
    );
  }

  // Returns fields that are on the form but missing from the user's linked participant record
  function _getMissingFields(t, enabledOpts) {
    const participants = t.participants || {};
    const myRecord = Object.values(participants).find(p =>
      p.dlrLinked && p.dlrUsername === _currentUsername
    );
    if (!myRecord) return [];
    const allFormFields = [...STD_FIELDS, ...enabledOpts];
    return allFormFields.filter(f => !myRecord[f]);
  }

  async function _submitRegistration(tid, t, fields, custom) {
    const errEl  = document.getElementById("trn-reg-error");
    const entry  = { status: "pending", submittedAt: Date.now() };
    let hasError = false;

    // ── Duplicate check ────────────────────────────────────
    // Collect the identity fields entered so far (before full validation)
    // so we can check against existing registrations early.
    const checkEmail   = document.getElementById("trn-reg-email")?.value.trim().toLowerCase()        || "";
    const checkSleeper = document.getElementById("trn-reg-sleeperUsername")?.value.trim().toLowerCase() || "";
    const checkDlr     = (_currentUsername || "").toLowerCase();

    const existingRegs = Object.values(t.registrations || {});
    const duplicate = existingRegs.find(r => {
      if (checkDlr    && r.dlrUsername?.toLowerCase()      === checkDlr)     return true;
      if (checkEmail  && r.email?.toLowerCase()            === checkEmail)   return true;
      if (checkSleeper && r.sleeperUsername?.toLowerCase() === checkSleeper) return true;
      return false;
    });

    if (duplicate) {
      errEl.textContent = "You've already registered for this tournament. Contact the admin if you need to update your info.";
      errEl.classList.remove("hidden");
      return;
    }

    // Collect all form fields — only STD_FIELDS are truly required
    for (const f of fields) {
      const val = document.getElementById(`trn-reg-${f}`)?.value.trim();
      if (!val && STD_FIELDS.includes(f)) {
        errEl.textContent = `${_fieldLabel(f)} is required.`;
        errEl.classList.remove("hidden");
        hasError = true;
        break;
      }
      if (val) entry[f] = val;
      // Store blank optional fields as null so missing-info detection works
      else if (!STD_FIELDS.includes(f)) entry[f] = null;
    }
    if (hasError) return;

    // Collect custom questions
    for (let i = 0; i < custom.length; i++) {
      const q   = custom[i];
      const val = document.getElementById(`trn-reg-custom-${i}`)?.value.trim();
      if (q.required && !val) {
        errEl.textContent = `"${q.question}" is required.`;
        errEl.classList.remove("hidden");
        return;
      }
      if (val) entry[`custom_${i}`] = val;
    }

    // Auto-register preference
    const autoRegister = document.getElementById("trn-reg-auto")?.checked || false;
    entry.autoRegister = autoRegister;
    entry.dlrUsername  = _currentUsername || null;

    const btn = document.getElementById("trn-submit-reg-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Submitting…"; }

    try {
      const rid = _genId();
      await _tRegsRef(tid).child(rid).set(entry);

      // Update public registration count
      const freshForPub = await _tRef(tid).once("value");
      _tournaments[tid] = freshForPub.val();
      _writePublicSummary(tid, _tournaments[tid]);

      // If auto-register, also save preference on the participant record if one exists
      if (autoRegister) {
        const participants = t.participants || {};
        const myPid = Object.keys(participants).find(pid =>
          participants[pid].dlrLinked && participants[pid].dlrUsername === _currentUsername
        );
        if (myPid) {
          await _tParticipantsRef(tid).child(myPid).update({ autoRegister: true });
        }
      }

      const body = document.getElementById("trn-tab-body");
      if (body) {
        body.innerHTML = `
          <div class="trn-success">
            <div class="trn-success-icon">✅</div>
            <h3>Registration Submitted!</h3>
            <p>Your registration for <strong>${_esc(t.meta?.name || "this tournament")}</strong> is pending review.
            You'll receive a league invite link once approved.</p>
            ${autoRegister ? `<p style="font-size:.85rem;color:var(--color-text-dim)">You've opted in to auto-register for future years of this tournament.</p>` : ""}
          </div>`;
      }
    } catch(err) {
      if (btn) { btn.disabled = false; btn.textContent = "Submit Registration"; }
      errEl.textContent = "Submission failed: " + err.message;
      errEl.classList.remove("hidden");
    }
  }

  // ── Modal helpers ──────────────────────────────────────
  function _showModal(html) {
    let overlay = document.getElementById("trn-modal-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id        = "trn-modal-overlay";
      overlay.className = "modal-overlay";
      overlay.innerHTML = `<div class="modal-box modal-box--sm" id="trn-modal-box"></div>`;
      overlay.addEventListener("click", e => { if (e.target === overlay) _closeModal(); });
      document.body.appendChild(overlay);
    }
    document.getElementById("trn-modal-box").innerHTML = html;
    overlay.classList.remove("hidden");
  }

  function _closeModal() {
    document.getElementById("trn-modal-overlay")?.classList.add("hidden");
  }

  // ── Utilities ──────────────────────────────────────────
  function _esc(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function _camelToLabel(s) {
    return String(s || "")
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, c => c.toUpperCase())
      .trim();
  }

  // ── Public tournament summary ─────────────────────────
  // Written to gmd/publicTournaments/{tid} — readable without auth.
  // Contains only non-sensitive data: meta, standings cache, league/reg counts.
  // Called after: standings sync, meta updates, new registrations, status changes.

  // ── Write ADP snapshot to public node ─────────────────────────────────────
  // Called after draft cache is built. Writes a slim array to
  // gmd/publicTournaments/{tid}/adp so the public page can render it
  // without requiring auth. Shape: [{name, position, adp, count}, ...]
  // playerIds and raw picks are intentionally omitted.
  async function _writePublicADP(tid) {
    try {
      const snap = await _tAnalyticsRef(tid).child("drafts").once("value");
      const cached = snap.val() || {};
      if (!Object.keys(cached).length) return;

      // Collect all picks across all cached leagues for the active year
      const activeYear = _tournamentYear || new Date().getFullYear();
      const allPicks = [];
      for (const [, lc] of Object.entries(cached)) {
        if (!lc.picks?.length) continue;
        if (lc.year && parseInt(lc.year) !== parseInt(activeYear)) continue;
        lc.picks.forEach(p => {
          if (p.playerId) allPicks.push({
            playerId: p.playerId,
            name:     p.name     || "Unknown",
            position: (p.position || "?").toUpperCase(),
            overall:  parseInt(p.overall || 1)
          });
        });
      }
      if (!allPicks.length) return;

      // Compute ADP — same logic as _computeADP
      const byPlayer = {};
      allPicks.forEach(p => {
        if (!byPlayer[p.playerId]) byPlayer[p.playerId] = { name: p.name, position: p.position, overalls: [] };
        byPlayer[p.playerId].overalls.push(p.overall);
        if (p.name && p.name !== "Unknown") byPlayer[p.playerId].name = p.name;
      });
      const _pct = (arr, p) => {
        if (arr.length === 1) return arr[0];
        const idx = p * (arr.length - 1);
        const lo  = Math.floor(idx), hi = Math.ceil(idx);
        return +(arr[lo] + (arr[hi] - arr[lo]) * (idx - lo)).toFixed(1);
      };
      const adp = Object.values(byPlayer).map(d => {
        const sorted = [...d.overalls].sort((a, b) => a - b);
        const adpVal = parseFloat((sorted.reduce((s, v) => s + v, 0) / sorted.length).toFixed(1));
        return {
          name:     d.name,
          position: d.position,
          adp:      adpVal,
          count:    sorted.length,
          min:      sorted[0],
          max:      sorted[sorted.length - 1],
          p25:      _pct(sorted, 0.25),
          p75:      _pct(sorted, 0.75)
        };
      }).sort((a, b) => a.adp - b.adp);

      // Write year-keyed so public page can show correct year; also keep flat /adp as fallback
      await Promise.all([
        GMD.child(`publicTournaments/${tid}/adpByYear/${activeYear}`).set(adp),
        GMD.child(`publicTournaments/${tid}/adp`).set(adp)
      ]);
      console.log(`[Tournament] Public ADP written for ${activeYear}: ${adp.length} players`);
    } catch(err) {
      console.warn("[Tournament] _writePublicADP failed:", err.message);
    }
  }

  async function _writePublicSummary(tid, t) {
    try {
      const meta  = t.meta || {};
      const regs  = t.registrations || {};
      const leagues = t.leagues || {};
      const isBatch = (v) => v && typeof v === "object" && v.leagues !== undefined;
      const leagueCount = Object.entries(leagues).reduce((sum, [, v]) =>
        sum + (isBatch(v) ? Object.keys(v.leagues || {}).length : 1), 0);

      // Build a slim participant map for the public page.
      // Firebase keys cannot contain . # $ / [ ] — sanitize every key.
      const _psk = (s) => String(s).trim().toLowerCase().replace(/[.#$\/\[\]]/g, "_");
      const participantMap = {};
      Object.values(t.participants || {}).forEach(p => {
        const keys = [p.sleeperUsername, p.displayName, p.teamName]
          .filter(Boolean).map(_psk).filter(Boolean);
        keys.forEach(k => {
          participantMap[k] = {
            displayName:   p.displayName   || null,
            gender:        p.gender        || null,
            twitterHandle: p.twitterHandle || null
          };
        });
      });

      const summary = {
        name:              meta.name         || "",
        tagline:           meta.tagline      || "",
        status:            meta.status       || "draft",
        regType:           meta.regType      || "open",
        rankBy:            meta.rankBy       || "record",
        bio:               meta.bio          || "",
        donationLink:      meta.donationLink || "",
        socialLinks:       meta.socialLinks  || {},
        createdAt:         meta.createdAt        || 0,
        registrationYear:  meta.registrationYear || null,
        leagueCount,
        registrationCount: Object.keys(regs).length,
        registrationForm:  meta.registrationForm || { fields: [], optionalFields: [], customQuestions: [] },
        standingsCache:    t.standingsCache  || {},
        rulesByYear:       t.rulesByYear      || {},
        participantMap
      };

      await GMD.child("publicTournaments/" + tid).update(summary);
    } catch(err) {
      console.warn("[Tournament] _writePublicSummary failed:", err.message);
    }
  }

  // ── Public API ─────────────────────────────────────────
  return {
    init,
    runDiscovery
  };

})();
