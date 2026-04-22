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

  // Standard registration fields (always shown)
  const STD_FIELDS = ["teamName", "displayName", "email", "platformUsername"];
  const STD_FIELD_LABELS = {
    teamName:         "Team Name",
    displayName:      "Display Name",
    email:            "Email Address",
    platformUsername: "Platform Username"
  };
  // Optional toggle fields
  const OPT_FIELDS = ["twitterHandle", "favoriteNflTeam", "gender"];
  const OPT_FIELD_LABELS = {
    twitterHandle:    "Twitter/X Handle",
    favoriteNflTeam:  "Favorite NFL Team",
    gender:           "Gender"
  };

  // ── State ──────────────────────────────────────────────
  let _currentUsername = null;
  let _tournaments     = {};      // { [tournamentId]: tournament }
  let _activeTournamentId = null; // currently open tournament
  let _activeAdminTab  = "overview";
  let _activeUserTab   = "info";

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
      const notDraft   = t.meta.status !== "draft";
      if (isAdmin || isSubAdmin || isDiscovered || notDraft) {
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

    // Tab counts (only show badge if > 0)
    const mineBadge  = myEntries.length    ? `<span class="trn-tab-count">${myEntries.length}</span>`    : "";
    const adminBadge = adminEntries.length ? `<span class="trn-tab-count">${adminEntries.length}</span>` : "";

    container.innerHTML = `
      <div class="trn-container">
        <div class="trn-header">
          <div class="trn-header-left">
            <h2 class="trn-title">🏆 Tournaments</h2>
            <p class="trn-subtitle">Large-scale multi-platform competition</p>
          </div>
          <button class="btn-primary btn-sm" id="trn-create-btn">+ New Tournament</button>
        </div>

        <div class="trn-landing-tabs">
 	  <button class="trn-landing-tab ${_landingTab === "all"      ? "active" : ""}" data-landing="all">
            All Tournaments
          </button>
          <button class="trn-landing-tab ${_landingTab === "mine"     ? "active" : ""}" data-landing="mine">
            My Tournaments ${mineBadge}
          </button>
          <button class="trn-landing-tab ${_landingTab === "managing" ? "active" : ""}" data-landing="managing">
            Managing ${adminBadge}
          </button>
        </div>

        <div id="trn-landing-body"></div>
      </div>
    `;

    document.getElementById("trn-create-btn")?.addEventListener("click", () => _openCreateModal());

    container.querySelectorAll(".trn-landing-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        container.querySelectorAll(".trn-landing-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        _landingTab = tab.dataset.landing;
        _renderLandingBody(allEntries, myEntries, adminEntries);
      });
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
      btn.addEventListener("click", () => _openTournamentView(btn.dataset.trnOpen));
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
          <span>📅 ${meta.season || "—"}</span>
          <span>🏟 ${leagueCount} league${leagueCount !== 1 ? "s" : ""}</span>
          <span>👥 ${regCount} registered</span>
        </div>
        ${meta.tagline ? `<div class="trn-card-tagline">${_esc(meta.tagline)}</div>` : ""}
        <div class="trn-card-actions">
          <button class="btn-secondary btn-sm" data-trn-open="${_esc(tid)}">
            ${isAdmin ? "Manage" : "View"}
          </button>
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
          <label>Season / Year</label>
          <input type="text" id="trn-new-season" placeholder="2025" maxlength="10" />
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
    const season   = document.getElementById("trn-new-season")?.value.trim();
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
          season:      season || String(new Date().getFullYear()),
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

    const isAdmin    = t.roles?.[_currentUsername]?.role === "admin";
    const isSubAdmin = t.roles?.[_currentUsername]?.role === "sub_admin";
    const canAdmin   = isAdmin || isSubAdmin;
    const meta       = t.meta || {};

    container.innerHTML = `
      <div class="trn-detail-container">

        <!-- Back + Header -->
        <div class="trn-detail-topbar">
          <button class="btn-ghost btn-sm" id="trn-back-btn">← All Tournaments</button>
          <span class="trn-status-badge trn-status-${meta.status || "draft"}">
            ${STATUS_ICONS[meta.status] || ""} ${STATUS_LABELS[meta.status] || "Draft"}
          </span>
        </div>

        <div class="trn-detail-title-row">
          <div>
            <h2 class="trn-detail-name">${_esc(meta.name || "Untitled")}</h2>
            ${meta.tagline ? `<p class="trn-detail-tagline">${_esc(meta.tagline)}</p>` : ""}
          </div>
          ${canAdmin ? `<button class="btn-secondary btn-sm" id="trn-edit-meta-btn">✏ Edit</button>` : ""}
        </div>

        <!-- Tab bar -->
        <div class="trn-tabs" id="trn-tabs">
          ${canAdmin ? `
            <button class="trn-tab ${_activeAdminTab === "overview"      ? "active" : ""}" data-tab="overview">Overview</button>
            <button class="trn-tab ${_activeAdminTab === "leagues"       ? "active" : ""}" data-tab="leagues">Leagues</button>
            <button class="trn-tab ${_activeAdminTab === "roles"         ? "active" : ""}" data-tab="roles">Roles</button>
            <button class="trn-tab ${_activeAdminTab === "registration"  ? "active" : ""}" data-tab="registration">Registration</button>
            <button class="trn-tab ${_activeAdminTab === "registrations" ? "active" : ""}" data-tab="registrations">
              Registrants
              ${Object.keys(t.registrations || {}).length ? `<span class="trn-tab-count">${Object.keys(t.registrations).length}</span>` : ""}
            </button>
          ` : `
            <button class="trn-tab ${_activeUserTab === "info" ? "active" : ""}" data-tab="info">Info</button>
            <button class="trn-tab ${_activeUserTab === "register" ? "active" : ""}" data-tab="register">Register</button>
          `}
        </div>

        <div id="trn-tab-body" class="trn-tab-body"></div>
      </div>
    `;

    document.getElementById("trn-back-btn")?.addEventListener("click", () => _renderView(_landingTab));
    document.getElementById("trn-edit-meta-btn")?.addEventListener("click", () => _openEditMetaModal(tid, t));

    // Tab wire-up
    container.querySelectorAll(".trn-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        container.querySelectorAll(".trn-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const tabName = tab.dataset.tab;
        if (canAdmin) _activeAdminTab = tabName;
        else _activeUserTab = tabName;
        _renderTab(tid, tabName, t, canAdmin);
      });
    });

    // Render default tab
    const defaultTab = canAdmin ? _activeAdminTab : _activeUserTab;
    _renderTab(tid, defaultTab, t, canAdmin);
  }

  // ── Tab router ─────────────────────────────────────────
  function _renderTab(tid, tab, t, canAdmin) {
    const body = document.getElementById("trn-tab-body");
    if (!body) return;

    if (canAdmin) {
      switch (tab) {
        case "overview":      return _renderAdminOverview(tid, t, body);
        case "leagues":       return _renderLeaguesTab(tid, t, body);
        case "roles":         return _renderRolesTab(tid, t, body);
        case "registration":  return _renderRegistrationFormTab(tid, t, body);
        case "registrations": return _renderRegistrantsTab(tid, t, body);
        default:              return _renderAdminOverview(tid, t, body);
      }
    } else {
      switch (tab) {
        case "info":     return _renderInfoTab(t, body);
        case "register": return _renderRegisterTab(tid, t, body);
        default:         return _renderInfoTab(t, body);
      }
    }
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
          <div class="trn-detail-row"><span>Season</span><span>${_esc(meta.season || "—")}</span></div>
          <div class="trn-detail-row"><span>Registration</span><span>${meta.regType === "invite" ? "Invite Only" : "Open"}</span></div>
          <div class="trn-detail-row"><span>Created by</span><span>@${_esc(meta.createdBy || "—")}</span></div>
          <div class="trn-detail-row"><span>Created</span><span>${meta.createdAt ? new Date(meta.createdAt).toLocaleDateString() : "—"}</span></div>
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
  }

  async function _changeStatus(tid, newStatus) {
    try {
      await _tMetaRef(tid).update({ status: newStatus });
      showToast(`Status updated to: ${STATUS_LABELS[newStatus]} ✓`);
      // Reload view
      const snap = await _tRef(tid).once("value");
      _tournaments[tid] = snap.val();
      _openTournamentView(tid);
    } catch(err) {
      showToast("Failed to update status", "error");
    }
  }

  // ── Admin: Leagues tab ─────────────────────────────────
  function _renderLeaguesTab(tid, t, body) {
    const leagues = t.leagues || {};
    const leagueList = Object.entries(leagues);

    body.innerHTML = `
      <div class="trn-section-card">
        <div class="trn-section-card-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>Tournament Leagues (${leagueList.length})</span>
          <button class="btn-primary btn-sm" id="trn-add-league-btn">+ Add League</button>
        </div>

        ${leagueList.length ? `
          <div class="trn-league-list" id="trn-league-list">
            ${leagueList.map(([lid, l]) => `
              <div class="trn-league-row" data-lid="${_esc(lid)}">
                <div class="trn-league-row-main">
                  <span class="trn-platform-badge trn-platform-${l.platform || "unknown"}">${(l.platform || "?").toUpperCase()}</span>
                  <div class="trn-league-row-info">
                    <div class="trn-league-row-name">${_esc(l.name || l.leagueId || lid)}</div>
                    <div class="trn-league-row-meta">
                      ID: ${_esc(String(l.leagueId || lid))}
                      ${l.conference ? ` · ${_esc(l.conference)}` : ""}
                      ${l.division   ? ` · Div: ${_esc(l.division)}` : ""}
                    </div>
                  </div>
                </div>
                <div class="trn-league-row-actions">
                  <button class="btn-secondary btn-sm" data-edit-lid="${_esc(lid)}">Edit</button>
                  <button class="btn-ghost btn-sm trn-delete-btn" data-del-lid="${_esc(lid)}">✕</button>
                </div>
              </div>
            `).join("")}
          </div>
        ` : `<div class="trn-empty-inline">No leagues added yet. Add league IDs from MFL, Yahoo, or Sleeper.</div>`}
      </div>
    `;

    document.getElementById("trn-add-league-btn")?.addEventListener("click", () =>
      _openAddLeagueModal(tid)
    );
    body.querySelectorAll("[data-edit-lid]").forEach(btn =>
      btn.addEventListener("click", () => _openEditLeagueModal(tid, btn.dataset.editLid, leagues[btn.dataset.editLid]))
    );
    body.querySelectorAll("[data-del-lid]").forEach(btn =>
      btn.addEventListener("click", () => _deleteLeague(tid, btn.dataset.delLid))
    );
  }

  function _openAddLeagueModal(tid) {
    _showModal(`
      <div class="modal-header">
        <h3>Add League</h3>
        <button class="modal-close" id="trn-modal-close">✕</button>
      </div>
      <div class="modal-body trn-form-body">
        <div class="form-group">
          <label>Platform <span class="required">*</span></label>
          <select id="trn-lg-platform">
            <option value="sleeper">Sleeper</option>
            <option value="mfl">MyFantasyLeague (MFL)</option>
            <option value="yahoo">Yahoo Fantasy</option>
          </select>
        </div>
        <div class="form-group">
          <label>League ID <span class="required">*</span></label>
          <input type="text" id="trn-lg-id" placeholder="Platform league ID" />
          <span class="field-hint">The numeric or alphanumeric league ID from the platform URL.</span>
        </div>
        <div class="form-group">
          <label>Display Name (optional)</label>
          <input type="text" id="trn-lg-name" placeholder="e.g. NFC East Division A" maxlength="60" />
        </div>
        <div class="form-group">
          <label>Conference (optional)</label>
          <input type="text" id="trn-lg-conf" placeholder="e.g. NFC" maxlength="40" />
        </div>
        <div class="form-group">
          <label>Division (optional)</label>
          <input type="text" id="trn-lg-div" placeholder="e.g. East" maxlength="40" />
        </div>
        <div id="trn-lg-error" class="auth-error hidden"></div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="trn-modal-cancel">Cancel</button>
        <button class="btn-primary"   id="trn-modal-confirm">Add League</button>
      </div>
    `);

    document.getElementById("trn-modal-cancel")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-close")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-confirm")?.addEventListener("click", async () => {
      const platform = document.getElementById("trn-lg-platform")?.value;
      const leagueId = document.getElementById("trn-lg-id")?.value.trim();
      const name     = document.getElementById("trn-lg-name")?.value.trim();
      const conf     = document.getElementById("trn-lg-conf")?.value.trim();
      const div      = document.getElementById("trn-lg-div")?.value.trim();
      const errEl    = document.getElementById("trn-lg-error");

      if (!leagueId) {
        errEl.textContent = "League ID is required.";
        errEl.classList.remove("hidden");
        return;
      }

      const lid = `${platform}_${leagueId}`;
      const data = { platform, leagueId, name: name || leagueId };
      if (conf) data.conference = conf;
      if (div)  data.division   = div;

      try {
        await _tLeaguesRef(tid).child(lid).set(data);
        showToast("League added ✓");
        _closeModal();
        const snap = await _tRef(tid).once("value");
        _tournaments[tid] = snap.val();
        _openTournamentView(tid);
        _activeAdminTab = "leagues";
      } catch(err) {
        errEl.textContent = err.message;
        errEl.classList.remove("hidden");
      }
    });
  }

  function _openEditLeagueModal(tid, lid, league) {
    _showModal(`
      <div class="modal-header">
        <h3>Edit League</h3>
        <button class="modal-close" id="trn-modal-close">✕</button>
      </div>
      <div class="modal-body trn-form-body">
        <div class="form-group">
          <label>Platform</label>
          <input type="text" value="${_esc(league.platform || "")}" disabled class="input-disabled" />
        </div>
        <div class="form-group">
          <label>League ID</label>
          <input type="text" value="${_esc(String(league.leagueId || ""))}" disabled class="input-disabled" />
        </div>
        <div class="form-group">
          <label>Display Name</label>
          <input type="text" id="trn-edit-lg-name" value="${_esc(league.name || "")}" maxlength="60" />
        </div>
        <div class="form-group">
          <label>Conference</label>
          <input type="text" id="trn-edit-lg-conf" value="${_esc(league.conference || "")}" maxlength="40" />
        </div>
        <div class="form-group">
          <label>Division</label>
          <input type="text" id="trn-edit-lg-div" value="${_esc(league.division || "")}" maxlength="40" />
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-secondary" id="trn-modal-cancel">Cancel</button>
        <button class="btn-primary"   id="trn-modal-confirm">Save</button>
      </div>
    `);

    document.getElementById("trn-modal-cancel")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-close")?.addEventListener("click", _closeModal);
    document.getElementById("trn-modal-confirm")?.addEventListener("click", async () => {
      const updates = {
        name:       document.getElementById("trn-edit-lg-name")?.value.trim() || league.leagueId,
        conference: document.getElementById("trn-edit-lg-conf")?.value.trim() || null,
        division:   document.getElementById("trn-edit-lg-div")?.value.trim() || null
      };
      try {
        await _tLeaguesRef(tid).child(lid).update(updates);
        showToast("League updated ✓");
        _closeModal();
        const snap = await _tRef(tid).once("value");
        _tournaments[tid] = snap.val();
        _openTournamentView(tid);
        _activeAdminTab = "leagues";
      } catch(err) {
        showToast("Failed to update league", "error");
      }
    });
  }

  async function _deleteLeague(tid, lid) {
    if (!confirm("Remove this league from the tournament?")) return;
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
        <div class="trn-section-card-title">Optional Fields</div>
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
          <label>Season</label>
          <input type="text" id="trn-edit-season" value="${_esc(meta.season || "")}" maxlength="10" />
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
        season:  document.getElementById("trn-edit-season")?.value.trim()  || meta.season,
        tagline: document.getElementById("trn-edit-tagline")?.value.trim() || ""
      };
      try {
        await _tMetaRef(tid).update(updates);
        showToast("Tournament updated ✓");
        _closeModal();
        const snap = await _tRef(tid).once("value");
        _tournaments[tid] = snap.val();
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

  // ── User: Info tab ─────────────────────────────────────
  function _renderInfoTab(t, body) {
    const meta = t.meta || {};
    const leagueCount = Object.keys(t.leagues || {}).length;

    body.innerHTML = `
      <div class="trn-info-hero">
        <h3 class="trn-info-name">${_esc(meta.name || "Tournament")}</h3>
        ${meta.tagline ? `<p class="trn-info-tagline">${_esc(meta.tagline)}</p>` : ""}
        <span class="trn-status-badge trn-status-${meta.status || "draft"}">
          ${STATUS_ICONS[meta.status] || ""} ${STATUS_LABELS[meta.status] || ""}
        </span>
      </div>

      <div class="trn-info-stats">
        <div class="trn-stat-card"><div class="trn-stat-value">${meta.season || "—"}</div><div class="trn-stat-label">Season</div></div>
        <div class="trn-stat-card"><div class="trn-stat-value">${leagueCount}</div><div class="trn-stat-label">Leagues</div></div>
        <div class="trn-stat-card"><div class="trn-stat-value">${meta.regType === "invite" ? "Invite" : "Open"}</div><div class="trn-stat-label">Registration</div></div>
      </div>

      <div class="trn-section-card">
        <div class="trn-section-card-title">About This Tournament</div>
        <p style="color:var(--color-text-dim);font-size:.87rem">
          ${meta.bio || "No description provided by the tournament admin."}
        </p>
      </div>
    `;
  }

  // ── User: Register tab ─────────────────────────────────
  function _renderRegisterTab(tid, t, body) {
    const meta   = t.meta || {};
    const form   = meta.registrationForm || {};
    const fields = form.fields         || STD_FIELDS;
    const opts   = form.optionalFields || [];
    const custom = form.customQuestions || [];
    const allFlds = [...fields, ...opts];

    if (meta.status === "draft") {
      body.innerHTML = `<div class="trn-empty">Registration is not open yet.</div>`;
      return;
    }
    if (meta.status === "completed") {
      body.innerHTML = `<div class="trn-empty">This tournament has concluded.</div>`;
      return;
    }

    body.innerHTML = `
      <div class="trn-section-card">
        <div class="trn-section-card-title">Register for ${_esc(meta.name || "Tournament")}</div>
        ${allFlds.map(f => `
          <div class="form-group">
            <label>${_esc(STD_FIELD_LABELS[f] || OPT_FIELD_LABELS[f] || _camelToLabel(f))}</label>
            <input type="text" id="trn-reg-${f}" placeholder="${_esc(STD_FIELD_LABELS[f] || f)}" />
          </div>
        `).join("")}
        ${custom.map((q, i) => `
          <div class="form-group">
            <label>${_esc(q.question)}${q.required ? ' <span class="required">*</span>' : ""}</label>
            ${q.type === "textarea"
              ? `<textarea id="trn-reg-custom-${i}" rows="3" placeholder="Your answer..."></textarea>`
              : `<input type="text" id="trn-reg-custom-${i}" placeholder="Your answer..." />`
            }
          </div>
        `).join("")}
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

  async function _submitRegistration(tid, t, fields, custom) {
    const errEl = document.getElementById("trn-reg-error");
    const entry = { status: "pending", submittedAt: Date.now() };

    // Collect standard + optional fields
    for (const f of fields) {
      const val = document.getElementById(`trn-reg-${f}`)?.value.trim();
      if (!val && STD_FIELDS.includes(f)) {
        errEl.textContent = `${STD_FIELD_LABELS[f]} is required.`;
        errEl.classList.remove("hidden");
        return;
      }
      if (val) entry[f] = val;
    }

    // Collect custom questions
    custom.forEach((q, i) => {
      const val = document.getElementById(`trn-reg-custom-${i}`)?.value.trim();
      if (q.required && !val) {
        errEl.textContent = `"${q.question}" is required.`;
        errEl.classList.remove("hidden");
        return;
      }
      if (val) entry[`custom_${i}`] = val;
    });

    const btn = document.getElementById("trn-submit-reg-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Submitting…"; }

    try {
      const rid = _genId();
      await _tRegsRef(tid).child(rid).set(entry);
      const body = document.getElementById("trn-tab-body");
      if (body) {
        body.innerHTML = `
          <div class="trn-success">
            <div class="trn-success-icon">✅</div>
            <h3>Registration Submitted!</h3>
            <p>Your registration for <strong>${_esc(t.meta?.name || "this tournament")}</strong> is pending review.
            You'll receive a league invite link once approved.</p>
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

  // ── Public API ─────────────────────────────────────────
  return {
    init,
    runDiscovery
  };

})();
