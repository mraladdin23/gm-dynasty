// ─────────────────────────────────────────────────────────
//  GM Dynasty — Firebase DB Helpers
//  All reads/writes to gmd/ go through here.
//  Keeps data access centralized and easy to audit.
// ─────────────────────────────────────────────────────────

const GMDB = (() => {

  // ── Refs ──────────────────────────────────────────────
  const usersRef    = () => GMD.child("users");
  const userRef     = (username) => GMD.child(`users/${username.toLowerCase()}`);
  const socialRef   = (username) => GMD.child(`social/${username.toLowerCase()}`);
  const rivalryRef  = (a, b)     => GMD.child(`rivalries/${[a,b].sort().join("_")}`);
  const metaRef     = ()         => GMD.child("meta");

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
      const result = await Promise.race([
        userRef(username).child("uid").once("value"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 8000)
        )
      ]);
      return result.exists();
    } catch (err) {
      if (err.message === "timeout") {
        throw new Error("Connection timed out. Check your internet and try again.");
      }
      throw err;
    }
  }

  async function createUser({ username, email, uid }) {
    const key = sanitizeUsername(username);
    const now = Date.now();
    const profile = {
      uid,
      username,          // original casing
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
    console.log("[GMDB] createUser step 1 — writing profile for:", key);
    await userRef(key).set(profile);
    console.log("[GMDB] createUser step 2 — writing uid_map");
    await GMD.child(`uid_map/${uid}`).set(key);
    console.log("[GMDB] createUser step 3 — done");
    // Note: skipping meta counter transaction (can hang on slow connections)
    return profile;
  }

  async function getUserByUid(uid) {
    try {
      const snap = await GMD.child(`uid_map/${uid}`).once("value");
      if (!snap.exists()) return null;
      const key = snap.val();
      return getUser(key);
    } catch (err) {
      console.warn("[GMDB] getUserByUid failed:", err.message);
      return null;
    }
  }

  async function getUser(username) {
    const snap = await userRef(username).once("value");
    return snap.exists() ? snap.val() : null;
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
   */
  async function recomputeStats(username) {
    const leagues = await getLeagues(username);
    const values  = Object.values(leagues);

    const stats = {
      totalWins:     values.reduce((s, l) => s + (l.wins   || 0), 0),
      totalLosses:   values.reduce((s, l) => s + (l.losses || 0), 0),
      championships: values.filter(l => l.isChampion).length,
      leaguesPlayed: values.length,
      winPct:        0,
      dynastyScore:  0
    };

    const totalGames = stats.totalWins + stats.totalLosses;
    stats.winPct = totalGames > 0
      ? parseFloat((stats.totalWins / totalGames).toFixed(4))
      : 0;

    // Basic dynasty score formula (Phase 4 will refine this):
    // Base: win% * 100 + championships * 15 + seasons * 2
    const seasons = new Set(values.map(l => l.season)).size;
    stats.dynastyScore = Math.round(
      stats.winPct * 100 +
      stats.championships * 15 +
      seasons * 2
    );

    await userRef(username).child("stats").set(stats);
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
    getRivalry
  };

})();
