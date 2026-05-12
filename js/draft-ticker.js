// ─────────────────────────────────────────────────────────
//  GM Dynasty — Global Draft Ticker v8
//  New architecture:
//  - Reads gmd/draftWatchList once to register leagues
//  - Reads gmd/draftStatus/ (tiny node) written by Worker cron
//  - Never hits Sleeper API directly — zero Sleeper calls from client
//  - Dynamic polling based on draft proximity:
//      tomorrow+  → 15 min
//      <24 hours  → 5 min
//      <1 hour    → 60s
//      live       → Firebase realtime listener (instant updates)
//      complete   → detach listener entirely
//  - "My next pick" uses slot_to_roster_id (trade-aware)
//  - 1 Sleeper call (Worker) → 1 Firebase write → many clients updated
// ─────────────────────────────────────────────────────────

const DraftTicker = (() => {

  const FB_STATUS_PATH = "draftStatus"; // gmd/draftStatus/

  // ── State ──────────────────────────────────────────────
  let _username        = null;
  let _debugWatchList      = new Map();
  let _debugSleeperResults = [];
  let _mySleeperUserId = null;
  let _lastItems       = { live: [], upcoming: [] };
  let _tickerOpen         = false;
  let _hasMflOrYahoo = false; // true if user has any MFL or Yahoo leagues — shows note in panel

  // Per-league timer/listener state: leagueId → { timer, fbListener, ref }
  const _timers      = new Map();
  // In-memory status cache from Firebase: leagueId → statusObject
  const _statusCache = new Map();
  // League metadata: leagueId → { leagueName, tournamentName?, tid?, source }
  const _leagueMeta  = new Map();

  // ── DOM shortcuts ──────────────────────────────────────
  const _pill  = () => document.getElementById("draft-ticker-btn");
  const _panel = () => document.getElementById("draft-ticker-panel");
  const _body  = () => document.getElementById("draft-ticker-body");
  const _wrap  = () => document.getElementById("draft-ticker-wrap");
  const _label = () => document.getElementById("draft-ticker-label");

  function _esc(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ── Resolve my Sleeper user_id ─────────────────────────
  async function _getMySleeperUserId() {
    if (_mySleeperUserId) return _mySleeperUserId;
    if (!_username) return null;
    try {
      const snap = await GMD.child(`users/${_username}/platforms/sleeper`).once("value");
      const data = snap.val() || {};
      const uid  = data.sleeperUserId || data.userId || data.user_id || data.id || null;
      if (uid) { _mySleeperUserId = String(uid); return _mySleeperUserId; }

      // Fallback: read sleeperUserId from stored league data
      const leaguesSnap = await GMD.child(`users/${_username}/leagues`).once("value");
      const leagues     = leaguesSnap.val() || {};
      for (const l of Object.values(leagues)) {
        if (l.platform === "sleeper" && l.sleeperUserId) {
          _mySleeperUserId = String(l.sleeperUserId);
          return _mySleeperUserId;
        }
      }
    } catch(e) {}
    return null;
  }

  // ── Relevant seasons ───────────────────────────────────
  function _relevantSeasons() {
    const y = new Date().getFullYear();
    return new Set([y - 1, y, y + 1, String(y - 1), String(y), String(y + 1)]);
  }

  // ── Build watch list and register with Firebase ────────
  // Returns Map of leagueId → metadata
  // Also writes gmd/draftWatchList so the Worker knows what to monitor
  async function _buildWatchList() {
    const watchList = new Map();
    const relevant  = _relevantSeasons();

    // 1. Regular user leagues (Sleeper only, skip commish-only)
    try {
      const snap   = await GMD.child(`users/${_username}/leagues`).once("value");
      const stored = snap.val() || {};
      let meta = {};
      try {
        const ms = await GMD.child(`users/${_username}/leagueMeta`).once("value");
        meta = ms.val() || {};
      } catch(e) {}

      for (const [key, l] of Object.entries(stored)) {
        if (!l.leagueId && !l.league_id) continue;
        if (l.platform !== "sleeper") {
          if (l.platform === "mfl" || l.platform === "yahoo") _hasMflOrYahoo = true;
          continue;
        }
        if (meta[key]?.isCommissioner && !meta[key]?.isOwner) continue;
        const season = l.season || l.year || 0;
        if (season && !relevant.has(season) && !relevant.has(String(season))) continue;
        // For dynasty/keeper chains, only include the current-season entry.
        // Each season of a chain has mostRecentSeason set to the franchise's
        // active season — skip any entry where this league's season is stale.
        if (l.mostRecentSeason && String(l.season) !== String(l.mostRecentSeason)) continue;
        const id = String(l.leagueId || l.league_id);
        watchList.set(id, { leagueName: l.leagueName || l.name || id, source: "league" });
      }
    } catch(e) { console.warn("[DraftTicker] Failed to load user leagues:", e.message); }

    // 2. Tournament leagues — only leagues where THIS user has a roster.
    // We already have those in section 1 (user's own leagues node) so this
    // section only needs to add leagues that aren't already in the user's
    // own leagues list, tagged with the tournament name for display.
    // Crucially: do NOT scan all 336 leagues in a tournament just because
    // the user is an admin/discoverer — only add leagues already in watchList
    // that need a tournamentName annotation, plus any participant-specific ones.
    try {
      const snap = await GMD.child("tournaments").once("value");
      const all  = snap.val() || {};
      for (const [tid, t] of Object.entries(all)) {
        if (!t?.meta || !t?.leagues) continue;
        const tournamentName = t.meta?.name || "";
        const isBatch = v => v && typeof v === "object" && v.leagues !== undefined;
        for (const [, batch] of Object.entries(t.leagues)) {
          if (!isBatch(batch)) continue;
          if ((batch.platform || "sleeper") !== "sleeper") continue;
          const season = batch.year || 0;
          if (season && !relevant.has(season) && !relevant.has(String(season))) continue;
          for (const [leagueId, l] of Object.entries(batch.leagues || {})) {
            // Only annotate leagues already in the watchList (from user's own leagues)
            // — don't add new ones just because user is tournament admin
            if (watchList.has(leagueId)) {
              const existing = watchList.get(leagueId);
              if (!existing.tournamentName) {
                watchList.set(leagueId, { ...existing, tournamentName, tid });
              }
            }
          }
        }
      }
    } catch(e) { console.warn("[DraftTicker] Failed to load tournament leagues:", e.message); }

    console.log(`[DraftTicker] Monitoring ${watchList.size} current-season leagues`);
    _debugWatchList = watchList;
    return watchList;
  }

  // ── Compute "my next pick" from Worker-provided status ─
  // Compute my next pick using the correct Sleeper data model:
  //
  // draft_order:       userId    → draftSlot (which position I pick from)
  // slot_to_roster_id: draftSlot → rosterId  (which team occupies each slot)
  // traded_picks:      { roster_id: originalRosterId, owner_id: currentOwnerRosterId, round }
  //
  // To find my picks:
  //   1. mySlot     = draft_order[myUserId]
  //   2. myRosterId = slot_to_roster_id[mySlot]
  //   3. For each future board position, find originalRosterId = slot_to_roster_id[slotAtPos]
  //   4. Check if traded: traded_picks entry where roster_id===originalRosterId && round===round
  //      → current owner is owner_id from that entry
  //   5. If currentOwner === myRosterId → it's my pick
  function _computeMyNextPick(status, mySleeperUid) {
    if (!mySleeperUid || !status.draft_order) return null;

    const draft_order       = status.draft_order;
    const slot_to_roster_id = status.slot_to_roster_id || null;
    const totalTeams        = Object.keys(draft_order).length || 12;
    const totalPicks        = status.totalPicks || totalTeams;
    const nextOverall       = (status.picksMade || 0) + 1;
    const isLinear          = (status.draftType || "snake") === "linear";

    // Step 1: find my draft slot
    let mySlot = null;
    for (const [uid, slot] of Object.entries(draft_order)) {
      if (String(uid) === String(mySleeperUid)) { mySlot = Number(slot); break; }
    }
    if (mySlot == null) return null;

    // Step 2: find my rosterId via slot_to_roster_id
    // If not available (shouldn't happen for live drafts), fall back to slot
    const myRosterId = slot_to_roster_id
      ? Number(slot_to_roster_id[String(mySlot)] ?? mySlot)
      : mySlot;

    // Step 3: build trade lookup — key: "round-originalRosterId" → currentOwnerRosterId
    // traded_picks.roster_id = the original roster that owned this pick
    // traded_picks.owner_id  = the current roster that now owns it
    const tradeMap = {};
    for (const tp of (status.traded_picks || [])) {
      // A roster may have traded the same pick multiple times; last entry wins
      tradeMap[`${tp.round}-${tp.roster_id}`] = Number(tp.owner_id);
    }

    // Step 4: scan forward through remaining picks
    for (let overall = nextOverall; overall <= totalPicks; overall++) {
      const round   = Math.ceil(overall / totalTeams);
      const inRound = ((overall - 1) % totalTeams) + 1;

      // Which draft slot picks at this board position?
      const slotAtPos = isLinear
        ? inRound
        : (round % 2 === 1 ? inRound : totalTeams + 1 - inRound);

      // Who originally owns this slot?
      const originalRosterId = slot_to_roster_id
        ? Number(slot_to_roster_id[String(slotAtPos)] ?? slotAtPos)
        : slotAtPos;

      // Has it been traded? Check by originalRosterId (not slot)
      const tradeKey     = `${round}-${originalRosterId}`;
      const currentOwner = tradeMap[tradeKey] !== undefined
        ? tradeMap[tradeKey]
        : originalRosterId;

      if (currentOwner === myRosterId) {
        return { overall, round, pick: inRound, picksAway: overall - nextOverall };
      }
    }
    return null;
  }

  // ── Derive live/upcoming items from status cache ────────
  function _deriveItems(mySleeperUid) {
    const live = [], upcoming = [];
    const now  = Date.now();

    for (const [leagueId, status] of _statusCache) {
      const meta = _leagueMeta.get(leagueId) || {};

      if (status.status === "drafting" || status.status === "paused") {
        const myNext     = _computeMyNextPick(status, mySleeperUid);
        const onTheClock = myNext?.picksAway === 0;
        live.push({
          leagueId,
          leagueName:     status.leagueName || meta.leagueName || leagueId,
          tournamentName: meta.tournamentName || null,
          tid:            status.tid || meta.tid || null,
          source:         status.source || meta.source || "league",
          draftId:        status.draftId,
          status:         status.status,
          picksMade:      status.picksMade || 0,
          totalPicks:     status.totalPicks || null,
          nextPick:       status.nextPick   || null,
          myNextPick:     myNext,
          picksUntilMe:   myNext?.picksAway ?? null,
          onTheClock
        });
      } else if (status.status === "pre_draft" && status.startTime && status.startTime > now) {
        upcoming.push({
          leagueId,
          leagueName:     status.leagueName || meta.leagueName || leagueId,
          tournamentName: meta.tournamentName || null,
          tid:            status.tid || meta.tid || null,
          source:         status.source || meta.source || "league",
          draftId:        status.draftId,
          startTime:      status.startTime
        });
      }
    }

    upcoming.sort((a, b) => a.startTime - b.startTime);
    return { live, upcoming };
  }

  // ── Determine poll interval for a given status ─────────
  // Returns ms to wait, or null to use realtime listener
  function _pollInterval(status) {
    const now = Date.now();
    if (!status) return 15 * 60 * 1000;

    if (status.status === "drafting" || status.status === "paused") {
      return null; // realtime listener
    }
    if (status.status === "pre_draft" && status.startTime) {
      const diff = status.startTime - now;
      if (diff <= 0)             return 30 * 1000;
      if (diff < 3600000)        return 60 * 1000;       // <1h  → 60s
      if (diff < 24 * 3600000)   return 5  * 60 * 1000;  // <24h → 5min
      return 15 * 60 * 1000;                              // 24h+ → 15min
    }
    return 15 * 60 * 1000;
  }

  // ── Attach Firebase realtime listener for one league ───
  function _attachListener(leagueId) {
    const entry = _timers.get(leagueId) || {};
    if (entry.fbListener) return; // already attached
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }

    const ref     = GMD.child(`${FB_STATUS_PATH}/${leagueId}`);
    const handler = ref.on("value", async snap => {
      const status = snap.val();
      if (!status) return;
      _statusCache.set(leagueId, status);
      if (status.status === "complete") {
        _detachLeague(leagueId);
      }
      await _redraw();
    });

    entry.fbListener = handler;
    entry.ref        = ref;
    _timers.set(leagueId, entry);
  }

  function _detachListener(leagueId) {
    const entry = _timers.get(leagueId);
    if (entry?.ref && entry?.fbListener) {
      entry.ref.off("value", entry.fbListener);
      entry.fbListener = null;
      entry.ref        = null;
    }
  }

  function _detachLeague(leagueId) {
    _detachListener(leagueId);
    const entry = _timers.get(leagueId);
    if (entry?.timer) clearTimeout(entry.timer);
    _timers.delete(leagueId);
    _statusCache.delete(leagueId);
  }

  // ── Schedule next poll for a league ───────────────────
  function _schedulePoll(leagueId, delay) {
    const entry = _timers.get(leagueId) || {};
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => _pollLeague(leagueId), delay);
    _timers.set(leagueId, entry);
  }

  // ── Poll one league directly against Sleeper ──────────
  // Client is self-sufficient — no Firebase dependency for discovery.
  async function _pollLeague(leagueId) {
    try {
      const status = await _checkSleeperDirect(leagueId);

      if (!status) {
        // No active/upcoming draft — retry in 15 min
        _statusCache.set(leagueId, {
          status: "pre_draft", picks_hash: "client-checked",
          startTime: null, updatedAt: Date.now()
        });
        _schedulePoll(leagueId, 15 * 60 * 1000);
        await _redraw();
        return;
      }

      if (status.status === "complete") {
        _detachLeague(leagueId);
        await _redraw();
        return;
      }

      _statusCache.set(leagueId, status);
      const interval = _pollInterval(status);
      if (interval === null) {
        _attachListener(leagueId); // live — use Firebase realtime listener
      } else {
        _schedulePoll(leagueId, interval);
      }
      await _redraw();
    } catch(e) {
      _schedulePoll(leagueId, 5 * 60 * 1000);
    }
  }

  // ── Redraw pill + panel from current cache ─────────────
  async function _redraw() {
    const myUid = await _getMySleeperUserId();
    const items = _deriveItems(myUid);
    _lastItems  = items;
    _updatePill(items);
    if (_tickerOpen) _renderPanel(items);
  }

  // ── Check one league directly against Sleeper ──────────
  // Returns a status object or null if no active/upcoming draft.
  async function _checkSleeperDirect(leagueId) {
    const r = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`);
    if (!r.ok) return null;
    const drafts = await r.json();
    if (!Array.isArray(drafts) || !drafts.length) return null;

    const priority = { drafting: 0, paused: 1, pre_draft: 2, complete: 3 };
    const draft = drafts
      .filter(d => d.status !== "complete")
      .sort((a, b) =>
        (priority[a.status] ?? 9) - (priority[b.status] ?? 9) ||
        (b.start_time || 0) - (a.start_time || 0)
      )[0];

    if (!draft) return null;

    const now     = Date.now();
    const startMs = draft.start_time
      ? (draft.start_time > 1e12 ? draft.start_time : draft.start_time * 1000)
      : null;

    const status = {
      status:            draft.status,
      draftId:           draft.draft_id,
      draftType:         draft.type,
      totalPicks:        (draft.settings?.teams || 12) * (draft.settings?.rounds || 15) || null,
      draft_order:       draft.draft_order       || {},
      slot_to_roster_id: draft.slot_to_roster_id || {},
      traded_picks:      [],
      picksMade:         0,
      picks_hash:        "client-checked",
      startTime:         startMs,
      updatedAt:         now
    };

    if (draft.status === "drafting" || draft.status === "paused") {
      try {
        const pr = await fetch(`https://api.sleeper.app/v1/draft/${draft.draft_id}/picks`);
        if (pr.ok) {
          const picks = await pr.json();
          status.picksMade  = Array.isArray(picks) ? picks.length : 0;
          status.picks_hash = `${status.picksMade}:${picks[picks.length-1]?.player_id || ""}`;
        }
      } catch(e) {}
    }

    return status;
  }

  // ── Load all statuses on init — Sleeper-first, Firebase as supplement ──
  // Check every league directly against Sleeper on load. No Worker dependency.
  // Firebase draftStatus is used only to enrich live drafts with traded_picks
  // data that the Worker may have already fetched.
  async function _initialLoad() {
    // Fire all Sleeper checks in parallel — this is the authoritative source
    _debugSleeperResults = [];
    await Promise.allSettled([..._leagueMeta.keys()].map(async leagueId => {
      const meta = _leagueMeta.get(leagueId) || {};
      try {
        const status = await _checkSleeperDirect(leagueId);
        if (status) {
          _statusCache.set(leagueId, status);
          _debugSleeperResults.push({ leagueId, name: meta.leagueName, result: status.status, startTime: status.startTime });
          // Seed draftStatus in Firebase so the Worker picks this up immediately
          // in its urgent queue rather than waiting for the pending shuffle.
          // Fire-and-forget — client display doesn't depend on this write.
          GMD.child(`${FB_STATUS_PATH}/${leagueId}`).update({
            status:    status.status,
            draftId:   status.draftId   || null,
            startTime: status.startTime || null,
            picks_hash: status.picks_hash,
            updatedAt:  status.updatedAt
          }).catch(() => {});
        } else {
          _statusCache.set(leagueId, { status: "pre_draft", picks_hash: "client-checked", startTime: null, updatedAt: Date.now() });
          _debugSleeperResults.push({ leagueId, name: meta.leagueName, result: "no draft" });
        }
      } catch(e) {
        console.warn("[DraftTicker] Sleeper check failed for", leagueId, e.message);
        _debugSleeperResults.push({ leagueId, name: meta.leagueName, result: `ERROR: ${e.message}` });
      }
    }));

    // Supplement with Firebase data for any live drafts — Worker may have
    // richer pick/traded_picks data from its last run
    try {
      const snap = await GMD.child(FB_STATUS_PATH).once("value");
      const all  = snap.val() || {};
      for (const [leagueId, fbStatus] of Object.entries(all)) {
        if (!_leagueMeta.has(leagueId)) continue;
        const cached = _statusCache.get(leagueId);
        // Only use Firebase data if it's richer (has traded picks or more picks)
        if (cached && (cached.status === "drafting" || cached.status === "paused")) {
          if (fbStatus.traded_picks?.length > 0 && !cached.traded_picks?.length) {
            _statusCache.set(leagueId, { ...cached, traded_picks: fbStatus.traded_picks });
          }
        }
      }
    } catch(e) { /* Firebase supplement is best-effort */ }
  }

  // ── Time formatting ────────────────────────────────────
  function _fmtDateTime(ms) {
    const d = new Date(ms);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  function _timeUntil(ms) {
    const diff = ms - Date.now();
    if (diff <= 0) return "Starting soon";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h >= 48) return `in ${Math.floor(h / 24)} days`;
    if (h >= 24) return `in ${Math.floor(h / 24)}d ${h % 24}h`;
    if (h > 0)   return `in ${h}h ${m}m`;
    return `in ${m}m`;
  }

  // ── Render panel ───────────────────────────────────────
  function _renderPanel(items) {
    const body = _body();
    if (!body) return;

    if (!items.live.length && !items.upcoming.length) {
      body.innerHTML = `<div class="draft-ticker-empty">No active or upcoming drafts right now.</div>`;
      return;
    }

    let html = "";

    if (items.live.length) {
      html += `<div class="draft-ticker-section-label">🔴 Live Drafts</div>`;
      for (const item of items.live) {
        const isPaused = item.status === "paused";
        const icon     = item.onTheClock ? "🔔" : (isPaused ? "⏸" : "📋");

        let statusHtml;
        if (item.onTheClock) {
          statusHtml = `<div class="draft-ticker-row-status draft-ticker-row-status--alarm">ON THE CLOCK!</div>`;
        } else if (isPaused) {
          statusHtml = `<div class="draft-ticker-row-status" style="color:var(--color-text-dim)">Paused</div>`;
        } else if (item.picksUntilMe != null) {
          statusHtml = `<div class="draft-ticker-row-status draft-ticker-row-status--live">${item.picksUntilMe} pick${item.picksUntilMe !== 1 ? "s" : ""} away</div>`;
        } else {
          statusHtml = `<div class="draft-ticker-row-status draft-ticker-row-status--live">LIVE</div>`;
        }

        let detail = "";
        if (item.nextPick) {
          const pauseNote = isPaused ? " · <span style='color:var(--color-text-dim)'>⏸ Paused</span>" : "";
          const nextStr   = `Current: Rd ${item.nextPick.round} Pk ${item.nextPick.pick}`;
          const myLabel   = item.myNextPick
            ? (item.onTheClock
                ? `<strong style="color:#f87171">My Next: Rd ${item.myNextPick.round} Pk ${item.myNextPick.pick}</strong>`
                : `My Next: Rd ${item.myNextPick.round} Pk ${item.myNextPick.pick}`)
            : "";
          detail = `<div class="draft-ticker-row-detail">${nextStr}${myLabel ? " · " + myLabel : ""}</div>`;
        }

        const nav = item.tid
          ? `data-ticker-tid="${_esc(item.tid)}"`
          : `data-ticker-league="${_esc(item.leagueId)}"`;

        html += `
          <div class="draft-ticker-row" ${nav}>
            <div class="draft-ticker-row-icon">${icon}</div>
            <div class="draft-ticker-row-info">
              <div class="draft-ticker-row-name">${_esc(item.leagueName)}</div>
              ${item.tournamentName ? `<div class="draft-ticker-row-meta">${_esc(item.tournamentName)}</div>` : ""}
              ${detail}
            </div>
            ${statusHtml}
          </div>`;
      }
    }

    if (items.upcoming.length) {
      html += `<div class="draft-ticker-section-label">📅 Upcoming Drafts</div>`;
      for (const item of items.upcoming) {
        const nav = item.tid
          ? `data-ticker-tid="${_esc(item.tid)}"`
          : `data-ticker-league="${_esc(item.leagueId)}"`;
        html += `
          <div class="draft-ticker-row" ${nav}>
            <div class="draft-ticker-row-icon">📅</div>
            <div class="draft-ticker-row-info">
              <div class="draft-ticker-row-name">${_esc(item.leagueName)}</div>
              ${item.tournamentName ? `<div class="draft-ticker-row-meta">${_esc(item.tournamentName)}</div>` : ""}
              <div class="draft-ticker-row-detail">${_esc(_fmtDateTime(item.startTime))}</div>
            </div>
            <div class="draft-ticker-row-status draft-ticker-row-status--soon">${_timeUntil(item.startTime)}</div>
          </div>`;
      }
    }

    // Non-Sleeper note — shown if user has any MFL or Yahoo leagues linked
    if (_hasMflOrYahoo) {
      html += `<div class="draft-ticker-nonsleeper-note">⚠️ MFL and Yahoo drafts aren't tracked live — open the league directly to see the latest picks.</div>`;
    }

    body.innerHTML = html;

    body.querySelectorAll("[data-ticker-tid]").forEach(row => {
      row.addEventListener("click", () => {
        _closePanel();
        if (typeof DLRNav !== "undefined") DLRNav.go("tournament");
        setTimeout(() => {
          if (typeof _openTournamentView === "function") _openTournamentView(row.dataset.tickerTid);
        }, 150);
      });
    });

    body.querySelectorAll("[data-ticker-league]").forEach(row => {
      row.addEventListener("click", () => {
        _closePanel();
        const leagueId = row.dataset.tickerLeague;
        const profile  = typeof Auth !== "undefined" ? Auth.getCurrentProfile() : null;
        if (!profile?.leagues) return;
        const match = Object.entries(profile.leagues)
          .find(([, l]) => String(l.leagueId || l.league_id || "") === leagueId);
        if (match && typeof Profile !== "undefined") {
          Profile.openLeagueDetail(match[0]);
          setTimeout(() => {
            const sel = document.getElementById("detail-tab-select");
            if (sel) { sel.value = "draft"; Profile.onDetailTabChange("draft"); }
          }, 350);
        }
      });
    });
  }

  // ── Update pill ────────────────────────────────────────
  function _updatePill(items) {
    const pill = _pill(), wrap = _wrap(), lbl = _label();
    if (!pill || !wrap) return;

    const hasAny  = items.live.length > 0 || items.upcoming.length > 0;
    const hasLive = items.live.length > 0;
    const alarm   = items.live.some(i => i.onTheClock);

    wrap.style.display = hasAny ? "flex" : "none";
    pill.classList.toggle("pill-live",  hasLive && !alarm);
    pill.classList.toggle("pill-alarm", alarm);
    pill.querySelector(".nav-pill-badge")?.remove();

    if (alarm) {
      const b = document.createElement("span");
      b.className = "nav-pill-badge";
      b.textContent = "🔔";
      b.style.cssText = "background:transparent;font-size:.8rem";
      pill.appendChild(b);
      if (lbl) lbl.textContent = "Your Turn!";
    } else if (hasLive) {
      const b = document.createElement("span");
      b.className = "nav-pill-badge";
      b.textContent = String(items.live.length);
      pill.appendChild(b);
      if (lbl) lbl.textContent = items.live.length === 1 ? "Live Draft" : "Live Drafts";
    } else if (items.upcoming.length) {
      if (lbl) lbl.textContent = `${items.upcoming.length} Draft${items.upcoming.length > 1 ? "s" : ""} Soon`;
    } else {
      if (lbl) lbl.textContent = "Drafts";
    }

    const drawerSec   = document.getElementById("drawer-draft-section");
    const drawerBadge = document.getElementById("drawer-draft-badge");
    if (drawerSec)   drawerSec.style.display = hasAny ? "" : "none";
    if (drawerBadge) drawerBadge.textContent  = hasAny ? String(items.live.length + items.upcoming.length) : "";
    if (typeof _syncDrawerActivity === "function") _syncDrawerActivity();
  }

  function _openPanel()  {
    const p = _panel();
    if (p) p.style.display = "";
    _tickerOpen = true;
    // Show cached state immediately, then refresh from Sleeper
    _renderPanel(_lastItems);
    // Fetch fresh data from Sleeper on every open — avoids stale state
    _refreshLiveDrafts();
  }
  function _closePanel() { const p = _panel(); if (p) p.style.display = "none"; _tickerOpen = false; }

  // Fetch fresh pick counts from Sleeper for all live/paused drafts on demand
  async function _refreshLiveDrafts() {
    const live = _lastItems.live;
    if (!live.length) return;

    const mySleeperUid = await _getMySleeperUserId();
    let changed = false;

    await Promise.allSettled(live.map(async item => {
      try {
        const [pr, tpr] = await Promise.all([
          fetch(`https://api.sleeper.app/v1/draft/${item.draftId}/picks`),
          item.draftId ? fetch(`https://api.sleeper.app/v1/draft/${item.draftId}/traded_picks`) : Promise.resolve(null)
        ]);
        if (!pr.ok) return;

        const arr         = await pr.json();
        const tradedPicks = tpr?.ok ? await tpr.json() : [];
        const picksMade   = Array.isArray(arr) ? arr.length : 0;
        const last        = Array.isArray(arr) ? arr[arr.length - 1] : null;
        const cached      = _statusCache.get(item.leagueId) || {};
        const teams       = Object.keys(cached.draft_order || {}).length || 12;
        const totalPicks  = cached.totalPicks || item.totalPicks || teams;
        const next        = picksMade + 1;

        // Update status cache with fresh data
        const updated = {
          ...cached,
          picksMade,
          traded_picks: tradedPicks,
          nextPick: picksMade < totalPicks
            ? { overall: next, round: Math.ceil(next / teams), pick: ((next - 1) % teams) + 1 }
            : null,
          picks_hash: `${picksMade}:${last?.player_id || ""}`
        };
        _statusCache.set(item.leagueId, updated);
        changed = true;
      } catch(e) {
        console.warn("[DraftTicker] refresh failed for", item.leagueId, e.message);
      }
    }));

    if (changed) {
      _lastItems = _deriveItems(mySleeperUid);
      _renderPanel(_lastItems);
    }
  }

  // ── Public: init ──────────────────────────────────────
  async function init(username) {
    _username = username;

    // Guard against duplicate listeners if init() is called more than once
    const btn   = document.getElementById("draft-ticker-btn");
    const close = document.getElementById("draft-ticker-close");
    if (btn && !btn.dataset.tickerBound) {
      btn.dataset.tickerBound = "1";
      btn.addEventListener("click", e => {
        e.stopPropagation();
        _tickerOpen ? _closePanel() : (_renderPanel(_lastItems), _openPanel());
      });
    }
    if (close && !close.dataset.tickerBound) {
      close.dataset.tickerBound = "1";
      close.addEventListener("click", e => { e.stopPropagation(); _closePanel(); });
    }
    if (!document._tickerOutsideClick) {
      document._tickerOutsideClick = true;
      document.addEventListener("click", e => {
        if (_tickerOpen && !e.target.closest("#draft-ticker-wrap")) _closePanel();
      });
    }

    // Build watch list (one-time Firebase read, writes gmd/draftWatchList)
    const watchList = await _buildWatchList();
    for (const [id, meta] of watchList) _leagueMeta.set(id, meta);

    // Load all current draft statuses in one read from gmd/draftStatus/
    await _initialLoad();

    // Schedule per-league polling or attach realtime listeners.
    // _initialLoad already checked Sleeper for every league so cache is fresh —
    // use the proper intervals directly, no aggressive 60s override.
    for (const [leagueId] of _leagueMeta) {
      const status   = _statusCache.get(leagueId);
      const interval = _pollInterval(status);
      if (interval === null) {
        _attachListener(leagueId); // live draft — Firebase realtime listener for picks
      } else {
        _schedulePoll(leagueId, interval);
      }
    }

    await _redraw();

    // Debug overlay — add ?tickerDebug=1 to URL to see step-by-step results
    if (new URLSearchParams(window.location.search).get("tickerDebug") === "1") {
      const lines = [];
      lines.push(`<b>User:</b> ${_username}`);
      lines.push(`<b>Relevant seasons:</b> ${[..._relevantSeasons()].filter(v => typeof v === "number").join(", ")}`);
      lines.push(`&nbsp;`);

      lines.push(`<b>Step 1 — Leagues found: ${_debugWatchList.size}</b>`);
      if (!_debugWatchList.size) {
        lines.push(`&nbsp;&nbsp;⚠️ NONE — user has not synced Sleeper leagues in DLR`);
      } else {
        for (const [id, m] of _debugWatchList) {
          lines.push(`&nbsp;&nbsp;✓ ${m.leagueName || id} (${id})`);
        }
      }

      lines.push(`&nbsp;`);
      lines.push(`<b>Step 2 — Sleeper API results: ${_debugSleeperResults.length} checked</b>`);
      if (!_debugSleeperResults.length) {
        lines.push(`&nbsp;&nbsp;⚠️ NO CHECKS RAN — _leagueMeta was empty`);
      } else {
        for (const r of _debugSleeperResults) {
          const icon = r.result === "no draft" ? "—"
            : r.result?.startsWith("ERROR") ? "❌"
            : (r.result === "drafting" || r.result === "paused") ? "🔴"
            : r.result === "pre_draft" ? "📅" : "?";
          const extra = r.startTime ? ` → starts ${new Date(r.startTime).toLocaleString()}` : "";
          lines.push(`&nbsp;&nbsp;${icon} ${r.name || r.leagueId}: <b>${r.result}</b>${extra}`);
        }
      }

      lines.push(`&nbsp;`);
      const { live, upcoming } = _lastItems;
      lines.push(`<b>Step 3 — Ticker shows: ${live.length} live, ${upcoming.length} upcoming</b>`);
      for (const i of live)     lines.push(`&nbsp;&nbsp;🔴 ${i.leagueName}`);
      for (const i of upcoming) lines.push(`&nbsp;&nbsp;📅 ${i.leagueName} — ${new Date(i.startTime).toLocaleString()}`);
      if (!live.length && !upcoming.length) lines.push(`&nbsp;&nbsp;(nothing to show)`);

      // Render overlay
      const existing = document.getElementById("ticker-debug-overlay");
      if (existing) existing.remove();
      const el = document.createElement("div");
      el.id = "ticker-debug-overlay";
      el.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:99999;background:#0a0e1a;color:#e2e8f0;font-family:monospace;font-size:11px;padding:12px;max-height:50vh;overflow-y:auto;border-top:2px solid #f0b429";
      el.innerHTML = `<div style="font-weight:700;color:#f0b429;margin-bottom:8px">🔍 DraftTicker Debug <button onclick="document.getElementById('ticker-debug-overlay').remove()" style="background:#f0b429;border:none;color:#000;padding:2px 8px;cursor:pointer;border-radius:3px;margin-left:8px">Close</button></div>${lines.map(l => `<div style="padding:1px 0;border-bottom:1px solid #1a2236">${l}</div>`).join("")}`;
      document.body.appendChild(el);
    }
  }

  // ── Public: stop ─────────────────────────────────────
  function stop() {
    for (const id of [..._timers.keys()]) _detachLeague(id);
    _username = _mySleeperUserId = null;
    _lastItems = { live: [], upcoming: [] };
    _statusCache.clear();
    _leagueMeta.clear();
    _hasMflOrYahoo = false;
    _closePanel();
    const w = _wrap();
    if (w) w.style.display = "none";
  }

  // ── Public: refreshForModal ──────────────────────────
  // Called by _openGlobalDraftModal — runs the same Sleeper refresh
  // as _refreshLiveDrafts but returns the updated items so the modal
  // can re-render without depending on the ticker panel being open.
  async function refreshForModal() {
    await _refreshLiveDrafts();
    return _lastItems;
  }

  function diagnose() {
    const report = {
      username:      _username,
      leagueCount:   _leagueMeta.size,
      leagues:       [..._leagueMeta.entries()].map(([id, m]) => ({ id, name: m.leagueName })),
      sleeperChecks: _debugSleeperResults,
      statusCache:   Object.fromEntries([..._statusCache.entries()].map(([id, s]) => [id, {
        status:    s.status,
        startTime: s.startTime ? new Date(s.startTime).toISOString() : null,
        draftId:   s.draftId || null
      }])),
      live:        _lastItems.live.map(i => i.leagueName),
      upcoming:    _lastItems.upcoming.map(i => ({ name: i.leagueName, starts: new Date(i.startTime).toISOString() })),
      pillVisible: document.getElementById("draft-ticker-wrap")?.style.display !== "none"
    };
    console.log("[DraftTicker.diagnose]", JSON.stringify(report, null, 2));
    return report;
  }

  return { init, stop, openPanel: _openPanel, closePanel: _closePanel, refreshForModal, getLastItems: () => _lastItems, diagnose };

})();
