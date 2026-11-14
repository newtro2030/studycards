// Feste Zeitzone, damit lokale Kalendertage (F08) reproduzierbar sind
process.env.TZ = 'Europe/Berlin';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../pomodoro.js');

const MIN = 60 * 1000;
const STD = P.activeProfile(P.defaultSettings());
const T0 = new Date(2026, 10, 14, 9, 0, 0).getTime(); // 14.11.2026, 09:00 lokal

let idCounter = 0;
const nextId = () => `s${++idCounter}`;

// Lernphase starten und regulär (pünktlich) ablaufen lassen
function runWork(state, now, profile = STD) {
  const started = P.start(state, { now, profile, id: nextId(), topic: 'Test' }).state;
  return P.tick(started, { now: started.endsAt, profile });
}

function runBreak(state, now, profile = STD) {
  const started = P.start(state, { now, profile }).state;
  return P.tick(started, { now: started.endsAt, profile });
}

// ----- F01 Zeitprofile -----

test('Standardprofil ist 25/5/15 mit langer Pause nach 4 Einheiten', () => {
  assert.deepEqual(STD, { work: 25, shortBreak: 5, longBreak: 15, longBreakAfter: 4 });
  assert.equal(P.remainingMs(P.createInitialState(), T0, STD), 25 * MIN);
});

test('eigenes Profil 50/10/20/3 wird angenommen, Wechsel erhält eigene Werte', () => {
  const check = P.validateProfile({ work: '50', shortBreak: '10', longBreak: '20', longBreakAfter: '3' });
  assert.equal(check.ok, true);
  const settings = { ...P.defaultSettings(), activeProfile: 'custom', custom: check.value };
  assert.deepEqual(P.activeProfile(settings), { work: 50, shortBreak: 10, longBreak: 20, longBreakAfter: 3 });
  const back = { ...settings, activeProfile: 'standard' };
  assert.deepEqual(P.activeProfile(back), STD);
  assert.deepEqual(back.custom, check.value);
});

test('0, leere, zu große und nicht ganzzahlige Werte werden abgelehnt', () => {
  const base = { work: 25, shortBreak: 5, longBreak: 15, longBreakAfter: 4 };
  for (const [field, bad] of [['work', 0], ['work', ''], ['work', 181], ['shortBreak', 61], ['longBreak', '2.5'], ['longBreakAfter', 1], ['longBreakAfter', 9], ['work', 'abc']]) {
    const res = P.validateProfile({ ...base, [field]: bad });
    assert.equal(res.ok, false, `${field}=${bad}`);
    assert.ok(res.errors[field], `Hinweis für ${field}`);
  }
  assert.equal(P.validateProfile({ work: 180, shortBreak: 60, longBreak: 60, longBreakAfter: 8 }).ok, true);
  assert.equal(P.validateProfile({ work: 1, shortBreak: 1, longBreak: 1, longBreakAfter: 2 }).ok, true);
});

// ----- F02 Timer steuern -----

test('Pausieren hält die Restzeit fest, Fortsetzen beginnt mit dieser Restzeit', () => {
  let s = P.start(P.createInitialState(), { now: T0, profile: STD, id: nextId() }).state;
  s = P.pause(s, { now: T0 + 10 * MIN }).state;
  assert.equal(P.remainingMs(s, T0 + 60 * MIN), 15 * MIN); // bleibt stehen
  s = P.resume(s, { now: T0 + 60 * MIN }).state;
  assert.equal(P.remainingMs(s, T0 + 61 * MIN), 14 * MIN);
  assert.equal(s.endsAt, T0 + 75 * MIN);
});

test('Einstellungsänderung verändert die laufende Phase nicht', () => {
  const s = P.start(P.createInitialState(), { now: T0, profile: STD, id: nextId() }).state;
  const custom = { work: 50, shortBreak: 10, longBreak: 20, longBreakAfter: 3 };
  assert.equal(P.remainingMs(s, T0 + MIN, custom), 24 * MIN);
  assert.equal(P.tick(s, { now: T0 + 24 * MIN, profile: custom }).state.status, 'running'); // nicht nach 50 min
  const done = P.tick(s, { now: T0 + 25 * MIN, profile: custom });
  assert.equal(done.session.learnedMs, 25 * MIN);
});

test('Zurücksetzen einer begonnenen Lernphase protokolliert einen Abbruch', () => {
  let s = P.start(P.createInitialState(), { now: T0, profile: STD, id: 'abbruch', topic: 'BI' }).state;
  const res = P.reset(s, { now: T0 + 10 * MIN });
  assert.equal(res.state.status, 'idle');
  assert.equal(res.state.phase, 'work');
  assert.equal(P.remainingMs(res.state, T0, STD), 25 * MIN);
  assert.equal(res.session.status, 'aborted');
  assert.equal(res.session.learnedMs, 10 * MIN);
  assert.equal(res.session.topic, 'BI');
});

