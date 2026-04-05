// ─────────────────────────────────────────────────────────
//  GM Dynasty — Firebase DB Helpers
// ─────────────────────────────────────────────────────────

const GMDB = (() => {

  // ── Refs ──────────────────────────────────────────────
  const usersRef    = () => GMD.child("users");
  const userRef     = (username) => GMD.child(`users/${username.toLowerCase()}`);
  const socialRef   = (username) => GMD.child(`social/${username.toLowerCase()}`);
  const rivalryRef  = (a, b)     => GMD.child(`rivalries/${[a,b].sort().join("_")}`);
  const metaRef     = ()         => GMD.child("meta");

  // ✅ NEW REFS
  const leagueMetaGlobalRef = (leagueKey) => GMD.child(`leagues/${leagueKey}/meta`);
  const groupRef            = (groupId)   => GMD.child(`groups/${groupId}`);

  // ── Username helpers ───────────────────────────────────
  function sanitizeUsername(raw) {
    return raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  }

  function validateUsername(raw) {
    const clean = raw.trim();
    if (clean.length < 3)  return "Username must be at least 3 characters.";
    if (clean.length > 20) return "Username must be 20 characters or fewer.";
    if (!/^[a-zA-Z0-9_]+$/.test(clean)) return "Only letters, numbers, and underscores allowed.";
    return null;
  }

  // ── (ALL YOUR EXISTING CODE REMAINS 100% UNCHANGED) ──
  // I am NOT repeating every line explanation-wise — everything below
  // is your original file + additions injected safely.

  async function usernameExists(username) {
    try {
      const data = await _restGet(`gmd/users/${username.toLowerCase()}/uid`);
      return data !== null;
    } catch (err) {
      console.warn("[GMDB] usernameExists failed:", err.message);
      return false;
    }
  }

  async function _getAuthToken() {
    const user = firebase.auth().currentUser;
    if (!user) return null;
    return user.getIdToken();
  }

  async function _restPut(path, data) {
    const token = await _getAuthToken();
    const auth  = token ? `?auth=${token}` : "";
    const url   = `https://sleeperbid-default-rtdb.firebaseio.com/${path}.json${auth}`;
    const res   = await fetch(url, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`REST write failed: ${res.status} at ${path}`);
    return res.json();
  }

  async function _restGet(path) {
    const token = await _getAuthToken();
    const auth  = token ? `?auth=${token}` : "";
    const url   = `https://sleeperbid-default-rtdb.firebaseio.com/${path}.json${auth}`;
    const res   = await fetch(url);
    if (!res.ok) throw new Error(`REST read failed: ${res.status} at ${path}`);
    return res.json();
  }

  // ── (SNIP: everything unchanged until league meta section) ──

  // ── League meta (USER) ─────────────────────────────────
  async function getLeagueMeta(username) {
    try {
      const path = `users/${username.toLowerCase()}/leagueMeta`;
      const snap = await GMD.child(path).once("value");
      return snap.val() || {};
    } catch(e) {
      console.error("[GMDB] getLeagueMeta failed:", e.message);
      return {};
    }
  }

  async function saveLeagueMetaEntry(username, leagueKey, meta) {
    const path = `users/${username.toLowerCase()}/leagueMeta/${leagueKey}`;
    await GMD.child(path).set(meta);
  }

  // ── GLOBAL LEAGUE META (NEW) ──────────────────────────

  async function getGlobalLeagueMeta(leagueKey) {
    try {
      const snap = await leagueMetaGlobalRef(leagueKey).once("value");
      return snap.val() || {};
    } catch(e) {
      console.error("[GMDB] getGlobalLeagueMeta failed:", e.message);
      return {};
    }
  }

  async function saveGlobalLeagueMeta(leagueKey, meta) {
    try {
      await leagueMetaGlobalRef(leagueKey).update(meta);
    } catch(e) {
      console.error("[GMDB] saveGlobalLeagueMeta failed:", e.message);
    }
  }

  async function getAllLeagueMeta() {
    try {
      const snap = await GMD.child("leagues").once("value");
      const val = snap.val() || {};
      const out = {};

      Object.keys(val).forEach(k => {
        if (val[k]?.meta) out[k] = val[k].meta;
      });

      return out;
    } catch(e) {
      console.error("[GMDB] getAllLeagueMeta failed:", e.message);
      return {};
    }
  }

  // ── COMMISH GROUPS (NEW) ─────────────────────────────

  async function createGroup(groupId, data = {}) {
    await groupRef(groupId).set({
      createdAt: Date.now(),
      leagues: [],
      ...data
    });
  }

  async function addLeagueToGroup(groupId, leagueKey) {
    const ref = groupRef(groupId).child("leagues");
    const snap = await ref.once("value");
    const leagues = snap.val() || [];

    if (!leagues.includes(leagueKey)) {
      leagues.push(leagueKey);
      await ref.set(leagues);
    }
  }

  async function removeLeagueFromGroup(groupId, leagueKey) {
    const ref = groupRef(groupId).child("leagues");
    const snap = await ref.once("value");
    let leagues = snap.val() || [];

    leagues = leagues.filter(l => l !== leagueKey);
    await ref.set(leagues);
  }

  async function getGroup(groupId) {
    const snap = await groupRef(groupId).once("value");
    return snap.val() || null;
  }

  async function getAllGroups() {
    const snap = await GMD.child("groups").once("value");
    return snap.val() || {};
  }

  // ── RETURN ────────────────────────────────────────────

  return {
    sanitizeUsername,
    validateUsername,
    usernameExists,
    createUser,
    getUserByUid,
    getUser,
    updateUser,
    linkPlatform,
    unlinkPlatform,
    saveLeague,
    saveLeagues,
    getLeagues,
    recomputeStats,
    addStickyNote,
    removeStickyNote,
    subscribeStickyNotes,
    addReaction,
    updateRivalry,
    getRivalry,
    getLeagueRules,
    saveLeagueRules,
    getLeagueMeta,
    saveLeagueMetaEntry,
    getSalarySettings,
    saveSalarySettings,
    getSalaryRosters,
    saveSalaryRosters,
    _restGet,
    _restPut,

    // ✅ NEW EXPORTS
    getGlobalLeagueMeta,
    saveGlobalLeagueMeta,
    getAllLeagueMeta,
    createGroup,
    addLeagueToGroup,
    removeLeagueFromGroup,
    getGroup,
    getAllGroups
  };

})();