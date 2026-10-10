// Durch die Nacht – gemeinsam vom Lagerfeuer bis ins Dorf, bevor die Sonne aufgeht
const meta = { id: 'nacht', name: 'Durch die Nacht', min: 1, max: 6, bots: false };

const COLORS = ['kraft', 'mut', 'wissen', 'geschick'];
const CNAME = { kraft: 'Kraft', mut: 'Mut', wissen: 'Wissen', geschick: 'Geschick' };
const GOAL = 10;
const DIFF = { leicht: { rounds: 11, hp: 8 }, normal: { rounds: 10, hp: 6 }, schwer: { rounds: 9, hp: 5 } };
const SCALE = [0, 1, 1.6, 2.3, 3.0, 3.6, 4.2];
const HAND = n => n === 1 ? 6 : n === 2 ? 5 : 4;
const REFILL = n => n === 1 ? 3 : 2;
const HAND_MAX = n => n === 1 ? 8 : 6;

const CHARS = {
  jaegerin: { name: 'Jägerin', text: 'Ihre Kraft-Karten zählen +1.', color: 'kraft' },
  ritter: { name: 'Ritter', text: 'Seine Mut-Karten zählen +1.', color: 'mut' },
  gelehrte: { name: 'Gelehrte', text: 'Ihre Wissen-Karten zählen +1.', color: 'wissen' },
  akrobat: { name: 'Akrobat', text: 'Seine Geschick-Karten zählen +1.', color: 'geschick' },
  heiler: { name: 'Heiler', text: 'Einmal pro Runde: eine Handkarte abwerfen und dafür +1 Ausdauer.' },
  spaeherin: { name: 'Späherin', text: 'Ihr seht immer das nächste Ereignis. Einmal pro Nacht darf sie ein Ereignis überspringen.' }
};
const ITEMS = {
  fackel: { name: 'Fackel', text: 'Löst ein dunkles Ereignis sofort – sonst +2 Mut.' },
  seil: { name: 'Seil', text: '+3 Geschick für dieses Ereignis.' },
  trank: { name: 'Heiltrank', text: '+2 Ausdauer.' },
  kompass: { name: 'Kompass', text: 'Ihr kommt sofort 1 Feld weiter.' }
};
const EVENTS = [
  { id: 'woelfe', name: 'Heulende Wölfe', text: 'Gelbe Augen im Unterholz. Jetzt bloß keine Angst zeigen!', need: { mut: 4 }, fail: { hp: -2 } },
  { id: 'baum', name: 'Umgestürzter Baum', text: 'Ein riesiger Stamm liegt quer über dem Weg.', need: { kraft: 4 }, fail: { stop: true } },
  { id: 'bach', name: 'Reißender Bach', text: 'Über glitschige Steine geht es ans andere Ufer.', need: { geschick: 4 }, fail: { hp: -1, discard: 1 } },
  { id: 'nebel', name: 'Dichter Nebel', text: 'Wo war noch mal der Weg?', need: { wissen: 4 }, fail: { move: -1 } },
  { id: 'ruine', name: 'Alte Ruine', text: 'Zwischen den Steinen glitzert etwas. Wer findet es?', need: { wissen: 3 }, win: { item: 1 }, optional: true },
  { id: 'irrlichter', name: 'Irrlichter', text: 'Tanzende Lichter wollen euch vom Weg locken.', need: { wissen: 3, mut: 3 }, fail: { move: -1, hp: -1 } },
  { id: 'baer', name: 'Bärenhöhle', text: 'Aus der Dunkelheit kommt ein tiefes Brummen …', need: { kraft: 4, mut: 3 }, fail: { hp: -3 } },
  { id: 'hang', name: 'Steiler Hang', text: 'Eine Abkürzung – wenn ihr euch traut.', need: { geschick: 4 }, win: { move: 1 }, fail: { hp: -1 } },
  { id: 'dickicht', name: 'Dunkles Dickicht', text: 'Hier sieht man die eigene Hand nicht mehr.', need: { kraft: 5 }, dark: true, fail: { hp: -2, stop: true } },
  { id: 'huette', name: 'Verlassene Hütte', text: 'Ein trockener Platz. Kurz ausruhen!', need: null, win: { hp: 2 } },
  { id: 'haendler', name: 'Händler im Mondschein', text: '„Löst mein Rätsel, und die Ware gehört euch.“', need: { wissen: 4 }, win: { item: 1 }, optional: true },
  { id: 'sumpf', name: 'Sumpf', text: 'Jeder Schritt schmatzt und zieht nach unten.', need: { geschick: 3, kraft: 3 }, any: true, fail: { move: -1, hp: -1 } },
  { id: 'gewitter', name: 'Gewitter', text: 'Blitze zucken, der Wind heult durch die Bäume.', need: { mut: 5 }, dark: true, fail: { loseItem: 1, hp: -1 } },
  { id: 'raeuber', name: 'Räuber', text: '„Halt! Her mit euren Sachen!“', need: { kraft: 4, geschick: 4 }, any: true, fail: { loseItem: 1, hp: -1 } },
  { id: 'lichtung', name: 'Sternenklare Lichtung', text: 'Die Sterne zeigen euch den Weg.', need: null, win: { move: 1, draw: 1 } },
  { id: 'bruecke', name: 'Wackelige Hängebrücke', text: 'Die Seile knarren bedrohlich.', need: { geschick: 3, mut: 3 }, fail: { hp: -2 } },
  { id: 'eule', name: 'Die weise Eule', text: '„Wer mir antwortet, dem zeige ich eine Abkürzung.“', need: { wissen: 5 }, win: { move: 1 }, optional: true },
  { id: 'quelle', name: 'Klare Quelle', text: 'Frisches, kaltes Wasser!', need: null, win: { hp: 1, draw: 1 } },
  { id: 'hoehle', name: 'Fledermaushöhle', text: 'Tausend Flügel über euren Köpfen.', need: { mut: 4 }, dark: true, fail: { hp: -1, discard: 1 } },
  { id: 'schlucht', name: 'Tiefe Schlucht', text: 'Nur ein schmaler Baumstamm führt hinüber.', need: { geschick: 4, kraft: 3 }, fail: { stop: true, hp: -1 } }
];

