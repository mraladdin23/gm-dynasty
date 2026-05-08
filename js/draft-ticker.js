// ─────────────────────────────────────────────────────────
//  GM Dynasty — Global Draft Ticker
//  Boots at login, independent of any other module.
//  Watches ALL active leagues (regular + tournament) for:
//    - Upcoming drafts with a scheduled start time
//    - Live drafts (currently drafting)
//    - On-the-clock alerts when it's the logged-in user's pick
//
//  Data sources:
//    - gmd/users/{username}/leagues  → regular leagues (all platforms)
//    - gmd/tournaments/              → tournament leagues (Sleeper only for live)
//  Sleeper public API used directly (no auth needed).
//  MFL/Yahoo: shown as live from cache if status = "drafting",
//             no pick-count available (manual refresh required).
//
//  Polls every 30 seconds. Resets on logout via DraftTicker.stop().
// ─────────────────────────────────────────────────────────

const DraftTicker = (() => {

  // ── State ──────────────────────────────────────────────
  let _username          = null;
  let _mySleeperUserId   = null;
  let _tickerInterval    = null;
  let _tickerOpen        = false;
  let _lastItems         = { live: [], upcoming: [] };
  // Per-leagueId timestamp of last upcoming check (5-min TTL)
  let _upcomingChecked   = {};
  // Cache of fetched Sleeper draft objects per leagueId
  let _sleeperDraftCache = {};

  // ── DOM shortcuts ──────────────────────────────────────
  const _pill  = () => document.getElementById("draft-ticker-btn");
  const _panel = () => document.getElementById("draft-ticker-panel");
  const _body  = () => document.getElementById("draft-ticker-body");
  const _wrap  = () => document.getElementById("draft-ticker-wrap");
  const _label = () => document.getElementById("draft-ticker-label");

  // ── Escape HTML ────────────────────────────────────────
  function _esc(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ── Get logged-in user's Sleeper user_id ──────────────
  async function _getMySleeperUserId() {
    if (_mySleeperUserId) return _mySleeperUserId;
    if (!_username) return null;
    try {
      const snap = await GMD.child(`users/${_username}/platforms/sleeper/userId`).once("value");
      _mySleeperUserId = snap.val() || null;
    } catch(e) { /* non-fatal */ }
    return _mySleeperUserId;
  }

  // ── Fetch all leagues the user has stored ─────────────
  // Returns a flat array of { leagueId, platform, year, leagueName, source }
  async function _getAllLeagues() {
    const leagues = [];

    // ── 1. Regular user leagues from Firebase ────────────
    try {
      const snap = await GMD.child(`users/${_username}/leagues`).once("value");
      const stored = snap.val() || {};
      for (const [, l] of Object.entries(stored)) {
        if (!l.leagueId && !l.league_id) continue;
        leagues.push({
          leagueId:   String(l.leagueId || l.league_id || ""),
          platform:   l.platform || "sleeper",
          year:       l.season   || l.year || new Date().getFullYear(),
          leagueName: l.leagueName || l.name || l.leagueId || "",
          source:     "league"
        });
      }
    } catch(e) {
      console.warn("[DraftTicker] Failed to load user leagues:", e.message);
    }

    // ── 2. Tournament leagues from Firebase ──────────────
    try {
      const snap = await GMD.child("tournaments").once("value");
      const all  = snap.val() || {};
      for (const [tid, t] of Object.entries(all)) {
        if (!t?.meta || !t?.leagues) continue;
        // Only include tournaments this user is involved in
        const isAdmin      = t.roles?.[_username]?.role === "admin" || t.roles?.[_username]?.role === "sub_admin";
        const isDiscovered = t.meta?.discoveredBy?.[_username];
        const isParticipant = Object.values(t.participants || {}).some(p =>
          p.dlrLinked && p.dlrUsername === _username
        );
        const notDraft = t.meta?.status !== "draft";
        if (!isAdmin && !isDiscovered && !isParticipant && !notDraft) continue;

        const tournamentName = t.meta?.name || "";
        const isBatch = (v) => v && typeof v === "object" && v.leagues !== undefined;

        for (const [, batch] of Object.entries(t.leagues)) {
          if (!isBatch(batch)) continue;
          for (const [leagueId, l] of Object.entries(batch.leagues || {})) {
            // Avoid duplicates — regular leagues already added above
            const alreadyAdded = leagues.some(x => x.leagueId === leagueId && x.platform === batch.platform);
            if (alreadyAdded) continue;
            leagues.push({
              leagueId:      String(leagueId),
              platform:      batch.platform || "sleeper",
              year:          batch.year || new Date().getFullYear(),
              leagueName:    l.name || leagueId,
              tournamentName,
              source:        "tournament",
              tid
            });
          }
        }
      }
    } catch(e) {
      console.warn("[DraftTicker] Failed to load tournament leagues:", e.message);
    }

    console.log(`[DraftTicker] Found ${leagues.length} leagues to check:`, leagues.map(l => `${l.platform}:${l.leagueId} (${l.leagueName})`));
    return leagues;
  }

  // ── Check one Sleeper league for live/upcoming drafts ──
  // Returns { live: [...], upcoming: [...] }
  async function _checkSleeperLeague(league, mySleeperUid) {
    const { leagueId, leagueName, tournamentName } = league;
    const now = Date.now();

    // Cache Sleeper draft objects for 60s to avoid redundant fetches
    let drafts = _sleeperDraftCache[leagueId];
    if (!drafts || (now - (drafts._fetchedAt || 0)) > 60000) {
      try {
        const r = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/drafts`);
        if (!r.ok) return { live: [], upcoming: [] };
        const data = await r.json();
        drafts = Array.isArray(data) ? data : [];
        drafts._fetchedAt = now;
        _sleeperDraftCache[leagueId] = drafts;
        console.log(`[DraftTicker] ${leagueId}: fetched ${drafts.length} draft(s)`, drafts.map(d => `${d.draft_id} status=${d.status} start_time=${d.start_time}`));
      } catch(e) {
        return { live: [], upcoming: [] };
      }
    }

    const live     = [];
    const upcoming = [];

    for (const d of drafts) {
      // ── Live draft ──────────────────────────────────
      if (d.status === "drafting") {
        let picksUntilMe = null;
        let onTheClock   = false;

        if (mySleeperUid && d.draft_order) {
          try {
            const mySlot = Object.entries(d.draft_order)
              .find(([uid]) => uid === mySleeperUid)?.[1];

            if (mySlot != null) {
              const totalTeams = Object.keys(d.draft_order).length || 12;
              const picksR     = await fetch(`https://api.sleeper.app/v1/draft/${d.draft_id}/picks`);
              if (picksR.ok) {
                const picksArr    = await picksR.json();
                const nextOverall = (Array.isArray(picksArr) ? picksArr.length : 0) + 1;
                const currentRound= Math.ceil(nextOverall / totalTeams);
                const pickInRound = ((nextOverall - 1) % totalTeams) + 1;
                // Snake: even rounds reverse slot order
                const slotThisRound = currentRound % 2 === 1
                  ? mySlot
                  : (totalTeams + 1 - mySlot);

                if (pickInRound === slotThisRound) {
                  onTheClock   = true;
                  picksUntilMe = 0;
                } else {
                  picksUntilMe = (slotThisRound - pickInRound + totalTeams) % totalTeams || totalTeams;
                }
              }
            }
          } catch(e) { /* non-fatal — show as live without pick count */ }
        }

        live.push({
          leagueId, leagueName, tournamentName,
          platform: "sleeper",
          source:   league.source,
          tid:      league.tid || null,
          onTheClock,
          picksUntilMe,
          draftId:  d.draft_id
        });
      }

      // ── Upcoming draft with scheduled time ──────────
      if (d.status === "pre_draft" && d.start_time) {
        const startMs = d.start_time > 1e12 ? d.start_time : d.start_time * 1000;
        if (startMs > now) {
          upcoming.push({
            leagueId, leagueName, tournamentName,
            platform: "sleeper",
            source:   league.source,
            tid:      league.tid || null,
            startTime: startMs,
            draftId:   d.draft_id
          });
        }
      }
    }

    return { live, upcoming };
  }

  // ── Main gather pass ───────────────────────────────────
  async function _gatherItems() {
    const allLeagues   = await _getAllLeagues();
    const mySleeperUid = await _getMySleeperUserId();
    const now          = Date.now();
    const UPCOMING_TTL = 5 * 60 * 1000; // 5 minutes

    const liveItems     = [];
    const upcomingItems = [];

    for (const league of allLeagues) {
      if (league.platform === "sleeper") {
        // Rate-limit upcoming checks per league (5-min TTL)
        const lastCheck = _upcomingChecked[league.leagueId] || 0;
        const stale     = (now - lastCheck) > UPCOMING_TTL;
        if (stale) {
          _upcomingChecked[league.leagueId] = now;
          const { live, upcoming } = await _checkSleeperLeague(league, mySleeperUid);
          liveItems.push(...live);
          upcomingItems.push(...upcoming);
        } else {
          // Still check for live (picks change fast) but skip upcoming refetch
          const { live } = await _checkSleeperLeague(league, mySleeperUid);
          liveItems.push(...live);
        }
      }
      // MFL / Yahoo: no public draft API, nothing to check without auth.
      // They'll appear if we add authenticated draft-status checks in future.
    }

    // Deduplicate by draftId in case a league appears in both regular + tournament
    const dedup = (arr) => {
      const seen = new Set();
      return arr.filter(item => {
        const key = item.draftId || `${item.leagueId}:${item.platform}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    upcomingItems.sort((a, b) => a.startTime - b.startTime);

    return {
      live:     dedup(liveItems),
      upcoming: dedup(upcomingItems)
    };
  }

  // ── Render the dropdown panel body ────────────────────
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
        const icon   = item.onTheClock ? "🔔" : "📋";
        const meta   = [item.tournamentName, item.platform].filter(Boolean).join(" · ");
        const status = item.onTheClock
          ? `<div class="draft-ticker-row-status draft-ticker-row-status--alarm">ON THE CLOCK!</div>`
          : item.picksUntilMe != null
            ? `<div class="draft-ticker-row-status draft-ticker-row-status--live">${item.picksUntilMe} pick${item.picksUntilMe !== 1 ? "s" : ""} away</div>`
            : `<div class="draft-ticker-row-status draft-ticker-row-status--live">LIVE</div>`;

        // Navigation: go to tournament draft tab if tid present, else locker
        const navAttr = item.tid
          ? `data-ticker-tid="${_esc(item.tid)}"`
          : `data-ticker-league="${_esc(item.leagueId)}"`;

        html += `
          <div class="draft-ticker-row" ${navAttr}>
            <div class="draft-ticker-row-icon">${icon}</div>
            <div class="draft-ticker-row-info">
              <div class="draft-ticker-row-name">${_esc(item.leagueName)}</div>
              ${meta ? `<div class="draft-ticker-row-meta">${_esc(meta)}</div>` : ""}
            </div>
            ${status}
          </div>`;
      }
    }

    if (items.upcoming.length) {
      html += `<div class="draft-ticker-section-label">📅 Upcoming Drafts</div>`;
      for (const item of items.upcoming) {
        const d       = new Date(item.startTime);
        const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const timeStr = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        const meta    = [item.tournamentName, item.platform].filter(Boolean).join(" · ");

        const navAttr = item.tid
          ? `data-ticker-tid="${_esc(item.tid)}"`
          : `data-ticker-league="${_esc(item.leagueId)}"`;

        html += `
          <div class="draft-ticker-row" ${navAttr}>
            <div class="draft-ticker-row-icon">📅</div>
            <div class="draft-ticker-row-info">
              <div class="draft-ticker-row-name">${_esc(item.leagueName)}</div>
              ${meta ? `<div class="draft-ticker-row-meta">${_esc(meta)}</div>` : ""}
            </div>
            <div class="draft-ticker-row-status draft-ticker-row-status--soon">${dateStr}<br>${timeStr}</div>
          </div>`;
      }
    }

    body.innerHTML = html;

    // Wire row clicks
    body.querySelectorAll("[data-ticker-tid]").forEach(row => {
      row.addEventListener("click", () => {
        _closePanel();
        // Navigate to tournaments view → open that tournament's draft tab
        if (typeof DLRTournament !== "undefined" && typeof DLRNav !== "undefined") {
          DLRNav.go("tournament");
          // Give the tournament view a moment to render before opening detail
          setTimeout(() => {
            if (typeof _openTournamentView === "function") {
              _openTournamentView(row.dataset.tickerTid);
            }
          }, 150);
        }
      });
    });

    body.querySelectorAll("[data-ticker-league]").forEach(row => {
      row.addEventListener("click", () => {
        _closePanel();
        // Open the league detail panel to its draft tab
        const leagueId = row.dataset.tickerLeague;
        if (typeof Profile !== "undefined") {
          // Find the league key that matches this leagueId
          const profile = typeof Auth !== "undefined" ? Auth.getCurrentProfile() : null;
          if (profile?.leagues) {
            const match = Object.entries(profile.leagues)
              .find(([, l]) => String(l.leagueId || l.league_id || "") === leagueId);
            if (match) {
              Profile.openLeagueDetail(match[0]);
              setTimeout(() => {
                const sel = document.getElementById("detail-tab-select");
                if (sel) {
                  sel.value = "draft";
                  Profile.onDetailTabChange("draft");
                }
              }, 350);
            }
          }
        }
      });
    });
  }

  // ── Update pill appearance ────────────────────────────
  function _updatePill(items) {
    const pill = _pill();
    const wrap = _wrap();
    const lbl  = _label();
    if (!pill || !wrap) return;

    const hasAny  = items.live.length > 0 || items.upcoming.length > 0;
    const hasLive = items.live.length > 0;
    const alarm   = items.live.some(i => i.onTheClock);

    wrap.classList.toggle("has-drafts", hasAny);

    pill.classList.toggle("draft-ticker-pill--live",  hasLive && !alarm);
    pill.classList.toggle("draft-ticker-pill--alarm", alarm);

    // Remove old badge
    pill.querySelector(".draft-ticker-badge")?.remove();

    if (alarm) {
      const badge = document.createElement("span");
      badge.className = "draft-ticker-badge";
      badge.textContent = "🔔";
      badge.style.cssText = "background:transparent;font-size:.8rem";
      pill.appendChild(badge);
      if (lbl) lbl.textContent = "Your Turn!";
    } else if (hasLive) {
      const badge = document.createElement("span");
      badge.className = "draft-ticker-badge";
      badge.textContent = String(items.live.length);
      pill.appendChild(badge);
      if (lbl) lbl.textContent = items.live.length === 1 ? "Live Draft" : "Live Drafts";
    } else if (items.upcoming.length) {
      if (lbl) lbl.textContent = `${items.upcoming.length} Draft${items.upcoming.length > 1 ? "s" : ""} Soon`;
    } else {
      if (lbl) lbl.textContent = "Drafts";
    }
  }

  // ── Panel open / close ────────────────────────────────
  function _openPanel() {
    const p = _panel();
    if (p) p.style.display = "";
    _tickerOpen = true;
  }

  function _closePanel() {
    const p = _panel();
    if (p) p.style.display = "none";
    _tickerOpen = false;
  }

  // ── Full refresh cycle ────────────────────────────────
  async function _refresh() {
    try {
      const items = await _gatherItems();
      _lastItems = items;
      console.log(`[DraftTicker] refresh complete — ${items.live.length} live, ${items.upcoming.length} upcoming`);
      _updatePill(items);
      if (_tickerOpen) _renderPanel(items);
    } catch(e) {
      console.warn("[DraftTicker] refresh error:", e.message);
    }
  }

  // ── Public: init — called from app.js after login ─────
  function init(username) {
    _username = username;

    // Wire pill toggle
    document.getElementById("draft-ticker-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (_tickerOpen) {
        _closePanel();
      } else {
        _renderPanel(_lastItems);
        _openPanel();
      }
    });

    // Close button
    document.getElementById("draft-ticker-close")?.addEventListener("click", (e) => {
      e.stopPropagation();
      _closePanel();
    });

    // Click outside to close
    document.addEventListener("click", (e) => {
      if (_tickerOpen && !e.target.closest("#draft-ticker-wrap")) {
        _closePanel();
      }
    });

    // Run immediately then every 30s
    _refresh();
    if (_tickerInterval) clearInterval(_tickerInterval);
    _tickerInterval = setInterval(_refresh, 30000);
  }

  // ── Public: stop — called on logout ──────────────────
  function stop() {
    if (_tickerInterval) { clearInterval(_tickerInterval); _tickerInterval = null; }
    _username          = null;
    _mySleeperUserId   = null;
    _lastItems         = { live: [], upcoming: [] };
    _upcomingChecked   = {};
    _sleeperDraftCache = {};
    _closePanel();
    _wrap()?.classList.remove("has-drafts");
  }

  return { init, stop };

})();
