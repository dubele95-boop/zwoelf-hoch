// Reihe voll! – alle legen gleichzeitig verdeckt eine Karte, die Karten wandern aufsteigend in vier Reihen.
// Wer die 6. Karte in eine Reihe legt (oder eine zu kleine Karte hat), muss eine Reihe mit allen Strafpunkten nehmen.
const meta = { id: 'reihe', name: 'Reihe voll!', min: 2, max: 10, bots: true, maxBots: 9 };
const HAND = 10, ROWS = 4, ROW_MAX = 5;
const STEP_MS = 1100, NEXT_MS = 900, ROUND_AUTO_MS = 12000;
const TARGETS = [33, 66, 99], TIMERS = [0, 15, 30, 45, 60];
const SPECIALS = ['schild', 'halb', 'besen', 'tausch'];
const MAX_HELD = 3;

// Strafpunkte einer Karte
function pen(v) { if (v === 55) return 7; if (v % 11 === 0) return 5; if (v % 10 === 0) return 3; if (v % 5 === 0) return 2; return 1; }
const rowPts = row => row.reduce((a, v) => a + pen(v), 0);

function defaults() { return { target: 66, timer: 0, specials: { schild: true, halb: true, besen: true, tausch: false } }; }
const liveSetting = key => key === 'allSpecials' || key.startsWith('sp_');
function setting(r, key, value, ctx) {
  const st = r.settings;
  if (key === 'target') { ctx.must(r.status !== 'playing', 'Das kannst du zwischen den Spielen ändern.'); ctx.must(TARGETS.includes(+value), 'Ungültiges Spielende.'); st.target = +value; return; }
  if (key === 'timer') { ctx.must(r.status !== 'playing', 'Das kannst du zwischen den Spielen ändern.'); ctx.must(TIMERS.includes(+value), 'Ungültiges Zeitlimit.'); st.timer = +value; return; }
  st.specials = st.specials || {};
  if (key === 'allSpecials') { for (const k of SPECIALS) st.specials[k] = !!value; return; }
  if (key.startsWith('sp_')) { const k = key.slice(3); ctx.must(SPECIALS.includes(k), 'Unbekannte Sonderkarte.'); st.specials[k] = !!value; return; }
  ctx.must(false, 'Unbekannte Einstellung.');
}

const PS = () => ({ rows: 0, full: 0, low: 0, points: 0, biggest: 0, biggestCards: 0, played: 0, specials: 0, saved: 0, swept: 0, clean: 0, fives: 0 });
function start(r, ctx) {
  const s = r.state = {
    round: 0, turn: 0, phase: 'select', rows: [], hands: {}, picks: {}, queue: [], revealed: [], choosing: null,
    scores: {}, roundPts: {}, held: {}, ready: {}, target: r.settings.target || 66,
    deadline: 0, limit: 0, seq: 0, ev: null, history: [], ps: {}, started: Date.now(), ended: null, winner: null
  };
  for (const p of r.players) { s.scores[p.id] = 0; s.ps[p.id] = PS(); s.held[p.id] = []; }
  nextRound(r, ctx);
}
const ps = (s, id) => s.ps[id] || (s.ps[id] = PS());
function event(s, e) { s.seq++; s.ev = { ...e, seq: s.seq, at: Date.now() }; }
const pname = (r, id) => (r.players.find(p => p.id === id) || {}).name || 'Jemand';
const spOn = (r, k) => !!((r.settings.specials || {})[k]);

