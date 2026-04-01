// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Auction / FAAB System
//  Ported from SleeperBid auction.js
//  Stored under gmd/auctions/{leagueKey}/
//  Live bidding via Firebase Realtime Database SDK
// ─────────────────────────────────────────────────────────

const DLRAuction = (() => {

  const DURATION_MS    = 8 * 60 * 60 * 1000; // 8 active hours per bid
  const MIN_BID        = 100_000;             // $100K minimum
  const PAUSE_START    = 0;  // midnight CT
  const PAUSE_END      = 8;  // 8am CT

  let _leagueKey  = null;
  let _leagueId   = null;
  let _isCommish  = false;
  let _myRosterId = null;
  let _myTeamName = null;
  let _rosterData = null;
  let _auctions   = [];
  let _faabMap    = {};      // rosterId → available FAAB
  let _initToken  = 0;
  let _unsubFn    = null;
  let _players    = {};
  let _viewMode   = "active"; // "active" | "history" | "nominate"

  // ── Firebase refs ──────────────────────────────────────────
  const _ref       = (path) => GMD.child(`auctions/${path}`);
  const _auctRef   = (id)   => _ref(`${_leagueKey}/${id}`);
  const _listRef   = ()     => _ref(_leagueKey);

  let _timerInterval = null;

  // ── Init ──────────────────────────────────────────────────
  async function init(leagueKey, leagueId, isCommish, myRosterId, myTeamName) {
    _leagueKey  = leagueKey;
    _leagueId   = leagueId;
    _isCommish  = !!isCommish;
    _myRosterId = myRosterId;
    _myTeamName = myTeamName || "My Team";
    _initToken++;
    const token = _initToken;

    // Clear any existing timer
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }

    const el = document.getElementById("dtab-auction");
    if (!el) return;
    el.innerHTML = _loadingHTML("Loading auction board…");

    // Load players
    _players = DLRPlayers.all();
    if (Object.keys(_players).length < 100) {
      _players = await DLRPlayers.load();
    }

    // Load roster data for team names
    if (_leagueId) {
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
            roster_id: r.roster_id,
            username:  (u.username || "").toLowerCase(),
            teamName:  u.metadata?.team_name || u.display_name || `Team ${r.roster_id}`,
            players:   r.players  || [],
            reserve:   r.reserve  || [],
            taxi:      r.taxi     || [],
          };
        });
      } catch(e) {}
    }

    if (token !== _initToken) return;

    // Subscribe to live auction updates
    _unsubFn?.();
    _unsubFn = null;
    const handleUpdate = (snap) => {
      if (token !== _initToken) return;
      const data = snap.val() || {};
      _auctions  = Object.values(data);
      _render();
    };
    _listRef().on("value", handleUpdate);
    _unsubFn = () => _listRef().off("value", handleUpdate);

    // Tick timers every 30 seconds to keep countdowns fresh
    _timerInterval = setInterval(() => {
      if (_viewMode === "active") _renderView(_auctions.filter(a => !a.cancelled && !a.processed && a.expiresAt > Date.now()), []);
    }, 30_000);
  }

  function reset() {
    _unsubFn?.();
    _unsubFn    = null;
    if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    _leagueKey  = null;
    _auctions   = [];
    _initToken++;
  }

  // ── Time helpers ──────────────────────────────────────────
  function _isNightPause(now = Date.now()) {
    const ct   = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const hour = ct.getHours();
    return hour >= PAUSE_START && hour < PAUSE_END;
  }

  function _nextExpiry(now = Date.now()) {
    if (_isNightPause(now)) {
      const ct     = new Date(new Date(now).toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const resume = new Date(ct);
      resume.setHours(PAUSE_END, 0, 0, 0);
      if (resume <= ct) resume.setDate(resume.getDate() + 1);
      return +resume + DURATION_MS;
    }
    return now + DURATION_MS;
  }

  function _timeLeft(auction, now = Date.now()) {
    if (!auction || auction.cancelled || auction.processed) return 0;
    return Math.max(0, auction.expiresAt - now);
  }

  function _fmtTime(ms) {
    if (ms <= 0) return "Expired";
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    if (h >= 1) return `${h}h ${m}m`;
    return `${m}m ${Math.floor((ms % 60_000) / 1000)}s`;
  }

  // ── Bid computation (proxy bidding) ───────────────────────
  function _computeLeader(auction) {
    const bids = Array.isArray(auction.bids)
      ? auction.bids : Object.values(auction.bids || {});
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
      return { rosterId: sorted[0].rosterId, displayBid: MIN_BID };
    }
    return {
      rosterId:   sorted[0].rosterId,
      displayBid: Math.min(sorted[0].maxBid, sorted[1].maxBid + MIN_BID)
    };
  }

  function _myMaxBid(auction) {
    const bids = Array.isArray(auction.bids)
      ? auction.bids : Object.values(auction.bids || {});
    const mine = bids.filter(b => b.rosterId === _myRosterId);
    return mine.length ? Math.max(...mine.map(b => b.maxBid)) : 0;
  }

  // ── Main render ───────────────────────────────────────────
  function _render() {
    const el = document.getElementById("dtab-auction");
    if (!el) return;

    const now     = Date.now();
    const active  = _auctions.filter(a => !a.cancelled && !a.processed && a.expiresAt > now);
    const ended   = _auctions.filter(a =>  a.cancelled ||  a.processed || a.expiresAt <= now)
                             .sort((a, b) => (b.expiresAt||0) - (a.expiresAt||0));

    el.innerHTML = `
      <div class="auc-toolbar">
        <div class="auc-tabs">
          <button class="auc-tab ${_viewMode==="active"   ? "auc-tab--active":""}" onclick="DLRAuction.setView('active')">Live (${active.length})</button>
          <button class="auc-tab ${_viewMode==="history"  ? "auc-tab--active":""}" onclick="DLRAuction.setView('history')">History</button>
          ${!_isCommish ? `<button class="auc-tab ${_viewMode==="nominate" ? "auc-tab--active":""}" onclick="DLRAuction.setView('nominate')">+ Nominate</button>` : ""}
          ${_isCommish  ? `<button class="auc-tab ${_viewMode==="nominate" ? "auc-tab--active":""}" onclick="DLRAuction.setView('nominate')">+ Nominate Player</button>` : ""}
        </div>
        ${_isNightPause() ? `<div class="auc-night-pause">🌙 Night pause (midnight–8am CT) — timers paused</div>` : ""}
      </div>
      <div id="auc-content"></div>`;

    _renderView(active, ended);
  }

  function setView(mode) {
    _viewMode = mode;
    document.querySelectorAll(".auc-tab").forEach(t => {
      t.classList.toggle("auc-tab--active",
        (t.getAttribute("onclick")||"").includes(`'${mode}'`)
      );
    });
    const now    = Date.now();
    const active = _auctions.filter(a => !a.cancelled && !a.processed && a.expiresAt > now);
    const ended  = _auctions.filter(a =>  a.cancelled ||  a.processed || a.expiresAt <= now)
                            .sort((a, b) => (b.expiresAt||0) - (a.expiresAt||0));
    _renderView(active, ended);
  }

  function _renderView(active, ended) {
    const el = document.getElementById("auc-content");
    if (!el) return;
    if (_viewMode === "active")   _renderActive(el, active);
    if (_viewMode === "history")  _renderHistory(el, ended);
    if (_viewMode === "nominate") _renderNominate(el);
  }

  // ── Active auctions ───────────────────────────────────────
  function _renderActive(el, active) {
    if (!active.length) {
      el.innerHTML = `<div class="auc-empty">
        <div style="font-size:2rem;margin-bottom:var(--space-3)">🏷</div>
        <div style="font-weight:600;margin-bottom:var(--space-2)">No active auctions</div>
        <div class="dim" style="font-size:.85rem">Use the Nominate tab to start an auction.</div>
      </div>`;
      return;
    }

    el.innerHTML = active.map(a => _auctionCard(a)).join("");
  }

  function _auctionCard(a) {
    const now     = Date.now();
    const left    = _timeLeft(a, now);
    const urgent  = left < 3_600_000; // under 1 hour
    const leader  = _computeLeader(a);
    const p       = _players[a.playerId] || {};
    const name    = p.first_name ? `${p.first_name} ${p.last_name}` : (a.playerName || a.playerId);
    const pos     = (p.fantasy_positions?.[0] || p.position || "—").toUpperCase();
    const posColor= { QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff", TE:"#ffc94d" }[pos] || "#9ca3af";
    const nomTeam = _rosterData?.find(r => r.roster_id === a.nominatedBy)?.teamName || `Team ${a.nominatedBy}`;
    const leadTeam= leader.rosterId ? (_rosterData?.find(r => r.roster_id === leader.rosterId)?.teamName || `Team ${leader.rosterId}`) : "—";
    const myBid   = _myMaxBid(a);
    const amLeading = leader.rosterId === _myRosterId;

    const bidRows = Object.values(
      (Array.isArray(a.bids) ? a.bids : Object.values(a.bids||{}))
        .reduce((map, b) => {
          if (!map[b.rosterId] || b.maxBid > map[b.rosterId].maxBid) map[b.rosterId] = b;
          return map;
        }, {})
    ).sort((x, y) => y.maxBid - x.maxBid);

    return `
      <div class="auc-card ${amLeading ? "auc-card--winning" : ""}">
        <div class="auc-card-header">
          <div class="auc-player-info">
            <img class="auc-player-photo" src="https://sleepercdn.com/content/nfl/players/${a.playerId}.jpg"
              onerror="this.style.display='none'" loading="lazy" />
            <div class="auc-pos-badge" style="background:${posColor}22;color:${posColor};border-color:${posColor}55">${pos}</div>
            <div>
              <div class="auc-player-name">${_esc(name)}</div>
              <div class="auc-nom-by dim">Nom: ${_esc(nomTeam)}</div>
            </div>
          </div>
          <div class="auc-timer ${urgent ? "auc-timer--urgent" : ""}">
            <div class="auc-time-val">${_fmtTime(left)}</div>
            <div class="auc-time-lbl dim">remaining</div>
          </div>
        </div>

        <div class="auc-bid-status">
          <div class="auc-leading">
            <div class="auc-lead-team ${amLeading ? "auc-lead-team--mine" : ""}">${_esc(leadTeam)}</div>
            <div class="auc-lead-bid">${_fmtSal(leader.displayBid)}</div>
          </div>
          ${bidRows.length > 0 ? `
          <div class="auc-bid-list">
            ${bidRows.map(b => {
              const bTeam = _rosterData?.find(r => r.roster_id === b.rosterId)?.teamName || `Team ${b.rosterId}`;
              const isMe  = b.rosterId === _myRosterId;
              return `<div class="auc-bid-row ${isMe ? "auc-bid-row--mine" : ""}">
                <span>${_esc(bTeam)}</span>
                <span class="dim" style="font-size:.72rem">max: ${_fmtSal(b.maxBid)}</span>
              </div>`;
            }).join("")}
          </div>` : ""}
        </div>

        <div class="auc-bid-actions">
          <div class="auc-bid-form">
            <input type="number" class="auc-bid-input" id="bid-${a.id}"
              value="${myBid || ""}" placeholder="Max bid" step="100000" min="${MIN_BID}" />
            <button class="btn-primary btn-sm" onclick="DLRAuction.placeBid('${a.id}','${_escAttr(name)}')">
              ${myBid > 0 ? "Update Bid" : "Bid"}
            </button>
          </div>
          ${_isCommish ? `
          <div class="auc-comm-actions">
            <button class="btn-secondary btn-sm" onclick="DLRAuction.claimAuction('${a.id}','${_escAttr(name)}')">✓ Claim</button>
            <button class="btn-secondary btn-sm" style="color:var(--color-red)" onclick="DLRAuction.cancelAuction('${a.id}','${_escAttr(name)}')">✕ Cancel</button>
          </div>` : ""}
        </div>
      </div>`;
  }

  // ── History ───────────────────────────────────────────────
  function _renderHistory(el, ended) {
    if (!ended.length) {
      el.innerHTML = `<div class="auc-empty">No auction history yet.</div>`;
      return;
    }
    el.innerHTML = `<div class="auc-history-list">
      ${ended.slice(0, 50).map(a => {
        const p     = _players[a.playerId] || {};
        const name  = p.first_name ? `${p.first_name} ${p.last_name}` : (a.playerName || a.playerId);
        const leader = _computeLeader(a);
        const winTeam = leader.rosterId ? (_rosterData?.find(r => r.roster_id === leader.rosterId)?.teamName || `Team ${leader.rosterId}`) : "—";
        const status = a.cancelled ? "Cancelled" : a.processed ? "Claimed" : "Expired";
        const statusColor = a.cancelled ? "var(--color-text-dim)" : a.processed ? "var(--color-green)" : "var(--color-gold)";
        const date  = new Date(a.expiresAt || a.startTime).toLocaleDateString();
        return `
          <div class="auc-history-row">
            <img class="auc-hist-photo" src="https://sleepercdn.com/content/nfl/players/${a.playerId}.jpg"
              onerror="this.style.display='none'" loading="lazy"/>
            <div class="auc-hist-info">
              <div class="auc-hist-name">${_esc(name)}</div>
              <div class="auc-hist-winner dim">${_esc(winTeam)}</div>
            </div>
            <div class="auc-hist-right">
              <div class="auc-hist-price">${leader.rosterId ? _fmtSal(leader.displayBid) : "—"}</div>
              <div style="font-size:.65rem;color:${statusColor}">${status}</div>
              <div class="dim" style="font-size:.65rem">${date}</div>
            </div>
          </div>`;
      }).join("")}
    </div>`;
  }

  // ── Nominate ──────────────────────────────────────────────
  function _renderNominate(el) {
    el.innerHTML = `
      <div class="auc-nominate-wrap">
        <div class="form-group" style="position:relative;">
          <label>Search Player</label>
          <input type="text" id="auc-search" placeholder="Type player name…"
            oninput="DLRAuction.searchPlayer(this.value)" autocomplete="off" />
          <div id="auc-search-results" class="auc-search-results"></div>
        </div>
        <div id="auc-nom-player" class="auc-nom-player hidden"></div>
        <div class="form-group" id="auc-nom-bid-wrap" style="display:none">
          <label>Opening Max Bid</label>
          <input type="number" id="auc-nom-bid" value="${MIN_BID}" step="100000" min="${MIN_BID}" />
          <span class="field-hint">Your max bid — proxy bidding will handle the rest.</span>
        </div>
        <button id="auc-nom-submit" class="btn-primary" style="display:none"
          onclick="DLRAuction.submitNomination()">
          Nominate Player
        </button>
      </div>`;
  }

  function searchPlayer(query) {
    const results = document.getElementById("auc-search-results");
    if (!results) return;
    if (!query || query.length < 2) { results.innerHTML = ""; return; }

    const q = query.toLowerCase();
    const matches = Object.entries(_players)
      .filter(([, p]) => p.first_name && p.last_name &&
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) &&
        ["QB","RB","WR","TE"].includes((p.fantasy_positions?.[0]||p.position||"").toUpperCase())
      )
      .map(([pid, p]) => ({
        pid,
        name: `${p.first_name} ${p.last_name}`,
        pos:  (p.fantasy_positions?.[0] || p.position || "").toUpperCase(),
        team: p.team || "FA",
        rank: p.search_rank || 9999
      }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 8);

    results.innerHTML = matches.map(m => {
      const color = { QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff", TE:"#ffc94d" }[m.pos] || "#9ca3af";
      return `<div class="auc-search-row" onclick="DLRAuction.selectNominee('${m.pid}','${_escAttr(m.name)}','${m.pos}','${m.team}')">
        <span class="auc-sr-pos" style="color:${color}">${m.pos}</span>
        <span class="auc-sr-name">${_esc(m.name)}</span>
        <span class="auc-sr-team dim">${m.team}</span>
      </div>`;
    }).join("") || `<div class="auc-search-row dim">No players found</div>`;
  }

  let _nomineeId = null;

  function selectNominee(pid, name, pos, team) {
    _nomineeId = pid;
    const searchEl = document.getElementById("auc-search");
    if (searchEl) searchEl.value = name;
    const results = document.getElementById("auc-search-results");
    if (results) results.innerHTML = "";

    const playerEl = document.getElementById("auc-nom-player");
    const bidWrap  = document.getElementById("auc-nom-bid-wrap");
    const submitEl = document.getElementById("auc-nom-submit");

    if (playerEl) {
      const color = { QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff", TE:"#ffc94d" }[pos] || "#9ca3af";
      playerEl.className = "auc-nom-player";
      playerEl.innerHTML = `
        <img src="https://sleepercdn.com/content/nfl/players/${pid}.jpg"
          onerror="this.style.display='none'" loading="lazy" />
        <div class="auc-pos-badge" style="background:${color}22;color:${color};border-color:${color}55">${pos}</div>
        <div>
          <div style="font-weight:700">${_esc(name)}</div>
          <div class="dim" style="font-size:.78rem">${team}</div>
        </div>`;
    }
    if (bidWrap) bidWrap.style.display = "";
    if (submitEl) submitEl.style.display = "";
  }

  async function submitNomination() {
    if (!_nomineeId || !_leagueKey) return;
    const maxBid  = parseInt(document.getElementById("auc-nom-bid")?.value) || MIN_BID;
    const p       = _players[_nomineeId] || {};
    const name    = p.first_name ? `${p.first_name} ${p.last_name}` : _nomineeId;

    const btn = document.getElementById("auc-nom-submit");
    if (btn) { btn.textContent = "Nominating…"; btn.disabled = true; }

    try {
      const id  = `auc_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
      const now = Date.now();
      const auction = {
        id,
        playerId:    _nomineeId,
        playerName:  name,
        nominatedBy: _myRosterId,
        nominatorName: _myTeamName,
        startTime:   now,
        expiresAt:   _nextExpiry(now),
        bids:        [{ rosterId: _myRosterId, maxBid, timestamp: now }],
        processed:   false,
        cancelled:   false,
      };
      await _auctRef(id).set(auction);
      if (btn) { btn.textContent = "Nominate Player"; btn.disabled = false; }
      setView("active");
      showToast(`${name} nominated! ✓`);
    } catch(e) {
      if (btn) { btn.textContent = "Nominate Player"; btn.disabled = false; }
      showToast("Nomination failed: " + e.message, "error");
    }
  }

  // ── Bid ───────────────────────────────────────────────────
  async function placeBid(auctionId, playerName) {
    const input  = document.getElementById(`bid-${auctionId}`);
    const maxBid = parseInt(input?.value) || 0;
    if (maxBid < MIN_BID) { showToast(`Minimum bid is ${_fmtSal(MIN_BID)}`, "error"); return; }

    try {
      await _auctRef(auctionId).transaction(current => {
        if (!current || current.cancelled || current.processed) return;
        const bids = Array.isArray(current.bids) ? current.bids : Object.values(current.bids||{});
        bids.push({ rosterId: _myRosterId, maxBid, timestamp: Date.now() });
        current.bids      = bids;
        current.expiresAt = _nextExpiry(Date.now());
        return current;
      });
      showToast(`Bid of ${_fmtSal(maxBid)} placed on ${playerName} ✓`);
    } catch(e) {
      showToast("Bid failed: " + e.message, "error");
    }
  }

  // ── Commissioner actions ──────────────────────────────────
  async function claimAuction(auctionId, playerName) {
    if (!_isCommish) return;
    if (!confirm(`Claim ${playerName} for the winning bidder?`)) return;
    try {
      await _auctRef(auctionId).update({ processed: true, claimedAt: Date.now() });
      showToast(`${playerName} claimed ✓`);
    } catch(e) {
      showToast("Error: " + e.message, "error");
    }
  }

  async function cancelAuction(auctionId, playerName) {
    if (!_isCommish) return;
    if (!confirm(`Cancel auction for ${playerName}?`)) return;
    try {
      await _auctRef(auctionId).update({ cancelled: true });
      showToast(`Auction cancelled`);
    } catch(e) {
      showToast("Error: " + e.message, "error");
    }
  }

  // ── Helpers ────────────────────────────────────────────────
  function _fmtSal(v) {
    if (!v || v === 0) return "$0";
    if (v >= 1_000_000_000) return `$${(v/1_000_000_000).toFixed(2)}B`;
    if (v >= 1_000_000)     return `$${(v/1_000_000).toFixed(2).replace(/\.?0+$/,"")}M`;
    if (v >= 1_000)         return `$${(v/1_000).toFixed(0)}K`;
    return `$${v.toLocaleString()}`;
  }
  function _loadingHTML(msg) { return `<div class="detail-loading"><div class="spinner"></div><span>${msg}</span></div>`; }
  function _esc(s)     { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function _escAttr(s) { return String(s||"").replace(/'/g,"\\'").replace(/"/g,"&quot;"); }

  return {
    init, reset, setView,
    searchPlayer, selectNominee, submitNomination,
    placeBid, claimAuction, cancelAuction
  };

})();
