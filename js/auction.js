// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Auction / FAAB System
//  Views: Live | Free Agents | Teams | Settings | History
//  Stored: gmd/auctions/{leagueKey}/
//  Live updates via Firebase SDK
// ─────────────────────────────────────────────────────────

const DLRAuction = (() => {

  // ── Constants ─────────────────────────────────────────────
  // MIN_BID and MIN_INC are dynamic functions defined after _settings below

  // ── State ──────────────────────────────────────────────────
  let _leagueKey    = null;
  let _leagueId     = null;
  let _platform     = "sleeper";
  let _isCommish    = false;
  let _myRosterId   = null;
  let _sleeperUserId = null;
  let _franchiseId  = null;   // salary storage key
  let _myTeamName   = "My Team";
  let _rosterData   = [];
  let _auctions     = [];
  let _players      = {};
  const DEFAULT_MIN_BID  = 100_000;   // $100K floor
  const DEFAULT_MIN_INC  = 100_000;   // $100K minimum increment
  let _settings = { pauseStart:0, pauseEnd:8, maxNoms:2, bidDuration:8, maxRosterSize:30, minBid:100_000, minIncrement:100_000 };

  // Dynamic getters so settings changes take effect immediately
  const MIN_BID = () => _settings.minBid     || DEFAULT_MIN_BID;
  const MIN_INC = () => _settings.minIncrement || DEFAULT_MIN_INC;
  let _initToken    = 0;
  let _unsubFn      = null;
  let _timerInterval = null;
  let _viewMode     = "live";
  let _posFilter    = "ALL";
  let _teamFilter   = "";
  let _capLoadTriggered = false;
  let _capSettings  = null;

  // ── Firebase refs ──────────────────────────────────────────
  const _listRef     = () => GMD.child(`auctions/${_leagueKey}/bids`);
  const _auctRef     = (id) => GMD.child(`auctions/${_leagueKey}/bids/${id}`);
  const _settingsRef = () => GMD.child(`auctions/${_leagueKey}/settings`);

  // ── Pre-init: load state so canNominate/isRostered work on all tabs ──
  async function preInit(leagueKey, leagueId, isCommish, myRosterId, myTeamName, platform, sleeperUserId, franchiseId) {
    if (_leagueKey === leagueKey && _rosterData.length && _myRosterId) return;

    _leagueKey     = leagueKey;
    _leagueId      = leagueId;
    _platform      = platform || "sleeper";
    _isCommish     = !!isCommish;
    _myRosterId    = myRosterId != null ? Number(myRosterId) : null;
    _myTeamName    = myTeamName || "My Team";
    _sleeperUserId = sleeperUserId || null;
    _franchiseId   = franchiseId  || leagueKey;

    // Load settings silently
    try {
      const snap = await _settingsRef().once("value");
      if (snap.val()) _settings = { ..._settings, ...snap.val() };
    } catch(e) {}

    // Load roster data for isRostered() and canNominate()
    if (leagueId && _platform === "sleeper") {
      try {
        const [rosters, users] = await Promise.all([
          SleeperAPI.getRosters(leagueId),
          SleeperAPI.getLeagueUsers(leagueId)
        ]);
        const userMap = {};
        (users||[]).forEach(u => { userMap[u.user_id] = u; });
        _rosterData = (rosters||[]).map(r => {
          const u = userMap[r.owner_id] || {};
          return {
            roster_id:  r.roster_id,
            ownerId:    r.owner_id,                              // Sleeper user_id for cap lookup
            username:   (u.username||"").toLowerCase(),
            teamName:   u.metadata?.team_name || u.display_name || `Team ${r.roster_id}`,
            players:    r.players  || [],
            reserve:    r.reserve  || [],
            taxi:       r.taxi     || [],
            wins:       r.settings?.wins   || 0,
            losses:     r.settings?.losses || 0,
            co_owners:  r.co_owners || []
          };
        });

        // Resolve _myRosterId using Sleeper owner_id (not Firebase uid)
        if (!_myRosterId && _sleeperUserId) {
          const sid = String(_sleeperUserId);
          const primary = rosters.find(r => String(r.owner_id) === sid);
          if (primary) {
            _myRosterId = primary.roster_id;
          } else {
            const co = rosters.find(r => (r.co_owners||[]).map(String).includes(sid));
            if (co) _myRosterId = co.roster_id;
          }
        }
      } catch(e) { console.warn("[Auction] preInit roster load failed:", e.message); }

      // Pull cap data from salary module if available
      const capData = (typeof DLRSalaryCap !== "undefined") ? DLRSalaryCap.getCapData?.() : null;
      if (capData) {
        _rosterData.forEach(t => {
          const d = capData[t.username];
          if (d) { t.remainingCap = d.remaining; t.capSpent = d.spent; t.capTotal = d.cap; }
        });
      }
    }

    // Subscribe to live auctions for nom count — also refreshes FA tab on change
    try {
      _unsubFn?.();
      const onVal = snap => {
        const d = snap.val() || {};
        _auctions = Object.values(d).filter(Boolean).map(a => ({
          ...a,
          nominatedBy: a.nominatedBy != null ? Number(a.nominatedBy) : null,
          bids: Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{})
        }));
        // Re-render FA tab if it's currently visible so nominate buttons stay current
        if (typeof DLRFreeAgents !== "undefined" && DLRFreeAgents.refresh) {
          DLRFreeAgents.refresh();
        }
      };
      _listRef().on("value", onVal);
      _unsubFn = () => _listRef().off("value", onVal);
    } catch(e) {}
  }

  // ── Init ──────────────────────────────────────────────────
  async function init(leagueKey, leagueId, isCommish, myRosterId, myTeamName, platform, sleeperUserId, franchiseId) {
    _leagueKey      = leagueKey;
    _leagueId       = leagueId;
    _platform       = platform || "sleeper";
    _isCommish      = !!isCommish;
    _myRosterId     = myRosterId != null ? Number(myRosterId) : null;
    _myTeamName     = myTeamName || "My Team";
    _sleeperUserId  = sleeperUserId || null;
    _franchiseId    = franchiseId  || leagueKey;
    _viewMode       = "live";
    _capLoadTriggered = false;
    _capSettings = null;
    _initToken++;
    const token  = _initToken;

    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    _unsubFn?.();
    _unsubFn = null;

    const el = document.getElementById("dtab-auction");
    if (!el) return;
    el.innerHTML = _loadHTML("Loading auction board…");

    // Load players
    _players = DLRPlayers.all();
    if (Object.keys(_players).length < 100) _players = await DLRPlayers.load();
    if (token !== _initToken) return;

    // Load settings
    try {
      const snap = await _settingsRef().once("value");
      if (snap.val()) _settings = { ..._settings, ...snap.val() };
    } catch(e) {}

    // Load roster/team data — Sleeper only (MFL uses different IDs)
    if (_leagueId && _platform === "sleeper") {
      try {
        const [rosters, users] = await Promise.all([
          SleeperAPI.getRosters(_leagueId),
          SleeperAPI.getLeagueUsers(_leagueId)
        ]);
        const userMap = {};
        (users||[]).forEach(u => { userMap[u.user_id] = u; });
        _rosterData = (rosters||[]).map(r => {
          const u = userMap[r.owner_id] || {};
          return {
            roster_id:  r.roster_id,
            ownerId:    r.owner_id,
            username:   (u.username||"").toLowerCase(),
            teamName:   u.metadata?.team_name || u.display_name || `Team ${r.roster_id}`,
            players:    r.players  || [],
            reserve:    r.reserve  || [],
            taxi:       r.taxi     || [],
            wins:       r.settings?.wins   || 0,
            losses:     r.settings?.losses || 0,
            co_owners:  r.co_owners || [],
            faab:       r.settings?.waiver_budget_used != null
                          ? Math.max(0, (r.settings.waiver_budget || 1000) - (r.settings.waiver_budget_used || 0)) * 1_000_000
                          : null
          };
        });

        // Resolve _myRosterId using Sleeper owner_id (not Firebase uid)
        if (!_myRosterId && _sleeperUserId) {
          const sid = String(_sleeperUserId);
          const primary = rosters.find(r => String(r.owner_id) === sid);
          if (primary) {
            _myRosterId = primary.roster_id;
          } else {
            const co = rosters.find(r => (r.co_owners||[]).map(String).includes(sid));
            if (co) _myRosterId = co.roster_id;
          }
        }

        // Also pull remaining cap from DLRSalaryCap if the module has data
        if (typeof DLRSalaryCap !== "undefined") {
          const capData = DLRSalaryCap.getCapData?.();
          if (capData) {
            _rosterData.forEach(team => {
              const remaining = capData[team.username]?.remaining;
              if (remaining != null) team.remainingCap = remaining;
            });
          }
        }
      } catch(e) {}
    }
    if (token !== _initToken) return;

    // Render immediately, then subscribe
    _auctions = [];
    _render();

    // Live subscription
    const onVal = snap => {
      if (token !== _initToken) return;
      const d = snap.val() || {};
      _auctions = Object.values(d).filter(Boolean).map(a => ({
        ...a,
        // Normalize to integers so comparisons always work regardless of Firebase type
        nominatedBy: a.nominatedBy != null ? Number(a.nominatedBy) : null,
        bids: Array.isArray(a.bids) ? a.bids : Object.values(a.bids || {})
      }));
      _render();
    };
    const onErr = err => {
      const el2 = document.getElementById("dtab-auction");
      if (el2) el2.innerHTML = `<div class="auc-error">
        ⚠️ Cannot connect to auction board.<br>
        <span style="font-size:.8rem;color:var(--color-text-dim)">
          Check Firebase rules for <code>gmd/auctions/</code><br>
          Error: ${err.message}
        </span>
      </div>`;
    };
    _listRef().on("value", onVal, onErr);
    _unsubFn = () => _listRef().off("value", onVal);

    _timerInterval = setInterval(() => {
      if (_viewMode === "live") _renderView();
    }, 30_000);
  }

  function reset() {
    _unsubFn?.();
    _unsubFn = null;
    _capLoadTriggered = false;
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    _leagueKey = null;
    _auctions  = [];
    _initToken++;
  }

  // ── Time helpers ──────────────────────────────────────────
  function _isNightPause(now = Date.now()) {
    const ct   = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const h    = ct.getHours();
    return h >= _settings.pauseStart && h < _settings.pauseEnd;
  }

  function _bidDurationMs() { return (_settings.bidDuration || 8) * 3_600_000; }

  function _nextExpiry(now = Date.now()) {
    // If auction has a scheduled start in the future, use that as the base
    const base = (_settings.scheduledStart && _settings.scheduledStart > now)
      ? _settings.scheduledStart
      : now;
    if (_isNightPause(base)) {
      const ct     = new Date(new Date(base).toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const resume = new Date(ct);
      resume.setHours(_settings.pauseEnd, 0, 0, 0);
      if (resume <= ct) resume.setDate(resume.getDate() + 1);
      return +resume + _bidDurationMs();
    }
    return base + _bidDurationMs();
  }

  function _timeLeft(a, now = Date.now()) {
    if (!a || a.cancelled || a.processed) return 0;
    return Math.max(0, a.expiresAt - now);
  }

  function _fmtTime(ms) {
    if (ms <= 0) return "Expired";
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    if (h >= 1) return `${h}h ${m}m`;
    return `${m}m ${s}s`;
  }

  // ── Proxy bid computation ─────────────────────────────────
  // Core proxy logic — works with flat proxies map {rosterId: maxBid}
  // Falls back to bids array for backward compat with older auctions
  function _computeLeader(a) {
    // Prefer flat proxies map (new structure)
    const proxies = a.proxies || {};
    let entries = Object.entries(proxies).map(([id, maxBid]) => ({ rosterId: Number(id), maxBid: Number(maxBid) }));

    // Fall back to bids array for old auctions
    if (!entries.length && a.bids) {
      const bids = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
      const maxByRoster = {};
      bids.forEach(b => {
        const rid = Number(b.rosterId);
        if (!maxByRoster[rid] || b.maxBid > maxByRoster[rid]) maxByRoster[rid] = b.maxBid;
      });
      entries = Object.entries(maxByRoster).map(([id, maxBid]) => ({ rosterId: Number(id), maxBid }));
    }

    if (!entries.length) return { rosterId: null, displayBid: MIN_BID() };
    entries.sort((a, b) => b.maxBid - a.maxBid);

    if (entries.length === 1) {
      // Single bidder — show MIN_BID, proxy stays hidden
      return { rosterId: entries[0].rosterId, displayBid: MIN_BID() };
    }
    // Proxy: winner pays one increment above second-highest
    return {
      rosterId:   entries[0].rosterId,
      displayBid: Math.min(entries[0].maxBid, entries[1].maxBid + MIN_INC())
    };
  }

  function _myMaxBid(a) {
    // Check flat proxies first
    if (a.proxies && a.proxies[String(_myRosterId)] !== undefined)
      return Number(a.proxies[String(_myRosterId)]);
    if (a.proxies && a.proxies[Number(_myRosterId)] !== undefined)
      return Number(a.proxies[Number(_myRosterId)]);
    // Fall back to bids array
    const bids = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
    const mine = bids.filter(b => Number(b.rosterId) === Number(_myRosterId));
    return mine.length ? Math.max(...mine.map(b => b.maxBid)) : 0;
  }

  function _myActiveNoms() {
    const now = Date.now();
    if (!_myRosterId) return 0;
    const myId = Number(_myRosterId);
    const active = _auctions.filter(a =>
      !a.cancelled && !a.processed && a.expiresAt > now &&
      Number(a.nominatedBy) === myId
    );
    return active.length;
  }

  // Returns how many open active roster spots the current user has,
  // accounting for current active roster size AND auctions they are currently winning.
  // IR and Taxi don't count toward the active roster limit.
  function _myOpenSpots() {
    if (!_myRosterId) return 0;
    const maxRoster = _settings.maxRosterSize || 25;
    const myTeam    = _rosterData.find(r => Number(r.roster_id) === Number(_myRosterId));
    if (!myTeam) return 0;

    // Active roster = players minus IR and taxi
    const irSet   = new Set(myTeam.reserve || []);
    const taxiSet = new Set(myTeam.taxi    || []);
    const activeRosterCount = (myTeam.players || [])
      .filter(pid => !irSet.has(pid) && !taxiSet.has(pid)).length;

    // Auctions currently winning (would add to active roster if won)
    const now = Date.now();
    const winningCount = _auctions.filter(a => {
      if (a.cancelled || a.processed || a.expiresAt <= now) return false;
      const leader = _computeLeader(a);
      return Number(leader.rosterId) === Number(_myRosterId);
    }).length;

    return Math.max(0, maxRoster - activeRosterCount - winningCount);
  }

  function _myHasPassed(a) {
    if (!_myRosterId || !a.passes) return false;
    return !!a.passes[String(_myRosterId)];
  }

  // ── Pass refs ─────────────────────────────────────────────
  const _passRef = (id) => GMD.child(`auctions/${_leagueKey}/bids/${id}/passes`);

  // ── Pass logic (matches SleeperBid exactly) ───────────────
  async function passAuction(auctionId, playerName) {
    if (!_myRosterId) return;
    try {
      // Remove this team's proxy bid and record their pass atomically
      await _auctRef(auctionId).transaction(cur => {
        if (!cur || cur.cancelled || cur.processed) return;
        // Record pass
        cur.passes = cur.passes || {};
        cur.passes[String(_myRosterId)] = Date.now();
        // Remove proxy if they had one
        if (cur.proxies) {
          delete cur.proxies[String(Number(_myRosterId))];
          cur.bidCount = Object.keys(cur.proxies).length;
        }
        return cur;
      });

      // Read back to check if all eligible teams have passed
      const snap    = await _auctRef(auctionId).once("value");
      const auction = snap.val();
      if (!auction || auction.cancelled || auction.processed) return;

      const passes       = Object.keys(auction.passes || {});
      const allRosterIds = _rosterData.map(r => String(r.roster_id));

      // mustPass = every team except the nominator must either have an active proxy OR have passed
      const proxies   = auction.proxies || {};
      const mustPass  = allRosterIds.filter(id => id !== String(auction.nominatedBy));
      const allDone   = mustPass.every(id => passes.includes(id) || proxies[id] !== undefined);

      if (allDone && mustPass.length > 0) {
        await _auctRef(auctionId).update({ expiresAt: Date.now() - 1, autoClosedByPasses: true });
        showToast(`All teams resolved — ${playerName} auction closing.`);
      } else {
        const remaining = mustPass.filter(id => !passes.includes(id) && proxies[id] === undefined).length;
        showToast(`Passed on ${playerName}. ${remaining} team${remaining !== 1 ? "s" : ""} yet to act.`);
      }
    } catch(e) {
      showToast("Pass failed: " + e.message, "error");
    }
  }

  // ── Rostered player set ───────────────────────────────────
  function _rosteredSet() {
    const s = new Set();
    _rosterData.forEach(t => {
      [...t.players, ...t.reserve, ...t.taxi].forEach(id => s.add(id));
    });
    return s;
  }

  function isRostered(playerId) {
    if (!playerId) return false;
    return _rosteredSet().has(String(playerId));
  }

  function _alreadyNominated() {
    const now = Date.now();
    return new Set(_auctions
      .filter(a => !a.cancelled && !a.processed && a.expiresAt > now)
      .map(a => a.playerId));
  }

  // ── Main render ───────────────────────────────────────────
  function _render() {
    const el = document.getElementById("dtab-auction");
    if (!el) return;

    const now    = Date.now();
    const live   = _auctions.filter(a => !a.cancelled && !a.processed && a.expiresAt > now);
    const ended  = _auctions.filter(a =>  a.cancelled ||  a.processed || a.expiresAt <= now);

    const maxNoms = _settings.maxNoms || 2;
    const myNoms  = _myActiveNoms();
    const canNom  = canNominate(); // uses cap check too

    el.innerHTML = `
      <div class="auc-toolbar">
        <div class="auc-tabs">
          <button class="auc-tab ${_viewMode==="live"      ? "auc-tab--active":""}" onclick="DLRAuction.setView('live')">
            Live ${live.length > 0 ? `<span class="auc-badge">${live.length}</span>` : ""}
          </button>
          <button class="auc-tab ${_viewMode==="teams"     ? "auc-tab--active":""}" onclick="DLRAuction.setView('teams')">Teams</button>
          <button class="auc-tab ${_viewMode==="history"   ? "auc-tab--active":""}" onclick="DLRAuction.setView('history')">History</button>
          ${_isCommish ? `<button class="auc-tab ${_viewMode==="settings" ? "auc-tab--active":""}" onclick="DLRAuction.setView('settings')">⚙ Settings</button>` : ""}
        </div>
        <div class="auc-status-bar">
          ${_isNightPause() ? `<span class="auc-pause-badge">🌙 Paused (${_settings.pauseStart}–${_settings.pauseEnd}am CT)</span>` : ""}
          ${_settings.scheduledStart && _settings.scheduledStart > Date.now()
            ? `<span class="auc-pause-badge" style="background:rgba(0,212,255,.08);border-color:rgba(0,212,255,.25);color:#00d4ff">
                📅 Starts ${new Date(_settings.scheduledStart).toLocaleDateString()} ${new Date(_settings.scheduledStart).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
               </span>` : ""}
          <span class="auc-nom-info">Nominations: ${myNoms}/${maxNoms}</span>
        </div>
      </div>
      <div id="auc-content"></div>`;

    _renderView(live, ended, canNom);
  }

  function setView(mode) {
    _viewMode = mode;
    const now   = Date.now();
    const live  = _auctions.filter(a => !a.cancelled && !a.processed && a.expiresAt > now);
    const ended = _auctions.filter(a =>  a.cancelled ||  a.processed || a.expiresAt <= now);
    document.querySelectorAll(".auc-tab").forEach(t =>
      t.classList.toggle("auc-tab--active", (t.getAttribute("onclick")||"").includes(`'${mode}'`))
    );
    _renderView(live, ended, canNominate());
  }

  function _renderView(live, ended, canNom) {
    // Recompute if not passed
    if (!live) {
      const now = Date.now();
      live  = _auctions.filter(a => !a.cancelled && !a.processed && a.expiresAt > now);
      ended = _auctions.filter(a =>  a.cancelled ||  a.processed || a.expiresAt <= now);
      canNom = _myActiveNoms() < (_settings.maxNoms || 2);
    }
    const el = document.getElementById("auc-content");
    if (!el) return;
    if (_viewMode === "live")     _renderLive(el, live);
    if (_viewMode === "fa")       _renderFreeAgents(el, canNom);
    if (_viewMode === "teams")    _renderTeams(el);
    if (_viewMode === "history")  _renderHistory(el, ended);
    if (_viewMode === "settings") _renderSettings(el);
  }

  // ── Live auctions ──────────────────────────────────────────
  function _renderLive(el, live) {
    if (!live.length) {
      el.innerHTML = `<div class="auc-empty">
        <div style="font-size:2.5rem;margin-bottom:var(--space-3)">🏷</div>
        <div style="font-weight:700;margin-bottom:var(--space-2)">No active auctions</div>
        <div class="dim" style="font-size:.85rem">Go to Free Agents to nominate a player.</div>
      </div>`;
      return;
    }
    el.innerHTML = live.sort((a, b) => a.expiresAt - b.expiresAt)
      .map(a => _auctionCard(a)).join("");
  }

  function _auctionCard(a) {
    const now     = Date.now();
    const left    = _timeLeft(a, now);
    const urgent  = left < 3_600_000;
    const leader  = _computeLeader(a);
    const p       = _players[a.playerId] || {};
    const name    = p.first_name ? `${p.first_name} ${p.last_name}` : (a.playerName || a.playerId);
    const pos     = (p.fantasy_positions?.[0] || p.position || "?").toUpperCase();
    const posClr  = { QB:"#b89ffe",RB:"#18e07a",WR:"#00d4ff",TE:"#ffc94d" }[pos] || "#9ca3af";
    const nomTeam = _rosterData.find(r => Number(r.roster_id) === Number(a.nominatedBy))?.teamName || `Team ${a.nominatedBy}`;
    const leadTeam= leader.rosterId ? (_rosterData.find(r => Number(r.roster_id) === Number(leader.rosterId))?.teamName || `#${leader.rosterId}`) : "No bids";
    const myBid   = _myMaxBid(a);
    const winning = Number(leader.rosterId) === Number(_myRosterId);
    const uniqueBidders = a.proxies ? Object.keys(a.proxies).length : (a.bidCount || 1);

    return `
      <div class="auc-card ${winning ? "auc-card--winning" : ""}">
        <!-- Compact header: pos badge + name + timer all in one row -->
        <div class="auc-card-header">
          <span class="auc-pos-pill" style="background:${posClr}22;color:${posClr};border-color:${posClr}55">${pos}</span>
          <div class="auc-card-info">
            <div class="auc-player-name">${_esc(name)}</div>
            <div class="auc-nom-line dim">Nom: ${_esc(nomTeam)}</div>
          </div>
          <div class="auc-timer ${urgent ? "auc-timer--urgent" : ""}">
            <div class="auc-time-val">${_fmtTime(left)}</div>
            <div class="auc-time-lbl dim">${uniqueBidders} bid${uniqueBidders !== 1 ? "s" : ""}</div>
          </div>
          <button class="auc-history-btn" onclick="event.stopPropagation();DLRAuction.showBidHistory('${a.id}')" title="Bid history">📜</button>
        </div>
        <!-- Leader row -->
        <div class="auc-lead-row">
          <span class="auc-lead-label dim">Leader:</span>
          <span class="auc-lead-team ${winning ? "auc-lead-team--mine" : ""}">${_esc(leadTeam)}</span>
          <span class="auc-lead-price">${_fmtSal(leader.displayBid)}</span>
        </div>
        <!-- Single-line actions row -->
        <div class="auc-actions">
          <input type="number" id="bid-${a.id}" class="auc-bid-input"
            value="${myBid || ""}" placeholder="Max bid" step="${MIN_INC()}" min="${MIN_BID()}"/>
          ${(() => {
            const noSpots = !winning && _myOpenSpots() <= 0;
            return noSpots
              ? `<button class="btn-secondary btn-sm" disabled title="Roster full" style="opacity:.4">Bid</button>`
              : `<button class="btn-primary btn-sm" onclick="DLRAuction.placeBid('${a.id}','${_escA(name)}')">${myBid > 0 ? "Update" : "Bid"}</button>`;
          })()}
          ${_myHasPassed(a)
            ? `<span class="auc-passed-badge">✓ Passed</span>`
            : `<button class="auc-pass-btn btn-secondary btn-sm" onclick="DLRAuction.passAuction('${a.id}','${_escA(name)}')">Pass</button>`}
          ${_isCommish ? `
            <button class="btn-secondary btn-sm" onclick="DLRAuction.claimAuction('${a.id}','${_escA(name)}')">✓</button>
            <button class="btn-secondary btn-sm" style="color:var(--color-red)" onclick="DLRAuction.cancelAuction('${a.id}','${_escA(name)}')">✕</button>` : ""}
        </div>
      </div>`;
  }

  // ── Free Agents tab ───────────────────────────────────────
  function _renderFreeAgents(el, canNom) {
    const rostered  = _rosteredSet();
    const nominated = _alreadyNominated();

    const allFA = Object.entries(_players)
      .filter(([pid, p]) => {
        if (rostered.has(pid)) return false;
        const pos = (p.fantasy_positions?.[0] || p.position || "").toUpperCase();
        if (!["QB","RB","WR","TE"].includes(pos)) return false;
        return p.team && p.team !== "FA" && p.team !== "" && p.active !== false;
      })
      .map(([pid, p]) => ({
        pid,
        name:  `${p.first_name} ${p.last_name}`,
        pos:   (p.fantasy_positions?.[0] || p.position || "?").toUpperCase(),
        team:  p.team || "FA",
        rank:  p.search_rank || 9999,
        age:   p.age  || null,
        nominated: nominated.has(pid)
      }))
      .sort((a, b) => a.rank - b.rank);

    const positions = ["ALL", "QB", "RB", "WR", "TE"];
    const nflTeams  = [...new Set(allFA.map(p => p.team).filter(Boolean))].sort();

    const filtered = allFA.filter(p =>
      (_posFilter === "ALL" || p.pos === _posFilter) &&
      (!_teamFilter || p.team === _teamFilter)
    );

    el.innerHTML = `
      <div class="auc-fa-toolbar">
        <div class="auc-fa-filters">
          <div class="auc-pos-pills">
            ${positions.map(pos => `
              <button class="auc-pos-btn ${_posFilter === pos ? "auc-pos-btn--active" : ""}"
                onclick="DLRAuction.setPos('${pos}')">${pos}</button>
            `).join("")}
          </div>
          <select class="auc-team-select" onchange="DLRAuction.setTeamFilter(this.value)">
            <option value="">All NFL Teams</option>
            ${nflTeams.map(t => `<option value="${t}" ${_teamFilter === t ? "selected" : ""}>${t}</option>`).join("")}
          </select>
        </div>
        <div class="dim" style="font-size:.78rem">${filtered.length} available</div>
      </div>
      ${!canNom ? `<div class="auc-nom-limit">⚠️ ${_myActiveNoms() >= (_settings.maxNoms||2) ? `Max ${_settings.maxNoms||2} active nominations reached.` : "Insufficient cap space to nominate."}</div>` : ""}
      <div class="auc-fa-list">
        ${filtered.slice(0, 60).map((p, i) => {
          const color = { QB:"#b89ffe",RB:"#18e07a",WR:"#00d4ff",TE:"#ffc94d" }[p.pos] || "#9ca3af";
          return `
            <div class="auc-fa-row">
              <div class="auc-fa-rank dim">${i+1}</div>
              <img class="auc-fa-photo" src="https://sleepercdn.com/content/nfl/players/thumb/${p.pid}.jpg" onerror="this.style.display='none'" loading="lazy"/>
              <span class="auc-pos-pill" style="background:${color}22;color:${color};border-color:${color}55">${p.pos}</span>
              <div class="auc-fa-info">
                <div class="auc-player-name">${_esc(p.name)}</div>
                <div class="dim" style="font-size:.72rem">${p.team}${p.age ? ` · Age ${p.age}` : ""}</div>
              </div>
              ${p.nominated
                ? `<span class="auc-already-nom">Active bid</span>`
                : canNom
                  ? `<button class="btn-primary btn-sm" onclick="DLRAuction.openNominate('${p.pid}','${_escA(p.name)}','${p.pos}','${p.team}')">Nominate</button>`
                  : `<button class="btn-secondary btn-sm" disabled title="${_myActiveNoms() >= (_settings.maxNoms||2) ? "Max nominations reached" : "Insufficient cap"}">🚫</button>`
              }
            </div>`;
        }).join("")}
      </div>`;
  }

  function setPos(pos) {
    _posFilter = pos;
    _renderView();
  }

  function setTeamFilter(team) {
    _teamFilter = team;
    _renderView();
  }

  // ── Nominate modal ────────────────────────────────────────
  function openNominate(pid, name, pos, nflTeam) {
    // Block if already in an active auction
    const alreadyActive = _auctions.some(a =>
      !a.cancelled && !a.processed && a.expiresAt > Date.now() &&
      String(a.playerId) === String(pid)
    );
    if (alreadyActive) {
      showToast(`${name} is already in an active auction.`, "error");
      return;
    }

    document.getElementById("auc-nom-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "auc-nom-modal";
    modal.className = "modal-overlay";
    modal.style.zIndex = "850";
    const color = { QB:"#b89ffe",RB:"#18e07a",WR:"#00d4ff",TE:"#ffc94d" }[pos] || "#9ca3af";

    // Commish can nominate on behalf of any team
    const teamSelector = _isCommish ? `
      <div class="form-group">
        <label>Nominating Team</label>
        <select id="auc-nom-team">
          ${_rosterData.map(t =>
            `<option value="${t.roster_id}" ${Number(t.roster_id) === Number(_myRosterId) ? "selected" : ""}>${_esc(t.teamName)}</option>`
          ).join("")}
        </select>
        <span class="field-hint">As commissioner you can nominate on behalf of any team.</span>
      </div>` : `<input type="hidden" id="auc-nom-team" value="${_myRosterId}"/>`;

    modal.innerHTML = `
      <div class="modal-box modal-box--sm">
        <div class="modal-header">
          <h3>Nominate Player</h3>
          <button class="modal-close" onclick="document.getElementById('auc-nom-modal').remove()">✕</button>
        </div>
        <div class="modal-body">
          <div class="auc-nom-player-preview">
            <img src="https://sleepercdn.com/content/nfl/players/${pid}.jpg" onerror="this.style.display='none'" style="width:48px;height:48px;border-radius:50%;object-fit:cover"/>
            <span class="auc-pos-pill" style="background:${color}22;color:${color};border-color:${color}55">${pos}</span>
            <div>
              <div style="font-weight:700">${_esc(name)}</div>
              <div class="dim" style="font-size:.78rem">${nflTeam}</div>
            </div>
          </div>
          ${teamSelector}
          <div class="form-group" style="margin-top:var(--space-4)">
            <label>Opening Max Bid</label>
            <input type="number" id="auc-nom-bid" value="${MIN_BID()}" step="${MIN_INC()}" min="${MIN_BID()}"/>
            <span class="field-hint">Your proxy max — you only pay $1 more than the next highest bid.</span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="document.getElementById('auc-nom-modal').remove()">Cancel</button>
          <button class="btn-primary" onclick="DLRAuction.submitNomination('${pid}','${_escA(name)}')">Start Auction</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
    document.getElementById("auc-nom-bid")?.focus();
  }

  async function submitNomination(pid, playerName) {
    const maxBid = parseInt(document.getElementById("auc-nom-bid")?.value) || MIN_BID();

    // Resolve nominating roster — commish select OR hidden input OR current user
    const teamEl = document.getElementById("auc-nom-team");
    const nomRosterId = teamEl ? parseInt(teamEl.value) : parseInt(_myRosterId);

    if (!nomRosterId || isNaN(nomRosterId)) {
      showToast("Could not determine nominating team. Please re-open the league.", "error");
      return;
    }

    // Hard check at submit time — catches stale UI where buttons weren't updated
    if (_settings.scheduledStart && _settings.scheduledStart > Date.now()) {
      const startStr = new Date(_settings.scheduledStart).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
      showToast(`Auction hasn't started yet. Opens ${startStr}.`, "error");
      document.getElementById("auc-nom-modal")?.remove();
      return;
    }
    // For commish nominating on behalf: check that specific team's nom count
    const nomTeamActiveNoms = _auctions.filter(a => {
      const now = Date.now();
      return !a.cancelled && !a.processed && a.expiresAt > now &&
             Number(a.nominatedBy) === nomRosterId;
    }).length;
    if (nomTeamActiveNoms >= (_settings.maxNoms || 2)) {
      showToast(`Max ${_settings.maxNoms || 2} active nominations reached for this team.`, "error");
      document.getElementById("auc-nom-modal")?.remove();
      if (typeof DLRFreeAgents !== "undefined" && DLRFreeAgents.refresh) DLRFreeAgents.refresh();
      return;
    }
    // Check roster space for the nominating team
    const nomTeamRoster = _rosterData.find(r => Number(r.roster_id) === nomRosterId);
    if (nomTeamRoster) {
      const maxRoster   = _settings.maxRosterSize || 25;
      const irSet       = new Set(nomTeamRoster.reserve || []);
      const taxiSet     = new Set(nomTeamRoster.taxi    || []);
      const activeCount = (nomTeamRoster.players || []).filter(pid => !irSet.has(pid) && !taxiSet.has(pid)).length;
      const winningCount = _auctions.filter(a => {
        if (a.cancelled || a.processed || a.expiresAt <= Date.now()) return false;
        return Number(_computeLeader(a).rosterId) === nomRosterId;
      }).length;
      const openSpots = maxRoster - activeCount - winningCount;
      if (openSpots <= 0) {
        showToast(`No open roster spots — this team's active roster is full.`, "error");
        document.getElementById("auc-nom-modal")?.remove();
        return;
      }
    }

    // Block if player already has an active auction
    const alreadyActive = _auctions.some(a =>
      !a.cancelled && !a.processed && a.expiresAt > Date.now() &&
      String(a.playerId) === String(pid)
    );
    if (alreadyActive) {
      showToast(`${playerName} is already in an active auction. Teams can only bid on the current nomination.`, "error");
      document.getElementById("auc-nom-modal")?.remove();
      return;
    }

    const nomTeam = _rosterData.find(r => Number(r.roster_id) === nomRosterId);
    const nomName = nomTeam?.teamName || `Team ${nomRosterId}`;
    const btn        = document.querySelector("#auc-nom-modal .btn-primary");
    if (btn) { btn.textContent = "Starting…"; btn.disabled = true; }
    try {
      const id  = `auc_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
      const now = Date.now();
      await _auctRef(id).set({
        id, playerId: pid, playerName,
        nominatedBy:    nomRosterId,
        nominatorName:  nomName,
        nominatedByCommish: nomRosterId !== _myRosterId ? _myRosterId : null,
        startTime: now,
        expiresAt: _nextExpiry(now),
        proxies:  { [String(Number(nomRosterId))]: maxBid }, // flat map: {rosterId: proxyAmount}
        bidCount: 1,
        processed: false, cancelled: false
      });
      document.getElementById("auc-nom-modal")?.remove();
      showToast(`${playerName} nominated by ${nomName} ✓`);
      // Re-render FA list so nominate buttons update immediately
      if (typeof DLRFreeAgents !== "undefined" && DLRFreeAgents.refresh) {
        DLRFreeAgents.refresh();
      }
      setView("live");
    } catch(e) {
      if (btn) { btn.textContent = "Start Auction"; btn.disabled = false; }
      showToast("Nomination failed: " + e.message, "error");
    }
  }

  // ── Teams tab ─────────────────────────────────────────────
  function _renderTeams(el) {
    const now       = Date.now();
    const active    = _auctions.filter(a => !a.cancelled && !a.processed && a.expiresAt > now);
    const maxRoster = _settings.maxRosterSize || 25;

    // Pull cap data from salary module
    const capData = (typeof DLRSalaryCap !== "undefined") ? DLRSalaryCap.getCapData?.() : null;
    if (capData && Object.keys(capData).length > 0) {
      // Cap data ready — apply to rosterData
      // salary module keys by username, falling back to user_id when username is blank
      _rosterData.forEach(t => {
        // Try username first, then ownerId (salary module falls back to user_id)
        const d = capData[t.username] || capData[t.ownerId] || capData[String(t.ownerId)];
        if (d) { t.remainingCap = d.remaining; t.capSpent = d.spent; t.capTotal = d.cap; }
      });
      _rosterData.forEach(t => {
        const d = capData[t.username];
        if (d) { t.remainingCap = d.remaining; t.capSpent = d.spent; t.capTotal = d.cap; }
      });
    } else if (_leagueKey && !_capLoadTriggered && typeof DLRSalaryCap !== "undefined") {
      _capLoadTriggered = true;
      DLRSalaryCap.preloadCap(_leagueKey, _leagueId, _franchiseId).then(() => {
        const d2 = DLRSalaryCap.getCapData?.();
        if (d2 && Object.keys(d2).length > 0) {
          _rosterData.forEach(t => {
            const d = d2[t.username] || d2[t.ownerId] || d2[String(t.ownerId)];
            if (d) { t.remainingCap = d.remaining; t.capSpent = d.spent; t.capTotal = d.cap; }
          });
        }
        _capLoadTriggered = false;
        const el2 = document.getElementById("auc-content");
        if (el2 && _viewMode === "teams") _renderTeams(el2);
      }).catch(() => { _capLoadTriggered = false; });
    }

    // Sort: my team first, then by available cap desc
    // Use display price for committed (not proxy) for fairness in sort
    const _committedDisplay = (rosterId) => active
      .filter(a => Number(_computeLeader(a).rosterId) === Number(rosterId))
      .reduce((sum, a) => sum + _computeLeader(a).displayBid, 0);

    const sorted = [..._rosterData].sort((a, b) => {
      if (Number(a.roster_id) === Number(_myRosterId)) return -1;
      if (Number(b.roster_id) === Number(_myRosterId)) return 1;
      const aAvail = (a.remainingCap ?? a.faab ?? 0) - _committedDisplay(a.roster_id);
      const bAvail = (b.remainingCap ?? b.faab ?? 0) - _committedDisplay(b.roster_id);
      return bAvail - aAvail;
    });

    el.innerHTML = `
      <div class="auc-teams-header">
        Max active roster: <strong>${maxRoster}</strong>
        ${_isCommish ? `<button class="btn-secondary btn-sm" onclick="DLRAuction.editRosterSize()">Edit</button>` : ""}
      </div>
      <div class="auc-teams-grid">
        ${sorted.map(t => {
          const isMe      = Number(t.roster_id) === Number(_myRosterId);
          const taxiSet   = new Set(t.taxi    || []);
          const irSet     = new Set(t.reserve || []);
          const active_   = (t.players||[]).filter(id => !taxiSet.has(id) && !irSet.has(id)).length;

          // Leading auctions (winning bids only)
          const leading = active.filter(a => {
            const l = _computeLeader(a);
            return Number(l.rosterId) === Number(t.roster_id);
          });

          // Committed = sum of amounts on auctions this team is WINNING only
          // Owner sees their proxy (maxBid), others see the display price
          const committed = leading.reduce((sum, a) => {
            const bids = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
            const isThisMe = Number(t.roster_id) === Number(_myRosterId);
            if (isThisMe) {
              // Show my own proxy bid
              const mine = bids.filter(b => Number(b.rosterId) === Number(t.roster_id));
              return sum + (mine.length ? Math.max(...mine.map(b => b.maxBid)) : 0);
            } else {
              // Show display price only (never expose proxy to others)
              return sum + _computeLeader(a).displayBid;
            }
          }, 0);
          const openSpots = Math.max(0, maxRoster - active_ - leading.length);
          const spotsColor = openSpots === 0 ? "var(--color-red)" : openSpots <= 2 ? "var(--color-gold)" : "var(--color-text)";

          // Cap
          const baseCap   = t.remainingCap ?? t.faab ?? null;
          const available = baseCap != null ? Math.max(0, baseCap - committed) : null;
          const maxBase   = Math.max(...sorted.map(x => x.remainingCap ?? x.faab ?? 0), 1);
          const barPct    = baseCap != null ? Math.round(baseCap / maxBase * 100) : 0;

          // DEBUG — remove once cap is confirmed working

          // My active bids
          const myBids = active.filter(a => {
            const bids = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
            return bids.some(b => Number(b.rosterId) === Number(t.roster_id));
          });

          return `
            <div class="auc-team-card ${isMe ? "auc-team-card--me" : ""}">
              <div class="auc-team-card-header">
                <div class="auc-team-card-name">${_esc(t.teamName)}</div>
                ${isMe ? `<span class="auc-you-badge">You</span>` : ""}
              </div>
              <div class="auc-team-stats-grid">
                <div class="auc-tstat">
                  <div class="auc-tstat-lbl">Balance</div>
                  <div class="auc-tstat-val" style="color:var(--color-green)">${baseCap != null ? _fmtSal(baseCap) : "—"}</div>
                </div>
                <div class="auc-tstat">
                  <div class="auc-tstat-lbl">Committed</div>
                  <div class="auc-tstat-val" style="color:${committed > 0 ? "var(--color-gold)" : "var(--color-text-dim)"}">${_fmtSal(committed)}</div>
                </div>
                <div class="auc-tstat">
                  <div class="auc-tstat-lbl">Available</div>
                  <div class="auc-tstat-val" style="color:var(--color-green)">${available != null ? _fmtSal(available) : "—"}</div>
                </div>
                <div class="auc-tstat">
                  <div class="auc-tstat-lbl">Active Bids</div>
                  <div class="auc-tstat-val" style="color:${myBids.length > 0 ? "var(--color-gold)" : "var(--color-text-dim)"}">${myBids.length}</div>
                </div>
                <div class="auc-tstat">
                  <div class="auc-tstat-lbl">Winning</div>
                  <div class="auc-tstat-val" style="color:${leading.length > 0 ? "var(--color-green)" : "var(--color-text-dim)"}">${leading.length}</div>
                </div>
                <div class="auc-tstat">
                  <div class="auc-tstat-lbl">Open Spots</div>
                  <div class="auc-tstat-val" style="color:${spotsColor}">${openSpots}</div>
                </div>
              </div>
              ${leading.length > 0 ? `
              <div class="auc-team-winning">
                Winning: ${leading.map(a => {
                  const pp = _players[a.playerId] || {};
                  const pname = pp.last_name || a.playerName || "?";
                  const price = _computeLeader(a).displayBid;
                  return `<span style="color:var(--color-green);font-weight:600">${_esc(pname)} ${_fmtSal(price)}</span>`;
                }).join(", ")}
              </div>` : ""}
              ${baseCap != null ? `
              <div class="auc-team-bar-bg">
                <div class="auc-team-bar-fill" style="width:${barPct}%"></div>
              </div>` : ""}
            </div>`;
        }).join("")}
      </div>`;
  }

  function _getCommitted(activeAuctions, rosterId) {
    return activeAuctions.reduce((sum, a) => {
      const bids = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
      const mine = bids.filter(b => Number(b.rosterId) === Number(rosterId));
      return sum + (mine.length ? Math.max(...mine.map(b => b.maxBid)) : 0);
    }, 0);
  }

  function toggleTeamDetail(rosterId) {
    const el = document.getElementById(`team-detail-${rosterId}`);
    if (!el) return;
    const isOpen = el.style.display !== "none";
    document.querySelectorAll("[id^='team-detail-']").forEach(d => { d.style.display = "none"; });
    if (isOpen) return;

    const team = _rosterData.find(r => r.roster_id === rosterId);
    if (!team) return;

    const now    = Date.now();
    const active = _auctions.filter(a => !a.cancelled && !a.processed && a.expiresAt > now);
    const won    = _auctions.filter(a => a.processed && a.winner === rosterId);

    // Active bids this team has placed
    const activeBids = active.filter(a => {
      const bs = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
      return bs.some(b => b.rosterId === rosterId);
    });

    // Players won this auction session
    const wonItems = won.map(a => {
      const p    = _players[a.playerId] || {};
      const name = p.first_name ? `${p.first_name} ${p.last_name}` : (a.playerName || a.playerId);
      const pos  = (p.fantasy_positions?.[0]||p.position||"?").toUpperCase();
      const clr  = {QB:"#b89ffe",RB:"#18e07a",WR:"#00d4ff",TE:"#ffc94d"}[pos]||"#9ca3af";
      const winningBid = a.winningBid ?? a.finalBid ?? 0;
      return `
        <div class="auc-won-row">
          <span class="auc-pos-dot" style="background:${clr}22;color:${clr};border-color:${clr}55">${pos}</span>
          <span class="auc-won-name">${_esc(name)}</span>
          <span class="auc-won-price">✓ ${_fmtSal(winningBid)}</span>
        </div>`;
    }).join("");

    // Active bids summary
    const bidItems = activeBids.map(a => {
      const p    = _players[a.playerId] || {};
      const name = p.first_name ? `${p.first_name} ${p.last_name}` : (a.playerName || a.playerId);
      const bs   = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
      const myMax = Math.max(...bs.filter(b => b.rosterId === rosterId).map(b => b.maxBid), 0);
      return `
        <div class="auc-won-row">
          <span style="flex:1">${_esc(name)}</span>
          <span style="color:var(--color-gold);font-weight:700">${_fmtSal(myMax)} max</span>
        </div>`;
    }).join("");

    el.style.display = "";
    el.innerHTML = `
      <div class="auc-team-detail-body">
        ${activeBids.length ? `
          <div class="auc-detail-section-label">⬆ Active Bids</div>
          ${bidItems}` : ""}
        ${wonItems ? `
          <div class="auc-detail-section-label" style="margin-top:var(--space-2)">🏷 Won This Auction</div>
          ${wonItems}` : ""}
        ${!activeBids.length && !wonItems ? `
          <div style="font-size:.78rem;color:var(--color-text-dim);text-align:center;padding:var(--space-2) 0">
            No active bids or wins yet.
          </div>` : ""}
      </div>`;
  }

  function _getSalaryMapForTeam(username) {
    // Pull salary data from DLRSalaryCap module if available
    try {
      const capData = (typeof DLRSalaryCap !== "undefined") ? DLRSalaryCap.getTeamSalaryEntries?.(username) : null;
      if (capData) {
        const m = {};
        capData.forEach(e => { if (e.playerId) m[e.playerId] = e; });
        return m;
      }
    } catch(e) {}
    return {};
  }

  function editRosterSize() {
    const size = prompt("Max roster size (active + IR, not counting taxi):", _settings.maxRosterSize || 30);
    if (!size) return;
    _settings.maxRosterSize = parseInt(size) || 30;
    _settingsRef().update({ maxRosterSize: _settings.maxRosterSize });
    _renderView();
  }

  // ── History ───────────────────────────────────────────────
  function _renderHistory(el, ended) {
    if (!ended.length) {
      el.innerHTML = `<div class="auc-empty">No auction history yet.</div>`;
      return;
    }
    el.innerHTML = `<div class="auc-history-list">
      ${ended.sort((a, b) => (b.expiresAt||0) - (a.expiresAt||0)).slice(0, 60).map(a => {
        const p      = _players[a.playerId] || {};
        const name   = p.first_name ? `${p.first_name} ${p.last_name}` : (a.playerName || a.playerId);
        const leader = _computeLeader(a);
        const winTeam= leader.rosterId
          ? (_rosterData.find(r => r.roster_id === leader.rosterId)?.teamName || `#${leader.rosterId}`)
          : "—";
        const status  = a.cancelled ? "Cancelled" : a.processed ? "Claimed" : "Expired";
        const sColor  = a.cancelled ? "var(--color-text-dim)" : a.processed ? "var(--color-green)" : "var(--color-gold)";
        const date    = new Date(a.expiresAt||a.startTime).toLocaleDateString();
        return `
          <div class="auc-history-row">
            <img class="auc-hist-photo" src="https://sleepercdn.com/content/nfl/players/thumb/${a.playerId}.jpg" onerror="this.style.display='none'" loading="lazy"/>
            <div class="auc-hist-info">
              <div style="font-weight:600;font-size:.85rem">${_esc(name)}</div>
              <div class="dim" style="font-size:.72rem">${_esc(winTeam)}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-family:var(--font-display);font-weight:700">${leader.rosterId ? _fmtSal(leader.displayBid) : "—"}</div>
              <div style="font-size:.65rem;color:${sColor}">${status} · ${date}</div>
            </div>
          </div>`;
      }).join("")}
    </div>`;
  }

  // ── Settings (commissioner) ───────────────────────────────
  function _renderSettings(el) {
    if (!_isCommish) { el.innerHTML = `<div class="auc-empty">Commissioner only.</div>`; return; }
    const s = _settings;

    // Format stored scheduledStart as local datetime-local value
    const toDatetimeLocal = (ts) => {
      if (!ts) return "";
      const d = new Date(ts);
      const pad = n => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    el.innerHTML = `
      <div class="auc-settings-form">
        <div class="form-group">
          <label>Auction Season Start Date & Time</label>
          <input type="datetime-local" id="auc-s-start" value="${toDatetimeLocal(s.scheduledStart || 0)}"/>
          <span class="field-hint">Set when the auction season begins. Leave blank to start immediately when the first nomination is made.</span>
        </div>
        <div class="form-group">
          <label>Bid Duration (hours)</label>
          <input type="number" id="auc-s-duration" value="${s.bidDuration || 8}" min="1" max="72" step="1"/>
          <span class="field-hint">How many active hours each auction runs after a bid is placed.</span>
        </div>
        <div class="form-group">
          <label>Overnight Pause — Start Hour (CT, 0–23)</label>
          <input type="number" id="auc-s-pstart" value="${s.pauseStart ?? 0}" min="0" max="23"/>
          <span class="field-hint">Timers pause from this hour (Central Time). 0 = midnight.</span>
        </div>
        <div class="form-group">
          <label>Overnight Pause — End Hour (CT, 0–23)</label>
          <input type="number" id="auc-s-pend" value="${s.pauseEnd ?? 8}" min="0" max="23"/>
          <span class="field-hint">Timers resume at this hour (Central Time). 8 = 8am.</span>
        </div>
        <div class="form-group">
          <label>Max Active Nominations Per Team</label>
          <input type="number" id="auc-s-maxnoms" value="${s.maxNoms || 2}" min="1" max="10"/>
          <span class="field-hint">How many players a team can have actively nominated at once.</span>
        </div>
        <div class="form-group">
          <label>Minimum Opening Bid ($)</label>
          <input type="number" id="auc-s-minbid" value="${s.minBid || 100000}" min="0" step="100000"/>
          <span class="field-hint">Minimum allowed opening bid when nominating a player.</span>
        </div>
        <div class="form-group">
          <label>Minimum Bid Increment ($)</label>
          <input type="number" id="auc-s-mininc" value="${s.minIncrement || 100000}" min="0" step="100000"/>
          <span class="field-hint">New bids must exceed the current proxy price by at least this amount.</span>
        </div>
        <div class="form-group">
          <label>Max Active Roster Size (excl. IR and Taxi)</label>
          <input type="number" id="auc-s-rostersize" value="${s.maxRosterSize || 30}" min="1" max="60"/>
          <span class="field-hint">Active roster only — IR and taxi slots don't count toward this limit.</span>
        </div>
        <button class="btn-primary" onclick="DLRAuction.saveSettings()" style="margin-top:var(--space-4)">Save Settings</button>
        ${s.scheduledStart ? `<div style="margin-top:var(--space-3);font-size:.8rem;color:var(--color-text-dim)">
          Auction scheduled to start: <strong style="color:var(--color-gold)">${new Date(s.scheduledStart).toLocaleString()}</strong>
        </div>` : ""}
      </div>`;
  }

  async function saveSettings() {
    const startInput = document.getElementById("auc-s-start")?.value;
    const scheduledStart = startInput ? new Date(startInput).getTime() : 0;
    const settings = {
      scheduledStart: scheduledStart || null,
      bidDuration:   parseInt(document.getElementById("auc-s-duration")?.value)    || 8,
      pauseStart:    parseInt(document.getElementById("auc-s-pstart")?.value)      ?? 0,
      pauseEnd:      parseInt(document.getElementById("auc-s-pend")?.value)        ?? 8,
      maxNoms:       parseInt(document.getElementById("auc-s-maxnoms")?.value)     || 2,
      maxRosterSize: parseInt(document.getElementById("auc-s-rostersize")?.value)  || 30,
      minBid:        parseInt(document.getElementById("auc-s-minbid")?.value)      || 100000,
      minIncrement:  parseInt(document.getElementById("auc-s-mininc")?.value)      || 100000
    };
    const btn = document.querySelector(".auc-settings-form .btn-primary");
    if (btn) { btn.textContent = "Saving…"; btn.disabled = true; }
    try {
      await _settingsRef().set(settings);
      _settings = settings;
      if (btn) { btn.textContent = "Saved ✓"; setTimeout(() => { btn.textContent = "Save Settings"; btn.disabled = false; }, 2000); }
    } catch(e) {
      if (btn) { btn.textContent = "Error"; btn.disabled = false; }
      showToast("Save failed: " + e.message, "error");
    }
  }

  // ── Bid / claim / cancel ───────────────────────────────────
  async function placeBid(auctionId, playerName) {
    const input  = document.getElementById(`bid-${auctionId}`);
    const maxBid = parseInt(input?.value) || 0;
    if (maxBid < MIN_BID()) { showToast(`Minimum bid is ${_fmtSal(MIN_BID())}`, "error"); return; }

    // Check roster space — bidding on a new player you're not already winning
    const auction = _auctions.find(a => a.id === auctionId);
    const alreadyWinning = auction && Number(_computeLeader(auction).rosterId) === Number(_myRosterId);
    if (!alreadyWinning && _myOpenSpots() <= 0) {
      showToast("No open roster spots — you are already winning enough auctions to fill your roster.", "error");
      return;
    }
    if (auction) {
      const leader       = _computeLeader(auction);
      const myCurrentMax = _myMaxBid(auction);
      const amLeading    = Number(leader.rosterId) === Number(_myRosterId);

      if (amLeading) {
        // Already winning — can raise OR lower proxy, but floor is displayBid + MIN_INC
        // (must stay at least one increment above current price to keep winning)
        const floor = leader.displayBid + MIN_INC();
        if (maxBid < floor) {
          showToast(`Proxy must be at least ${_fmtSal(floor)} (current price ${_fmtSal(leader.displayBid)} + ${_fmtSal(MIN_INC())} increment)`, "error");
          return;
        }
      } else {
        // Not winning — must beat current display price by at least one increment
        if (leader.rosterId) {
          const minRequired = leader.displayBid + MIN_INC();
          if (maxBid < minRequired) {
            showToast(`Bid must be at least ${_fmtSal(minRequired)} (current ${_fmtSal(leader.displayBid)} + ${_fmtSal(MIN_INC())} increment)`, "error");
            return;
          }
        }
      }
    }

    try {
      await _auctRef(auctionId).transaction(cur => {
        if (!cur || cur.cancelled || cur.processed) return;

        // Migrate old bids-array auctions to flat proxies map on first update
        if (!cur.proxies) {
          cur.proxies = {};
          const bids = Array.isArray(cur.bids) ? cur.bids : Object.values(cur.bids||{});
          bids.forEach(b => {
            const rid = String(Number(b.rosterId));
            if (!cur.proxies[rid] || b.maxBid > cur.proxies[rid])
              cur.proxies[rid] = b.maxBid;
          });
        }

        const myKey = String(Number(_myRosterId));

        // Compute current state BEFORE this update
        const entries = Object.entries(cur.proxies)
          .map(([id, m]) => ({ rosterId: Number(id), maxBid: Number(m) }))
          .sort((a, b) => b.maxBid - a.maxBid);
        const currentLeaderId  = entries.length > 0 ? entries[0].rosterId : null;
        const isCurrentLeader  = currentLeaderId === Number(_myRosterId);
        const currentLeaderMax = entries.length > 0 ? entries[0].maxBid : 0;

        // Set/update proxy
        cur.proxies[myKey] = maxBid;

        // Recompute leader AFTER this update to see if it changed
        const newEntries = Object.entries(cur.proxies)
          .map(([id, m]) => ({ rosterId: Number(id), maxBid: Number(m) }))
          .sort((a, b) => b.maxBid - a.maxBid);
        const newLeaderId = newEntries.length > 0 ? newEntries[0].rosterId : null;

        // Reset timer only when the lead actually changes hands
        // — proxy updates by current leader: no reset
        // — new bid that doesn't beat proxy: no reset (proxy still leads)
        // — bid that takes the lead: reset
        if (newLeaderId !== currentLeaderId) {
          cur.expiresAt = _nextExpiry(Date.now());
        }

        // Track bid count for display (how many unique bidders)
        cur.bidCount = Object.keys(cur.proxies).length;

        return cur;
      });
      showToast(`Max bid of ${_fmtSal(maxBid)} placed on ${playerName} ✓`);
    } catch(e) { showToast("Bid failed: " + e.message, "error"); }
  }

  function showBidHistory(auctionId) {
    const a = _auctions.find(x => x.id === auctionId);
    if (!a) return;

    // Build entries from proxies map (new) or bids array (legacy)
    let entries = [];
    if (a.proxies && Object.keys(a.proxies).length) {
      entries = Object.entries(a.proxies)
        .map(([id, maxBid]) => ({ rosterId: Number(id), maxBid: Number(maxBid) }))
        .sort((x, y) => y.maxBid - x.maxBid);
    } else {
      const bids = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
      const maxByRoster = {};
      bids.forEach(b => {
        const rid = Number(b.rosterId);
        if (!maxByRoster[rid] || b.maxBid > maxByRoster[rid]) maxByRoster[rid] = b.maxBid;
      });
      entries = Object.entries(maxByRoster)
        .map(([id, maxBid]) => ({ rosterId: Number(id), maxBid }))
        .sort((x, y) => y.maxBid - x.maxBid);
    }

    const secondHighest = entries.length > 1 ? entries[1].maxBid : null;
    const leader = _computeLeader(a);

    const teamEntries = entries.map(({ rosterId, maxBid }, i) => {
      const isMine   = rosterId === Number(_myRosterId);
      const isLeader = i === 0;
      let showAmount;
      if (isMine) {
        showAmount = maxBid; // always show your own proxy
      } else if (_isCommish) {
        // Commish sees display price only — never another team's proxy
        showAmount = isLeader ? leader.displayBid : MIN_BID();
      } else {
        showAmount = isLeader ? leader.displayBid : MIN_BID();
      }
      return { rosterId, showAmount, isMine, isLeader };
    });

    const p    = _players[a.playerId] || {};
    const name = p.first_name ? `${p.first_name} ${p.last_name}` : (a.playerName || "Player");
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.style.zIndex = "860";
    modal.innerHTML = `
      <div class="modal-box modal-box--sm">
        <div class="modal-header">
          <h3>📜 Bid Status — ${_esc(name)}</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
        </div>
        <div class="modal-body" style="padding:var(--space-4)">
          ${!teamEntries.length ? `<div class="dim">No bids yet.</div>` :
            teamEntries.map(({ rosterId, showAmount, isMine, isLeader }) => {
              const team  = _rosterData.find(r => Number(r.roster_id) === rosterId);
              const tName = team?.teamName || `Team ${rosterId}`;
              return `
                <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);font-size:.85rem">
                  <div>
                    <span style="font-weight:600">${_esc(tName)}</span>
                    ${isLeader ? `<span style="font-size:.7rem;color:var(--color-gold);margin-left:4px">👑 Leading</span>` : ""}
                    ${isMine   ? `<span style="font-size:.7rem;color:var(--color-blue);margin-left:4px">(you)</span>` : ""}
                  </div>
                  <span style="font-family:var(--font-display);font-weight:700;color:var(--color-gold)">${_fmtSal(showAmount)}</span>
                </div>`;
            }).join("")
          }
          <div class="dim" style="font-size:.72rem;margin-top:var(--space-3)">Current price shown. Proxy bids are hidden.</div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  }

  async function claimAuction(auctionId, playerName) {
    if (!_isCommish || !confirm(`Claim ${playerName} for winning bidder?`)) return;
    await _auctRef(auctionId).update({ processed: true, claimedAt: Date.now() });
    showToast(`${playerName} claimed ✓`);
  }

  async function cancelAuction(auctionId, playerName) {
    if (!_isCommish || !confirm(`Cancel auction for ${playerName}?`)) return;
    await _auctRef(auctionId).update({ cancelled: true });
    showToast("Auction cancelled");
  }

  // ── Floating live auctions button (rendered from profile.js) ──
  function renderFloatingBadge(container) {
    if (!container || !_leagueKey) return;
    const now  = Date.now();
    const live = _auctions.filter(a => !a.cancelled && !a.processed && a.expiresAt > now);
    if (!live.length) { container.innerHTML = ""; return; }
    container.innerHTML = `
      <button class="auc-float-btn" onclick="DLRAuction.setView('live');document.querySelector('[data-tab=\\'auction\\']')?.click()">
        🏷 ${live.length} Live Auction${live.length !== 1 ? "s" : ""}
      </button>`;
  }

  // ── Helpers ────────────────────────────────────────────────
  function _fmtSal(v) {
    if (!v) return "$0";
    const a = Math.abs(v);
    if (a >= 1_000_000_000) return `$${(v/1_000_000_000).toFixed(2)}B`;
    if (a >= 1_000_000)     return `$${(v/1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
    if (a >= 1_000)         return `$${(v/1_000).toFixed(0)}K`;
    return `$${v.toLocaleString()}`;
  }
  function _loadHTML(msg) { return `<div class="detail-loading"><div class="spinner"></div><span>${msg}</span></div>`; }
  function _esc(s)  { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function _escA(s) { return String(s||"").replace(/'/g,"\\'").replace(/"/g,"&quot;"); }

  // Can the current user nominate? (for FA button check)
  function canNominate() {
    if (!_leagueKey) return false;
    // Block if auction hasn't started yet
    if (_settings.scheduledStart && _settings.scheduledStart > Date.now()) return false;
    if (_myActiveNoms() >= (_settings.maxNoms || 2)) return false;
    // Block if no open roster spots (active roster + winning auctions >= max)
    if (_myOpenSpots() <= 0) return false;
    // Check cap — pull from salary module directly (most reliable source)
    // Fall back to _rosterData cache, then skip check if neither is available
    if (typeof DLRSalaryCap !== "undefined") {
      const capData = DLRSalaryCap.getCapData?.();
      if (capData && Object.keys(capData).length > 0) {
        const myTeam = _rosterData.find(r => Number(r.roster_id) === Number(_myRosterId));
        if (myTeam) {
          const d = capData[myTeam.username] || capData[myTeam.ownerId] || capData[String(myTeam.ownerId)];
          if (d) {
            const now    = Date.now();
            const active = _auctions.filter(a => !a.cancelled && !a.processed && a.expiresAt > now);
            // Committed = sum of my proxy on auctions I'm currently winning
            const committed = active.reduce((sum, a) => {
              const leader = _computeLeader(a);
              if (Number(leader.rosterId) !== Number(_myRosterId)) return sum;
              const myProxy = a.proxies
                ? (Number(a.proxies[String(Number(_myRosterId))]) || 0)
                : _myMaxBid(a);
              return sum + myProxy;
            }, 0);
            if ((d.remaining - committed) < MIN_BID()) return false;
          }
        }
        return true; // cap data available, passed the check
      }
    }
    // No cap data available — don't block nomination (salary may not be configured)
    return true;
  }

  // Returns true when this module has rosters loaded for the given leagueKey
  function isReady(leagueKey) {
    return _leagueKey === leagueKey && _rosterData.length > 0;
  }

  return {
    init, preInit, reset, setView, setPos, setTeamFilter,
    openNominate, submitNomination,
    placeBid, showBidHistory, claimAuction, cancelAuction, passAuction, isRostered,
    saveSettings, renderFloatingBadge,
    toggleTeamDetail, editRosterSize,
    canNominate, isReady
  };

})();
