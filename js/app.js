// ─────────────────────────────────────────────────────────
//  GM Dynasty — App Entry Point
//  Orchestrates screen transitions, auth state, and all
//  top-level UI event handling.
// ─────────────────────────────────────────────────────────

// ── Global app state (accessible by other modules) ────────
const AppState = {
  currentProfile: null,
  currentView:    "locker",

  showScreen(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    const target = document.getElementById(id);
    if (target) target.classList.add("active");
  },

  showWelcome(profile) {
    AppState.currentProfile = profile;
    const el = document.getElementById("welcome-username");
    if (el) el.textContent = "@" + profile.username;
    AppState.showScreen("welcome-screen");
    setLoading(false);
  },

  showOnboarding() {
    AppState.showScreen("onboarding-screen");
  },

  showApp(profile) {
    AppState.currentProfile = profile;
    Profile.renderLocker(profile);
    Profile.initArchivedToggle();
    AppState.showScreen("app-screen");
    setLoading(false);

    // Init tournament module (non-blocking)
    if (typeof DLRTournament !== "undefined") {
      DLRTournament.init(profile.username).catch(err =>
        console.warn("[Tournament] init error:", err.message)
      );
    }

    // Init global draft ticker (all leagues + tournaments)
    if (typeof DraftTicker !== "undefined") {
      DraftTicker.init(profile.username);
    }

    // Init notification tracker
    _startNotifMonitor(profile);

    // Init notification tracker
    if (typeof NotifTracker !== "undefined") {
      NotifTracker.init(profile.username);
    }

    // Restore last active view after refresh
    const savedView = sessionStorage.getItem("dlr_active_view");
    if (savedView && savedView !== "locker") {
      setTimeout(() => {
        const link = document.querySelector(`.nav-link[data-view="${savedView}"]`);
        if (link) link.click();
      }, 50);
    }

    // Tell YahooAPI which user this is so Firebase token reads/writes work
    YahooAPI.setUsername(profile.username);

    // ── Yahoo token sync ──────────────────────────────────────
    // Always keep Firebase and localStorage in sync.
    // IMPORTANT: do NOT gate on profile.platforms.yahoo.linked — on a first-time
    // OAuth connect, linked is still false here because linkYahoo runs 500ms later.
    // Gating would silently skip the save for every new connection.
    const cachedToken = localStorage.getItem("dlr_yahoo_access_token");
    if (cachedToken) {
      // localStorage has a token — persist to Firebase regardless of linked status
      const refresh   = localStorage.getItem("dlr_yahoo_refresh_token");
      const expiresAt = Number(localStorage.getItem("dlr_yahoo_expires_at") || 0);
      GMDB.saveYahooTokens(profile.username, {
        accessToken:  cachedToken,
        refreshToken: refresh || null,
        expiresAt
      }).catch(() => {});
    } else if (profile.platforms?.yahoo?.linked) {
      // No localStorage token but Yahoo is linked — try restoring from Firebase
      YahooAPI.loadTokensFromFirebase(profile.username).catch(() => {});
    }

    // Show resync nudge if MFL is connected but no email stored (legacy username-only import)
    const mfl = profile?.platforms?.mfl;
    const needsResync = mfl?.linked && !mfl?.mflEmail;
    const banner = document.getElementById("mfl-resync-banner");
    if (banner) banner.classList.toggle("hidden", !needsResync);

    // If returning from Yahoo OAuth, auto-trigger the import.
    // Uses localStorage (not sessionStorage) — sessionStorage is wiped on mobile redirect.
    if (localStorage.getItem("dlr_yahoo_pending") === "1") {
      localStorage.removeItem("dlr_yahoo_pending");
      localStorage.removeItem("dlr_yahoo_linking_user");
      sessionStorage.removeItem("dlr_yahoo_pending");
      sessionStorage.removeItem("dlr_yahoo_linking_user");
      setTimeout(async () => {
        try {
          setLoading(true, "Importing Yahoo leagues…");
          const result = await Profile.linkYahoo(profile.username);
          const count  = Object.keys(result.leagues || {}).length;
          setLoading(false);
          if (count > 0) {
            const refreshed = await Auth.refreshProfile();
            Profile.renderLocker(refreshed || profile);
            const statusEl = document.getElementById("yahoo-status");
            if (statusEl) statusEl.textContent = `✓ ${count} league${count !== 1 ? "s" : ""} connected`;
          }
        } catch(err) {
          setLoading(false);
          const statusEl = document.getElementById("yahoo-status");
          if (statusEl) statusEl.textContent = "Import failed: " + err.message;
        }
      }, 500);
    }
  }
};

// ── Loading overlay ────────────────────────────────────────
function setLoading(visible, message = "Loading...") {
  const overlay = document.getElementById("loading-overlay");
  const msg     = document.getElementById("loading-message");
  if (overlay) overlay.classList.toggle("hidden", !visible);
  if (msg) msg.textContent = message;
}

// ── Auth screen tabs ───────────────────────────────────────
document.querySelectorAll(".auth-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    document.querySelectorAll(".auth-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById(`${target}-form`)?.classList.add("active");
  });
});

// ── Login ──────────────────────────────────────────────────
document.getElementById("login-btn")?.addEventListener("click", async () => {
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl  = document.getElementById("login-error");
  errorEl.classList.add("hidden");

  if (!username || !password) {
    showError(errorEl, "Enter your username and password.");
    return;
  }

  setLoading(true, "Signing in...");
  try {
    const { profile } = await Auth.login({ username, password });
    AppState.showApp(profile);
  } catch (err) {
    setLoading(false);
    showError(errorEl, err.message);
  }
});

