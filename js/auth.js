// ─────────────────────────────────────────────────────────
//  GM Dynasty — Auth Module
//  Custom username + password identity.
//  Firebase Auth handles credentials; gmd/users/ stores profile.
//  Platform accounts (Sleeper, MFL) are linked separately.
// ─────────────────────────────────────────────────────────

const Auth = (() => {

  let _currentUser    = null;   // Firebase Auth user
  let _currentProfile = null;   // gmd/users/{username} snapshot
  let _onAuthChange   = null;   // callback set by app.js
  let _isRegistering  = false;  // prevents observer from racing profile write

  // ── Internal email builder ─────────────────────────────
  // Firebase Auth requires an email. We synthesize one from
  // the GMD username so users only ever see the username UX.
  function _syntheticEmail(username) {
    return `${username.toLowerCase()}@gmdynasty.app`;
  }

  // ── Register ───────────────────────────────────────────
  async function register({ username, email, password }) {
    const usernameError = GMDB.validateUsername(username);
    if (usernameError) throw new Error(usernameError);

    console.log("[Auth] register — checking username availability:", username);
    const taken = await GMDB.usernameExists(username);
    console.log("[Auth] register — username taken?", taken);
    if (taken) throw new Error("That username is already taken. Choose another.");

    _isRegistering = true;

    let fbUser;
    try {
      console.log("[Auth] register step 1 — creating Firebase Auth user");
      const cred = await auth.createUserWithEmailAndPassword(
        _syntheticEmail(username),
        password
      );
      fbUser = cred.user;
      console.log("[Auth] register step 2 — Auth user created:", fbUser.uid);
    } catch (err) {
      _isRegistering = false;
      throw new Error(_friendlyAuthError(err.code));
    }

    try {
      console.log("[Auth] register step 3 — writing profile to DB");
      _currentProfile = await GMDB.createUser({
        username,
        email,
        uid: fbUser.uid
      });
      console.log("[Auth] register step 4 — profile written:", _currentProfile);
    } catch (err) {
      console.error("[Auth] register step 3 FAILED:", err);
      await fbUser.delete();
      _isRegistering = false;
      throw new Error("Failed to create profile. Please try again.");
    }

    _currentUser   = fbUser;
    _isRegistering = false;
    console.log("[Auth] register complete");
    return { user: fbUser, profile: _currentProfile };
  }

  // ── Login ──────────────────────────────────────────────
  async function login({ username, password }) {
    try {
      const cred = await auth.signInWithEmailAndPassword(
        _syntheticEmail(username),
        password
      );
      _currentUser = cred.user;
    } catch (err) {
      throw new Error(_friendlyAuthError(err.code, username));
    }

    // Load profile
    _currentProfile = await GMDB.getUserByUid(_currentUser.uid);
    if (!_currentProfile) {
      // Edge case: Auth account exists but no profile — treat as new
      throw new Error("Profile not found. Please contact support.");
    }

    return { user: _currentUser, profile: _currentProfile };
  }

  // ── Logout ─────────────────────────────────────────────
  async function logout() {
    await auth.signOut();
    _currentUser    = null;
    _currentProfile = null;
  }

  // ── Auth state observer ────────────────────────────────
  function onAuthStateChanged(callback) {
    _onAuthChange = callback;
    auth.onAuthStateChanged(async (fbUser) => {
      // Skip if registration is in progress — that flow sets
      // _currentProfile itself and calls the screen transition directly
      if (_isRegistering) return;

      if (fbUser) {
        _currentUser = fbUser;
        try {
          // Don't force-refresh token — that blocks on slow/blocked networks.
          // The token is still valid; Firebase will refresh it lazily in the background.
          await Promise.race([
            fbUser.getIdToken(false),
            new Promise((_, reject) => setTimeout(() => reject(new Error("token timeout")), 5000))
          ]);
          if (!_currentProfile) {
            _currentProfile = await GMDB.getUserByUid(fbUser.uid);
          }
        } catch (err) {
          console.warn("[Auth] Profile load failed:", err.message);
          // Still set the user even if token/profile fetch timed out —
          // lets the app show the auth screen rather than hanging forever
          _currentProfile = null;
        }
      } else {
        _currentUser    = null;
        _currentProfile = null;
      }
      callback(_currentUser, _currentProfile);
    });
  }

  // ── Getters ────────────────────────────────────────────
  function getCurrentUser()    { return _currentUser;    }
  function getCurrentProfile() { return _currentProfile; }
  function isLoggedIn()        { return !!_currentUser;  }

  async function refreshProfile() {
    if (!_currentUser) return null;
    _currentProfile = await GMDB.getUserByUid(_currentUser.uid);
    return _currentProfile;
  }

  // ── Password change ────────────────────────────────────
  async function changePassword(newPassword) {
    if (!_currentUser) throw new Error("Not logged in.");
    await _currentUser.updatePassword(newPassword);
  }

  // ── Error messages ─────────────────────────────────────
  function _friendlyAuthError(code, username) {
    switch (code) {
      case "auth/email-already-in-use":
        return "That username is already taken. Choose another.";
      case "auth/wrong-password":
      case "auth/user-not-found":
      case "auth/invalid-credential":
        return `Incorrect username or password.`;
      case "auth/too-many-requests":
        return "Too many failed attempts. Try again in a few minutes.";
      case "auth/weak-password":
        return "Password must be at least 6 characters.";
      case "auth/network-request-failed":
        return "Network error. Check your connection and try again.";
      default:
        return "Something went wrong. Please try again.";
    }
  }

  // ── Public API ─────────────────────────────────────────
  return {
    register,
    login,
    logout,
    onAuthStateChanged,
    getCurrentUser,
    getCurrentProfile,
    isLoggedIn,
    refreshProfile,
    changePassword
  };

})();
