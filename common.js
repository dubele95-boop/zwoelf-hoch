/* Spieleabend – gemeinsamer Browser-Teil für Gleichklang, Bombe entschärfen und Durch die Nacht.
   Kümmert sich um Verbindung, Startseite, Lobby, Chat, Regeln und Töne. Jedes Spiel liefert nur noch sein Spielfeld. */
(function () {
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const q = (sel, root) => (root || document).querySelector(sel);

  /* ---------- Töne (werden im Browser erzeugt) ---------- */
  const Snd = {
    ctx: null, master: null, on: LS.get('zh.sound', '1') === '1', custom: {},
    unlock() {
      try {
        if (!this.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return; this.ctx = new C(); this.master = this.ctx.createGain(); this.master.gain.value = .55; this.master.connect(this.ctx.destination); }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) {}
    },
    tone(f, t, dur, type, vol) {
      const c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = type || 'triangle'; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + .012); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + .05);
    },
    noise(t, dur, vol, freq, type) {
      const c = this.ctx, n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
      const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      src.buffer = buf; f.type = type || 'bandpass'; f.frequency.value = freq || 2200; f.Q.value = .9; g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
    },
    play(name, vol) {
      if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime, v = vol == null ? 1 : vol;
      if (this.custom[name]) return this.custom[name](this, t, v);
      switch (name) {
        case 'click': this.tone(900, t, .06, 'sine', .08 * v); break;
        case 'ok': this.tone(784, t, .18, 'triangle', .14 * v); this.tone(1175, t + .08, .25, 'triangle', .12 * v); break;
        case 'bad': this.tone(180, t, .18, 'sawtooth', .08 * v); this.tone(130, t + .15, .3, 'sawtooth', .08 * v); break;
        case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, t + i * .12, .35, 'triangle', .16 * v)); break;
        case 'lose': [392, 330, 262, 196].forEach((f, i) => this.tone(f, t + i * .16, .4, 'triangle', .14 * v)); break;
        case 'chat': this.tone(1320, t, .08, 'sine', .05 * v); break;
        case 'error': this.tone(140, t, .12, 'sawtooth', .07); this.tone(120, t + .13, .16, 'sawtooth', .07); break;
      }
    }
  };
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => Snd.unlock(), { capture: true }));

  const ICON = {
    sndOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>',
    sndOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>'
  };

  function start(cfg) {
    const S = { ws: null, token: LS.get('zh.token', null), me: null, room: null, name: LS.get('zh.name', ''), connected: false, everConnected: false, retry: 0, view: null, confirmLobby: 0, chatN: 0, players: false };
    Object.assign(Snd.custom, cfg.sounds || {});
    document.title = cfg.title + ' – Spieleabend';
    const app = q('#app');
    app.innerHTML = '<header class="bar"><div class="brand"><a class="homelink" href="/" title="Zurück zum Spieleabend" aria-label="Zurück zum Spieleabend">‹</a>' + cfg.brand + '<span>' + esc(cfg.tagline) + '</span></div><div class="actions" id="actions"></div></header><main id="view"></main>';
    document.body.insertAdjacentHTML('beforeend', '<div id="rules" class="modal" role="dialog" aria-modal="true" aria-labelledby="rulesTitle" hidden></div><div id="players" class="modal" role="dialog" aria-modal="true" aria-labelledby="playersTitle" hidden></div><div id="toast" role="status" aria-live="polite"></div>');
    const view = q('#view'), actions = q('#actions');
    const hashCode = () => (location.hash || '').replace('#', '').toUpperCase().trim();

    let toastT;
    function toast(msg, ms) { const t = q('#toast'); t.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => { t.textContent = ''; }, ms || 3600); }
    function send(m) { if (S.ws && S.ws.readyState === 1) { S.ws.send(JSON.stringify(m)); return true; } toast('Keine Verbindung – einen Moment …'); return false; }
    const act = (a, extra) => send({ t: 'act', a, ...(extra || {}) });
    const pname = id => { const r = S.room; if (!r) return 'Jemand'; const p = r.players.find(x => x.id === id) || r.waiting.find(x => x.id === id); return p ? p.name : 'Jemand'; };
    const isHost = () => !!(S.room && S.room.host === S.me);

    function connect() {
      const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws/' + cfg.game);
      S.ws = ws;
      ws.onopen = () => { S.retry = 0; ws.send(JSON.stringify({ t: 'hello', token: S.token })); };
      ws.onmessage = ev => {
        const m = JSON.parse(ev.data);
        if (m.t === 'welcome') {
          S.token = m.token; S.me = m.id; LS.set('zh.token', m.token);
          const first = !S.everConnected; S.connected = true; S.everConnected = true; render();
          if (first && hashCode().length === 4 && S.name.trim()) setTimeout(() => { if (!S.room) send({ t: 'join', code: hashCode(), name: S.name.trim() }); }, 60);
        } else if (m.t === 'state') {
          const prev = S.room; S.room = m.room;
          if (location.hash !== '#' + m.room.code) history.replaceState(null, '', '#' + m.room.code);
          render();
          if (cfg.onState) try { cfg.onState(prev, m.room, api); } catch (e) { console.error(e); }
          const n = (m.room.chat || []).length ? m.room.chat[m.room.chat.length - 1].n : 0;
          if (prev && n > S.chatN && m.room.chat[m.room.chat.length - 1].id !== S.me) Snd.play('chat', .7);
          S.chatN = n;
        } else if (m.t === 'nogame') {
          if (S.room) { S.room = null; render(); toast('Der Tisch ist nicht mehr da.'); }
        } else if (m.t === 'error') { toast(m.msg); Snd.play('error'); }
        else if (m.t === 'left' || m.t === 'ended' || m.t === 'kicked') {
          if (m.t === 'ended') toast('Der Tisch wurde aufgelöst.');
          if (m.t === 'kicked') toast('Der Gastgeber hat dich vom Tisch genommen. Über den Einladungslink kannst du wieder einsteigen.', 6000);
          S.room = null; history.replaceState(null, '', location.pathname); render();
        }
      };
      ws.onclose = () => { S.connected = false; renderBar(); S.retry++; setTimeout(connect, Math.min(8000, 700 * S.retry)); };
    }
    setInterval(() => { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify({ t: 'ping' })); }, 30000);

    /* ---------- Kopfzeile ---------- */
    function renderBar() {
      const r = S.room;
      let h = '<button class="btn small" data-c="sound" aria-pressed="' + Snd.on + '">' + (Snd.on ? ICON.sndOn + 'Ton an' : ICON.sndOff + 'Ton aus') + '</button>';
      if (S.everConnected && !S.connected) h += '<span class="pill wait">Verbinde neu …</span>';
      h += '<button class="btn small" data-c="rules" aria-haspopup="dialog">Regeln</button>';
      if (r && r.status !== 'lobby' && isHost()) {
        h += '<button class="btn small" data-c="players" aria-haspopup="dialog">Mitspieler</button>';
        h += '<button class="btn small" data-c="toLobby">' + (Date.now() - S.confirmLobby < 4000 ? 'Wirklich zur Lobby?' : 'Zur Lobby') + '</button>';
      }
      if (r) h += '<button class="btn small" data-c="leave">' + (r.status === 'lobby' ? 'Tisch verlassen' : 'Zur Startseite') + '</button>';
      actions.innerHTML = h;
    }

    /* ---------- Startseite ---------- */
    function renderHome() {
      if (S.view === 'home') return; S.view = 'home';
      const code = hashCode();
      view.innerHTML = '<section class="home">' +
        '<div class="hero">' + cfg.hero + '</div>' +
        '<div class="panel" style="display:flex;flex-direction:column;gap:14px">' +
          '<div class="field"><label class="label" for="nameInput">Dein Name</label><input type="text" id="nameInput" maxlength="18" autocomplete="nickname" value="' + esc(S.name) + '" placeholder="z. B. Saskia"></div>' +
          '<button class="btn primary big" data-c="create">Neuen Tisch erstellen</button>' +
          '<div class="field"><label class="label" for="codeInput">Oder mit Tisch-Code beitreten</label><div class="row"><input type="text" id="codeInput" maxlength="4" style="width:8em;text-transform:uppercase;letter-spacing:.2em;font-weight:700" value="' + esc(code.length === 4 ? code : '') + '" placeholder="ABCD"><button class="btn" data-c="join">Beitreten</button></div></div>' +
          '<small class="muted">Keine Anmeldung nötig. Wer den Link bekommt, kann mitspielen.</small>' +
        '</div></section>';
    }

    /* ---------- Lobby ---------- */
    function renderLobby() {
      S.view = 'lobby';
      const r = S.room, host = isHost(), n = r.players.length, G = cfg.meta;
      const link = location.origin + location.pathname + '#' + r.code;
      const notice = r.notice === 'aborted' ? '<div class="panel notice"><b>Zurück in der Lobby.</b> ' + (host ? 'Du kannst die Einstellungen ändern und neu starten.' : esc(pname(r.host)) + ' hat die Runde abgebrochen und startet gleich neu.') + '</div>' : '';
      const bots = r.players.filter(p => p.bot).length;
      view.innerHTML = notice + '<section class="lobby">' +
        '<div class="panel" style="display:flex;flex-direction:column;gap:12px;min-width:0">' +
          '<div class="label">Tisch-Code</div><div class="bigcode">' + esc(r.code) + '</div>' +
          '<div class="field"><label class="label" for="invite">Einladungslink</label><div class="row"><input type="text" id="invite" readonly value="' + esc(link) + '" style="flex:1"><button class="btn" data-c="copy">Kopieren</button></div></div>' +
          (cfg.lobby ? cfg.lobby(r, host, api) : '') +
        '</div>' +
        '<div class="panel" style="display:flex;flex-direction:column;gap:12px;min-width:0">' +
          '<div class="label">Spieler (' + n + '/' + G.max + ')</div>' +
          '<ul class="plist">' + r.players.map(p => '<li><span>' + esc(p.name) + (p.id === S.me ? ' <span class="muted">(du)</span>' : '') + (p.online ? '' : ' <span class="muted">(offline)</span>') + (cfg.playerExtra ? cfg.playerExtra(r, p, api) : '') + '</span><span class="row" style="gap:6px;flex-wrap:nowrap">' +
            (p.bot ? '<span class="pill bot">Bot</span>' : '') + (p.id === r.host ? '<span class="pill wait">Gastgeber</span>' : '') +
            (host && p.id !== S.me ? '<button type="button" class="btn small" data-c="kick" data-pid="' + esc(p.id) + '">Entfernen</button>' : '') + '</span></li>').join('') + '</ul>' +
          (cfg.lobbyRight ? cfg.lobbyRight(r, host, api) : '') +
          (host && G.bots ? '<div class="row"><button type="button" class="btn" data-c="addBot"' + (n >= G.max || bots >= (G.maxBots || 4) ? ' disabled' : '') + '>+ Bot hinzufügen</button><small class="muted">Bots spielen automatisch mit.</small></div>' : '') +
          (host ? '<div class="row"><button class="btn primary big" data-c="start"' + (n < G.min ? ' disabled' : '') + '>Spiel starten</button></div>' : '<p class="muted">Warte, bis ' + esc(pname(r.host)) + ' das Spiel startet.</p>') +
          (host && n < G.min ? '<p class="muted">Es braucht mindestens ' + G.min + ' Spieler. Schick den Einladungslink herum' + (G.bots ? ' oder nimm Bots dazu' : '') + '.</p>' : '') +
        '</div></section>';
    }

    /* ---------- Spiel ---------- */
    function renderGame() {
      const r = S.room;
      const chatOn = cfg.chat !== false;
      if (S.view !== 'game') {
        S.view = 'game'; S.chatShown = 0;
        view.innerHTML = '<div id="watchbar"></div><div class="stage' + (chatOn ? '' : ' nochat') + '"><section id="game" style="min-width:0"></section>' +
          (chatOn ? '<aside class="chat panel" aria-label="Chat"><div class="label">Chat</div><div class="msgs" id="msgs" aria-live="polite"></div><div id="chatquiet" class="quiet" hidden></div><form id="chatform" autocomplete="off"><input type="text" id="chatInput" maxlength="200" placeholder="Nachricht …" aria-label="Nachricht"><button class="btn" type="submit">Senden</button></form></aside>' : '') + '</div>';
      }
      const me = r.players.find(p => p.id === S.me), waiting = r.waiting.some(p => p.id === S.me);
      q('#watchbar').innerHTML = !me ? '<div class="panel watchbar">' + (waiting ? 'Die Runde läuft schon. <b>Du spielst ab der nächsten Runde mit.</b>' : 'Du schaust zu.') + '</div>' : '';
      cfg.render(r, q('#game'), api);
      if (chatOn) renderChat();
    }
    function renderChat() {
      const r = S.room, box = q('#msgs'); if (!box) return;
      const list = r.chat || [], last = list.length ? list[list.length - 1].n : 0;
      if (last !== S.chatShown) {
        const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
        box.innerHTML = list.length ? list.map(m => m.sys ? '<div class="msg sys">' + esc(m.text) + '</div>' : '<div class="msg' + (m.id === S.me ? ' me' : '') + '"><b>' + esc(m.name) + ':</b> ' + esc(m.text) + '</div>').join('') : '<div class="msg sys">Hier könnt ihr euch absprechen.</div>';
        if (atBottom || !S.chatShown) box.scrollTop = box.scrollHeight;
        S.chatShown = last;
      }
      const quiet = cfg.chatQuiet ? cfg.chatQuiet(r) : null, qe = q('#chatquiet'), inp = q('#chatInput');
      qe.hidden = !quiet; if (quiet) qe.textContent = quiet;
      q('#chatform').hidden = !!quiet;
      if (inp) inp.disabled = !r.players.some(p => p.id === S.me) && !r.waiting.some(p => p.id === S.me);
    }

    function render() {
      renderBar();
      if (!S.everConnected) { S.view = 'boot'; view.innerHTML = '<div class="panel muted">Verbinde mit dem Spieltisch …</div>'; return; }
      if (!S.room) return renderHome();
      if (S.room.status === 'lobby') return renderLobby();
      renderGame();
      if (!q('#players').hidden) openPlayers();
    }

    /* ---------- Regeln & Mitspieler ---------- */
    function openRules() {
      const el = q('#rules');
      el.innerHTML = '<div class="panel modalbox wide"><div class="modalhead"><h2 id="rulesTitle">So geht\'s</h2><button class="btn small" data-c="closeModal">Schließen</button></div><div class="rulebody">' + cfg.rules(S.room, api) + '</div></div>';
      el.hidden = false;
    }
    function openPlayers() {
      const r = S.room, el = q('#players'); if (!r) return;
      el.innerHTML = '<div class="panel modalbox wide" style="max-width:520px"><div class="modalhead"><h2 id="playersTitle">Mitspieler</h2><button class="btn small" data-c="closeModal">Fertig</button></div>' +
        '<ul class="plist">' + r.players.concat(r.waiting.map(w => ({ ...w, waiting: true }))).map(p => '<li><span>' + esc(p.name) + (p.id === S.me ? ' <span class="muted">(du)</span>' : '') + (p.online === false ? ' <span class="muted">(offline)</span>' : '') + (p.waiting ? ' <span class="muted">(ab nächster Runde)</span>' : '') + '</span>' +
          (p.id !== S.me ? '<button class="btn small" data-c="kick" data-pid="' + esc(p.id) + '">Entfernen</button>' : '') + '</li>').join('') + '</ul>' +
        '<small class="muted">Wer rausgeflogen ist, kommt über den Einladungslink mit seinem Namen wieder auf seinen Platz.</small>' +
        '<div class="field"><label class="label" for="invite2">Einladungslink</label><div class="row"><input type="text" id="invite2" readonly value="' + esc(location.origin + location.pathname + '#' + r.code) + '" style="flex:1"><button class="btn" data-c="copy">Kopieren</button></div></div></div>';
      el.hidden = false;
    }
    function closeModals() { q('#rules').hidden = true; q('#players').hidden = true; }

    /* ---------- Klicks ---------- */
    const C = {
      sound() { Snd.on = !Snd.on; LS.set('zh.sound', Snd.on ? '1' : '0'); Snd.unlock(); renderBar(); if (Snd.on) Snd.play('click'); },
      rules() { openRules(); },
      players() { openPlayers(); },
      closeModal() { closeModals(); },
      create() { const n = (q('#nameInput').value || '').trim(); if (!n) { toast('Bitte gib zuerst deinen Namen ein.'); q('#nameInput').focus(); return; } S.name = n; LS.set('zh.name', n); send({ t: 'create', name: n }); },
      join() {
        const n = (q('#nameInput').value || '').trim(), c = (q('#codeInput').value || '').trim().toUpperCase();
        if (!n) { toast('Bitte gib zuerst deinen Namen ein.'); q('#nameInput').focus(); return; }
        if (c.length !== 4) { toast('Der Tisch-Code hat 4 Buchstaben.'); q('#codeInput').focus(); return; }
        S.name = n; LS.set('zh.name', n); send({ t: 'join', code: c, name: n });
      },
      leave() { send({ t: 'leave' }); },
      copy() {
        const link = location.origin + location.pathname + '#' + S.room.code;
        const done = () => toast('Link kopiert. Schick ihn deinen Freunden.');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, () => { const i = q('#invite') || q('#invite2'); if (i) i.select(); });
        else { const i = q('#invite') || q('#invite2'); if (i) i.select(); }
      },
      start() { send({ t: 'start' }); },
      addBot() { send({ t: 'addBot' }); },
      kick(el) {
        if (S.confirmKick !== el.dataset.pid || Date.now() - S.confirmKickAt > 4000) { S.confirmKick = el.dataset.pid; S.confirmKickAt = Date.now(); el.textContent = 'Wirklich?'; el.classList.add('danger'); return; }
        S.confirmKick = null; send({ t: 'kick', id: el.dataset.pid });
      },
      toLobby() {
        if (S.room && S.room.status === 'playing' && Date.now() - S.confirmLobby > 4000) { S.confirmLobby = Date.now(); renderBar(); setTimeout(renderBar, 4100); toast('Nochmal klicken: Die Runde wird abgebrochen und alle kommen zurück in die Lobby.'); return; }
        S.confirmLobby = 0; send({ t: 'toLobby' });
      },
      again() { send({ t: 'start' }); }
    };
    document.addEventListener('click', e => {
      const c = e.target.closest('[data-c]');
      if (c && !c.disabled) { const f = C[c.dataset.c]; if (f) { f(c, e); return; } }
      const s = e.target.closest('[data-set]');
      if (s && !s.disabled && s.tagName !== 'SELECT') { let v = s.dataset.val; if (v === 'true') v = true; else if (v === 'false') v = false; send({ t: 'setting', key: s.dataset.set, value: v }); return; }
      const a = e.target.closest('[data-act]');
      if (a && !a.disabled && cfg.actions && cfg.actions[a.dataset.act]) cfg.actions[a.dataset.act](a, e, api);
      if (e.target.classList && e.target.classList.contains('modal') && (e.target.id === 'rules' || e.target.id === 'players')) closeModals();
    });
    document.addEventListener('change', e => {
      const s = e.target.closest && e.target.closest('select[data-set]');
      if (s) send({ t: 'setting', key: s.dataset.set, value: s.value });
    });
    document.addEventListener('submit', e => {
      if (e.target.id !== 'chatform') return;
      e.preventDefault();
      const i = q('#chatInput'), text = i.value.trim(); if (!text) return;
      if (send({ t: 'chat', text })) i.value = '';
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeModals(); if (cfg.onEscape) cfg.onEscape(api); }
      if (e.key === 'Enter' && e.target.id === 'codeInput') C.join();
      if (e.key === 'Enter' && e.target.id === 'nameInput') { const c = q('#codeInput'); if (c && c.value.trim().length === 4) C.join(); else C.create(); }
    });
    document.addEventListener('input', e => { if (e.target.id === 'nameInput') { S.name = e.target.value; LS.set('zh.name', e.target.value.trim()); } });

    const api = { S, send, act, toast, esc, pname, isHost, Snd, render, q,
      get room() { return S.room; }, get me() { return S.me; },
      overButtons(r) {
        return isHost() ? '<div class="row" style="justify-content:center"><button class="btn primary big" data-c="again">Nochmal spielen</button><button class="btn big" data-c="toLobby">Zur Lobby</button></div>'
          : '<p class="muted" style="text-align:center">' + esc(pname(r.host)) + ' kann gleich eine neue Runde starten.</p>';
      }
    };
    render(); connect();
    return api;
  }
  window.Spieleabend = { start, esc, LS };
})();
