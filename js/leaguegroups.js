// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — League Groups
//  Ported from SleeperBid/leaguegroups.js
//  Adapted to use gmd/ Firebase paths and DLR auth.
//
//  Personal labels  → gmd/users/{username}/leagueLabels/
//  Commissioner groups → gmd/commGroups/
//  League order     → gmd/users/{username}/leagueOrder
// ─────────────────────────────────────────────────────────

const LABEL_PRESETS = ['Dynasty','Redraft','Best Ball','Salary Cap','Keeper','IDP','Superflex','Tournament'];
const LABEL_COLORS  = ['#3b82f6','#22c55e','#e88c30','#a855f7','#ef4444','#06b6d4','#f59e0b','#ec4899'];

// ── League order (drag-to-reorder) ────────────────────────

function getLeagueOrder(username) {
  try {
    return JSON.parse(localStorage.getItem(`dlr_league_order_${username}`) || '[]');
  } catch(e) { return []; }
}

function saveLeagueOrder(username, ids) {
  localStorage.setItem(`dlr_league_order_${username}`, JSON.stringify(ids));
}

function applyLeagueOrder(username, leagues) {
  const order = getLeagueOrder(username);
  if (!order.length) return leagues;
  const ranked = {};
  order.forEach((id, i) => { ranked[id] = i; });
  return [...leagues].sort((a, b) => (ranked[a.key] ?? 9999) - (ranked[b.key] ?? 9999));
}

function onLeagueDragStart(e, key) {
  e.dataTransfer.setData('text/plain', key);
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.4';
}
function onLeagueDragEnd(e) { e.currentTarget.style.opacity = ''; }
function onLeagueDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.style.outline = '2px solid var(--color-gold)';
}
function onLeagueDragLeave(e) { e.currentTarget.style.outline = ''; }
function onLeagueDrop(e, targetKey) {
  e.preventDefault();
  e.currentTarget.style.outline = '';
  const draggedKey = e.dataTransfer.getData('text/plain');
  if (!draggedKey || draggedKey === targetKey) return;
  const grid   = e.currentTarget.closest('.leagues-grid');
  if (!grid) return;
  const cards  = [...grid.querySelectorAll('[data-key]')];
  const keys   = cards.map(c => c.dataset.key);
  const fromIdx = keys.indexOf(draggedKey);
  const toIdx   = keys.indexOf(targetKey);
  if (fromIdx < 0 || toIdx < 0) return;
  keys.splice(fromIdx, 1);
  keys.splice(toIdx, 0, draggedKey);
  const username = Auth.getCurrentProfile()?.username;
  if (username) saveLeagueOrder(username, keys);
  // Re-render in new order
  const fromEl = cards[fromIdx], toEl = cards[toIdx];
  if (fromIdx < toIdx) grid.insertBefore(fromEl, toEl.nextSibling);
  else                  grid.insertBefore(fromEl, toEl);
}

// ── Personal labels (stored in Firebase under user node) ──

async function getPersonalLabels(username) {
  try {
    const data = await GMDB._restGet(`gmd/users/${username.toLowerCase()}/leagueLabels`);
    return data || {};
  } catch(e) { return {}; }
}

async function savePersonalLabel(username, labelId, data) {
  await GMDB._restPut(`gmd/users/${username.toLowerCase()}/leagueLabels/${labelId}`, data);
}

async function deletePersonalLabelById(username, labelId) {
  const token = await _getToken();
  const url   = `https://sleeperbid-default-rtdb.firebaseio.com/gmd/users/${username.toLowerCase()}/leagueLabels/${labelId}.json?auth=${token}`;
  await fetch(url, { method: 'DELETE' });
}

// Build a map: { leagueKey: { name, color } } for badge display
async function getLeagueLabelMap(username) {
  const labels = await getPersonalLabels(username);
  const map = {};
  Object.values(labels).forEach(l => {
    (l.leagueKeys || []).forEach(key => { map[key] = { name: l.name, color: l.color }; });
  });
  return map;
}

// ── Commissioner groups (shared via gmd/commGroups/) ──────

async function loadCommGroups() {
  try {
    const data = await GMDB._restGet(`gmd/commGroups`);
    return data || {};
  } catch(e) { return {}; }
}