function nextRound(r, ctx) {
  const s = r.state;
  s.round++; s.turn = 0; s.roundPts = {}; s.ready = {};
  const deck = ctx.shuffle(Array.from({ length: 104 }, (_, i) => i + 1));
  s.rows = []; s.owner = {}; for (let i = 0; i < ROWS; i++) s.rows.push([deck.pop()]);
  for (const p of r.players) { s.hands[p.id] = deck.splice(0, HAND).sort((a, b) => a - b); s.roundPts[p.id] = 0; s.held[p.id] = s.held[p.id] || []; }
  // Sonderkarten: jeder Mensch bekommt pro Runde eine (höchstens 3 gleichzeitig)
  const on = SPECIALS.filter(k => spOn(r, k)), gifts = [];
  if (on.length) for (const p of r.players) if (!p.bot && s.held[p.id].length < MAX_HELD) { const k = on[ctx.rand(on.length)]; s.held[p.id].push(k); gifts.push({ pid: p.id, kind: k }); }
  event(s, { kind: 'round', round: s.round, gifts });
  nextTurn(r, ctx);
}
function nextTurn(r, ctx) {
  const s = r.state;
  s.turn++; s.picks = {}; s.revealed = []; s.queue = []; s.choosing = null; s.phase = 'select';
  arm(r, ctx, 'select');
  botTick(r, ctx);
}
// Zeitlimit für Auswählen bzw. Reihe wählen
function arm(r, ctx, what) {
  const s = r.state, sec = +r.settings.timer || 0;
  if (!sec) { s.deadline = 0; s.limit = 0; ctx.clearTimer(r, 'clock'); return; }
  s.limit = sec * 1000; s.deadline = Date.now() + s.limit;
  ctx.timer(r, 'clock', s.limit, () => timeout(r, ctx, what));
}
function armResume(r, ctx) {
  const s = r.state; if (!s.deadline) return;
  const what = s.phase === 'choose' ? 'choose' : 'select';
  ctx.timer(r, 'clock', Math.max(0, s.deadline - Date.now()), () => timeout(r, ctx, what));
}
function timeout(r, ctx) {
  const s = r.state; s.deadline = 0;
  if (s.phase === 'select') {
    const late = r.players.filter(p => s.picks[p.id] == null && (s.hands[p.id] || []).length);
    for (const p of late) s.picks[p.id] = p.bot ? botPick(s, p.id) : s.hands[p.id][ctx.rand(s.hands[p.id].length)];
    if (late.length) event(s, { kind: 'timeout', pids: late.map(p => p.id) });
    allPicked(r, ctx);
  } else if (s.phase === 'choose' && s.choosing) {
    chooseRow(r, s.choosing.pid, cheapestRow(s), ctx, true);
  }
  ctx.broadcast(r);
}

