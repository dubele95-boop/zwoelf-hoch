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
const MAXBOTS = 4;
const BOT_NAMES = ['Bot Bruno', 'Bot Clara', 'Bot Emil', 'Bot Frieda'];
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
// Kartenwerte: 1-12 Zahlen, 0 Joker, 1017-1204 Entweder-oder-Karte (1000 + a*16 + b, a < b), 200-212 Aussetzen-Karte (200 + Zahl), 300 Geschenk, 400 Rückwärts, 500 Diebstahl
const isSplit = v => v >= 1000 && v < 1300;
const isSkip = v => v >= 200 && v < 300;
const GIFT = 300; // Geschenk-Karte
const REV = 400;  // Rückwärts-Karte
const STEAL = 500; // Diebstahl-Karte
const SPY = 600;   // Spion-Karte
const splitOf = v => [(v - 1000) >> 4, (v - 1000) & 15];
const makeSplit = () => { const a = 1 + crypto.randomInt(12); let b; do { b = 1 + crypto.randomInt(12); } while (b === a); return 1000 + Math.min(a, b) * 16 + Math.max(a, b); };
const SPECIALS = { split: { perDeck: 4 }, skip: { perDeck: 4 }, gift: { perDeck: 4 }, rev: { perDeck: 2 }, steal: { perDeck: 4 }, spy: { perDeck: 2 } };
// Jeder Aufbaustapel hat einen aktuellen Wert (bval) und eine Richtung (bdir: 1 aufwärts, -1 abwärts)
const needOf = (g, i) => g.bdir[i] === 1 ? g.bval[i] + 1 : g.bval[i] - 1;
// aufwärts: erst ab einer 2 umdrehbar; abwärts: nur wenn danach noch eine Zahl bis 12 folgen kann
const canReverse = (g, i) => g.bdir[i] === 1 ? g.bval[i] >= 2 : g.bval[i] <= 11;
// Aufbaustapel einrichten: Anzahl und wie viele davon von 12 nach 1 laufen
function pileCount(g) { return Math.min(6, Math.max(1, g.piles || 4)); }
function downCount(g) { return Math.min(pileCount(g), Math.max(0, g.downPiles || 0)); }
function resetPile(g, i) { const down = i >= pileCount(g) - downCount(g); g.build[i] = []; g.bval[i] = down ? 13 : 0; g.bdir[i] = down ? -1 : 1; }
function setupPiles(g) { const n = pileCount(g); g.build = []; g.bval = []; g.bdir = []; for (let i = 0; i < n; i++) resetPile(g, i); }
function fits(v, need) {
  if (v === GIFT || v === REV || v === STEAL || v === SPY) return false;
  if (v === 0) return true;
  if (isSplit(v)) return splitOf(v).includes(need);
  if (isSkip(v)) return v - 200 === need;
  return v === need;
}
const pname = (g, id) => (g.players.find(p => p.id === id) || {}).name || 'Jemand';
// Verlauf nur für Sonderkarten (wird im Spiel angezeigt)
// priv: optionale Texte nur für bestimmte Spieler, z. B. { spielerId: 'Text nur für diesen Spieler' }
function addSLog(g, kind, text, priv) { g.slog = g.slog || []; g.slog.unshift({ k: kind, t: text, n: g.turnNo, priv }); g.slog = g.slog.slice(0, 40); }
function cardLabel(v) {
  if (v === 0) return 'einen Joker';
  if (isSplit(v)) return 'eine ' + splitOf(v).join('/');
  if (isSkip(v)) return 'eine ' + (v - 200);
  if (v === GIFT) return 'eine Geschenk-Karte';
  if (v === REV) return 'eine Rückwärts-Karte';
  if (v === STEAL) return 'eine Diebstahl-Karte';
  if (v === SPY) return 'eine Spion-Karte';
  return 'eine ' + v;
}
function addLog(g, text) { g.log.unshift(text); g.log = g.log.slice(0, 14); }
let moveSeq = 0;
function setMove(g, mv) { g.lastMove = { ...mv, seq: ++moveSeq }; }
function decksFor(n, stack) { return (n * stack + n * 5) > 110 ? 2 : 1; }