async function saveCommGroup(groupId, data) {
  await GMDB._restPut(`gmd/commGroups/${groupId}`, data);
}

async function deleteCommGroupById(groupId) {
  const token = await _getToken();
  const url   = `https://sleeperbid-default-rtdb.firebaseio.com/gmd/commGroups/${groupId}.json?auth=${token}`;
  await fetch(url, { method: 'DELETE' });
}

async function _getToken() {
  const user = firebase.auth().currentUser;
  return user ? user.getIdToken() : null;
}

// ── Main group manager modal ───────────────────────────────

async function showGroupManager(leagueEntries) {
  // leagueEntries: [{ key, league }]
  let modal = document.getElementById('group-manager-modal');
  if (modal) modal.remove();

  modal = document.createElement('div');
  modal.id = 'group-manager-modal';
  modal.className = 'modal-overlay';
  modal.style.zIndex = '600';
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h3>🗂 League Groups</h3>
        <button class="modal-close" onclick="document.getElementById('group-manager-modal').remove()">✕</button>
      </div>
      <div style="display:flex;border-bottom:1px solid var(--color-border);">
        <button id="gmtab-labels" onclick="LeagueGroups.switchGMTab('labels')"
          style="flex:1;padding:10px;font-size:13px;font-family:var(--font-body);background:var(--color-gold);color:#0a0e1a;border:none;cursor:pointer;font-weight:700;">
          🏷 My Labels
        </button>
        <button id="gmtab-comm" onclick="LeagueGroups.switchGMTab('comm')"
          style="flex:1;padding:10px;font-size:13px;font-family:var(--font-body);background:var(--color-surface);color:var(--color-text-muted);border:none;border-left:1px solid var(--color-border);cursor:pointer;font-weight:600;">
          📣 Commissioner Groups
        </button>
      </div>
      <div id="gm-tab-labels" class="modal-body"></div>
      <div id="gm-tab-comm"   class="modal-body" style="display:none;"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  setTimeout(async () => {
    await renderLabelsTab(leagueEntries);
    await renderCommTab(leagueEntries);
  }, 0);
}

function switchGMTab(tab) {
  ['labels','comm'].forEach(t => {
    const el  = document.getElementById(`gm-tab-${t}`);
    const btn = document.getElementById(`gmtab-${t}`);
    if (el)  el.style.display  = t === tab ? '' : 'none';
    if (btn) {
      btn.style.background = t === tab ? 'var(--color-gold)' : 'var(--color-surface)';
      btn.style.color      = t === tab ? '#0a0e1a' : 'var(--color-text-muted)';
    }
  });
}

// ── Labels tab ─────────────────────────────────────────────