// ── Register ───────────────────────────────────────────────
document.getElementById("register-btn")?.addEventListener("click", async () => {
  const username  = document.getElementById("reg-username").value.trim();
  const email     = document.getElementById("reg-email").value.trim();
  const password  = document.getElementById("reg-password").value;
  const password2 = document.getElementById("reg-password2").value;
  const errorEl   = document.getElementById("register-error");
  errorEl.classList.add("hidden");

  if (!username || !email || !password) {
    showError(errorEl, "All fields are required.");
    return;
  }
  if (password !== password2) {
    showError(errorEl, "Passwords don't match.");
    return;
  }
  if (password.length < 8) {
    showError(errorEl, "Password must be at least 8 characters.");
    return;
  }

  setLoading(true, "Claiming your locker...");
  try {
    const result = await Auth.register({ username, email, password });
    console.log("[Register] result:", result);
    const profile = result?.profile || { username, email, platforms: {}, leagues: {} };
    setLoading(false);
    AppState.showWelcome(profile);
  } catch (err) {
    console.error("[Register] error:", err);
    setLoading(false);
    showError(errorEl, err.message);
  }
});

// Enter key support for auth forms
document.getElementById("login-password")?.addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("login-btn")?.click();
});
document.getElementById("reg-password2")?.addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("register-btn")?.click();
});

// ── Welcome screen buttons ─────────────────────────────────
document.getElementById("welcome-continue-btn")?.addEventListener("click", () => {
  AppState.showOnboarding();
});

document.getElementById("welcome-skip-btn")?.addEventListener("click", async () => {
  setLoading(true, "Loading your locker...");
  const profile = await Auth.refreshProfile();
  AppState.showApp(profile);
});

document.getElementById("onboarding-back-btn")?.addEventListener("click", () => {
  if (sessionStorage.getItem("dlr_manage_mode") === "1") {
    sessionStorage.removeItem("dlr_manage_mode");
    const profile = Auth.getCurrentProfile();
    if (profile) { AppState.showApp(profile); return; }
  }
  AppState.showScreen("welcome-screen");
});

// ── Onboarding: show Refresh button if already synced ─────
(function() {
  const profile = Auth.getCurrentProfile ? Auth.getCurrentProfile() : null;
  const hasSleeper = !!(profile?.platforms?.sleeper?.sleeperUserId);
  const refreshBtn = document.getElementById("sleeper-refresh-btn");
  if (refreshBtn && hasSleeper) refreshBtn.classList.remove("hidden");
  const input = document.getElementById("sleeper-username-input");
  if (input && hasSleeper && profile.platforms.sleeper.sleeperUsername) {
    input.value = profile.platforms.sleeper.sleeperUsername;
  }
})();

document.getElementById("sleeper-refresh-btn")?.addEventListener("click", async () => {
  const statusEl = document.getElementById("sleeper-status");
  const btn      = document.getElementById("sleeper-refresh-btn");
  const profile  = Auth.getCurrentProfile();
  if (!profile) return;
  btn.disabled = true;
  btn.textContent = "Refreshing...";
  statusEl.textContent = "Refreshing current season…";
  try {
    const result = await Profile.refreshSleeper(profile.username);
    const n    = Object.keys(result.leagues).length;
    const news = result.newCount > 0 ? ` (+${result.newCount} new)` : "";
    statusEl.textContent = `✓ Refreshed — ${n} leagues updated${news}`;
    statusEl.classList.add("status-connected");
    Profile.renderLeaguePreview("sleeper-leagues-preview", result.leagues);
    document.getElementById("onboarding-save-btn").disabled = false;
    btn.textContent = "🔄 Refresh Current Season";
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add("status-error");
    btn.textContent = "🔄 Refresh Current Season";
  } finally {
    btn.disabled = false;
  }
});

// ── Onboarding: Sleeper link ───────────────────────────────
document.getElementById("sleeper-link-btn")?.addEventListener("click", async () => {
  const sleeperUsername = document.getElementById("sleeper-username-input").value.trim();
  const statusEl = document.getElementById("sleeper-status");
  const btn      = document.getElementById("sleeper-link-btn");
  const profile  = Auth.getCurrentProfile();
  if (!profile) return;

  btn.disabled = true;
  btn.textContent = "Syncing...";
  statusEl.textContent = "Importing all seasons — may take 30–90s for large accounts…";

  try {
    const importPromise = Profile.linkSleeper(profile.username, sleeperUsername);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timed out — Sleeper may be slow. Try again.")), 120000)
    );
    const result = await Promise.race([importPromise, timeoutPromise]);
    statusEl.textContent = `✓ Connected — ${Object.keys(result.leagues).length} leagues`;
    // Show refresh button now that we're synced
    document.getElementById("sleeper-refresh-btn")?.classList.remove("hidden");
    statusEl.classList.add("status-connected");
    Profile.renderLeaguePreview("sleeper-leagues-preview", result.leagues);
    document.getElementById("onboarding-save-btn").disabled = false;
    btn.textContent = "Update";
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add("status-error");
    btn.textContent = "Try Again";
  } finally {
    btn.disabled = false;
  }
});