// Sonderkarten: liegen gemischt im Nachziehstapel. Ausgeschaltete werden beim Ziehen übersprungen.
const SPECIALS = {
  lagerfeuer: { name: 'Lagerfeuer', text: 'Ihr rastet: +1 Ausdauer, jeder zieht 2 Karten. Diese Stunde vergeht, ohne dass ihr weiterkommt – das Ereignis wartet bis zur nächsten Stunde.' },
  mond: { name: 'Mondlicht', text: 'Zählt als 3 Punkte in einer Farbe deiner Wahl.' },
  freund: { name: 'Hilfe vom Freund', text: 'Gib einem Mitspieler eine deiner Handkarten.' },
  stern: { name: 'Sternschnuppe', text: 'Du suchst das nächste Ereignis aus 3 möglichen aus.' },
  abkuerzung: { name: 'Abkürzung', text: 'Schafft ihr das Ereignis dieser Stunde, geht ihr ein Feld extra weiter.' },
  glueck: { name: 'Glücksbringer', text: 'Scheitert ihr in dieser Stunde, passiert nichts Schlimmes – ihr geht einfach weiter.' },
  eule: { name: 'Eulenruf', text: 'Diese Stunde sehen alle die Handkarten aller Mitspieler.' }
};
const SP_KEYS = Object.keys(SPECIALS);
function defaults() { return { diff: 'normal', chars: {}, specials: Object.fromEntries(SP_KEYS.map(k => [k, true])) }; }
const liveSetting = key => key === 'allSpecials' || key.startsWith('sp_');
function setting(r, key, value, ctx) {
  if (key === 'diff') { ctx.must(r.status !== 'playing', 'Die Schwierigkeit kannst du zwischen den Runden ändern.'); ctx.must(DIFF[value], 'Unbekannte Stufe.'); r.settings.diff = value; return; }
  r.settings.specials = r.settings.specials || {};
  if (key === 'allSpecials') { for (const k of SP_KEYS) r.settings.specials[k] = !!value; unpark(r); return; }
  if (key.startsWith('sp_')) { const k = key.slice(3); ctx.must(SPECIALS[k], 'Unbekannte Sonderkarte.'); r.settings.specials[k] = !!value; unpark(r); return; }
  ctx.must(false, 'Unbekannte Einstellung.');
}
// jeder sucht sich in der Lobby selbst eine Figur aus
function lobbyAct(r, id, m, ctx) {
  ctx.must(m.a === 'char', 'Unbekannte Aktion.');
  const c = m.c; ctx.must(c === null || CHARS[c], 'Diese Figur gibt es nicht.');
  r.settings.chars = r.settings.chars || {};
  if (c) ctx.must(!Object.entries(r.settings.chars).some(([pid, x]) => x === c && pid !== id && r.players.some(p => p.id === pid)), 'Diese Figur hat schon jemand.');
  if (c) r.settings.chars[id] = c; else delete r.settings.chars[id];
}

