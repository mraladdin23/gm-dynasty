// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Auction / FAAB System
//  Views: Live | Free Agents | Teams | Settings | History
//  Stored: gmd/auctions/{leagueKey}/
//  Live updates via Firebase SDK
// ─────────────────────────────────────────────────────────

const DLRAuction = (() => {

  // ── Constants ─────────────────────────────────────────────
  const MIN_BID     = 100_000;   // $100K floor

  // ── State ──────────────────────────────────────────────────
  let _leagueKey    = null;
  let _leagueId     = null;
  let _platform     = "sleeper";
  let _isCommish    = false;
  let _myRosterId   = null;
  let _myTeamName   = "My Team";
  let _rosterData   = [];
  let _auctions     = [];
  let _players      = {};
  let _settings     = { pauseStart: 0, pauseEnd: 8, maxNoms: 2, bidDuration: 8, maxRosterSize: 30 };
  let _initToken    = 0;
  let _unsubFn      = null;
  let _timerInterval = null;
  let _viewMode     = "live";
  let _posFilter    = "ALL";
  let _teamFilter   = "";

  // ── Firebase refs ──────────────────────────────────────────
  const _listRef     = () => GMD.child(`auctions/${_leagueKey}/bids`);
  const _auctRef     = (id) => GMD.child(`auctions/${_leagueKey}/bids/${id}`);
  const _settingsRef = () => GMD.child(`auctions/${_leagueKey}/settings`);

  // ── Init ──────────────────────────────────────────────────
  async function init(leagueKey, leagueId, isCommish, myRosterId, myTeamName, platform) {
    _leagueKey   = leagueKey;
    _leagueId    = leagueId;
    _platform    = platform || "sleeper";
    _isCommish   = !!isCommish;
    _myRosterId  = myRosterId;
    _myTeamName  = myTeamName || "My Team";
    _viewMode    = "live";
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
            username:   (u.username||"").toLowerCase(),
            teamName:   u.metadata?.team_name || u.display_name || `Team ${r.roster_id}`,
            players:    r.players  || [],
            reserve:    r.reserve  || [],
            taxi:       r.taxi     || [],
            wins:       r.settings?.wins   || 0,
            losses:     r.settings?.losses || 0,
            // FAAB = waiver budget remaining from Sleeper (in dollars, not millions)
            faab:       r.settings?.waiver_budget_used != null
                          ? Math.max(0, (r.settings.waiver_budget || 1000) - (r.settings.waiver_budget_used || 0)) * 1_000_000
                          : null
          };
        });

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
      _auctions = Object.values(d).filter(Boolean);
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
  function _computeLeader(a) {
    const bids = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
    if (!bids.length) return { rosterId: null, displayBid: MIN_BID };
    const maxByRoster = {};
    bids.forEach(b => {
      if (!maxByRoster[b.rosterId] || b.maxBid > maxByRoster[b.rosterId])
        maxByRoster[b.rosterId] = b.maxBid;
    });
    const sorted = Object.entries(maxByRoster)
      .map(([id, max]) => ({ rosterId: parseInt(id), maxBid: max }))
      .sort((a, b) => b.maxBid - a.maxBid);

    if (sorted.length === 1) {
      // Single bidder — show their first (opening) bid amount, not just MIN_BID
      const firstBid = [...bids]
        .filter(b => b.rosterId === sorted[0].rosterId)
        .sort((a, b) => a.timestamp - b.timestamp)[0];
      return { rosterId: sorted[0].rosterId, displayBid: firstBid?.maxBid ?? MIN_BID };
    }

    // Proxy: winner pays $1 increment above second-highest max
    return {
      rosterId:   sorted[0].rosterId,
      displayBid: Math.min(sorted[0].maxBid, sorted[1].maxBid + MIN_BID)
    };
  }

  function _myMaxBid(a) {
    const bids = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
    const mine = bids.filter(b => b.rosterId === _myRosterId);
    return mine.length ? Math.max(...mine.map(b => b.maxBid)) : 0;
  }

  function _myActiveNoms() {
    const now = Date.now();
    return _auctions.filter(a => !a.cancelled && !a.processed && a.expiresAt > now
      && a.nominatedBy === _myRosterId).length;
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
      // Record this team's pass
      await _passRef(auctionId).update({ [String(_myRosterId)]: Date.now() });

      // Read back full auction to check if all eligible teams have passed
      const snap    = await _auctRef(auctionId).once("value");
      const auction = snap.val();
      if (!auction || auction.cancelled || auction.processed) return;

      const bids    = Array.isArray(auction.bids) ? auction.bids : Object.values(auction.bids||{});
      const bidders = new Set(bids.map(b => String(b.rosterId)));
      const passes  = Object.keys(auction.passes || {});

      // mustPass = all teams except the nominator who haven't placed a bid
      const allRosterIds = _rosterData.map(r => String(r.roster_id));
      const mustPass = allRosterIds.filter(id =>
        id !== String(auction.nominatedBy) && !bidders.has(id)
      );
      const allPassed = mustPass.length > 0 && mustPass.every(id => passes.includes(id));

      if (allPassed) {
        // Close auction immediately — all non-bidding teams passed
        await _auctRef(auctionId).update({
          expiresAt: Date.now() - 1,
          autoClosedByPasses: true
        });
        showToast(`All teams passed — ${playerName} auction closed early.`);
      } else {
        const remaining = mustPass.filter(id => !passes.includes(id)).length;
        showToast(`Passed on ${playerName}. ${remaining} team${remaining !== 1 ? "s" : ""} yet to pass.`);
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
    const canNom  = myNoms < maxNoms;

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
    _renderView(live, ended, _myActiveNoms() < (_settings.maxNoms || 2));
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
    const nomTeam = _rosterData.find(r => r.roster_id === a.nominatedBy)?.teamName || `Team ${a.nominatedBy}`;
    const leadTeam= leader.rosterId ? (_rosterData.find(r => r.roster_id === leader.rosterId)?.teamName || `#${leader.rosterId}`) : "No bids";
    const myBid   = _myMaxBid(a);
    const winning = leader.rosterId === _myRosterId;

    const bids = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
    const uniqueBidders = [...new Set(bids.map(b => b.rosterId))].length;

    return `
      <div class="auc-card ${winning ? "auc-card--winning" : ""}">
        <div class="auc-card-header">
          <div class="auc-player-row">
            <img class="auc-photo" src="https://sleepercdn.com/content/nfl/players/thumb/${a.playerId}.jpg" onerror="this.style.display='none'" loading="lazy"/>
            <span class="auc-pos-pill" style="background:${posClr}22;color:${posClr};border-color:${posClr}55">${pos}</span>
            <div>
              <div class="auc-player-name">${_esc(name)}</div>
              <div class="dim" style="font-size:.72rem">Nom: ${_esc(nomTeam)}</div>
            </div>
          </div>
          <div class="auc-timer ${urgent ? "auc-timer--urgent" : ""}">
            <div class="auc-time-val">${_fmtTime(left)}</div>
            <div class="auc-time-lbl dim">${uniqueBidders} bidder${uniqueBidders !== 1 ? "s" : ""}</div>
          </div>
        </div>
        <div class="auc-lead-row">
          <div>
            <div class="auc-lead-label dim">Current leader</div>
            <div class="auc-lead-team ${winning ? "auc-lead-team--mine" : ""}">${_esc(leadTeam)}</div>
          </div>
          <div class="auc-lead-price">${_fmtSal(leader.displayBid)}</div>
        </div>
        <div class="auc-actions">
          <div class="auc-bid-row-form">
            <input type="number" id="bid-${a.id}" class="auc-bid-input"
              value="${myBid || ""}" placeholder="Max bid ($)" step="100000" min="${MIN_BID}"/>
            <button class="btn-primary btn-sm" onclick="DLRAuction.placeBid('${a.id}','${_escA(name)}')">
              ${myBid > 0 ? "Update" : "Bid"}
            </button>
          </div>
          ${_myHasPassed(a) ? `
          <span class="auc-passed-badge">✓ Passed</span>` :
          !winning && myBid === 0 ? `
          <button class="auc-pass-btn btn-secondary btn-sm"
            onclick="DLRAuction.passAuction('${a.id}','${_escA(name)}')"
            title="Pass — if all non-bidding teams pass, auction closes early">
            Pass
          </button>` : ""}
          ${_isCommish ? `
          <div class="auc-comm-btns">
            <button class="btn-secondary btn-sm" onclick="DLRAuction.claimAuction('${a.id}','${_escA(name)}')">✓ Claim</button>
            <button class="btn-secondary btn-sm" style="color:var(--color-red)" onclick="DLRAuction.cancelAuction('${a.id}','${_escA(name)}')">✕ Cancel</button>
          </div>` : ""}
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
      ${!canNom ? `<div class="auc-nom-limit">⚠️ You've reached the max of ${_settings.maxNoms} active nominations.</div>` : ""}
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
                  : `<button class="btn-secondary btn-sm" disabled>Max noms</button>`
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
    document.getElementById("auc-nom-modal")?.remove();
    const modal = document.createElement("div");
    modal.id = "auc-nom-modal";
    modal.className = "modal-overlay";
    modal.style.zIndex = "850";
    const color = { QB:"#b89ffe",RB:"#18e07a",WR:"#00d4ff",TE:"#ffc94d" }[pos] || "#9ca3af";
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
          <div class="form-group" style="margin-top:var(--space-4)">
            <label>Opening Max Bid</label>
            <input type="number" id="auc-nom-bid" value="${MIN_BID}" step="100000" min="${MIN_BID}"/>
            <span class="field-hint">Your proxy max bid — you'll only pay $1 more than the next highest bid.</span>
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
    const maxBid = parseInt(document.getElementById("auc-nom-bid")?.value) || MIN_BID;
    const btn    = document.querySelector("#auc-nom-modal .btn-primary");
    if (btn) { btn.textContent = "Starting…"; btn.disabled = true; }
    try {
      const id  = `auc_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
      const now = Date.now();
      await _auctRef(id).set({
        id, playerId: pid, playerName,
        nominatedBy: _myRosterId, nominatorName: _myTeamName,
        startTime: now, expiresAt: _nextExpiry(now),
        bids: [{ rosterId: _myRosterId, maxBid, timestamp: now }],
        processed: false, cancelled: false
      });
      document.getElementById("auc-nom-modal")?.remove();
      setView("live");
      showToast(`${playerName} nominated ✓`);
    } catch(e) {
      if (btn) { btn.textContent = "Start Auction"; btn.disabled = false; }
      showToast("Nomination failed: " + e.message, "error");
    }
  }

  // ── Teams tab ─────────────────────────────────────────────
  function _renderTeams(el) {
    const now    = Date.now();
    const active = _auctions.filter(a => !a.cancelled && !a.processed && a.expiresAt > now);
    const maxRoster = _settings.maxRosterSize || 30;

    // Pull fresh cap data from salary module every render
    const capData = (typeof DLRSalaryCap !== "undefined") ? DLRSalaryCap.getCapData?.() : null;
    if (capData) {
      _rosterData.forEach(team => {
        const d = capData[team.username];
        if (d) {
          team.remainingCap = d.remaining;
          team.capSpent     = d.spent;
          team.capTotal     = d.cap;
        }
      });
    }

    el.innerHTML = `
      <div style="margin-bottom:var(--space-3);font-size:.8rem;color:var(--color-text-dim)">
        Max roster size: <strong>${maxRoster}</strong> (active + IR, excl. taxi).
        ${_isCommish ? `<button class="btn-secondary btn-sm" style="margin-left:var(--space-2);font-size:.72rem" onclick="DLRAuction.editRosterSize()">Edit</button>` : ""}
      </div>
      <div class="auc-teams-list">
        ${_rosterData.map(team => {
          const mainCount = Math.max(0, (team.players||[]).length - (team.reserve||[]).length - (team.taxi||[]).length);
          const openSpots = Math.max(0, maxRoster - mainCount);
          const isMe      = team.roster_id === _myRosterId;

          const activeNoms = active.filter(a => a.nominatedBy === team.roster_id);
          const activeBids = active.filter(a => {
            const bids = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
            return bids.some(b => b.rosterId === team.roster_id);
          });
          const committed = activeBids.reduce((sum, a) => {
            const bids = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
            const mine = bids.filter(b => b.rosterId === team.roster_id);
            return sum + (mine.length ? Math.max(...mine.map(b => b.maxBid)) : 0);
          }, 0);

          // Cap: prefer salary module data, fall back to Sleeper waiver budget
          const cap       = team.remainingCap ?? (team.faab != null ? team.faab : null);
          const available = cap != null ? cap - committed : null;
          const capPct    = team.capTotal > 0 ? Math.min(100, (team.capSpent||0) / team.capTotal * 100) : 0;
          const capColor  = capPct >= 95 ? "var(--color-red)" : capPct >= 80 ? "var(--color-gold)" : "var(--color-green)";

          return `
            <div class="auc-team-row ${isMe ? "auc-team-row--mine" : ""}"
              onclick="DLRAuction.toggleTeamDetail(${team.roster_id})">
              <div class="auc-team-header-row">
                <div class="auc-team-name">${_esc(team.teamName)}${isMe ? ` <span class="dim" style="font-size:.7rem">(you)</span>` : ""}</div>
                <div class="dim" style="font-size:.72rem">${team.wins}–${team.losses}</div>
              </div>
              <div class="auc-team-stats">
                <span class="auc-stat-pill ${openSpots===0?"auc-stat-pill--full":""}">
                  👥 ${mainCount}/${maxRoster} · <strong>${openSpots} open</strong>
                </span>
                ${team.capTotal > 0 ? `
                  <span class="auc-stat-pill" style="color:${capColor}">
                    💰 ${_fmtSal(team.capSpent||0)} / ${_fmtSal(team.capTotal)} used
                  </span>
                  <span class="auc-stat-pill" style="color:${available!=null&&available<0?"var(--color-red)":"var(--color-green)"}">
                    ${available!=null ? `✓ ${_fmtSal(Math.max(0,available))} avail` : `${_fmtSal(cap??0)} cap`}
                  </span>
                ` : cap != null ? `<span class="auc-stat-pill">💰 ${_fmtSal(cap)} cap</span>` : ""}
                ${committed ? `<span class="auc-stat-pill auc-stat-pill--warn">🔥 ${_fmtSal(committed)} committed</span>` : ""}
                ${activeNoms.length ? `<span class="auc-stat-pill">🏷 ${activeNoms.length} nom${activeNoms.length!==1?"s":""}</span>` : ""}
                ${activeBids.length ? `<span class="auc-stat-pill">⬆ ${activeBids.length} bid${activeBids.length!==1?"s":""}</span>` : ""}
              </div>
              <div id="team-detail-${team.roster_id}" style="display:none;margin-top:var(--space-3)"></div>
            </div>`;
        }).join("")}
      </div>`;
  }

  function toggleTeamDetail(rosterId) {
    const el = document.getElementById(`team-detail-${rosterId}`);
    if (!el) return;
    const isOpen = el.style.display !== "none";
    // Close all others
    document.querySelectorAll("[id^='team-detail-']").forEach(d => { d.style.display = "none"; });
    if (isOpen) return;

    const team = _rosterData.find(r => r.roster_id === rosterId);
    if (!team) return;

    const now    = Date.now();
    const active = _auctions.filter(a => !a.cancelled && !a.processed && a.expiresAt > now);
    const sm     = _getSalaryMapForTeam(team.username);
    const bids   = active.filter(a => {
      const bs = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
      return bs.some(b => b.rosterId === rosterId);
    });

    const renderPlayer = (pid, slot) => {
      const p    = _players[pid] || {};
      const name = p.first_name ? `${p.first_name} ${p.last_name}` : pid;
      const pos  = (p.fantasy_positions?.[0]||p.position||"?").toUpperCase();
      const sal  = sm[pid]?.salary || 0;
      const clr  = { QB:"#b89ffe",RB:"#18e07a",WR:"#00d4ff",TE:"#ffc94d" }[pos] || "#9ca3af";
      const slotLabel = slot === "ir" ? " · IR" : slot === "taxi" ? " · Taxi" : "";
      return `<div style="display:flex;align-items:center;gap:var(--space-2);padding:3px 0;font-size:.78rem">
        <span style="font-size:.6rem;padding:1px 4px;border-radius:3px;border:1px solid;background:${clr}22;color:${clr};border-color:${clr}55">${pos}</span>
        <span style="flex:1">${_esc(name)}${slotLabel}</span>
        ${sal ? `<span style="font-family:var(--font-display);font-weight:700;color:var(--color-gold)">${_fmtSal(sal)}</span>` : ""}
      </div>`;
    };

    const bidItems = bids.map(a => {
      const p    = _players[a.playerId] || {};
      const name = p.first_name ? `${p.first_name} ${p.last_name}` : (a.playerName || a.playerId);
      const bs   = Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{});
      const mine = bs.filter(b => b.rosterId === rosterId);
      const myMax = mine.length ? Math.max(...mine.map(b => b.maxBid)) : 0;
      return `<div style="display:flex;align-items:center;justify-content:space-between;font-size:.78rem;padding:3px 0">
        <span>${_esc(name)}</span>
        <span style="font-family:var(--font-display);font-weight:700;color:var(--color-red)">${_fmtSal(myMax)} max</span>
      </div>`;
    }).join("");

    el.style.display = "";
    el.innerHTML = `
      <div style="border-top:1px solid var(--color-border);padding-top:var(--space-3);margin-top:var(--space-2)">
        ${bids.length ? `<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-dim);margin-bottom:var(--space-2)">Active Bids</div>${bidItems}` : ""}
        <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-dim);margin-top:var(--space-2);margin-bottom:var(--space-2)">Roster</div>
        ${(team.players||[]).filter(pid => !(team.taxi||[]).includes(pid) && !(team.reserve||[]).includes(pid)).map(pid => renderPlayer(pid, "main")).join("")}
        ${(team.reserve||[]).length ? (team.reserve.map(pid => renderPlayer(pid, "ir")).join("")) : ""}
        ${(team.taxi||[]).length ? (team.taxi.map(pid => renderPlayer(pid, "taxi")).join("")) : ""}
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
      maxRosterSize: parseInt(document.getElementById("auc-s-rostersize")?.value)  || 30
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
    if (maxBid < MIN_BID) { showToast(`Minimum bid is ${_fmtSal(MIN_BID)}`, "error"); return; }
    try {
      await _auctRef(auctionId).transaction(cur => {
        if (!cur || cur.cancelled || cur.processed) return;
        const bids = Array.isArray(cur.bids) ? cur.bids : Object.values(cur.bids||{});
        bids.push({ rosterId: _myRosterId, maxBid, timestamp: Date.now() });
        cur.bids = bids;
        cur.expiresAt = _nextExpiry(Date.now());
        return cur;
      });
      showToast(`Bid of ${_fmtSal(maxBid)} placed on ${playerName} ✓`);
    } catch(e) { showToast("Bid failed: " + e.message, "error"); }
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
    return _myActiveNoms() < (_settings.maxNoms || 2);
  }

  return {
    init, reset, setView, setPos, setTeamFilter,
    openNominate, submitNomination,
    placeBid, claimAuction, cancelAuction, passAuction,
    saveSettings, renderFloatingBadge,
    toggleTeamDetail, editRosterSize,
    canNominate
  };

})();
