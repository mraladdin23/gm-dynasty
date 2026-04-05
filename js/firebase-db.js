// ─────────────────────────────────────────────────────────
//  GM Dynasty — Firebase DB Helpers
//  All reads/writes to gmd/ go through here.
//  Keeps data access centralized and easy to audit.
// ─────────────────────────────────────────────────────────

const GMDB = (() => {

  // ── Refs (lazy — called only when needed, not at load time) ──
  const usersRef    = () => GMD.child("users");
  const userRef     = (username) => GMD.child(`users/${username.toLowerCase()}`);
  const socialRef   = (username) => GMD.child(`social/${username.toLowerCase()}`);
  const rivalryRef  = (a, b)     => GMD.child(`rivalries/${[a,b].sort().join("_")}`);
  const metaRef     = ()         => GMD.child("meta");
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
    return null; // valid
  }

  // ── Users ──────────────────────────────────────────────

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

  async function createUser({ username, email, uid }) {
    const key = sanitizeUsername(username);
    const now = Date.now();
    const profile = {
      uid,
      username,
      email,
      createdAt: now,
      bio: "",
      favoriteNflTeam: "",
      avatarUrl: "",
      visibility: {
        profile:   "public",
        leagues:   "public",
        trophies:  "public",
        record:    "public",
        trades:    "private"
      },
      platforms: {},
      leagues: {},
      locker: {},
      stats: {
        totalWins:     0,
        totalLosses:   0,
        championships: 0,
        leaguesPlayed: 0,
        winPct:        0,
        dynastyScore:  0
      }
    };

    console.log("[GMDB] createUser step 1 — writing profile via REST for:", key);
    await _restPut(`gmd/users/${key}`, profile);
    console.log("[GMDB] createUser step 2 — writing uid_map via REST");
    await _restPut(`gmd/uid_map/${uid}`, key);
    console.log("[GMDB] createUser step 3 — done");
    return profile;
  }

  async function getUserByUid(uid) {
    try {
      const key = await _restGet(`gmd/uid_map/${uid}`);
      if (!key || typeof key !== "string") return null;
      return getUser(key);
    } catch (err) {
      console.warn("[GMDB] getUserByUid failed:", err.message);
      return null;
    }
  }

  async function getUser(username) {
    try {
      const data = await _restGet(`gmd/users/${username.toLowerCase()}`);
      return data || null;
    } catch (err) {
      console.warn("[GMDB] getUser failed:", err.message);
      return null;
    }
  }

  async function updateUser(username, updates) {
    await userRef(username).update(updates);
  }

  // ── Platform linking ───────────────────────────────────

  async function linkPlatform(username, platform, data) {
    // platform: "sleeper" | "mfl"
    // data: platform-specific fields
    await userRef(username).child(`platforms/${platform}`).set({
      linked: true,
      linkedAt: Date.now(),
      ...data
    });
  }

  async function unlinkPlatform(username, platform) {
    await userRef(username).child(`platforms/${platform}`).remove();
  }

  // ── Leagues ────────────────────────────────────────────

  /**
   * Save/update a league record for a user.
   * leagueKey format: "sleeper_{leagueId}" or "mfl_{season}_{leagueId}"
   */
  async function saveLeague(username, leagueKey, leagueData) {
    await userRef(username).child(`leagues/${leagueKey}`).set({
      importedAt: Date.now(),
      ...leagueData
    });
  }

  async function saveLeagues(username, leaguesMap) {
    // leaguesMap: { [leagueKey]: leagueData }
    const updates = {};
    for (const [key, data] of Object.entries(leaguesMap)) {
      updates[key] = { importedAt: Date.now(), ...data };
    }
    await userRef(username).child("leagues").update(updates);
  }

  async function getLeagues(username) {
    const snap = await userRef(username).child("leagues").once("value");
    return snap.exists() ? snap.val() : {};
  }

  /**
   * Recompute + save aggregated career stats from all leagues.
   * Tracks 1st/2nd/3rd finishes separately for scoring.
   */
  async function recomputeStats(username) {
    const leagues = await getLeagues(username);
    const values  = Object.values(leagues);

    const championships = values.filter(l => l.playoffFinish === 1 || l.isChampion).length;
    const runnerUps     = values.filter(l => l.playoffFinish === 2).length;
    const thirdPlace    = values.filter(l => l.playoffFinish === 3).length;
    const playoffs      = values.filter(l => l.playoffFinish != null && l.playoffFinish <= 7).length;

    const stats = {
      totalWins:      values.reduce((s, l) => s + (l.wins   || 0), 0),
      totalLosses:    values.reduce((s, l) => s + (l.losses || 0), 0),
      championships,
      runnerUps,
      thirdPlace,
      playoffAppearances: playoffs,
      leaguesPlayed:  values.length,
      seasonsPlayed:  new Set(values.map(l => l.season).filter(Boolean)).size,
      winPct:         0,
      dynastyScore:   0
    };

    const totalGames = stats.totalWins + stats.totalLosses;
    stats.winPct = totalGames > 0
      ? parseFloat((stats.totalWins / totalGames).toFixed(4))
      : 0;

    // Dynasty score formula:
    // Win% * 100 + champ * 20 + runner-up * 10 + 3rd * 5 + playoff * 2 + seasons * 2
    const seasons = new Set(values.map(l => l.season).filter(Boolean)).size;
    stats.dynastyScore = Math.round(
      stats.winPct * 100 +
      championships * 20 +
      runnerUps     * 10 +
      thirdPlace    * 5  +
      playoffs      * 2  +
      seasons       * 2
    );

    await _restPut(`gmd/users/${username.toLowerCase()}/stats`, stats);
    return stats;
  }

  // ── Social ─────────────────────────────────────────────

  async function addStickyNote(targetUsername, { authorUsername, text, emoji }) {
    const ref = socialRef(targetUsername).child("stickyNotes").push();
    await ref.set({
      authorUsername,
      text,
      emoji: emoji || "",
      createdAt: Date.now(),
      isRemoved: false
    });
    return ref.key;
  }

  async function removeStickyNote(targetUsername, noteId) {
    await socialRef(targetUsername).child(`stickyNotes/${noteId}/isRemoved`).set(true);
  }

  function subscribeStickyNotes(targetUsername, callback) {
    return socialRef(targetUsername).child("stickyNotes")
      .on("value", snap => callback(snap.exists() ? snap.val() : {}));
  }

  async function addReaction(targetUsername, emoji) {
    const ref = socialRef(targetUsername).child(`reactions/${emoji}`);
    await ref.transaction(n => (n || 0) + 1);
  }

  // ── Rivalries ──────────────────────────────────────────

  async function updateRivalry(userA, userB, data) {
    await rivalryRef(userA, userB).update({
      userA, userB,
      lastUpdated: Date.now(),
      ...data
    });
  }

  async function getRivalry(userA, userB) {
    const snap = await rivalryRef(userA, userB).once("value");
    return snap.exists() ? snap.val() : null;
  }

  async function getLeagueRules(leagueKey) {
    try { return await _restGet(`gmd/leagueRules/${leagueKey}`); }
    catch(e) { return null; }
  }

  async function saveLeagueRules(leagueKey, data) {
    await _restPut(`gmd/leagueRules/${leagueKey}`, data);
  }

  // ── League meta (pins, labels, groups) — uses SDK ref for auth ──

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

  async function getLeagueMeta(username) {
    try {
      const path = `users/${username.toLowerCase()}/leagueMeta`;
      console.log("[GMDB] getLeagueMeta path:", path);
      const snap = await GMD.child(path).once("value");
      const val  = snap.val() || {};
      console.log("[GMDB] getLeagueMeta result keys:", Object.keys(val));
      return val;
    } catch(e) {
      console.error("[GMDB] getLeagueMeta failed:", e.message);
      return {};
    }
  }

  async function saveLeagueMetaEntry(username, leagueKey, meta) {
    const path = `users/${username.toLowerCase()}/leagueMeta/${leagueKey}`;
    console.log("[GMDB] saveLeagueMetaEntry path:", path, "| meta:", JSON.stringify(meta));
    await GMD.child(path).set(meta);
    // Immediate readback to verify write succeeded
    const verify = await GMD.child(path).once("value");
    console.log("[GMDB] readback:", JSON.stringify(verify.val()));
  }

  // ── Salary cap data — uses SDK ref for auth ──────────────
  async function getSalarySettings(leagueKey) {
    try {
      const snap = await GMD.child(`salaryCap/${leagueKey}/settings`).once("value");
      return snap.val() || null;
    } catch(e) { return null; }
  }

  async function saveSalarySettings(leagueKey, settings) {
    await GMD.child(`salaryCap/${leagueKey}/settings`).set(settings);
  }

  async function getSalaryRosters(leagueKey) {
    try {
      const snap = await GMD.child(`salaryCap/${leagueKey}/rosters`).once("value");
      return snap.val() || {};
    } catch(e) { return {}; }
  }

  async function saveSalaryRosters(leagueKey, rosters) {
    await GMD.child(`salaryCap/${leagueKey}/rosters`).set(rosters);
  }

  // ── Public API ─────────────────────────────────────────
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

    getGlobalLeagueMeta,
    saveGlobalLeagueMeta,
    getAllLeagueMeta,
    createGroup,
    addLeagueToGroup,
    removeLeagueFromGroup,
    getGroup,
    getAllGroups,
    _restGet,
    _restPut
  };

})();
