// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — League Chat
//  Ported from SleeperBid/chat.js
//  Uses gmd/leagueChats/{leagueKey}/ instead of leagues/{id}/chat/
// ─────────────────────────────────────────────────────────

const DLRChat = (() => {

  let _chatUnsub    = null;
  let _chatLeagueKey = null;

  // ── Init ─────────────────────────────────────────────────

  function init(leagueKey, leagueName) {
    _chatLeagueKey = leagueKey;

    const container = document.getElementById('chat-panel-body');
    if (!container) return;

    container.innerHTML = `
      <div class="chat-league-title">${_esc(leagueName || 'League Chat')}</div>

      <!-- GIF panel -->
      <div id="chat-gif-panel" style="display:none;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);padding:10px;margin-bottom:8px;">
        <div style="display:flex;gap:8px;margin-bottom:8px;">
          <input id="chat-gif-input" type="text" placeholder="Search GIFs…"
            style="flex:1;padding:7px 10px;background:var(--color-bg-3);border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text);font-family:var(--font-body);font-size:13px;outline:none;"
            oninput="DLRChat.searchGifs(this.value)" />
          <button onclick="document.getElementById('chat-gif-panel').style.display='none'"
            style="padding:6px 10px;background:none;border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-dim);cursor:pointer;">✕</button>
        </div>
        <div id="chat-gif-results" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-height:180px;overflow-y:auto;"></div>
      </div>

      <!-- Messages -->
      <div id="chat-messages" class="chat-messages">
        <div class="chat-empty">Loading messages…</div>
      </div>

      <!-- Toolbar -->
      <div class="chat-toolbar">
        <div style="position:relative;">
          <button onclick="DLRChat.toggleSmackMenu()" id="smack-btn" class="chat-tool-btn" title="Smack Talk">🔥</button>
          <div id="smack-menu" style="display:none;position:absolute;bottom:calc(100%+4px);left:0;width:280px;background:var(--color-bg-2);border:1px solid var(--color-border);border-radius:var(--radius);box-shadow:var(--shadow-lg);z-index:100;max-height:220px;overflow-y:auto;"></div>
        </div>
        <button onclick="DLRChat.openGifSearch()" class="chat-tool-btn" title="GIF">🎬</button>
        <button onclick="DLRChat.openPollCreator()" class="chat-tool-btn" title="Poll">📊</button>
        <div style="position:relative;">
          <button onclick="DLRChat.toggleEmojiPicker()" class="chat-tool-btn" title="Emoji">😊</button>
          <div id="chat-emoji-picker" style="display:none;position:absolute;bottom:calc(100%+4px);left:0;width:260px;background:var(--color-bg-2);border:1px solid var(--color-border);border-radius:var(--radius);box-shadow:var(--shadow-lg);z-index:100;padding:8px;">
            <div style="display:flex;flex-wrap:wrap;gap:2px;">
              ${['🏈','🏆','🔥','💪','😂','😤','💀','🎉','👀','😮','🤣','😭','💯','🤡','👑','⚡','🎯','🗑️','💰','🤑','😈','🙌','👏','🫡','😎','🥶','🤠','🧠','😅','🫠'].map(e=>`<span onclick="DLRChat.insertEmoji('${e}')" style="font-size:20px;cursor:pointer;padding:3px;border-radius:4px;" onmouseover="this.style.background='var(--color-surface)'" onmouseout="this.style.background=''">${e}</span>`).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- Input -->
      <div class="chat-input-row">
        <textarea id="chat-input" class="chat-input" placeholder="Message…" rows="1"
          onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();DLRChat.send();}"
          oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,120)+'px'"></textarea>
        <button onclick="DLRChat.send()" class="btn-primary" style="width:auto;padding:10px 18px;flex-shrink:0;">Send</button>
      </div>`;

    _subscribeChat(leagueKey);
  }

  // ── Firebase subscription ─────────────────────────────────

  function _subscribeChat(leagueKey) {
    if (_chatUnsub) { _chatUnsub(); _chatUnsub = null; }
    const msgs = [];
    const ref  = db.ref(`gmd/leagueChats/${leagueKey}`).limitToLast(100);

    const onAdded = ref.on('child_added', snap => {
      msgs.push({ id: snap.key, ...snap.val() });
      _renderMessages(msgs);
    });
    const onRemoved = ref.on('child_removed', snap => {
      const idx = msgs.findIndex(m => m.id === snap.key);
      if (idx !== -1) msgs.splice(idx, 1);
      _renderMessages(msgs);
    });
    _chatUnsub = () => { ref.off('child_added', onAdded); ref.off('child_removed', onRemoved); };
  }

  function unsubscribe() {
    if (_chatUnsub) { _chatUnsub(); _chatUnsub = null; }
    _chatLeagueKey = null;
  }

  // ── Render messages ───────────────────────────────────────

  function _renderMessages(msgs) {
    const el = document.getElementById('chat-messages');
    if (!el) return;
    const me = (Auth.getCurrentProfile()?.username || '').toLowerCase();
    const wasAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;

    el.innerHTML = '';

    if (!msgs.length) {
      el.innerHTML = '<div class="chat-empty">No messages yet. Say something! 👋</div>';
      return;
    }

    msgs.forEach(m => {
      const isMine = (m.user || '').toLowerCase() === me;
      const ts     = m.ts ? new Date(m.ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';

      const row = document.createElement('div');
      row.className = 'chat-row ' + (isMine ? 'chat-row--mine' : 'chat-row--theirs');

      const name = document.createElement('div');
      name.className = 'chat-name';
      name.textContent = m.user || '';
      if (m.isBroadcast) name.textContent += ' 📣';
      row.appendChild(name);

      if (m.type === 'poll') {
        row.appendChild(_renderPollBubble(m, me, isMine));
      } else {
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble ' + (isMine ? 'chat-bubble--mine' : 'chat-bubble--theirs');

        if (m.type === 'gif') {
          const img  = document.createElement('img');
          img.src    = m.text || '';
          img.style.cssText = 'max-width:200px;border-radius:8px;display:block;';
          img.loading = 'lazy';
          bubble.appendChild(img);
          bubble.style.background = 'transparent';
          bubble.style.padding = '0';
        } else {
          bubble.textContent = m.text || '';
        }

        if (isMine) {
          const del = document.createElement('button');
          del.className = 'chat-del-btn';
          del.textContent = '✕';
          del.onclick = () => _deleteMsg(m.id);
          bubble.addEventListener('mouseenter', () => del.style.opacity = '1');
          bubble.addEventListener('mouseleave', () => del.style.opacity = '0');
          bubble.appendChild(del);
        }
        row.appendChild(bubble);
      }

      const time = document.createElement('div');
      time.className = 'chat-time';
      time.textContent = ts;
      row.appendChild(time);

      el.appendChild(row);
    });

    if (wasAtBottom) el.scrollTop = el.scrollHeight;
  }

  // ── Send ──────────────────────────────────────────────────

  async function send() {
    const input = document.getElementById('chat-input');
    const text  = (input?.value || '').trim();
    if (!text || !_chatLeagueKey) return;
    const user = Auth.getCurrentProfile()?.username || 'Anonymous';
    input.value = '';
    input.style.height = '44px';
    try {
      await db.ref(`gmd/leagueChats/${_chatLeagueKey}`).push({
        user, text, ts: Date.now(), type: 'text'
      });
    } catch(e) { console.warn('Chat send failed:', e); }
  }

  async function _deleteMsg(msgId) {
    if (!_chatLeagueKey || !msgId) return;
    try {
      await db.ref(`gmd/leagueChats/${_chatLeagueKey}/${msgId}`).remove();
    } catch(e) { console.warn('Delete failed:', e); }
  }

  // ── Smack talk ────────────────────────────────────────────

  const SMACK_LINES = [
    "Your team is so bad, even the bye weeks are an improvement.",
    "I've seen better rosters on a participation trophy.",
    "Your draft strategy was bold. Boldly wrong.",
    "I'm not saying you're the worst manager in the league, but the standings are.",
    "Your team has more injuries than a demolition derby.",
    "Bold move starting that guy. Bold. Wrong. But bold.",
    "Your waiver wire pickups belong in the trash wire.",
    "You're one bad week away from a last-place trophy.",
    "I'd say good luck this week but I don't want to lie.",
    "Your team looks like it was drafted on a dartboard. Blindfolded.",
    "Even your kicker is on the injury report.",
    "I've seen more upside in a flat line.",
  ];

  function toggleSmackMenu() {
    const menu = document.getElementById('smack-menu');
    if (!menu) return;
    if (menu.style.display === 'none') {
      menu.innerHTML = SMACK_LINES.map((l, i) =>
        `<div onclick="DLRChat.selectSmack(${i})"
          style="padding:8px 12px;font-size:12px;cursor:pointer;border-bottom:1px solid var(--color-border);color:var(--color-text);"
          onmouseover="this.style.background='var(--color-surface)'"
          onmouseout="this.style.background=''">${_esc(l)}</div>`
      ).join('');
      menu.style.display = '';
      setTimeout(() => {
        document.addEventListener('click', function _close(e) {
          if (!document.getElementById('smack-btn')?.contains(e.target)) {
            menu.style.display = 'none';
            document.removeEventListener('click', _close);
          }
        });
      }, 0);
    } else {
      menu.style.display = 'none';
    }
  }

  function selectSmack(idx) {
    const input = document.getElementById('chat-input');
    if (input) {
      input.value = SMACK_LINES[idx];
      input.focus();
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    }
    const menu = document.getElementById('smack-menu');
    if (menu) menu.style.display = 'none';
  }

  // ── GIF search ────────────────────────────────────────────

  let _gifTimer = null;

  function openGifSearch() {
    const panel = document.getElementById('chat-gif-panel');
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
    if (panel.style.display === '') {
      document.getElementById('chat-gif-input')?.focus();
      searchGifs('fantasy football trash talk');
    }
  }

  function searchGifs(query) {
    clearTimeout(_gifTimer);
    if (!query.trim()) return;
    _gifTimer = setTimeout(async () => {
      const el = document.getElementById('chat-gif-results');
      if (!el) return;
      el.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--color-text-dim);font-size:11px;padding:8px;">Searching…</div>';
      try {
        const resp = await fetch('https://g.tenor.com/v1/search?key=LIVDSRZULELA&contentfilter=low&media_filter=minimal&limit=12&q=' + encodeURIComponent(query));
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();
        const results = data.results || [];
        if (!results.length) {
          el.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--color-text-dim);font-size:11px;padding:8px;">No GIFs found</div>';
          return;
        }
        el.innerHTML = results.map(g => {
          const fmt     = (g.media || [])[0] || {};
          const preview = (fmt.tinygif || fmt.nanogif || fmt.gif || {}).url || '';
          const full    = (fmt.gif || fmt.mediumgif || fmt.tinygif || {}).url || preview;
          if (!preview) return '';
          return `<img src="${preview}" data-gifurl="${encodeURIComponent(full)}"
            style="width:100%;height:80px;object-fit:cover;border-radius:4px;cursor:pointer;border:2px solid transparent;"
            onmouseover="this.style.borderColor='var(--color-gold)'"
            onmouseout="this.style.borderColor='transparent'"
            onclick="DLRChat.sendGif(decodeURIComponent(this.dataset.gifurl))" />`;
        }).join('');
      } catch(e) {
        el.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--color-text-dim);font-size:11px;padding:8px;">Could not load GIFs</div>';
      }
    }, 500);
  }

  async function sendGif(url) {
    if (!url || !_chatLeagueKey) return;
    const user  = Auth.getCurrentProfile()?.username || 'Anonymous';
    const panel = document.getElementById('chat-gif-panel');
    if (panel) panel.style.display = 'none';
    try {
      await db.ref(`gmd/leagueChats/${_chatLeagueKey}`).push({
        user, text: url, ts: Date.now(), type: 'gif'
      });
    } catch(e) { console.warn('GIF send failed:', e); }
  }

  // ── Emoji picker ──────────────────────────────────────────

  function toggleEmojiPicker() {
    const ep = document.getElementById('chat-emoji-picker');
    if (!ep) return;
    const isHidden = ep.style.display === 'none' || !ep.style.display;
    ep.style.display = isHidden ? '' : 'none';
    if (isHidden) {
      setTimeout(() => {
        document.addEventListener('click', function _close(e) {
          if (!ep.contains(e.target) && !e.target.closest('[onclick*="toggleEmojiPicker"]')) {
            ep.style.display = 'none';
          }
          document.removeEventListener('click', _close);
        });
      }, 50);
    }
  }

  function insertEmoji(emoji) {
    const input = document.getElementById('chat-input');
    if (!input) return;
    const s = input.selectionStart || 0;
    const e = input.selectionEnd   || 0;
    input.value = input.value.slice(0, s) + emoji + input.value.slice(e);
    input.selectionStart = input.selectionEnd = s + emoji.length;
    input.focus();
    const ep = document.getElementById('chat-emoji-picker');
    if (ep) ep.style.display = 'none';
  }

  // ── Poll ──────────────────────────────────────────────────

  function openPollCreator() {
    document.getElementById('dlr-poll-creator')?.remove();
    const panel = document.createElement('div');
    panel.id = 'dlr-poll-creator';
    panel.className = 'modal-overlay';
    panel.style.zIndex = '700';
    panel.innerHTML = `
      <div class="modal-box modal-box--sm">
        <div class="modal-header">
          <h3>📊 Create a Poll</h3>
          <button class="modal-close" onclick="document.getElementById('dlr-poll-creator').remove()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Question</label>
            <input id="poll-question" type="text" placeholder="Ask a question…" />
          </div>
          <div id="poll-options-list">
            <input class="poll-opt" type="text" placeholder="Option 1" style="width:100%;margin-bottom:6px;padding:8px 12px;background:var(--color-bg-3);border:1px solid var(--color-border);border-radius:var(--radius);color:var(--color-text);font-family:var(--font-body);font-size:13px;outline:none;" />
            <input class="poll-opt" type="text" placeholder="Option 2" style="width:100%;margin-bottom:6px;padding:8px 12px;background:var(--color-bg-3);border:1px solid var(--color-border);border-radius:var(--radius);color:var(--color-text);font-family:var(--font-body);font-size:13px;outline:none;" />
          </div>
          <button onclick="DLRChat.addPollOption()"
            style="font-size:12px;padding:5px 12px;background:none;border:1px solid var(--color-border);border-radius:var(--radius-sm);color:var(--color-text-muted);cursor:pointer;font-family:var(--font-body);">+ Add Option</button>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="document.getElementById('dlr-poll-creator').remove()">Cancel</button>
          <button class="btn-primary" style="width:auto;" onclick="DLRChat.submitPoll()">Post Poll</button>
        </div>
      </div>`;
    document.body.appendChild(panel);
    panel.addEventListener('click', e => { if (e.target === panel) panel.remove(); });
    document.getElementById('poll-question')?.focus();
  }

  function addPollOption() {
    const list = document.getElementById('poll-options-list');
    if (!list || list.querySelectorAll('.poll-opt').length >= 4) return;
    const count = list.querySelectorAll('.poll-opt').length;
    const inp = document.createElement('input');
    inp.className = 'poll-opt';
    inp.type = 'text';
    inp.placeholder = `Option ${count + 1}`;
    inp.style.cssText = 'width:100%;margin-bottom:6px;padding:8px 12px;background:var(--color-bg-3);border:1px solid var(--color-border);border-radius:var(--radius);color:var(--color-text);font-family:var(--font-body);font-size:13px;outline:none;';
    list.appendChild(inp);
    inp.focus();
  }

  async function submitPoll() {
    const question = (document.getElementById('poll-question')?.value || '').trim();
    const options  = [...document.querySelectorAll('.poll-opt')].map(el => el.value.trim()).filter(Boolean);
    if (!question)          { alert('Please enter a question.'); return; }
    if (options.length < 2) { alert('Please add at least 2 options.'); return; }
    const user = Auth.getCurrentProfile()?.username || 'Anonymous';
    document.getElementById('dlr-poll-creator')?.remove();
    await db.ref(`gmd/leagueChats/${_chatLeagueKey}`).push({
      type: 'poll', user, question, options, votes: {}, ts: Date.now()
    });
  }

  function _renderPollBubble(m, me, isMine) {
    const votes = m.votes || {};
    const opts  = m.options || [];
    const total = Object.keys(votes).length;
    const myVote = votes[me] !== undefined ? votes[me] : -1;

    const card = document.createElement('div');
    card.style.cssText = 'background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:12px 14px;min-width:220px;max-width:300px;position:relative;';

    const header = document.createElement('div');
    header.style.cssText = 'font-size:11px;font-weight:700;color:var(--color-gold);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;';
    header.textContent = '📊 Poll';
    card.appendChild(header);

    const q = document.createElement('div');
    q.style.cssText = 'font-size:14px;font-weight:600;color:var(--color-text);margin-bottom:10px;';
    q.textContent = m.question || '';
    card.appendChild(q);

    opts.forEach((opt, idx) => {
      const voters = Object.entries(votes).filter(([,v]) => v === idx);
      const pct    = total > 0 ? Math.round(voters.length / total * 100) : 0;
      const voted  = myVote === idx;

      const btn = document.createElement('button');
      btn.style.cssText = `width:100%;text-align:left;padding:7px 10px;border-radius:8px;cursor:pointer;font-family:var(--font-body);font-size:13px;position:relative;overflow:hidden;margin-bottom:6px;border:1px solid ${voted?'var(--color-gold)':'var(--color-border)'};background:${voted?'rgba(240,180,41,.1)':'var(--color-bg-3)'};color:var(--color-text);`;

      const fill = document.createElement('div');
      fill.style.cssText = `position:absolute;top:0;left:0;height:100%;background:${voted?'rgba(240,180,41,.2)':'rgba(255,255,255,.05)'};width:${pct}%;border-radius:8px;`;
      btn.appendChild(fill);

      const label = document.createElement('span');
      label.style.cssText = 'position:relative;z-index:1;display:flex;justify-content:space-between;align-items:center;gap:8px;';
      label.innerHTML = `<span>${_esc(opt)}</span><span style="font-size:11px;color:var(--color-text-dim);">${pct}% (${voters.length})</span>`;
      btn.appendChild(label);
      btn.onclick = () => _castVote(m.id, idx, me);
      card.appendChild(btn);
    });

    const footer = document.createElement('div');
    footer.style.cssText = 'font-size:11px;color:var(--color-text-dim);margin-top:4px;';
    footer.textContent = total + ' vote' + (total !== 1 ? 's' : '');
    card.appendChild(footer);

    return card;
  }

  function _castVote(msgId, optionIdx, username) {
    if (!_chatLeagueKey || !msgId) return;
    db.ref(`gmd/leagueChats/${_chatLeagueKey}/${msgId}/votes/${username}`).set(optionIdx)
      .catch(e => console.warn('Vote failed:', e));
  }

  // ── Helpers ───────────────────────────────────────────────

  function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Public API ────────────────────────────────────────────
  return {
    init,
    unsubscribe,
    send,
    toggleSmackMenu,
    selectSmack,
    openGifSearch,
    searchGifs,
    sendGif,
    toggleEmojiPicker,
    insertEmoji,
    openPollCreator,
    addPollOption,
    submitPoll
  };

})();
