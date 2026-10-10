// Bombe entschärfen – die Regeln des Handbuchs.
// Diese Datei nutzen Server (prüft die Lösung) und Browser (zeigt das Handbuch) gemeinsam,
// damit Handbuch und Prüfung immer zusammenpassen.
(function (root) {
  const COLORS = { rot: 'Rot', blau: 'Blau', gelb: 'Gelb', weiss: 'Weiß', schwarz: 'Schwarz', gruen: 'Grün' };
  const ORD = ['erste', 'zweite', 'dritte', 'vierte', 'fünfte', 'sechste'];
  const lastDigitOdd = b => +b.serial[b.serial.length - 1] % 2 === 1;
  const hasVowel = b => /[AEIOU]/.test(b.serial);
  const lit = (b, label) => b.indicators.some(i => i.label === label && i.lit);
  const count = (w, c) => w.filter(x => x === c).length;
  const lastOf = (w, c) => w.lastIndexOf(c);

  /* ---------- Kabel ---------- */
  const WIRES = {
    3: [
      { t: 'Wenn kein Kabel rot ist: schneide das <b>mittlere</b> Kabel.', f: (w) => count(w, 'rot') === 0 ? 1 : null },
      { t: 'Sonst, wenn das erste Kabel weiß ist: schneide das <b>erste</b> Kabel.', f: (w) => w[0] === 'weiss' ? 0 : null },
      { t: 'Sonst, wenn genau ein Kabel blau ist: schneide das <b>blaue</b> Kabel.', f: (w) => count(w, 'blau') === 1 ? w.indexOf('blau') : null },
      { t: 'Sonst: schneide das <b>letzte</b> Kabel.', f: (w) => w.length - 1 }
    ],
    4: [
      { t: 'Wenn die Seriennummer mit einer ungeraden Ziffer endet und es mindestens zwei rote Kabel gibt: schneide das <b>letzte rote</b> Kabel.', f: (w, b) => lastDigitOdd(b) && count(w, 'rot') >= 2 ? lastOf(w, 'rot') : null },
      { t: 'Sonst, wenn es kein gelbes Kabel gibt: schneide das <b>dritte</b> Kabel.', f: (w) => count(w, 'gelb') === 0 ? 2 : null },
      { t: 'Sonst, wenn es genau ein schwarzes Kabel gibt: schneide das <b>schwarze</b> Kabel.', f: (w) => count(w, 'schwarz') === 1 ? w.indexOf('schwarz') : null },
      { t: 'Sonst: schneide das <b>erste</b> Kabel.', f: () => 0 }
    ],
    5: [
      { t: 'Wenn die Bombe mindestens 2 Batterien hat und das letzte Kabel schwarz ist: schneide das <b>vierte</b> Kabel.', f: (w, b) => b.batteries >= 2 && w[4] === 'schwarz' ? 3 : null },
      { t: 'Sonst, wenn es genau ein rotes und mindestens zwei gelbe Kabel gibt: schneide das <b>zweite</b> Kabel.', f: (w) => count(w, 'rot') === 1 && count(w, 'gelb') >= 2 ? 1 : null },
      { t: 'Sonst, wenn es kein weißes Kabel gibt: schneide das <b>letzte</b> Kabel.', f: (w) => count(w, 'weiss') === 0 ? 4 : null },
      { t: 'Sonst: schneide das <b>erste</b> Kabel.', f: () => 0 }
    ],
    6: [
      { t: 'Wenn es kein gelbes Kabel gibt und die Seriennummer einen Vokal (A, E, I, U) enthält: schneide das <b>dritte</b> Kabel.', f: (w, b) => count(w, 'gelb') === 0 && hasVowel(b) ? 2 : null },
      { t: 'Sonst, wenn es mindestens drei blaue Kabel gibt: schneide das <b>letzte blaue</b> Kabel.', f: (w) => count(w, 'blau') >= 3 ? lastOf(w, 'blau') : null },
      { t: 'Sonst, wenn es kein rotes Kabel gibt: schneide das <b>fünfte</b> Kabel.', f: (w) => count(w, 'rot') === 0 ? 4 : null },
      { t: 'Sonst: schneide das <b>vierte</b> Kabel.', f: () => 3 }
    ]
  };
  function wireAnswer(w, b) { for (const r of WIRES[w.length]) { const x = r.f(w, b); if (x != null) return x; } return 0; }

  /* ---------- Knopf ---------- */
  const BUTTON = [
    { t: 'Ein <b>blauer</b> Knopf mit der Aufschrift <b>STOPP</b>: gedrückt <b>halten</b>.', f: (k) => k.color === 'blau' && k.label === 'STOPP' ? 'hold' : null },
    { t: 'Die Bombe hat mindestens 2 Batterien und der Knopf heißt <b>ZÜNDEN</b>: <b>kurz drücken</b>.', f: (k, b) => b.batteries >= 2 && k.label === 'ZÜNDEN' ? 'tap' : null },
    { t: 'Ein <b>weißer</b> Knopf und eine <b>leuchtende</b> Anzeige <b>TAU</b>: gedrückt <b>halten</b>.', f: (k, b) => k.color === 'weiss' && lit(b, 'TAU') ? 'hold' : null },
    { t: 'Die Bombe hat mindestens 3 Batterien und eine <b>leuchtende</b> Anzeige <b>ROT</b>: <b>kurz drücken</b>.', f: (k, b) => b.batteries >= 3 && lit(b, 'ROT') ? 'tap' : null },
    { t: 'Ein <b>gelber</b> Knopf: gedrückt <b>halten</b>.', f: (k) => k.color === 'gelb' ? 'hold' : null },
    { t: 'Ein <b>roter</b> Knopf mit der Aufschrift <b>HALTEN</b>: <b>kurz drücken</b>.', f: (k) => k.color === 'rot' && k.label === 'HALTEN' ? 'tap' : null },
    { t: 'In allen anderen Fällen: gedrückt <b>halten</b>.', f: () => 'hold' }
  ];
  const STRIP = { blau: 4, gelb: 5, rot: 3, weiss: 1 };
  function buttonAnswer(k, b) { for (const r of BUTTON) { const x = r.f(k, b); if (x) return x; } return 'hold'; }

  /* ---------- Symbole ---------- */
  const SYM_COLS = [[15, 23, 6, 13, 2, 25, 3], [16, 11, 22, 4, 17, 13, 6], [7, 26, 25, 24, 10, 0, 12], [8, 9, 1, 0, 16, 13, 25], [21, 25, 17, 12, 19, 9, 18], [22, 20, 26, 5, 15, 14, 21]];

  /* ---------- Farben-Echo ---------- */
  const SIMON_COLORS = ['rot', 'blau', 'gruen', 'gelb'];
  const SIMON = {
    vokal: [
      { rot: 'blau', blau: 'rot', gruen: 'gelb', gelb: 'gruen' },
      { rot: 'gelb', blau: 'gruen', gruen: 'blau', gelb: 'rot' },
      { rot: 'gruen', blau: 'rot', gruen: 'gelb', gelb: 'blau' }
    ],
    ohne: [
      { rot: 'blau', blau: 'gelb', gruen: 'gruen', gelb: 'rot' },
      { rot: 'rot', blau: 'blau', gruen: 'gelb', gelb: 'gruen' },
      { rot: 'gelb', blau: 'gruen', gruen: 'blau', gelb: 'rot' }
    ]
  };
  const simonMap = (b, strikes) => SIMON[hasVowel(b) ? 'vokal' : 'ohne'][Math.min(2, strikes)];

  /* ---------- Passwort ---------- */
  const WORDS = ['ABEND', 'ADLER', 'ANGEL', 'APFEL', 'BIRNE', 'BLATT', 'BLUME', 'BRIEF', 'DACHS', 'DAMPF', 'EIMER', 'ENGEL', 'FEDER', 'FISCH', 'FLOSS',
    'GABEL', 'GEIST', 'HONIG', 'INSEL', 'KABEL', 'KERZE', 'KLANG', 'KRONE', 'LAMPE', 'LICHT', 'MAUER', 'NEBEL', 'PALME', 'PILOT', 'REGEN',
    'SALAT', 'SCHAL', 'TIGER', 'WOLKE', 'ZEBRA'];

  /* ---------- Anzeigen auf dem Gehäuse ---------- */
  const LABELS = ['TAU', 'ROT', 'LUX', 'KFZ', 'ZUG', 'NOT', 'BOX', 'SOS'];

  const MODULES = {
    kabel: 'Kabel', knopf: 'Der Knopf', symbole: 'Symbole', farben: 'Farben-Echo', wort: 'Passwort'
  };

  const R = { COLORS, ORD, WIRES, wireAnswer, BUTTON, STRIP, buttonAnswer, SYM_COLS, SIMON_COLORS, SIMON, simonMap, WORDS, LABELS, MODULES, hasVowel, lastDigitOdd };
  if (typeof module !== 'undefined' && module.exports) module.exports = R; else root.BombeRegeln = R;
})(this);