test('nicht gestartete Phase und Pausen erzeugen beim Zurücksetzen keinen Eintrag', () => {
  assert.equal(P.reset(P.createInitialState(), { now: T0 }).session, undefined);
  const brk = P.start({ ...P.createInitialState(), phase: 'shortBreak' }, { now: T0, profile: STD }).state;
  assert.equal(P.reset(brk, { now: T0 + MIN }).session, null);
});

test('Lernthema wird auf 100 Zeichen begrenzt', () => {
  const s = P.start(P.createInitialState(), { now: T0, profile: STD, id: nextId(), topic: '  ' + 'x'.repeat(150) }).state;
  assert.equal(s.topic.length, 100);
});

// ----- F03 Pausenfolge -----

test('nach 4 Lerneinheiten folgt die lange Pause, danach beginnt der Zyklus neu', () => {
  let s = P.createInitialState();
  let now = T0;
  for (let i = 1; i <= 4; i++) {
    const r = runWork(s, now);
    s = r.state;
    now = r.session.endedAt;
    assert.equal(s.completedInCycle, i);
    assert.equal(s.phase, i < 4 ? 'shortBreak' : 'longBreak');
    assert.equal(s.status, 'idle'); // nächste Phase wartet auf Start
    if (i < 4) {
      s = runBreak(s, now).state;
      now += 5 * MIN;
      assert.equal(s.phase, 'work');
    }
  }
  s = runBreak(s, now).state;
  assert.equal(s.phase, 'work');
  assert.equal(s.completedInCycle, 0);
});

test('lange Pause überspringen setzt den Zyklus ebenfalls zurück, ohne Lerneinheit', () => {
  const s = { ...P.createInitialState(), phase: 'longBreak', completedInCycle: 4 };
  const res = P.skipBreak(s);
  assert.equal(res.state.phase, 'work');
  assert.equal(res.state.completedInCycle, 0);
  assert.equal(res.session, undefined);
  assert.equal(P.skipBreak({ ...P.createInitialState(), phase: 'shortBreak', completedInCycle: 2 }).state.completedInCycle, 2);
});

test('Abbruch erhöht den Zykluszähler nicht', () => {
  const s = P.start(P.createInitialState(), { now: T0, profile: STD, id: nextId() }).state;
  assert.equal(P.reset(s, { now: T0 + MIN }).state.completedInCycle, 0);
});

test('Zyklus lässt sich nur ohne aktive Phase neu beginnen', () => {
  const idle = { ...P.createInitialState(), phase: 'shortBreak', completedInCycle: 2 };
  assert.deepEqual([P.restartCycle(idle).state.phase, P.restartCycle(idle).state.completedInCycle], ['work', 0]);
  const running = P.start(P.createInitialState(), { now: T0, profile: STD, id: nextId() }).state;
  assert.equal(P.restartCycle(running).error, 'not-idle');
});

test('eigenes Profil mit 3 Einheiten schlägt nach der dritten die lange Pause vor', () => {
  const custom = { work: 50, shortBreak: 10, longBreak: 20, longBreakAfter: 3 };
  const s = runWork({ ...P.createInitialState(), completedInCycle: 2 }, T0, custom).state;
  assert.equal(s.phase, 'longBreak');
});

// ----- F04 Zeitberechnung und Wiederaufnahme -----

test('Restzeit wird aus der Endzeit berechnet und nie negativ', () => {
  const s = P.start(P.createInitialState(), { now: T0, profile: STD, id: nextId() }).state;
  assert.equal(P.remainingMs(s, T0 + 12 * MIN + 500), 13 * MIN - 500); // z. B. nach Tabwechsel
  assert.equal(P.remainingMs(s, T0 + 99 * MIN), 0);
});

test('Ende mehr als 10 s zu spät verarbeitet → "Abschluss prüfen", blockiert den Lernstart', () => {
  const s = P.start(P.createInitialState(), { now: T0, profile: STD, id: 'spaet' }).state;
  const pünktlich = P.tick(s, { now: s.endsAt + 10 * 1000, profile: STD });
  assert.equal(pünktlich.state.status, 'idle');
  const res = P.tick(s, { now: s.endsAt + 11 * 1000, profile: STD });
  assert.equal(res.state.status, 'review');
  assert.equal(res.event.type, 'needs-review');
  assert.equal(res.session, undefined); // zählt noch nicht
  assert.equal(P.start(res.state, { now: T0, profile: STD, id: nextId() }).error, 'review-pending');
});

