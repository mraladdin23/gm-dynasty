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

  showOnboarding() {
    AppState.showScreen("onboarding-screen");
  },

  showApp(profile) {
    AppState.currentProfile = profile;
    Profile.renderLocker(profile);
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

  setLoading(true, "Creating your dynasty...");
  try {
    await Auth.register({ username, email, password });
    // After registration, go to onboarding to link platforms
    setLoading(false);
    AppState.showScreen("onboarding-screen");
  } catch (err) {
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
  const mflUsername = document.getElementById("mfl-username-input").value.trim();
  const statusEl = document.getElementById("mfl-status");
  const btn      = document.getElementById("mfl-link-btn");
  const profile  = Auth.getCurrentProfile();
  if (!profile) return;

  btn.disabled = true;
  btn.textContent = "Searching...";
  statusEl.textContent = "Looking up leagues...";

  try {
    const result = await Profile.linkMFL(profile.username, mflUsername);
    statusEl.textContent = `✓ Connected — ${Object.keys(result.leagues).length} leagues`;
    statusEl.classList.add("status-connected");
    Profile.renderLeaguePreview("mfl-leagues-preview", result.leagues);
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

// ── Init ───────────────────────────────────────────────────
// Show loading overlay while Firebase auth initializes
setLoading(true, "Loading GM Dynasty...");