// ── Onboarding: MFL link ───────────────────────────────────
document.getElementById("mfl-link-btn")?.addEventListener("click", async () => {
  const email    = document.getElementById("mfl-email-input")?.value.trim();
  const password = document.getElementById("mfl-password-input")?.value.trim();
  const statusEl = document.getElementById("mfl-status");
  const btn      = document.getElementById("mfl-link-btn");
  const profile  = Auth.getCurrentProfile();
  if (!profile) return;

  if (!email) {
    statusEl.textContent = "Enter your MFL email address.";
    statusEl.classList.add("status-error");
    return;
  }
  if (!password) {
    statusEl.textContent = "Enter your MFL password.";
    statusEl.classList.add("status-error");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Connecting…";
  statusEl.textContent = "Searching…";
  statusEl.classList.remove("status-connected", "status-error");

  try {
    const result = await Profile.linkMFL(
      profile.username, email, password,
      (msg) => { statusEl.textContent = msg; }  // live progress updates
    );
    const count   = Object.keys(result.leagues).length;
    const nSkip   = result.skipped?.length || 0;
    const skipMsg = nSkip > 0
      ? ` (${nSkip} league${nSkip !== 1 ? "s" : ""} failed to load — reconnect to retry)`
      : "";
    statusEl.textContent = `✓ Connected — ${count} league${count !== 1 ? "s" : ""}${skipMsg}`;
    statusEl.classList.add(nSkip > 0 ? "status-error" : "status-connected");
    Profile.renderLeaguePreview("mfl-leagues-preview", result.leagues);
    document.getElementById("onboarding-save-btn").disabled = false;
    btn.textContent = "Reconnect";
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add("status-error");
    btn.textContent = "Try Again";
  } finally {
    btn.disabled = false;
  }
});

// ── Yahoo: detect OAuth callback ─────────────────────────
// Worker now redirects back with ?yahoo_token=... as query params (mobile-safe).
// Query params survive iOS Safari / Android Chrome redirect chains reliably.
// Hash-based detection kept as fallback for any cached old-style links.
// NOTE: dlr_yahoo_pending stored in localStorage (not sessionStorage) so it
// survives the full-page redirect on mobile where sessionStorage is wiped.
(function() {
  // ── Primary path: query params (mobile-safe) ────────────
  const qp = new URLSearchParams(window.location.search);
  if (qp.get("yahoo_token")) {
    const accessToken  = qp.get("yahoo_token");
    const refreshToken = qp.get("yahoo_refresh") || "";
    const expiresIn    = parseInt(qp.get("yahoo_expires") || "3600");
    if (accessToken) {
      YahooAPI.storeTokens(accessToken, refreshToken, expiresIn);
      localStorage.setItem("dlr_yahoo_pending", "1");
    }
    // Clean query params immediately so token isn't visible in URL bar
    window.history.replaceState({}, "", window.location.pathname);
  }

  // ── Fallback: hash-based (desktop / old cached redirects) ──
  const hash = window.location.hash;
  if (hash.includes("yahoo_token=")) {
    const hp = new URLSearchParams(hash.slice(1));
    const accessToken  = hp.get("yahoo_token");
    const refreshToken = hp.get("yahoo_refresh") || "";
    const expiresIn    = parseInt(hp.get("yahoo_expires") || "3600");
    if (accessToken) {
      YahooAPI.storeTokens(accessToken, refreshToken, expiresIn);
      localStorage.setItem("dlr_yahoo_pending", "1");
    }
    window.history.replaceState({}, "", window.location.pathname);
  }

  // ── Legacy stub: ?yahoo=connected (no token) ──
  const lp = new URLSearchParams(window.location.search);
  if (lp.get("yahoo") === "connected") {
    window.history.replaceState({}, "", window.location.pathname);
    localStorage.setItem("dlr_yahoo_pending", "1");
  }
})();

// ── Yahoo: connect button ─────────────────────────────────
document.getElementById("yahoo-link-btn")?.addEventListener("click", async () => {
  const btn      = document.getElementById("yahoo-link-btn");
  const statusEl = document.getElementById("yahoo-status");
  const profile  = Auth.getCurrentProfile();
  if (!profile) return;

  btn.disabled    = true;
  btn.textContent = "Redirecting to Yahoo…";
  statusEl.textContent = "Opening Yahoo login…";

  // Store current username so we can resume after OAuth redirect
  // Use localStorage — sessionStorage is wiped on mobile full-page redirect
  localStorage.setItem("dlr_yahoo_linking_user", profile.username);

  // Redirect to Yahoo OAuth — worker handles the redirect
  YahooAPI.login();
});

// ── Onboarding: save & continue ───────────────────────────
document.getElementById("onboarding-save-btn")?.addEventListener("click", async () => {
  sessionStorage.removeItem("dlr_manage_mode");
  setLoading(true, "Saving your dynasty...");
  const profile = await Auth.refreshProfile();
  AppState.showApp(profile);
});

// ── Onboarding: skip ──────────────────────────────────────
document.getElementById("onboarding-skip-btn")?.addEventListener("click", async () => {
  sessionStorage.removeItem("dlr_manage_mode");
  setLoading(true, "Loading your locker...");
  const profile = await Auth.refreshProfile();
  AppState.showApp(profile);
});

// ── Mobile nav drawer ─────────────────────────────────────
const DLRNav = {
  toggle() {
    const drawer  = document.getElementById("nav-drawer");
    const back    = document.getElementById("nav-drawer-backdrop");
    const open    = drawer.classList.contains("nav-drawer--open");
    drawer.classList.toggle("nav-drawer--open", !open);
    back.classList.toggle("hidden", open);
    document.getElementById("nav-hamburger").classList.toggle("nav-hamburger--open", !open);
  },
  close() {
    document.getElementById("nav-drawer")?.classList.remove("nav-drawer--open");
    document.getElementById("nav-drawer-backdrop")?.classList.add("hidden");
    document.getElementById("nav-hamburger")?.classList.remove("nav-hamburger--open");
  },
  go(view) {
    this.close();
    // Trigger the same nav-link handler by finding the link
    const link = document.querySelector(`.nav-link[data-view="${view}"]`);
    if (link) { link.click(); return; }
    // Fallback if link not visible (mobile)
    document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
    document.querySelectorAll(".app-view").forEach(v => v.classList.remove("active"));
    document.querySelectorAll(`[data-view="${view}"]`).forEach(l => l.classList.add("active"));
    document.getElementById(`view-${view}`)?.classList.add("active");
    AppState.currentView = view;
    sessionStorage.setItem("dlr_active_view", view);
    if (view === "hallway")  DLRHallway.init();
    if (view === "trophies") DLRTrophyRoom.init();
    if (view === "tournament" && typeof DLRTournament !== "undefined") {
      const profile = Auth.getCurrentProfile();
      if (profile) DLRTournament.init(profile.username).catch(() => {});
    }
  }
};

// Wire drawer quick action buttons
document.getElementById("drawer-career-btn")?.addEventListener("click", e => {
  e.preventDefault(); DLRNav.close(); Profile.openCareerSummary();
});
document.getElementById("drawer-players-btn")?.addEventListener("click", e => {
  e.preventDefault(); DLRNav.close();
  const profile = Auth.getCurrentProfile();
  if (profile) DLRPlayerReport.open(profile.leagues||{}, profile.platforms?.sleeper?.userId);
});
document.getElementById("drawer-edit-btn")?.addEventListener("click", e => {
  e.preventDefault(); DLRNav.close();
  const profile = Auth.getCurrentProfile();
  if (profile) Profile.openEditProfileModal(profile);
});
document.getElementById("drawer-leagues-btn")?.addEventListener("click", e => {
  e.preventDefault();
  DLRNav.close();
  sessionStorage.setItem("dlr_manage_mode", "1");
  AppState.showOnboarding();
});
document.getElementById("drawer-logout-btn")?.addEventListener("click", async e => {
  e.preventDefault();
  DLRNav.close();
  if (typeof DraftTicker !== "undefined") DraftTicker.stop();
  _stopNotifMonitor();
  await Auth.logout();
  AppState.showScreen("auth-screen");
});


document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", e => {
    e.preventDefault();
    const view = link.dataset.view;
    document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
    document.querySelectorAll(".app-view").forEach(v => v.classList.remove("active"));
    link.classList.add("active");
    document.getElementById(`view-${view}`)?.classList.add("active");
    AppState.currentView = view;
    sessionStorage.setItem("dlr_active_view", view);
    if (view === "hallway") DLRHallway.init();
    if (view === "trophies") DLRTrophyRoom.init();
    if (view === "tournament" && typeof DLRTournament !== "undefined") {
      const profile = Auth.getCurrentProfile();
      if (profile) DLRTournament.init(profile.username).catch(() => {});
    }
  });
});