test('"Abgeschlossen" übernimmt die geplante Lernzeit und erhöht den Zyklus genau einmal', () => {
  const s = P.start(P.createInitialState(), { now: T0, profile: STD, id: 'pruefen' }).state;
  const review = P.tick(s, { now: s.endsAt + MIN, profile: STD }).state;
  const done = P.resolveReview(review, { outcome: 'completed', profile: STD });
  assert.equal(done.state.completedInCycle, 1);
  assert.equal(done.session.status, 'completed');
  assert.equal(done.session.learnedMs, 25 * MIN);
  assert.equal(done.session.endedAt, s.endsAt);
  assert.equal(P.resolveReview(done.state, { outcome: 'completed', profile: STD }).session, undefined);
});

test('"Abgebrochen" zählt weder als Einheit noch zum Zyklus', () => {
  const s = P.start(P.createInitialState(), { now: T0, profile: STD, id: 'weg' }).state;
  const review = P.tick(s, { now: s.endsAt + MIN, profile: STD }).state;
  const res = P.resolveReview(review, { outcome: 'aborted', profile: STD });
  assert.equal(res.state.completedInCycle, 0);
  assert.equal(res.state.phase, 'work');
  assert.equal(res.session.status, 'aborted');
});

test('Wiederherstellung: laufend, pausiert, abgelaufene Lern- und Pausenphase', () => {
  const run = P.start(P.createInitialState(), { now: T0, profile: STD, id: nextId() }).state;
  assert.equal(P.restore(run, { now: T0 + 5 * MIN, profile: STD }).state.status, 'running');

  const paused = P.pause(run, { now: T0 + 5 * MIN }).state;
  const restoredPaused = P.restore(paused, { now: T0 + 500 * MIN, profile: STD }).state;
  assert.equal(P.remainingMs(restoredPaused, T0 + 500 * MIN), 20 * MIN);

  // Lernphase beim Wiederöffnen abgelaufen → immer prüfen, auch knapp nach dem Ende
  const expiredWork = P.restore(run, { now: run.endsAt + 1000, profile: STD });
  assert.equal(expiredWork.state.status, 'review');

  // Pause beim Wiederöffnen abgelaufen → nächste Lernphase vorbereitet, nicht gestartet
  const brk = P.start({ ...P.createInitialState(), phase: 'shortBreak', completedInCycle: 1 }, { now: T0, profile: STD }).state;
  const expiredBreak = P.restore(brk, { now: T0 + 60 * MIN, profile: STD });
  assert.equal(expiredBreak.state.phase, 'work');
  assert.equal(expiredBreak.state.status, 'idle');
  assert.equal(expiredBreak.event.late, true);
});

test('Schlafen über mehrere Phasen erzeugt keine nachgeholten Einheiten', () => {
  const run = P.start(P.createInitialState(), { now: T0, profile: STD, id: nextId() }).state;
  const res = P.restore(run, { now: T0 + 8 * 60 * MIN, profile: STD });
  assert.equal(res.state.status, 'review');
  assert.equal(res.session, undefined);
  assert.equal(res.state.completedInCycle, 0);
});

// ----- F07 Protokoll, doppelte Ereignisse -----

test('wiederholte Endereignisse erzeugen genau einen Abschluss', () => {
  const s = P.start(P.createInitialState(), { now: T0, profile: STD, id: 'einmal' }).state;
  let sessions = [];
  let state = s;
  let events = 0;
  for (let i = 0; i < 3; i++) {
    const r = P.tick(state, { now: s.endsAt + 1000, profile: STD });
    state = r.state;
    if (r.event) events++;
    sessions = P.appendSession(sessions, r.session);
  }
  sessions = P.appendSession(sessions, { ...sessions[0] }); // z. B. erneut aus anderem Tab gemeldet
  assert.equal(events, 1);
  assert.equal(sessions.length, 1);
  assert.equal(state.completedInCycle, 1);
});

// ----- F08 Statistik -----

test('zwei vollständige Einheiten à 25 Minuten ergeben 2 und 50 Minuten; Abbrüche zählen nicht', () => {
  let sessions = [];
  let s = P.createInitialState();
  let r = runWork(s, T0); sessions = P.appendSession(sessions, r.session);
  r = runWork(P.skipBreak(r.state).state, T0 + 40 * MIN); sessions = P.appendSession(sessions, r.session);
  const aborted = P.reset(P.start(P.createInitialState(), { now: T0 + 90 * MIN, profile: STD, id: 'x' }).state, { now: T0 + 100 * MIN });
  sessions = P.appendSession(sessions, aborted.session);
  const stats = P.summarize(sessions, T0 + 3 * 60 * MIN);
  assert.deepEqual(stats.today, { count: 2, minutes: 50 });
  assert.deepEqual(stats.last7, { count: 2, minutes: 50 });
  assert.equal(stats.days.length, 7);
});

