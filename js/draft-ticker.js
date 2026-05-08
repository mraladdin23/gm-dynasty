```javascript
// ─────────────────────────────────────────────────────────
//  GM Dynasty — Global Draft Ticker
//  Boots at login, independent of any other module.
//  Watches all active leagues (regular + tournament) for:
//    - Upcoming drafts with a scheduled start time
//    - Live/paused drafts with pick details
//    - On-the-clock alerts when it's the user's pick
//
//  Only checks Sleeper leagues for the current/upcoming NFL
//  season to avoid hammering hundreds of old league endpoints.
//  Polls every 30 seconds.
// ─────────────────────────────────────────────────────────

const DraftTicker = (() => {

  // ── State ──────────────────────────────────────────────
  let _username          = null;
  let _mySleeperUserId   = null;
  let _tickerInterval    = null;
  let _tickerOpen        = false;
  let _lastItems         = { live: [], upcoming: [] };

  // In-memory cache of raw Sleeper draft arrays per leagueId
  let _draftCache        = {}; // leagueId → [...drafts, _fetchedAt]

  // ── DOM shortcuts ──────────────────────────────────────
  const _pill  = () => document.getElementById("draft-ticker-btn");
  const _panel = () => document.getElementById("draft-ticker-panel");
  const _body  = () => document.getElementById("draft-ticker-body");
  const _wrap  = () => document.getElementById("draft-ticker-wrap");
  const _label = () => document.getElementById("draft-ticker-label");

  function _esc(s) {
    return String(s || "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;");
  }

  // ── Relevant NFL seasons ───────────────────────────────
  function _relevantSeasons() {
    const y = new Date().getFullYear();
    return new Set([
      y - 1,
      y,
      y + 1,
      String(y - 1),
      String(y),
      String(y + 1)
    ]);
  }

  // ── Get logged-in user's Sleeper user_id ──────────────
  async function _getMySleeperUserId() {
    if (_mySleeperUserId) return _mySleeperUserId;
    if (!_username) return null;

    try {
      const snap = await GMD
        .child(`users/${_username}/platforms/sleeper/userId`)
        .once("value");

      _mySleeperUserId = snap.val() || null;
    } catch(e) {}

    return _mySleeperUserId;
  }

  // ── Fetch all relevant leagues ─────────────────────────
  async function _getAllLeagues() {

    const leagues  = [];
    const relevant = _relevantSeasons();

    // ── Regular leagues ────────────────────────────────
    try {

      const leagueSnap = await GMD
        .child(`users/${_username}/leagues`)
        .once("value");

      const stored = leagueSnap.val() || {};

      let meta = {};

      try {
        const metaSnap = await GMD
          .child(`users/${_username}/leagueMeta`)
          .once("value");

        meta = metaSnap.val() || {};

      } catch(e) {}

      for (const [key, l] of Object.entries(stored)) {

        if (!l.leagueId && !l.league_id) continue;
        if (l.platform !== "sleeper") continue;

        // Skip commish-only leagues
        if (meta[key]?.isCommissioner && !meta[key]?.isOwner) continue;

        const season = l.season || l.year || 0;

        if (
          season &&
          !relevant.has(season) &&
          !relevant.has(String(season))
        ) continue;

        leagues.push({
          leagueId:   String(l.leagueId || l.league_id || ""),
          leagueName: l.leagueName || l.name || "",
          year:       season,
          source:     "league"
        });
      }

    } catch(e) {
      console.warn("[DraftTicker] Failed to load user leagues:", e.message);
    }

    // ── Tournament leagues ─────────────────────────────
    try {

      const snap = await GMD.child("tournaments").once("value");
      const all  = snap.val() || {};

      for (const [tid, t] of Object.entries(all)) {

        if (!t?.meta || !t?.leagues) continue;

        const isDiscovered = t.meta?.discoveredBy?.[_username];

        const isParticipant = Object.values(t.participants || {}).some(
          p => p.dlrLinked && p.dlrUsername === _username
        );

        if (!isDiscovered && !isParticipant) continue;

        const tournamentName = t.meta?.name || "";

        const isBatch = (v) =>
          v && typeof v === "object" && v.leagues !== undefined;

        for (const [, batch] of Object.entries(t.leagues)) {

          if (!isBatch(batch)) continue;
          if ((batch.platform || "sleeper") !== "sleeper") continue;

          const season = batch.year || 0;

          if (
            season &&
            !relevant.has(season) &&
            !relevant.has(String(season))
          ) continue;

          for (const [leagueId, l] of Object.entries(batch.leagues || {})) {

            if (leagues.some(x => x.leagueId === leagueId)) continue;

            leagues.push({
              leagueId,
              leagueName: l.name || leagueId,
              tournamentName,
              year: season,
              source: "tournament",
              tid
            });
          }
        }
      }

    } catch(e) {
      console.warn("[DraftTicker] Failed to load tournament leagues:", e.message);
    }

    console.log(`[DraftTicker] ${leagues.length} relevant leagues to check`);

    return leagues;
  }

  // ── Fetch draft list for one league ───────────────────
  async function _fetchDrafts(leagueId, bustCache) {

    const now    = Date.now();
    const cached = _draftCache[leagueId];

    if (
      !bustCache &&
      cached &&
      (now - (cached._fetchedAt || 0)) < 60000
    ) {
      return cached;
    }

    try {

      const r = await fetch(
        `https://api.sleeper.app/v1/league/${leagueId}/drafts`
      );

      if (!r.ok) return null;

      const data   = await r.json();
      const drafts = Array.isArray(data) ? data : [];

      drafts._fetchedAt = now;

      _draftCache[leagueId] = drafts;

      return drafts;

    } catch(e) {
      return null;
    }
  }

  // ── Process one league's drafts ───────────────────────
  async function _processLeague(league, mySleeperUid, bustCache) {

    const {
      leagueId,
      leagueName,
      tournamentName,
      source,
      tid
    } = league;

    const now    = Date.now();
    const drafts = await _fetchDrafts(leagueId, bustCache);

    if (!drafts) {
      return { live: [], upcoming: [] };
    }

    const live     = [];
    const upcoming = [];

    for (const d of drafts) {

      if (d.status === "complete") continue;

      // ── Live / paused drafts ─────────────────────────
      if (d.status === "drafting" || d.status === "paused") {

        let onTheClock   = false;
        let picksUntilMe = null;

        let picksMade  = 0;
        let totalPicks = null;

        let nextPick   = null;
        let myNextPick = null;

        try {

          const picksR = await fetch(
            `https://api.sleeper.app/v1/draft/${d.draft_id}/picks`
          );

          if (picksR.ok) {

            const picksArr = await picksR.json();

            picksMade = Array.isArray(picksArr)
              ? picksArr.length
              : 0;

            const totalTeams =
              Object.keys(
                d.draft_order || d.slot_to_roster_id || {}
              ).length ||
              d.settings?.teams ||
              12;

            const totalRounds =
              d.settings?.rounds || 1;

            totalPicks = totalTeams * totalRounds;

            // Current active pick
            const nextOverall  = picksMade + 1;

            const currentRound =
              Math.ceil(nextOverall / totalTeams);

            const pickInRound =
              ((nextOverall - 1) % totalTeams) + 1;

            nextPick = {
              overall: nextOverall,
              round: currentRound,
              pick: pickInRound
            };

            // ── Find user's next upcoming pick ─────────
            if (mySleeperUid && d.draft_order) {

              const mySlot = Object.entries(d.draft_order)
                .find(([uid]) => uid === mySleeperUid)?.[1];

              if (mySlot != null) {

                // Walk forward through all future picks
                for (
                  let overall = nextOverall;
                  overall <= totalPicks;
                  overall++
                ) {

                  const round =
                    Math.ceil(overall / totalTeams);

                  const pick =
                    ((overall - 1) % totalTeams) + 1;

                  // Snake draft slot logic
                  const slotThisRound =
                    round % 2 === 1
                      ? mySlot
                      : (totalTeams + 1 - mySlot);

                  if (pick === slotThisRound) {

                    myNextPick = {
                      overall,
                      round,
                      pick
                    };

                    picksUntilMe =
                      overall - nextOverall;

                    if (picksUntilMe === 0) {
                      onTheClock = true;
                    }

                    break;
                  }
                }
              }
            }
          }

        } catch(e) {}

        live.push({
          leagueId,
          leagueName,
          tournamentName,
          source,
          tid,

          draftId: d.draft_id,
          status: d.status,

          onTheClock,
          picksUntilMe,

          picksMade,
          totalPicks,

          nextPick,
          myNextPick
        });

        continue;
      }

      // ── Upcoming drafts ──────────────────────────────
      if (d.status === "pre_draft") {

        if (!d.start_time) continue;

        const startMs =
          d.start_time > 1e12
            ? d.start_time
            : d.start_time * 1000;

        if (startMs <= now) continue;

        upcoming.push({
          leagueId,
          leagueName,
          tournamentName,
          source,
          tid,

          draftId: d.draft_id,
          startTime: startMs
        });
      }
    }

    return { live, upcoming };
  }

  // ── Main gather ────────────────────────────────────────
  async function _gatherItems() {

    const allLeagues   = await _getAllLeagues();
    const mySleeperUid = await _getMySleeperUserId();

    const liveIds = new Set(
      _lastItems.live.map(i => i.leagueId)
    );

    const liveItems     = [];
    const upcomingItems = [];

    for (const league of allLeagues) {

      const bustCache = liveIds.has(league.leagueId);

      const { live, upcoming } =
        await _processLeague(
          league,
          mySleeperUid,
          bustCache
        );

      liveItems.push(...live);
      upcomingItems.push(...upcoming);
    }

    const dedup = (arr) => {

      const seen = new Set();

      return arr.filter(item => {

        if (seen.has(item.draftId)) return false;

        seen.add(item.draftId);

        return true;
      });
    };

    upcomingItems.sort((a, b) => a.startTime - b.startTime);

    return {
      live: dedup(liveItems),
      upcoming: dedup(upcomingItems)
    };
  }

  // ── Time formatting ────────────────────────────────────
  function _fmtDateTime(ms) {

    const d = new Date(ms);

    return (
      d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric"
      }) +
      " · " +
      d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit"
      })
    );
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

      body.innerHTML = `
        <div class="draft-ticker-empty">
          No active or upcoming drafts right now.
        </div>
      `;

      return;
    }

    let html = "";

    // ── Live drafts ────────────────────────────────────
    if (items.live.length) {

      html += `
        <div class="draft-ticker-section-label">
          🔴 Live Drafts
        </div>
      `;

      for (const item of items.live) {

        const isPaused = item.status === "paused";

        const icon =
          item.onTheClock
            ? "🔔"
            : (isPaused ? "⏸" : "📋");

        let statusHtml;

        if (item.onTheClock) {

          statusHtml = `
            <div class="draft-ticker-row-status draft-ticker-row-status--alarm">
              ON THE CLOCK!
            </div>
          `;

        } else if (isPaused) {

          statusHtml = `
            <div class="draft-ticker-row-status"
                 style="color:var(--color-text-dim)">
              Paused
            </div>
          `;

        } else if (item.picksUntilMe != null) {

          statusHtml = `
            <div class="draft-ticker-row-status draft-ticker-row-status--live">
              ${item.picksUntilMe} pick${item.picksUntilMe !== 1 ? "s" : ""} away
            </div>
          `;

        } else {

          statusHtml = `
            <div class="draft-ticker-row-status draft-ticker-row-status--live">
              LIVE
            </div>
          `;
        }

        let detail = "";

        if (item.picksMade != null && item.totalPicks) {

          const pct = Math.round(
            (item.picksMade / item.totalPicks) * 100
          );

          detail = `
            <div class="draft-ticker-row-detail">
              ${item.picksMade}/${item.totalPicks} picks · ${pct}%
          `;

          if (item.nextPick && !isPaused) {

            detail += `
              <br>
              Current Pick: Rd ${item.nextPick.round}
              Pick ${item.nextPick.pick}
            `;
          }

          if (item.myNextPick && !isPaused) {

            detail += `
              <br>
              My Next Pick: Rd ${item.myNextPick.round}
              Pick ${item.myNextPick.pick}
            `;
          }

          detail += `</div>`;
        }

        const nav = item.tid
          ? `data-ticker-tid="${_esc(item.tid)}"`
          : `data-ticker-league="${_esc(item.leagueId)}"`;

        html += `
          <div class="draft-ticker-row" ${nav}>

            <div class="draft-ticker-row-icon">
              ${icon}
            </div>

            <div class="draft-ticker-row-info">

              <div class="draft-ticker-row-name">
                ${_esc(item.leagueName)}
              </div>

              ${
                item.tournamentName
                  ? `
                    <div class="draft-ticker-row-meta">
                      ${_esc(item.tournamentName)}
                    </div>
                  `
                  : ""
              }

              ${detail}

            </div>

            ${statusHtml}

          </div>
        `;
      }
    }

    // ── Upcoming drafts ────────────────────────────────
    if (items.upcoming.length) {

      html += `
        <div class="draft-ticker-section-label">
          📅 Upcoming Drafts
        </div>
      `;

      for (const item of items.upcoming) {

        const nav = item.tid
          ? `data-ticker-tid="${_esc(item.tid)}"`
          : `data-ticker-league="${_esc(item.leagueId)}"`;

        html += `
          <div class="draft-ticker-row" ${nav}>

            <div class="draft-ticker-row-icon">📅</div>

            <div class="draft-ticker-row-info">

              <div class="draft-ticker-row-name">
                ${_esc(item.leagueName)}
              </div>

              ${
                item.tournamentName
                  ? `
                    <div class="draft-ticker-row-meta">
                      ${_esc(item.tournamentName)}
                    </div>
                  `
                  : ""
              }

              <div class="draft-ticker-row-detail">
                ${_esc(_fmtDateTime(item.startTime))}
              </div>

            </div>

            <div class="draft-ticker-row-status draft-ticker-row-status--soon">
              ${_timeUntil(item.startTime)}
            </div>

          </div>
        `;
      }
    }

    body.innerHTML = html;

    // ── Tournament nav ─────────────────────────────────
    body.querySelectorAll("[data-ticker-tid]").forEach(row => {

      row.addEventListener("click", () => {

        _closePanel();

        if (typeof DLRNav !== "undefined") {
          DLRNav.go("tournament");
        }

        setTimeout(() => {

          if (typeof _openTournamentView === "function") {
            _openTournamentView(row.dataset.tickerTid);
          }

        }, 150);
      });
    });

    // ── League nav ─────────────────────────────────────
    body.querySelectorAll("[data-ticker-league]").forEach(row => {

      row.addEventListener("click", () => {

        _closePanel();

        const leagueId = row.dataset.tickerLeague;

        const profile =
          typeof Auth !== "undefined"
            ? Auth.getCurrentProfile()
            : null;

        if (!profile?.leagues) return;

        const match = Object.entries(profile.leagues)
          .find(([, l]) =>
            String(l.leagueId || l.league_id || "") === leagueId
          );

        if (match && typeof Profile !== "undefined") {

          Profile.openLeagueDetail(match[0]);

          setTimeout(() => {

            const sel =
              document.getElementById("detail-tab-select");

            if (sel) {
              sel.value = "draft";
              Profile.onDetailTabChange("draft");
            }

          }, 350);
        }
      });
    });
  }

  // ── Update pill ────────────────────────────────────────
  function _updatePill(items) {

    const pill = _pill();
    const wrap = _wrap();
    const lbl  = _label();

    if (!pill || !wrap) return;

    const hasAny  =
      items.live.length > 0 ||
      items.upcoming.length > 0;

    const hasLive = items.live.length > 0;

    const alarm =
      items.live.some(i => i.onTheClock);

    wrap.style.display = hasAny ? "flex" : "none";

    pill.classList.toggle(
      "pill-live",
      hasLive && !alarm
    );

    pill.classList.toggle(
      "pill-alarm",
      alarm
    );

    pill.querySelector(".nav-pill-badge")?.remove();

    if (alarm) {

      const b = document.createElement("span");

      b.className = "nav-pill-badge";
      b.textContent = "🔔";

      b.style.cssText =
        "background:transparent;font-size:.8rem";

      pill.appendChild(b);

      if (lbl) lbl.textContent = "Your Turn!";

    } else if (hasLive) {

      const b = document.createElement("span");

      b.className = "nav-pill-badge";
      b.textContent = String(items.live.length);

      pill.appendChild(b);

      if (lbl) {
        lbl.textContent =
          items.live.length === 1
            ? "Live Draft"
            : "Live Drafts";
      }

    } else if (items.upcoming.length) {

      if (lbl) {
        lbl.textContent =
          `${items.upcoming.length} Draft${items.upcoming.length > 1 ? "s" : ""} Soon`;
      }

    } else {

      if (lbl) lbl.textContent = "Drafts";
    }

    // Mobile drawer
    const drawerSec =
      document.getElementById("drawer-draft-section");

    const drawerBadge =
      document.getElementById("drawer-draft-badge");

    const draftCount =
      items.live.length + items.upcoming.length;

    if (drawerSec) {
      drawerSec.style.display = hasAny ? "" : "none";
    }

    if (drawerBadge) {
      drawerBadge.textContent =
        hasAny ? String(draftCount) : "";
    }

    if (typeof _syncDrawerActivity === "function") {
      _syncDrawerActivity();
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

  // ── Refresh ────────────────────────────────────────────
  async function _refresh() {

    try {

      const items = await _gatherItems();

      _lastItems = items;

      console.log(
        `[DraftTicker] ${items.live.length} live, ${items.upcoming.length} upcoming`
      );

      _updatePill(items);

      if (_tickerOpen) {
        _renderPanel(items);
      }

    } catch(e) {

      console.warn(
        "[DraftTicker] refresh error:",
        e.message
      );
    }
  }

  // ── Public: init ──────────────────────────────────────
  function init(username) {

    _username = username;

    document.getElementById("draft-ticker-btn")
      ?.addEventListener("click", e => {

        e.stopPropagation();

        _tickerOpen
          ? _closePanel()
          : (_renderPanel(_lastItems), _openPanel());
      });

    document.getElementById("draft-ticker-close")
      ?.addEventListener("click", e => {

        e.stopPropagation();

        _closePanel();
      });

    document.addEventListener("click", e => {

      if (
        _tickerOpen &&
        !e.target.closest("#draft-ticker-wrap")
      ) {
        _closePanel();
      }
    });

    _refresh();

    if (_tickerInterval) {
      clearInterval(_tickerInterval);
    }

    _tickerInterval = setInterval(_refresh, 30000);
  }

  // ── Public: stop ─────────────────────────────────────
  function stop() {

    if (_tickerInterval) {

      clearInterval(_tickerInterval);

      _tickerInterval = null;
    }

    _username = null;
    _mySleeperUserId = null;

    _lastItems = {
      live: [],
      upcoming: []
    };

    _draftCache = {};

    _closePanel();

    _wrap()?.classList.remove("has-drafts");
  }

  return {
    init,
    stop,
    getLastItems: () => _lastItems
  };

})();
```