function drawOne(g) {
  if (!g.draw.length && g.done.length) { g.draw = shuffle(g.done); g.done = []; addLog(g, 'Der Nachziehstapel wird neu gemischt.'); }
  if (!g.draw.length) {
    // Notfall gegen ein festgefahrenes Spiel: Karten unter der obersten Karte der Aufbaustapel neu mischen (Stapelwert bleibt)
    let pool = [];
    for (const pile of g.build) if (pile.length > 1) pool.push(...pile.splice(0, pile.length - 1));
    // reicht das nicht: auch die unteren Karten der Ablagestapel (oberste bleibt liegen)
    if (!pool.length) for (const id in g.discards) for (const d of g.discards[id]) if (d.length > 1) pool.push(...d.splice(0, d.length - 1));
    if (pool.length) { g.draw = shuffle(pool); addLog(g, 'Der Nachziehstapel war leer und wurde aus alten Karten neu gemischt.'); }
  }
  return g.draw.length ? g.draw.pop() : null;
}
function refill(g, id) {
  const h = g.hands[id];
  while (h.length < 5) { const c = drawOne(g); if (c == null) break; h.push(c); }
}
function advance(g) {
  g.choose = null; g.spy = null;
  g.skips = g.skips || {};
  for (let k = 0; k <= g.players.length; k++) {
    g.turn = (g.turn + 1) % g.players.length; g.turnNo++;
    const p = g.players[g.turn];
    if (g.skips[p.id] > 0) { g.skips[p.id]--; addLog(g, p.name + ' setzt aus.'); addSLog(g, 'skipped', p.name + ' setzt aus'); continue; }
    break;
  }
  refill(g, g.players[g.turn].id);
}
function startRound(g) {
  const n = g.players.length, decks = decksFor(n, g.stackSize);
  const deck = [];
  for (let d = 0; d < decks; d++) {
    for (let v = 1; v <= 12; v++) for (let k = 0; k < 12; k++) deck.push(v);
    for (let k = 0; k < 18; k++) deck.push(0); // Joker
    if (g.specials && g.specials.split) for (let k = 0; k < SPECIALS.split.perDeck; k++) deck.push(makeSplit());
    if (g.specials && g.specials.skip) {
      // 4 zufällige Zahlenkarten dieses Kartensatzes bekommen das Aussetzen-Symbol
      const start = d === 0 ? 0 : deck.length - (144 + 18 + (g.specials.split ? SPECIALS.split.perDeck : 0));
      const idx = []; for (let i = start; i < deck.length; i++) if (deck[i] >= 1 && deck[i] <= 12) idx.push(i);
      shuffle(idx).slice(0, SPECIALS.skip.perDeck).forEach(i => { deck[i] = 200 + deck[i]; });
    }
    if (g.specials && g.specials.spy) for (let k = 0; k < SPECIALS.spy.perDeck; k++) deck.push(SPY);
    if (g.specials && g.specials.steal) for (let k = 0; k < SPECIALS.steal.perDeck; k++) deck.push(STEAL);
    if (g.specials && g.specials.rev) for (let k = 0; k < SPECIALS.rev.perDeck; k++) deck.push(REV);
    if (g.specials && g.specials.gift) for (let k = 0; k < SPECIALS.gift.perDeck; k++) deck.push(GIFT);
  }
  shuffle(deck);
  g.hands = {}; g.stocks = {}; g.discards = {};
  for (const p of g.players) { g.stocks[p.id] = deck.splice(0, g.stackSize); g.hands[p.id] = []; g.discards[p.id] = [[], [], [], []]; }
  g.draw = deck; setupPiles(g); g.done = []; g.decks = decks;
  g.status = 'playing'; g.winner = null; g.skips = {}; g.choose = null; g.spy = null; g.turn = crypto.randomInt(n); g.turnNo = 1; g.log = []; g.slog = [];
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
    id: p.id, name: p.name, bot: !!p.bot, online: p.bot ? true : isOnline(p.id),
    stockCount: g.stocks[p.id] ? g.stocks[p.id].length : 0,
    stockTop: g.stocks[p.id] ? top(g.stocks[p.id]) : null,
    handCount: g.hands[p.id] ? g.hands[p.id].length : 0,
    discards: g.discards[p.id] || [[], [], [], []]
  }));
  return {
    code: g.code, status: g.status, host: g.host, round: g.round || 1, rematchBy: g.rematchBy || null, stackSize: g.stackSize, specials: g.specials || {}, decks: decksFor(g.players.length, g.stackSize),
    players, build: g.build, bval: g.bval || [0, 0, 0, 0], bdir: g.bdir || [1, 1, 1, 1], piles: pileCount(g), downPiles: downCount(g), drawCount: g.draw.length, doneCount: g.done.length,
    spy: g.spy ? (g.spy.pid === me ? { pid: g.spy.pid, target: g.spy.target, hand: g.hands[g.spy.target] } : { pid: g.spy.pid, target: g.spy.target }) : null,
    choose: g.choose || null, skips: g.skips || {}, slog: (g.slog || []).map(e => ({ k: e.k, t: e.priv && e.priv[me] ? e.priv[me] : e.t, n: e.n })),
    turn: g.turn, turnNo: g.turnNo, winner: g.winner, log: g.log, lastMove: g.lastMove && g.lastMove.kind === 'spy' && me !== g.lastMove.pid && me !== g.lastMove.target ? { ...g.lastMove, sv: undefined } : (g.lastMove || null),
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
  scheduleBot(g);
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
      code: randCode(), status: 'lobby', host: ws.pid, stackSize: 20, piles: 4, downPiles: 0, specials: { split: false }, created: Date.now(), updated: Date.now(),
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
  setSpecial(ws, m, g) {
    must(g.host === ws.pid && g.status !== 'playing', 'Nur der Gastgeber kann das ändern.');
    must(Object.prototype.hasOwnProperty.call(SPECIALS, m.key), 'Unbekannte Sonderkarte.');
    g.specials = { ...(g.specials || {}), [m.key]: !!m.on }; broadcast(g);
  },
  addBot(ws, m, g) {
    must(g.host === ws.pid && g.status !== 'playing', 'Nur der Gastgeber kann Bots hinzufügen.');
    must(g.players.length < MAXP, 'Der Tisch ist voll (' + MAXP + ' Spieler).');
    must(g.players.filter(p => p.bot).length < MAXBOTS, 'Mehr als ' + MAXBOTS + ' Bots gehen nicht.');
    const used = new Set(g.players.map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || ('Bot ' + (g.players.length + 1));
    g.players.push({ id: 'bot-' + rid(6), name, bot: true });
    broadcast(g);
  },
  removeBot(ws, m, g) {
    must(g.host === ws.pid && g.status !== 'playing', 'Nur der Gastgeber kann Bots entfernen.');
    must(g.players.some(p => p.id === m.id && p.bot), 'Diesen Bot gibt es nicht.');
    g.players = g.players.filter(p => p.id !== m.id); broadcast(g);
  },
  setPiles(ws, m, g) {
    must(g.host === ws.pid && g.status !== 'playing', 'Nur der Gastgeber kann das ändern.');
    const n = Number(m.piles), d = Number(m.down);
    must(Number.isInteger(n) && n >= 1 && n <= 6, 'Es sind 1 bis 6 Aufbaustapel möglich.');
    must(Number.isInteger(d) && d >= 0 && d <= n, 'So viele Stapel gibt es nicht.');
    g.piles = n; g.downPiles = d; broadcast(g);
  },
  setStack(ws, m, g) {
    must(g.host === ws.pid && g.status !== 'playing', 'Nur der Gastgeber kann das ändern.');
    must(STACK_SIZES.includes(m.n), 'Ungültige Stapelgröße.');
    g.stackSize = m.n; broadcast(g);
  },
  // nach Spielende: jeder Mitspieler darf eine neue Runde anstoßen -> alle zurück in die Lobby
  newRound(ws, m, g) {
    must(g.status === 'finished', 'Die Runde läuft noch.');
    must(g.players.some(p => p.id === ws.pid), 'Nur Mitspieler können eine neue Runde starten.');
    g.status = 'lobby'; g.round = (g.round || 1) + 1; g.rematchBy = ws.pid;
    g.hands = {}; g.stocks = {}; g.discards = {}; g.draw = []; g.done = [];
    setupPiles(g);
    g.skips = {}; g.choose = null; g.spy = null; g.slog = []; g.winner = null; g.turnNo = 0; g.lastMove = null;
    broadcast(g);
  },
  start(ws, m, g) {
    must(g.host === ws.pid, 'Nur der Gastgeber kann starten.');
    must(g.status !== 'playing', 'Das Spiel läuft schon.');
    must(g.players.length >= 2, 'Es braucht mindestens 2 Spieler.');
    g.rematchBy = null;
    startRound(g); broadcast(g);
  },
  play(ws, m, g) {
    const me = ws.pid; myTurn(g, me);
    const v = cardAt(g, me, m.src, m.i);
    must(v != null && v === m.v, 'Die Karte hat sich geändert. Wähle neu.');
    const pi = m.pile, pile = g.build[pi]; must(pile, 'Ungültiger Stapel.');
    const name = pname(g, me);
    const mv = { kind: 'play', pid: me, src: m.src, i: m.i, pile: pi, v };
    if (v === REV) {
      must(canReverse(g, pi), g.bdir[pi] === 1 ? 'Rückwärts geht erst, wenn auf dem Stapel mindestens eine 2 liegt.' : 'Hier geht Rückwärts nicht: Der Stapel muss mindestens bei 11 sein.');
      removeAt(g, me, m.src, m.i); pile.push(v);
      g.bdir[pi] = -g.bdir[pi]; mv.reversed = true;
      addSLog(g, 'rev', name + ' dreht Stapel ' + (pi + 1) + (g.bdir[pi] === 1 ? ' wieder aufwärts' : ' um: jetzt abwärts'));
      addLog(g, name + ' dreht Stapel ' + (pi + 1) + ' um: jetzt ' + (g.bdir[pi] === 1 ? 'aufwärts' : 'abwärts') + '.');
    } else {
      const need = needOf(g, pi);
      must(fits(v, need), 'Passt nicht: Hier wird eine ' + need + ' gebraucht.');
      removeAt(g, me, m.src, m.i); pile.push(v); g.bval[pi] = need;
      if (isSplit(v)) addSLog(g, 'split', name + ' spielt Entweder-oder ' + splitOf(v).join('/') + ' als ' + need);
      const end = g.bdir[pi] === 1 ? 12 : 1;
      if (need === end) {
        if (g.bdir[pi] === -1 && pi < pileCount(g) - downCount(g)) addSLog(g, 'rev', 'Stapel ' + (pi + 1) + ' ist rückwärts bei 1 angekommen und wird abgeräumt');
        g.done.push(...pile); resetPile(g, pi); mv.cleared = true;
        addLog(g, 'Stapel ' + (pi + 1) + ' ist bei ' + end + ' und wird abgeräumt.');
      }
    }
    if (m.src === 'stock') { const left = g.stocks[me].length; addLog(g, name + ' spielt vom Spielerstapel' + (left ? ' (noch ' + left + ')' : '') + '.'); }
    if (m.src === 'stock' && !g.stocks[me].length) {
      mv.win = true; g.status = 'finished'; g.winner = me; addLog(g, name + ' hat den Spielerstapel leer gespielt und gewinnt!');
    } else {
      if (!g.hands[me].length) { refill(g, me); mv.refill = true; addLog(g, name + ' hat die Hand leer gespielt und zieht 5 neue Karten.'); }
      if (isSkip(v) && g.players.length > 1) {
        // nur wer noch kein Aussetzen offen hat, kann eines bekommen
        const open = skippable(g, me);
        if (!open.length) { mv.skipNone = true; addSLog(g, 'skip', name + ' spielt Aussetzen, aber alle setzen schon aus'); }
        else if (open.length === 1) { applySkip(g, me, open[0].id); mv.skipTarget = open[0].id; }
        else g.choose = { pid: me, kind: 'skip' };
      }
    }
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
  gift(ws, m, g) {
    const me = ws.pid; myTurn(g, me);
    const v = cardAt(g, me, m.src, m.i);
    must(v === GIFT && m.v === GIFT, 'Die Karte hat sich geändert. Wähle neu.');
    must(m.target !== me && g.players.some(p => p.id === m.target), 'Diesen Spieler gibt es nicht.');
    const hand = g.hands[me];
    must(Number.isInteger(m.give) && hand[m.give] != null && !(m.src === 'hand' && m.give === m.i), 'Wähle eine Handkarte zum Verschenken.');
    must(hand[m.give] === m.gv, 'Die Karte hat sich geändert. Wähle neu.');
    const gv = hand[m.give];
    if (m.src === 'hand') { [m.i, m.give].sort((a, b) => b - a).forEach(i => hand.splice(i, 1)); }
    else { removeAt(g, me, m.src, m.i); hand.splice(m.give, 1); }
    g.done.push(GIFT);
    g.hands[m.target].push(gv);
    const name = pname(g, me);
    addLog(g, name + ' schenkt ' + pname(g, m.target) + ' eine Karte.');
    addSLog(g, 'gift', name + ' schenkt ' + pname(g, m.target) + ' eine Karte');
    const mv = { kind: 'gift', pid: me, target: m.target, src: m.src, i: m.i, give: m.give };
    if (m.src === 'stock' && !g.stocks[me].length) {
      mv.win = true; g.status = 'finished'; g.winner = me; addLog(g, name + ' hat den Spielerstapel leer gespielt und gewinnt!');
    } else if (!hand.length) { refill(g, me); mv.refill = true; }
    setMove(g, mv);
    broadcast(g);
  },
  steal(ws, m, g) {
    const me = ws.pid; myTurn(g, me);
    const v = cardAt(g, me, m.src, m.i);
    must(v === STEAL && m.v === STEAL, 'Die Karte hat sich geändert. Wähle neu.');
    must(m.target !== me && g.players.some(p => p.id === m.target), 'Diesen Spieler gibt es nicht.');
    const pile = g.discards[m.target] && g.discards[m.target][m.pile];
    must(pile && pile.length, 'Auf diesem Ablagestapel liegt nichts.');
    removeAt(g, me, m.src, m.i); g.done.push(STEAL);
    const sv = pile.pop(); g.hands[me].push(sv);
    const name = pname(g, me);
    addLog(g, name + ' klaut ' + pname(g, m.target) + ' eine Karte.');
    addSLog(g, 'steal', name + ' klaut ' + pname(g, m.target) + ' ' + cardLabel(sv));
    const mv = { kind: 'steal', pid: me, target: m.target, pile: m.pile, src: m.src, i: m.i, sv };
    if (m.src === 'stock' && !g.stocks[me].length) {
      mv.win = true; g.status = 'finished'; g.winner = me; addLog(g, name + ' hat den Spielerstapel leer gespielt und gewinnt!');
    }
    setMove(g, mv);
    broadcast(g);
  },
  // Spion, Schritt 1: Karte spielen und Mitspieler wählen -> nur du siehst seine Hand
  spyLook(ws, m, g) {
    const me = ws.pid; myTurn(g, me);
    const v = cardAt(g, me, m.src, m.i);
    must(v === SPY && m.v === SPY, 'Die Karte hat sich geändert. Wähle neu.');
    must(m.target !== me && g.players.some(p => p.id === m.target), 'Diesen Spieler gibt es nicht.');
    must(g.hands[m.target] && g.hands[m.target].length, pname(g, m.target) + ' hat gerade keine Handkarten.');
    removeAt(g, me, m.src, m.i); g.done.push(SPY);
    const name = pname(g, me);
    const mv = { kind: 'spyLook', pid: me, target: m.target, src: m.src, i: m.i };
    if (m.src === 'stock' && !g.stocks[me].length) {
      mv.win = true; g.status = 'finished'; g.winner = me; addLog(g, name + ' hat den Spielerstapel leer gespielt und gewinnt!');
    } else {
      g.spy = { pid: me, target: m.target };
      addLog(g, name + ' spioniert bei ' + pname(g, m.target) + '.');
    }
    setMove(g, mv); broadcast(g);
  },
  // Spion, Schritt 2: eine der gesehenen Karten nehmen (Pflicht)
  spyTake(ws, m, g) {
    const me = ws.pid; myTurn(g, me, true);
    must(g.spy && g.spy.pid === me, 'Gerade spionierst du nicht.');
    const th = g.hands[g.spy.target];
    must(Number.isInteger(m.k) && th[m.k] != null && th[m.k] === m.v, 'Die Karte hat sich geändert. Wähle neu.');
    const target = g.spy.target, sv = th.splice(m.k, 1)[0];
    g.hands[me].push(sv); g.spy = null;
    addLog(g, pname(g, me) + ' nimmt ' + pname(g, target) + ' eine Karte weg.');
    addSLog(g, 'spy', pname(g, me) + ' spioniert bei ' + pname(g, target) + ' und nimmt eine Karte', {
      [target]: pname(g, me) + ' spioniert bei dir und nimmt dir ' + cardLabel(sv),
      [me]: 'Du spionierst bei ' + pname(g, target) + ' und nimmst ' + cardLabel(sv)
    });
    setMove(g, { kind: 'spy', pid: me, target, k: m.k, sv });
    broadcast(g);
  },
  chooseSkip(ws, m, g) {
    const me = ws.pid; myTurn(g, me, true);
    must(g.choose && g.choose.pid === me, 'Gerade gibt es nichts auszuwählen.');
    must(m.target !== me && g.players.some(p => p.id === m.target), 'Diesen Spieler gibt es nicht.');
    must(!(g.skips && g.skips[m.target]), pname(g, m.target) + ' setzt schon aus. Wähle jemand anderen.');
    g.choose = null; applySkip(g, me, m.target);
    setMove(g, { kind: 'skipped', pid: me, target: m.target });
    broadcast(g);
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

/* ---------------- Bots ----------------
   Bots sind Mitspieler ohne Verbindung. Der Server spielt für sie – mit kleinen Pausen,
   damit man jeden Zug verfolgen kann. Ist kein Mensch online, pausieren sie. */
const BOT_DELAY = Number(process.env.BOT_DELAY) || 1500;  // Pause zwischen Bot-Aktionen (ms)
const botTimers = new Map();   // Spielcode -> Timer
function botToMove(g) {
  if (g.status !== 'playing') return null;
  const id = g.choose ? g.choose.pid : g.spy ? g.spy.pid : g.players[g.turn].id;
  const p = g.players.find(x => x.id === id);
  return p && p.bot ? p : null;
}
function scheduleBot(g) {
  if (botTimers.has(g.code) || !botToMove(g)) return;
  if (!g.players.some(p => !p.bot && isOnline(p.id)) && ![...g.watchers].some(isOnline)) return;  // niemand schaut zu
  botTimers.set(g.code, setTimeout(() => {
    botTimers.delete(g.code);
    if (games.get(g.code) !== g) return;
    const bot = botToMove(g); if (!bot) return;
    g.botMoves = (g.botTurnNo === g.turnNo ? g.botMoves || 0 : 0) + 1; g.botTurnNo = g.turnNo;
    try { botAct(g, bot.id, g.botMoves > 40); }
    catch (e) {
      if (process.env.BOT_DEBUG) console.log('BOTERR', e.message);
      // Notbremse: falls ein Zug abgelehnt wird, Zug sauber beenden statt hängenzubleiben
      try { botFinish(g, bot.id); } catch (e2) { g.choose = null; advance(g); broadcast(g); }
    }
  }, BOT_DELAY));
}
const botWs = (g, id) => ({ pid: id, gameCode: g.code, readyState: 0 });
// Wie weit ist ein Kartenwert von dem entfernt, was ein Stapel gerade braucht? (0 = passt sofort)
function gapTo(g, i, n) { const need = needOf(g, i); return g.bdir[i] === 1 ? n - need : need - n; }
function cardScore(g, v) {            // je kleiner, desto nützlicher ist die Karte gerade
  if (v === 0 || v === GIFT || v === STEAL || v === REV || v === SPY) return 0;
  const nums = isSplit(v) ? splitOf(v) : [isSkip(v) ? v - 200 : v];
  let best = 99;
  for (let i = 0; i < g.build.length; i++) for (const n of nums) { const d = gapTo(g, i, n); if (d >= 0 && d < best) best = d; }
  return best;
}
function botAct(g, id, hurry) {
  const ws = botWs(g, id), h = handlers;
  const others = g.players.filter(p => p.id !== id);
  const leader = others.slice().sort((a, b) => g.stocks[a.id].length - g.stocks[b.id].length)[0];
  if (g.spy && g.spy.pid === id) return h.spyTake(ws, botSpyPick(g), g);
  if (g.choose && g.choose.pid === id) { const open = skippable(g, id).sort((a, b) => g.stocks[a.id].length - g.stocks[b.id].length); return h.chooseSkip(ws, { target: open[0].id }, g); }
  if (hurry) return botFinish(g, id);
  const hand = g.hands[id], stock = g.stocks[id], discs = g.discards[id];
  const st = top(stock), P = g.build.length;
  const tryPlay = (src, i, v) => {
    if (v === REV || v === GIFT || v === STEAL || v === SPY) return false;
    for (let pi = 0; pi < P; pi++) if (fits(v, needOf(g, pi))) { h.play(ws, { src, i, v, pile: pi }, g); return true; }
    return false;
  };
  // 1) Spielerstapel hat Vorrang
  if (st != null) {
    if (st === GIFT && hand.length) return h.gift(ws, { src: 'stock', v: GIFT, target: leader.id, give: worstCard(g, hand), gv: hand[worstCard(g, hand)] }, g);
    if (st === STEAL) { const vt = stealTarget(g, id); if (vt) return h.steal(ws, { src: 'stock', v: STEAL, target: vt.id, pile: vt.pile }, g); }
    if (st === REV) { for (let pi = 0; pi < P; pi++) if (canReverse(g, pi)) return h.play(ws, { src: 'stock', v: REV, pile: pi }, g); }
    if (tryPlay('stock', undefined, st)) return;
  }
  // 2) Karten, die den Weg zur Stapelkarte frei machen (Joker nur, wenn die Stapelkarte danach passt)
  const stockNums = st == null ? [] : st === 0 ? [] : isSplit(st) ? splitOf(st) : (st >= 1 && st <= 12) || isSkip(st) ? [isSkip(st) ? st - 200 : st] : [];
  for (let pi = 0; pi < P && stockNums.length; pi++) {
    const after = g.bdir[pi] === 1 ? needOf(g, pi) + 1 : needOf(g, pi) - 1;
    if (!stockNums.includes(after)) continue;
    for (let d = 0; d < 4; d++) { const v = top(discs[d]); if (v != null && v !== REV && v !== GIFT && v !== STEAL && fits(v, needOf(g, pi))) return h.play(ws, { src: 'disc', i: d, v, pile: pi }, g); }
    for (let k = 0; k < hand.length; k++) if (fits(hand[k], needOf(g, pi)) && ![REV, GIFT, STEAL].includes(hand[k])) return h.play(ws, { src: 'hand', i: k, v: hand[k], pile: pi }, g);
  }
  // 3) Rückwärts-Karte, wenn danach die Stapelkarte passt
  const ri = hand.indexOf(REV);
  if (ri >= 0 && stockNums.length) for (let pi = 0; pi < P; pi++) {
    if (!canReverse(g, pi)) continue;
    const need = g.bdir[pi] === 1 ? g.bval[pi] - 1 : g.bval[pi] + 1;
    if (stockNums.includes(need)) return h.play(ws, { src: 'hand', i: ri, v: REV, pile: pi }, g);
  }
  // 3b) Spion: bei dem mit den meisten Handkarten nachschauen
  const spyTarget = () => others.filter(p => g.hands[p.id].length).sort((a, b) => g.hands[b.id].length - g.hands[a.id].length)[0];
  if (st === SPY && spyTarget()) return h.spyLook(ws, { src: 'stock', v: SPY, target: spyTarget().id }, g);
  const yi = hand.indexOf(SPY);
  if (yi >= 0 && spyTarget() && g.hands[spyTarget().id].length >= 3) return h.spyLook(ws, { src: 'hand', i: yi, v: SPY, target: spyTarget().id }, g);
  // 4) Diebstahl, wenn es etwas Brauchbares gibt
  const si = hand.indexOf(STEAL);
  if (si >= 0) { const vt = stealTarget(g, id); if (vt) return h.steal(ws, { src: 'hand', i: si, v: STEAL, target: vt.id, pile: vt.pile }, g); }
  // 5) normale Karten von Ablage und Hand (keine Joker, die hebt sich der Bot auf)
  for (let d = 0; d < 4; d++) { const v = top(discs[d]); if (v != null && v !== 0 && tryPlay('disc', d, v)) return; }
  for (let k = 0; k < hand.length; k++) if (hand[k] !== 0 && tryPlay('hand', k, hand[k])) return;
  // 6) Geschenk: die unnützeste Karte an den Führenden loswerden
  const gi = hand.indexOf(GIFT);
  if (gi >= 0 && hand.length >= 2) { const give = worstCard(g, hand, gi); return h.gift(ws, { src: 'hand', i: gi, v: GIFT, target: leader.id, give, gv: hand[give] }, g); }
  botFinish(g, id);
}
function worstCard(g, hand, skip) {
  let w = -1, ws = -1;
  hand.forEach((v, k) => { if (k === skip) return; const sc = cardScore(g, v) + (v === 0 ? -100 : 0); if (sc > ws) { ws = sc; w = k; } });
  return w < 0 ? (skip === 0 ? 1 : 0) : w;
}
function stealTarget(g, id) {
  let best = null;
  for (const p of g.players) {
    if (p.id === id) continue;
    g.discards[p.id].forEach((d, i) => {
      if (!d.length) return;
      const sc = cardScore(g, top(d));
      if (!best || sc < best.sc) best = { id: p.id, pile: i, sc };
    });
  }
  return best && best.sc <= 2 ? best : null;
}
function botSpyPick(g) {            // beste Karte aus der fremden Hand: Joker zuerst, sonst die nützlichste
  const th = g.hands[g.spy.target];
  let k = th.indexOf(0);
  if (k < 0) { let best = 99; th.forEach((v, i) => { const sc = cardScore(g, v); if (sc < best) { best = sc; k = i; } }); }
  if (k < 0) k = 0;
  return { k, v: th[k] };
}
function botFinish(g, id) {          // Zug beenden: eine Karte ablegen
  const ws = botWs(g, id), hand = g.hands[id], discs = g.discards[id];
  if (g.spy && g.spy.pid === id) return handlers.spyTake(ws, botSpyPick(g), g);
  if (g.choose && g.choose.pid === id) return handlers.chooseSkip(ws, { target: skippable(g, id)[0].id }, g);
  if (!hand.length) return handlers.endTurn(ws, {}, g);
  const k = worstCard(g, hand), v = hand[k];
  let to = discs.findIndex(d => d.length && top(d) === v + 1);           // absteigend stapeln
  if (to < 0) to = discs.findIndex(d => !d.length);
  if (to < 0) to = discs.reduce((b, d, i) => d.length < discs[b].length ? i : b, 0);
  handlers.discard(ws, { i: k, v, to }, g);
}

function myTurn(g, me, allowChoose) {
  must(g.status === 'playing', 'Das Spiel läuft gerade nicht.');
  must(g.players[g.turn].id === me, 'Du bist gerade nicht dran.');
  if (!allowChoose) must(!g.choose, 'Wähle zuerst, wer aussetzen muss.');
  if (!allowChoose) must(!g.spy, 'Nimm dir zuerst eine Karte beim Spionieren.');
}
const skippable = (g, me) => g.players.filter(p => p.id !== me && !(g.skips && g.skips[p.id]));
function applySkip(g, by, target) {
  g.skips = g.skips || {};
  g.skips[target] = 1;   // höchstens ein offenes Aussetzen pro Spieler
  addLog(g, pname(g, by) + ' lässt ' + pname(g, target) + ' aussetzen.');
  addSLog(g, 'skip', pname(g, by) + ' lässt ' + pname(g, target) + ' aussetzen');
}
function removePlayer(g, id) {
  g.players = g.players.filter(p => p.id !== id);
  const humans = g.players.filter(p => !p.bot);
  if (!humans.length) { games.delete(g.code); return; }
  if (g.host === id) g.host = humans[0].id;
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
