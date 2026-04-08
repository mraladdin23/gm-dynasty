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

    // If returning from Yahoo OAuth, auto-trigger the import
    if (sessionStorage.getItem("dlr_yahoo_pending") === "1") {
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

// ── Yahoo: detect OAuth callback ─────────────────────────
// Worker redirects back with #yahoo_token=... in the hash
(function() {
  const hash = window.location.hash;
  if (hash.includes("yahoo_token=")) {
    const params = new URLSearchParams(hash.slice(1)); // strip leading #
    const accessToken  = params.get("yahoo_token");
    const refreshToken = params.get("yahoo_refresh") || "";
    const expiresIn    = parseInt(params.get("yahoo_expires") || "3600");

    if (accessToken) {
      // Store token for pickup after auth loads
      // Store tokens — YahooAPI handles localStorage + auto-refresh going forward
      YahooAPI.storeTokens(accessToken, refreshToken, expiresIn);
      sessionStorage.setItem("dlr_yahoo_pending", "1");
    }

    // Clean the hash from the URL immediately so token isn't visible
    window.history.replaceState({}, "", window.location.pathname);
  }
  // Legacy query-string path
  const params = new URLSearchParams(window.location.search);
  if (params.get("yahoo") === "connected") {
    window.history.replaceState({}, "", window.location.pathname);
    sessionStorage.setItem("dlr_yahoo_pending", "1");
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
  sessionStorage.setItem("dlr_yahoo_linking_user", profile.username);

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
    if (view === "hallway")  DLRHallway.init();
    if (view === "trophies") DLRTrophyRoom.init();
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
    if (view === "hallway") DLRHallway.init();
    if (view === "trophies") DLRTrophyRoom.init();
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
document.getElementById("relink-yahoo-btn")?.addEventListener("click", async () => {
  const profile = Auth.getCurrentProfile();
  if (!profile) return;
  // Store username so we can resume after OAuth redirect
  sessionStorage.setItem("dlr_yahoo_linking_user", profile.username);
  sessionStorage.setItem("dlr_yahoo_pending", "1");
  Profile.closeEditProfileModal();
  YahooAPI.login();
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
  sessionStorage.setItem("dlr_manage_mode", "1");
  AppState.showOnboarding();
});

// ── Add league button ──────────────────────────────────────
document.getElementById("add-league-btn")?.addEventListener("click", () => {
  sessionStorage.setItem("dlr_manage_mode", "1");
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
  const MIN_BID = 100_000;
  const MIN_INC = 100_000;
  let entries = [];
  if (a.proxies && Object.keys(a.proxies).length) {
    entries = Object.entries(a.proxies)
      .map(([, v]) => Number(v))
      .sort((x, y) => y - x);
  } else {
    const bids = Array.isArray(a.bids) ? a.bids : Object.values(a.bids || {});
    const maxByRoster = {};
    bids.forEach(b => {
      if (!maxByRoster[b.rosterId] || b.maxBid > maxByRoster[b.rosterId])
        maxByRoster[b.rosterId] = b.maxBid;
    });
    entries = Object.values(maxByRoster).sort((x, y) => y - x);
  }
  if (!entries.length) return MIN_BID;
  if (entries.length === 1) return MIN_BID;
  // Display = challenger proxy + MIN_INC, capped at leader proxy
  return Math.min(entries[1] + MIN_INC, entries[0]);
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

    console.log(`[Chat] Watching ${leagueKey} from ts=${startedAt}`);

    const handler = ref.on("child_added", snap => {
      const msg = snap.val() || {};
      console.log(`[Chat] New message on ${leagueKey}:`, msg.user, msg.ts, msg.text?.slice(0,30));

      // Extra guard: skip anything older than session start
      if ((msg.ts || 0) <= startedAt) { console.log(`[Chat] Skipped old ts=${msg.ts}`); return; }

      const me = (Auth.getCurrentProfile()?.username || "").toLowerCase();
      if ((msg.user || "").toLowerCase() === me) { console.log(`[Chat] Skipped own message`); return; }

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

  const mobilePillHTML = totalLive === 0 ? "" : `
    <button class="global-auc-pill" onclick="_openGlobalAucModal()">
      🏷 ${totalLive}<span class="global-auc-pill-dot"></span>
    </button>`;

  const desktopPillHTML = totalLive === 0 ? "" : `
    <button class="global-auc-pill" onclick="_openGlobalAucModal()">
      🏷 ${totalLive} Live Auction${totalLive !== 1 ? "s" : ""}
      <span class="global-auc-pill-dot"></span>
    </button>`;

  // Mobile: inside nav-identity strip
  const mobile = document.getElementById("global-auc-pill");
  if (mobile) mobile.innerHTML = mobilePillHTML;

  // Desktop: in locker-header-actions
  const desktop = document.getElementById("global-auc-pill-desktop");
  if (desktop) desktop.innerHTML = desktopPillHTML;

  // Drawer live auctions section
  const drawerSection = document.getElementById("drawer-auc-section");
  const drawerList    = document.getElementById("drawer-auc-list");
  if (drawerSection && drawerList) {
    if (totalLive === 0) {
      drawerSection.style.display = "none";
    } else {
      drawerSection.style.display = "";
      drawerList.innerHTML = Object.entries(liveByLeague)
        .flatMap(([leagueKey, { league, live }]) => live.map(a => ({ ...a, leagueKey, league })))
        .sort((a, b) => a.expiresAt - b.expiresAt)
        .map(a => {
          const { leagueKey, league } = a;
          const displayBid = _computeDisplayBid(a);
          const bidCount   = a.proxies ? Object.keys(a.proxies).length : (a.bidCount || 1);
          const mins    = Math.max(0, Math.floor((a.expiresAt - Date.now()) / 60000));
          const timeStr = mins > 60 ? `${Math.floor(mins/60)}h` : `${mins}m`;
          return `<div class="nav-drawer-item" onclick="DLRNav.close();Profile.openLeagueDetail('${leagueKey}');setTimeout(()=>{const s=document.getElementById('detail-tab-select');if(s){s.value='auction';Profile.onDetailTabChange('auction');}},350)">
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_escHtml(a.playerName||"Player")}</div>
              <div style="font-size:.7rem;color:var(--color-text-dim)">${_escHtml(league.leagueName||leagueKey)} · ${timeStr}</div>
            </div>
            <span style="font-family:var(--font-display);font-weight:700;color:var(--color-green);font-size:.82rem;flex-shrink:0">$${(displayBid/1e6).toFixed(1)}M</span>
          </div>`;
        }).join("");
    }
  }
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
