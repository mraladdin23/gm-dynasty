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
  // Shared commish settings — keyed by leagueId, visible to all members
  const leagueSettingsRef = (leagueId) => GMD.child(`leagueSettings/${leagueId}`);

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

  // Timeout wrapper for fetch — prevents hanging on slow/blocked networks
  async function _fetchWithTimeout(url, options = {}, ms = 8000) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), ms);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(tid);
      return res;
    } catch(err) {
      clearTimeout(tid);
      if (err.name === "AbortError") throw new Error(`Request timed out (${ms/1000}s)`);
      throw err;
    }
  }

  async function _restPut(path, data) {
    const token = await _getAuthToken();
    const auth  = token ? `?auth=${token}` : "";
    const url   = `https://sleeperbid-default-rtdb.firebaseio.com/${path}.json${auth}`;
    const res   = await _fetchWithTimeout(url, {
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
    const res   = await _fetchWithTimeout(url);
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
    console.log("[GMDB] createUser step 3 — auto-linking public registrations");
    autoLinkPublicRegistrations(key, { email: email || "" }).catch(() => {});
    console.log("[GMDB] createUser step 4 — done");
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

  // ── Delete a single league key ─────────────────────────
  async function deleteLeague(username, leagueKey) {
    await userRef(username).child(`leagues/${leagueKey}`).remove();
    // Also remove any leagueMeta for this key
    await userRef(username).child(`leagueMeta/${leagueKey}`).remove().catch(() => {});
  }

  // ── Delete all leagues for a platform ─────────────────
  async function deleteLeaguesByPlatform(username, platform) {
    const leagues = await getLeagues(username);
    const keysToDelete = Object.entries(leagues)
      .filter(([, l]) => l.platform === platform)
      .map(([k]) => k);
    if (!keysToDelete.length) return 0;

    // Build a multi-path null update — setting to null deletes in Firebase REST
    const nullUpdates = {};
    keysToDelete.forEach(k => {
      nullUpdates[k] = null;
    });
    await userRef(username).child("leagues").update(nullUpdates);

    // Clean up leagueMeta entries too
    const metaUpdates = {};
    keysToDelete.forEach(k => { metaUpdates[k] = null; });
    await userRef(username).child("leagueMeta").update(metaUpdates).catch(() => {});

    return keysToDelete.length;
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
  async function getLeagueMeta(username) {
    try {
      const snap = await GMD.child(`users/${username.toLowerCase()}/leagueMeta`).once("value");
      return snap.val() || {};
    } catch(e) { return {}; }
  }

  // Save leagueMeta — splits into personal (per-user) and shared (commish, all members see)
  async function saveLeagueMetaEntry(username, leagueKey, meta) {
    // Personal fields — stored under the user's own path
    const personal = {
      pinned:    meta.pinned    ?? false,
      archived:  meta.archived  ?? false,
      customLabel: meta.customLabel || null
    };
    await GMD.child(`users/${username.toLowerCase()}/leagueMeta/${leagueKey}`).update(personal);

    // Shared commish fields — stored at leagueSettings/{leagueId}, visible to all
    // leagueKey format is e.g. "sleeper_123456" — leagueId is the numeric part
    const leagueId = meta._leagueId || leagueKey.replace(/^[^_]+_/, "");
    if (meta.isCommissioner && leagueId) {
      const shared = {};
      if (meta.leagueTypeOverride  !== undefined) shared.leagueTypeOverride  = meta.leagueTypeOverride  || null;
      if (meta.auctionEnabled      !== undefined) shared.auctionEnabled      = meta.auctionEnabled      || false;
      if (meta.auctionIncludePicks !== undefined) shared.auctionIncludePicks = meta.auctionIncludePicks || false;
      if (meta.commishGroup        !== undefined) shared.commishGroup        = meta.commishGroup        || null;
      if (Object.keys(shared).length) {
        await leagueSettingsRef(leagueId).update(shared);
      }
    }
  }

  // Get shared commish settings for a batch of leagueIds
  async function getSharedLeagueSettings(leagueIds) {
    if (!leagueIds || !leagueIds.length) return {};
    const results = {};
    await Promise.all(leagueIds.map(async id => {
      try {
        const snap = await leagueSettingsRef(id).once("value");
        if (snap.val()) results[id] = snap.val();
      } catch(e) {}
    }));
    return results;
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

  // ── Cross-platform merge links ─────────────────────────
  // mergedInto: the franchiseId of the target chain (the newer/primary chain)
  // Stored at leagueMeta/{key}.mergedInto for each absorbed key.
  // suppressMerge: true = treat as unmerged (soft undo without deleting data).

  async function saveMergeLinks(username, absorbedKeys, targetFranchiseId) {
    const u = username.toLowerCase();
    await Promise.all(absorbedKeys.map(key =>
      GMD.child(`users/${u}/leagueMeta/${key}`).update({
        mergedInto:    targetFranchiseId,
        suppressMerge: false
      })
    ));
  }

  async function removeMergeLinks(username, absorbedKeys) {
    const u = username.toLowerCase();
    await Promise.all(absorbedKeys.map(key =>
      GMD.child(`users/${u}/leagueMeta/${key}`).update({
        mergedInto:    null,
        suppressMerge: true
      })
    ));
  }

  // ── Yahoo token persistence ────────────────────────────
  // Stored at gmd/users/{username}/platforms/yahoo/tokens so they survive
  // browser storage clearing and work across devices/browsers.

  async function saveYahooTokens(username, { accessToken, refreshToken, expiresAt }) {
    try {
      await GMD.child(`users/${username.toLowerCase()}/platforms/yahoo/tokens`).set({
        accessToken,
        refreshToken: refreshToken || null,
        expiresAt:    expiresAt    || 0,
        savedAt:      Date.now()
      });
    } catch(e) {
      console.warn("[GMDB] saveYahooTokens failed:", e.message);
    }
  }

  async function getYahooTokens(username) {
    try {
      const snap = await GMD.child(`users/${username.toLowerCase()}/platforms/yahoo/tokens`).once("value");
      return snap.val() || null;
    } catch(e) {
      console.warn("[GMDB] getYahooTokens failed:", e.message);
      return null;
    }
  }

  // ── Tournament helpers ─────────────────────────────────
  // All tournament data lives at gmd/tournaments/{tournamentId}/
  // These are thin wrappers kept here for consistency — the tournament
  // module uses GMD.child() SDK refs directly for real-time updates.

  async function getTournament(tournamentId) {
    try {
      const snap = await GMD.child(`tournaments/${tournamentId}`).once("value");
      return snap.val() || null;
    } catch(e) { return null; }
  }

  async function saveTournamentMeta(tournamentId, meta) {
    await GMD.child(`tournaments/${tournamentId}/meta`).update(meta);
  }

  async function getAllTournaments() {
    try {
      const snap = await GMD.child("tournaments").once("value");
      return snap.val() || {};
    } catch(e) { return {}; }
  }

  // ── Public tournament helpers ─────────────────────────
  // gmd/publicTournaments/{tid} is readable without auth (Firebase rules: .read: true)

  async function getPublicTournaments() {
    try {
      const snap = await GMD.child("publicTournaments").once("value");
      return snap.val() || {};
    } catch(e) { return {}; }
  }

  async function getPublicTournament(tid) {
    try {
      const snap = await GMD.child("publicTournaments/" + tid).once("value");
      return snap.val() || null;
    } catch(e) { return null; }
  }

  // ── Auto-link public registrations on DLR account creation ──
  // Called from createUser after a new account is made.
  // Searches all tournament registrations for matching email/Sleeper/Yahoo username
  // and links them to the new DLR account silently.
  async function autoLinkPublicRegistrations(username, { email, sleeperUsername, yahooUsername }) {
    try {
      const snap = await GMD.child("tournaments").once("value");
      const tournaments = snap.val() || {};
      const updates = {};

      for (const [tid, t] of Object.entries(tournaments)) {
        if (!t?.registrations) continue;
        for (const [rid, reg] of Object.entries(t.registrations)) {
          if (reg.dlrLinked) continue;
          if (reg.source !== "public_form" && reg.source !== "csv_import") continue;

          const emailMatch   = email          && reg.email?.toLowerCase()          === email.toLowerCase();
          const sleeperMatch = sleeperUsername && reg.sleeperUsername?.toLowerCase() === sleeperUsername.toLowerCase();
          const yahooMatch   = yahooUsername   && reg.yahooUsername?.toLowerCase()   === yahooUsername.toLowerCase();

          if (emailMatch || sleeperMatch || yahooMatch) {
            updates["tournaments/" + tid + "/registrations/" + rid + "/dlrLinked"]   = true;
            updates["tournaments/" + tid + "/registrations/" + rid + "/dlrUsername"] = username;
          }
        }
      }

      if (Object.keys(updates).length) {
        await GMD.update(updates);
        console.log("[GMDB] Auto-linked", Object.keys(updates).length / 2, "registration(s) for", username);
      }
    } catch(err) {
      console.warn("[GMDB] autoLinkPublicRegistrations failed:", err.message);
    }
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
    deleteLeague,
    deleteLeaguesByPlatform,
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
    getSharedLeagueSettings,
    getSalarySettings,
    saveSalarySettings,
    getSalaryRosters,
    saveSalaryRosters,
    saveYahooTokens,
    getYahooTokens,
    saveMergeLinks,
    removeMergeLinks,
    getTournament,
    saveTournamentMeta,
    getAllTournaments,
    getPublicTournaments,
    getPublicTournament,
    autoLinkPublicRegistrations,
    _restGet,
    _restPut
  };

})();
