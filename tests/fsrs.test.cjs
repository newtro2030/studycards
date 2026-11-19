process.env.TZ = 'Europe/Berlin';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../fsrs.js');

const TODAY = '2026-11-19';
const near = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≠ ${expected}`);
const nearMem = (m, d, s) => { near(m.difficulty, d); near(m.stability, s); };

// Referenzwerte: mit dem Originalcode von ts-fsrs (FSRS-6, Standardparameter) berechnet.

// ----- FSRS-6-Kern -----

test('Erste Bewertung: Startwerte für Nochmal, Schwer, Gut, Einfach', () => {
  nearMem(F.nextMemory(null, 0, 1), 6.4133, 0.212);
  nearMem(F.nextMemory(null, 0, 2), 5.11217071, 1.2931);
  nearMem(F.nextMemory(null, 0, 3), 2.11810397, 2.3065);
  nearMem(F.nextMemory(null, 0, 4), 1, 8.2956); // Schwierigkeit unten auf 1 begrenzt
});

test('Verlauf Gut, Gut, Gut, vergessen, Gut entspricht ts-fsrs', () => {
  const steps = [
    [0, 3, 2.11810397, 2.3065, 2],
    [2, 3, 2.11121424, 10.96433194, 11],
    [11, 3, 2.1043314, 46.28021494, 46],
    [46, 1, 7.38997579, 2.93258041, 3],
    [1, 3, 7.37781418, 4.95988255, 5],
  ];
  let mem = null;
  for (const [t, g, d, s, ivl] of steps) {
    mem = F.nextMemory(mem, t, g);
    nearMem(mem, d, s);
    assert.equal(F.nextInterval(mem.stability, 0.9), ivl);
  }
});

test('Gleicher Tag (t = 0) nutzt die Kurzzeitformel', () => {
  const start = F.nextMemory(null, 0, 3);
  nearMem(F.nextMemory(start, 0, 1), 7.39450274, 0.77508398);
  nearMem(F.nextMemory(start, 0, 2), 4.75285849, 2.3065); // bei Schwer/Gut nie kleiner
  nearMem(F.nextMemory(start, 0, 3), 2.11121424, 2.3065);
  nearMem(F.nextMemory(start, 0, 4), 1, 3.94605407);
});

test('Nach 5 Tagen ab S = 10, D = 5: alle vier Noten', () => {
  const m = { stability: 10, difficulty: 5 };
  nearMem(F.nextMemory(m, 5, 1), 8.34176237, 1.30243125);
  nearMem(F.nextMemory(m, 5, 2), 6.66599536, 17.77531755);
  nearMem(F.nextMemory(m, 5, 3), 4.99022837, 22.92869563);
  nearMem(F.nextMemory(m, 5, 4), 3.31446137, 34.21415404);
});

test('Vergessenskurve: 100 % sofort, 90 % nach S Tagen', () => {
  near(F.forgettingCurve(0, 10), 1);
  near(F.forgettingCurve(10, 10), 0.9);
  near(F.forgettingCurve(30, 10), 0.8093881);
});

test('Abstand hängt von der Behaltensrate ab', () => {
  assert.equal(F.nextInterval(10, 0.9), 10);
  assert.equal(F.nextInterval(10, 0.8), 33);
  assert.equal(F.nextInterval(10, 0.95), 4);
  assert.equal(F.nextInterval(0.212, 0.9), 1); // mindestens 1 Tag
  assert.equal(F.nextInterval(100, 0.85), 191);
  assert.throws(() => F.nextInterval(10, 0));
  assert.throws(() => F.nextInterval(10, 1.5));
});

test('Ungültige Note wird abgelehnt', () => {
  assert.throws(() => F.nextMemory(null, 0, 0));
  assert.throws(() => F.nextMemory(null, 0, 5));
  assert.throws(() => F.review(F.defaultState(TODAY), 2, { today: TODAY }));
});

// ----- Kartenzustand und Bewertung -----

test('Neue Karte mit Gut: FSRS plant 2 Tage, Zähler und Felder stimmen', () => {
  const s = F.review(undefined, 4, { today: TODAY });
  assert.equal(s.interval, 2);
  assert.equal(s.nextReview, '2026-11-21');
  assert.equal(s.lastReview, TODAY);
  assert.equal(s.lastQuality, 4);
  assert.equal(s.totalReviews, 1);
  assert.equal(s.correctReviews, 1);
  assert.equal(s.repetitions, 1);
  assert.equal(s.lapses, 0);
  near(s.stability, 2.3065);
  near(s.difficulty, 2.11810397);
  assert.equal(s.easeFactor, 2.5); // SM-2 rechnet mit
});

test('Standard ist FSRS, SM-2 ist wählbar und rechnet wie bisher', () => {
  const fsrs = F.previewIntervals(undefined, { today: TODAY });
  assert.deepEqual(fsrs, { 1: 1, 3: 1, 4: 2, 5: 8 });
  const sm2 = F.previewIntervals(undefined, { today: TODAY, algorithm: 'sm2' });
  assert.deepEqual(sm2, { 1: 1, 3: 1, 4: 1, 5: 1 });
  // SM-2-Verlauf immer Gut: 1 → 6 → 15 → 38
  let s;
  const ivls = [];
  for (let i = 0; i < 4; i++) {
    s = F.review(s, 4, { today: TODAY, algorithm: 'sm2' });
    ivls.push(s.interval);
  }
  assert.deepEqual(ivls, [1, 6, 15, 38]);
});

test('Unbekannte Einstellungen fallen auf die Standardwerte zurück', () => {
  const a = F.previewIntervals(undefined, { today: TODAY, algorithm: 'xyz', retention: 0.5, maxInterval: -3 });
  assert.deepEqual(a, F.previewIntervals(undefined, { today: TODAY }));
  assert.throws(() => F.preview(undefined, {}));
});

test('Tage seit der letzten Wiederholung fließen ein', () => {
  const s1 = F.review(undefined, 4, { today: '2026-11-01' });
  const onTime = F.review(s1, 4, { today: '2026-11-03' }); // nach 2 Tagen, wie geplant
  near(onTime.stability, 10.96433194);
  assert.equal(onTime.interval, 11);
  assert.equal(onTime.nextReview, '2026-11-14');
  const late = F.review(s1, 4, { today: '2026-11-13' });   // später wiederholt → größerer Sprung
  assert.ok(late.stability > onTime.stability);
});

test('Nochmal: Wiederholungen auf 0, Fehler gezählt, morgen wieder', () => {
  let s = F.review(undefined, 4, { today: '2026-11-01' });
  s = F.review(s, 4, { today: '2026-11-03' });
  s = F.review(s, 1, { today: '2026-11-14' });
  assert.equal(s.repetitions, 0);
  assert.equal(s.lapses, 1);
  assert.equal(s.correctReviews, 2);
  assert.equal(s.totalReviews, 3);
  assert.ok(s.interval >= 1 && s.interval <= 3);
  // eine neue Karte mit Nochmal ist kein "Vergessen"
  assert.equal(F.review(undefined, 1, { today: TODAY }).lapses, 0);
});

test('Reihenfolge der Knöpfe: Schwer ≤ Gut < Einfach', () => {
  const states = [undefined];
  let s;
  for (const [day, q] of [['2026-11-01', 4], ['2026-11-03', 3], ['2026-11-05', 4], ['2026-12-01', 5]]) {
    s = F.review(s, q, { today: day });
    states.push(s);
  }
  for (const st of states) {
    for (const retention of F.RETENTION_OPTIONS) {
      const p = F.previewIntervals(st, { today: '2026-12-20', retention });
      assert.ok(p[3] <= p[4], `Schwer ${p[3]} > Gut ${p[4]}`);
      assert.ok(p[4] < p[5] || p[5] === F.MAX_INTERVAL, `Gut ${p[4]} ≥ Einfach ${p[5]}`); // am Deckel gleich
    }
  }
});

test('Höchstabstand 365 Tage, auch bei SM-2', () => {
  const big = { ...F.defaultState(TODAY), stability: 5000, difficulty: 1, interval: 900, repetitions: 9,
    easeFactor: 3, lastReview: '2026-01-01', totalReviews: 9, correctReviews: 9 };
  const p = F.previewIntervals(big, { today: TODAY });
  assert.equal(p[4], 365);
  assert.equal(p[5], 365);
  assert.equal(F.review(big, 4, { today: TODAY }).nextReview, '2027-11-19');
  assert.equal(F.previewIntervals(big, { today: TODAY, algorithm: 'sm2' })[4], 365);
  assert.equal(F.previewIntervals(big, { today: TODAY, maxInterval: 180 })[4], 180);
});

test('Wechsel zwischen den Verfahren verliert nichts', () => {
  let s = F.review(undefined, 4, { today: '2026-11-01' });
  s = F.review(s, 4, { today: '2026-11-03', algorithm: 'sm2' });
  assert.equal(s.interval, 6);           // SM-2 hat geplant …
  near(s.stability, 10.96433194);        // … FSRS hat trotzdem mitgerechnet
  s = F.review(s, 4, { today: '2026-11-09' });
  assert.ok(s.stability > 10.96433194);
  assert.equal(s.repetitions, 3);
  assert.equal(s.easeFactor, 2.5);
});

test('Alter SM-2-Zustand ohne FSRS-Werte: Start mit S = Abstand, D = 5', () => {
  const legacy = { easeFactor: 2.5, interval: 6, repetitions: 2, nextReview: '2026-11-07', lastReview: '2026-11-01',
    totalReviews: 2, correctReviews: 2, lastQuality: 4 };
  const s = F.review(legacy, 4, { today: '2026-11-07' });
  const expected = F.nextMemory({ stability: 6, difficulty: 5 }, 6, 3);
  near(s.stability, expected.stability);
  near(s.difficulty, expected.difficulty);
  assert.equal(s.totalReviews, 3);
  assert.equal(s.repetitions, 3);
  // ganz ohne Abstand: mindestens S = 1
  const zero = F.review({ ...legacy, interval: 0 }, 4, { today: '2026-11-07' });
  near(zero.stability, F.nextMemory({ stability: 1, difficulty: 5 }, 6, 3).stability);
});

test('Eingabezustand wird nicht verändert', () => {
  const s = F.review(undefined, 4, { today: '2026-11-01' });
  const copy = JSON.parse(JSON.stringify(s));
  F.preview(s, { today: '2026-11-05' });
  F.review(s, 1, { today: '2026-11-05' });
  assert.deepEqual(s, copy);
});

test('Abrufwahrscheinlichkeit einer Karte an einem Tag', () => {
  const s = F.review(undefined, 4, { today: '2026-11-01' }); // S ≈ 2,3
  near(F.retrievability(s, '2026-11-01'), 1);
  assert.ok(Math.abs(F.retrievability(s, '2026-11-03') - 0.9) < 0.02);
  assert.equal(F.retrievability(undefined, TODAY), null);
  assert.equal(F.retrievability({ interval: 6, lastReview: '2026-11-01' }, TODAY), null); // alter SM-2-Zustand
});

// ----- Datum -----

test('Termine in Kalendertagen, auch über Zeitumstellung und Jahreswechsel', () => {
  assert.equal(F.addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(F.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(F.daysBetween('2026-03-28', '2026-03-30'), 2);
  const s = F.review(undefined, 4, { today: '2026-10-24' });
  assert.equal(s.nextReview, '2026-10-26');
});

// ----- Protokoll (F5) -----

test('Bewertungsprotokoll: kompakte Einträge, Obergrenze, alte fallen heraus', () => {
  let log = F.appendLog(null, 'abc123', TODAY, 4);
  assert.deepEqual(log, [['abc123', TODAY, 4]]);
  log = F.appendLog(log, 'x', TODAY, 1);
  assert.equal(log.length, 2);
  let big = [];
  for (let i = 0; i < 5; i++) big = F.appendLog(big, 'c' + i, TODAY, 3, 3);
  assert.deepEqual(big.map(e => e[0]), ['c2', 'c3', 'c4']);
  const before = [['a', TODAY, 4]];
  F.appendLog(before, 'b', TODAY, 4);
  assert.equal(before.length, 1); // Eingabe bleibt unverändert
  assert.equal(F.LOG_MAX, 20000);
  assert.ok(JSON.stringify(['a1b2c3d4', TODAY, 4]).length <= 30);
});
