// Gleichklang – alle legen gemeinsam ihre Zahlen aufsteigend ab, ohne sich abzusprechen
const LEVELS = { 2: 12, 3: 10 };               // ab 4 Spielern: 8 Level
const REWARD = { 2: 'star', 3: 'life', 5: 'star', 6: 'life', 8: 'star', 9: 'life' };   // Belohnung nach geschafftem Level
const MAX_LIVES = 5, MAX_STARS = 3;
const BOT_MS_PER_STEP = 360;
// Sonderkarten: werden ab Level 2 verteilt (ab Level 5 zwei pro Level)
const SPECIALS = ['echo', 'schild', 'spiegel', 'pause', 'tausch'];
const MAX_SHIELDS = 2, PAUSE_MS = 10000, ECHO_MS = 6000, ECHO_RANGE = 10;
// Zeitlimit: pro Level 10 Sekunden Grundzeit + X Sekunden pro Karte, die jeder auf der Hand hat
const TIMERS = [0, 8, 12, 20, 30];
const timeFor = (level, per) => per ? (10 + level * per) * 1000 : 0;

const meta = { id: 'gleichklang', name: 'Gleichklang', min: 2, max: 6, bots: true, maxBots: 5 };

function defaults() { return { mode: 'normal', timer: 0, specials: { echo: true, schild: true, spiegel: false, pause: false, tausch: false } }; }
const liveSetting = key => key === 'allSpecials' || key.startsWith('sp_');   // gilt ab dem nächsten Level
function setting(r, key, value, ctx) {
  if (key === 'mode') { ctx.must(r.status !== 'playing', 'Die Schwierigkeit kannst du zwischen den Runden ändern.'); ctx.must(['leicht', 'normal', 'schwer'].includes(value), 'Unbekannte Stufe.'); r.settings.mode = value; return; }
  if (key === 'timer') { ctx.must(r.status !== 'playing', 'Das Zeitlimit kannst du zwischen den Runden ändern.'); ctx.must(TIMERS.includes(+value), 'Ungültiges Zeitlimit.'); r.settings.timer = +value; return; }
  r.settings.specials = r.settings.specials || {};
  if (key === 'allSpecials') { for (const k of SPECIALS) r.settings.specials[k] = !!value; return; }
  if (key.startsWith('sp_')) { const k = key.slice(3); ctx.must(SPECIALS.includes(k), 'Unbekannte Sonderkarte.'); r.settings.specials[k] = !!value; return; }
  ctx.must(false, 'Unbekannte Einstellung.');
}

function start(r, ctx) {
  const n = r.players.length, mode = r.settings.mode;
  r.state = {
    level: 1, maxLevel: LEVELS[n] || 8,
    lives: Math.min(MAX_LIVES, n + (mode === 'leicht' ? 1 : mode === 'schwer' ? -1 : 0)),
    stars: mode === 'schwer' ? 0 : mode === 'leicht' ? 2 : 1,
    phase: 'ready', ready: {}, hands: {}, pile: [], out: [], vote: null,
    seq: 0, ev: null, changed: Date.now(), started: Date.now(), ended: null,
    stats: { mistakes: {}, played: {}, starsUsed: 0, livesLost: 0, specials: 0, shieldsUsed: 0, early: {}, bestJump: null, fastest: null, streak: 0, bestStreak: 0, perfect: 0, levelMistakes: 0, starsProposed: {}, specialsBy: {}, levelsDone: 0, timeouts: 0 },
    cards: {}, shields: 0, dir: 1, ref: 0, pausedUntil: 0, echo: null
  };
  botTick(r, ctx);
}

