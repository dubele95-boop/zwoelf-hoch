// Bombe entschärfen – eine Person sieht die Bombe, die anderen haben das Handbuch
const R = require('./bombe-regeln');

const meta = { id: 'bombe', name: 'Bombe entschärfen', min: 2, max: 6, bots: false };
const DIFF = { leicht: { modules: 3, wires: [3, 4], simon: 3 }, normal: { modules: 4, wires: [3, 6], simon: 4 }, schwer: { modules: 5, wires: [4, 6], simon: 5 } };
const MAX_STRIKES = 3;
// Level-Modus: je höher, desto mehr Module, weniger Zeit pro Modul, längere Folgen und weniger erlaubte Fehler
const ALL = ['kabel', 'knopf', 'symbole', 'farben', 'wort'];
const LEVELS = [
  { mods: 2, secs: 300, wires: [3, 4], simon: 3, strikes: 3, types: ['kabel', 'knopf'] },
  { mods: 3, secs: 300, wires: [3, 5], simon: 3, strikes: 3, types: ['kabel', 'knopf', 'symbole'] },
  { mods: 3, secs: 270, wires: [3, 5], simon: 3, strikes: 3, types: ['kabel', 'knopf', 'symbole', 'wort'] },
  { mods: 4, secs: 300, wires: [3, 6], simon: 3, strikes: 3, types: ALL },
  { mods: 4, secs: 240, wires: [3, 6], simon: 4, strikes: 3, types: ALL },
  { mods: 5, secs: 300, wires: [4, 6], simon: 4, strikes: 3, types: ALL },
  { mods: 5, secs: 255, wires: [4, 6], simon: 5, strikes: 3, types: ALL },
  { mods: 6, secs: 300, wires: [4, 6], simon: 5, strikes: 3, types: ALL },
  { mods: 7, secs: 315, wires: [5, 6], simon: 5, strikes: 2, types: ALL },
  { mods: 8, secs: 330, wires: [5, 6], simon: 6, strikes: 2, types: ALL }
];
const HOLD_MS = 650;      // ab so langem Drücken gilt der Knopf als "gehalten"

function defaults() { return { mode: 'level', level: 1, best: 0, diff: 'normal', minutes: 5, defuser: 'zufall', split: true }; }
function setting(r, key, value, ctx) {
  const s = r.settings;
  if (key === 'mode') { ctx.must(value === 'level' || value === 'frei', 'Unbekannter Modus.'); s.mode = value; }
  else if (key === 'level') { const n = +value; ctx.must(Number.isInteger(n) && n >= 1 && n <= LEVELS.length, 'Dieses Level gibt es nicht.'); ctx.must(n <= (s.best || 0) + 1, 'Dieses Level ist noch gesperrt. Schafft erst Level ' + ((s.best || 0) + 1) + '.'); s.level = n; }
  else if (key === 'diff') { ctx.must(DIFF[value], 'Unbekannte Stufe.'); s.diff = value; }
  else if (key === 'minutes') { ctx.must([3, 4, 5, 6, 8].includes(+value), 'Ungültige Zeit.'); s.minutes = +value; }
  else if (key === 'defuser') { ctx.must(value === 'zufall' || r.players.some(p => p.id === value), 'Diesen Spieler gibt es nicht.'); s.defuser = value; }
  else if (key === 'split') s.split = !!value;
  else ctx.must(false, 'Unbekannte Einstellung.');
}

