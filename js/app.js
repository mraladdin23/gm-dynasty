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
  AppState.showScreen("welcome-screen");
});

// ── Onboarding: Sleeper link ───────────────────────────────
document.getElementById("sleeper-link-btn")?.addEventListener("click", async () => {
  const sleeperUsername = document.getElementById("sleeper-username-input").value.trim();
  const statusEl = document.getElementById("sleeper-status");
  const btn      = document.getElementById("sleeper-link-btn");
  const profile  = Auth.getCurrentProfile();
  if (!profile) return;

  btn.disabled = true;
  btn.textContent = "Searching...";
  statusEl.textContent = "Looking up leagues...";

  try {
    const result = await Profile.linkSleeper(profile.username, sleeperUsername);
    statusEl.textContent = `✓ Connected — ${Object.keys(result.leagues).length} leagues`;
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
  const email      = document.getElementById("mfl-email-input")?.value.trim();
  const password   = document.getElementById("mfl-password-input")?.value.trim();
  const leagueIdsRaw = document.getElementById("mfl-league-ids-input")?.value.trim();
  const leagueIds  = leagueIdsRaw
    ? leagueIdsRaw.split(/[\s,]+/).map(s => s.trim()).filter(Boolean)
    : [];
  const statusEl   = document.getElementById("mfl-status");
  const btn        = document.getElementById("mfl-link-btn");
  const profile    = Auth.getCurrentProfile();
  if (!profile) return;

  if (!email) {
    statusEl.textContent = "Enter your MFL username.";
    statusEl.classList.add("status-error");
    return;
  }

  btn.disabled = true;
  btn.textContent = "Connecting…";
  statusEl.textContent = leagueIds.length ? `Searching ${leagueIds.length} league(s)…` : "Searching…";
  statusEl.classList.remove("status-connected", "status-error");

  try {
    const result = await Profile.linkMFL(profile.username, email, password, leagueIds);
    const count  = Object.keys(result.leagues).length;
    statusEl.textContent = `✓ Connected — ${count} league${count !== 1 ? "s" : ""}`;
    statusEl.classList.add("status-connected");
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

// ── Onboarding: save & continue ───────────────────────────
document.getElementById("onboarding-save-btn")?.addEventListener("click", async () => {
  setLoading(true, "Saving your dynasty...");
  const profile = await Auth.refreshProfile();
  AppState.showApp(profile);
});

// ── Onboarding: skip ──────────────────────────────────────
document.getElementById("onboarding-skip-btn")?.addEventListener("click", async () => {
  setLoading(true, "Loading your locker...");
  const profile = await Auth.refreshProfile();
  AppState.showApp(profile);
});

// ── App nav ────────────────────────────────────────────────
document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", e => {
    e.preventDefault();
    const view = link.dataset.view;
    document.querySelectorAll(".nav-link").forEach(l => l.classList.remove("active"));
    document.querySelectorAll(".app-view").forEach(v => v.classList.remove("active"));
    link.classList.add("active");
    document.getElementById(`view-${view}`)?.classList.add("active");
    AppState.currentView = view;
  });
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

// Relink platform buttons inside edit profile modal
document.getElementById("relink-sleeper-btn")?.addEventListener("click", async () => {
  const username = prompt("Enter your Sleeper username:");
  if (!username) return;
  const profile = Auth.getCurrentProfile();
  try {
    setLoading(true, "Relinking Sleeper...");
    const result = await Profile.linkSleeper(profile.username, username);
    setLoading(false);
    showToast(`Sleeper relinked — ${Object.keys(result.leagues).length} leagues`);
    const updated = await Auth.refreshProfile();
    Profile.renderLocker(updated);
    Profile.openEditProfileModal(updated);
  } catch (err) {
    setLoading(false);
    showToast(err.message, "error");
  }
});
document.getElementById("relink-mfl-btn")?.addEventListener("click", async () => {
  const email    = prompt("Enter your MFL email address:");
  if (!email) return;
  const password = prompt("Enter your MFL password:");
  if (!password) return;
  const profile = Auth.getCurrentProfile();
  try {
    setLoading(true, "Relinking MFL...");
    const result = await Profile.linkMFL(profile.username, email, password);
    setLoading(false);
    showToast(`MFL relinked — ${Object.keys(result.leagues).length} leagues`);
    const updated = await Auth.refreshProfile();
    Profile.renderLocker(updated);
    Profile.openEditProfileModal(updated);
  } catch (err) {
    setLoading(false);
    showToast(err.message, "error");
  }
});

// ── Manage leagues (go to onboarding to re-import) ────────
document.getElementById("manage-leagues-btn")?.addEventListener("click", () => {
  AppState.showOnboarding();
});

// ── Groups manager ─────────────────────────────────────────
document.getElementById("add-league-btn")?.addEventListener("click", () => {
  AppState.showOnboarding();
});

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
    // User authenticated but no profile found
    setLoading(false);
    AppState.showScreen("auth-screen");
    return;
  }

  const hasLeagues = profile.leagues && Object.keys(profile.leagues).length > 0;
  const hasPlatforms = profile.platforms && Object.keys(profile.platforms).length > 0;

  if (!hasPlatforms && !hasLeagues) {
    // First login — go to onboarding
    setLoading(false);
    AppState.showScreen("onboarding-screen");
  } else {
    AppState.showApp(profile);
  }
});

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
// Show loading overlay while Firebase auth initializes
setLoading(true, "Loading GM Dynasty...");
