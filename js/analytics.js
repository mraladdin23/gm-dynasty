// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — Analytics Tab
//  Ported from SleeperBid viz.js, adapted for DLR module pattern.
//  Tabs: Points Per Week · Standings Movement · Luck Index ·
//        Power Rankings · Trade Map · Draft Recap · Waiver Impact
// ─────────────────────────────────────────────────────────

const DLRAnalytics = (() => {

  let _leagueId   = null;
  let _platform   = "sleeper";
  let _initToken  = 0;
  let _activeTab  = 0;
  let _teamNames  = {};   // rosterId → display name
  let _myRosterId = null; // current user's roster id

  const TABS = [
    { id:"power",    label:"🏆 Power Rankings", fn: _renderPower      },
    { id:"luck",     label:"🍀 Luck Index",      fn: _renderLuck       },
    { id:"trades",   label:"🔄 Trade Map",        fn: _renderTrades     },
    { id:"draft",    label:"📋 Draft Recap",      fn: _renderDraftRecap },
    { id:"waivers",  label:"💎 Waivers",          fn: _renderWaivers    },
  ];

  const POS_COLOR = { QB:"#b89ffe", RB:"#18e07a", WR:"#00d4ff", TE:"#ffc94d" };

  // ── Init ──────────────────────────────────────────────────
  async function init(leagueId, platform, myUsername, myRosterId) {
    _leagueId  = leagueId;
    _platform  = platform || "sleeper";
    _activeTab = 0;
    _teamNames = {};
    _initToken++;
    const token = _initToken;

    const el = document.getElementById("dtab-analytics");
    if (!el) return;

    if (_platform !== "sleeper") {
      el.innerHTML = _loadingHTML("Loading analytics…");
      try {
        if (_platform === "mfl") {
          // For MFL we already know the roster ID — pass it directly
          _myRosterId = myRosterId || null;
          await _renderMFLAnalytics(el, leagueId, token);
        } else {
          el.innerHTML = `<div class="az-placeholder">Analytics for Yahoo leagues coming soon.</div>`;
        }
      } catch(e) {
        el.innerHTML = `<div class="az-placeholder">Could not load analytics: ${e.message}</div>`;
      }
      return;
    }

    el.innerHTML = `
      <div class="az-tabs" id="az-tab-bar">
        ${TABS.map((t, i) => `
          <button class="az-tab ${i === 0 ? "az-tab--active" : ""}" data-idx="${i}"
            onclick="DLRAnalytics.showTab(${i})">${t.label}</button>`
        ).join("")}
      </div>
      <div class="az-content" id="az-content">
        <div class="detail-loading"><div class="spinner"></div><span>Loading…</span></div>
      </div>`;

    // Pre-fetch team names
    try {
      _teamNames = await _getTeamNames(leagueId);
      if (myUsername) {
        const [rosters, users] = await Promise.all([
          SleeperAPI.getRosters(leagueId),
          SleeperAPI.getLeagueUsers(leagueId)
        ]);
        const user = (users||[]).find(u => u.username?.toLowerCase() === myUsername.toLowerCase());
        if (user) {
          const roster = (rosters||[]).find(r => r.owner_id === user.user_id);
          if (roster) _myRosterId = String(roster.roster_id);
        }
      }
    } catch(e) {}

    if (token !== _initToken) return;
    showTab(0);
  }

  function reset() {
    _leagueId   = null;
    _teamNames  = {};
    _myRosterId = null;
    _initToken++;
  }

  function showTab(idx) {
    _activeTab = idx;
    document.querySelectorAll(".az-tab").forEach((t, i) => {
      t.classList.toggle("az-tab--active", i === idx);
    });
    const content = document.getElementById("az-content");
    if (!content) return;
    content.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Loading…</span></div>`;
    TABS[idx]?.fn(content);
  }

  // ── Helpers ───────────────────────────────────────────────
  async function _getTeamNames(lid) {
    try {
      const [rosters, users] = await Promise.all([
        fetch(`https://api.sleeper.app/v1/league/${lid}/rosters`).then(r => r.json()),
        fetch(`https://api.sleeper.app/v1/league/${lid}/users`).then(r => r.json())
      ]);
      const userMap = {};
      (users||[]).forEach(u => { userMap[u.user_id] = u.metadata?.team_name || u.display_name || u.username; });
      const names = {};
      (rosters||[]).forEach(r => { names[String(r.roster_id)] = userMap[r.owner_id] || `Team ${r.roster_id}`; });
      return names;
    } catch(e) { return {}; }
  }

  async function _fetchMatchupsAllWeeks(lid, maxWeeks = 17) {
    const results = await Promise.all(
      Array.from({ length: maxWeeks }, (_, i) => i + 1).map(w =>
        fetch(`https://api.sleeper.app/v1/league/${lid}/matchups/${w}`)
          .then(r => r.ok ? r.json() : [])
          .then(data => data?.map ? data.map(m => ({ ...m, week: w })) : [])
          .catch(() => [])
      )
    );
    return results.flat();
  }

  async function _fetchTransactions(lid) {
    const results = await Promise.all(
      Array.from({ length: 17 }, (_, i) => i + 1).map(w =>
        fetch(`https://api.sleeper.app/v1/league/${lid}/transactions/${w}`)
          .then(r => r.ok ? r.json() : [])
          .catch(() => [])
      )
    );
    return results.flat();
  }

  function _loadingHTML(msg) {
    return `<div class="detail-loading"><div class="spinner"></div><span>${msg}</span></div>`;
  }
  function _esc(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function _noData(msg) {
    return `<div class="az-placeholder"><div style="font-size:2rem;margin-bottom:var(--space-3);">📭</div><div>${_esc(msg)}</div></div>`;
  }

  function _errMsg(msg) {
    return `<div class="az-error">⚠️ ${_esc(msg)}</div>`;
  }

  // ── 1. POINTS PER WEEK ────────────────────────────────────
  async function _renderPoints(el) {
    if (!_leagueId) { el.innerHTML = _noData("No league selected."); return; }
    try {
      const allMatchups = await _fetchMatchupsAllWeeks(_leagueId);
      if (!allMatchups.length) { el.innerHTML = _noData("No matchup data yet."); return; }

      // Build week → rosterId → points
      const byWeek = {};
      allMatchups.forEach(m => {
        if (!m.points && m.points !== 0) return;
        const w = m.week;
        if (!byWeek[w]) byWeek[w] = {};
        byWeek[w][String(m.roster_id)] = m.points;
      });

      const weeks     = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
      const rosterIds = Object.keys(_teamNames);
      if (!weeks.length) { el.innerHTML = _noData("Not enough data yet."); return; }

      // Compute per-team weekly scores and league avg
      const myScores  = _myRosterId ? weeks.map(w => byWeek[w]?.[_myRosterId] ?? null) : [];
      const avgScores = weeks.map(w => {
        const pts = Object.values(byWeek[w] || {}).filter(p => p > 0);
        return pts.length ? (pts.reduce((a, b) => a + b, 0) / pts.length) : null;
      });

      const allPts   = allMatchups.map(m => m.points || 0).filter(p => p > 0);
      const maxPts   = Math.max(...allPts, 1);
      const minPts   = Math.min(...allPts.filter(p => p > 0), 0);
      const chartH   = 160;
      const chartW   = Math.max(weeks.length * 40, 320);
      const pad      = { t:16, r:16, b:28, l:48 };
      const innerW   = chartW - pad.l - pad.r;
      const innerH   = chartH - pad.t - pad.b;

      function yPos(pts) {
        return pad.t + innerH - ((pts - minPts) / (maxPts - minPts + 1)) * innerH;
      }
      function xPos(i) {
        return pad.l + (i / Math.max(weeks.length - 1, 1)) * innerW;
      }

      // My team line
      const myLine = _myRosterId
        ? myScores.map((pts, i) => pts !== null ? `${i === 0 ? "M" : "L"}${xPos(i).toFixed(1)},${yPos(pts).toFixed(1)}` : null)
            .filter(Boolean).join(" ")
        : "";

      // League avg line
      const avgLine = avgScores
        .map((pts, i) => pts !== null ? `${i === 0 ? "M" : "L"}${xPos(i).toFixed(1)},${yPos(pts).toFixed(1)}` : null)
        .filter(Boolean).join(" ");

      // Best/worst week markers
      const myBest  = _myRosterId ? Math.max(...myScores.filter(p => p !== null)) : null;
      const myWorst = _myRosterId ? Math.min(...myScores.filter(p => p !== null)) : null;

      el.innerHTML = `
        <div class="az-section-title">Points Per Week</div>
        ${_myRosterId ? `
        <div class="az-legend">
          <span class="az-legend-dot" style="background:var(--color-gold)"></span> Your team
          <span class="az-legend-dot" style="background:var(--color-text-dim);margin-left:12px;"></span> League avg
        </div>` : ""}
        <div style="overflow-x:auto;padding-bottom:var(--space-2);">
          <svg width="${chartW}" height="${chartH}" viewBox="0 0 ${chartW} ${chartH}" style="display:block;">
            <!-- Grid lines -->
            ${[0, 0.25, 0.5, 0.75, 1].map(t => {
              const y   = pad.t + innerH * (1 - t);
              const pts = (minPts + t * (maxPts - minPts)).toFixed(0);
              return `<line x1="${pad.l}" y1="${y}" x2="${pad.l + innerW}" y2="${y}" stroke="rgba(255,255,255,.06)" stroke-width="1"/>
                      <text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="rgba(255,255,255,.3)" font-family="monospace">${pts}</text>`;
            }).join("")}
            <!-- Week labels -->
            ${weeks.map((w, i) => `
              <text x="${xPos(i)}" y="${chartH - 8}" text-anchor="middle" font-size="10" fill="rgba(255,255,255,.3)" font-family="monospace">${w}</text>
            `).join("")}
            <!-- League avg line -->
            ${avgLine ? `<path d="${avgLine}" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.5" stroke-dasharray="4,3"/>` : ""}
            <!-- My team line -->
            ${myLine ? `<path d="${myLine}" fill="none" stroke="var(--color-gold)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
            <!-- Data points for my team -->
            ${_myRosterId ? myScores.map((pts, i) => {
              if (pts === null) return "";
              const isBest  = pts === myBest;
              const isWorst = pts === myWorst;
              const col     = isBest ? "var(--color-green)" : isWorst ? "var(--color-red)" : "var(--color-gold)";
              return `<circle cx="${xPos(i)}" cy="${yPos(pts)}" r="${isBest || isWorst ? 5 : 3}" fill="${col}" stroke="var(--color-bg)" stroke-width="1.5"/>
                      ${isBest || isWorst ? `<text x="${xPos(i)}" y="${yPos(pts) - 9}" text-anchor="middle" font-size="10" fill="${col}" font-family="monospace">${pts.toFixed(0)}</text>` : ""}`;
            }).join("") : ""}
          </svg>
        </div>
        ${_myRosterId && myBest ? `
        <div class="az-highlights">
          <div class="az-highlight az-highlight--green">🔥 Best: Wk ${myScores.indexOf(myBest) + 1} · ${myBest.toFixed(1)} pts</div>
          <div class="az-highlight az-highlight--red">❄️ Worst: Wk ${myScores.indexOf(myWorst) + 1} · ${myWorst?.toFixed(1)} pts</div>
          <div class="az-highlight">Avg: ${(myScores.filter(p => p !== null).reduce((a, b) => a + b, 0) / myScores.filter(p => p !== null).length).toFixed(1)} pts/wk</div>
        </div>` : ""}`;
    } catch(e) {
      el.innerHTML = _errMsg("Could not load points data: " + e.message);
    }
  }

  // ── 2. STANDINGS MOVEMENT ─────────────────────────────────
  async function _renderStandingsMove(el) {
    if (!_leagueId) { el.innerHTML = _noData("No league selected."); return; }
    try {
      const allMatchups = await _fetchMatchupsAllWeeks(_leagueId);
      if (!allMatchups.length) { el.innerHTML = _noData("No matchup data yet."); return; }

      // Group matchups by week, compute cumulative record through each week
      const byWeek = {};
      allMatchups.forEach(m => {
        const w = m.week;
        if (!byWeek[w]) byWeek[w] = {};
        byWeek[w][String(m.roster_id)] = m;
      });
      const weeks = Object.keys(byWeek).map(Number).sort((a, b) => a - b);
      const rIds  = Object.keys(_teamNames);

      // Compute cumulative wins per week → rank per week
      const cumWins = {};
      rIds.forEach(rid => { cumWins[rid] = 0; });

      const ranksByWeek = {}; // week → { rosterId: rank }
      weeks.forEach(w => {
        const weekData = byWeek[w];
        // Determine wins this week via matchup pairs
        const pairs = {};
        Object.entries(weekData).forEach(([rid, m]) => {
          const mid = m.matchup_id;
          if (!pairs[mid]) pairs[mid] = [];
          pairs[mid].push({ rid, pts: m.points || 0 });
        });
        Object.values(pairs).forEach(pair => {
          if (pair.length === 2) {
            const winner = pair[0].pts >= pair[1].pts ? pair[0].rid : pair[1].rid;
            cumWins[winner] = (cumWins[winner] || 0) + 1;
          }
        });
        // Rank teams by cumulative wins (desc)
        const sorted = [...rIds].sort((a, b) => (cumWins[b] || 0) - (cumWins[a] || 0));
        ranksByWeek[w] = {};
        sorted.forEach((rid, i) => { ranksByWeek[w][rid] = i + 1; });
      });

      const numTeams = rIds.length || 12;
      const chartH   = 200;
      const chartW   = Math.max(weeks.length * 44, 320);
      const pad      = { t:16, r:16, b:28, l:36 };
      const innerW   = chartW - pad.l - pad.r;
      const innerH   = chartH - pad.t - pad.b;
      function yPos(rank) { return pad.t + ((rank - 1) / (numTeams - 1)) * innerH; }
      function xPos(i)    { return pad.l + (i / Math.max(weeks.length - 1, 1)) * innerW; }

      // Highlight my team + top 3
      const finalRanks = ranksByWeek[weeks[weeks.length - 1]] || {};
      const top3 = Object.entries(finalRanks).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([rid]) => rid);

      const lines = rIds.map(rid => {
        const isMe   = rid === _myRosterId;
        const isTop  = top3.includes(rid);
        const color  = isMe ? "var(--color-gold)" : isTop ? "var(--color-green)" : "rgba(255,255,255,.12)";
        const width  = isMe ? 2.5 : isTop ? 1.5 : 1;
        const d      = weeks.map((w, i) => {
          const rank = ranksByWeek[w]?.[rid];
          if (!rank) return null;
          return `${i === 0 ? "M" : "L"}${xPos(i).toFixed(1)},${yPos(rank).toFixed(1)}`;
        }).filter(Boolean).join(" ");
        const finalRank = finalRanks[rid] || 0;
        const label = isMe || isTop ? `<text x="${xPos(weeks.length - 1) + 5}" y="${yPos(finalRank) + 4}" font-size="9" fill="${color}" font-family="sans-serif">${finalRank}</text>` : "";
        return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" opacity="${isMe || isTop ? 1 : 0.6}"/>
                ${label}`;
      }).join("");

      el.innerHTML = `
        <div class="az-section-title">Standings Movement</div>
        <div class="az-legend">
          ${_myRosterId ? `<span class="az-legend-dot" style="background:var(--color-gold)"></span> Your team &nbsp;` : ""}
          <span class="az-legend-dot" style="background:var(--color-green)"></span> Top 3
        </div>
        <div style="overflow-x:auto;">
          <svg width="${chartW}" height="${chartH}" viewBox="0 0 ${chartW} ${chartH}" style="display:block;">
            ${[1, Math.round(numTeams/2), numTeams].map(rank => {
              const y = yPos(rank);
              return `<line x1="${pad.l}" y1="${y}" x2="${pad.l + innerW}" y2="${y}" stroke="rgba(255,255,255,.06)" stroke-width="1"/>
                      <text x="${pad.l - 4}" y="${y + 4}" text-anchor="end" font-size="9" fill="rgba(255,255,255,.3)" font-family="sans-serif">#${rank}</text>`;
            }).join("")}
            ${weeks.map((w, i) => `
              <text x="${xPos(i)}" y="${chartH - 8}" text-anchor="middle" font-size="10" fill="rgba(255,255,255,.3)" font-family="monospace">${w}</text>
            `).join("")}
            ${lines}
          </svg>
        </div>`;
    } catch(e) {
      el.innerHTML = _errMsg("Could not load standings data: " + e.message);
    }
  }

  // ── 3. POWER RANKINGS ─────────────────────────────────────
  async function _renderPower(el) {
    if (!_leagueId) { el.innerHTML = _noData("No league selected."); return; }
    try {
      const [rosters, allMatchups] = await Promise.all([
        SleeperAPI.getRosters(_leagueId),
        _fetchMatchupsAllWeeks(_leagueId, 14)
      ]);

      const scoresByWeek = {};
      allMatchups.forEach(m => {
        const rid = String(m.roster_id);
        const w   = m.week;
        if (!scoresByWeek[rid]) scoresByWeek[rid] = {};
        scoresByWeek[rid][w] = m.points || 0;
      });

      if (!Object.keys(scoresByWeek).length) {
        el.innerHTML = _noData("Not enough data yet — check back after week 3.");
        return;
      }

      const maxWeek     = Math.max(...allMatchups.map(m => m.week));
      const recentWeeks = [maxWeek, maxWeek - 1, maxWeek - 2].filter(w => w > 0);

      const rankings = rosters.map(r => {
        const rid        = String(r.roster_id);
        const wScores    = scoresByWeek[rid] || {};
        const allScores  = Object.values(wScores).filter(s => s > 0);
        const recentPts  = recentWeeks.map(w => wScores[w] || 0).filter(s => s > 0);
        const avgAll     = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
        const avgRecent  = recentPts.length ? recentPts.reduce((a, b) => a + b, 0) / recentPts.length : avgAll;
        const wins = r.settings?.wins || 0;
        const losses = r.settings?.losses || 0;
        const winPct = (wins + losses) > 0 ? wins / (wins + losses) : 0;
        const power = avgRecent * 0.4 + avgAll * 0.3 + winPct * 100 * 0.3;
        const trend = avgRecent > avgAll * 1.05 ? "↑" : avgRecent < avgAll * 0.9 ? "↓" : "→";
        const trendColor = trend === "↑" ? "var(--color-green)" : trend === "↓" ? "var(--color-red)" : "var(--color-text-dim)";
        return { rid, name: _teamNames[rid] || `Team ${rid}`, wins, losses, avgAll, avgRecent, power, trend, trendColor, isMe: rid === _myRosterId };
      }).filter(r => r.power > 0).sort((a, b) => b.power - a.power);

      if (!rankings.length) { el.innerHTML = _noData("Not enough scoring data yet."); return; }
      const maxPower = rankings[0].power;

      el.innerHTML = `
        <div class="az-section-title">Power Rankings</div>
        <div class="az-desc">40% recent form (last 3 wks) + 30% season avg + 30% win%</div>
        <div class="az-list">
          ${rankings.map((r, i) => {
            const medals = ["🥇","🥈","🥉"];
            const badge  = i < 3 ? medals[i] : `#${i + 1}`;
            const pct    = (r.power / maxPower * 100).toFixed(1);
            return `
              <div class="az-list-row ${r.isMe ? "az-list-row--me" : ""}">
                <div class="az-rank">${badge}</div>
                <div class="az-team-name">${_esc(r.name)}</div>
                <div class="az-record">${r.wins}–${r.losses}</div>
                <div class="az-bar-wrap">
                  <div class="az-bar" style="width:${pct}%"></div>
                </div>
                <div class="az-stat-sm">${r.avgAll.toFixed(1)} avg</div>
                <div class="az-trend" style="color:${r.trendColor}">${r.trend}</div>
              </div>`;
          }).join("")}
        </div>`;
    } catch(e) {
      el.innerHTML = _errMsg("Could not load power rankings: " + e.message);
    }
  }

  // ── 4. LUCK INDEX ─────────────────────────────────────────
  async function _renderLuck(el) {
    if (!_leagueId) { el.innerHTML = _noData("No league selected."); return; }
    try {
      const [rosters, allMatchups] = await Promise.all([
        SleeperAPI.getRosters(_leagueId),
        _fetchMatchupsAllWeeks(_leagueId, 14)
      ]);

      const weeklyScores = {}, actualRecord = {};
      // Group by week→matchup
      const byWeekMatchup = {};
      allMatchups.forEach(m => {
        const key = `${m.week}-${m.matchup_id}`;
        if (!byWeekMatchup[key]) byWeekMatchup[key] = [];
        byWeekMatchup[key].push(m);
      });

      Object.values(byWeekMatchup).forEach(pair => {
        if (pair.length !== 2) return;
        const [a, b] = pair;
        const rA = String(a.roster_id), rB = String(b.roster_id);
        if (!weeklyScores[rA]) weeklyScores[rA] = [];
        if (!weeklyScores[rB]) weeklyScores[rB] = [];
        weeklyScores[rA].push(a.points || 0);
        weeklyScores[rB].push(b.points || 0);
        if (!actualRecord[rA]) actualRecord[rA] = { w: 0, l: 0 };
        if (!actualRecord[rB]) actualRecord[rB] = { w: 0, l: 0 };
        if ((a.points || 0) >= (b.points || 0)) { actualRecord[rA].w++; actualRecord[rB].l++; }
        else { actualRecord[rB].w++; actualRecord[rA].l++; }
      });

      // Expected wins = weeks where scored above the weekly median
      const allScores = Object.values(weeklyScores).flat().filter(s => s > 0);
      if (!allScores.length) { el.innerHTML = _noData("Not enough matchup data yet."); return; }

      const results = rosters.map(r => {
        const rid    = String(r.roster_id);
        const scores = weeklyScores[rid] || [];
        const actual = actualRecord[rid] || { w: 0, l: 0 };
        if (!scores.length) return null;
        const sortedAll = [...allScores].sort((a, b) => a - b);
        const expectedWins = scores.filter(s => sortedAll.filter(x => x < s).length > sortedAll.length / 2).length;
        return {
          rid,
          name:          _teamNames[rid] || `Team ${rid}`,
          actual,
          expectedWins,
          luckScore:     actual.w - expectedWins,
          avgScore:      (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1),
          isMe:          rid === _myRosterId
        };
      }).filter(Boolean).sort((a, b) => b.luckScore - a.luckScore);

      const maxLuck = Math.max(...results.map(r => Math.abs(r.luckScore)), 1);

      el.innerHTML = `
        <div class="az-section-title">Luck Index</div>
        <div class="az-desc">Actual Wins − Expected Wins vs league-wide weekly median. Positive = lucky, Negative = unlucky.</div>
        <div class="az-list">
          ${results.map(r => {
            const pct   = (Math.abs(r.luckScore) / maxLuck) * 40;
            const color = r.luckScore > 0 ? "var(--color-green)" : r.luckScore < 0 ? "var(--color-red)" : "var(--color-text-dim)";
            const emoji = r.luckScore >= 2 ? "🍀" : r.luckScore <= -2 ? "😤" : "😐";
            return `
              <div class="az-list-row ${r.isMe ? "az-list-row--me" : ""}">
                <div class="az-rank" style="font-size:1.1rem">${emoji}</div>
                <div class="az-team-name">${_esc(r.name)}</div>
                <div class="az-record">${r.actual.w}–${r.actual.l}</div>
                <div class="az-luck-bar-wrap">
                  <div class="az-luck-bar ${r.luckScore >= 0 ? "az-luck-bar--pos" : "az-luck-bar--neg"}"
                    style="width:${pct}%;${r.luckScore >= 0 ? "margin-left:50%;" : `margin-left:${50 - pct}%;`}"></div>
                  <div class="az-luck-zero"></div>
                </div>
                <div class="az-stat-sm" style="color:${color};font-weight:700;">${r.luckScore > 0 ? "+" : ""}${r.luckScore}</div>
              </div>`;
          }).join("")}
        </div>`;
    } catch(e) {
      el.innerHTML = _errMsg("Could not load luck data: " + e.message);
    }
  }

  // ── 5. TRADE MAP ──────────────────────────────────────────
  async function _renderTrades(el) {
    if (!_leagueId) { el.innerHTML = _noData("No league selected."); return; }
    try {
      const txns   = await _fetchTransactions(_leagueId);
      const trades = txns.filter(t => t.type === "trade" && t.status === "complete");

      if (!trades.length) { el.innerHTML = _noData("No trades found this season."); return; }

      const pairs = {}, counts = {};
      trades.forEach(t => {
        const ids = (t.roster_ids || []).map(String).sort();
        if (ids.length >= 2) {
          const key = ids.join("-");
          pairs[key] = (pairs[key] || 0) + 1;
          ids.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
        }
      });

      const sorted   = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const maxCount = sorted[0]?.[1] || 1;

      el.innerHTML = `
        <div class="az-section-title">Trade Activity</div>
        <div class="az-list" style="margin-bottom:var(--space-5);">
          ${sorted.map(([rid, n]) => `
            <div class="az-list-row ${rid === _myRosterId ? "az-list-row--me" : ""}">
              <div class="az-team-name">${_esc(_teamNames[rid] || `Team ${rid}`)}</div>
              <div class="az-bar-wrap">
                <div class="az-bar" style="width:${(n/maxCount*100).toFixed(0)}%"></div>
              </div>
              <div class="az-stat-sm">${n} trade${n !== 1 ? "s" : ""}</div>
            </div>`).join("")}
        </div>
        <div class="az-section-title">Trading Partners</div>
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);">
          ${Object.entries(pairs).sort((a, b) => b[1] - a[1]).map(([key, n]) => {
            const [a, b] = key.split("-");
            const nA = _esc(_teamNames[a] || `R${a}`);
            const nB = _esc(_teamNames[b] || `R${b}`);
            const isMe = a === _myRosterId || b === _myRosterId;
            return `<div class="az-trade-chip ${isMe ? "az-trade-chip--me" : ""}">
              ${nA} <span class="az-trade-arrow">↔</span> ${nB}
              <span class="az-trade-count">${n}×</span>
            </div>`;
          }).join("")}
        </div>`;
    } catch(e) {
      el.innerHTML = _errMsg("Could not load trade data: " + e.message);
    }
  }

  // ── 6. DRAFT RECAP ────────────────────────────────────────
  async function _renderDraftRecap(el) {
    if (!_leagueId) { el.innerHTML = _noData("No league selected."); return; }
    try {
      const drafts = await fetch(`https://api.sleeper.app/v1/league/${_leagueId}/drafts`).then(r => r.json());
      if (!drafts?.length) { el.innerHTML = _noData("No drafts found for this season."); return; }

      const draft = [...drafts].sort((a, b) => Number(b.draft_id) - Number(a.draft_id))
        .find(d => d.status === "complete") || drafts[0];
      const picks = await fetch(`https://api.sleeper.app/v1/draft/${draft.draft_id}/picks`).then(r => r.json());
      if (!picks?.length) { el.innerHTML = _noData("No picks found in this draft."); return; }

      const teams  = draft.settings?.teams  || 12;
      const rounds = draft.settings?.rounds || 4;
      const year   = draft.season || new Date().getFullYear();

      el.innerHTML = `<div class="detail-loading"><div class="spinner"></div><span>Fetching ${year} stats…</span></div>`;

      let seasonStats = {};
      try {
        const r = await fetch(`https://api.sleeper.app/v1/stats/nfl/regular/${year}?season_type=regular&position[]=QB&position[]=RB&position[]=WR&position[]=TE`);
        if (r.ok) seasonStats = await r.json();
      } catch(e) {}

      const allPicks = picks.map(p => ({
        rid:     String(p.roster_id || ""),
        overall: (p.round - 1) * teams + (p.draft_slot || 1),
        name:    p.metadata ? `${p.metadata.first_name || ""} ${p.metadata.last_name || ""}`.trim() : "Unknown",
        pos:     p.metadata?.position || "?",
        pid:     p.player_id,
        pts:     p.player_id && seasonStats[p.player_id] ? (seasonStats[p.player_id].pts_ppr || 0) : null,
        round:   p.round
      })).filter(p => p.rid && p.rid !== "undefined");

      const withStats   = allPicks.filter(p => p.pts !== null && p.pts > 0);
      const hasStats    = withStats.length > 0;
      withStats.sort((a, b) => b.pts - a.pts);
      const valueRank = {};
      withStats.forEach((p, i) => { valueRank[p.overall] = i + 1; });

      const byRoster = {};
      allPicks.forEach(p => {
        if (!byRoster[p.rid]) byRoster[p.rid] = [];
        byRoster[p.rid].push(p);
      });

      const summaries = Object.entries(byRoster).map(([rid, rPicks]) => {
        const totalPts = rPicks.reduce((s, p) => s + (p.pts || 0), 0);
        const steals   = rPicks.filter(p => p.overall > teams && valueRank[p.overall] && valueRank[p.overall] <= teams)
          .sort((a, b) => (valueRank[a.overall] || 999) - (valueRank[b.overall] || 999)).slice(0, 2);
        const busts    = rPicks.filter(p => p.overall <= teams && valueRank[p.overall] && valueRank[p.overall] > teams)
          .sort((a, b) => (valueRank[b.overall] || 0) - (valueRank[a.overall] || 0)).slice(0, 2);
        return { rid, name: _teamNames[rid] || `Team ${rid}`, picks: rPicks, totalPts, steals, busts, isMe: rid === _myRosterId };
      }).sort((a, b) => b.totalPts - a.totalPts);

      const maxPts = summaries[0]?.totalPts || 1;
      const medals = ["🥇","🥈","🥉"];

      el.innerHTML = `
        <div class="az-section-title">Draft Recap — ${year}</div>
        <div class="az-desc">${draft.type === "snake" ? "Redraft snake" : "Rookie/dynasty linear"} · ${rounds} rounds · ${teams} teams${hasStats ? " · Sorted by total PPR pts from drafted players" : ""}</div>
        <div class="az-list">
          ${summaries.map((s, i) => {
            const pct    = hasStats ? (s.totalPts / maxPts * 100).toFixed(1) : 0;
            const posMap = {};
            s.picks.forEach(p => { posMap[p.pos] = (posMap[p.pos] || 0) + 1; });
            return `
              <div class="az-draft-row ${s.isMe ? "az-list-row--me" : ""}">
                <div class="az-rank">${medals[i] || `#${i+1}`}</div>
                <div class="az-draft-body">
                  <div class="az-draft-header">
                    <span class="az-team-name">${_esc(s.name)}</span>
                    ${hasStats ? `<span class="az-stat-sm">${s.totalPts.toFixed(0)} pts</span>` : ""}
                  </div>
                  ${hasStats ? `<div class="az-bar-wrap" style="margin:4px 0"><div class="az-bar" style="width:${pct}%"></div></div>` : ""}
                  <div class="az-pos-badges">
                    ${Object.entries(posMap).map(([pos, n]) =>
                      `<span class="az-pos-badge" style="background:${POS_COLOR[pos]||"#9ca3af"}22;color:${POS_COLOR[pos]||"#9ca3af"};border-color:${POS_COLOR[pos]||"#9ca3af"}55">${pos}×${n}</span>`
                    ).join("")}
                  </div>
                  ${s.steals.length ? `<div class="az-steal">🎯 ${s.steals.map(p => `${_esc(p.name)} <span class="az-pick-num">#${p.overall}</span>`).join(", ")}</div>` : ""}
                  ${s.busts.length  ? `<div class="az-bust">💥 ${s.busts.map(p => `${_esc(p.name)} <span class="az-pick-num">#${p.overall}</span>`).join(", ")}</div>` : ""}
                </div>
              </div>`;
          }).join("")}
        </div>`;
    } catch(e) {
      el.innerHTML = _errMsg("Could not load draft recap: " + e.message);
    }
  }

  // ── 7. WAIVER IMPACT ──────────────────────────────────────
  async function _renderWaivers(el) {
    if (!_leagueId) { el.innerHTML = _noData("No league selected."); return; }
    try {
      const txns    = await _fetchTransactions(_leagueId);
      const waivers = txns.filter(t => ["waiver","free_agent"].includes(t.type) && t.status === "complete");

      if (!waivers.length) { el.innerHTML = _noData("No waiver activity found this season."); return; }

      // Use DLRPlayers module (IndexedDB-backed, no quota issues)
      const players = DLRPlayers.all() || {};

      const teamPickups = {}, playerClaims = {};
      waivers.forEach(t => {
        const rid = String((t.roster_ids || [])[0] || "");
        if (!teamPickups[rid]) teamPickups[rid] = { adds: 0, drops: 0 };
        const adds  = Object.keys(t.adds  || {});
        const drops = Object.keys(t.drops || {});
        teamPickups[rid].adds  += adds.length;
        teamPickups[rid].drops += drops.length;
        adds.forEach(pid => {
          const p    = players[pid];
          const name = p?.first_name ? `${p.first_name} ${p.last_name}` : pid;
          playerClaims[name] = (playerClaims[name] || 0) + 1;
        });
      });

      const teamRows = Object.entries(teamPickups)
        .map(([rid, { adds, drops }]) => ({ name: _teamNames[rid] || `Team ${rid}`, adds, drops, isMe: rid === _myRosterId }))
        .sort((a, b) => b.adds - a.adds);
      const maxAdds = teamRows[0]?.adds || 1;

      const hotPlayers = Object.entries(playerClaims)
        .filter(([, n]) => n > 1)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12);

      el.innerHTML = `
        <div class="az-section-title">Waiver Activity by Team</div>
        <div class="az-list" style="margin-bottom:var(--space-5);">
          ${teamRows.map(r => `
            <div class="az-list-row ${r.isMe ? "az-list-row--me" : ""}">
              <div class="az-team-name">${_esc(r.name)}</div>
              <div class="az-bar-wrap">
                <div class="az-bar" style="width:${(r.adds/maxAdds*100).toFixed(0)}%"></div>
              </div>
              <div class="az-stat-sm">${r.adds} adds · ${r.drops} drops</div>
            </div>`).join("")}
        </div>
        ${hotPlayers.length ? `
        <div class="az-section-title">Most Claimed Players</div>
        <div style="display:flex;flex-wrap:wrap;gap:var(--space-2);">
          ${hotPlayers.map(([name, n]) =>
            `<div class="az-trade-chip">${_esc(name)} <span class="az-trade-count">${n}×</span></div>`
          ).join("")}
        </div>` : ""}`;
    } catch(e) {
      el.innerHTML = _errMsg("Could not load waiver data: " + e.message);
    }
  }

  // ── MFL Analytics ─────────────────────────────────────────
  async function _renderMFLAnalytics(el, leagueId, token) {
    const season = new Date().getFullYear().toString();
    const bundle = await MFLAPI.getLeagueBundle(leagueId, season);
    if (token !== _initToken) return;

    const teams    = MFLAPI.getTeams(bundle);
    const standings = MFLAPI.normalizeStandings(bundle);
    const teamMap  = {};
    teams.forEach(t => { teamMap[String(t.id)] = t.name || `Team ${t.id}`; });

    // Sort for power rankings by win% then pts
    const ranked = [...standings].sort((a, b) =>
      (b.wins/(b.wins+b.losses+b.ties||1)) - (a.wins/(a.wins+a.losses+a.ties||1)) ||
      b.ptsFor - a.ptsFor
    );

    const maxPts = Math.max(...standings.map(s => s.ptsFor), 1);

    el.innerHTML = `
      <div style="padding:var(--space-4)">
        <div class="az-section-title" style="margin-bottom:var(--space-3)">🏆 Power Rankings</div>
        <div style="display:flex;flex-direction:column;gap:var(--space-2)">
          ${ranked.map((s, i) => {
            const name    = teamMap[String(s.franchiseId)] || `Team ${s.franchiseId}`;
            const record  = `${s.wins}–${s.losses}${s.ties ? `–${s.ties}` : ""}`;
            const pct     = ((s.ptsFor / maxPts) * 100).toFixed(0);
            const rankColor = i === 0 ? "var(--color-gold)" : i < 3 ? "#94a3b8" : "var(--color-text-dim)";
            const isMe    = _myRosterId && String(s.franchiseId) === String(_myRosterId);
            return `
              <div style="display:grid;grid-template-columns:28px 1fr auto;gap:var(--space-2);align-items:center;padding:var(--space-2) var(--space-3);background:${isMe ? "var(--color-surface-raised)" : "var(--color-surface)"};border-radius:var(--radius-sm);${isMe ? "border:1px solid var(--color-gold-dim);" : ""}">
                <span style="font-weight:700;color:${rankColor};font-family:var(--font-display)">${i+1}</span>
                <div>
                  <div style="font-weight:600;font-size:.88rem">${_esc(name)}${isMe ? ' <span style="font-size:.7rem;color:var(--color-gold);font-weight:700;">★</span>' : ""}</div>
                  <div style="display:flex;align-items:center;gap:var(--space-2);margin-top:2px">
                    <span style="font-size:.72rem;color:var(--color-text-dim)">${record}</span>
                    <div style="flex:1;height:4px;background:var(--color-border);border-radius:2px;max-width:120px">
                      <div style="height:100%;width:${pct}%;background:var(--color-gold);border-radius:2px"></div>
                    </div>
                    <span style="font-size:.72rem;color:var(--color-text-dim)">${s.ptsFor.toFixed(1)} pts</span>
                  </div>
                </div>
                <span style="font-size:.75rem;color:var(--color-text-dim)">${s.ptsFor > 0 ? (s.ptsFor/(s.wins+s.losses+s.ties||1)).toFixed(1)+"/wk" : ""}</span>
              </div>`;
          }).join("")}
        </div>
        <div style="margin-top:var(--space-5)">
          <div class="az-section-title" style="margin-bottom:var(--space-3)">📊 Points Leaders</div>
          <div style="display:flex;flex-direction:column;gap:var(--space-2)">
            ${[...standings].sort((a,b) => b.ptsFor - a.ptsFor).slice(0,5).map((s,i) => {
              const name  = teamMap[String(s.franchiseId)] || `Team ${s.franchiseId}`;
              const isMe  = _myRosterId && String(s.franchiseId) === String(_myRosterId);
              return `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:var(--space-2) var(--space-3);background:${isMe ? "var(--color-surface-raised)" : "var(--color-surface)"};border-radius:var(--radius-sm);${isMe ? "border:1px solid var(--color-gold-dim);" : ""}">
                  <span style="font-size:.85rem">${i+1}. ${_esc(name)}${isMe ? ' <span style="font-size:.7rem;color:var(--color-gold);font-weight:700;">★</span>' : ""}</span>
                  <span style="font-weight:700;color:var(--color-gold);font-family:var(--font-display)">${s.ptsFor.toFixed(1)}</span>
                </div>`;
            }).join("")}
          </div>
        </div>
        <div style="margin-top:var(--space-4);text-align:center">
          <a href="https://www42.myfantasyleague.com/${season}/home/${leagueId}" target="_blank"
            style="font-size:.78rem;color:var(--color-gold)">View full analytics on MFL ↗</a>
        </div>
      </div>`;
  }

  return { init, reset, showTab };

})();
