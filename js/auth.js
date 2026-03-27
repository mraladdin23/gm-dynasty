// ─────────────────────────────────────────────────────────
//  GM Dynasty — Auth Module
//  Custom username + password identity.
//  Firebase Auth handles credentials; gmd/users/ stores profile.
//  Platform accounts (Sleeper, MFL) are linked separately.
// ─────────────────────────────────────────────────────────

const Auth = (() => {

  let _currentUser  = null;   // Firebase Auth user
  let _currentProfile = null; // gmd/users/{username} snapshot
  let _onAuthChange = null;   // callback set by app.js

  // ── Internal email builder ─────────────────────────────
  // Firebase Auth requires an email. We synthesize one from
  // the GMD username so users only ever see the username UX.
  function _syntheticEmail(username) {
    return `${username.toLowerCase()}@gmdynasty.app`;
  }

  // ── Register ───────────────────────────────────────────
  async function register({ username, email, password }) {
    // 1. Validate username format
    const usernameError = GMDB.validateUsername(username);
    if (usernameError) throw new Error(usernameError);

    // 2. Check availability
    const taken = await GMDB.usernameExists(username);
    if (taken) throw new Error("That username is already taken. Choose another.");

    // 3. Create Firebase Auth account using synthetic email
    //    (we store the real email separately in the profile)
    let fbUser;
    try {
      const cred = await auth.createUserWithEmailAndPassword(
        _syntheticEmail(username),
        password
      );
      fbUser = cred.user;
    } catch (err) {
      // Translate Firebase error codes to friendly messages
      throw new Error(_friendlyAuthError(err.code));
    }

    // 4. Write profile to gmd/users/
    try {
      _currentProfile = await GMDB.createUser({
        username,
        email,
        uid: fbUser.uid
      });
    } catch (err) {
      // Profile write failed — clean up the Auth account so
      // the user isn't stuck in a half-created state
      await fbUser.delete();
      throw new Error("Failed to create profile. Please try again.");
    }

    _currentUser = fbUser;
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
      if (fbUser) {
        _currentUser = fbUser;
        // Load profile if not already loaded
        if (!_currentProfile) {
          _currentProfile = await GMDB.getUserByUid(fbUser.uid);
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