// ── Career summary modal ───────────────────────────────────
document.getElementById("career-summary-btn")?.addEventListener("click", () => {
  Profile.openCareerSummary();
});

// ── Player report button ───────────────────────────────────
document.getElementById("player-report-btn")?.addEventListener("click", () => {
  const profile = Auth.getCurrentProfile();
  if (!profile) return;
  const sleeperUserId = profile.platforms?.sleeper?.userId || null;
  DLRPlayerReport.open(profile.leagues || {}, sleeperUserId);
});

// ── Edit profile modal ─────────────────────────────────────
document.getElementById("edit-profile-btn")?.addEventListener("click", () => {
  const profile = Auth.getCurrentProfile();
  if (profile) Profile.openEditProfileModal(profile);
});
document.getElementById("edit-profile-close")?.addEventListener("click", () => {
  Profile.closeEditProfileModal();
});
document.getElementById("edit-profile-cancel")?.addEventListener("click", () => {
  Profile.closeEditProfileModal();
});
document.getElementById("edit-profile-save")?.addEventListener("click", async () => {
  const profile = Auth.getCurrentProfile();
  if (!profile) return;
  try {
    await Profile.saveProfileEdits(profile.username);
    await Auth.refreshProfile();
    showToast("Profile saved ✓");
  } catch (err) {
    showToast("Failed to save profile", "error");
  }
});

// ── Sleeper: Refresh current season (fast) ────────────────
async function _sleeperRefresh(afterFn) {
  const profile = Auth.getCurrentProfile();
  if (!profile) return;
  try {
    setLoading(true, "Refreshing current season leagues…");
    const result = await Profile.refreshSleeper(profile.username);
    setLoading(false);
    const n    = Object.keys(result.leagues).length;
    const news = result.newCount > 0 ? ` (+${result.newCount} new)` : "";
    showToast(`Sleeper refreshed — ${n} league${n !== 1 ? "s" : ""} updated${news}`);
    const updated = await Auth.refreshProfile();
    Profile.renderLocker(updated);
    afterFn?.(updated);
  } catch (err) {
    setLoading(false);
    showToast(err.message, "error");
  }
}

// ── Sleeper: Full sync (all years, slow) ──────────────────
async function _sleeperFullSync(afterFn) {
  const profile = Auth.getCurrentProfile();
  if (!profile) return;
  const sleeper  = profile.platforms?.sleeper;
  const username = sleeper?.sleeperUsername
    || prompt("Enter your Sleeper username:");
  if (!username?.trim()) return;
  try {
    setLoading(true, "Full Sleeper sync — importing all seasons (30–90s)…");
    const importPromise  = Profile.linkSleeper(profile.username, username.trim());
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out. Sleeper may be slow — please try again.")), 120000)
    );
    const result = await Promise.race([importPromise, timeoutPromise]);
    setLoading(false);
    showToast(`Full sync complete — ${Object.keys(result.leagues).length} leagues imported`);
    const updated = await Auth.refreshProfile();
    Profile.renderLocker(updated);
    afterFn?.(updated);
  } catch (err) {
    setLoading(false);
    showToast(err.message, "error");
  }
}

