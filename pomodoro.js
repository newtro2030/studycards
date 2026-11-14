// ============================================================
// StudyCards - Pomodoro: Timer-Zustand, Zählregeln, Statistik
// Reine Logik ohne Oberfläche. Alle Funktionen sind seiteneffektfrei und
// bekommen die aktuelle Zeit (`now`, Epoch-ms) übergeben → testbar mit fester Uhr.
// Siehe docs/PFLICHTENHEFT_POMODORO.md (F01–F09).
// ============================================================

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; // Node-Tests
  else root.Pomodoro = api;                                               // Browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;

  const STORAGE_KEYS = {
    settings: 'sc_pomodoro_settings',
    state: 'sc_pomodoro_state',
    sessions: 'sc_pomodoro_sessions',
  };

  const MINUTE = 60 * 1000;
  const LATE_TOLERANCE_MS = 10 * 1000; // F04: später verarbeitetes Ende → "Abschluss prüfen"
  const TOPIC_MAX_LENGTH = 100;        // F07

  const PHASES = ['work', 'shortBreak', 'longBreak'];
  const STATUSES = ['idle', 'running', 'paused', 'review'];

  const LIMITS = {
    work: { min: 1, max: 180, label: 'Lernzeit' },
    shortBreak: { min: 1, max: 60, label: 'Kurze Pause' },
    longBreak: { min: 1, max: 60, label: 'Lange Pause' },
    longBreakAfter: { min: 2, max: 8, label: 'Lange Pause nach' },
  };

  const DEFAULT_PROFILE = Object.freeze({ work: 25, shortBreak: 5, longBreak: 15, longBreakAfter: 4 });

  // ===== EINSTELLUNGEN (F01) =====

  function defaultSettings() {
    return {
      version: SCHEMA_VERSION,
      activeProfile: 'standard',     // 'standard' | 'custom'
      custom: { ...DEFAULT_PROFILE }, // bleibt beim Wechsel auf "Standard" erhalten
      sound: { enabled: true, tone: 'chime', volume: 50 },
    };
  }

  function parseWholeNumber(value) {
    if (typeof value === 'number') return Number.isInteger(value) ? value : NaN;
    if (typeof value !== 'string' || !/^\s*\d+\s*$/.test(value)) return NaN;
    return parseInt(value, 10);
  }

  // Prüft ein Zeitprofil aus Formulareingaben (Strings oder Zahlen).
  // → { ok: true, value } oder { ok: false, errors: { feld: 'Hinweis' } }
  function validateProfile(input) {
    const errors = {};
    const value = {};
    for (const [field, { min, max, label }] of Object.entries(LIMITS)) {
      const raw = input ? input[field] : undefined;
      if (raw === undefined || raw === null || String(raw).trim() === '') {
        errors[field] = `${label}: bitte einen Wert eingeben.`;
        continue;
      }
      const n = parseWholeNumber(raw);
      if (Number.isNaN(n)) {
        errors[field] = `${label}: bitte ganze Zahl eingeben.`;
      } else if (n < min || n > max) {
        errors[field] = `${label}: erlaubt sind ${min} bis ${max}.`;
      } else {
        value[field] = n;
      }
    }
    return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
  }

  function activeProfile(settings) {
    if (settings && settings.activeProfile === 'custom') {
      const check = validateProfile(settings.custom);
      if (check.ok) return check.value;
    }
    return { ...DEFAULT_PROFILE };
  }

  function phaseDurationMs(profile, phase) {
    return profile[phase] * MINUTE;
  }

  // ===== TIMER-ZUSTAND (F02–F04) =====
  // phase:  aktuelle bzw. als Nächstes vorbereitete Phase
  // status: idle (bereit) · running · paused · review (Lernphase "Abschluss prüfen")
  // Die Restzeit eines laufenden Timers ergibt sich immer aus `endsAt`.

  function createInitialState() {
    return {
      version: SCHEMA_VERSION,
      phase: 'work',
      status: 'idle',
      completedInCycle: 0,
      durationMs: null,
      startedAt: null,
      endsAt: null,
      remainingMs: null,
      sessionId: null,
      topic: '',
    };
  }

  function idleIn(phase, completedInCycle) {
    return {
      ...createInitialState(),
      phase,
      completedInCycle,
    };
  }

  function isActive(state) {
    return state.status === 'running' || state.status === 'paused' || state.status === 'review';
  }

  function remainingMs(state, now, profile) {
    switch (state.status) {
      case 'running': return Math.max(0, state.endsAt - now);
      case 'paused': return Math.max(0, state.remainingMs);
      case 'review': return 0;
      default: return phaseDurationMs(profile || DEFAULT_PROFILE, state.phase);
    }
  }

  function nextAfterWork(completedInCycle, profile) {
    return completedInCycle >= profile.longBreakAfter ? 'longBreak' : 'shortBreak';
  }

  function normalizeTopic(topic) {
    return String(topic || '').trim().slice(0, TOPIC_MAX_LENGTH);
  }

  // Startet die vorbereitete Phase. Eine ungeklärte Lerneinheit blockiert den Start (F04).
  function start(state, { now, profile, id, topic }) {
    if (state.status !== 'idle') return { state, error: state.status === 'review' ? 'review-pending' : 'not-idle' };
    const durationMs = phaseDurationMs(profile, state.phase); // F01: Dauer wird beim Start festgeschrieben
    const isWork = state.phase === 'work';
    return {
      state: {
        ...state,
        status: 'running',
        durationMs,
        startedAt: now,
        endsAt: now + durationMs,
        remainingMs: null,
        sessionId: isWork ? id : null,
        topic: isWork ? normalizeTopic(topic) : '',
      },
    };
  }

  function pause(state, { now }) {
    if (state.status !== 'running') return { state };
    return { state: { ...state, status: 'paused', remainingMs: Math.max(0, state.endsAt - now), endsAt: null } };
  }

  function resume(state, { now }) {
    if (state.status !== 'paused') return { state };
    return { state: { ...state, status: 'running', endsAt: now + state.remainingMs, remainingMs: null } };
  }

  function sessionRecord(state, { status, endedAt, learnedMs }) {
    return {
      id: state.sessionId,
      startedAt: state.startedAt,
      endedAt,
      plannedMs: state.durationMs,
      learnedMs,
      status, // 'completed' | 'aborted'
      topic: state.topic,
    };
  }

  // Zurücksetzen (nach Bestätigung in der Oberfläche). Eine begonnene Lernphase
  // wird als Abbruch protokolliert; Pausen und nicht gestartete Phasen nicht (F02).
  function reset(state, { now }) {
    if (state.status !== 'running' && state.status !== 'paused') return { state };
    const left = remainingMs(state, now);
    const session = state.phase === 'work'
      ? sessionRecord(state, { status: 'aborted', endedAt: now, learnedMs: Math.max(0, state.durationMs - left) })
      : null;
    return { state: idleIn(state.phase, state.completedInCycle), session };
  }

  function completeWork(state, profile) {
    const completedInCycle = state.completedInCycle + 1;
    return {
      state: idleIn(nextAfterWork(completedInCycle, profile), completedInCycle),
      // F08: Tag = geplantes Ende inklusive manueller Unterbrechungen (endsAt)
      session: sessionRecord(state, { status: 'completed', endedAt: state.endsAt, learnedMs: state.durationMs }),
    };
  }

  function finishBreak(state) {
    // F03: Nach der langen Pause beginnt der Zyklus von vorn
    const completedInCycle = state.phase === 'longBreak' ? 0 : state.completedInCycle;
    return idleIn('work', completedInCycle);
  }

  // Prüft, ob die laufende Phase abgelaufen ist. Mehrfacher Aufruf ist unschädlich:
  // nach der Verarbeitung ist der Zustand nicht mehr "running" (keine Doppeleinträge).
  // detectedOnLoad: Ablauf erst beim Wiederöffnen erkannt (F04).
  // → { state, event?, session? }
  function tick(state, { now, profile, detectedOnLoad = false }) {
    if (state.status !== 'running' || now < state.endsAt) return { state };
    const late = detectedOnLoad || now - state.endsAt > LATE_TOLERANCE_MS;
    const endedPhase = state.phase;

    if (endedPhase === 'work') {
      if (late) {
        return { state: { ...state, status: 'review' }, event: { type: 'needs-review', phase: endedPhase } };
      }
      const done = completeWork(state, profile);
      return { ...done, event: { type: 'phase-ended', phase: endedPhase, next: done.state.phase } };
    }

    const next = finishBreak(state);
    return { state: next, event: { type: 'phase-ended', phase: endedPhase, next: next.phase, late } };
  }

  // Klärt "Abschluss prüfen": 'completed' zählt genau einmal, 'aborted' gar nicht (F07).
  function resolveReview(state, { outcome, profile }) {
    if (state.status !== 'review') return { state };
    if (outcome === 'completed') return completeWork(state, profile);
    return {
      state: idleIn('work', state.completedInCycle),
      session: sessionRecord(state, { status: 'aborted', endedAt: state.endsAt, learnedMs: null }),
    };
  }

  // Pause überspringen – erzeugt keine Lerneinheit (F03)
  function skipBreak(state) {
    if (state.phase === 'work' || state.status === 'review') return { state };
    return { state: finishBreak(state) };
  }

  // Zyklus bewusst neu beginnen – nur ohne gestartete oder ungeklärte Phase (F03)
  function restartCycle(state) {
    if (state.status !== 'idle') return { state, error: 'not-idle' };
    return { state: idleIn('work', 0) };
  }

  // Wiederherstellung nach Neuladen (F04): abgelaufene Phasen sofort verarbeiten
  function restore(state, { now, profile }) {
    if (state.status !== 'running') return { state };
    return tick(state, { now, profile, detectedOnLoad: now >= state.endsAt });
  }

  // ===== PROTOKOLL (F07) =====

  // Fügt einen Eintrag hinzu; gleiche Kennung → kein Doppeleintrag
  function appendSession(sessions, session) {
    if (!session || sessions.some(s => s.id === session.id)) return sessions;
    return [...sessions, session];
  }

  // ===== STATISTIK (F08) – lokale Kalendertage =====

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  // Lokales Datum (nicht UTC wie today() in app.js)
  function localDayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function lastDayKeys(now, count) {
    const d = new Date(now);
    const keys = [];
    for (let i = count - 1; i >= 0; i--) {
      // Kalenderarithmetik statt -24h: korrekt auch bei Sommer-/Winterzeit
      keys.push(localDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i).getTime()));
    }
    return keys;
  }

  // Nur abgeschlossene Einheiten zählen; Abbrüche und ungeklärte Einheiten nicht.
  function summarize(sessions, now) {
    const keys = lastDayKeys(now, 7);
    const byDay = Object.fromEntries(keys.map(k => [k, { day: k, count: 0, ms: 0 }]));
    for (const s of sessions) {
      if (s.status !== 'completed') continue;
      const day = byDay[localDayKey(s.endedAt)];
      if (!day) continue;
      day.count++;
      day.ms += s.learnedMs;
    }
    const days = keys.map(k => ({ day: k, count: byDay[k].count, minutes: Math.round(byDay[k].ms / MINUTE) }));
    const todayEntry = days[days.length - 1];
    return {
      today: { count: todayEntry.count, minutes: todayEntry.minutes },
      last7: {
        count: days.reduce((a, d) => a + d.count, 0),
        minutes: Math.round(keys.reduce((a, k) => a + byDay[k].ms, 0) / MINUTE),
      },
      days,
    };
  }

  // ===== SPEICHERFORMAT (F09) =====
  // Gespeichert wird { version, data }. Ungültige Daten werden erkannt statt still verworfen.

  function serialize(data) {
    return JSON.stringify({ version: SCHEMA_VERSION, data });
  }

  function isInt(v) {
    return Number.isInteger(v);
  }

  function isValidSettings(s) {
    return !!s && (s.activeProfile === 'standard' || s.activeProfile === 'custom') &&
      validateProfile(s.custom).ok &&
      !!s.sound && typeof s.sound.enabled === 'boolean' && typeof s.sound.tone === 'string' &&
      isInt(s.sound.volume) && s.sound.volume >= 0 && s.sound.volume <= 100;
  }

  function isValidState(s) {
    if (!s || !PHASES.includes(s.phase) || !STATUSES.includes(s.status) || !isInt(s.completedInCycle) || s.completedInCycle < 0) return false;
    if (s.status === 'running') return isInt(s.endsAt) && isInt(s.durationMs) && isInt(s.startedAt);
    if (s.status === 'paused') return isInt(s.remainingMs) && isInt(s.durationMs) && isInt(s.startedAt);
    if (s.status === 'review') return s.phase === 'work' && isInt(s.endsAt) && isInt(s.durationMs) && typeof s.sessionId === 'string';
    return true;
  }

  function isValidSession(s) {
    return !!s && typeof s.id === 'string' && isInt(s.startedAt) && isInt(s.endedAt) && isInt(s.plannedMs) &&
      (s.status === 'completed' || s.status === 'aborted') &&
      (s.learnedMs === null || isInt(s.learnedMs)) &&
      typeof s.topic === 'string' && s.topic.length <= TOPIC_MAX_LENGTH;
  }

  const VALIDATORS = {
    settings: isValidSettings,
    state: isValidState,
    sessions: v => Array.isArray(v) && v.every(isValidSession),
  };

  // → { ok: true, value } · { ok: true, value: null } (nichts gespeichert) · { ok: false, corrupt: true }
  function parse(kind, raw) {
    if (raw === null || raw === undefined) return { ok: true, value: null };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== SCHEMA_VERSION || !VALIDATORS[kind](parsed.data)) return { ok: false, corrupt: true };
      return { ok: true, value: parsed.data };
    } catch {
      return { ok: false, corrupt: true };
    }
  }

  return {
    SCHEMA_VERSION, STORAGE_KEYS, LIMITS, DEFAULT_PROFILE, LATE_TOLERANCE_MS, TOPIC_MAX_LENGTH,
    defaultSettings, validateProfile, activeProfile,
    createInitialState, isActive, remainingMs,
    start, pause, resume, reset, tick, resolveReview, skipBreak, restartCycle, restore,
    appendSession, localDayKey, summarize,
    serialize, parse,
  };
});