function deal(r, ctx) {
  const s = r.state, deck = ctx.shuffle(Array.from({ length: 100 }, (_, i) => i + 1));
  s.hands = {};
  for (const p of r.players) s.hands[p.id] = deck.splice(0, s.level).sort((a, b) => a - b);
  s.pile = []; s.out = []; s.vote = null; s.phase = 'play'; s.changed = Date.now();
  s.dir = 1; s.ref = 0; s.pausedUntil = 0; s.echo = null; s.stats.levelMistakes = 0;
  const ms = timeFor(s.level, r.settings.timer || 0); s.deadline = ms ? Date.now() + ms : 0; s.limit = ms;
  armClock(r, ctx);
  // Sonderkarten verteilen
  const on = SPECIALS.filter(k => (r.settings.specials || {})[k]);
  const gifts = [];
  const count = !on.length || s.level < 2 ? 0 : s.level >= 5 ? 2 : 1;
  const humans = r.players.filter(p => !p.bot);
  for (let i = 0; i < count; i++) {
    const kind = on[ctx.rand(on.length)];
    if (kind === 'schild') { if (s.shields < MAX_SHIELDS) { s.shields++; gifts.push({ kind, pid: null }); } continue; }
    if (!humans.length) continue;
    const p = humans[ctx.rand(humans.length)];
    s.cards = s.cards || {}; (s.cards[p.id] = s.cards[p.id] || []).push(kind);
    gifts.push({ kind, pid: p.id });
  }
  event(s, { kind: 'deal', gifts });
}
// welche Karte ist bei diesem Spieler als Nächstes dran? (aufsteigend: kleinste, im Spiegel: größte)
const nextOf = (s, h) => s.dir === 1 ? h[0] : h[h.length - 1];
const takeNext = (s, h) => s.dir === 1 ? h.shift() : h.pop();
function armClock(r, ctx) {
  const s = r.state; if (!s || !s.deadline || s.phase !== 'play') { if (s) ctx.clearTimer(r, 'clock'); return; }
  ctx.timer(r, 'clock', s.deadline - Date.now(), () => { if (s.phase !== 'play' || !s.deadline || Date.now() < s.deadline - 50) return armClock(r, ctx); timeUp(r, ctx); ctx.broadcast(r); botTick(r, ctx); });
}
function timeUp(r, ctx) {
  const s = r.state;
  s.lives--; s.stats.livesLost++; s.stats.timeouts++; s.stats.streak = 0;
  const left = []; for (const p of r.players) for (const v of s.hands[p.id] || []) left.push({ v, pid: p.id });
  s.deadline = 0; s.vote = null; s.pausedUntil = 0;
  event(s, { kind: 'timeup', level: s.level, left: left.length });
  if (s.lives <= 0) { s.phase = 'lost'; s.why = 'time'; s.ended = Date.now(); ctx.finish(r); return; }
  s.phase = 'ready'; s.ready = {};          // das Level wird mit neuen Karten wiederholt
}
function event(s, e) { s.seq++; s.ev = { ...e, seq: s.seq }; }
const name = (r, id) => (r.players.find(p => p.id === id) || {}).name || 'Jemand';
const top = s => s.pile.length ? s.pile[s.pile.length - 1].v : 0;
const cardsLeft = s => Object.values(s.hands).reduce((a, h) => a + h.length, 0);

function checkLevel(r, ctx) {
  const s = r.state;
  if (s.lives <= 0) { s.phase = 'lost'; s.ended = Date.now(); s.deadline = 0; ctx.clearTimer(r, 'clock'); ctx.finish(r); return; }
  if (cardsLeft(s) > 0) return;
  s.deadline = 0; ctx.clearTimer(r, 'clock');
  s.stats.levelsDone = s.level; if (!s.stats.levelMistakes) s.stats.perfect++;
  if (s.level >= s.maxLevel) { s.phase = 'won'; s.ended = Date.now(); event(s, { kind: 'won' }); ctx.finish(r); return; }
  const rw = REWARD[s.level];
  let reward = null;
  if (rw === 'life' && s.lives < MAX_LIVES) { s.lives++; reward = 'life'; }
  if (rw === 'star' && s.stars < MAX_STARS) { s.stars++; reward = 'star'; }
  event(s, { kind: 'level', level: s.level, reward });
  s.level++; s.phase = 'ready'; s.ready = {}; s.vote = null;
}

