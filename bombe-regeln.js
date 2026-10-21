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
  const anyLit = b => b.indicators.some(i => i.lit);
  const nth = (w, c, k) => { let n = 0; for (let i = 0; i < w.length; i++) if (w[i] === c && ++n === k) return i; return -1; };
  const maxSame = w => Math.max(...['rot', 'blau', 'gelb', 'weiss', 'schwarz'].map(c => count(w, c)));
  // Weitere Handbuch-Ausgaben: jede Bombe bekommt per Zufall eine davon
  const WIRES_B = {
    3: [
      { t: 'Wenn das letzte Kabel weiß ist: schneide das <b>erste</b> Kabel.', f: (w) => w[2] === 'weiss' ? 0 : null },
      { t: 'Sonst, wenn es mehr als ein blaues Kabel gibt: schneide das <b>letzte blaue</b> Kabel.', f: (w) => count(w, 'blau') > 1 ? lastOf(w, 'blau') : null },
      { t: 'Sonst, wenn kein Kabel schwarz ist: schneide das <b>zweite</b> Kabel.', f: (w) => count(w, 'schwarz') === 0 ? 1 : null },
      { t: 'Sonst: schneide das <b>letzte</b> Kabel.', f: () => 2 }
    ],
    4: [
      { t: 'Wenn es genau ein rotes Kabel gibt und die Bombe <b>keine</b> Batterie hat: schneide das <b>rote</b> Kabel.', f: (w, b) => count(w, 'rot') === 1 && b.batteries === 0 ? w.indexOf('rot') : null },
      { t: 'Sonst, wenn das erste und das letzte Kabel die gleiche Farbe haben: schneide das <b>zweite</b> Kabel.', f: (w) => w[0] === w[3] ? 1 : null },
      { t: 'Sonst, wenn es mindestens zwei blaue Kabel gibt: schneide das <b>erste blaue</b> Kabel.', f: (w) => count(w, 'blau') >= 2 ? w.indexOf('blau') : null },
      { t: 'Sonst: schneide das <b>letzte</b> Kabel.', f: () => 3 }
    ],
    5: [
      { t: 'Wenn das erste Kabel rot ist und die Seriennummer einen Vokal (A, E, I, U) enthält: schneide das <b>letzte</b> Kabel.', f: (w, b) => w[0] === 'rot' && hasVowel(b) ? 4 : null },
      { t: 'Sonst, wenn es kein schwarzes Kabel gibt: schneide das <b>dritte</b> Kabel.', f: (w) => count(w, 'schwarz') === 0 ? 2 : null },
      { t: 'Sonst, wenn es mehr gelbe als blaue Kabel gibt: schneide das <b>erste gelbe</b> Kabel.', f: (w) => count(w, 'gelb') > count(w, 'blau') ? w.indexOf('gelb') : null },
      { t: 'Sonst: schneide das <b>zweite</b> Kabel.', f: () => 1 }
    ],
    6: [
      { t: 'Wenn die Seriennummer mit einer <b>geraden</b> Ziffer endet und es kein weißes Kabel gibt: schneide das <b>erste</b> Kabel.', f: (w, b) => !lastDigitOdd(b) && count(w, 'weiss') === 0 ? 0 : null },
      { t: 'Sonst, wenn es genau ein gelbes Kabel gibt: schneide das <b>gelbe</b> Kabel.', f: (w) => count(w, 'gelb') === 1 ? w.indexOf('gelb') : null },
      { t: 'Sonst, wenn das dritte Kabel schwarz ist: schneide das <b>sechste</b> Kabel.', f: (w) => w[2] === 'schwarz' ? 5 : null },
      { t: 'Sonst: schneide das <b>fünfte</b> Kabel.', f: () => 4 }
    ]
  };
  const WIRES_C = {
    3: [
      { t: 'Wenn alle drei Kabel <b>verschiedene</b> Farben haben: schneide das <b>letzte</b> Kabel.', f: (w) => new Set(w).size === 3 ? 2 : null },
      { t: 'Sonst, wenn die Bombe mindestens 2 Batterien hat: schneide das <b>erste</b> Kabel.', f: (w, b) => b.batteries >= 2 ? 0 : null },
      { t: 'Sonst, wenn es ein gelbes Kabel gibt: schneide das <b>erste gelbe</b> Kabel.', f: (w) => count(w, 'gelb') ? w.indexOf('gelb') : null },
      { t: 'Sonst: schneide das <b>mittlere</b> Kabel.', f: () => 1 }
    ],
    4: [
      { t: 'Wenn es kein blaues Kabel gibt: schneide das <b>letzte</b> Kabel.', f: (w) => count(w, 'blau') === 0 ? 3 : null },
      { t: 'Sonst, wenn mindestens eine Anzeige <b>leuchtet</b>: schneide das <b>zweite</b> Kabel.', f: (w, b) => anyLit(b) ? 1 : null },
      { t: 'Sonst, wenn es genau ein weißes Kabel gibt: schneide das <b>weiße</b> Kabel.', f: (w) => count(w, 'weiss') === 1 ? w.indexOf('weiss') : null },
      { t: 'Sonst: schneide das <b>dritte</b> Kabel.', f: () => 2 }
    ],
    5: [
      { t: 'Wenn mindestens drei Kabel die <b>gleiche</b> Farbe haben: schneide das <b>vierte</b> Kabel.', f: (w) => maxSame(w) >= 3 ? 3 : null },
      { t: 'Sonst, wenn das letzte Kabel gelb ist: schneide das <b>erste</b> Kabel.', f: (w) => w[4] === 'gelb' ? 0 : null },
      { t: 'Sonst, wenn es ein rotes Kabel gibt und die Seriennummer mit einer <b>ungeraden</b> Ziffer endet: schneide das <b>letzte rote</b> Kabel.', f: (w, b) => count(w, 'rot') && lastDigitOdd(b) ? lastOf(w, 'rot') : null },
      { t: 'Sonst: schneide das <b>dritte</b> Kabel.', f: () => 2 }
    ],
    6: [
      { t: 'Wenn es genau zwei rote Kabel gibt: schneide das <b>zweite rote</b> Kabel.', f: (w) => count(w, 'rot') === 2 ? nth(w, 'rot', 2) : null },
      { t: 'Sonst, wenn die Bombe <b>keine</b> Batterie hat: schneide das <b>letzte</b> Kabel.', f: (w, b) => b.batteries === 0 ? 5 : null },
      { t: 'Sonst, wenn das erste Kabel blau oder schwarz ist: schneide das <b>dritte</b> Kabel.', f: (w) => w[0] === 'blau' || w[0] === 'schwarz' ? 2 : null },
      { t: 'Sonst: schneide das <b>zweite</b> Kabel.', f: () => 1 }
    ]
  };
  const WIRE_SETS = [WIRES, WIRES_B, WIRES_C];
  function wireAnswer(w, b, set) { for (const r of WIRE_SETS[set || 0][w.length]) { const x = r.f(w, b); if (x != null) return x; } return 0; }

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
  const BUTTON_B = [
    { t: 'Ein <b>roter</b> Knopf mit der Aufschrift <b>ABBRUCH</b>: gedrückt <b>halten</b>.', f: (k) => k.color === 'rot' && k.label === 'ABBRUCH' ? 'hold' : null },
    { t: 'Der Knopf heißt <b>LOS</b> und die Bombe hat <b>keine</b> Batterie: <b>kurz drücken</b>.', f: (k, b) => k.label === 'LOS' && b.batteries === 0 ? 'tap' : null },
    { t: 'Ein <b>blauer</b> Knopf und eine <b>leuchtende</b> Anzeige <b>SOS</b>: <b>kurz drücken</b>.', f: (k, b) => k.color === 'blau' && lit(b, 'SOS') ? 'tap' : null },
    { t: 'Ein <b>weißer</b> Knopf mit der Aufschrift <b>STOPP</b>: gedrückt <b>halten</b>.', f: (k) => k.color === 'weiss' && k.label === 'STOPP' ? 'hold' : null },
    { t: 'Die Bombe hat mindestens 3 Batterien: <b>kurz drücken</b>.', f: (k, b) => b.batteries >= 3 ? 'tap' : null },
    { t: 'Der Knopf heißt <b>DRÜCKEN</b>: gedrückt <b>halten</b>.', f: (k) => k.label === 'DRÜCKEN' ? 'hold' : null },
    { t: 'In allen anderen Fällen: <b>kurz drücken</b>.', f: () => 'tap' }
  ];
  const BUTTON_C = [
    { t: 'Ein <b>gelber</b> Knopf mit der Aufschrift <b>DRÜCKEN</b>: <b>kurz drücken</b>.', f: (k) => k.color === 'gelb' && k.label === 'DRÜCKEN' ? 'tap' : null },
    { t: 'Ein <b>blauer</b> Knopf und die Seriennummer endet mit einer <b>geraden</b> Ziffer: gedrückt <b>halten</b>.', f: (k, b) => k.color === 'blau' && !lastDigitOdd(b) ? 'hold' : null },
    { t: 'Der Knopf heißt <b>HALTEN</b>: gedrückt <b>halten</b>.', f: (k) => k.label === 'HALTEN' ? 'hold' : null },
    { t: 'Eine <b>leuchtende</b> Anzeige <b>NOT</b>: <b>kurz drücken</b>.', f: (k, b) => lit(b, 'NOT') ? 'tap' : null },
    { t: 'Ein <b>roter</b> Knopf: gedrückt <b>halten</b>.', f: (k) => k.color === 'rot' ? 'hold' : null },
    { t: 'Die Bombe hat mindestens 2 Batterien: <b>kurz drücken</b>.', f: (k, b) => b.batteries >= 2 ? 'tap' : null },
    { t: 'In allen anderen Fällen: gedrückt <b>halten</b>.', f: () => 'hold' }
  ];
  const BUTTON_SETS = [BUTTON, BUTTON_B, BUTTON_C];
  const BUTTON_LABELS = ['DRÜCKEN', 'HALTEN', 'STOPP', 'ZÜNDEN', 'ABBRUCH', 'LOS'];
  const STRIP = { blau: 4, gelb: 5, rot: 3, weiss: 1 };
  function buttonAnswer(k, b, set) { for (const r of BUTTON_SETS[set || 0]) { const x = r.f(k, b); if (x) return x; } return 'hold'; }

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
  const simonMap = (b, strikes, table) => (table || SIMON)[hasVowel(b) ? 'vokal' : 'ohne'][Math.min(2, strikes)];
  const SYM_COUNT = 41;   // so viele Symbole gibt es insgesamt (Bilder in bombe.html)

  /* ---------- Passwort ---------- */
  const WORDS = ['ABEND', 'ADLER', 'ANGEL', 'APFEL', 'BIRNE', 'BLATT', 'BLUME', 'BRIEF', 'DACHS', 'DAMPF', 'EIMER', 'ENGEL', 'FEDER', 'FISCH', 'FLOSS',
    'GABEL', 'GEIST', 'HONIG', 'INSEL', 'KABEL', 'KERZE', 'KLANG', 'KRONE', 'LAMPE', 'LICHT', 'MAUER', 'NEBEL', 'PALME', 'PILOT', 'REGEN',
    'SALAT', 'SCHAL', 'TIGER', 'WOLKE', 'ZEBRA'];
  // großer Wortvorrat: jedes Handbuch zeigt eine zufällige Auswahl daraus
  const WORD_POOL = [...new Set(WORDS.concat(('ACKER AMPEL ANKER BAUCH BESEN BIBER BLITZ BODEN BOGEN BRETT DECKE EICHE ERBSE FALKE FARBE FEUER FIBEL FLUSS FUCHS ' +
    'GURKE HAFEN JACKE KAMEL KANAL KARTE KATZE KEGEL KISTE KLEID KNOPF KREBS KUGEL LACHS LINSE MAPPE MARKT MEISE MOTOR MUSIK NADEL NAGEL NUDEL OLIVE ONKEL ' +
    'PAKET PFERD PIZZA PLATZ PUPPE QUARK RADIO REGAL RIESE ROBBE SAITE SCHAF SEIFE SOCKE SONNE SPIEL STADT STERN STOCK STROM STURM TAFEL TANTE TASSE ' +
    'TISCH TONNE TRAUM VOGEL WAGEN WALZE WANNE WEIDE WIESE WURST ZANGE ZWERG ZIEGE BALKEN BANDE BIENE BOHNE BURGEN DOLCH DRAHT EBENE FALTE FELGE ' +
    'FLOTTE FROSCH GEIGE GLOBUS HAKEN HERDE HIRSE HUMOR KAKAO KANNE KELLE KITTEL KOHLE KRAFT KREIS KURVE LANZE LATTE LEDER MANGO MASKE ' +
    'NASHORN NOTIZ ORGEL PANDA PERLE PFEIL PINSEL POKAL PRINZ RINDE RUDER SCHUH SENSE SIEGEL SPATZ SPECK STAUB STIER STUHL ' +
    'TAUBE TEICH THRON TORTE TULPE VILLA WACHS WAFFEL WELLE WESPE WINDE ZIMMER ZUNGE').split(' ')).filter(w => w.length === 5))];

  /* ---------- Anzeigen auf dem Gehäuse ---------- */
  const LABELS = ['TAU', 'ROT', 'LUX', 'KFZ', 'ZUG', 'NOT', 'BOX', 'SOS'];

  const MODULES = {
    kabel: 'Kabel', knopf: 'Der Knopf', symbole: 'Symbole', farben: 'Farben-Echo', wort: 'Passwort',
    labyrinth: 'Labyrinth', morse: 'Morse-Licht', drehschalter: 'Drehschalter', tastenfeld: 'Tastenfeld', kabelsalat: 'Kabelsalat', ventil: 'Druckventil'
  };

  /* ---------- Labyrinth ---------- */
  const MAZE_N = 6, WALL = { u: 1, r: 2, d: 4, l: 8 }, DIRS = { u: [-1, 0], r: [0, 1], d: [1, 0], l: [0, -1] };   // Bits = offene Seiten

  /* ---------- Morse ---------- */
  const MORSE = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--',
    N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..' };
  const morseOf = w => [...w].map(ch => MORSE[ch]).join(' ');

  /* ---------- Drehschalter ---------- */
  const digitsOf = b => [...b.serial].filter(c => /\d/.test(c)).map(Number);
  const DIAL_PROPS = {
    bat: { t: 'Anzahl der Batterien', f: b => b.batteries },
    last: { t: 'letzte Ziffer der Seriennummer', f: b => +b.serial[b.serial.length - 1] },
    first: { t: 'erste Ziffer der Seriennummer', f: b => digitsOf(b)[0] },
    letters: { t: 'Anzahl Buchstaben in der Seriennummer', f: b => [...b.serial].filter(c => /[A-Z]/.test(c)).length },
    digits: { t: 'Anzahl Ziffern in der Seriennummer', f: b => digitsOf(b).length },
    lit: { t: 'Anzahl leuchtender Anzeigen', f: b => b.indicators.filter(i => i.lit).length },
    ind: { t: 'Anzahl aller Anzeigen', f: b => b.indicators.length },
    sum: { t: 'Summe aller Ziffern der Seriennummer', f: b => digitsOf(b).reduce((a, x) => a + x, 0) }
  };
  const dialValue = (rule, b) => (DIAL_PROPS[rule.p].f(b) + rule.add) % 10;
  const dialText = rule => DIAL_PROPS[rule.p].t + (rule.add ? ' + ' + rule.add : '');

  /* ---------- Tastenfeld ---------- */
  // Regel einer Stufe: pos = Position, lab = Beschriftung, samePos/sameLab = wie in einer früheren Stufe
  const memText = x => x.t === 'pos' ? 'Drückt die Taste an <b>Position ' + x.k + '</b>.' : x.t === 'lab' ? 'Drückt die Taste mit der <b>Zahl ' + x.k + '</b>.' :
    x.t === 'samePos' ? 'Drückt die Taste an <b>derselben Position</b> wie in Stufe ' + x.s + '.' : 'Drückt die Taste mit <b>derselben Zahl</b> wie in Stufe ' + x.s + '.';
  function memAnswer(x, labels, hist) {   // liefert die richtige Position (0–3)
    if (x.t === 'pos') return x.k - 1;
    if (x.t === 'lab') return labels.indexOf(x.k);
    if (x.t === 'samePos') return hist[x.s - 1].pos;
    return labels.indexOf(hist[x.s - 1].lab);
  }

  /* ---------- Kabelsalat ---------- */
  const SALAT_COLORS = { weiss: 'Weiß', rot: 'Rot', blau: 'Blau', rotblau: 'Rot-blau gestreift' };
  const SALAT_LETTERS = {
    S: { t: 'Schneiden.', f: () => true },
    N: { t: 'Nicht schneiden.', f: () => false },
    G: { t: 'Schneiden, wenn die letzte Ziffer der Seriennummer <b>gerade</b> ist.', f: b => !lastDigitOdd(b) },
    B: { t: 'Schneiden, wenn die Bombe <b>mindestens 2 Batterien</b> hat.', f: b => b.batteries >= 2 },
    A: { t: 'Schneiden, wenn mindestens eine Anzeige <b>leuchtet</b>.', f: b => b.indicators.some(i => i.lit) }
  };
  const salatKey = w => w.color + (w.star ? '*' : '') + (w.led ? '!' : '');
  const salatCut = (w, table, b) => SALAT_LETTERS[table[salatKey(w)]].f(b);

  /* ---------- Druckventil ---------- */
  const VENT_CODES = ['ALPHA', 'BRAVO', 'DELTA', 'ECHO', 'GOLF', 'KILO', 'LIMA', 'OSKAR', 'TANGO', 'ZULU', 'NORD', 'SIGMA'];

  const R = { MAZE_N, WALL, DIRS, MORSE, morseOf, DIAL_PROPS, dialValue, dialText, memText, memAnswer, SALAT_COLORS, SALAT_LETTERS, salatKey, salatCut, VENT_CODES, COLORS, ORD, WIRES, WIRE_SETS, wireAnswer, BUTTON, BUTTON_SETS, BUTTON_LABELS, STRIP, buttonAnswer, SYM_COLS, SYM_COUNT, SIMON_COLORS, SIMON, simonMap, WORDS, WORD_POOL, LABELS, MODULES, hasVowel, lastDigitOdd };
  if (typeof module !== 'undefined' && module.exports) module.exports = R; else root.BombeRegeln = R;
})(this);
