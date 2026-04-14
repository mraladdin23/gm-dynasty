// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Player Database + Cross-Platform Mapping
//  Uses DynastyProcess db_playerids.csv for reliable MFL/Yahoo → Sleeper mapping
//  Includes bio fallback when Sleeper data is missing
// ─────────────────────────────────────────────────────────

const DLRPlayers = (() => {
  const SLEEPER_KEY = "dlr_players_v4";
  const MAPPINGS_KEY = "dlr_player_mappings";
  const MAPPINGS_VER_KEY = "dlr_mappings_ver";
  const MAPPINGS_VERSION = "2026-04";   // bump when you want to force refresh

  let _sleeperCache = null;
  let _mappings = null;   // { byMfl: {}, byYahoo: {}, bySleeper: {} }
  let _loadingPromise = null;

  // ── Sleeper player access (unchanged) ─────────────────────
  function get(playerId) {
    return _sleeperCache?.[playerId] || {};
  }
  function all() { return _sleeperCache || {}; }

  // ── Cross-platform mapping access ─────────────────────────
  function getByMflId(mflId) {
    return _mappings?.byMfl?.[String(mflId)] || null;
  }
  function getByYahooId(yahooId) {
    return _mappings?.byYahoo?.[String(yahooId)] || null;
  }
  function getSleeperIdFromMfl(mflId) {
    return getByMflId(mflId)?.sleeper_id || null;
  }

  // Returns best available player object (Sleeper preferred)
  function getFullPlayer(platformId, platform = "mfl") {
    if (platform === "mfl") {
      const map = getByMflId(platformId);
      if (map) {
        const sleeperP = map.sleeper_id ? get(map.sleeper_id) : null;
        if (sleeperP && Object.keys(sleeperP).length > 5) return sleeperP;

        // Fallback to CSV bio
        return {
          first_name: map.name ? map.name.split(" ")[0] || "" : "",
          last_name: map.name ? map.name.split(" ").slice(1).join(" ") || "" : "",
          position: map.position || "?",
          fantasy_positions: [map.position || "?"],
          team: map.team || "FA",
          age: map.age ? parseFloat(map.age) : null,
          height: map.height ? parseInt(map.height) : null,   // inches
          weight: map.weight ? parseInt(map.weight) : null,
          college: map.college || "",
          draft_year: map.draft_year ? parseInt(map.draft_year) : null,
          search_rank: 9999
        };
      }
    }
    return get(platformId) || {};
  }

  // ── Height formatter (inches → 6'0") ──────────────────────
  function formatHeight(inches) {
    if (!inches) return "";
    const ft = Math.floor(inches / 12);
    const ins = inches % 12;
    return `${ft}'${ins}"`;
  }

  // Enhanced bio (uses mapping when Sleeper is incomplete)
  function formatBio(p, mapping = null) {
    const parts = [];
    const age = p.age ?? (mapping?.age ? parseFloat(mapping.age) : null);
    if (age != null) parts.push(`Age ${Math.floor(age)}`);

    const h = p.height ?? (mapping?.height ? formatHeight(parseInt(mapping.height)) : null);
    if (h) parts.push(h);

    const w = p.weight ?? mapping?.weight;
    if (w) parts.push(`${w} lbs`);

    if (p.college || mapping?.college) parts.push(p.college || mapping.college);

    const dy = mapping?.draft_year ? parseInt(mapping.draft_year) : null;
    if (dy) {
      const exp = new Date().getFullYear() - dy;
      parts.push(exp <= 0 ? "Rookie" : `Yr ${exp + 1}`);
    }

    return parts.length ? parts.join(" · ") : null;
  }

  // ── Load both Sleeper + Mappings ──────────────────────────
  async function load(force = false) {
    if (_sleeperCache && _mappings && !force) return _sleeperCache;
    if (_loadingPromise) return _loadingPromise;

    _loadingPromise = Promise.all([
      _loadSleeper(force),
      _loadMappings(force)
    ]);

    await _loadingPromise;
    _loadingPromise = null;
    return _sleeperCache;
  }

  async function _loadSleeper(force) {
    // Your original Sleeper logic (kept intact)
    if (!force && _sleeperCache) return _sleeperCache;

    const cached = await DLRIDB.get(SLEEPER_KEY);
    if (cached && Object.keys(cached).length > 1000) {
      _sleeperCache = cached;
      return cached;
    }

    const r = await fetch("https://api.sleeper.app/v1/players/nfl");
    const data = await r.json();
    _sleeperCache = data;
    try { await DLRIDB.set(SLEEPER_KEY, data); } catch(e) {}
    return data;
  }

  async function _loadMappings(force) {
    const ver = localStorage.getItem(MAPPINGS_VER_KEY);
    if (!force && ver === MAPPINGS_VERSION) {
      const cached = await DLRIDB.get(MAPPINGS_KEY);
      if (cached) {
        _mappings = cached;
        return;
      }
    }

    console.log("[DLRPlayers] Fetching DynastyProcess player mappings...");
    const url = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";
    const res = await fetch(url);
    const text = await res.text();

    const lines = text.trim().split("\n");
    const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));

    const byMfl = {}, byYahoo = {}, bySleeper = {};

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      const row = {};
      headers.forEach((h, idx) => row[h] = (values[idx] || "").replace(/^"|"$/g, "").trim());

      const entry = {
        sleeper_id: row.sleeper_id || null,
        mfl_id:     row.mfl_id     || null,
        yahoo_id:   row.yahoo_id   || null,
        name:       row.name       || row.merge_name || "",
        position:   row.position   || "",
        team:       row.team       || "FA",
        age:        row.age        ? parseFloat(row.age) : null,
        height:     row.height     ? parseInt(row.height) : null,   // inches
        weight:     row.weight     ? parseInt(row.weight) : null,
        college:    row.college    || "",
        draft_year: row.draft_year ? parseInt(row.draft_year) : null,
      };

      if (entry.mfl_id)   byMfl[entry.mfl_id] = entry;
      if (entry.yahoo_id) byYahoo[entry.yahoo_id] = entry;
      if (entry.sleeper_id) bySleeper[entry.sleeper_id] = entry;
    }

    _mappings = { byMfl, byYahoo, bySleeper };

    await DLRIDB.set(MAPPINGS_KEY, _mappings);
    localStorage.setItem(MAPPINGS_VER_KEY, MAPPINGS_VERSION);

    console.log(`[DLRPlayers] Loaded ${Object.keys(byMfl).length} MFL mappings`);
  }

  return {
    get, all, load,
    getByMflId, getByYahooId, getSleeperIdFromMfl, getFullPlayer,
    formatBio, formatHeight
  };
})();