function play(r, id, ctx) {
  const s = r.state;
  ctx.must(s.phase === 'play', 'Gerade wird nicht gelegt.');
  ctx.must(!s.vote, 'Erst über den Stern abstimmen.');
  ctx.must(!(s.pausedUntil > Date.now()), 'Pause! Noch einen Moment warten.');
  const h = s.hands[id]; ctx.must(h && h.length, 'Du hast keine Karten mehr.');
  const v = takeNext(s, h), prevRef = s.ref, waited = Date.now() - s.changed;
  s.pile.push({ v, pid: id }); s.ref = v;
  s.stats.played[id] = (s.stats.played[id] || 0) + 1;
  // hatte jemand noch eine Zahl, die vorher dran gewesen wäre? -> Fehler: Leben weg, diese Karten fliegen raus
  const lower = [];
  for (const p of r.players) { const hh = s.hands[p.id] || []; while (hh.length && (s.dir === 1 ? hh[0] < v : hh[hh.length - 1] > v)) lower.push({ v: takeNext(s, hh), pid: p.id }); }
  if (lower.length) {
    const shield = s.shields > 0;
    if (shield) { s.shields--; s.stats.shieldsUsed++; } else { s.lives--; s.stats.livesLost++; }
    for (const x of lower) s.stats.mistakes[x.pid] = (s.stats.mistakes[x.pid] || 0) + 1;
    s.out.push(...lower);
    const st = s.stats; st.early[id] = (st.early[id] || 0) + 1; st.streak = 0; st.levelMistakes++;
    event(s, { kind: 'mistake', pid: id, v, lower, shield });
  } else {
    const st = s.stats, gap = Math.abs(v - prevRef);
    st.streak++; st.bestStreak = Math.max(st.bestStreak, st.streak);
    if (!st.bestJump || gap > st.bestJump.gap) st.bestJump = { pid: id, gap, from: prevRef, v };
    if (!st.fastest || waited < st.fastest.ms) st.fastest = { pid: id, ms: waited, v };
    event(s, { kind: 'play', pid: id, v });
  }
  s.changed = Date.now();
  checkLevel(r, ctx);
}

function act(r, id, m, ctx) {
  const s = r.state;
  if (m.a === 'ready') {
    ctx.must(s.phase === 'ready', 'Ihr seid schon mitten im Level.');
    s.ready[id] = true;
    if (r.players.every(p => s.ready[p.id])) deal(r, ctx);
  } else if (m.a === 'play') {
    play(r, id, ctx);
  } else if (m.a === 'star') {
    ctx.must(s.phase === 'play', 'Einen Stern kannst du nur während des Levels einsetzen.');
    ctx.must(s.stars > 0, 'Ihr habt keinen Stern mehr.');
    ctx.must(!s.vote, 'Es läuft schon eine Abstimmung.');
    s.vote = { by: id, yes: { [id]: true } }; s.stats.starsProposed[id] = (s.stats.starsProposed[id] || 0) + 1;
    event(s, { kind: 'vote', pid: id });
    resolveVote(r, ctx);
  } else if (m.a === 'special') {
    useSpecial(r, id, m, ctx);
  } else if (m.a === 'vote') {
    ctx.must(s.vote, 'Gerade gibt es keine Abstimmung.');
    if (m.yes) { s.vote.yes[id] = true; resolveVote(r, ctx); }
    else { event(s, { kind: 'voteNo', pid: id }); s.vote = null; s.changed = Date.now(); }
  } else ctx.must(false, 'Unbekannte Aktion.');
  botTick(r, ctx);
}

