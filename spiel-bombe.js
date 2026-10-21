// Bombe entschärfen – eine Person sieht die Bombe, die anderen haben das Handbuch
const R = require('./bombe-regeln');

const meta = { id: 'bombe', name: 'Bombe entschärfen', min: 2, max: 6, bots: false };
const DIFF = { leicht: { modules: 3, wires: [3, 4], simon: 3 }, normal: { modules: 4, wires: [3, 6], simon: 4 }, schwer: { modules: 5, wires: [4, 6], simon: 5 } };
const MAX_STRIKES = 3;
// Level-Modus: je höher, desto mehr Module, weniger Zeit pro Modul, längere Folgen und weniger erlaubte Fehler
const BASIC = ['kabel', 'knopf', 'symbole', 'farben', 'wort'];
const SOLVABLE = [...BASIC, 'labyrinth', 'morse', 'drehschalter', 'tastenfeld', 'kabelsalat'];
const ALL = [...SOLVABLE, 'ventil'];    // Reihenfolge der Kapitel im Handbuch
// must = diese Sorten kommen im Level sicher vor (neu eingeführte Rätsel), needy = Druckventil läuft nebenher
const LEVELS = [
  { mods: 2, secs: 300, wires: [3, 4], simon: 3, strikes: 3, types: ['kabel', 'knopf'] },
  { mods: 3, secs: 300, wires: [3, 5], simon: 3, strikes: 3, types: ['kabel', 'knopf', 'symbole'] },
  { mods: 3, secs: 270, wires: [3, 5], simon: 3, strikes: 3, types: ['kabel', 'knopf', 'symbole', 'wort'] },
  { mods: 4, secs: 300, wires: [3, 6], simon: 4, strikes: 3, types: BASIC, must: ['farben'] },
  { mods: 4, secs: 330, wires: [3, 6], simon: 4, strikes: 3, types: [...BASIC, 'labyrinth', 'morse'], must: ['labyrinth', 'morse'] },
  { mods: 5, secs: 360, wires: [4, 6], simon: 4, strikes: 3, types: [...BASIC, 'labyrinth', 'morse', 'drehschalter', 'kabelsalat'], must: ['drehschalter', 'kabelsalat'] },
  { mods: 5, secs: 360, wires: [4, 6], simon: 5, strikes: 3, types: SOLVABLE, must: ['tastenfeld'] },
  { mods: 6, secs: 420, wires: [4, 6], simon: 5, strikes: 3, types: SOLVABLE, needy: true },
  { mods: 7, secs: 450, wires: [5, 6], simon: 5, strikes: 2, types: SOLVABLE, needy: true },
  { mods: 8, secs: 480, wires: [5, 6], simon: 6, strikes: 2, types: SOLVABLE, needy: true }
];
const VENT_MS = 40000;    // so lange hat man Zeit, wenn das Ventil pfeift
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
// Jede Bombe bekommt ihr eigenes Handbuch: andere Regeln, andere Symbole, andere Wörter
function makeRules(ctx) {
  const symCols = [];
  const pool = Array.from({ length: R.SYM_COUNT }, (_, i) => i);
  for (let c = 0; c < 6; c++) symCols.push(ctx.shuffle(pool.slice()).slice(0, 7));
  const perm = () => { const t = ctx.shuffle(R.SIMON_COLORS.slice()); return Object.fromEntries(R.SIMON_COLORS.map((c, i) => [c, t[i]])); };
  const simon = { vokal: [perm(), perm(), perm()], ohne: [perm(), perm(), perm()] };
  const digits = ctx.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 4);
  const strip = Object.fromEntries(Object.keys(R.STRIP).map((c, i) => [c, digits[i]]));
  const words = ctx.shuffle(R.WORD_POOL.slice()).slice(0, 35).sort();
  // Labyrinthe: 6 Stück, jedes mit zwei eigenen Erkennungskreisen
  const N = R.MAZE_N, cellsAll = ctx.shuffle(Array.from({ length: N * N }, (_, i) => i));
  const mazes = Array.from({ length: 6 }, (_, k) => ({ cells: makeMaze(ctx), marks: [cellsAll[2 * k], cellsAll[2 * k + 1]] }));
  // Morse: 10 Wörter mit Frequenzen
  const freqs = ctx.shuffle(Array.from({ length: 21 }, (_, i) => 3500 + i * 5)).slice(0, 10).sort((a, b) => a - b);
  const mwords = ctx.shuffle(R.WORD_POOL.slice()).slice(0, 10);
  const morse = freqs.map((f, i) => ({ word: mwords[i], freq: f }));
  // Drehschalter: drei Modi mit je drei Formeln
  const props = Object.keys(R.DIAL_PROPS);
  const dials = Object.fromEntries(['A', 'B', 'C'].map(m => [m, ctx.shuffle(props.slice()).slice(0, 3).map(p => ({ p, add: ctx.rand(10) }))]));
  // Tastenfeld: 4 Stufen, je eine Regel für jede Anzeige 1–4
  const memory = [1, 2, 3, 4].map(st => [1, 2, 3, 4].map(() => {
    const t = st === 1 ? pick(['pos', 'lab'], ctx) : pick(['pos', 'lab', 'samePos', 'sameLab', 'samePos', 'sameLab'], ctx);
    return t === 'pos' || t === 'lab' ? { t, k: 1 + ctx.rand(4) } : { t, s: 1 + ctx.rand(st - 1) };
  }));
  // Kabelsalat: jede Kombination bekommt einen Buchstaben
  const salat = {}; const letters = ['S', 'S', 'S', 'N', 'N', 'N', 'G', 'G', 'B', 'B', 'A', 'A', 'S', 'N', 'G', 'B'];
  const lt = ctx.shuffle(letters.slice());
  let li = 0; for (const c of Object.keys(R.SALAT_COLORS)) for (const star of [false, true]) for (const led of [false, true]) salat[R.salatKey({ color: c, star, led })] = lt[li++];
  // Druckventil: Codewort -> Ventil A/B/C
  const vent = ctx.shuffle(R.VENT_CODES.slice()).slice(0, 8).sort().map(code => ({ code, valve: pick(['A', 'B', 'C'], ctx) }));
  return { ed: 100 + ctx.rand(900), wires: ctx.rand(R.WIRE_SETS.length), button: ctx.rand(R.BUTTON_SETS.length), strip, symCols, simon, words, mazes, morse, dials, memory, salat, vent };
}
// Labyrinth (ohne Kreise): jede Zelle hat Bits für offene Seiten
function makeMaze(ctx) {
  const N = R.MAZE_N, cells = Array(N * N).fill(0), seen = Array(N * N).fill(false), stack = [ctx.rand(N * N)];
  seen[stack[0]] = true;
  const opp = { u: 'd', d: 'u', l: 'r', r: 'l' };
  while (stack.length) {
    const c = stack[stack.length - 1], r0 = Math.floor(c / N), c0 = c % N;
    const nb = Object.entries(R.DIRS).map(([d, [dr, dc]]) => [d, r0 + dr, c0 + dc]).filter(([, rr, cc]) => rr >= 0 && rr < N && cc >= 0 && cc < N && !seen[rr * N + cc]);
    if (!nb.length) { stack.pop(); continue; }
    const [d, rr, cc] = nb[ctx.rand(nb.length)], n = rr * N + cc;
    cells[c] |= R.WALL[d]; cells[n] |= R.WALL[opp[d]]; seen[n] = true; stack.push(n);
  }
  return cells;
}
function mazeDist(cells, a) {
  const N = R.MAZE_N, dist = Array(N * N).fill(-1), q = [a]; dist[a] = 0;
  while (q.length) { const c = q.shift(); for (const [d, [dr, dc]] of Object.entries(R.DIRS)) if (cells[c] & R.WALL[d]) { const n = (Math.floor(c / N) + dr) * N + (c % N) + dc; if (dist[n] < 0) { dist[n] = dist[c] + 1; q.push(n); } } }
  return dist;
}
const DEFAULT_RULES = { ed: 1, wires: 0, button: 0, strip: R.STRIP, symCols: R.SYM_COLS, simon: R.SIMON, words: R.WORDS };
const rulesOf = s => s.rules || DEFAULT_RULES;
function makeBomb(ctx) {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXZ', D = '0123456789';   // ohne I und O (Verwechslung mit 1 und 0)
  let serial = '';
  for (let i = 0; i < 5; i++) serial += ctx.rand(3) ? pick(L, ctx) : pick(D, ctx);
  serial += pick(D, ctx);
  const labels = ctx.shuffle(R.LABELS.slice()).slice(0, ctx.rand(3));
  return { serial, batteries: ctx.rand(5), indicators: labels.map(l => ({ label: l, lit: ctx.rand(2) === 1 })) };
}
function makeModule(type, bomb, cfg, ctx, rules) {
  if (type === 'kabel') {
    const [a, b] = cfg.wires, n = a + ctx.rand(b - a + 1);
    const wires = Array.from({ length: n }, () => pick(['rot', 'blau', 'gelb', 'weiss', 'schwarz'], ctx));
    return { type, wires, cut: [], answer: R.wireAnswer(wires, bomb, rules.wires) };
  }
  if (type === 'knopf') {
    const k = { color: pick(['rot', 'blau', 'gelb', 'weiss'], ctx), label: pick(R.BUTTON_LABELS, ctx) };
    return { type, ...k, answer: R.buttonAnswer(k, bomb, rules.button), strip: null, pressAt: null };
  }
  if (type === 'symbole') {
    for (;;) {
      const col = pick(rules.symCols, ctx);
      const chosen = ctx.shuffle(col.slice()).slice(0, 4);
      // genau eine Spalte darf alle vier Symbole enthalten
      if (rules.symCols.filter(c => chosen.every(x => c.includes(x))).length !== 1) continue;
      const order = col.filter(x => chosen.includes(x));
      return { type, symbols: chosen, order, done: [] };
    }
  }
  if (type === 'farben') {
    const len = cfg.simon;
    return { type, seq: Array.from({ length: len }, () => pick(R.SIMON_COLORS, ctx)), stage: 1, input: 0 };
  }
  if (type === 'labyrinth') {
    const mi = ctx.rand(rules.mazes.length), cells = rules.mazes[mi].cells, N = R.MAZE_N;
    for (;;) { const a = ctx.rand(N * N), dist = mazeDist(cells, a), far = dist.map((d, i) => [d, i]).filter(([d]) => d >= 6); if (!far.length) continue; return { type, maze: mi, pos: a, goal: pick(far, ctx)[1] }; }
  }
  if (type === 'morse') { const idx = ctx.rand(rules.morse.length); return { type, idx, sel: ctx.rand(rules.morse.length) }; }
  if (type === 'drehschalter') {
    const mode = pick(['A', 'B', 'C'], ctx), answer = rules.dials[mode].map(x => R.dialValue(x, bomb));
    let set; do { set = [ctx.rand(10), ctx.rand(10), ctx.rand(10)]; } while (set.join() === answer.join());
    return { type, mode, answer, set };
  }
  if (type === 'tastenfeld') return { type, stage: 1, hist: [], display: 1 + ctx.rand(4), labels: ctx.shuffle([1, 2, 3, 4]) };
  if (type === 'kabelsalat') {
    for (;;) {
      const n = 4 + ctx.rand(3), wires = Array.from({ length: n }, () => ({ color: pick(Object.keys(R.SALAT_COLORS), ctx), star: ctx.rand(2) === 1, led: ctx.rand(2) === 1, cut: false }));
      wires.forEach(w => { w.should = R.salatCut(w, rules.salat, bomb); });
      if (wires.some(w => w.should)) return { type, wires };
    }
  }
  if (type === 'ventil') return { type, needy: true, active: false, code: null, due: 0, next: 0 };
  if (type === 'wort') {
    for (;;) {
      const word = pick(rules.words, ctx), A = 'ABCDEFGHIKLMNOPRSTUWZ';
      const cols = [...word].map(ch => { const set = new Set([ch]); while (set.size < 6) set.add(pick(A, ctx)); return ctx.shuffle([...set]); });
      const fits = rules.words.filter(w => [...w].every((ch, i) => cols[i].includes(ch)));
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
    const must = cfg.must || [];
    types = must.concat(ctx.shuffle(cfg.types.filter(t => !must.includes(t)))).slice(0, cfg.mods);
    while (types.length < cfg.mods) types.push(pick(cfg.types, ctx));
    if (cfg.needy) types.push('ventil');
  } else {
    const d = DIFF[st.diff] || DIFF.normal;
    cfg = { ...d, secs: st.minutes * 60, strikes: MAX_STRIKES };
    types = ctx.shuffle(SOLVABLE.slice()).slice(0, d.modules);
    if (st.diff === 'schwer') types.push('ventil');
  }
  const bomb = makeBomb(ctx), rules = makeRules(ctx);
  const modules = ctx.shuffle(types).map(t => makeModule(t, bomb, cfg, ctx, rules));
  // „Abwechselnd“: wer bisher am seltensten entschärft hat, ist dran (bei Gleichstand Zufall)
  r.defCount = r.defCount || {};
  const known = r.players.filter(p => r.defCount[p.id] != null).map(p => r.defCount[p.id]);
  const base = known.length ? Math.min(...known) : 0;
  for (const p of r.players) if (r.defCount[p.id] == null) r.defCount[p.id] = base;   // Neue fangen nicht bei 0 an
  let defuser;
  if (st.defuser !== 'zufall' && r.players.some(p => p.id === st.defuser)) defuser = st.defuser;
  else {
    const min = Math.min(...r.players.map(p => r.defCount[p.id]));
    let cand = r.players.filter(p => r.defCount[p.id] === min);
    if (cand.length > 1 && r.lastDefuser) cand = cand.filter(p => p.id !== r.lastDefuser);
    defuser = pick(cand, ctx).id;
  }
  r.defCount[defuser]++; r.lastDefuser = defuser;
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
  r.state = { bomb, modules, defuser, manual, rules, needyMs: VENT_MS, strikes: 0, maxStrikes: cfg.strikes || MAX_STRIKES, level: lv, levels: LEVELS.length,
    phase: 'play', started: Date.now(), deadline: Date.now() + ms, total: ms, ended: null, seq: 0, ev: null, log: [] };
  s0(r).modules.forEach((m, i) => { if (m.needy) m.next = Date.now() + 25000 + ctx.rand(15000); });
  arm(r, ctx);
}
const s0 = r => r.state;
function arm(r, ctx) {
  const s = r.state; if (!s || s.phase !== 'play') return;
  ctx.timer(r, 'boom', s.deadline - Date.now(), () => { if (s.phase !== 'play') return; boom(r, 'time', ctx); ctx.broadcast(r); });
  s.modules.forEach((m, i) => { if (m.needy) armVent(r, i, ctx); });
}
// Druckventil: ruht eine Weile, dann pfeift es und muss rechtzeitig abgelassen werden
function armVent(r, i, ctx) {
  const s = r.state, m = s.modules[i]; if (s.phase !== 'play') return;
  const at = m.active ? m.due : m.next;
  ctx.timer(r, 'vent' + i, Math.max(0, at - Date.now()), () => {
    if (r.state !== s || s.phase !== 'play') return;
    if (m.active) { m.active = false; m.code = null; m.next = Date.now() + 20000 + ctx.rand(20000); strike(r, i, ctx, 'Druck zu hoch – das Ventil kam zu spät'); }
    else { m.active = true; m.code = pick(rulesOf(s).vent, ctx).code; m.due = Date.now() + (s.needyMs || VENT_MS); event(s, { kind: 'vent', m: i }); }
    if (s.phase === 'play') armVent(r, i, ctx);
    ctx.broadcast(r);
  });
}
function event(s, e) { s.seq++; s.ev = { ...e, seq: s.seq, at: Date.now() }; }
function boom(r, why, ctx) {
  const s = r.state; s.phase = 'boom'; s.ended = Date.now(); s.why = why;
  event(s, { kind: 'boom', why }); ctx.clearTimer(r, 'boom'); ctx.finish(r);
}
function strike(r, m, ctx, what) {
  const s = r.state; s.strikes++; if (s.modules[m]) s.modules[m].strikes = (s.modules[m].strikes || 0) + 1;
  s.log.push({ kind: 'strike', m, what, at: Date.now() });
  if (s.strikes >= (s.maxStrikes || MAX_STRIKES)) return boom(r, 'strikes', ctx);
  event(s, { kind: 'strike', m, what });
}
function solved(r, mi, ctx) {
  const s = r.state; s.modules[mi].solved = true; s.modules[mi].solvedAt = Date.now() - s.started;
  s.log.push({ kind: 'solved', m: mi, at: Date.now() });
  if (s.modules.every(x => x.solved || x.needy)) {
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
    mod.pressAt = Date.now(); mod.strip = pick(Object.keys(rulesOf(s).strip), ctx);
  } else if (m.a === 'release') {
    ctx.must(mod.type === 'knopf' && mod.pressAt, 'Der Knopf ist nicht gedrückt.');
    const held = Date.now() - mod.pressAt, kind = held >= HOLD_MS ? 'hold' : 'tap';
    const digit = String(rulesOf(s).strip[mod.strip]);
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
    const want = R.simonMap(s.bomb, s.strikes, rulesOf(s).simon)[mod.seq[mod.input]];
    if (m.c === want) {
      mod.input++;
      if (mod.input >= mod.stage) { mod.stage++; mod.input = 0; if (mod.stage > mod.seq.length) solved(r, mi, ctx); else event(s, { kind: 'stage', m: mi }); }
      else event(s, { kind: 'ok', m: mi });
    } else { mod.input = 0; strike(r, mi, ctx, 'Falsche Farbe'); }
  } else if (m.a === 'move') {
    const d = m.d; ctx.must(mod.type === 'labyrinth' && R.DIRS[d], 'Diese Richtung gibt es nicht.');
    const cells = rulesOf(s).mazes[mod.maze].cells, N = R.MAZE_N;
    if (!(cells[mod.pos] & R.WALL[d])) { strike(r, mi, ctx, 'Gegen eine Wand gelaufen'); return; }
    mod.pos = (Math.floor(mod.pos / N) + R.DIRS[d][0]) * N + (mod.pos % N) + R.DIRS[d][1];
    if (mod.pos === mod.goal) solved(r, mi, ctx); else event(s, { kind: 'step', m: mi });
  } else if (m.a === 'freq') {
    ctx.must(mod.type === 'morse', 'Kein Morse-Modul.'); const n = rulesOf(s).morse.length;
    mod.sel = (mod.sel + (m.d > 0 ? 1 : -1) + n) % n;
  } else if (m.a === 'tx') {
    ctx.must(mod.type === 'morse', 'Kein Morse-Modul.');
    if (mod.sel === mod.idx) solved(r, mi, ctx); else strike(r, mi, ctx, 'Falsche Frequenz');
  } else if (m.a === 'dial') {
    const k = +m.k; ctx.must(mod.type === 'drehschalter' && k >= 0 && k < 3, 'Diesen Schalter gibt es nicht.');
    mod.set[k] = (mod.set[k] + (m.d > 0 ? 1 : 9)) % 10;
  } else if (m.a === 'dialCheck') {
    ctx.must(mod.type === 'drehschalter', 'Kein Drehschalter.');
    if (mod.set.join() === mod.answer.join()) solved(r, mi, ctx); else strike(r, mi, ctx, 'Falsche Einstellung');
  } else if (m.a === 'mem') {
    const k = +m.k; ctx.must(mod.type === 'tastenfeld' && k >= 0 && k < 4, 'Diese Taste gibt es nicht.');
    const rule = rulesOf(s).memory[mod.stage - 1][mod.display - 1], want = R.memAnswer(rule, mod.labels, mod.hist);
    if (k === want) {
      mod.hist.push({ pos: k, lab: mod.labels[k] }); mod.stage++;
      if (mod.stage > 4) { solved(r, mi, ctx); return; }
      mod.display = 1 + ctx.rand(4); mod.labels = ctx.shuffle([1, 2, 3, 4]); event(s, { kind: 'stage', m: mi });
    } else {
      mod.stage = 1; mod.hist = []; mod.display = 1 + ctx.rand(4); mod.labels = ctx.shuffle([1, 2, 3, 4]);
      strike(r, mi, ctx, 'Falsche Taste – zurück auf Stufe 1');
    }
  } else if (m.a === 'scut') {
    const k = +m.k, w = mod.wires && mod.wires[k]; ctx.must(mod.type === 'kabelsalat' && w && !w.cut, 'Dieses Kabel gibt es nicht.');
    w.cut = true;
    if (!w.should) { strike(r, mi, ctx, 'Dieses Kabel durfte nicht durch'); return; }
    if (mod.wires.every(x => !x.should || x.cut)) solved(r, mi, ctx); else event(s, { kind: 'cut', m: mi });
  } else if (m.a === 'valve') {
    ctx.must(mod.type === 'ventil' && ['A', 'B', 'C'].includes(m.v), 'Dieses Ventil gibt es nicht.');
    ctx.must(mod.active, 'Das Ventil ist gerade ruhig.');
    const want = (rulesOf(s).vent.find(x => x.code === mod.code) || {}).valve;
    if (m.v === want) { mod.active = false; mod.code = null; mod.next = Date.now() + 20000 + ctx.rand(20000); mod.vented = (mod.vented || 0) + 1; event(s, { kind: 'vented', m: mi }); armVent(r, mi, ctx); }
    else strike(r, mi, ctx, 'Falsches Ventil');
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
    modules: s.modules.map(x => ({ type: x.type, solved: !!x.solved, needy: !!x.needy })), ev: s.ev,
    modStats: over ? s.modules.filter(x => !x.needy).map(x => ({ type: x.type, solved: !!x.solved, at: x.solvedAt || null, strikes: x.strikes || 0 })) : null,
    vented: s.modules.filter(x => x.needy).reduce((a, x) => a + (x.vented || 0), 0),
    manual: s.manual[id] || (over ? Object.keys(R.MODULES) : []), manualOf: s.manual, log: s.log,
    rules: isDef && !over ? null : rulesOf(s), defCount: r.defCount || {}
  };
  if (isDef || over) {
    base.bomb = s.bomb;
    base.detail = s.modules.map(x => {
      if (x.type === 'kabel') return { wires: x.wires, cut: x.cut, answer: over ? x.answer : undefined };
      if (x.type === 'knopf') return { color: x.color, label: x.label, strip: x.pressAt ? x.strip : null, pressed: !!x.pressAt, answer: over ? x.answer : undefined };
      if (x.type === 'symbole') return { symbols: x.symbols, done: x.done, order: over ? x.order : undefined };
      if (x.type === 'farben') return { flash: x.seq.slice(0, Math.min(x.stage, x.seq.length)), stage: x.stage, len: x.seq.length, input: x.input };
      if (x.type === 'wort') return { cols: x.cols, answer: over ? x.answer : undefined };
      const RU = rulesOf(s);
      if (x.type === 'labyrinth') return { marks: RU.mazes[x.maze].marks, pos: x.pos, goal: x.goal, cells: over ? RU.mazes[x.maze].cells : undefined };
      if (x.type === 'morse') return { code: R.morseOf(RU.morse[x.idx].word), freqs: RU.morse.map(f => f.freq), sel: x.sel, answer: over ? RU.morse[x.idx].word : undefined };
      if (x.type === 'drehschalter') return { mode: x.mode, set: x.set, answer: over ? x.answer : undefined };
      if (x.type === 'tastenfeld') return { stage: x.stage, display: x.display, labels: x.labels };
      if (x.type === 'kabelsalat') return { wires: x.wires.map(w => ({ color: w.color, star: w.star, led: w.led, cut: w.cut, should: over ? w.should : undefined })) };
      if (x.type === 'ventil') return { active: x.active, code: x.code, due: x.due, vented: x.vented || 0 };
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
    const p = r.players.find(x => x.id !== id) || r.players[0]; s.defuser = p.id; ctx.say(r, p.name + ' übernimmt die Bombe.');
    loose.push(...(s.manual[p.id] || [])); delete s.manual[p.id];
  }
  const experts = Object.keys(s.manual);
  loose.forEach((c, i) => { const e = experts[i % experts.length]; if (e && !s.manual[e].includes(c)) s.manual[e].push(c); });
}
function record(r, rec) {
  const s = r.state, b = rec.bb = rec.bb || { played: 0, won: 0, boom: 0, best: {}, defusers: {}, fastest: null };
  b.played++; if (s.phase === 'won') b.won++; else b.boom++;
  const d = b.defusers[s.defuser] = b.defusers[s.defuser] || { won: 0, lost: 0 };
  if (s.phase === 'won') d.won++; else d.lost++;
  if (s.phase === 'won') {
    const key = s.level ? 'L' + s.level : 'frei', used = s.ended - s.started;
    if (!b.best[key] || used < b.best[key]) b.best[key] = used;
  }
  for (const m of s.modules) if (!m.needy && m.solvedAt != null && (!b.fastest || m.solvedAt < b.fastest.ms)) b.fastest = { ms: m.solvedAt, type: m.type };
}
const catalog = { LEVELS: LEVELS.map(l => ({ mods: l.mods, secs: l.secs, strikes: l.strikes, types: l.types, needy: !!l.needy })) };
module.exports = { meta, catalog, record, defaults, setting, start, act, view, resume, removePlayer, timerText, HOLD_MS };
