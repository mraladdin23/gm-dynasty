// ── Global bundle cache interface for tab modules ─────────────────────────
// Loaded BEFORE tab modules so DLRBundleCache is available when tabs init.
// Depends on: firebase-db.js (GMDB), mfl.js (MFLAPI), yahoo.js (YahooAPI)
// ── Global bundle cache interface for tab modules ─────────────────────────
// Tab modules call these instead of MFLAPI.getLeagueBundle / YahooAPI.getLeagueBundle
// directly. For past seasons the bundle is read from Firebase (no Worker call).
// For current season it always fetches live.
//
// Usage in tab modules:
//   const bundle = await DLRBundleCache.getMFL(leagueId, season);
//   const bundle = await DLRBundleCache.getYahoo(yahooLeagueKey, season, fbLeagueKey);
window.DLRBundleCache = (() => {
  const CURRENT_YEAR = new Date().getFullYear();

  function _fbKey(platform, season, leagueId) {
    return `${platform}_${season}_${leagueId}`;
  }

  async function _getUsername() {
    // Read current username from the GMD profile module's cached state
    // by checking Firebase auth — same user who loaded the app
    const user = firebase.auth().currentUser;
    if (!user) return null;
    const snap = await firebase.database().ref(`gmd/uid_map/${user.uid}`).once("value");
    return snap.val() || null;
  }

  // Cache username to avoid repeated Firebase reads
  let _cachedUsername = null;
  async function _username() {
    if (!_cachedUsername) _cachedUsername = await _getUsername();
    return _cachedUsername;
  }

  async function getMFL(leagueId, season) {
    const isPast = parseInt(season) < CURRENT_YEAR;
    if (!isPast) {
      return MFLAPI.getLeagueBundle(leagueId, season);
    }

    const fbKey = _fbKey("mfl", season, leagueId);
    const username = await _username();

    if (username) {
      // Check bundleCached flag via in-memory league data first (fast path)
      const leagueSnap = await firebase.database()
        .ref(`gmd/users/${username}/leagues/${fbKey}/bundleCached`).once("value");

      if (leagueSnap.val() === true) {
        const cached = await GMDB.getBundleCache(username, fbKey);
        if (cached) {
          console.log(`[BundleCache] HIT ${fbKey}`);
          return cached;
        }
      }
    }

    // Cache miss — fetch from Worker
    const bundle = await MFLAPI.getLeagueBundle(leagueId, season);

    // Save to cache for next time
    if (bundle && username) {
      console.log(`[BundleCache] SAVING ${fbKey}`);
      const saved = await GMDB.saveBundleCache(username, fbKey, bundle);
      if (saved) await GMDB.markBundleCached(username, fbKey);
    }

    return bundle;
  }

  async function getYahoo(yahooLeagueKey, season, fbLeagueKey) {
    const isPast = parseInt(season) < CURRENT_YEAR;
    if (!isPast) {
      return YahooAPI.getLeagueBundle(yahooLeagueKey);
    }

    const username = await _username();

    if (username && fbLeagueKey) {
      const leagueSnap = await firebase.database()
        .ref(`gmd/users/${username}/leagues/${fbLeagueKey}/bundleCached`).once("value");

      if (leagueSnap.val() === true) {
        const cached = await GMDB.getBundleCache(username, fbLeagueKey);
        if (cached) {
          console.log(`[BundleCache] HIT ${fbLeagueKey}`);
          return cached;
        }
      }
    }

    const bundle = await YahooAPI.getLeagueBundle(yahooLeagueKey);

    if (bundle && username && fbLeagueKey) {
      console.log(`[BundleCache] SAVING ${fbLeagueKey}`);
      const saved = await GMDB.saveBundleCache(username, fbLeagueKey, bundle);
      if (saved) await GMDB.markBundleCached(username, fbLeagueKey);
    }

    return bundle;
  }

  return { getMFL, getYahoo };
})();
