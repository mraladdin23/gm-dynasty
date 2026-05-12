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

    // No Firebase write needed — Worker cron builds the watch list itself
    // by scanning gmd/users directly. Client just reads draftStatus.
    console.log(`[DraftTicker] Monitoring ${watchList.size} local leagues`);
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

  // ── Poll one league status from Firebase ───────────────
  async function _pollLeague(leagueId) {
    try {
      const snap   = await GMD.child(`${FB_STATUS_PATH}/${leagueId}`).once("value");
      const status = snap.val();

      if (status?.status === "complete") {
        _detachLeague(leagueId);
        await _redraw();
        return;
      }
      // null status means Worker hasn't written yet — keep existing cache,
      // retry in 5 minutes rather than removing the league from the display
      if (!status) {
        _schedulePoll(leagueId, 5 * 60 * 1000);
        return;
      }

      _statusCache.set(leagueId, status);
      const interval = _pollInterval(status);
      if (interval === null) {
        _attachListener(leagueId);
      } else {
        _schedulePoll(leagueId, interval);
      }
      await _redraw();
    } catch(e) {
      _schedulePoll(leagueId, 5 * 60 * 1000); // retry in 5min on error
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

  // ── Load all current statuses in one Firebase read ─────
  async function _initialLoad() {
    try {
      const snap = await GMD.child(FB_STATUS_PATH).once("value");
      const all  = snap.val() || {};
      for (const [leagueId, status] of Object.entries(all)) {
        if (_leagueMeta.has(leagueId)) {
          _statusCache.set(leagueId, status);
        }
      }
    } catch(e) { console.warn("[DraftTicker] Initial status load failed:", e.message); }

    // For leagues with no status (never checked by Worker) or stale status
    // (Worker may not have cycled through yet), check Sleeper directly.
    // This makes the client self-sufficient for draft discovery — no Worker lag.
    const now          = Date.now();
    const thirtyMinAgo = now - 30 * 60 * 1000;
    const toCheck      = [];
    for (const [leagueId] of _leagueMeta) {
      const s = _statusCache.get(leagueId);
      if (!s) { toCheck.push(leagueId); continue; }
      if (s.status === "drafting" || s.status === "paused") continue; // already live
      if (s.status === "complete") continue;
      // pre_draft with no startTime and stale — re-check directly
      if (s.status === "pre_draft" && !s.startTime
          && s.updatedAt && s.updatedAt < thirtyMinAgo) {
        toCheck.push(leagueId);
      }
    }

    if (!toCheck.length) return;
    console.log(`[DraftTicker] Checking ${toCheck.length} leagues directly from Sleeper`);

    await Promise.allSettled(toCheck.map(async leagueId => {
      try {
        const r = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`);
        if (!r.ok) return;
        const drafts = await r.json();
        if (!Array.isArray(drafts) || !drafts.length) return;

        // Find the most relevant draft (drafting > paused > pre_draft, then newest)
        const priority = { drafting: 0, paused: 1, pre_draft: 2, complete: 3 };
        const draft = drafts.sort((a, b) =>
          (priority[a.status] ?? 9) - (priority[b.status] ?? 9) ||
          (b.start_time || 0) - (a.start_time || 0)
        )[0];

        if (!draft || draft.status === "complete") return;

        const startMs = draft.start_time
          ? (draft.start_time > 1e12 ? draft.start_time : draft.start_time * 1000)
          : null;

        // Build a status object compatible with what the Worker would write
        const status = {
          status:            draft.status,
          draftId:           draft.draft_id,
          draftType:         draft.type,
          totalPicks:        draft.settings?.teams * draft.settings?.rounds || null,
          draft_order:       draft.draft_order || {},
          slot_to_roster_id: draft.slot_to_roster_id || {},
          traded_picks:      [],
          picksMade:         0,
          picks_hash:        "client-checked",
          startTime:         startMs,
          updatedAt:         now
        };

        // For live/paused drafts, also fetch current picks
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

        _statusCache.set(leagueId, status);
      } catch(e) {
        console.warn("[DraftTicker] Direct Sleeper check failed for", leagueId, e.message);
      }
    }));
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

    // Schedule per-league polling or attach realtime listeners
    for (const [leagueId] of _leagueMeta) {
      const status   = _statusCache.get(leagueId);
      const interval = _pollInterval(status);
      if (interval === null) {
        _attachListener(leagueId);
      } else {
        // First check within 60s regardless of full interval
        _schedulePoll(leagueId, Math.min(interval, 60 * 1000));
      }
    }

    await _redraw();
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

  return { init, stop, openPanel: _openPanel, closePanel: _closePanel, refreshForModal, getLastItems: () => _lastItems };

})();
