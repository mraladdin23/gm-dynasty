// ─────────────────────────────────────────────────────────
//  DLR Transactions — Sleeper league transaction viewer
//  Filters: type dropdown + team dropdown
// ─────────────────────────────────────────────────────────

const DLRTransactions = (() => {

  let _leagueId   = null;
  let _leagueKey  = null;
  let _platform   = null;
  let _season     = null;
  let _token      = 0;
  let _allTx      = [];
  let _rosters    = [];
  let _players    = {};
  let _typeFilter  = "all";
  let _teamFilter  = "all";
  let _myRosterId  = null;   // current user's team ID — used to default-filter

  const TYPE_LABELS = {
    trade:      "🔄 Trades",
    waiver:     "🏷 Waivers",
    free_agent: "➕ Free Agent",
  };

  // ── Public: init ─────────────────────────────────────────
  async function init(leagueId, platform, season, leagueKey, myRosterId) {
    _leagueId    = leagueId;
    _leagueKey   = leagueKey || null;
    _platform    = platform || "sleeper";
    _season      = season   || new Date().getFullYear().toString();
    _myRosterId  = myRosterId || null;
    _typeFilter  = "all";
    _teamFilter  = "all";
    _allTx       = [];
    _rosters     = [];
    _token++;
    const tok = _token;

    const el = document.getElementById("dtab-transactions");
    if (!el) return;

    if (_platform === "mfl") {
      el.innerHTML = _loadHTML("Loading MFL transactions…");
      try { await _loadMFLData(tok); }
      catch(e) { if (tok === _token) el.innerHTML = `<div class="tx-empty">⚠️ ${_esc(e.message)}</div>`; }
      return;
    }

    if (_platform === "yahoo") {
      el.innerHTML = _loadHTML("Loading Yahoo transactions…");
      try { await _loadYahooData(tok); }
      catch(e) { if (tok === _token) el.innerHTML = `<div class="tx-empty">⚠️ ${_esc(e.message)}</div>`; }
      return;
    }

    el.innerHTML = _loadHTML("Loading transactions…");
    await _loadData(tok);
  }

  // ── Load all data ─────────────────────────────────────────
  async function _loadData(tok) {
    const el = document.getElementById("dtab-transactions");
    if (!el || tok !== _token) return;

    try {
      // Load players + rosters in parallel with transactions (weeks 1–18)
      const weekNums = Array.from({length: 18}, (_, i) => i + 1);

      const [rosterRes, userRes, ...weekResults] = await Promise.all([
        SleeperAPI.getRosters(_leagueId),
        SleeperAPI.getLeagueUsers(_leagueId),
        ...weekNums.map(w =>
          fetch(`https://api.sleeper.app/v1/league/${_leagueId}/transactions/${w}`)
            .then(r => r.ok ? r.json() : []).catch(() => [])
        )
      ]);

      if (tok !== _token) return;

      // Build roster lookup {roster_id -> teamName}
      const userMap = {};
      (userRes||[]).forEach(u => { userMap[u.user_id] = u; });
      _rosters = (rosterRes||[]).map(r => {
        const u = userMap[r.owner_id] || {};
        return {
          roster_id: r.roster_id,
          teamName:  u.metadata?.team_name || u.display_name || `Team ${r.roster_id}`,
          username:  (u.username||"").toLowerCase()
        };
      }).sort((a,b) => a.teamName.localeCompare(b.teamName));

      _players = DLRPlayers.all();
      if (Object.keys(_players).length < 100) _players = await DLRPlayers.load();
      if (tok !== _token) return;

      // Flatten, filter to completed only, sort by date desc
      _allTx = weekResults.flat().filter(tx => tx && tx.status === "complete");
      _allTx.sort((a,b) => (b.created||b.status_updated||0) - (a.created||a.status_updated||0));

      _renderView(el);
    } catch(e) {
      if (tok !== _token) return;
      el.innerHTML = `<div class="tx-empty">Could not load transactions.<br><span class="dim">${e.message}</span></div>`;
    }
  }

  // ── Render full view with toolbar ────────────────────────
  function _renderView(el) {
    if (!el) el = document.getElementById("dtab-transactions");
    if (!el) return;

    const typeCounts = { all: _allTx.length };
    _allTx.forEach(t => { typeCounts[t.type] = (typeCounts[t.type]||0) + 1; });

    const filtered = _filterTx();

    // Team dropdown options
    const teamOpts = [
      `<option value="all">All Teams</option>`,
      ..._rosters.map(r =>
        `<option value="${r.roster_id}" ${String(_teamFilter)===String(r.roster_id)?"selected":""}>${_esc(r.teamName)}</option>`)
    ].join("");

    // Type dropdown options
    const typeOpts = [
      `<option value="all" ${_typeFilter==="all"?"selected":""}>All Types (${typeCounts.all})</option>`,
      ...Object.entries(TYPE_LABELS).map(([k,v]) =>
        `<option value="${k}" ${_typeFilter===k?"selected":""}>${v} (${typeCounts[k]||0})</option>`)
    ].join("");

    el.innerHTML = `
      <div class="tx-toolbar">
        <div class="tx-filters">
          <div class="tx-filter-group">
            <label class="tx-filter-label">Type</label>
            <select class="tx-select" onchange="DLRTransactions.setType(this.value)">${typeOpts}</select>
          </div>
          <div class="tx-filter-group">
            <label class="tx-filter-label">Team</label>
            <select class="tx-select" onchange="DLRTransactions.setTeam(this.value)">${teamOpts}</select>
          </div>
          <span class="tx-count dim">${filtered.length} transaction${filtered.length!==1?"s":""}</span>
        </div>
      </div>
      <div class="tx-list">
        ${filtered.length
          ? filtered.slice(0,150).map(tx => _txRow(tx)).join("")
          : `<div class="tx-empty">No transactions match the selected filters.</div>`}
        ${filtered.length > 150
          ? `<div class="tx-more dim">Showing 150 of ${filtered.length}</div>` : ""}
      </div>`;
  }

  // ── Filter logic ──────────────────────────────────────────
  function _filterTx() {
    return _allTx.filter(tx => {
      if (_typeFilter !== "all" && tx.type !== _typeFilter) return false;
      if (_teamFilter !== "all") {
        const rid = String(_teamFilter);
        const involved = new Set([
          ...Object.values(tx.adds  || {}),
          ...Object.values(tx.drops || {}),
          ...(tx.waiver_bid !== undefined ? [tx.roster_ids?.[0]] : []),
          ...(tx.roster_ids || [])
        ].map(String));
        if (!involved.has(rid)) return false;
      }
      return true;
    });
  }

  // ── Single transaction row ────────────────────────────────
  function _txRow(tx) {
    const date    = tx.created || tx.status_updated || 0;
    const dateStr = date ? new Date(date).toLocaleDateString([], {month:"short",day:"numeric"}) : "";
    const week    = tx.leg    ? `Wk ${tx.leg}` : "";
    const type    = tx.type   || "unknown";
    const statusOk = !tx.status || tx.status === "complete";
    const statusColor = statusOk ? "" : "color:var(--color-red)";

    let body = "";
    if (type === "trade") {
      body = _tradeSummary(tx);
    } else {
      const adds  = Object.entries(tx.adds  || {}).map(([pid]) => _chip(pid, "add")).join(" ");
      const drops = Object.entries(tx.drops || {}).map(([pid]) => _chip(pid, "drop")).join(" ");
      const waivBid = tx.settings?.waiver_bid != null
        ? `<span class="tx-bid dim">$${tx.settings.waiver_bid}</span>` : "";
      body = [
        adds  ? `${adds} ${waivBid}` : "",
        drops ? `<span class="tx-drops">${drops}</span>` : ""
      ].filter(Boolean).join(`<span class="tx-arrow"> · </span>`);
    }

    // Who initiated (for non-trades, show team name)
    const initiator = type !== "trade" && tx.roster_ids?.[0]
      ? _teamName(tx.roster_ids[0]) : "";

    return `
      <div class="tx-row tx-row--${type}">
        <div class="tx-meta">
          <span class="tx-type-badge tx-type-badge--${type}">${TYPE_LABELS[type]||type}</span>
          ${initiator ? `<span class="tx-team-name">${_esc(initiator)}</span>` : ""}
          <span class="tx-spacer"></span>
          ${week ? `<span class="tx-week dim">${week}</span>` : ""}
          <span class="tx-date dim">${dateStr}</span>
          ${!statusOk ? `<span class="tx-status" style="${statusColor}">${tx.status}</span>` : ""}
        </div>
        ${body ? `<div class="tx-body">${body}</div>` : ""}
        ${tx.comments ? `<div class="tx-comments" style="font-size:.72rem;color:var(--color-text-dim,#9ca3af);margin-top:.25rem;padding:0 .25rem">${_esc(tx.comments)}</div>` : ""}
      </div>`;
  }

  function _tradeSummary(tx) {
    const sides = {};
    const rids  = new Set([
      ...Object.values(tx.adds  || {}),
      ...Object.values(tx.drops || {}),
      ...(tx.draft_picks||[]).map(p => p.owner_id),
      ...(tx.draft_picks||[]).map(p => p.previous_owner_id),
    ].filter(Boolean).map(String));

    rids.forEach(rid => { sides[rid] = { gets:[], gives:[] }; });

    Object.entries(tx.adds  ||{}).forEach(([pid, rid]) => { sides[String(rid)]?.gets.push(_chip(pid,"trade")); });
    Object.entries(tx.drops ||{}).forEach(([pid, rid]) => { sides[String(rid)]?.gives.push(_chip(pid,"drop")); });
    (tx.draft_picks||[]).forEach(p => {
      const chip = `<span class="tx-chip tx-chip--pick">${p.season} Rd${p.round}</span>`;
      if (p.owner_id)          sides[String(p.owner_id)]?.gets.push(chip);
      if (p.previous_owner_id) sides[String(p.previous_owner_id)]?.gives.push(chip);
    });

    const sideArr = Object.entries(sides);
    if (!sideArr.length) return `<span class="dim">Details unavailable</span>`;

    return `<div class="tx-trade-grid">
      ${sideArr.map(([rid, {gets, gives}]) => `
        <div class="tx-trade-side">
          <div class="tx-trade-team">${_esc(_teamName(rid))}</div>
          ${gets.length  ? `<div class="tx-trade-row"><span class="tx-gets-lbl">gets</span> ${gets.join(" ")}</div>` : ""}
          ${gives.length ? `<div class="tx-trade-row"><span class="tx-gives-lbl">gives</span> ${gives.join(" ")}</div>` : ""}
        </div>`).join('<div class="tx-trade-divider">↔</div>')}
    </div>`;
  }

  function _chip(pid, chipType) {
    const p = _players[pid] || {};

    // FAAB bankroll chip (BB_ trade values) — render as a distinct money badge
    if (p._isFaab) {
      return `<span class="tx-chip tx-chip--faab" title="FAAB">${_esc(p.first_name)}</span>`;
    }

    const name = p.first_name
      ? `${p.first_name[0]}. ${p.last_name}`
      : pid?.startsWith("mfl_") ? `#${pid.slice(4)}` : (pid||"?");
    const pos  = (p.fantasy_positions?.[0] || p.position || "").toUpperCase();
    const posColor = {QB:"#b89ffe",RB:"#18e07a",WR:"#00d4ff",TE:"#ffc94d"}[pos] || "#9ca3af";
    const cls  = `tx-chip tx-chip--${chipType}`;
    return `<span class="${cls}" style="${chipType==="trade"?`border-color:${posColor}44`:""}" title="${pos}">${_esc(name)}</span>`;
  }

  // ── MFL transactions ──────────────────────────────────────
  async function _loadMFLData(tok) {
    const el = document.getElementById("dtab-transactions");
    const bundle = await MFLAPI.getLeagueBundle(_leagueId, _season);
    if (tok !== _token) return;

    const teams = MFLAPI.getTeams(bundle);
    const teamMap = {};
    teams.forEach(t => { teamMap[String(t.id)] = t.name || `Team ${t.id}`; });

    // Load DynastyProcess mappings + Sleeper DB so getFullPlayer() works
    await DLRPlayers.load();
    if (tok !== _token) return;

    // Load session-cached MFL player universe (name, pos, team, sleeperId per mflId)
    let mflPlayerMap = {};
    try {
      mflPlayerMap = await MFLAPI.getPlayers(_season);
      if (tok !== _token) return;
    } catch(e) {
      console.warn("[Transactions] MFL player universe load failed:", e.message);
    }

    // Supplement mflPlayerMap with names from rosters if players endpoint was empty
    if (Object.keys(mflPlayerMap).length < 10) {
      const rawRosters = bundle?.rosters?.rosters?.franchise;
      if (rawRosters) {
        const rArr = Array.isArray(rawRosters) ? rawRosters : [rawRosters];
        rArr.forEach(fr => {
          const players = fr.player ? (Array.isArray(fr.player) ? fr.player : [fr.player]) : [];
          players.forEach(p => {
            if (p.id && !mflPlayerMap[p.id]) {
              mflPlayerMap[p.id] = {
                name:      MFLAPI.mflNameToDisplay(p.name) || `Player ${p.id}`,
                pos:       (p.position || "").toUpperCase(),
                position:  (p.position || "").toUpperCase(),
                team:      p.team || "FA",
                sleeperId: null,
              };
            }
          });
        });
      }
    }

    const raw = bundle?.transactions?.transactions?.transaction;
    if (!raw) {
      el.innerHTML = `<div class="tx-empty">
        <div>No transactions found for ${_season}.</div>
        <a href="https://www42.myfantasyleague.com/${_season}/home/${_leagueId}"
          target="_blank" style="color:var(--color-gold);font-size:.82rem">View on MFL ↗</a>
      </div>`;
      return;
    }
    const txArr = Array.isArray(raw) ? raw : [raw];

    // MFL franchises as rosters (for team filter dropdown)
    _rosters = teams.map(t => ({
      roster_id: t.id,
      teamName:  t.name || `Team ${t.id}`,
      username:  ""
    })).sort((a,b) => a.teamName.localeCompare(b.teamName));

    // Resolve a MFL player ID → synthetic key, injecting a player record into _players
    // for the _chip() renderer. Uses DLRPlayers.getFullPlayer() (DynastyProcess CSV +
    // Sleeper DB) as the primary source — no fuzzy name matching.
    function mflPid(pid) {
      // BB_ prefix = FAAB bankroll included in a trade (e.g. "BB_62" = $62 FAAB).
      // Render as a money chip, not a player chip.
      if (pid && pid.startsWith("BB_")) {
        const amt   = pid.slice(3);
        const synId = `mfl_faab_${amt}`;
        if (!_players[synId]) {
          _players[synId] = {
            first_name:        `$${amt}`,
            last_name:         "FAAB",
            position:          "FAAB",
            fantasy_positions: ["FAAB"],
            _isFaab:           true,
          };
        }
        return synId;
      }

      // mflPlayerMap[pid].sleeperId was already resolved by MFLAPI.getPlayers()
      // via DLRPlayers.getByMflId(), so we trust it directly.
      const entry     = mflPlayerMap[pid] || {};
      const sleeperId = entry.sleeperId || null;
      const synId     = sleeperId ? sleeperId : `mfl_${pid}`;

      if (!_players[synId]) {
        if (sleeperId) {
          // Prefer the Sleeper DB record — gives photo key, injury status, etc.
          const sp = DLRPlayers.get(sleeperId);
          if (sp && sp.first_name) {
            _players[synId] = sp;
          }
        }

        if (!_players[synId]) {
          // Fall back to DLRPlayers.getFullPlayer() which merges the DynastyProcess
          // CSV bio (age, height, college) with whatever Sleeper data exists.
          const full = DLRPlayers.getFullPlayer(pid, "mfl");
          if (full?.first_name) {
            _players[synId] = full;
          } else {
            // Last resort: stub from mflPlayerMap name
            const n = entry.name || `Player ${pid}`;
            _players[synId] = {
              first_name:        n.split(" ")[0] || n,
              last_name:         n.split(" ").slice(1).join(" ") || "",
              position:          entry.pos || entry.position || "?",
              fantasy_positions: [entry.pos || entry.position || "?"],
            };
          }
        }
      }
      return synId;
    }

    // Normalize MFL transactions — only the 4 types DLR cares about.
    // WAIVER and BBID_WAIVER are both waiver claims (BBID = blind bid FAAB).
    // Everything else (IR, TAXI, AUCTION_WON, WAIVER_REQUEST, etc.) is filtered out.
    const MFL_TYPE_MAP = {
      "WAIVER":       "waiver",
      "BBID_WAIVER":  "waiver",
      "FREE_AGENT":   "free_agent",
      "TRADE":        "trade",
    };

    // Splits a comma-delimited "gave_up" string like "13146,17102," into clean player ID array.
    function parseGaveUp(str) {
      if (!str) return [];
      return str.split(",").map(s => s.trim()).filter(Boolean);
    }

    // Parses the MFL `transaction` field used by WAIVER, BBID_WAIVER, and FREE_AGENT.
    //
    // Observed formats:
    //   "16333,|0.00|14799,"   → add 16333,       faab 0.00, drop 14799
    //   "16191,|0.00|"         → add 16191,       faab 0.00, no drop
    //   "17062,|0.00|17087,"   → add 17062,       faab 0.00, drop 17087
    //   "|15292,"              → add 15292,       no faab,   no drop
    //   "|15692,16207,"        → add 15692+16207, no faab,   no drop
    //
    // Key rule: the drop/faab block always starts with "|" immediately after a comma
    // (",|"). If no ",|" exists, everything in the string is added players.
    //
    // Returns { addedPids[], droppedPid, faab }
    function parseTransactionField(str) {
      if (!str) return { addedPids: [], droppedPid: null, faab: null };

      // Locate the drop block — flagged by the first ",|" in the string
      const dropBlockIdx = str.indexOf(",|");

      let addStr, dropStr;
      if (dropBlockIdx >= 0) {
        addStr  = str.slice(0, dropBlockIdx);
        dropStr = str.slice(dropBlockIdx + 1); // keep leading | so pipe-split works
      } else {
        addStr  = str;
        dropStr = "";
      }

      // Added player IDs — strip leading pipe (FREE_AGENT style), split on comma
      const addedPids = addStr.replace(/^\|/, "").split(",")
        .map(s => s.trim()).filter(Boolean);

      // Drop block — pipe-delimited; numeric tokens = FAAB, non-numeric = dropped pid
      let droppedPid = null;
      let faab       = null;

      if (dropStr) {
        const parts = dropStr
        .split("|")
        .map(s => s.replace(/,$/, "").trim())
        .filter(Boolean);

        if (parts.length >= 1) faab = parts[0];
        if (parts.length >= 2) droppedPid = parts[1];
      }

      return { addedPids, droppedPid, faab };
    }

    _allTx = txArr
      .filter(tx => MFL_TYPE_MAP[tx.type])
      .map(tx => {
        const type    = MFL_TYPE_MAP[tx.type];
        const ts      = Number(tx.timestamp || 0) * 1000;
        const adds    = {};
        const drops   = {};

        if (type === "trade") {
          // ── TRADE ─────────────────────────────────────────────────
          // franchise  + franchise1_gave_up  → what franchise gave up  (other side gets it)
          // franchise2 + franchise2_gave_up  → what franchise2 gave up (franchise gets it)
          const fran1    = (tx.franchise  || "").trim();
          const fran2    = (tx.franchise2 || "").trim();
          const gave1    = parseGaveUp(tx.franchise1_gave_up);  // what fran1 sends away
          const gave2    = parseGaveUp(tx.franchise2_gave_up);  // what fran2 sends away

          // fran1 gives up these players → fran2 receives them
          gave1.forEach(pid => {
            const key = mflPid(pid);
            drops[key] = fran1;   // fran1 is giving
            adds[key]  = fran2;   // fran2 is receiving
          });
          // fran2 gives up these players → fran1 receives them
          gave2.forEach(pid => {
            const key = mflPid(pid);
            drops[key] = fran2;
            adds[key]  = fran1;
          });

          return {
            type,
            created:     ts,
            status:      "complete",
            roster_ids:  [fran1, fran2].filter(Boolean),
            adds,
            drops,
            draft_picks: [],
            settings:    {},
            comments:    tx.comments || "",
            _mflType:    tx.type,
            _mflFran1:   fran1,
            _mflFran2:   fran2,
          };

        } else {
          // ── WAIVER / BBID_WAIVER / FREE_AGENT ──────────────────────
          const franchId = (tx.franchise || "").trim();
          const { addedPids, droppedPid, faab } = parseTransactionField(tx.transaction);

          addedPids.forEach(pid => { adds[mflPid(pid)] = franchId; });
          if (droppedPid) drops[mflPid(droppedPid)] = franchId;

          // FAAB: use parsed pipe amount for BBID_WAIVER; fall back to tx.bid attribute.
          const faabAmt = faab != null ? Number(faab)
                        : tx.bid      ? Number(tx.bid)
                        : undefined;

          return {
            type,
            created:    ts,
            status:     "complete",
            roster_ids: [franchId],
            adds,
            drops,
            draft_picks: [],
            settings:   { waiver_bid: faabAmt != null && !isNaN(faabAmt) ? faabAmt : undefined },
            comments:   "",
            _mflType:   tx.type,
          };
        }
      }).sort((a,b) => b.created - a.created);

    _renderView(el);
  }

  // ── Yahoo transactions ─────────────────────────────────────
  async function _loadYahooData(tok) {
    const el  = document.getElementById("dtab-transactions");
    const key = _leagueKey || `nfl.l.${_leagueId}`;

    // Load DynastyProcess mappings first so yahoo_id → sleeper player lookup works
    await DLRPlayers.load();
    if (tok !== _token) return;

    const bundle = await YahooAPI.getLeagueBundle(key);
    if (tok !== _token) return;

    const teams = bundle.teams || [];
    const teamMap = {};
    teams.forEach(t => { teamMap[String(t.id)] = t.name || `Team ${t.id}`; });

    _rosters = teams.map(t => ({
      roster_id: t.id,
      teamName:  t.name || `Team ${t.id}`,
      username:  ""
    })).sort((a,b) => a.teamName.localeCompare(b.teamName));

    const txArr = bundle.transactions || [];
    if (!txArr.length) {
      el.innerHTML = `<div class="tx-empty">No transaction data available for this Yahoo league.</div>`;
      return;
    }

    const YAHOO_TYPE_MAP = { "add": "free_agent", "drop": "free_agent", "trade": "trade", "waiver": "waiver" };

    _allTx = txArr.map(tx => {
      const type   = YAHOO_TYPE_MAP[tx.type] || "free_agent";
      const teamId = String(tx.teamId || "");
      const ts     = Number(tx.timestamp || 0) * 1000;
      const adds = {}, drops = {};

      // Use moves[] (structured player data with bare numeric pid) if available,
      // otherwise fall back to parsing the description string.
      const moves = tx.moves || [];
      if (moves.length) {
        moves.forEach(m => {
          const prefixedId = `yahoo_${m.pid}`;
          // Populate _players via DynastyProcess CSV if not already present
          if (!_players[prefixedId] && m.pid) {
            const map = DLRPlayers.getByYahooId(m.pid);
            if (map) {
              const sleeperP = map.sleeper_id ? DLRPlayers.get(map.sleeper_id) : null;
              if (sleeperP && Object.keys(sleeperP).length > 5) {
                _players[prefixedId] = sleeperP;
              } else {
                const parts = (map.name || "").trim().split(" ");
                _players[prefixedId] = {
                  first_name: parts.slice(0, -1).join(" ") || map.name || "",
                  last_name:  parts.slice(-1)[0] || "",
                  position: map.position || "?",
                  fantasy_positions: [map.position || "?"]
                };
              }
            } else if (m.name) {
              // Not in CSV — use the name from the transaction itself
              const parts = m.name.trim().split(" ");
              _players[prefixedId] = {
                first_name: parts.slice(0, -1).join(" ") || m.name,
                last_name:  parts.slice(-1)[0] || "",
                position: "?", fantasy_positions: ["?"]
              };
            }
          }
          const destId = m.destTeamId ? String(m.destTeamId) : teamId;
          if (m.action === "add")  adds[prefixedId]  = destId;
          if (m.action === "drop") drops[prefixedId] = teamId;
          if (m.action === "trade" || (!m.action && m.destTeamId)) {
            adds[prefixedId] = destId;
          }
        });
      } else if (tx.description) {
        // Legacy: description like "+Patrick Mahomes, -Dak Prescott"
        tx.description.split(",").forEach(part => {
          const p = part.trim();
          const name = p.slice(1).trim();
          const synId = `yahoo_name_${name.replace(/\s+/g, "_")}`;
          if (!_players[synId] && name) {
            const parts = name.split(" ");
            _players[synId] = {
              first_name: parts.slice(0,-1).join(" ") || name,
              last_name:  parts.slice(-1)[0] || "",
              position: "?", fantasy_positions: ["?"]
            };
          }
          if (p.startsWith("+")) adds[synId]  = teamId;
          if (p.startsWith("-")) drops[synId] = teamId;
          if (p.startsWith("~")) adds[synId]  = teamId;
        });
      }

      return { type, created: ts, status: "complete", roster_ids: [teamId], adds, drops, draft_picks: [], settings: {} };
    }).sort((a,b) => b.created - a.created);

    _renderView(el);
  }

  function _teamName(rosterId) {
    return _rosters.find(r => String(r.roster_id) === String(rosterId))?.teamName || `Team ${rosterId}`;
  }

  // ── Public filter setters ─────────────────────────────────
  function setType(t) {
    _typeFilter = t;
    _renderView();
  }

  function setTeam(t) {
    _teamFilter = t;
    _renderView();
  }

  function _loadHTML(msg) {
    return `<div class="detail-loading"><div class="spinner"></div><span>${msg}</span></div>`;
  }

  function _esc(s) {
    return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  return { init, setType, setTeam };
})();