function useSpecial(r, id, m, ctx) {
  const s = r.state, mine = (s.cards && s.cards[id]) || [], k = mine.indexOf(m.kind);
  ctx.must(k >= 0, 'Diese Sonderkarte hast du nicht.');
  ctx.must(s.phase === 'play', 'Sonderkarten kannst du nur während des Legens einsetzen.');
  ctx.must(!s.vote, 'Erst über den Stern abstimmen.');
  ctx.must(!(s.pausedUntil > Date.now()), 'Gerade ist Pause.');
  ctx.must(cardsLeft(s) > 0, 'Es liegen keine Karten mehr auf der Hand.');
  if (m.kind === 'echo') {
    const near = r.players.filter(p => { const h = s.hands[p.id] || []; if (!h.length) return false; const n = nextOf(s, h); return s.dir === 1 ? n - s.ref <= ECHO_RANGE : (s.ref || 101) - n <= ECHO_RANGE; }).map(p => p.id);
    s.echo = { pids: near, until: Date.now() + ECHO_MS, by: id };
    event(s, { kind: 'sp_echo', pid: id, near });
  } else if (m.kind === 'spiegel') {
    ctx.must(s.dir === 1, 'Es wird schon rückwärts gelegt.');
    s.dir = -1; s.ref = 101; s.echo = null;
    event(s, { kind: 'sp_spiegel', pid: id });
  } else if (m.kind === 'pause') {
    s.pausedUntil = Date.now() + PAUSE_MS;
    if (s.deadline) { s.deadline += PAUSE_MS; armClock(r, ctx); }
    event(s, { kind: 'sp_pause', pid: id, until: s.pausedUntil });
    ctx.timer(r, 'pause', PAUSE_MS, () => { s.changed = Date.now(); s.botPlan = null; event(s, { kind: 'pauseEnd' }); ctx.broadcast(r); botTick(r, ctx); });
  } else if (m.kind === 'tausch') {
    const t = r.players.find(p => p.id === m.target);
    ctx.must(t && t.id !== id, 'Wähle einen Mitspieler.');
    const a = s.hands[id] || [], b = s.hands[t.id] || [];
    ctx.must(a.length && b.length, 'Ihr braucht beide noch mindestens eine Karte.');
    const x = takeNext(s, a), y = takeNext(s, b);
    a.push(y); b.push(x); a.sort((p, q) => p - q); b.sort((p, q) => p - q); s.echo = null;
    event(s, { kind: 'sp_tausch', pid: id, target: t.id });
  } else ctx.must(false, 'Unbekannte Sonderkarte.');
  mine.splice(k, 1); s.stats.specials++; s.stats.specialsBy[id] = (s.stats.specialsBy[id] || 0) + 1;
  s.changed = Date.now();
}

function resolveVote(r, ctx) {
  const s = r.state;
  if (!r.players.every(p => s.vote.yes[p.id] || !(s.hands[p.id] || []).length)) return;
  s.vote = null; s.stars--; s.stats.starsUsed++;
  const shown = [];
  for (const p of r.players) { const h = s.hands[p.id]; if (h && h.length) shown.push({ v: takeNext(s, h), pid: p.id }); }
  s.out.push(...shown);
  event(s, { kind: 'star', shown });
  s.changed = Date.now();
  checkLevel(r, ctx);
}

/* ---------- Bots ---------- */
function botTick(r, ctx) {
  const s = r.state; if (!s || r.status !== 'playing') return;
  const bots = r.players.filter(p => p.bot);
  if (!bots.length) return;
  if (!ctx.humansOnline(r)) { ctx.clearTimer(r, 'bot'); return; }
  if (s.phase === 'ready') {
    if (bots.some(b => !s.ready[b.id])) ctx.timer(r, 'bot', 700, () => { for (const b of bots) s.ready[b.id] = true; if (r.players.every(p => s.ready[p.id])) deal(r, ctx); ctx.broadcast(r); botTick(r, ctx); });
    return;
  }
  if (s.phase !== 'play') return;
  if (s.pausedUntil > Date.now()) { ctx.clearTimer(r, 'bot'); return; }   // nach der Pause stößt der Pausen-Timer die Bots wieder an
  if (s.vote) {
    if (bots.some(b => !s.vote.yes[b.id] && (s.hands[b.id] || []).length)) ctx.timer(r, 'bot', 900, () => { if (!s.vote) return; for (const b of bots) s.vote.yes[b.id] = true; resolveVote(r, ctx); ctx.broadcast(r); botTick(r, ctx); });
    else ctx.clearTimer(r, 'bot');
    return;
  }
  // jeder Bot "zählt" vom obersten Stapelwert bis zu seiner nächsten Karte
  let best = null;
  for (const b of bots) {
    const h = s.hands[b.id]; if (!h || !h.length) continue;
    const gap = s.dir === 1 ? h[0] - top(s) : (s.ref || 101) - h[h.length - 1];
    const plan = s.botPlan && s.botPlan[b.id] && s.botPlan[b.id].c === s.changed ? s.botPlan[b.id] : { c: s.changed, ms: gap * BOT_MS_PER_STEP * (0.85 + Math.random() * 0.3) + 500 };
    s.botPlan = s.botPlan || {}; s.botPlan[b.id] = plan;
    const due = s.changed + plan.ms;
    if (!best || due < best.due) best = { id: b.id, due };
  }
  if (!best) { ctx.clearTimer(r, 'bot'); return; }
  const stamp = s.changed;
  ctx.timer(r, 'bot', best.due - Date.now(), () => {
    if (r.state !== s || s.changed !== stamp || s.phase !== 'play' || s.vote) return botTick(r, ctx);
    try { play(r, best.id, ctx); } catch {}
    ctx.broadcast(r); botTick(r, ctx);
  });
}

