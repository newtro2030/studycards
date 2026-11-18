process.env.TZ = 'Europe/Berlin';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../goals.js');

const TODAY = '2026-11-18';

function goal(overrides = {}) {
  const res = G.validateGoal({
    name: 'Mathearbeit Brüche', folder: 'Mathe', topics: [], examDate: '2026-12-04',
    scale: 'school', grade: '2', ...overrides,
  }, { today: TODAY, id: 'g1' });
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  return res.value;
}

const card = (id, ...tags) => ({ id, tags });

// ----- Datum -----

test('Datumshilfen rechnen in Kalendertagen, auch über die Zeitumstellung', () => {
  assert.equal(G.addDays('2026-10-24', 2), '2026-10-26'); // Umstellung 25.10.
  assert.equal(G.daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.equal(G.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(G.isDateKey('2026-02-30'), false);
  assert.equal(G.isDateKey('2026-02-28'), true);
});

// ----- Z1 Anlegen -----

test('Ziel mit Wunschnote bekommt die passende Zielmarke und 2 Puffertage', () => {
  const g = goal();
  assert.equal(g.targetPercent, 81);
  assert.equal(g.bufferDays, 2);
  assert.deepEqual(g.reached, []);
  assert.equal(g.archived, null);
});

test('Eingaben werden geprüft', () => {
  const res = G.validateGoal({ name: ' ', folder: 'Mathe', topics: ['Englisch/Unit-1'], examDate: TODAY, scale: 'x' }, { today: TODAY });
  assert.equal(res.ok, false);
  assert.ok(res.errors.name && res.errors.topics && res.errors.examDate && res.errors.scale);
  const long = G.validateGoal({ name: 'x'.repeat(61), folder: 'Mathe', examDate: '2026-12-01', scale: 'school', grade: '1' }, { today: TODAY });
  assert.ok(long.errors.name);
});

test('Zielmarke kann die Note überschreiben; ohne beides gibt es einen Hinweis', () => {
  assert.equal(goal({ targetPercent: '70' }).targetPercent, 70);
  const none = G.validateGoal({ name: 'A', folder: 'Mathe', examDate: '2026-12-01', scale: 'school' }, { today: TODAY });
  assert.ok(none.errors.targetPercent);
  const bad = G.validateGoal({ name: 'A', folder: 'Mathe', examDate: '2026-12-01', scale: 'school', targetPercent: '5' }, { today: TODAY });
  assert.ok(bad.errors.targetPercent);
});

test('Puffertage 0–14, ganze Zahlen', () => {
  assert.equal(goal({ bufferDays: '0' }).bufferDays, 0);
  const bad = G.validateGoal({ name: 'A', folder: 'Mathe', examDate: '2026-12-01', scale: 'school', grade: '1', bufferDays: '15' }, { today: TODAY });
  assert.ok(bad.errors.bufferDays);
});

// ----- Z3 Notenschlüssel -----

test('Notenschlüssel Schule und Studium', () => {
  assert.equal(G.targetForGrade('school', '1'), 92);
  assert.equal(G.targetForGrade('school', '4'), 50);
  assert.equal(G.targetForGrade('school', '5'), null);
  assert.equal(G.targetForGrade('uni', '1,3'), 92);
  assert.equal(G.targetForGrade('uni', '2,3'), 81);
  assert.equal(G.targetForGrade('uni', '3,0'), 67);
  assert.equal(G.targetForGrade('uni', '4,0'), 50);
  const bad = G.validateGoal({ name: 'A', folder: 'Mathe', examDate: '2026-12-01', scale: 'uni', grade: '2' }, { today: TODAY });
  assert.ok(bad.errors.grade);
});

// ----- Kartenumfang -----

test('Ziel umfasst das Fach, optional nur gewählte Themen', () => {
  const all = goal();
  const some = goal({ topics: ['Mathe/Brüche'] });
  const cards = [card('a', 'Mathe/Brüche'), card('b', 'Mathe/Geometrie'), card('c', 'Englisch/Unit-1'), card('d')];
  assert.deepEqual(G.goalCards(all, cards).map(c => c.id), ['a', 'b']);
  assert.deepEqual(G.goalCards(some, cards).map(c => c.id), ['a']);
});

test('Studium: Ordner Semester, Thema Fach', () => {
  const g = goal({ folder: 'Semester-5', topics: ['Semester-5/Projektmanagement'], scale: 'uni', grade: '1,7' });
  assert.equal(G.cardMatches(g, card('x', 'Semester-5/Projektmanagement')), true);
  assert.equal(G.cardMatches(g, card('y', 'Semester-4/Projektmanagement')), false);
});

test('Karten ohne Ordner ("Allgemein") sind wählbar', () => {
  const g = goal({ folder: '', topics: ['Englisch'] });
  assert.equal(G.cardMatches(g, card('x', 'Englisch')), true);
  assert.equal(G.cardMatches(g, card('y', 'Mathe/Brüche')), false);
});

// ----- Z3 Wissensstand -----

test('Sicher = letzte Antwort mind. "Gut" und Abstand ≥ 3 Tage', () => {
  assert.equal(G.isSecure({ interval: 6, repetitions: 2, lastQuality: 4 }), true);
  assert.equal(G.isSecure({ interval: 6, repetitions: 2, lastQuality: 3 }), false); // "Schwer"
  assert.equal(G.isSecure({ interval: 1, repetitions: 1, lastQuality: 5 }), false);
  assert.equal(G.isSecure({ interval: 1, repetitions: 0, lastQuality: 1 }), false);
  assert.equal(G.isSecure({ interval: 6, repetitions: 2 }), true); // alter Stand ohne lastQuality
  assert.equal(G.isSecure(undefined), false);
});

test('Wissensstand in Prozent (abgerundet), neue Karten gezählt', () => {
  const g = goal();
  const cards = [card('a', 'Mathe/Brüche'), card('b', 'Mathe/Brüche'), card('c', 'Mathe/Brüche'), card('z', 'Englisch/U')];
  const states = { a: { interval: 6, repetitions: 2, lastQuality: 4 }, b: { interval: 1, repetitions: 1, lastQuality: 4 }, z: { interval: 9, repetitions: 3 } };
  assert.deepEqual(G.knowledge(g, cards, states), { total: 3, secure: 1, newCount: 1, percent: 33 });
  assert.equal(G.knowledge(g, [], {}).percent, 0);
});

// ----- Phase, Countdown, Z2 Tagesplan -----

test('Phasen: lernen → Puffer → Prüfungstag → vorbei', () => {
  const g = goal(); // Prüfung 04.12., Puffer 02.–03.12.
  assert.equal(G.lastLearnDay(g), '2026-12-01');
  assert.equal(G.phase(g, '2026-12-01'), 'learn');
  assert.equal(G.phase(g, '2026-12-02'), 'buffer');
  assert.equal(G.phase(g, '2026-12-04'), 'exam');
  assert.equal(G.phase(g, '2026-12-05'), 'over');
  assert.equal(G.daysLeft(g, TODAY), 16);
});

test('Tagesplan verteilt neue Karten auf die Lerntage', () => {
  const g = goal(); // Lerntage 18.11.–01.12. = 14
  const plan = G.dailyPlan(g, { newCount: 140, today: TODAY });
  assert.equal(plan.learnDays, 14);
  assert.equal(plan.quota, 10);
  assert.equal(plan.remainingToday, 10);
  assert.equal(plan.tight, false);
});

test('Tagesplan bleibt über den Tag stabil', () => {
  const g = goal();
  const plan = G.dailyPlan(g, { newCount: 134, learnedToday: 6, today: TODAY });
  assert.equal(plan.quota, 10);
  assert.equal(plan.remainingToday, 4);
});

test('Am letzten Lerntag kommen alle restlichen Karten, gedeckelt auf 60', () => {
  const g = goal();
  assert.equal(G.dailyPlan(g, { newCount: 15, today: '2026-12-01' }).quota, 15);
  const tight = G.dailyPlan(g, { newCount: 200, today: '2026-12-01' });
  assert.equal(tight.quota, 60);
  assert.equal(tight.tight, true);
});

test('Puffertage: keine neuen Karten, wenn alles gelernt ist', () => {
  const plan = G.dailyPlan(goal(), { newCount: 0, today: '2026-12-02' });
  assert.equal(plan.phase, 'buffer');
  assert.equal(plan.quota, 0);
  assert.equal(plan.catchUp, false);
});

test('Puffertage und Prüfungstag: nie gelernte Karten werden nachgeholt', () => {
  const plan = G.dailyPlan(goal(), { newCount: 30, today: '2026-12-02' });
  assert.equal(plan.catchUp, true);
  assert.equal(plan.quota, 30);
  assert.equal(plan.remainingToday, 30);
  const late = G.dailyPlan(goal(), { newCount: 80, learnedToday: 10, today: '2026-12-04' });
  assert.equal(late.phase, 'exam');
  assert.equal(late.remainingToday, 50); // 60 pro Tag, 10 schon gelernt
  assert.equal(late.tight, true);
  assert.equal(G.dailyPlan(goal(), { newCount: 30, today: '2026-12-05' }).quota, 0); // vorbei
});

test('Ohne Puffer ist der Vortag der letzte Lerntag', () => {
  const g = goal({ bufferDays: 0 });
  assert.equal(G.dailyPlan(g, { newCount: 5, today: '2026-12-03' }).quota, 5);
  assert.equal(G.phase(g, '2026-12-04'), 'exam');
});

// ----- Z4 Prüfungsmodus -----

const st = (nextReview, lastReview) => ({ nextReview, lastReview });

test('Termin nach der Prüfung wird auf den Vortag vorgezogen', () => {
  const g = goal(); // Prüfung 04.12.
  const c = card('a', 'Mathe/Brüche');
  assert.equal(G.effectiveDue(st('2026-12-20', TODAY), c, [g], TODAY), '2026-12-03');
  assert.equal(G.effectiveDue(st('2026-11-25', TODAY), c, [g], TODAY), '2026-11-25');
  assert.equal(G.effectiveDue(st('2026-12-20', TODAY), card('e', 'Englisch/U'), [g], TODAY), '2026-12-20');
});

test('Am Vortag wiederholt → nicht erneut vorgezogen (keine Endlosschleife)', () => {
  const c = card('a', 'Mathe/Brüche');
  assert.equal(G.effectiveDue(st('2026-12-09', '2026-12-03'), c, [goal()], '2026-12-03'), '2026-12-09');
});

test('Auch alte Termine von vor dem Ziel werden vorgezogen', () => {
  const c = card('a', 'Mathe/Brüche');
  assert.equal(G.effectiveDue(st('2027-02-01', '2026-10-01'), c, [goal()], TODAY), '2026-12-03');
});

test('Frühere Prüfung gewinnt; archivierte, vergangene und heutige Prüfungen ziehen nicht vor', () => {
  const c = card('a', 'Mathe/Brüche');
  const early = goal({ examDate: '2026-11-28' });
  const late = goal({ examDate: '2026-12-10' });
  assert.equal(G.effectiveDue(st('2027-01-01', TODAY), c, [late, early], TODAY), '2026-11-27');
  const archived = { ...early, archived: { on: TODAY, finalPercent: 80, actualGrade: null } };
  assert.equal(G.effectiveDue(st('2027-01-01', TODAY), c, [archived], TODAY), '2027-01-01');
  assert.equal(G.effectiveDue(st('2027-01-01', '2026-12-01'), c, [goal()], '2026-12-04'), '2027-01-01'); // Prüfungstag
  assert.equal(G.effectiveDue(st('2027-01-01', '2026-12-01'), c, [goal()], '2026-12-05'), '2027-01-01'); // vorbei
});

// ----- Z5 Meilensteine -----

test('Meilensteine werden je einmal gemeldet, Ziel zuletzt', () => {
  let g = goal(); // Ziel 81 %
  assert.deepEqual(G.newMilestones(g, 10), []);
  assert.deepEqual(G.newMilestones(g, 52), [25, 50]);
  g = G.markReached(g, [25, 50]);
  assert.deepEqual(G.newMilestones(g, 60), []);
  assert.deepEqual(G.newMilestones(g, 85), [75, 'target']);
  g = G.markReached(g, [75, 'target']);
  assert.deepEqual(G.newMilestones(g, 100), []);
});

test('Meilensteine über der Zielmarke entfallen', () => {
  const g = goal({ grade: '4' }); // 50 %
  assert.deepEqual(G.newMilestones(g, 55), [25, 'target']);
});

// ----- Z6 Archiv -----

test('Am Tag nach der Prüfung wird archiviert', () => {
  const g = goal();
  assert.equal(G.shouldArchive(g, '2026-12-04'), false);
  assert.equal(G.shouldArchive(g, '2026-12-05'), true);
  const a = G.archive(g, { today: '2026-12-05', finalPercent: 84 });
  assert.deepEqual(a.archived, { on: '2026-12-05', finalPercent: 84, actualGrade: null });
  assert.equal(G.shouldArchive(a, '2026-12-06'), false);
  assert.equal(G.archive(a, { today: '2026-12-09', finalPercent: 1 }), a);
});

// ----- Z7 Speichern -----

test('Speichern und Laden, unbekannte Felder entfallen', () => {
  const g = { ...goal(), extra: 'weg' };
  const res = G.parse(G.serialize([g]));
  assert.equal(res.ok, true);
  assert.equal(res.value.length, 1);
  assert.equal(res.value[0].extra, undefined);
  assert.equal(res.value[0].targetPercent, 81);
});

test('Vergangene und archivierte Ziele bleiben ladbar', () => {
  const a = G.archive(goal({ examDate: '2026-11-20' }), { today: '2026-11-21', finalPercent: 90 });
  const res = G.parse(G.serialize([a]));
  assert.equal(res.ok, true);
  assert.equal(res.value[0].archived.finalPercent, 90);
});

test('Fehlende Daten → leere Liste; kaputte Daten werden erkannt', () => {
  assert.deepEqual(G.parse(null), { ok: true, value: [] });
  assert.deepEqual(G.parse('{kaputt'), { ok: false, corrupt: true });
  assert.deepEqual(G.parse(JSON.stringify({ version: 99, data: [] })), { ok: false, corrupt: true });
  assert.deepEqual(G.parse(G.serialize([{ ...goal(), id: '' }])), { ok: false, corrupt: true });
  assert.deepEqual(G.parse(G.serialize([{ ...goal(), reached: [33] }])), { ok: false, corrupt: true });
});