async function renderLabelsTab(leagueEntries) {
  const el = document.getElementById('gm-tab-labels');
  if (!el) return;
  const username = Auth.getCurrentProfile()?.username;
  if (!username) return;

  const labels  = await getPersonalLabels(username);
  const entries = Object.entries(labels);

  el.innerHTML = `
    <div style="font-size:12px;color:var(--color-text-dim);margin-bottom:12px;">
      Labels are private to you — they appear as colored chips on your league cards.
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;">
      ${LABEL_PRESETS.map((p,i) => `
        <button onclick="LeagueGroups.addPresetLabel('${p}',${i})"
          style="padding:4px 10px;font-size:11px;font-family:var(--font-body);
          background:${LABEL_COLORS[i%LABEL_COLORS.length]}22;
          color:${LABEL_COLORS[i%LABEL_COLORS.length]};
          border:1px solid ${LABEL_COLORS[i%LABEL_COLORS.length]}55;
          border-radius:99px;cursor:pointer;">+ ${p}</button>`).join('')}
    </div>
    ${entries.length ? `
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${entries.map(([lid, l]) => `
        <div style="background:var(--color-bg-3);border-radius:var(--radius);padding:10px 12px;border-left:3px solid ${l.color};">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="font-size:13px;font-weight:600;color:${l.color};">${_esc(l.name)}</span>
            <button onclick="LeagueGroups.editLabelLeagues('${lid}')"
              style="font-size:11px;padding:2px 8px;background:none;border:1px solid var(--color-border);border-radius:4px;color:var(--color-text-dim);cursor:pointer;">Edit</button>
            <button onclick="LeagueGroups.deleteLabelAndRefresh('${lid}')"
              style="margin-left:auto;background:none;border:none;color:var(--color-text-dim);cursor:pointer;font-size:12px;">🗑</button>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;">
            ${(l.leagueKeys||[]).map(key => {
              const entry = leagueEntries.find(e => e.key === key);
              return entry ? `<span style="font-size:11px;padding:2px 8px;background:${l.color}18;color:${l.color};border:1px solid ${l.color}44;border-radius:99px;">${_esc(entry.league.leagueName)}</span>` : '';
            }).join('')}
          </div>
        </div>`).join('')}
    </div>` : `<div style="color:var(--color-text-dim);font-size:13px;padding:8px 0;">No labels yet. Pick a preset above or create a custom one.</div>`}
    <div style="margin-top:14px;">
      <button onclick="LeagueGroups.createCustomLabel()"
        style="padding:6px 14px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-muted);font-family:var(--font-body);font-size:12px;cursor:pointer;">
        + Custom Label
      </button>
    </div>`;
}

async function addPresetLabel(name, colorIdx) {
  const color    = LABEL_COLORS[colorIdx % LABEL_COLORS.length];
  const username = Auth.getCurrentProfile()?.username;
  const leagues  = _getCurrentLeagueEntries();
  openLeagueSelector(name, color, [], leagues, async (selectedKeys) => {
    if (!selectedKeys.length) return;
    const lid = 'lbl_' + Date.now();
    await savePersonalLabel(username, lid, { name, color, leagueKeys: selectedKeys });
    await renderLabelsTab(leagues);
    showToast(`Label "${name}" created ✓`);
  });
}

async function createCustomLabel() {
  const name = prompt('Label name:');
  if (!name?.trim()) return;
  const color    = LABEL_COLORS[Math.floor(Math.random() * LABEL_COLORS.length)];
  const username = Auth.getCurrentProfile()?.username;
  const leagues  = _getCurrentLeagueEntries();
  openLeagueSelector(name.trim(), color, [], leagues, async (selectedKeys) => {
    if (!selectedKeys.length) return;
    const lid = 'lbl_' + Date.now();
    await savePersonalLabel(username, lid, { name: name.trim(), color, leagueKeys: selectedKeys });
    await renderLabelsTab(leagues);
    showToast(`Label "${name.trim()}" created ✓`);
  });
}

async function editLabelLeagues(labelId) {
  const username = Auth.getCurrentProfile()?.username;
  const labels   = await getPersonalLabels(username);
  const label    = labels[labelId];
  if (!label) return;
  const leagues  = _getCurrentLeagueEntries();
  openLeagueSelector(label.name, label.color, label.leagueKeys || [], leagues, async (selectedKeys) => {
    await savePersonalLabel(username, labelId, { ...label, leagueKeys: selectedKeys });
    await renderLabelsTab(leagues);
    showToast('Label updated ✓');
  });
}

async function deleteLabelAndRefresh(labelId) {
  const username = Auth.getCurrentProfile()?.username;
  await deletePersonalLabelById(username, labelId);
  await renderLabelsTab(_getCurrentLeagueEntries());
  showToast('Label deleted');
}

// ── Commissioner Groups tab ────────────────────────────────

async function renderCommTab(leagueEntries) {
  const el = document.getElementById('gm-tab-comm');
  if (!el) return;
  const username  = (Auth.getCurrentProfile()?.username || '').toLowerCase();
  const allGroups = await loadCommGroups();
  const myGroups  = Object.entries(allGroups).filter(([,g]) => g.commUsername?.toLowerCase() === username);
  const otherGroups = Object.entries(allGroups).filter(([,g]) => g.commUsername?.toLowerCase() !== username);

  el.innerHTML = `
    <div style="font-size:12px;color:var(--color-text-dim);margin-bottom:12px;">
      Commissioner groups are shared with all league members and support broadcast messaging.
    </div>
    <button onclick="LeagueGroups.createCommGroup()"
      style="padding:6px 14px;background:var(--color-gold);color:#0a0e1a;border:none;border-radius:var(--radius-sm);font-family:var(--font-display);font-size:12px;font-weight:700;cursor:pointer;margin-bottom:14px;letter-spacing:.04em;text-transform:uppercase;">
      + New Commissioner Group
    </button>

    ${myGroups.length ? `
    <div style="font-size:12px;font-weight:700;color:var(--color-text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;">My Groups</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">
      ${myGroups.map(([gid, g]) => `
        <div style="background:var(--color-bg-3);border-radius:var(--radius);padding:12px 14px;border-left:3px solid ${g.color||'var(--color-gold)'};">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:13px;font-weight:600;">${_esc(g.name)}</span>
            <button onclick="LeagueGroups.deleteGroupAndRefresh('${gid}')"
              style="margin-left:auto;background:none;border:none;color:var(--color-text-dim);cursor:pointer;font-size:12px;">🗑</button>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;">
            ${(g.leagueKeys||[]).map(key => {
              const entry = leagueEntries.find(e => e.key === key);
              return entry ? `<span style="font-size:11px;padding:2px 8px;background:${g.color||'var(--color-gold)'}18;color:${g.color||'var(--color-gold)'};border:1px solid ${g.color||'var(--color-gold)'}44;border-radius:99px;">${_esc(entry.league.leagueName)}</span>` : '';
            }).join('')}
          </div>
          <button onclick="LeagueGroups.showGroupBroadcast('${gid}','${g.name.replace(/'/g,"\\'")}',${JSON.stringify(g.leagueKeys||[])})"
            style="padding:5px 14px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-muted);cursor:pointer;font-family:var(--font-body);font-size:12px;">
            📣 Broadcast Message
          </button>
        </div>`).join('')}
    </div>` : ''}

    ${otherGroups.length ? `
    <div style="font-size:12px;font-weight:700;color:var(--color-text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em;">Groups You're In</div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${otherGroups.map(([,g]) => `
        <div style="background:var(--color-bg-3);border-radius:var(--radius);padding:10px 12px;border-left:3px solid ${g.color||'var(--color-gold)'};">
          <div style="font-size:13px;font-weight:600;margin-bottom:2px;">${_esc(g.name)}</div>
          <div style="font-size:11px;color:var(--color-text-dim);">Created by ${_esc(g.commUsername)}</div>
        </div>`).join('')}
    </div>` : (!myGroups.length ? `<div style="color:var(--color-text-dim);font-size:13px;padding:8px 0;">No commissioner groups yet.</div>` : '')}`;
}

async function createCommGroup() {
  const username = (Auth.getCurrentProfile()?.username || '').toLowerCase();
  const name     = prompt('Commissioner group name:');
  if (!name?.trim()) return;
  const color   = LABEL_COLORS[Math.floor(Math.random() * LABEL_COLORS.length)];
  const leagues = _getCurrentLeagueEntries().filter(e => e.league.isCommissioner);

  if (!leagues.length) {
    alert('You are not marked as commissioner of any leagues. Commissioner status is set during league import.');
    return;
  }

  openLeagueSelector(name.trim(), color, [], leagues, async (selectedKeys) => {
    if (!selectedKeys.length) return;
    const gid = 'cg_' + Date.now();
    await saveCommGroup(gid, {
      name:         name.trim(),
      color,
      leagueKeys:   selectedKeys,
      commUsername: username,
      createdAt:    Date.now()
    });
    await renderCommTab(_getCurrentLeagueEntries());
    showToast(`Group "${name.trim()}" created ✓`);
    setTimeout(() => switchGMTab('comm'), 50);
  });
}

async function deleteGroupAndRefresh(groupId) {
  await deleteCommGroupById(groupId);
  await renderCommTab(_getCurrentLeagueEntries());
  showToast('Group deleted');
}

// ── League selector dialog ─────────────────────────────────

function openLeagueSelector(title, color, existingKeys, leagueEntries, callback) {
  // Sort: year descending, then league name alphabetically within same year
  // For dynasty/keeper chains, only show the most recent year of each chain
  const seenDynasty = {};
  const sorted = [...leagueEntries]
    .sort((a, b) => {
      const sDiff = (b.league.season || '').localeCompare(a.league.season || '');
      if (sDiff !== 0) return sDiff;
      return (a.league.leagueName || '').localeCompare(b.league.leagueName || '');
    })
    .filter(({key, league}) => {
      // Collapse dynasty/keeper: group by leagueName, keep only first (most recent) seen
      const isDynasty = league.leagueType === 'dynasty' || league.leagueType === 'keeper';
      if (!isDynasty) return true;
      const nameKey = (league.leagueName || '').toLowerCase().trim();
      if (seenDynasty[nameKey]) return false;
      seenDynasty[nameKey] = true;
      return true;
    });
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:700;display:flex;align-items:center;justify-content:center;padding:16px;';
  div.innerHTML = `
    <div style="background:var(--color-bg-2);border:1px solid var(--color-border);border-radius:var(--radius-lg);width:420px;max-width:100%;padding:20px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:4px;color:${color};">📋 ${_esc(title)}</div>
      <div style="font-size:12px;color:var(--color-text-dim);margin-bottom:12px;">Select leagues to include:</div>
      <div style="max-height:260px;overflow-y:auto;margin-bottom:16px;">
        ${sorted.map(({key, league}) => `
          <label style="display:flex;align-items:center;gap:10px;padding:7px 4px;cursor:pointer;border-bottom:1px solid var(--color-border);">
            <input type="checkbox" value="${key}" ${(existingKeys||[]).includes(key)?'checked':''} style="cursor:pointer;flex-shrink:0;accent-color:var(--color-gold);" />
            <span style="font-size:13px;color:var(--color-text);">${_esc(league.leagueName)}</span>
            <span style="font-size:11px;color:var(--color-text-dim);margin-left:auto;">${league.season||''}</span>
          </label>`).join('')}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button onclick="this.closest('div[style*=inset]').remove()"
          style="padding:7px 14px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-muted);cursor:pointer;font-family:var(--font-body);">Cancel</button>
        <button id="lsel-save"
          style="padding:7px 16px;background:var(--color-gold);color:#0a0e1a;border:none;border-radius:var(--radius-sm);cursor:pointer;font-family:var(--font-display);font-weight:700;text-transform:uppercase;letter-spacing:.04em;">Save</button>
      </div>
    </div>`;
  document.body.appendChild(div);
  div.querySelector('#lsel-save').onclick = () => {
    const checked = [...div.querySelectorAll('input:checked')].map(cb => cb.value);
    div.remove();
    callback(checked);
  };
}

// ── Broadcast ──────────────────────────────────────────────

async function showGroupBroadcast(groupId, groupName, leagueKeys) {
  const msg = prompt(`Broadcast to all league chats in "${groupName}":\n\nThis posts as your username in each league chat.`);
  if (!msg?.trim()) return;
  const username = Auth.getCurrentProfile()?.username || 'Commissioner';
  let sent = 0;
  await Promise.all(leagueKeys.map(async key => {
    try {
      await firebase.database().ref(`gmd/leagueChats/${key}`).push({
        user: username,
        text: msg.trim(),
        ts:   Date.now(),
        type: 'text',
        isBroadcast: true
      });
      sent++;
    } catch(e) {}
  }));
  showToast(`✅ Broadcast sent to ${sent} of ${leagueKeys.length} leagues`);
}

// ── Helpers ────────────────────────────────────────────────

function _getCurrentLeagueEntries() {
  // Get leagues from current profile as [{ key, league }] array
  const profile = Auth.getCurrentProfile();
  if (!profile?.leagues) return [];
  return Object.entries(profile.leagues).map(([key, league]) => ({ key, league }));
}

function _esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Public API ─────────────────────────────────────────────
const LeagueGroups = {
  applyLeagueOrder,
  getLeagueLabelMap,
  getPersonalLabels,
  onLeagueDragStart,
  onLeagueDragEnd,
  onLeagueDragOver,
  onLeagueDragLeave,
  onLeagueDrop,
  showGroupManager,
  switchGMTab,
  addPresetLabel,
  createCustomLabel,
  editLabelLeagues,
  deleteLabelAndRefresh,
  renderLabelsTab,
  renderCommTab,
  createCommGroup,
  deleteGroupAndRefresh,
  showGroupBroadcast,
  openLeagueSelector
};