function allPicked(r, ctx) {
  const s = r.state;
  const active = r.players.filter(p => (s.hands[p.id] || []).length);
  if (!active.length || !active.every(p => s.picks[p.id] != null)) return;
  ctx.clearTimer(r, 'clock'); s.deadline = 0;
  s.queue = active.map(p => ({ pid: p.id, v: s.picks[p.id] })).sort((a, b) => a.v - b.v);
  for (const q of s.queue) { const h = s.hands[q.pid]; h.splice(h.indexOf(q.v), 1); ps(s, q.pid).played++; }
  s.revealed = s.queue.map(q => ({ ...q, row: null, took: false }));
  s.phase = 'reveal';
  event(s, { kind: 'reveal', cards: s.revealed.map(x => ({ pid: x.pid, v: x.v })) });
  ctx.timer(r, 'step', STEP_MS + 400, () => { step(r, ctx); ctx.broadcast(r); });
}
// eine aufgedeckte Karte nach der anderen einsortieren
function step(r, ctx) {
  const s = r.state; if (s.phase !== 'reveal') return;
  const q = s.queue[0];
  if (!q) return endTurn(r, ctx);
  let best = -1;
  s.rows.forEach((row, i) => { const last = row[row.length - 1]; if (last < q.v && (best < 0 || last > s.rows[best][s.rows[best].length - 1])) best = i; });
  if (best < 0) {
    // Karte ist kleiner als alle Reihen-Enden: Spieler muss eine Reihe nehmen
    s.phase = 'choose'; s.choosing = { pid: q.pid, v: q.v };
    event(s, { kind: 'choose', pid: q.pid, v: q.v });
    arm(r, ctx, 'choose'); botTick(r, ctx);
    return;
  }
  place(r, q, best, s.rows[best].length >= ROW_MAX ? 'full' : null, ctx);
}
function place(r, q, ri, reason, ctx) {
  const s = r.state, rev = s.revealed.find(x => x.pid === q.pid && x.v === q.v);
  if (reason) takeRow(r, q.pid, ri, q.v, reason);
  else { s.rows[ri].push(q.v); (s.owner = s.owner || {})[q.v] = q.pid; event(s, { kind: 'place', pid: q.pid, v: q.v, row: ri }); }
  if (rev) { rev.row = ri; rev.took = !!reason; }
  s.queue.shift();
  ctx.timer(r, 'step', STEP_MS, () => { step(r, ctx); ctx.broadcast(r); });
}
function takeRow(r, pid, ri, v, reason) {
  const s = r.state, cards = s.rows[ri].slice(), raw = rowPts(cards), held = s.held[pid] || [], p = ps(s, pid);
  let pts = raw, shield = false, half = false;
  const k1 = held.indexOf('schild');
  if (k1 >= 0) { held.splice(k1, 1); pts = 0; shield = true; p.specials++; p.saved += raw; }
  else { const k2 = held.indexOf('halb'); if (k2 >= 0) { held.splice(k2, 1); pts = Math.floor(raw / 2); half = true; p.specials++; p.saved += raw - pts; } }
  s.scores[pid] = (s.scores[pid] || 0) + pts; s.roundPts[pid] = (s.roundPts[pid] || 0) + pts;
  p.rows++; p.points += pts; if (reason === 'full') p.full++; else p.low++;
  if (pts > p.biggest) { p.biggest = pts; p.biggestCards = cards.length; }
  if (cards.includes(55)) p.fives++;
  s.rows[ri] = [v]; (s.owner = s.owner || {})[v] = pid;
  event(s, { kind: 'take', pid, row: ri, v, cards, pts, raw, reason, shield, half });
}
const cheapestRow = s => s.rows.map((row, i) => ({ i, p: rowPts(row), n: row.length })).sort((a, b) => a.p - b.p || a.n - b.n)[0].i;
function chooseRow(r, id, ri, ctx, auto) {
  const s = r.state;
  ctx.must(s.phase === 'choose' && s.choosing && s.choosing.pid === id, 'Du musst gerade keine Reihe wählen.');
  ctx.must(Number.isInteger(ri) && ri >= 0 && ri < ROWS, 'Diese Reihe gibt es nicht.');
  ctx.clearTimer(r, 'clock'); s.deadline = 0;
  const q = s.queue[0]; s.choosing = null; s.phase = 'reveal';
  place(r, q, ri, 'low', ctx);
  if (auto) s.ev.auto = true;
}
function endTurn(r, ctx) {
  const s = r.state;
  if (r.players.some(p => (s.hands[p.id] || []).length)) { ctx.timer(r, 'step', NEXT_MS, () => { nextTurn(r, ctx); ctx.broadcast(r); }); s.phase = 'reveal'; s.queue = []; return; }
  // Runde vorbei
  for (const p of r.players) if (!s.roundPts[p.id]) ps(s, p.id).clean++;
  s.history.push({ round: s.round, pts: { ...s.roundPts } });
  const maxScore = Math.max(...r.players.map(p => s.scores[p.id] || 0));
  if (maxScore >= s.target) {
    const low = Math.min(...r.players.map(p => s.scores[p.id] || 0));
    s.winner = r.players.filter(p => (s.scores[p.id] || 0) === low).map(p => p.id);
    s.phase = 'over'; s.ended = Date.now(); event(s, { kind: 'over' }); ctx.finish(r);
    return;
  }
  s.phase = 'roundEnd'; s.ready = {};
  for (const p of r.players) if (p.bot) s.ready[p.id] = true;
  event(s, { kind: 'roundEnd', round: s.round });
  ctx.timer(r, 'step', ROUND_AUTO_MS, () => { if (s.phase === 'roundEnd') { nextRound(r, ctx); ctx.broadcast(r); } });
}

