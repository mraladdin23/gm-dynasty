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
    const adminOpts = `
      <option value="overview"      ${_activeAdminTab === "overview"      ? "selected" : ""}>📊 Overview</option>
      <option value="leagues"       ${_activeAdminTab === "leagues"       ? "selected" : ""}>🏟 Leagues</option>
      <option value="roles"         ${_activeAdminTab === "roles"         ? "selected" : ""}>👤 Roles</option>
      <option value="registration"  ${_activeAdminTab === "registration"  ? "selected" : ""}>📝 Registration Form</option>
      <option value="registrations" ${_activeAdminTab === "registrations" ? "selected" : ""}>📋 Registrants${Object.keys(t.registrations||{}).length ? " (" + Object.keys(t.registrations).length + ")" : ""}</option>
      <option value="participants"  ${_activeAdminTab === "participants"  ? "selected" : ""}>👥 Participants${Object.keys(t.participants||{}).length ? " (" + Object.keys(t.participants).length + ")" : ""}</option>
      <option value="info_edit"     ${_activeAdminTab === "info_edit"     ? "selected" : ""}>✏ Info / Rules</option>`;

    const userOpts = `
      <option value="info"      ${_activeUserTab === "info"      ? "selected" : ""}>ℹ Info</option>
      <option value="rules"     ${_activeUserTab === "rules"     ? "selected" : ""}>📋 Rules</option>
      <option value="standings" ${_activeUserTab === "standings" ? "selected" : ""}>🏆 Standings</option>
      <option value="draft"     ${_activeUserTab === "draft"     ? "selected" : ""}>📋 Draft</option>
      <option value="matchups"  ${_activeUserTab === "matchups"  ? "selected" : ""}>🏈 Matchups</option>
      <option value="rosters"   ${_activeUserTab === "rosters"   ? "selected" : ""}>🗂 Rosters</option>`;
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
        case "draft":         return _renderAnalyticsDraft(tid, t, body);
        case "matchups":      return _renderAnalyticsMatchups(tid, t, body);
        case "rosters":       return _renderAnalyticsRosters(tid, t, body);
        case "info_edit":     return _renderAdminInfoEdit(tid, t, body);
        default:              return _renderAdminOverview(tid, t, body);
      }
    } else {
      switch (tab) {
        case "info":       return _renderInfoTab(t, body);
        case "register":   return _renderRegisterTab(tid, t, body);
        case "rules":      return _renderRulesTab(t, body);
        case "standings":  return _renderStandingsTab(tid, t, body, false);
        case "draft":      return _renderAnalyticsDraft(tid, t, body);
        case "matchups":   return _renderAnalyticsMatchups(tid, t, body);
        case "rosters":    return _renderAnalyticsRosters(tid, t, body);
        default:           return _renderInfoTab(t, body);
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
    const years = [...new Set([...Object.keys(rby).map(Number), curY])]
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
              <select id="trn-rankby-select" style="font-size:.82rem;padding:2px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text)">
                <option value="record" ${(meta.rankBy || "record") === "record" ? "selected" : ""}>Record then PF</option>
                <option value="pf"     ${meta.rankBy === "pf" ? "selected" : ""}>Points For only</option>
              </select>
            </span>
          </div>
          <div class="trn-detail-row">
            <span>Playoff Start Week</span>
            <span>
              <input type="number" id="trn-playoff-week-input" min="1" max="18"
                value="${meta.playoffStartWeek || ""}"
                placeholder="e.g. 15"
                style="width:70px;font-size:.82rem;padding:2px 6px;border:1px solid var(--color-border);border-radius:var(--radius-sm);background:var(--color-surface);color:var(--color-text);text-align:center" />
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
    document.getElementById("trn-rankby-select")?.addEventListener("change", async function() {
      try {
        await _tMetaRef(tid).update({ rankBy: this.value });
        _tournaments[tid].meta.rankBy = this.value;
        _writePublicSummary(tid, _tournaments[tid]);
        showToast("Ranking method saved ✓");
      } catch(e) { showToast("Failed to save ranking method", "error"); }
    });

    // Playoff start week — save on blur or Enter
    const playoffWeekInput = document.getElementById("trn-playoff-week-input");
    const _savePlayoffWeek = async function() {
      const raw = parseInt(playoffWeekInput?.value) || null;
      const prev = t.meta?.playoffStartWeek || null;
      if (raw === prev) return; // no change
      try {
        await _tMetaRef(tid).update({ playoffStartWeek: raw });
        if (_tournaments[tid]?.meta) _tournaments[tid].meta.playoffStartWeek = raw;
        showToast(raw ? `Playoff start week set to ${raw} ✓` : "Playoff start week cleared ✓");
      } catch(e) { showToast("Failed to save playoff week", "error"); }
    };
    playoffWeekInput?.addEventListener("blur", _savePlayoffWeek);
    playoffWeekInput?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); _savePlayoffWeek(); } });

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

    document.getElementById("trn-preview-user-btn")?.addEventListener("click", () => {
      _viewingAsUser = true;
      _openTournamentView(tid);
    });
  }

  // _openTournamentViewAsUser removed — now handled via _viewingAsUser flag in _openTournamentView

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
        <div style="font-size:.8rem;color:var(--color-text-dim);line-height:1.7">
          Requires a header row. Columns should match your registration form:<br>
          <strong>Required:</strong> <code>displayName, email</code><br>
          <strong>Platform (for DLR matching):</strong> <code>sleeperUsername, mflEmail, yahooUsername</code><br>
          <strong>Optional (if enabled on your form):</strong> <code>teamName, twitterHandle, gender</code><br>
          <strong>History:</strong> <code>years</code> — pipe-separated e.g. <code>2023|2024</code><br>
          Missing fields are imported as blank — no rows are rejected.
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
      '<th data-sort-col="leagueName" class="trn-col-league" style="' + thBase + '">League' + si("leagueName") + "</th>" +
      (hasConf ? '<th data-sort-col="conference" class="trn-col-conf" style="' + thBase + ';width:52px">Conf' + si("conference") + "</th>" : "") +
      (hasDiv  ? '<th data-sort-col="division"   class="trn-col-conf" style="' + thBase + ';width:52px">Div'  + si("division")   + "</th>" : "") +
      extra.map(col => '<th data-sort-col="' + col.key + '" style="' + thBase + '">' + col.label + si(col.key) + "</th>").join("") +
      '<th class="standings-win"  data-sort-col="wins"   style="' + thBase + ';width:36px">W'  + si("wins")   + "</th>" +
      '<th class="standings-loss" data-sort-col="losses" style="' + thBase + ';width:36px">L'  + si("losses") + "</th>" +
      '<th class="standings-num"  data-sort-col="pf"     style="' + thBase + ';width:64px">PF' + si("pf")     + "</th>" +
      '<th class="standings-num dim" data-sort-col="pa"  style="' + thBase + ';width:64px">PA' + si("pa")     + "</th>" +
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
      '<td><span class="standings-team-cell"><span class="st-av">' + _esc((r.teamName||"?").slice(0,2).toUpperCase()) + "</span><span class=\"trn-st-name-wrap\"><span class=\"trn-st-name\">" + _esc(r.teamName) + genderBadge(r.gender) + twitterLink(r) + "</span><span class=\"trn-st-league trn-st-league--mobile\">" + (r.twitterHandle ? '<a href="https://x.com/' + _esc(r.twitterHandle.startsWith("@") ? r.twitterHandle.slice(1) : r.twitterHandle) + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">' + _esc(r.teamName) + "</a>" : _esc(r.teamName)) + " · " + _esc(r.leagueName) + "</span></span></span></td>" +
      '<td class="trn-col-league">' + _esc(r.leagueName) + "</td>" +
      (hasConf ? '<td class="trn-col-conf">' + _esc(r.conference) + "</td>" : "") +
      (hasDiv  ? '<td class="trn-col-conf">' + _esc(r.division)   + "</td>" : "") +
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
      '<td class="standings-num dim">' + r.pa.toFixed(2) + "</td>" +
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

    // Cache key: year_leagueId prevents cross-year collision for same leagueId
    const ck = (l) => l.year + "_" + l.leagueId;
    const playoffWeek = t.meta?.playoffStartWeek || null;

    // Sleeper — parallel
    const medianWins = !!(t.meta?.medianWins);
    await Promise.allSettled(sleepers.map(async (l) => {
      try {
        const data = await _fetchSleeperStandings(l.leagueId, playoffWeek);
        if (data) {
          let { teams, weeklyScores } = data;
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
          cacheUpdates[ck(l)] = { ...l, teams, lastSynced: Date.now() };
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
        } catch(e) { console.warn("[Standings] MFL", l.leagueId, e.message); }
        done++; setP("Syncing " + done + "/" + total + "...");
      }));
      if (i + 3 < mfls.length) await new Promise(r => setTimeout(r, 300));
    }

    // Yahoo — 2 at a time, 600ms gap
    const yahooToken = localStorage.getItem("dlr_yahoo_access_token");
    if (yahoos.length && !yahooToken) {
      showToast("Yahoo standings skipped — connect Yahoo in your profile first", "info");
      done += yahoos.length;
    } else {
      for (let i = 0; i < yahoos.length; i += 2) {
        await Promise.allSettled(yahoos.slice(i, i + 2).map(async (l) => {
          try {
            const data = await _fetchYahooStandings(l.leagueId, yahooToken);
            if (data) cacheUpdates[ck(l)] = { ...l, ...data, lastSynced: Date.now() };
          } catch(e) { console.warn("[Standings] Yahoo", l.leagueId, e.message); }
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
      if (btn) { btn.disabled = false; btn.textContent = "Sync Standings"; }
      showToast("Standings synced — " + Object.keys(cacheUpdates).length + "/" + total + " leagues");
      _writePublicSummary(tid, _tournaments[tid]);
      const body = document.getElementById("trn-tab-body");
      if (body) _renderLeaguesTab(tid, _tournaments[tid], body);
    } catch(err) {
      if (btn) { btn.disabled = false; btn.textContent = "Sync Standings"; }
      showToast("Failed to save: " + err.message, "error");
    }
  }

  // ── Platform fetchers ──────────────────────────────────

  async function _fetchSleeperStandings(leagueId, playoffStartWeek) {
    const [rU, rR] = await Promise.all([
      fetch("https://api.sleeper.app/v1/league/" + leagueId + "/users"),
      fetch("https://api.sleeper.app/v1/league/" + leagueId + "/rosters")
    ]);
    if (!rU.ok || !rR.ok) return null;
    const users   = await rU.json();
    const rosters = await rR.json();
    const uMap = {};
    (users || []).forEach(u => { uMap[u.user_id] = u.display_name || u.username || u.user_id; });

    // If playoffStartWeek is set, recompute W/L from matchup results
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
          teamId:   String(r.roster_id),
          teamName: uMap[r.owner_id] || ("Team " + r.roster_id),
          wins:     s.wins,
          losses:   s.losses,
          ties:     s.ties,
          pf:       parseFloat(s.pf.toFixed(2)),
          pa:       parseFloat(s.pa.toFixed(2))
        };
      });
      // Median wins: pass weeklyScores to allow caller to apply them
      return { teams, weeklyScores: allWeeks };
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
      teamId:   String(r.roster_id),
      teamName: uMap[r.owner_id] || ("Team " + r.roster_id),
      wins:     r.settings?.wins    || 0,
      losses:   r.settings?.losses  || 0,
      ties:     r.settings?.ties    || 0,
      pf:       parseFloat(((r.settings?.fpts || 0) + (r.settings?.fpts_decimal || 0) / 100).toFixed(2)),
      pa:       parseFloat(((r.settings?.fpts_against || 0) + (r.settings?.fpts_against_decimal || 0) / 100).toFixed(2))
    }));
    return { teams, weeklyScores };
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

    // Build unique team list from all picks
    const teamSet = {};
    picks.forEach(p => { if (p.teamId) teamSet[p.teamId] = p.teamName || p.teamId; });
    const teams = Object.entries(teamSet).sort((a, b) => a[1].localeCompare(b[1]));

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
              ${teams.map(([id, name]) => `<option value="${_esc(id)}" ${_draftCardTeam === id ? "selected" : ""}>${_esc(name)}</option>`).join("")}
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
        teams.filter(([, name]) => !_draftSearch || name.toLowerCase().includes(_draftSearch))
          .map(([id, name]) => `<option value="${_esc(id)}" ${_draftCardTeam === id ? "selected" : ""}>${_esc(name)}</option>`).join("");
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
      : "32px 1fr 36px 52px 40px 76px 40px";
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
        <span style="text-align:right">ADP</span>
        <span style="text-align:right">Min</span>
        <span style="text-align:center">Range</span>
        <span style="text-align:right">Max</span>
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
           <span style="text-align:right;font-size:.82rem;font-variant-numeric:tabular-nums">${p.adp.toFixed(1)}</span>
           <span class="dim" style="text-align:right;font-size:.78rem;font-variant-numeric:tabular-nums">${mn}</span>
           <span style="text-align:center;font-size:.75rem;color:var(--color-text-muted);font-variant-numeric:tabular-nums">${rangeStr}</span>
           <span class="dim" style="text-align:right;font-size:.78rem;font-variant-numeric:tabular-nums">${mx}</span>`;
      return `
        <div class="draft-auction-row" style="grid-template-columns:${COL}" ${clickAttr}>
          <span class="draft-auction-rank dim" style="font-size:.75rem">${(_draftListPage - 1) * PAGE_SIZE + i + 1}</span>
          <div>
            <div style="display:flex;align-items:center;gap:4px">
              <span class="draft-pos-badge" style="background:${col}22;color:${col};border-color:${col}55;flex-shrink:0">${_esc(p.position || "?")}</span>
              <span class="draft-auction-name">${_esc(p.name || "Unknown")}</span>
            </div>
            <div class="dim" style="font-size:.7rem;padding-left:2px">${_esc(nfl)}</div>
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
            boardHTML += `
              <div class="draft-pick draft-pick--filled"
                ${clickFn ? `onclick="${clickFn}" style="cursor:pointer"` : ""}
                title="${_esc(pName)} · ${pos} · ${nfl}">
                <div class="draft-pick-num">${overallNum}</div>
                <div class="draft-pick-player">
                  <div class="draft-pick-name">${_esc(pName)}</div>
                  <div class="draft-pick-meta">
                    <span class="draft-pos-badge" style="background:${col}22;color:${col};border-color:${col}55">${pos}</span>
                    <span class="draft-pick-nfl">${nfl}</span>
                  </div>
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
            <div class="dim" style="font-size:.7rem">${_esc(p.nflTeam || "FA")}</div>
          </div>
          <span class="draft-auction-team" style="font-size:.82rem;align-self:center">${_esc(p.teamName || "")}</span>
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
  function _renderInfoTab(t, body) {
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
      // Switch to rules tab if available
      const rulesTab = document.querySelector('.trn-tab[data-tab="rules"]');
      if (rulesTab) {
        rulesTab.click();
      } else {
        // Inline expand: replace preview card with full rules
        _renderRulesTab(t, body);
      }
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