const pick = (a, ctx) => a[ctx.rand(a.length)];
function makeBomb(ctx) {
  const L = 'ABCDEFGHIJKLMNPQRSTUVWXZ', D = '0123456789';
  let serial = '';
  for (let i = 0; i < 5; i++) serial += ctx.rand(3) ? pick(L, ctx) : pick(D, ctx);
  serial += pick(D, ctx);
  const labels = ctx.shuffle(R.LABELS.slice()).slice(0, ctx.rand(3));
  return { serial, batteries: ctx.rand(5), indicators: labels.map(l => ({ label: l, lit: ctx.rand(2) === 1 })) };
}
function makeModule(type, bomb, cfg, ctx) {
  if (type === 'kabel') {
    const [a, b] = cfg.wires, n = a + ctx.rand(b - a + 1);
    const wires = Array.from({ length: n }, () => pick(['rot', 'blau', 'gelb', 'weiss', 'schwarz'], ctx));
    return { type, wires, cut: [], answer: R.wireAnswer(wires, bomb) };
  }
  if (type === 'knopf') {
    const k = { color: pick(['rot', 'blau', 'gelb', 'weiss'], ctx), label: pick(['DRÜCKEN', 'HALTEN', 'STOPP', 'ZÜNDEN'], ctx) };
    return { type, ...k, answer: R.buttonAnswer(k, bomb), strip: null, pressAt: null };
  }
  if (type === 'symbole') {
    const col = pick(R.SYM_COLS, ctx);
    const chosen = ctx.shuffle(col.slice()).slice(0, 4);
    const order = col.filter(x => chosen.includes(x));
    return { type, symbols: chosen, order, done: [] };
  }
  if (type === 'farben') {
    const len = cfg.simon;
    return { type, seq: Array.from({ length: len }, () => pick(R.SIMON_COLORS, ctx)), stage: 1, input: 0 };
  }
  if (type === 'wort') {
    for (;;) {
      const word = pick(R.WORDS, ctx), A = 'ABCDEFGHIKLMNOPRSTUWZ';
      const cols = [...word].map(ch => { const set = new Set([ch]); while (set.size < 6) set.add(pick(A, ctx)); return ctx.shuffle([...set]); });
      const fits = R.WORDS.filter(w => [...w].every((ch, i) => cols[i].includes(ch)));
      if (fits.length === 1) return { type, cols, answer: word };
    }
  }
}

function start(r, ctx) {
  const st = r.settings;
  if (!st.mode) { st.mode = 'level'; st.level = st.level || 1; st.best = st.best || 0; }
  const lv = st.mode === 'level' ? Math.min(LEVELS.length, Math.max(1, st.level || 1)) : null;
  let cfg, types;
  if (lv) {
    cfg = LEVELS[lv - 1];
    // erst jede erlaubte Modulsorte einmal, dann mit Wiederholungen auffüllen
    types = ctx.shuffle(cfg.types.slice()).slice(0, cfg.mods);
    while (types.length < cfg.mods) types.push(pick(cfg.types, ctx));
  } else {
    const d = DIFF[st.diff] || DIFF.normal;
    cfg = { ...d, secs: st.minutes * 60, strikes: MAX_STRIKES };
    types = ['kabel', 'knopf', ...ctx.shuffle(['symbole', 'farben', 'wort'])].slice(0, d.modules);
  }
  const bomb = makeBomb(ctx);
  const modules = ctx.shuffle(types).map(t => makeModule(t, bomb, cfg, ctx));
  let defuser = st.defuser !== 'zufall' && r.players.some(p => p.id === st.defuser) ? st.defuser : pick(r.players, ctx).id;
  // Handbuch aufteilen: jeder Experte bekommt einen Teil der Kapitel, die auf dieser Bombe vorkommen
  const experts = r.players.filter(p => p.id !== defuser).map(p => p.id);
  const present = ALL.filter(t => types.includes(t));
  const chapters = ctx.shuffle(present.slice());
  const manual = {};
  for (const e of experts) manual[e] = [];
  if (st.split && experts.length > 1) {
    for (let i = 0; i < Math.max(experts.length, chapters.length); i++) { const e = experts[i % experts.length], c = chapters[i % chapters.length]; if (!manual[e].includes(c)) manual[e].push(c); }
  } else for (const e of experts) manual[e] = chapters.slice();
  const ms = cfg.secs * 1000;
  r.state = { bomb, modules, defuser, manual, strikes: 0, maxStrikes: cfg.strikes || MAX_STRIKES, level: lv, levels: LEVELS.length,
    phase: 'play', started: Date.now(), deadline: Date.now() + ms, total: ms, ended: null, seq: 0, ev: null, log: [] };
  arm(r, ctx);
}
function arm(r, ctx) {
  const s = r.state; if (!s || s.phase !== 'play') return;
  ctx.timer(r, 'boom', s.deadline - Date.now(), () => { if (s.phase !== 'play') return; boom(r, 'time', ctx); ctx.broadcast(r); });
}
function event(s, e) { s.seq++; s.ev = { ...e, seq: s.seq, at: Date.now() }; }
function boom(r, why, ctx) {
  const s = r.state; s.phase = 'boom'; s.ended = Date.now(); s.why = why;
  event(s, { kind: 'boom', why }); ctx.clearTimer(r, 'boom'); ctx.finish(r);
}
function strike(r, m, ctx, what) {
  const s = r.state; s.strikes++;
  s.log.push({ kind: 'strike', m, what, at: Date.now() });
  if (s.strikes >= (s.maxStrikes || MAX_STRIKES)) return boom(r, 'strikes', ctx);
  event(s, { kind: 'strike', m, what });
}
function solved(r, mi, ctx) {
  const s = r.state; s.modules[mi].solved = true;
  s.log.push({ kind: 'solved', m: mi, at: Date.now() });
  if (s.modules.every(x => x.solved)) {
    s.phase = 'won'; s.ended = Date.now(); event(s, { kind: 'won' }); ctx.clearTimer(r, 'boom'); ctx.finish(r);
    if (s.level) { r.settings.best = Math.max(r.settings.best || 0, s.level); if (s.level < LEVELS.length) r.settings.level = s.level + 1; }
  } else event(s, { kind: 'solved', m: mi });
}
// Ziffern, die der Timer gerade anzeigt (z. B. "3:41")
function timerText(ms) { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }

function act(r, id, m, ctx) {
  const s = r.state;
  ctx.must(s.phase === 'play', 'Die Bombe ist schon entschieden.');
  ctx.must(id === s.defuser, 'Nur wer die Bombe vor sich hat, kann sie anfassen.');
  if (Date.now() >= s.deadline) { boom(r, 'time', ctx); return; }
  const mi = +m.m, mod = s.modules[mi]; ctx.must(mod && !mod.solved, 'Dieses Modul ist schon erledigt.');
  if (m.a === 'cut') {
    const k = +m.k; ctx.must(mod.type === 'kabel' && k >= 0 && k < mod.wires.length && !mod.cut.includes(k), 'Dieses Kabel gibt es nicht.');
    mod.cut.push(k);
    if (k === mod.answer) solved(r, mi, ctx); else strike(r, mi, ctx, 'Falsches Kabel');
  } else if (m.a === 'press') {
    ctx.must(mod.type === 'knopf' && !mod.pressAt, 'Der Knopf ist schon gedrückt.');
    mod.pressAt = Date.now(); mod.strip = pick(Object.keys(R.STRIP), ctx);
  } else if (m.a === 'release') {
    ctx.must(mod.type === 'knopf' && mod.pressAt, 'Der Knopf ist nicht gedrückt.');
    const held = Date.now() - mod.pressAt, kind = held >= HOLD_MS ? 'hold' : 'tap';
    const digit = String(R.STRIP[mod.strip]);
    // kleine Toleranz für die Übertragung: zählt, wenn die Ziffer jetzt oder vor einem Moment zu sehen war
    const left = s.deadline - Date.now();
    const shows = [0, 350, 700].some(dt => timerText(left + dt).includes(digit));
    mod.pressAt = null;
    if (mod.answer === 'tap' && kind === 'tap') solved(r, mi, ctx);
    else if (mod.answer === 'hold' && kind === 'hold' && shows) solved(r, mi, ctx);
    else { strike(r, mi, ctx, mod.answer === 'tap' ? 'Zu lange gedrückt' : kind === 'tap' ? 'Nur kurz gedrückt' : 'Falscher Moment beim Loslassen'); mod.strip = null; }
  } else if (m.a === 'sym') {
    const k = +m.k; ctx.must(mod.type === 'symbole' && mod.symbols[k] != null && !mod.done.includes(mod.symbols[k]), 'Dieses Symbol gibt es nicht.');
    const want = mod.order[mod.done.length];
    if (mod.symbols[k] === want) { mod.done.push(want); if (mod.done.length === 4) solved(r, mi, ctx); else event(s, { kind: 'ok', m: mi }); }
    else strike(r, mi, ctx, 'Falsches Symbol');
  } else if (m.a === 'color') {
    ctx.must(mod.type === 'farben' && R.SIMON_COLORS.includes(m.c), 'Diese Farbe gibt es nicht.');
    const want = R.simonMap(s.bomb, s.strikes)[mod.seq[mod.input]];
    if (m.c === want) {
      mod.input++;
      if (mod.input >= mod.stage) { mod.stage++; mod.input = 0; if (mod.stage > mod.seq.length) solved(r, mi, ctx); else event(s, { kind: 'stage', m: mi }); }
      else event(s, { kind: 'ok', m: mi });
    } else { mod.input = 0; strike(r, mi, ctx, 'Falsche Farbe'); }
  } else if (m.a === 'word') {
    const w = String(m.word || '').toUpperCase();
    ctx.must(mod.type === 'wort' && w.length === 5, 'Ungültiges Wort.');
    if (w === mod.answer) solved(r, mi, ctx); else strike(r, mi, ctx, 'Falsches Passwort');
  } else ctx.must(false, 'Unbekannte Aktion.');
}

