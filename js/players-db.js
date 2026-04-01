// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Player Database
//  Fetches the full Sleeper player DB once, stores in
//  IndexedDB (avoids localStorage 5MB quota).
//  Version "4" = full bio fields confirmed.
//  All modules call DLRPlayers.get() to access player data.
// ─────────────────────────────────────────────────────────

const DLRPlayers = (() => {
  const CACHE_KEY = "dlr_players_v4";
  const VER_KEY   = "dlr_players_ver";
  const REQUIRED_VER = "4";

  let _cache = null;       // in-memory after first load
  let _loading = null;     // pending fetch promise (avoid parallel fetches)

  // ── Get player by ID ──────────────────────────────────────
  function get(playerId) {
    if (_cache) return _cache[playerId] || {};
    return {};
  }

  // ── Get all players ───────────────────────────────────────
  function all() { return _cache || {}; }

  // ── Load (call once at startup, awaited by anything needing players) ──
  async function load(forceRefresh = false) {
    if (_cache && !forceRefresh) return _cache;
    if (_loading) return _loading;

    _loading = _doLoad(forceRefresh);
    try {
      _cache = await _loading;
    } finally {
      _loading = null;
    }
    return _cache;
  }

  async function _doLoad(forceRefresh) {
    const ver = localStorage.getItem(VER_KEY);

    if (!forceRefresh && ver === REQUIRED_VER) {
      // Try IndexedDB first
      try {
        const cached = await DLRIDB.get(CACHE_KEY);
        if (cached && Object.keys(cached).length > 1000) {
          console.log(`[DLRPlayers] Loaded ${Object.keys(cached).length} players from IndexedDB`);
          return cached;
        }
      } catch(e) {}

      // Try localStorage fallback
      try {
        const lsVal = localStorage.getItem("dlr_players");
        if (lsVal) {
          const parsed = JSON.parse(lsVal);
          if (Object.keys(parsed).length > 1000) {
            console.log(`[DLRPlayers] Loaded ${Object.keys(parsed).length} players from localStorage`);
            return parsed;
          }
        }
      } catch(e) {}
    }

    // Fetch from Sleeper API
    console.log("[DLRPlayers] Fetching from Sleeper API...");
    const r    = await fetch("https://api.sleeper.app/v1/players/nfl");
    if (!r.ok) throw new Error("Sleeper player API returned " + r.status);
    const data = await r.json();
    console.log(`[DLRPlayers] Fetched ${Object.keys(data).length} players`);

    // Store in IndexedDB (primary) and localStorage (fallback)
    try {
      await DLRIDB.set(CACHE_KEY, data);
      localStorage.setItem(VER_KEY, REQUIRED_VER);
      // Remove old key to free localStorage space
      localStorage.removeItem("dlr_players");
      console.log("[DLRPlayers] Saved to IndexedDB");
    } catch(e) {
      // IndexedDB failed — try localStorage (may fail for large data)
      try {
        localStorage.setItem("dlr_players", JSON.stringify(data));
        localStorage.setItem(VER_KEY, REQUIRED_VER);
      } catch(le) {
        console.warn("[DLRPlayers] Both storage methods failed:", le.message);
      }
    }

    return data;
  }

  // ── Force refresh (call from settings or after long gap) ─
  async function refresh() {
    localStorage.removeItem(VER_KEY);
    return load(true);
  }

  // ── Format bio fields ─────────────────────────────────────
  function formatBio(p) {
    if (!p || !Object.keys(p).length) return null;
    const parts = [];
    if (p.age != null)     parts.push(`Age ${p.age}`);
    else if (p.birth_date) {
      const age = _calcAge(p.birth_date);
      if (age) parts.push(`Age ${age}`);
    }
    if (p.height) {
      const h = String(p.height);
      if (h.includes("'"))  parts.push(h.replace(/\\"/g, '"'));
      else {
        const inches = parseInt(h);
        if (inches > 0) parts.push(`${Math.floor(inches/12)}'${inches%12}"`);
      }
    }
    if (p.weight)           parts.push(`${p.weight} lbs`);
    if (p.college)          parts.push(p.college);
    if (p.years_exp === 0)  parts.push("Rookie");
    else if (p.years_exp != null) parts.push(`Yr ${p.years_exp + 1}`);
    if (p.search_rank && p.search_rank < 500) parts.push(`#${p.search_rank} ADP`);
    return parts.length ? parts.join(" · ") : null;
  }

  function _calcAge(birthDate) {
    try {
      const [y, m, d] = birthDate.split("-").map(Number);
      const today = new Date();
      let age = today.getFullYear() - y;
      if (today.getMonth()+1 < m || (today.getMonth()+1 === m && today.getDate() < d)) age--;
      return age;
    } catch(e) { return null; }
  }

  return { get, all, load, refresh, formatBio };
})();