function useSpecial(r, id, m, ctx) {
  const s = r.state, held = s.held[id] || [], k = held.indexOf(m.kind);
  ctx.must(k >= 0, 'Diese Sonderkarte hast du nicht.');
  ctx.must(s.phase === 'select', 'Sonderkarten setzt du ein, solange alle noch auswählen.');
  if (m.kind === 'besen') {
    const ri = +m.row; ctx.must(Number.isInteger(ri) && ri >= 0 && ri < ROWS, 'Wähle eine Reihe.');
    ctx.must(s.rows[ri].length > 1, 'In dieser Reihe liegt nur eine Karte.');
    const gone = s.rows[ri].slice(0, -1); s.rows[ri] = s.rows[ri].slice(-1);
    ps(s, id).swept += gone.length;
    event(s, { kind: 'besen', pid: id, row: ri, n: gone.length });
  } else if (m.kind === 'tausch') {
    const t = r.players.find(p => p.id === m.target); ctx.must(t && t.id !== id, 'Wähle einen Mitspieler.');
    const a = (s.hands[id] || []).filter(v => v !== s.picks[id]), b = (s.hands[t.id] || []).filter(v => v !== s.picks[t.id]);
    ctx.must(a.length && b.length, 'Ihr braucht beide noch eine freie Handkarte.');
    const x = a[ctx.rand(a.length)], y = b[ctx.rand(b.length)];
    const ha = s.hands[id], hb = s.hands[t.id];
    ha.splice(ha.indexOf(x), 1, y); hb.splice(hb.indexOf(y), 1, x); ha.sort((p, q) => p - q); hb.sort((p, q) => p - q);
    event(s, { kind: 'tausch', pid: id, target: t.id, gave: x, got: y });
  } else ctx.must(false, 'Diese Karte wirkt automatisch, wenn du eine Reihe nehmen musst.');
  held.splice(k, 1); ps(s, id).specials++;
  botTick(r, ctx);
}

function act(r, id, m, ctx) {
  const s = r.state;
  if (m.a === 'pick') {
    ctx.must(s.phase === 'select', 'Gerade wird keine Karte ausgewählt.');
    const v = +m.v; ctx.must((s.hands[id] || []).includes(v), 'Diese Karte hast du nicht.');
    s.picks[id] = v; allPicked(r, ctx);
  } else if (m.a === 'unpick') {
    ctx.must(s.phase === 'select', 'Zu spät – die Karten sind schon aufgedeckt.'); delete s.picks[id];
  } else if (m.a === 'row') {
    chooseRow(r, id, +m.row, ctx);
  } else if (m.a === 'special') {
    useSpecial(r, id, m, ctx);
  } else if (m.a === 'next') {
    ctx.must(s.phase === 'roundEnd', 'Die Runde läuft noch.');
    s.ready[id] = true;
    if (r.players.every(p => s.ready[p.id])) { ctx.clearTimer(r, 'step'); nextRound(r, ctx); }
  } else ctx.must(false, 'Unbekannte Aktion.');
}

/* ---------- Bots ---------- */
// Wie teuer wäre diese Karte gerade? (Strafpunkte, die sie wahrscheinlich kostet)
function botCost(s, v) {
  let best = -1;
  s.rows.forEach((row, i) => { const last = row[row.length - 1]; if (last < v && (best < 0 || last > s.rows[best][s.rows[best].length - 1])) best = i; });
  if (best < 0) return Math.min(...s.rows.map(rowPts)) + 0.5;
  const row = s.rows[best], gap = v - row[row.length - 1];
  if (row.length >= ROW_MAX) return rowPts(row) + 1;
  return (row.length === 4 ? 2.5 : row.length === 3 ? 0.6 : 0.1) + gap / 60;
}
function botPick(s, id) {
  const h = s.hands[id]; let best = h[0], bc = Infinity;
  for (const v of h) { const c = botCost(s, v) + Math.random() * 0.4; if (c < bc) { bc = c; best = v; } }
  return best;
}
function botTick(r, ctx) {
  const s = r.state; if (!s || r.status !== 'playing') return;
  const bots = r.players.filter(p => p.bot); if (!bots.length) return;
  if (!ctx.humansOnline(r)) { ctx.clearTimer(r, 'bot'); return; }
  if (s.phase === 'select') {
    const todo = bots.filter(b => s.picks[b.id] == null && (s.hands[b.id] || []).length);
    if (!todo.length) return;
    ctx.timer(r, 'bot', 900 + ctx.rand(1400), () => {
      if (s.phase !== 'select') return;
      const b = todo.find(x => s.picks[x.id] == null); if (b) { s.picks[b.id] = botPick(s, b.id); allPicked(r, ctx); ctx.broadcast(r); }
      botTick(r, ctx);
    });
  } else if (s.phase === 'choose' && s.choosing && bots.some(b => b.id === s.choosing.pid)) {
    const pid = s.choosing.pid;
    ctx.timer(r, 'bot', 1400, () => { if (s.phase === 'choose' && s.choosing && s.choosing.pid === pid) { chooseRow(r, pid, cheapestRow(s), ctx); ctx.broadcast(r); } });
  }
}