function view(r, id) {
  const s = r.state, over = r.status === 'over', isDef = id === s.defuser;
  const base = {
    phase: s.phase, defuser: s.defuser, role: isDef ? 'defuser' : (r.players.some(p => p.id === id) ? 'expert' : 'watch'),
    strikes: s.strikes, maxStrikes: s.maxStrikes || MAX_STRIKES, level: s.level || null, levels: LEVELS.length, deadline: s.deadline, total: s.total, now: Date.now(), started: s.started, ended: s.ended, why: s.why || null,
    modules: s.modules.map(x => ({ type: x.type, solved: !!x.solved })), ev: s.ev,
    manual: s.manual[id] || (over ? Object.keys(R.MODULES) : []), manualOf: s.manual, log: s.log
  };
  if (isDef || over) {
    base.bomb = s.bomb;
    base.detail = s.modules.map(x => {
      if (x.type === 'kabel') return { wires: x.wires, cut: x.cut, answer: over ? x.answer : undefined };
      if (x.type === 'knopf') return { color: x.color, label: x.label, strip: x.pressAt ? x.strip : null, pressed: !!x.pressAt, answer: over ? x.answer : undefined };
      if (x.type === 'symbole') return { symbols: x.symbols, done: x.done, order: over ? x.order : undefined };
      if (x.type === 'farben') return { flash: x.seq.slice(0, Math.min(x.stage, x.seq.length)), stage: x.stage, len: x.seq.length, input: x.input };
      if (x.type === 'wort') return { cols: x.cols, answer: over ? x.answer : undefined };
      return {};
    });
  }
  return base;
}
const resume = (r, ctx) => arm(r, ctx);
function removePlayer(r, id, ctx) {
  const s = r.state; if (!s) return;
  const loose = s.manual[id] || []; delete s.manual[id];
  if (s.defuser === id) {
    const p = r.players[0]; s.defuser = p.id; ctx.say(r, p.name + ' übernimmt die Bombe.');
    loose.push(...(s.manual[p.id] || [])); delete s.manual[p.id];
  }
  const experts = Object.keys(s.manual);
  loose.forEach((c, i) => { const e = experts[i % experts.length]; if (e && !s.manual[e].includes(c)) s.manual[e].push(c); });
}
const catalog = { LEVELS: LEVELS.map(l => ({ mods: l.mods, secs: l.secs, strikes: l.strikes, types: l.types })) };
module.exports = { meta, catalog, defaults, setting, start, act, view, resume, removePlayer, timerText, HOLD_MS };