let cardId = 0;
function makeDeck(n, ctx) {
  const copies = n >= 4 ? 2 : 1, deck = [];
  const nid = () => 'c' + (++cardId) + Math.random().toString(36).slice(2, 5);
  for (let k = 0; k < copies; k++) for (const c of COLORS) for (const [v, times] of [[1, 4], [2, 4], [3, 3], [4, 2]]) for (let i = 0; i < times; i++) deck.push({ id: nid(), c, v });
  for (let k = 0; k < copies; k++) for (const sp of SP_KEYS) deck.push({ id: nid(), sp });
  return ctx.shuffle(deck);
}
const spOn = (r, k) => !!((r.settings.specials || {})[k]);
// ausgeschaltete Sonderkarten zur Seite legen; wieder eingeschaltete kommen zurück ins Spiel
function unpark(r) {
  const s = r.state; if (!s || !s.parked) return;
  const back = s.parked.filter(c => spOn(r, c.sp)); s.parked = s.parked.filter(c => !spOn(r, c.sp)); s.discard.push(...back);
}
function draw(s, ctx, r) {
  for (let guard = 0; guard < 400; guard++) {
    if (!s.deck.length) { if (!s.discard.length) return null; s.deck = ctx.shuffle(s.discard); s.discard = []; }
    const c = s.deck.pop();
    if (c && c.sp && r && !spOn(r, c.sp)) { (s.parked = s.parked || []).push(c); continue; }
    return c || null;
  }
  return null;
}
function start(r, ctx) {
  const n = r.players.length, d = DIFF[r.settings.diff] || DIFF.normal;
  const chosen = { ...(r.settings.chars || {}) };
  const free = ctx.shuffle(Object.keys(CHARS).filter(c => !Object.values(chosen).includes(c)));
  const chars = {};
  for (const p of r.players) chars[p.id] = chosen[p.id] && CHARS[chosen[p.id]] ? chosen[p.id] : free.pop();
  const s = r.state = {
    round: 0, rounds: d.rounds, hp: d.hp, hpMax: d.hp + 2, pos: 0, goal: GOAL,
    chars, hands: {}, deck: makeDeck(n, ctx), discard: [], items: ['fackel'],
    events: ctx.shuffle(EVENTS.map(e => e.id)), event: null, next: null,
    contrib: [], used: [], ready: {}, phase: 'plan', healed: {}, skipUsed: false,
    result: null, history: [], seq: 0, ev: null, started: Date.now(), ended: null
  };
  s.parked = []; s.hour = {}; s.pick = null; s.spUsed = 0;
  for (const p of r.players) { s.hands[p.id] = []; for (let i = 0; i < HAND(n); i++) { const c = draw(s, ctx, r); if (c) s.hands[p.id].push(c); } }
  nextRound(r, ctx);
}
function event(s, e) { s.seq++; s.ev = { ...e, seq: s.seq }; }
const evById = id => EVENTS.find(e => e.id === id);
function needOf(r, ev) {
  if (!ev.need) return null;
  const n = r.players.length, late = r.state.round >= 6 ? 1 : 0, out = {};
  for (const [c, b] of Object.entries(ev.need)) out[c] = Math.max(1, Math.round((b + late) * SCALE[Math.min(6, n)]));
  return out;
}
function nextRound(r, ctx) {
  const s = r.state;
  s.round++; s.phase = 'plan'; s.contrib = []; s.used = []; s.ready = {}; s.healed = {}; s.result = null; s.hour = {}; s.pick = null;
  if (!s.events.length) s.events = ctx.shuffle(EVENTS.map(e => e.id));
  s.event = s.events.pop();
  if (!s.events.length) s.events = ctx.shuffle(EVENTS.map(e => e.id).filter(x => x !== s.event));
  s.next = s.events[s.events.length - 1];
  event(s, { kind: 'event', id: s.event });
}
function totals(r) {
  const s = r.state, t = { kraft: 0, mut: 0, wissen: 0, geschick: 0 };
  for (const x of s.contrib) { const ch = CHARS[s.chars[x.pid]]; t[x.card.c] += x.card.v + (!x.card.sp && ch && ch.color === x.card.c ? 1 : 0); }
  if (s.used.includes('seil')) t.geschick += 3;
  if (s.used.includes('fackel') && !evById(s.event).dark) t.mut += 2;
  return t;
}
function success(r) {
  const s = r.state, ev = evById(s.event), need = needOf(r, ev);
  if (!need) return true;
  if (ev.dark && s.used.includes('fackel')) return true;
  const t = totals(r), checks = Object.entries(need).map(([c, v]) => t[c] >= v);
  return ev.any ? checks.some(Boolean) : checks.every(Boolean);
}
function resolve(r, ctx) {
  const s = r.state, ev = evById(s.event), ok = success(r), n = r.players.length;
  const lucky = !ok && s.hour && s.hour.glueck;
  const eff = lucky ? {} : (ok ? ev.win : ev.fail) || {};
  const res = { ok, id: ev.id, hp: 0, move: 0, item: null, lost: null, discard: 0, stop: !!eff.stop, skipped: false, lucky: !!lucky, shortcut: false };
  res.totals = totals(r); res.contrib = s.contrib.slice(); res.used = s.used.slice();
  // ausgespielte Karten wandern auf den Ablagestapel
  for (const x of s.contrib) s.discard.push(x.card.sp ? { id: x.card.id, sp: x.card.sp } : x.card);
  s.contrib = [];
  if (eff.hp) { const before = s.hp; s.hp = Math.max(0, Math.min(s.hpMax, s.hp + eff.hp)); res.hp = s.hp - before; }
  if (eff.item) { const it = Object.keys(ITEMS)[ctx.rand(4)]; s.items.push(it); res.item = it; }
  if (eff.loseItem && s.items.length) { res.lost = s.items.splice(ctx.rand(s.items.length), 1)[0]; }
  if (eff.discard) { res.discard = eff.discard; for (const p of r.players) { const h = s.hands[p.id]; for (let k = 0; k < eff.discard && h.length; k++) s.discard.push(h.splice(ctx.rand(h.length), 1)[0]); } }
  let step = (eff.stop ? 0 : 1) + (eff.move || 0);
  if (ok && s.hour && s.hour.abkuerzung) { step++; res.shortcut = true; }
  s.pos = Math.max(0, Math.min(s.goal, s.pos + step)); res.move = step;
  // Nachziehen
  const extra = eff.draw || 0;
  for (const p of r.players) { const h = s.hands[p.id]; for (let k = 0; k < REFILL(n) + extra && h.length < HAND_MAX(n); k++) { const c = draw(s, ctx, r); if (c) h.push(c); } }
  s.result = res; s.history.push({ round: s.round, id: ev.id, ok, move: step, hp: res.hp });
  s.phase = 'result';
  event(s, { kind: 'result', ok });
  if (s.hp <= 0) { s.phase = 'lost'; s.why = 'hp'; s.ended = Date.now(); ctx.finish(r); }
  else if (s.pos >= s.goal) { s.phase = 'won'; s.ended = Date.now(); ctx.finish(r); }
  else if (s.round >= s.rounds) { s.phase = 'lost'; s.why = 'dawn'; s.ended = Date.now(); ctx.finish(r); }
}

