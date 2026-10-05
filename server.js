// Zwölf hoch – Spielserver
// Startet einen Webserver, liefert das Spiel aus (public/index.html)
// und hält alle laufenden Spiele im Speicher. Die Browser verbinden sich per WebSocket.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const MAXP = 8;
const STACK_SIZES = [5, 10, 15, 20, 25, 30];

/* ---------------- HTTP ---------------- */
// index.html darf direkt neben server.js oder im Ordner public liegen
const indexFile = [path.join(__dirname, 'index.html'), path.join(__dirname, 'public', 'index.html')].find(f => fs.existsSync(f));
const server = http.createServer((req, res) => {
  if (req.url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (req.url === '/' || req.url.startsWith('/?') || req.url.startsWith('/#')) {
    fs.readFile(indexFile, (err, buf) => {
      if (err) { res.writeHead(500); return res.end('Fehler'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
    return;
  }
  res.writeHead(404); res.end('Nicht gefunden');
});

/* ---------------- Spielzustand ---------------- */
const games = new Map();      // code -> game
const sockets = new Map();    // Spieler-ID -> Set<ws>

const rid = (n = 9) => crypto.randomBytes(n).toString('base64url');
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function randCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (;;) { let s = ''; for (let i = 0; i < 4; i++) s += A[crypto.randomInt(A.length)]; if (!games.has(s)) return s; }
}
const top = a => (a && a.length ? a[a.length - 1] : null);
const fits = (v, pile) => v === 0 || v === pile.length + 1;
const pname = (g, id) => (g.players.find(p => p.id === id) || {}).name || 'Jemand';
function addLog(g, text) { g.log.unshift(text); g.log = g.log.slice(0, 14); }
let moveSeq = 0;
function setMove(g, mv) { g.lastMove = { ...mv, seq: ++moveSeq }; }
function decksFor(n, stack) { return (n * stack + n * 5) > 110 ? 2 : 1; }

function drawOne(g) {
  if (!g.draw.length && g.done.length) { g.draw = shuffle(g.done); g.done = []; addLog(g, 'Der Nachziehstapel wird neu gemischt.'); }
  return g.draw.length ? g.draw.pop() : null;
}
function refill(g, id) {
  const h = g.hands[id];
  while (h.length < 5) { const c = drawOne(g); if (c == null) break; h.push(c); }
}
function advance(g) {
  g.turn = (g.turn + 1) % g.players.length; g.turnNo++;
  refill(g, g.players[g.turn].id);
}
function startRound(g) {
  const n = g.players.length, decks = decksFor(n, g.stackSize);
  const deck = [];
  for (let d = 0; d < decks; d++) {
    for (let v = 1; v <= 12; v++) for (let k = 0; k < 12; k++) deck.push(v);
    for (let k = 0; k < 18; k++) deck.push(0); // Joker
  }
  shuffle(deck);
  g.hands = {}; g.stocks = {}; g.discards = {};
  for (const p of g.players) { g.stocks[p.id] = deck.splice(0, g.stackSize); g.hands[p.id] = []; g.discards[p.id] = [[], [], [], []]; }
  g.draw = deck; g.build = [[], [], [], []]; g.done = []; g.decks = decks;
  g.status = 'playing'; g.winner = null; g.turn = crypto.randomInt(n); g.turnNo = 1; g.log = [];
  refill(g, g.players[g.turn].id);
  setMove(g, { kind: 'deal' });
  addLog(g, 'Neue Runde mit ' + g.stackSize + ' Karten pro Spielerstapel. ' + g.players[g.turn].name + ' beginnt.');
}

function cardAt(g, id, src, i) {
  if (src === 'hand') return g.hands[id][i];
  if (src === 'stock') return top(g.stocks[id]);
  if (src === 'disc') return top(g.discards[id][i]);
}
function removeAt(g, id, src, i) {
  if (src === 'hand') return g.hands[id].splice(i, 1)[0];
  if (src === 'stock') return g.stocks[id].pop();
  if (src === 'disc') return g.discards[id][i].pop();
}

/* Was ein bestimmter Spieler sehen darf: fremde Handkarten und verdeckte Stapel bleiben geheim. */
function viewFor(g, me) {
  const players = g.players.map(p => ({
    id: p.id, name: p.name, online: isOnline(p.id),
    stockCount: g.stocks[p.id] ? g.stocks[p.id].length : 0,
    stockTop: g.stocks[p.id] ? top(g.stocks[p.id]) : null,
    handCount: g.hands[p.id] ? g.hands[p.id].length : 0,
    discards: g.discards[p.id] || [[], [], [], []]
  }));
  return {
    code: g.code, status: g.status, host: g.host, stackSize: g.stackSize, decks: decksFor(g.players.length, g.stackSize),
    players, build: g.build, drawCount: g.draw.length, doneCount: g.done.length,
    turn: g.turn, turnNo: g.turnNo, winner: g.winner, log: g.log, lastMove: g.lastMove || null,
    me, hand: g.hands[me] || null
  };
}

/* ---------------- Verbindungen ---------------- */
const isOnline = id => !!(sockets.get(id) && sockets.get(id).size);
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(g) {
  g.updated = Date.now();
  const ids = new Set(g.players.map(p => p.id));
  for (const id of g.watchers) ids.add(id);
  for (const id of ids) {
    const set = sockets.get(id); if (!set) continue;
    const v = viewFor(g, id);
    for (const ws of set) if (ws.gameCode === g.code) send(ws, { t: 'state', game: v });
  }
}
function gameOf(id) { for (const g of games.values()) if (g.players.some(p => p.id === id)) return g; return null; }

class UserErr extends Error {}
const must = (cond, msg) => { if (!cond) throw new UserErr(msg); };
const cleanName = n => String(n || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 18);

const handlers = {
  create(ws, m) {
    const name = cleanName(m.name); must(name, 'Gib zuerst deinen Namen ein.');
    const old = gameOf(ws.pid); if (old && old.status === 'lobby') removePlayer(old, ws.pid);
    const g = {
      code: randCode(), status: 'lobby', host: ws.pid, stackSize: 20, created: Date.now(), updated: Date.now(),
      players: [{ id: ws.pid, name }], watchers: new Set(),
      draw: [], build: [[], [], [], []], done: [], hands: {}, stocks: {}, discards: {}, turn: 0, turnNo: 0, winner: null, log: []
    };
    games.set(g.code, g);
    ws.gameCode = g.code; broadcast(g);
  },
  join(ws, m) {
    const code = String(m.code || '').toUpperCase().trim();
    const g = games.get(code); must(g, 'Kein Spiel mit dem Code ' + code + ' gefunden.');
    const name = cleanName(m.name);
    if (!g.players.some(p => p.id === ws.pid)) {
      if (g.status !== 'lobby') { g.watchers.add(ws.pid); ws.gameCode = code; broadcast(g); throw new UserErr('Das Spiel läuft schon. Du schaust zu.'); }
      must(name, 'Gib zuerst deinen Namen ein.');
      must(g.players.length < MAXP, 'Das Spiel ist voll (' + MAXP + ' Spieler).');
      const old = gameOf(ws.pid); if (old && old !== g && old.status === 'lobby') removePlayer(old, ws.pid);
      g.players.push({ id: ws.pid, name });
    }
    ws.gameCode = code; broadcast(g);
  },
  leave(ws) {
    const g = games.get(ws.gameCode); ws.gameCode = null;
    send(ws, { t: 'left' });
    if (!g) return;
    g.watchers.delete(ws.pid);
    if (g.status === 'lobby') removePlayer(g, ws.pid);
  },
  setStack(ws, m, g) {
    must(g.host === ws.pid && g.status !== 'playing', 'Nur der Gastgeber kann das ändern.');
    must(STACK_SIZES.includes(m.n), 'Ungültige Stapelgröße.');
    g.stackSize = m.n; broadcast(g);
  },
  start(ws, m, g) {
    must(g.host === ws.pid, 'Nur der Gastgeber kann starten.');
    must(g.status !== 'playing', 'Das Spiel läuft schon.');
    must(g.players.length >= 2, 'Es braucht mindestens 2 Spieler.');
    startRound(g); broadcast(g);
  },
  play(ws, m, g) {
    const me = ws.pid; myTurn(g, me);
    const v = cardAt(g, me, m.src, m.i);
    must(v != null && v === m.v, 'Die Karte hat sich geändert. Wähle neu.');
    const pile = g.build[m.pile]; must(pile, 'Ungültiger Stapel.');
    must(fits(v, pile), 'Passt nicht: Hier wird eine ' + (pile.length + 1) + ' gebraucht.');
    removeAt(g, me, m.src, m.i); pile.push(v);
    const name = pname(g, me);
    const mv = { kind: 'play', pid: me, src: m.src, i: m.i, pile: m.pile, v };
    if (m.src === 'stock') { const left = g.stocks[me].length; addLog(g, name + ' spielt vom Spielerstapel' + (left ? ' (noch ' + left + ')' : '') + '.'); }
    if (pile.length === 12) { g.done.push(...pile); g.build[m.pile] = []; addLog(g, 'Stapel ' + (m.pile + 1) + ' ist bei 12 und wird abgeräumt.'); mv.cleared = true; }
    if (m.src === 'stock' && !g.stocks[me].length) {
      mv.win = true; g.status = 'finished'; g.winner = me; addLog(g, name + ' hat den Spielerstapel leer gespielt und gewinnt!');
    } else if (!g.hands[me].length) { refill(g, me); mv.refill = true; addLog(g, name + ' hat die Hand leer gespielt und zieht 5 neue Karten.'); }
    setMove(g, mv);
    broadcast(g);
  },
  discard(ws, m, g) {
    const me = ws.pid; myTurn(g, me);
    const v = g.hands[me][m.i];
    must(v != null && v === m.v, 'Die Karte hat sich geändert. Wähle neu.');
    must(g.discards[me][m.to], 'Ungültiger Ablagestapel.');
    g.hands[me].splice(m.i, 1); g.discards[me][m.to].push(v);
    setMove(g, { kind: 'discard', pid: me, src: 'hand', i: m.i, to: m.to, v });
    addLog(g, pname(g, me) + ' legt ab. ' + g.players[(g.turn + 1) % g.players.length].name + ' ist dran.');
    advance(g); broadcast(g);
  },
  endTurn(ws, m, g) {
    const me = ws.pid; myTurn(g, me);
    must(!g.hands[me].length, 'Lege zum Beenden eine Handkarte auf einen Ablagestapel.');
    addLog(g, pname(g, me) + ' beendet den Zug ohne Ablage.');
    setMove(g, { kind: 'pass', pid: me });
    advance(g); broadcast(g);
  },
  skip(ws, m, g) {
    must(g.host === ws.pid && g.status === 'playing', 'Nur der Gastgeber kann überspringen.');
    addLog(g, g.players[g.turn].name + ' wurde übersprungen.');
    setMove(g, { kind: 'pass', pid: g.players[g.turn].id });
    advance(g); broadcast(g);
  },
  endGame(ws, m, g) {
    must(g.host === ws.pid, 'Nur der Gastgeber kann das Spiel beenden.');
    games.delete(g.code);
    for (const set of sockets.values()) for (const s of set) if (s.gameCode === g.code) { s.gameCode = null; send(s, { t: 'ended' }); }
  }
};
function myTurn(g, me) {
  must(g.status === 'playing', 'Das Spiel läuft gerade nicht.');
  must(g.players[g.turn].id === me, 'Du bist gerade nicht dran.');
}
function removePlayer(g, id) {
  g.players = g.players.filter(p => p.id !== id);
  if (!g.players.length) { games.delete(g.code); return; }
  if (g.host === id) g.host = g.players[0].id;
  broadcast(g);
}

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    try {
      if (m.t === 'hello') {
        let token = typeof m.token === 'string' && m.token.length >= 16 && m.token.length <= 64 ? m.token : null;
        if (!token) token = rid(18);
        // Spieler-ID wird aus dem Token berechnet: bleibt auch nach einem Server-Neustart gleich
        ws.pid = crypto.createHash('sha256').update('zh:' + token).digest('base64url').slice(0, 16);
        if (!sockets.has(ws.pid)) sockets.set(ws.pid, new Set());
        sockets.get(ws.pid).add(ws);
        send(ws, { t: 'welcome', token, id: ws.pid });
        const g = gameOf(ws.pid);
        if (g) { ws.gameCode = g.code; broadcast(g); }
        else send(ws, { t: 'nogame' });
        return;
      }
      if (!ws.pid) return;
      if (m.t === 'ping') return send(ws, { t: 'pong' });
      const h = handlers[m.t]; if (!h) return;
      if (['create', 'join', 'leave'].includes(m.t)) return h(ws, m);
      const g = games.get(ws.gameCode); must(g, 'Dieses Spiel gibt es nicht mehr.');
      h(ws, m, g);
    } catch (e) {
      if (e instanceof UserErr) send(ws, { t: 'error', msg: e.message });
      else { console.error(e); send(ws, { t: 'error', msg: 'Da ist etwas schiefgelaufen. Bitte nochmal versuchen.' }); }
    }
  });
  ws.on('close', () => {
    const set = sockets.get(ws.pid); if (set) set.delete(ws);
    const g = games.get(ws.gameCode); if (g) broadcast(g);
  });
});

// Verbindungen lebendig halten und verwaiste Spiele aufräumen
setInterval(() => {
  for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
}, 25000);
setInterval(() => {
  const now = Date.now();
  for (const g of games.values()) {
    const anyone = g.players.some(p => isOnline(p.id));
    if (!anyone && now - g.updated > 6 * 3600 * 1000) games.delete(g.code);
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log('Zwölf hoch läuft auf http://localhost:' + PORT));