function removePlayer(r, id, ctx) {
  const s = r.state; if (!s) return;
  delete s.hands[id]; delete s.ready[id]; if (s.cards) delete s.cards[id];
  if (s.vote && s.vote.by === id) s.vote = null;
  if (s.phase === 'ready' && r.players.every(p => s.ready[p.id])) deal(r, ctx);
  else if (s.phase === 'play') { if (s.vote) resolveVote(r, ctx); checkLevel(r, ctx); }
  s.changed = Date.now();
  botTick(r, ctx);
}
const resume = (r, ctx) => {
  const s = r.state;
  if (s) { armClock(r, ctx); s.changed = Date.now(); s.botPlan = null; if (s.pausedUntil > Date.now()) ctx.timer(r, 'pause', s.pausedUntil - Date.now(), () => { s.changed = Date.now(); event(s, { kind: 'pauseEnd' }); ctx.broadcast(r); botTick(r, ctx); }); }
  botTick(r, ctx);
};
const onPresence = (r, ctx) => botTick(r, ctx);
function record(r, rec) {
  const s = r.state, g = rec.gk = rec.gk || { games: 0, wins: 0, bestLevel: 0, bestStreak: 0 };
  g.games++; if (s.phase === 'won') g.wins++;
  g.bestLevel = Math.max(g.bestLevel, s.phase === 'won' ? s.maxLevel : s.stats.levelsDone || 0);
  g.bestStreak = Math.max(g.bestStreak || 0, s.stats.bestStreak || 0);
}
const chatAllowed = r => !r.state || r.state.phase !== 'play';

function view(r, id) {
  const s = r.state;
  return {
    level: s.level, maxLevel: s.maxLevel, lives: s.lives, stars: s.stars, phase: s.phase,
    ready: s.ready, vote: s.vote, ev: s.ev,
    hand: s.hands[id] || [], dir: s.dir, ref: s.ref, now: Date.now(), deadline: s.deadline || 0, limit: s.limit || 0, why: s.why || null,
    myCards: (s.cards && s.cards[id]) || [], shields: s.shields || 0, maxShields: MAX_SHIELDS,
    pausedUntil: s.pausedUntil || 0, echo: s.echo && s.echo.until > Date.now() ? s.echo : null,
    cardCounts: Object.fromEntries(r.players.map(p => [p.id, ((s.cards && s.cards[p.id]) || []).length])),
    specialsOn: SPECIALS.filter(k => (r.settings.specials || {})[k]),
    counts: Object.fromEntries(r.players.map(p => [p.id, (s.hands[p.id] || []).length])),
    pile: s.pile.slice(-12), pileCount: s.pile.length, out: s.out,
    // am Ende dürfen alle sehen, wer was noch hatte
    reveal: r.status === 'over' ? s.hands : null,
    stats: s.stats, started: s.started, ended: s.ended,
    nextReward: REWARD[s.level] || null
  };
}

module.exports = { meta, defaults, setting, liveSetting, record, start, act, view, removePlayer, resume, onPresence, chatAllowed };