// Relink platform buttons inside edit profile modal
document.getElementById("relink-sleeper-btn")?.addEventListener("click", () =>
  _sleeperRefresh(u => Profile.openEditProfileModal(u))
);
document.getElementById("fullsync-sleeper-btn")?.addEventListener("click", () =>
  _sleeperFullSync(u => Profile.openEditProfileModal(u))
);
document.getElementById("relink-yahoo-btn")?.addEventListener("click", async () => {
  const profile = Auth.getCurrentProfile();
  if (!profile) return;
  // Use localStorage — sessionStorage is wiped on mobile full-page redirect
  localStorage.setItem("dlr_yahoo_linking_user", profile.username);
  localStorage.setItem("dlr_yahoo_pending", "1");
  Profile.closeEditProfileModal();
  YahooAPI.login();
});
// ── Shared MFL resync handler ──────────────────────────────
async function _doMFLResync() {
  const profile       = Auth.getCurrentProfile();
  const alreadyLinked = profile?.platforms?.mfl?.linked;
  const storedEmail   = profile?.platforms?.mfl?.mflEmail || "";

  const email = prompt(
    alreadyLinked
      ? `Resync MFL Leagues\n\nEnter your MFL email address.\nYour password is only used to fetch your leagues — it is never stored.`
      : `Connect MFL\n\nEnter your MFL email address.`,
    storedEmail
  );
  if (!email) return;
  const password = prompt("Enter your MFL password:\n(Never stored — used only to fetch your leagues)");
  if (!password) return;

  try {
    setLoading(true, alreadyLinked ? "Resyncing MFL leagues…" : "Connecting MFL…");
    const result = await Profile.linkMFL(
      profile.username, email, password,
      (msg) => { setLoading(true, msg); }  // live progress updates
    );
    setLoading(false);
    const count  = Object.keys(result.leagues).length;
    const nSkip  = result.skipped?.length || 0;
    const skipMsg = nSkip > 0
      ? ` · ${nSkip} league${nSkip !== 1 ? "s" : ""} failed to load (reconnect to retry)`
      : "";
    showToast(
      `MFL ${alreadyLinked ? "resynced" : "connected"} — ${count} league${count !== 1 ? "s" : ""}${skipMsg}`,
      nSkip > 0 ? "error" : "success"
    );
    const updated = await Auth.refreshProfile();
    Profile.renderLocker(updated);
    const banner = document.getElementById("mfl-resync-banner");
    if (banner) banner.classList.add("hidden");
    Profile.openEditProfileModal(updated);
  } catch (err) {
    setLoading(false);
    showToast(err.message, "error");
  }
}

document.getElementById("relink-mfl-btn")?.addEventListener("click", _doMFLResync);
document.getElementById("mfl-resync-banner-btn")?.addEventListener("click", _doMFLResync);