test('Einheit zählt zum Tag ihres geplanten Endes inkl. Unterbrechung (lokale Zeit)', () => {
  const lateEvening = new Date(2026, 10, 14, 23, 50).getTime();
  let s = P.start(P.createInitialState(), { now: lateEvening, profile: STD, id: 'mitternacht' }).state;
  s = P.pause(s, { now: lateEvening + 5 * MIN }).state;
  s = P.resume(s, { now: lateEvening + 15 * MIN }).state; // 10 min Unterbrechung
  const r = P.tick(s, { now: s.endsAt, profile: STD });
  assert.equal(P.localDayKey(r.session.endedAt), '2026-11-15');
  const stats = P.summarize([r.session], new Date(2026, 10, 15, 12).getTime());
  assert.deepEqual(stats.today, { count: 1, minutes: 25 });
  assert.equal(stats.days.find(d => d.day === '2026-11-14').count, 0);
});

test('lokaler Kalendertag weicht vom UTC-Datum ab', () => {
  const justAfterMidnight = new Date(2026, 10, 15, 0, 30).getTime(); // UTC: 14.11. 23:30
  assert.equal(P.localDayKey(justAfterMidnight), '2026-11-15');
  assert.equal(new Date(justAfterMidnight).toISOString().slice(0, 10), '2026-11-14');
});

test('7-Tage-Übersicht über die Zeitumstellung hinweg ohne Lücke oder Doppeltag', () => {
  const afterDst = new Date(2026, 9, 28, 12).getTime(); // Zeitumstellung am 25.10.2026
  const days = P.summarize([], afterDst).days.map(d => d.day);
  assert.deepEqual(days, ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
});

test('Einträge außerhalb der letzten 7 Tage zählen nicht; leerer Verlauf ergibt Nullen', () => {
  const old = { id: 'alt', startedAt: T0 - 9 * 24 * 60 * MIN, endedAt: T0 - 9 * 24 * 60 * MIN + 25 * MIN, plannedMs: 25 * MIN, learnedMs: 25 * MIN, status: 'completed', topic: '' };
  assert.deepEqual(P.summarize([old], T0).last7, { count: 0, minutes: 0 });
  assert.deepEqual(P.summarize([], T0).today, { count: 0, minutes: 0 });
});

// ----- F09 Speicherformat -----

test('gespeicherte Daten werden versioniert gelesen; Beschädigung wird erkannt', () => {
  const settings = P.defaultSettings();
  assert.deepEqual(P.parse('settings', P.serialize(settings)), { ok: true, value: settings });
  assert.deepEqual(P.parse('state', null), { ok: true, value: null });

  const run = P.start(P.createInitialState(), { now: T0, profile: STD, id: nextId() }).state;
  assert.equal(P.parse('state', P.serialize(run)).ok, true);

  for (const [kind, raw] of [
    ['settings', '{kaputt'],
    ['settings', JSON.stringify({ version: 99, data: settings })],
    ['settings', P.serialize({ ...settings, custom: { ...settings.custom, work: 0 } })],
    ['state', P.serialize({ ...run, endsAt: 'morgen' })],
    ['sessions', P.serialize([{ id: 1 }])],
  ]) {
    assert.deepEqual(P.parse(kind, raw), { ok: false, corrupt: true }, raw);
  }
});

test('eigene Speicherschlüssel getrennt von den Kartendaten', () => {
  assert.deepEqual(P.STORAGE_KEYS, { settings: 'sc_pomodoro_settings', state: 'sc_pomodoro_state', sessions: 'sc_pomodoro_sessions' });
});

// ----- F05/F06 Ton- und Mitteilungseinstellungen -----

test('Standardton ist eingeschaltet, 50 %, Mitteilungen aus; mindestens zwei Töne', () => {
  const s = P.defaultSettings();
  assert.deepEqual(s.sound, { enabled: true, tone: 'chime', volume: 50 });
  assert.equal(s.notifications, false);
  assert.ok(P.TONES.length >= 2);
});

test('Toneinstellungen werden geprüft; ältere Einstellungen ohne Mitteilungsfeld bleiben gültig', () => {
  const s = P.defaultSettings();
  const { notifications, ...old } = s;
  assert.equal(P.parse('settings', P.serialize(old)).ok, true);
  for (const bad of [
    { ...s, sound: { ...s.sound, volume: 101 } },
    { ...s, sound: { ...s.sound, volume: -1 } },
    { ...s, sound: { ...s.sound, tone: 'sirene' } },
    { ...s, notifications: 'ja' },
  ]) {
    assert.deepEqual(P.parse('settings', P.serialize(bad)), { ok: false, corrupt: true });
  }
  for (const tone of P.TONES) {
    assert.equal(P.parse('settings', P.serialize({ ...s, sound: { enabled: false, tone, volume: 0 } })).ok, true);
  }
});
