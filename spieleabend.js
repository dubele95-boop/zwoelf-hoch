// Spieleabend – gemeinsamer Unterbau für die neuen Spiele (Gleichklang, Bombe entschärfen, Durch die Nacht)
// Kümmert sich um Tische, Lobby, Wiedereinstieg, Chat und das Speichern. Die Spielregeln stecken in spiel-*.js.

const crypto = require('crypto');

class Err extends Error {}
const must = (cond, msg) => { if (!cond) throw new Err(msg); };
const cleanName = n => String(n || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 18);
const rid = (n = 9) => crypto.randomBytes(n).toString('base64url');
const BOT_NAMES = ['Bruno', 'Clara', 'Emil', 'Frieda', 'Gustav'];

module.exports = function spieleabend({ store, WebSocketServer }) {
  const GAMES = {
    gleichklang: require('./spiel-gleichklang'),
    bombe: require('./spiel-bombe'),
    nacht: require('./spiel-nacht')
  };
  const rooms = new Map();      // Code -> Tisch
  const sockets = new Map();    // Spieler-ID -> Set<ws>
  const timers = new Map();     // Code -> Map(name -> timeout)  (nur im Speicher)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });

  /* ---------- Speichern (Render Key Value, falls eingerichtet) ---------- */
  const KEY = code => 'sa:room:' + code;
  const saveTimers = new Map();
  const serialize = r => JSON.stringify(r);
  function saveNow(code) {
    saveTimers.delete(code);
    const r = rooms.get(code); if (!store || !r) return Promise.resolve();
    return store.set(KEY(code), serialize(r), 'EX', 24 * 3600).catch(e => console.error('Speichern fehlgeschlagen:', e.message));
  }
  function saveSoon(r) { if (!store || saveTimers.has(r.code)) return; saveTimers.set(r.code, setTimeout(() => saveNow(r.code), 400)); }
  async function load() {
    if (!store) return;
    try {
      let cursor = '0', n = 0;
      do {
        const [next, keys] = await store.scan(cursor, 'MATCH', 'sa:room:*', 'COUNT', 100); cursor = next;
        for (const k of keys) {
          try { const r = JSON.parse(await store.get(k)); if (r && r.code && GAMES[r.game]) { rooms.set(r.code, r); n++; } } catch {}
        }
      } while (cursor !== '0');
      for (const r of rooms.values()) if (r.status === 'playing' && GAMES[r.game].resume) GAMES[r.game].resume(r, ctx);
      if (n) console.log('Spieleabend: ' + n + ' Tisch(e) wiederhergestellt');
    } catch (e) { console.error('Laden fehlgeschlagen:', e.message); }
  }
  async function flush() { await Promise.all([...saveTimers.keys()].map(saveNow)); }
  function dropRoom(code) {
    clearTimers(code); rooms.delete(code);
    if (store) store.del(KEY(code)).catch(() => {});
  }

  /* ---------- Hilfen ---------- */
  const isOnline = id => { const s = sockets.get(id); return !!(s && s.size); };
  function send(ws, m) { if (ws.readyState === 1) ws.send(JSON.stringify(m)); }
  function randCode() {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    for (;;) { let s = ''; for (let i = 0; i < 4; i++) s += A[crypto.randomInt(A.length)]; if (!rooms.has(s)) return s; }
  }
  function timer(r, name, ms, fn) {
    if (!timers.has(r.code)) timers.set(r.code, new Map());
    const t = timers.get(r.code); clearTimeout(t.get(name));
    t.set(name, setTimeout(() => { t.delete(name); if (rooms.get(r.code) !== r) return; try { fn(); } catch (e) { console.error(e); } }, Math.max(0, ms)));
  }
  function clearTimer(r, name) { const t = timers.get(r.code); if (t) { clearTimeout(t.get(name)); t.delete(name); } }
  function clearTimers(code) { const t = timers.get(code); if (t) { for (const x of t.values()) clearTimeout(x); timers.delete(code); } }
  const humansOnline = r => r.players.some(p => !p.bot && isOnline(p.id));
  const ctx = { broadcast: r => broadcast(r), timer, clearTimer, Err, must, isOnline, humansOnline, rand: n => crypto.randomInt(n),
    shuffle: a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; },
    finish: (r) => { r.status = 'over'; } };

  function viewFor(r, id) {
    const G = GAMES[r.game];
    return {
      code: r.code, game: r.game, status: r.status, host: r.host, me: id, round: r.round || 0,
      players: r.players.map(p => ({ id: p.id, name: p.name, bot: !!p.bot, online: p.bot ? true : isOnline(p.id) })),
      waiting: (r.waiting || []).map(p => ({ id: p.id, name: p.name })),
      watching: !r.players.some(p => p.id === id),
      settings: r.settings, chat: (r.chat || []).slice(-60), notice: r.notice || null,
      catalog: G.catalog || null,
      g: r.state ? G.view(r, id) : null
    };
  }
  function broadcast(r) {
    r.updated = Date.now(); saveSoon(r);
    const ids = new Set([...r.players.map(p => p.id), ...(r.waiting || []).map(p => p.id), ...(r.watchers || [])]);
    for (const id of ids) {
      const set = sockets.get(id); if (!set) continue;
      let v = null;
      for (const ws of set) if (ws.room === r.code) { v = v || viewFor(r, id); send(ws, { t: 'state', room: v }); }
    }
  }
  function roomOf(id, game) {
    for (const r of rooms.values()) if (r.game === game && (r.players.some(p => p.id === id) || (r.waiting || []).some(p => p.id === id))) return r;
    return null;
  }
  // Spieler-ID austauschen (wer mit neuem Browser zurückkommt, übernimmt seinen alten Platz)
  function takeSeat(r, oldId, newId) {
    for (const p of r.players) if (p.id === oldId) p.id = newId;
    if (r.host === oldId) r.host = newId;
    if (r.state) r.state = JSON.parse(JSON.stringify(r.state).split(oldId).join(newId));
  }
  function addChat(r, id, name, text, sys) {
    r.chat = r.chat || [];
    r.chat.push({ id, name, text, sys: !!sys, t: Date.now(), n: (r.chatN = (r.chatN || 0) + 1) });
    if (r.chat.length > 80) r.chat.splice(0, r.chat.length - 80);
  }
  ctx.say = (r, text) => addChat(r, null, '', text, true);
  function toLobby(r, notice) {
    clearTimers(r.code);
    r.status = 'lobby'; r.state = null; r.notice = notice || null;
    for (const w of r.waiting || []) if (!r.players.some(p => p.id === w.id)) r.players.push(w);
    r.waiting = [];
    const G = GAMES[r.game]; if (r.players.length > G.meta.max) r.players.length = G.meta.max;
  }
  function removeFromRoom(r, id) {
    r.players = r.players.filter(p => p.id !== id);
    r.waiting = (r.waiting || []).filter(p => p.id !== id);
    r.watchers = (r.watchers || []).filter(x => x !== id);
    const humans = r.players.filter(p => !p.bot);
    if (!humans.length) { dropRoom(r.code); return false; }
    if (r.host === id) r.host = humans[0].id;
    return true;
  }

  /* ---------- Nachrichten ---------- */
  const H = {
    create(ws, m) {
      const name = cleanName(m.name); must(name, 'Gib zuerst deinen Namen ein.');
      const old = roomOf(ws.pid, ws.game); if (old) { must(old.status !== 'playing', 'Du sitzt noch an einem laufenden Tisch.'); if (!removeFromRoom(old, ws.pid)) {} else broadcast(old); }
      const G = GAMES[ws.game];
      const r = { code: randCode(), game: ws.game, host: ws.pid, players: [{ id: ws.pid, name }], waiting: [], watchers: [], status: 'lobby', settings: G.defaults(), state: null, round: 0, chat: [] };
      rooms.set(r.code, r); ws.room = r.code; broadcast(r);
    },
    join(ws, m) {
      const code = String(m.code || '').toUpperCase().trim();
      const r = rooms.get(code); must(r && r.game === ws.game, 'Kein Tisch mit dem Code ' + code + ' gefunden.');
      const G = GAMES[r.game], name = cleanName(m.name);
      const inside = r.players.some(p => p.id === ws.pid) || (r.waiting || []).some(p => p.id === ws.pid);
      if (!inside) {
        must(name, 'Gib zuerst deinen Namen ein.');
        const seat = r.players.find(p => !p.bot && !isOnline(p.id) && p.name.toLowerCase() === name.toLowerCase());
        const old = roomOf(ws.pid, ws.game);
        if (old && old !== r) { must(old.status !== 'playing', 'Du sitzt noch an einem laufenden Tisch.'); if (removeFromRoom(old, ws.pid)) broadcast(old); }
        if (seat) { takeSeat(r, seat.id, ws.pid); ctx.say(r, name + ' ist wieder da.'); }
        else if (r.status === 'lobby') {
          must(r.players.length < G.meta.max, 'Der Tisch ist voll (' + G.meta.max + ' Spieler).');
          r.players.push({ id: ws.pid, name });
        } else {
          must(r.players.length + (r.waiting || []).length < G.meta.max, 'Der Tisch ist voll.');
          r.waiting = r.waiting || []; r.waiting.push({ id: ws.pid, name });
          ctx.say(r, name + ' ist da und spielt ab der nächsten Runde mit.');
        }
      }
      r.watchers = (r.watchers || []).filter(x => x !== ws.pid);
      ws.room = r.code; broadcast(r);
    },
    leave(ws) {
      const r = rooms.get(ws.room); ws.room = null; send(ws, { t: 'left' });
      if (!r) return;
      if (r.status !== 'playing' || (r.waiting || []).some(p => p.id === ws.pid)) { if (removeFromRoom(r, ws.pid)) broadcast(r); }
      else broadcast(r);
    },
    setting(ws, m, r) {
      must(r.host === ws.pid, 'Nur der Gastgeber kann das ändern.');
      const G = GAMES[r.game], key = String(m.key);
      must(r.status !== 'playing' || (G.liveSetting && G.liveSetting(key)), 'Einstellungen kannst du zwischen den Runden ändern.');
      G.setting(r, key, m.value, ctx); broadcast(r);
    },
    addBot(ws, m, r) {
      const G = GAMES[r.game];
      must(r.host === ws.pid && r.status !== 'playing', 'Bots kannst du in der Lobby hinzufügen.');
      must(G.meta.bots, 'In diesem Spiel gibt es keine Bots.');
      must(r.players.length < G.meta.max, 'Der Tisch ist voll.');
      must(r.players.filter(p => p.bot).length < (G.meta.maxBots || 4), 'Mehr Bots gehen nicht.');
      const used = new Set(r.players.map(p => p.name));
      r.players.push({ id: 'bot-' + rid(6), name: BOT_NAMES.find(n => !used.has(n)) || 'Computer', bot: true });
      broadcast(r);
    },
    kick(ws, m, r) {
      must(r.host === ws.pid, 'Nur der Gastgeber kann Mitspieler entfernen.');
      must(m.id !== ws.pid, 'Du kannst dich nicht selbst entfernen.');
      const p = r.players.find(x => x.id === m.id) || (r.waiting || []).find(x => x.id === m.id); must(p, 'Diesen Spieler gibt es nicht.');
      const G = GAMES[r.game];
      if (r.status === 'playing' && r.players.some(x => x.id === p.id)) {
        must(G.removePlayer, 'In diesem Spiel geht das nur in der Lobby. Hol alle zurück in die Lobby.');
        must(r.players.length > G.meta.min, 'Dann wären es zu wenige Spieler. Hol alle zurück in die Lobby.');
        r.players = r.players.filter(x => x.id !== p.id);
        G.removePlayer(r, p.id, ctx);
        ctx.say(r, p.name + ' wurde vom Tisch genommen.');
      }
      removeFromRoom(r, p.id);
      if (!p.bot) { const set = sockets.get(p.id); if (set) for (const s of set) if (s.room === r.code) { s.room = null; send(s, { t: 'kicked' }); } }
      broadcast(r);
    },
    start(ws, m, r) {
      const G = GAMES[r.game];
      must(r.host === ws.pid, 'Nur der Gastgeber kann starten.');
      must(r.status !== 'playing', 'Das Spiel läuft schon.');
      if (r.status === 'over') toLobby(r);
      must(r.players.length >= G.meta.min, 'Es braucht mindestens ' + G.meta.min + ' Spieler.');
      if (G.canStart) { const e = G.canStart(r); must(!e, e); }
      clearTimers(r.code);
      r.status = 'playing'; r.notice = null; r.round = (r.round || 0) + 1;
      G.start(r, ctx); broadcast(r);
    },
    toLobby(ws, m, r) {
      must(r.host === ws.pid, 'Nur der Gastgeber kann alle in die Lobby holen.');
      must(r.status !== 'lobby', 'Ihr seid schon in der Lobby.');
      toLobby(r, r.status === 'playing' ? 'aborted' : null); broadcast(r);
    },
    endGame(ws, m, r) {
      must(r.host === ws.pid, 'Nur der Gastgeber kann den Tisch auflösen.');
      for (const set of sockets.values()) for (const s of set) if (s.room === r.code) { s.room = null; send(s, { t: 'ended' }); }
      dropRoom(r.code);
    },
    lobby(ws, m, r) {
      const G = GAMES[r.game];
      must(G.lobbyAct && r.status !== 'playing', 'Das geht nur zwischen den Runden.');
      must(r.players.some(p => p.id === ws.pid), 'Du sitzt nicht an diesem Tisch.');
      G.lobbyAct(r, ws.pid, m, ctx); broadcast(r);
    },
    chat(ws, m, r) {
      const text = String(m.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200); if (!text) return;
      const p = r.players.find(x => x.id === ws.pid) || (r.waiting || []).find(x => x.id === ws.pid); must(p, 'Nur Mitspieler können schreiben.');
      const G = GAMES[r.game];
      if (r.status === 'playing' && G.chatAllowed && !G.chatAllowed(r)) must(false, 'Psst! Während ihr Karten legt, wird nicht geschrieben.');
      addChat(r, p.id, p.name, text); broadcast(r);
    },
    act(ws, m, r) {
      must(r.status === 'playing', 'Die Runde läuft gerade nicht.');
      must(r.players.some(p => p.id === ws.pid), 'Du schaust nur zu.');
      GAMES[r.game].act(r, ws.pid, m, ctx); broadcast(r);
    }
  };

  wss.on('connection', ws => {
    ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', raw => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || typeof m.t !== 'string') return;
      try {
        if (m.t === 'hello') {
          let token = typeof m.token === 'string' && m.token.length >= 16 && m.token.length <= 64 ? m.token : null;
          if (!token) token = rid(18);
          ws.pid = crypto.createHash('sha256').update('zh:' + token).digest('base64url').slice(0, 16);
          if (!sockets.has(ws.pid)) sockets.set(ws.pid, new Set());
          sockets.get(ws.pid).add(ws);
          send(ws, { t: 'welcome', token, id: ws.pid });
          const r = roomOf(ws.pid, ws.game);
          if (r) { ws.room = r.code; broadcast(r); } else send(ws, { t: 'nogame' });
          return;
        }
        if (!ws.pid) return;
        if (m.t === 'ping') return send(ws, { t: 'pong' });
        const h = H[m.t]; if (!h) return;
        if (m.t === 'create' || m.t === 'join' || m.t === 'leave') return h(ws, m);
        const r = rooms.get(ws.room); must(r, 'Diesen Tisch gibt es nicht mehr.');
        h(ws, m, r);
      } catch (e) {
        if (e instanceof Err) send(ws, { t: 'error', msg: e.message });
        else { console.error(e); send(ws, { t: 'error', msg: 'Da ist etwas schiefgelaufen. Bitte nochmal versuchen.' }); }
      }
    });
    ws.on('close', () => {
      const set = sockets.get(ws.pid); if (set) set.delete(ws);
      const r = rooms.get(ws.room); if (r) { broadcast(r); const G = GAMES[r.game]; if (G.onPresence && r.status === 'playing') G.onPresence(r, ctx); }
    });
  });
  setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 25000);
  setInterval(() => {
    const now = Date.now();
    for (const r of rooms.values()) if (!r.players.some(p => isOnline(p.id)) && now - (r.updated || 0) > 6 * 3600 * 1000) dropRoom(r.code);
  }, 10 * 60 * 1000);

  function handleUpgrade(req, socket, head, game) {
    wss.handleUpgrade(req, socket, head, ws => {
      ws.game = game;
      wss.emit('connection', ws, req);
      // Bots/Timer wieder anstoßen, wenn jemand zurückkommt
      ws.once('message', () => setTimeout(() => { const r = rooms.get(ws.room); if (r && r.status === 'playing' && GAMES[r.game].onPresence) GAMES[r.game].onPresence(r, ctx); }, 50));
    });
  }
  return { handleUpgrade, load, flush, games: Object.keys(GAMES), _test: { rooms, H } };
};