// ── Sync MFL team identities (no password needed) ────────
document.getElementById("sync-mfl-teams-btn")?.addEventListener("click", async () => {
  const btn = document.getElementById("sync-mfl-teams-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
  try {
    const count = await Profile.syncMFLTeams();
    showToast(`Teams synced — ${count} league${count !== 1 ? "s" : ""} matched ✓`);
  } catch(err) {
    showToast("Sync failed: " + err.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "🔄 Sync Teams"; }
  }
});

document.getElementById("sync-mfl-teams-onboarding-btn")?.addEventListener("click", async () => {
  const btn = document.getElementById("sync-mfl-teams-onboarding-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
  try {
    const count = await Profile.syncMFLTeams();
    showToast(`Teams refreshed — ${count} league${count !== 1 ? "s" : ""} updated`);
  } catch(err) {
    showToast("Sync failed: " + err.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Sync Teams"; }
  }
});

// ── Manage leagues (go to onboarding to re-import) ────────
document.getElementById("manage-leagues-btn")?.addEventListener("click", () => {
  sessionStorage.setItem("dlr_manage_mode", "1");
  _prefillOnboardingMFL();
  AppState.showOnboarding();
});

// Sleeper refresh/sync buttons in the manage-leagues onboarding header
document.getElementById("sleeper-refresh-btn")?.addEventListener("click", () =>
  _sleeperRefresh()
);
document.getElementById("sleeper-fullsync-btn")?.addEventListener("click", () =>
  _sleeperFullSync()
);

// ── Add league button ──────────────────────────────────────
document.getElementById("add-league-btn")?.addEventListener("click", () => {
  sessionStorage.setItem("dlr_manage_mode", "1");
  _prefillOnboardingMFL();
  AppState.showOnboarding();
});

// Pre-fill MFL email on the onboarding screen and show a resync notice
// if the user has an old username-only connection
function _prefillOnboardingMFL() {
  const profile = Auth.getCurrentProfile();
  if (!profile) return;
  const mfl = profile.platforms?.mfl;
  if (!mfl) return;

  const emailInput = document.getElementById("mfl-email-input");
  const statusEl   = document.getElementById("mfl-connection-status");

  if (emailInput && !emailInput.value) {
    emailInput.value = mfl.mflEmail || "";
  }
  if (mfl.mflEmail && statusEl) {
    statusEl.textContent = `✓ Connected as ${mfl.mflEmail}`;
  }
}

// ── League groups button ───────────────────────────────────
document.getElementById("league-groups-btn")?.addEventListener("click", () => {
  const profile = Auth.getCurrentProfile();
  if (!profile?.leagues) return;
  const entries = Object.entries(profile.leagues).map(([key, league]) => ({ key, league }));
  LeagueGroups.showGroupManager(entries);
});

// ── League detail panel close ──────────────────────────────
document.getElementById("league-detail-close")?.addEventListener("click", () => {
  Profile.closeLeagueDetail();
});
document.getElementById("league-detail-backdrop")?.addEventListener("click", () => {
  Profile.closeLeagueDetail();
});

// ── Chat panel close ───────────────────────────────────────
document.getElementById("chat-panel-close")?.addEventListener("click", () => {
  Profile.closeLeagueChat();
});
document.getElementById("chat-panel-backdrop")?.addEventListener("click", () => {
  Profile.closeLeagueChat();
});

document.getElementById("nav-search-btn")?.addEventListener("click", () => {
  DLRManagerSearch.open();
});

// ── League label modal close ───────────────────────────────
document.getElementById("label-modal-close")?.addEventListener("click", () => {
  Profile.closeLabelModal();
});
document.getElementById("label-modal-cancel")?.addEventListener("click", () => {
  Profile.closeLabelModal();
});

// Close modals on overlay click
document.getElementById("edit-profile-modal")?.addEventListener("click", e => {
  if (e.target === e.currentTarget) Profile.closeEditProfileModal();
});
document.getElementById("league-label-modal")?.addEventListener("click", e => {
  if (e.target === e.currentTarget) Profile.closeLabelModal();
});

// ── Logout ─────────────────────────────────────────────────
document.getElementById("nav-logout-btn")?.addEventListener("click", async () => {
  if (typeof DraftTicker !== "undefined") DraftTicker.stop();
  _stopNotifMonitor();
  await Auth.logout();
  AppState.showScreen("auth-screen");
});

// ── Auth state observer — fires on page load ───────────────
Auth.onAuthStateChanged(async (user, profile) => {
  if (!user) {
    setLoading(false);
    AppState.showScreen("auth-screen");
    return;
  }

  if (!profile) {
    setLoading(false);
    AppState.showScreen("auth-screen");
    return;
  }

  const hasLeagues    = profile.leagues   && Object.keys(profile.leagues).length   > 0;
  const hasPlatforms  = profile.platforms && Object.keys(profile.platforms).length > 0;
  const isFirstLogin  = !hasPlatforms && !hasLeagues;

  if (isFirstLogin) {
    // Brand new account — show onboarding (not welcome, which can show stale state)
    setLoading(false);
    sessionStorage.removeItem("dlr_manage_mode");
    AppState.showScreen("onboarding-screen");
  } else {
    AppState.showApp(profile);
    _startGlobalAucMonitor(profile);
    _startGlobalChatMonitor(profile);
  }
});

// ── Global active auctions monitor ────────────────────────
let _globalAucListeners = [];
let _globalAucData      = {};   // stored in closure, not on DOM element

// Compute correct display bid — mirrors DLRAuction proxy logic.
// Single bidder = MIN_BID. Multi-bidder = second-highest + increment.
// Never exposes proxy bid amounts.
function _computeDisplayBid(a) {
  // Trust the stored displayBid — it is set correctly by placeBid's transaction.
  if (a.displayBid != null) return Number(a.displayBid);
  return 100_000; // MIN_BID fallback
}

function _startGlobalAucMonitor(profile) {
  // Clean up old listeners
  _globalAucListeners.forEach(fn => fn());
  _globalAucListeners = [];

  const leagues = profile.leagues || {};
  const now = Date.now();

  // Only watch Sleeper leagues with auction enabled
  const auctionLeagues = Object.entries(leagues).filter(([, l]) => l.platform === "sleeper");

  // Collect active auctions across all leagues
  auctionLeagues.forEach(([leagueKey, league]) => {
    const ref = GMD.child(`auctions/${leagueKey}/bids`);
    const handler = ref.on("value", snap => {
      const data = snap.val() || {};
      const live = Object.values(data).filter(a =>
        !a.cancelled && !a.processed && a.expiresAt > Date.now()
      );
      if (live.length) {
        _globalAucData[leagueKey] = { league, live };
      } else {
        delete _globalAucData[leagueKey];
      }
      _updateGlobalAucPill(_globalAucData);
    });
    _globalAucListeners.push(() => ref.off("value", handler));
  });
}

// ── Global chat notification monitor ──────────────────────
let _globalChatListeners = [];
let _chatUnreadCounts    = {};  // leagueKey → unread count

function _chatLastSeenKey(leagueKey) {
  return `dlr_chat_seen_${leagueKey}`;
}
function _getChatLastSeen(leagueKey) {
  return Number(localStorage.getItem(_chatLastSeenKey(leagueKey)) || 0);
}
function markChatSeen(leagueKey) {
  localStorage.setItem(_chatLastSeenKey(leagueKey), Date.now());
  delete _chatUnreadCounts[leagueKey];
  _updateChatBadges();
}

function _startGlobalChatMonitor(profile) {
  // Clean up old listeners
  _globalChatListeners.forEach(fn => fn());
  _globalChatListeners = [];
  _chatUnreadCounts    = {};

  const leagues   = profile.leagues || {};
  const startedAt = Date.now(); // only notify messages sent AFTER app loaded

  Object.entries(leagues).forEach(([leagueKey, league]) => {
    if (league.archived) return;

    const ref = GMD.child(`leagueChats/${leagueKey}`)
      .orderByChild("ts")
      .startAfter(startedAt);

    const handler = ref.on("child_added", snap => {
      const msg = snap.val() || {};

      // Skip anything older than session start
      if ((msg.ts || 0) <= startedAt) return;

      const me = (Auth.getCurrentProfile()?.username || "").toLowerCase();
      if ((msg.user || "").toLowerCase() === me) return;

      // Check if this league's chat tab is currently open
      const detailPanel  = document.getElementById("league-detail-panel");
      const detailOpen   = detailPanel && !detailPanel.classList.contains("hidden");
      const chatTabOpen  = document.getElementById("detail-tab-select")?.value === "chat";
      const thisLeague   = window._detailLeagueKey === leagueKey;

      if (detailOpen && chatTabOpen && thisLeague) {
        markChatSeen(leagueKey);
        return;
      }

      _chatUnreadCounts[leagueKey] = (_chatUnreadCounts[leagueKey] || 0) + 1;
      _updateChatBadges();

      const lName  = league.leagueName || leagueKey;
      const sender = msg.user || "Someone";
      const preview = msg.type === "gif"  ? "sent a GIF" :
                      msg.type === "poll" ? `created a poll: ${msg.question || ""}` :
                      `"${(msg.text || "").slice(0, 40)}${(msg.text || "").length > 40 ? "…" : ""}"`;
      showToast(`💬 ${lName} · ${sender}: ${preview}`, "info", 5000);
    }, err => {
      console.warn(`[Chat monitor] Could not watch ${leagueKey}:`, err.message);
    });

    _globalChatListeners.push(() => ref.off("child_added", handler));
  });
}

function _updateChatBadges() {
  const total = Object.values(_chatUnreadCounts).reduce((s, n) => s + n, 0);
  _updateNotifPill(); // keep notification pill in sync with chat counts

  // Update badge on each league card that has unread messages
  document.querySelectorAll(".league-card[data-key]").forEach(card => {
    const key = card.dataset.key;
    const count = _chatUnreadCounts[key] || 0;
    let badge = card.querySelector(".chat-unread-badge");
    if (count > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "chat-unread-badge";
        badge.style.cssText = "position:absolute;top:6px;right:6px;background:var(--color-red,#ef4444);color:#fff;border-radius:999px;font-size:.65rem;font-weight:700;padding:1px 5px;min-width:16px;text-align:center;pointer-events:none;";
        card.style.position = "relative";
        card.appendChild(badge);
      }
      badge.textContent = count > 9 ? "9+" : count;
    } else if (badge) {
      badge.remove();
    }
  });

  // Update Chat option in the detail tab dropdown if it's visible
  const sel = document.getElementById("detail-tab-select");
  if (sel) {
    const leagueKey = window._detailLeagueKey;
    const unread = leagueKey ? (_chatUnreadCounts[leagueKey] || 0) : 0;
    [...sel.options].forEach(o => {
      if (o.value === "chat") {
        o.text = unread > 0 ? `Chat 🔴` : "Chat";
      }
    });
  }
}

function _updateGlobalAucPill(liveByLeague) {
  const totalLive = Object.values(liveByLeague).reduce((s, v) => s + v.live.length, 0);

  // ── Desktop nav pill ──────────────────────────────────
  const aucWrap = document.getElementById("nav-auc-wrap");
  const aucLbl  = document.getElementById("nav-auc-label");
  if (aucWrap) aucWrap.style.display = totalLive > 0 ? "flex" : "none";
  if (aucLbl)  aucLbl.textContent = `${totalLive} Auction${totalLive !== 1 ? "s" : ""}`;

  // ── Mobile drawer badge ───────────────────────────────
  const drawerSec   = document.getElementById("drawer-auc-section");
  const drawerBadge = document.getElementById("drawer-auc-badge");
  if (drawerSec) drawerSec.style.display = totalLive > 0 ? "" : "none";
  if (drawerBadge) drawerBadge.textContent = totalLive > 0 ? String(totalLive) : "";
  _syncDrawerActivity();
}

// ── Show/hide the Activity drawer section ──────────────────
function _syncDrawerActivity() {
  const aucVisible   = document.getElementById("drawer-auc-section")?.style.display   !== "none";
  const draftVisible = document.getElementById("drawer-draft-section")?.style.display !== "none";
  const notifVisible = document.getElementById("drawer-notif-section")?.style.display !== "none";
  const activity     = document.getElementById("drawer-activity-section");
  if (activity) activity.style.display = (aucVisible || draftVisible || notifVisible) ? "" : "none";
}

// ── Notification tracker ────────────────────────────────────
// Watches: league chat unread counts, tournament board messages,
//          sticky notes on the user's locker.
let _notifListeners       = [];
let _trnBoardUnread       = {}; // tid_year → unread count
let _stickyNoteUnread     = 0;

function _stopNotifMonitor() {
  _notifListeners.forEach(fn => fn());
  _notifListeners = [];
  _trnBoardUnread = {};
  _stickyNoteUnread = 0;
}

function _startNotifMonitor(profile) {
  _stopNotifMonitor();
  const username  = profile.username;
  const startedAt = Date.now();

  // ── 1. Sticky notes on user's own locker ──────────────
  const stickyRef = GMD.child(`social/${username}/stickyNotes`).orderByChild("createdAt").startAfter(startedAt);
  const stickyHandler = stickyRef.on("child_added", snap => {
    const note = snap.val() || {};
    if (note.isRemoved) return;
    if ((note.createdAt || 0) <= startedAt) return;
    _stickyNoteUnread++;
    _updateNotifPill();
    showToast(`📌 ${note.authorUsername || "Someone"} left you a sticky note!`, "info", 5000);
  });
  _notifListeners.push(() => stickyRef.off("child_added", stickyHandler));

  // ── 2. Tournament message boards ───────────────────────
  // Watch boards for tournaments where user is a participant or admin
  GMD.child("tournaments").once("value").then(snap => {
    const all = snap.val() || {};
    for (const [tid, t] of Object.entries(all)) {
      if (!t?.meta) continue;
      const isAdmin       = t.roles?.[username]?.role === "admin" || t.roles?.[username]?.role === "sub_admin";
      const isDiscovered  = t.meta?.discoveredBy?.[username];
      const isParticipant = Object.values(t.participants || {}).some(p => p.dlrLinked && p.dlrUsername === username);
      if (!isAdmin && !isDiscovered && !isParticipant) continue;

      const year    = Object.keys(t.playoffs || {}).map(Number).filter(Boolean).sort((a,b) => b-a)[0]
                      || new Date().getFullYear();
      const chatKey = `${tid}_${year}`;
      const ref     = GMD.child(`tournamentChats/${chatKey}`).orderByChild("ts").startAfter(startedAt);

      const handler = ref.on("child_added", snap => {
        const msg = snap.val() || {};
        if ((msg.ts || 0) <= startedAt) return;
        if ((msg.user || "").toLowerCase() === username.toLowerCase()) return;
        _trnBoardUnread[chatKey] = (_trnBoardUnread[chatKey] || 0) + 1;
        _updateNotifPill();
        const tName = t.meta?.name || "Tournament";
        const sender = msg.user || "Someone";
        showToast(`💬 ${tName} board · ${sender}: ${(msg.text||"").slice(0,40)}`, "info", 5000);
      });
      _notifListeners.push(() => ref.off("child_added", handler));
    }
  }).catch(() => {});
}

function _updateNotifPill() {
  const chatTotal  = Object.values(_chatUnreadCounts).reduce((s, n) => s + n, 0);
  const boardTotal = Object.values(_trnBoardUnread).reduce((s, n) => s + n, 0);
  const total      = chatTotal + boardTotal + _stickyNoteUnread;

  // ── Desktop nav pill ──────────────────────────────────
  const wrap = document.getElementById("nav-notif-wrap");
  const lbl  = document.getElementById("nav-notif-label");
  const btn  = document.getElementById("nav-notif-btn");
  if (wrap) wrap.style.display = total > 0 ? "flex" : "none";
  if (lbl)  lbl.textContent = `${total} New`;
  if (btn) {
    btn.querySelector(".nav-pill-badge")?.remove();
    if (total > 0) {
      const b = document.createElement("span");
      b.className = "nav-pill-badge";
      b.textContent = total > 99 ? "99+" : String(total);
      btn.appendChild(b);
    }
  }

  // ── Mobile drawer badge ───────────────────────────────
  const drawerSec   = document.getElementById("drawer-notif-section");
  const drawerBadge = document.getElementById("drawer-notif-badge");
  if (drawerSec) drawerSec.style.display = total > 0 ? "" : "none";
  if (drawerBadge) drawerBadge.textContent = total > 0 ? String(total) : "";
  _syncDrawerActivity();
}

function _openGlobalAucModal() {
  const modal = document.getElementById("global-auc-modal");
  const body  = document.getElementById("global-auc-modal-body");
  if (!modal || !body) return;

  const liveByLeague = _globalAucData;

  body.innerHTML = Object.entries(liveByLeague).map(([leagueKey, { league, live }]) => {
    const leagueClick = `Profile.openLeagueDetail('${leagueKey}');setTimeout(()=>{const s=document.getElementById('detail-tab-select');if(s){s.value='auction';Profile.onDetailTabChange('auction');}},350);document.getElementById('global-auc-modal').classList.add('hidden')`;
    return `
    <div class="global-auc-league-block">
      <div class="global-auc-league-name" onclick="${leagueClick}" style="cursor:pointer">
        ${_escHtml(league.leagueName || leagueKey)}
        <span style="font-size:.72rem;color:var(--color-text-dim);margin-left:var(--space-2)">${live.length} active →</span>
      </div>
      ${[...live].sort((a, b) => a.expiresAt - b.expiresAt).map(a => {
        const timeLeft   = Math.max(0, a.expiresAt - Date.now());
        const mins       = Math.floor(timeLeft / 60000);
        const hrs        = Math.floor(mins / 60);
        const timeStr    = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m`;
        const bidCount   = a.proxies ? Object.keys(a.proxies).length : (a.bidCount || 1);
        const displayBid = _computeDisplayBid(a);
        return `
          <div class="global-auc-row" onclick="${leagueClick}">
            <div style="flex:1">
              <div style="font-weight:600;font-size:.85rem">${_escHtml(a.playerName||a.playerId)}</div>
              <div class="dim" style="font-size:.72rem">${bidCount} bid${bidCount!==1?"s":""} · ${timeStr} left</div>
            </div>
            <div style="font-family:var(--font-display);font-weight:700;color:var(--color-green)">$${(displayBid/1_000_000).toFixed(1)}M</div>
          </div>`;
      }).join("")}
    </div>`;
  }).join("") || `<div class="dim">No active auctions right now.</div>`;

  modal.classList.remove("hidden");
}

function _escHtml(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// ── Notification panel toggle ──────────────────────────────
(function() {
  let _notifOpen = false;
  const panel = () => document.getElementById("nav-notif-panel");
  const open  = () => { const p = panel(); if (p) p.style.display = ""; _notifOpen = true; };
  const close = () => { const p = panel(); if (p) p.style.display = "none"; _notifOpen = false; };

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("nav-notif-btn")?.addEventListener("click", e => {
      e.stopPropagation();
      _notifOpen ? close() : open();
    });
    document.getElementById("nav-notif-close")?.addEventListener("click", e => {
      e.stopPropagation(); close();
    });
    document.addEventListener("click", e => {
      if (_notifOpen && !e.target.closest("#nav-notif-wrap")) close();
    });

    // Mobile drawer: draft row — open first live draft's league detail, or go to tournaments
    document.getElementById("drawer-draft-btn")?.addEventListener("click", () => {
      DLRNav.close();
      const items = typeof DraftTicker !== "undefined" ? DraftTicker.getLastItems?.() : null;
      const first = items?.live?.[0] || items?.upcoming?.[0];
      if (first?.tid) {
        // Tournament draft — go to tournaments view and open it
        DLRNav.go("tournament");
        setTimeout(() => {
          if (typeof _openTournamentView === "function") _openTournamentView(first.tid);
        }, 150);
      } else if (first?.leagueId) {
        // Regular league draft — open league detail on draft tab
        const profile = typeof Auth !== "undefined" ? Auth.getCurrentProfile() : null;
        const match = Object.entries(profile?.leagues || {})
          .find(([, l]) => String(l.leagueId || l.league_id || "") === first.leagueId);
        if (match && typeof Profile !== "undefined") {
          Profile.openLeagueDetail(match[0]);
          setTimeout(() => {
            const sel = document.getElementById("detail-tab-select");
            if (sel) { sel.value = "draft"; Profile.onDetailTabChange("draft"); }
          }, 350);
        }
      }
    });

    // Mobile drawer: notif row — navigate based on what's unread
    document.getElementById("drawer-notif-btn")?.addEventListener("click", () => {
      DLRNav.close();
      // If there are tournament board unreads, go to tournaments; else stay on locker for chat
      const boardTotal = Object.values(_trnBoardUnread || {}).reduce((s, n) => s + n, 0);
      if (boardTotal > 0) DLRNav.go("tournament");
    });
  });
})();

// ── Utility ────────────────────────────────────────────────
function showError(el, message) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hidden");
}

function showToast(message, type = "success", duration = 3500) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = "toast-out 0.3s ease forwards";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Init ───────────────────────────────────────────────────
// If arriving from public tournaments page with ?register=1, pre-select register tab
(function() {
  const qp = new URLSearchParams(window.location.search);
  if (qp.get("register") === "1") {
    // Clean the URL
    window.history.replaceState({}, "", window.location.pathname);
    // When auth screen shows, activate the register tab
    const registerTab = document.querySelector('.auth-tab[data-tab="register"]');
    if (registerTab) registerTab.click();
  }
})();

// Show loading overlay while Firebase auth initializes
setLoading(true, "Loading GM Dynasty...");