function removePlayer(r, id, ctx) {
  const s = r.state; if (!s) return;
  delete s.hands[id]; delete s.picks[id]; delete s.ready[id];
  s.queue = s.queue.filter(q => q.pid !== id);
  if (s.phase === 'choose' && s.choosing && s.choosing.pid === id) { s.choosing = null; s.phase = 'reveal'; ctx.timer(r, 'step', 200, () => { step(r, ctx); ctx.broadcast(r); }); }
  if (s.phase === 'select') allPicked(r, ctx);
  if (s.phase === 'roundEnd' && r.players.every(p => s.ready[p.id])) nextRound(r, ctx);
  botTick(r, ctx);
}
function resume(r, ctx) {
  const s = r.state; if (!s) return;
  if (s.phase === 'reveal') ctx.timer(r, 'step', STEP_MS, () => { s.queue.length ? step(r, ctx) : endTurn(r, ctx); ctx.broadcast(r); });
  else if (s.phase === 'roundEnd') ctx.timer(r, 'step', ROUND_AUTO_MS, () => { if (s.phase === 'roundEnd') { nextRound(r, ctx); ctx.broadcast(r); } });
  else armResume(r, ctx);
  botTick(r, ctx);
}
const onPresence = (r, ctx) => botTick(r, ctx);

function record(r, rec) {
  const s = r.state, x = rec.rv = rec.rv || { games: 0, wins: {}, best: null };
  x.games++;
  for (const id of s.winner || []) x.wins[id] = (x.wins[id] || 0) + 1;
  const low = Math.min(...r.players.map(p => s.scores[p.id] || 0));
  if (x.best == null || low < x.best.pts) x.best = { pts: low, name: pname(r, (s.winner || [])[0]) };
}

function view(r, id) {
  const s = r.state, over = r.status === 'over';
  return {
    round: s.round, turn: s.turn, turns: HAND, phase: s.phase, target: s.target,
    rows: s.rows, rowPts: s.rows.map(rowPts), owner: s.owner || {},
    hand: s.hands[id] || [], myPick: s.picks[id] != null ? s.picks[id] : null,
    picked: Object.fromEntries(r.players.map(p => [p.id, s.picks[p.id] != null])),
    counts: Object.fromEntries(r.players.map(p => [p.id, (s.hands[p.id] || []).length])),
    revealed: s.phase === 'select' ? [] : s.revealed, choosing: s.choosing,
    scores: s.scores, roundPts: s.roundPts, ready: s.ready,
    held: s.held[id] || [], heldCounts: Object.fromEntries(r.players.map(p => [p.id, (s.held[p.id] || []).length])),
    specialsOn: SPECIALS.filter(k => spOn(r, k)),
    deadline: s.deadline, limit: s.limit, now: Date.now(),
    ev: s.ev, history: s.history, winner: s.winner, started: s.started, ended: s.ended,
    ps: over || s.phase === 'roundEnd' ? s.ps : null
  };
}
const catalog = { SPECIALS };
module.exports = { meta, catalog, defaults, setting, liveSetting, start, act, view, removePlayer, resume, onPresence, record, pen };