function act(r, id, m, ctx) {
  const s = r.state, hand = s.hands[id];
  if (m.a === 'next') { ctx.must(s.phase === 'result', 'Die Runde läuft noch.'); nextRound(r, ctx); return; }
  ctx.must(s.phase === 'plan', 'Gerade wird nichts geplant.');
  if (m.a === 'pickEvent') { pickEvent(r, id, m, ctx); return; }
  ctx.must(!s.pick, 'Erst wird das nächste Ereignis ausgesucht.');
  if (m.a === 'give') {
    const k = hand.findIndex(c => c.id === m.card); ctx.must(k >= 0, 'Diese Karte hast du nicht.');
    ctx.must(!hand[k].sp, 'Sonderkarten setzt du über ihren eigenen Knopf ein.');
    s.contrib.push({ pid: id, card: hand.splice(k, 1)[0] }); s.ready = {};
  } else if (m.a === 'take') {
    const k = s.contrib.findIndex(x => x.card.id === m.card); ctx.must(k >= 0 && s.contrib[k].pid === id, 'Du kannst nur deine eigenen Karten zurücknehmen.');
    const c = s.contrib.splice(k, 1)[0].card; hand.push(c.sp ? { id: c.id, sp: c.sp } : c); s.ready = {};
  } else if (m.a === 'special') {
    useSpecial(r, id, m, ctx);
  } else if (m.a === 'item') {
    const it = m.item, k = s.items.indexOf(it); ctx.must(k >= 0, 'Diesen Gegenstand habt ihr nicht.');
    if (it === 'trank') { ctx.must(s.hp < s.hpMax, 'Ihr seid schon fit.'); s.items.splice(k, 1); s.hp = Math.min(s.hpMax, s.hp + 2); event(s, { kind: 'item', it, pid: id }); }
    else if (it === 'kompass') { s.items.splice(k, 1); s.pos = Math.min(s.goal, s.pos + 1); event(s, { kind: 'item', it, pid: id }); if (s.pos >= s.goal) { s.phase = 'won'; s.ended = Date.now(); ctx.finish(r); return; } }
    else { ctx.must(!s.used.includes(it), 'Schon eingesetzt.'); s.items.splice(k, 1); s.used.push(it); event(s, { kind: 'item', it, pid: id }); }
    s.ready = {};
  } else if (m.a === 'unitem') {
    const k = s.used.indexOf(m.item); ctx.must(k >= 0, 'Nicht eingesetzt.'); s.used.splice(k, 1); s.items.push(m.item); s.ready = {};
  } else if (m.a === 'heal') {
    ctx.must(s.chars[id] === 'heiler', 'Nur der Heiler kann das.'); ctx.must(!s.healed[id], 'Diese Runde schon geheilt.'); ctx.must(s.hp < s.hpMax, 'Ihr seid schon fit.');
    const k = hand.findIndex(c => c.id === m.card); ctx.must(k >= 0, 'Diese Karte hast du nicht.');
    s.discard.push(hand.splice(k, 1)[0]); s.hp++; s.healed[id] = true; event(s, { kind: 'heal', pid: id });
  } else if (m.a === 'skip') {
    ctx.must(s.chars[id] === 'spaeherin', 'Nur die Späherin kann das.'); ctx.must(!s.skipUsed, 'Das geht nur einmal pro Nacht.');
    s.skipUsed = true;
    for (const x of s.contrib) s.hands[x.pid].push(x.card);
    for (const it of s.used) s.items.push(it);
    s.contrib = []; s.used = []; s.ready = {};
    const old = s.event; s.event = s.events.pop(); if (!s.events.length) s.events = ctx.shuffle(EVENTS.map(e => e.id).filter(x => x !== s.event && x !== old));
    s.next = s.events[s.events.length - 1];
    event(s, { kind: 'skip', pid: id, from: old });
  } else if (m.a === 'ready') {
    s.ready[id] = !s.ready[id];
    if (r.players.every(p => s.ready[p.id])) resolve(r, ctx);
  } else ctx.must(false, 'Unbekannte Aktion.');
}
function useSpecial(r, id, m, ctx) {
  const s = r.state, hand = s.hands[id];
  const k = hand.findIndex(c => c.id === m.card && c.sp); ctx.must(k >= 0, 'Diese Sonderkarte hast du nicht.');
  const sp = hand[k].sp, n = r.players.length;
  const done = () => { const c = hand.splice(hand.findIndex(c => c.id === m.card), 1)[0]; if (c) s.discard.push(c); s.spUsed = (s.spUsed || 0) + 1; s.ready = {}; };
  if (sp === 'mond') {
    ctx.must(COLORS.includes(m.color), 'Wähle eine Farbe.');
    const c = hand.splice(k, 1)[0];
    s.contrib.push({ pid: id, card: { id: c.id, sp: 'mond', c: m.color, v: 3 } }); s.ready = {}; s.spUsed = (s.spUsed || 0) + 1;
    event(s, { kind: 'sp', sp, pid: id, color: m.color }); return;
  }
  if (sp === 'freund') {
    const t = r.players.find(p => p.id === m.target); ctx.must(t && t.id !== id, 'Wähle einen Mitspieler.');
    const g = hand.findIndex(c => c.id === m.give && c.id !== m.card); ctx.must(g >= 0, 'Wähle eine Karte zum Verschenken.');
    const gift = hand.splice(g, 1)[0]; s.hands[t.id].push(gift); done();
    event(s, { kind: 'sp', sp, pid: id, target: t.id, card: gift }); return;
  }
  if (sp === 'lagerfeuer') {
    done();
    for (const x of s.contrib) s.hands[x.pid].push(x.card.sp ? { id: x.card.id, sp: x.card.sp } : x.card);
    for (const it of s.used) s.items.push(it);
    s.contrib = []; s.used = [];
    const before = s.hp; s.hp = Math.min(s.hpMax, s.hp + 1);
    for (const p of r.players) { const h = s.hands[p.id]; for (let i = 0; i < 2 && h.length < HAND_MAX(n) + 2; i++) { const c = draw(s, ctx, r); if (c) h.push(c); } }
    s.events.push(s.event);                       // das Ereignis wartet auf die nächste Stunde
    s.result = { ok: true, rest: true, id: 'rast', hp: s.hp - before, move: 0, totals: totals(r), contrib: [], used: [] };
    s.history.push({ round: s.round, id: 'rast', ok: true, move: 0, hp: s.hp - before });
    s.phase = 'result';
    event(s, { kind: 'sp', sp, pid: id });
    if (s.round >= s.rounds) { s.phase = 'lost'; s.why = 'dawn'; s.ended = Date.now(); ctx.finish(r); }
    return;
  }
  if (sp === 'stern') {
    const pool = s.events.slice().reverse().filter(x => x !== s.event);
    const opts = [...new Set(pool)].slice(0, 3);
    ctx.must(opts.length, 'Gerade gibt es nichts zur Auswahl.');
    done(); s.pick = { pid: id, opts };
    event(s, { kind: 'sp', sp, pid: id }); return;
  }
  if (sp === 'abkuerzung' || sp === 'glueck' || sp === 'eule') {
    ctx.must(!s.hour[sp], 'Diese Karte wirkt in dieser Stunde schon.');
    done(); s.hour[sp] = id;
    event(s, { kind: 'sp', sp, pid: id }); return;
  }
  ctx.must(false, 'Unbekannte Sonderkarte.');
}
function pickEvent(r, id, m, ctx) {
  const s = r.state; ctx.must(s.pick && s.pick.pid === id, 'Du suchst gerade nichts aus.');
  ctx.must(s.pick.opts.includes(m.id), 'Dieses Ereignis steht nicht zur Wahl.');
  const k = s.events.lastIndexOf(m.id); if (k >= 0) s.events.splice(k, 1);
  s.events.push(m.id); s.next = m.id; s.pick = null;
  event(s, { kind: 'picked', pid: id, id: m.id });
}
function removePlayer(r, id, ctx) {
  const s = r.state; if (!s) return;
  for (const c of s.hands[id] || []) s.discard.push(c);
  delete s.hands[id]; delete s.ready[id];
  if (s.pick && s.pick.pid === id) s.pick = null;
  s.contrib = s.contrib.filter(x => { if (x.pid === id) { s.discard.push(x.card.sp ? { id: x.card.id, sp: x.card.sp } : x.card); return false; } return true; });
  if (s.phase === 'plan' && r.players.length && r.players.every(p => s.ready[p.id])) resolve(r, ctx);
}
const sortHand = h => h.slice().sort((a, b) => (a.sp ? 9 : COLORS.indexOf(a.c)) - (b.sp ? 9 : COLORS.indexOf(b.c)) || (a.v || 0) - (b.v || 0) || String(a.sp || '').localeCompare(String(b.sp || '')));
function view(r, id) {
  const s = r.state, ev = evById(s.event), scout = Object.values(s.chars).includes('spaeherin');
  return {
    round: s.round, rounds: s.rounds, hp: s.hp, hpMax: s.hpMax, pos: s.pos, goal: s.goal, phase: s.phase, why: s.why || null,
    chars: s.chars, items: s.items, used: s.used, ready: s.ready, healed: s.healed, skipUsed: s.skipUsed,
    hand: sortHand(s.hands[id] || []),
    hour: s.hour || {}, pick: s.pick && (s.pick.pid === id ? s.pick : { pid: s.pick.pid }),
    pickOpts: s.pick && s.pick.pid === id ? s.pick.opts.map(evById) : null,
    others: s.hour && s.hour.eule ? Object.fromEntries(r.players.filter(p => p.id !== id).map(p => [p.id, sortHand(s.hands[p.id] || [])])) : null,
    specialsOn: SP_KEYS.filter(k => spOn(r, k)), spUsed: s.spUsed || 0,
    counts: Object.fromEntries(r.players.map(p => [p.id, (s.hands[p.id] || []).length])),
    event: ev ? { ...ev, needNow: needOf(r, ev) } : null,
    next: scout && s.next ? evById(s.next) : null,
    contrib: s.contrib, totals: totals(r), willWin: ev ? success(r) : false,
    result: s.result, history: s.history, ev: s.ev, deck: s.deck.length, started: s.started, ended: s.ended
  };
}
const catalog = { CHARS, ITEMS, CNAME, SPECIALS, EVENTS: { ...Object.fromEntries(EVENTS.map(e => [e.id, e])), rast: { id: 'rast', name: 'Rast am Lagerfeuer' } } };
module.exports = { meta, catalog, defaults, setting, liveSetting, lobbyAct, start, act, view, removePlayer, CHARS, ITEMS, EVENTS };
