// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Player Card Modal
//  Ported from SleeperBid cap.js showPlayerCard / pcLoadYear
//  Shows player bio, season stats summary, and weekly game log.
// ─────────────────────────────────────────────────────────

const DLRPlayerCard = (() => {

  let _playerId   = null;
  let _year       = new Date().getFullYear();
  let _weekCache  = {};
  const YEARS     = [2022, 2023, 2024, 2025, 2026].filter(y => y <= new Date().getFullYear());

  const POS_COLOR = {
    QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff",
    TE:"#ffc94d", K:"#9ca3af", DEF:"#9ca3af"
  };

  // ── Show ──────────────────────────────────────────────────
  async function show(playerId, playerName) {
    if (!playerId && !playerName) return;

    _playerId  = playerId || null;
    _weekCache = {};
    _year      = new Date().getFullYear();

    _buildModal();

    // Refresh player cache if needed (to get full bio fields)
    // Version "2" = includes age, height, weight, college, birth_date
    const cacheVer = localStorage.getItem("dlr_players_ver");
    if (cacheVer !== "2") {
      try {
        const r    = await fetch("https://api.sleeper.app/v1/players/nfl");
        const data = await r.json();
        localStorage.setItem("dlr_players", JSON.stringify(data));
        localStorage.setItem("dlr_players_ver", "2");
      } catch(e) { /* keep old cache */ }
    }

    // Populate header AFTER cache refresh
    _populateHeader(playerId, playerName);
    await _loadYear(_year);
  }

  function close() {
    document.getElementById("dlr-player-card-modal")?.remove();
  }

  // ── Build modal DOM ───────────────────────────────────────
  function _buildModal() {
    document.getElementById("dlr-player-card-modal")?.remove();

    const modal = document.createElement("div");
    modal.id    = "dlr-player-card-modal";
    modal.className = "modal-overlay";
    modal.style.zIndex = "800";
    modal.innerHTML = `
      <div class="modal-box pc-modal-box">
        <div class="pc-header">
          <div class="pc-photo-wrap">
            <img id="pc-photo" src="" alt="" onerror="this.style.display='none'" />
            <div id="pc-pos-badge" class="pc-pos-badge"></div>
          </div>
          <div class="pc-identity">
            <div id="pc-name" class="pc-name"></div>
            <div id="pc-team" class="pc-team"></div>
            <div id="pc-bio" class="pc-bio"></div>
            <div id="pc-owner" class="pc-owner"></div>
          </div>
          <button class="modal-close" onclick="DLRPlayerCard.close()">✕</button>
        </div>

        <!-- Year tabs -->
        <div class="pc-year-tabs" id="pc-year-tabs"></div>

        <!-- Season summary stat boxes -->
        <div class="pc-season-summary" id="pc-season-summary"></div>

        <!-- Weekly game log -->
        <div class="pc-game-log-wrap">
          <div id="pc-game-log"></div>
        </div>
      </div>`;

    document.body.appendChild(modal);
    modal.addEventListener("click", e => { if (e.target === modal) close(); });
  }

  // ── Populate header ───────────────────────────────────────
  function _populateHeader(playerId, playerName) {
    let allPlayers = {};
    try { allPlayers = JSON.parse(localStorage.getItem("dlr_players") || "{}"); } catch(e) {}

    const p      = allPlayers[playerId] || {};
    const name   = p.first_name ? `${p.first_name} ${p.last_name}` : (playerName || "Unknown");
    const pos    = (p.fantasy_positions?.[0] || p.position || "—").toUpperCase();
    const team   = p.team || "FA";
    const color  = POS_COLOR[pos] || "#9ca3af";

    console.log("[PlayerCard] player data:", { playerId, pos, team, age: p.age, height: p.height, weight: p.weight, college: p.college, years_exp: p.years_exp, status: p.status });

    const photoEl = document.getElementById("pc-photo");
    if (playerId && photoEl) {
      photoEl.src = `https://sleepercdn.com/content/nfl/players/${playerId}.jpg`;
      photoEl.onerror = () => { photoEl.style.display = "none"; };
    }

    const posEl = document.getElementById("pc-pos-badge");
    if (posEl) {
      posEl.textContent      = pos;
      posEl.style.background = color + "33";
      posEl.style.color      = color;
      posEl.style.border     = `1px solid ${color}66`;
    }

    document.getElementById("pc-name").textContent = name;

    // Team + position line
    const teamEl = document.getElementById("pc-team");
    if (teamEl) teamEl.textContent = `${team} · ${pos}`;

    // Rich bio — check all possible fields
    const bio = [];
    const age = p.age || (p.birth_date ? _calcAge(p.birth_date) : null);
    if (age)              bio.push(`Age ${age}`);
    if (p.height)         bio.push(_fmtHeight(p.height));
    if (p.weight)         bio.push(`${p.weight} lbs`);
    if (p.college)        bio.push(p.college);
    if (p.years_exp === 0) bio.push("Rookie");
    else if (p.years_exp != null) bio.push(`Yr ${p.years_exp + 1}`);
    if (p.depth_chart_order === 1) bio.push("Starter");
    if (p.search_rank && p.search_rank < 500) bio.push(`#${p.search_rank} overall`);

    const statusBio = [];
    if (p.status && p.status !== "Active") statusBio.push(`⚠️ ${p.status}`);
    if (p.injury_status) statusBio.push(`🏥 ${p.injury_status}`);
    if (p.practice_description) statusBio.push(p.practice_description);

    const bioEl = document.getElementById("pc-bio");
    if (bioEl) {
      bioEl.innerHTML = bio.length
        ? `<div>${bio.join(" · ")}</div>${statusBio.length ? `<div style="margin-top:4px;color:var(--color-red);font-size:.78rem;">${statusBio.join(" · ")}</div>` : ""}`
        : (statusBio.length ? statusBio.join(" · ") : "");
    }

    // Year tabs
    const tabsEl = document.getElementById("pc-year-tabs");
    if (tabsEl) {
      tabsEl.innerHTML = YEARS.map(y =>
        `<button class="pc-year-btn ${y === _year ? "pc-year-btn--active" : ""}"
          onclick="DLRPlayerCard.setYear(${y})">${y}</button>`
      ).join("");
    }
  }

  // ── Year switch ───────────────────────────────────────────
  async function setYear(y) {
    _year = y;
    document.querySelectorAll(".pc-year-btn").forEach(b => {
      b.classList.toggle("pc-year-btn--active", parseInt(b.textContent) === y);
    });
    await _loadYear(y);
  }

  // ── Load season stats + game log ──────────────────────────
  async function _loadYear(year) {
    if (!_playerId) { _showNoStats(); return; }

    const sumEl = document.getElementById("pc-season-summary");
    const logEl = document.getElementById("pc-game-log");
    if (!sumEl || !logEl) return;

    sumEl.innerHTML = `<div class="pc-loading">Loading ${year} stats…</div>`;
    logEl.innerHTML = "";

    try {
      // Season totals from bulk stats endpoint
      const bulkKey = `dlr_stats_${year}`;
      let bulkData  = null;
      try { bulkData = JSON.parse(localStorage.getItem(bulkKey) || "null"); } catch(e) {}
      if (!bulkData) {
        const r = await fetch(
          `https://api.sleeper.app/v1/stats/nfl/regular/${year}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE&position[]=K`
        );
        if (r.ok) {
          bulkData = await r.json();
          try { localStorage.setItem(bulkKey, JSON.stringify(bulkData)); } catch(e) {}
        }
      }

      const seasonStats = bulkData?.[_playerId] || null;

      // Weekly game log
      let weeklyArr = _weekCache[year] || null;
      const ssKey   = `dlr_pcw_${_playerId}_${year}`;
      if (!weeklyArr) {
        try { weeklyArr = JSON.parse(sessionStorage.getItem(ssKey) || "null"); } catch(e) {}
      }
      if (!weeklyArr) {
        const weekResults = await Promise.all(
          Array.from({ length: 18 }, (_, i) => i + 1).map(w =>
            fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${year}/${w}?season_type=regular`)
              .then(r => r.ok ? r.json() : null)
              .then(data => data?.[_playerId]?.pts_ppr != null
                ? { week: w, ...data[_playerId] } : null)
              .catch(() => null)
          )
        );
        weeklyArr = weekResults.filter(Boolean);
        if (weeklyArr.length) {
          _weekCache[year] = weeklyArr;
          try { sessionStorage.setItem(ssKey, JSON.stringify(weeklyArr)); } catch(e) {}
        }
      }

      if (!seasonStats && !weeklyArr?.length) {
        _showNoStats(sumEl, logEl, year);
        return;
      }

      // Render summary boxes
      const st  = seasonStats || {};
      const gp  = st.gp || weeklyArr?.length || 1;
      const tot = st.pts_ppr || weeklyArr?.reduce((s, w) => s + (w.pts_ppr || 0), 0) || 0;
      const avg = tot && gp ? (tot / gp).toFixed(1) : null;

      const stats = [
        ["Total Pts", tot ? tot.toFixed(1) : null],
        ["Avg/Gm",    avg],
        ["GP",        gp || null],
        st.pass_yd ? ["Pass Yd", Math.round(st.pass_yd)] : null,
        st.pass_td ? ["Pass TD", st.pass_td]              : null,
        st.pass_int? ["INT",     st.pass_int]              : null,
        st.rush_yd ? ["Rush Yd", Math.round(st.rush_yd)]  : null,
        st.rush_td ? ["Rush TD", st.rush_td]               : null,
        st.rec     ? ["Rec",     st.rec]                   : null,
        st.rec_yd  ? ["Rec Yd",  Math.round(st.rec_yd)]   : null,
        st.rec_td  ? ["Rec TD",  st.rec_td]                : null,
      ].filter(Boolean).filter(([, v]) => v !== null && v !== undefined && v !== 0);

      sumEl.innerHTML = stats.length
        ? `<div class="pc-stats-grid">
            ${stats.map(([l, v]) => `
              <div class="pc-stat-box">
                <div class="pc-stat-val">${v}</div>
                <div class="pc-stat-lbl">${l}</div>
              </div>`).join("")}
           </div>`
        : `<div class="pc-loading">No stats for ${year}.</div>`;

      // Game log
      if (!weeklyArr?.length) {
        logEl.innerHTML = `<div class="pc-no-weekly">Season totals shown above. Weekly breakdown not available.</div>`;
        return;
      }

      const weeks = [...weeklyArr].sort((a, b) => (a.week || 0) - (b.week || 0));
      logEl.innerHTML = `
        <div class="pc-log-title">Game Log</div>
        <table class="pc-log-table">
          <thead>
            <tr>
              <th>Wk</th><th>Pts</th><th>Stats</th>
            </tr>
          </thead>
          <tbody>
            ${weeks.map(w => {
              const pts   = w.pts_ppr != null ? w.pts_ppr.toFixed(1) : "—";
              const color = w.pts_ppr == null ? "var(--color-text-dim)"
                          : w.pts_ppr >= 20   ? "var(--color-green)"
                          : w.pts_ppr >= 10   ? "var(--color-text)"
                          : "var(--color-red)";
              const bits = [];
              if (w.pass_yd)  bits.push(Math.round(w.pass_yd) + " Pa");
              if (w.pass_td)  bits.push(w.pass_td + " PTD");
              if (w.pass_int) bits.push(w.pass_int + " INT");
              if (w.rush_att) bits.push(w.rush_att + " car");
              if (w.rush_yd)  bits.push(Math.round(w.rush_yd) + " Ru");
              if (w.rush_td)  bits.push(w.rush_td + " RTD");
              if (w.rec)      bits.push(w.rec + "/" + Math.round(w.rec_yd || 0) + " Re");
              if (w.rec_td)   bits.push(w.rec_td + " ReTD");
              return `<tr>
                <td>Wk ${w.week}</td>
                <td style="color:${color};font-weight:700;">${pts}</td>
                <td>${bits.join(" · ") || "—"}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>`;

    } catch(e) {
      if (sumEl) sumEl.innerHTML = "";
      if (logEl) logEl.innerHTML = `<div class="pc-error">Could not load ${year} stats: ${e.message}</div>`;
    }
  }

  function _showNoStats(sumEl, logEl, year) {
    if (sumEl) sumEl.innerHTML = "";
    if (logEl) logEl.innerHTML = `<div class="pc-no-weekly">No stats available${year ? ` for ${year}` : ""}.</div>`;
  }

  function _calcAge(birthDate) {
    if (!birthDate) return null;
    const [y, m, d] = birthDate.split("-").map(Number);
    const today = new Date();
    let age = today.getFullYear() - y;
    if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
    return age;
  }

  function _fmtHeight(inches) {
    if (!inches) return "";
    const ft  = Math.floor(inches / 12);
    const rem = inches % 12;
    return `${ft}'${rem}"`;
  }

  return { show, close, setYear };

})();
