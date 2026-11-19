// ============================================================
// StudyCards - Wiederholungsplanung: FSRS-6 (Standard) und SM-2
// Reine Logik ohne Oberfläche. Alle Funktionen sind seiteneffektfrei und
// bekommen das heutige Datum ('YYYY-MM-DD', lokal) übergeben → testbar.
// FSRS-6-Formeln und Standardparameter nach ts-fsrs (open-spaced-repetition,
// MIT-Lizenz), hier eigenständig nachprogrammiert.
// Siehe docs/PFLICHTENHEFT_FSRS.md (F1–F5).
// ============================================================

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; // Node-Tests
  else root.FSRS = api;                                                   // Browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===== KONSTANTEN =====
  const DEFAULT_PARAMS = Object.freeze([
    0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
    1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
  ]);
  const ALGORITHMS = Object.freeze(['fsrs', 'sm2']);
  const DEFAULT_ALGORITHM = 'fsrs';
  const RETENTION_OPTIONS = Object.freeze([0.8, 0.85, 0.9, 0.95]); // F3
  const DEFAULT_RETENTION = 0.9;
  const MAX_INTERVAL = 365;            // F3: Höchstabstand in Tagen, für beide Verfahren
  const S_MIN = 0.001;
  const S_MAX = 36500;
  const LEGACY_DIFFICULTY = 5;         // F2: alte SM-2-Zustände ohne FSRS-Werte
  const QUALITIES = Object.freeze([1, 3, 4, 5]); // Knöpfe: Nochmal, Schwer, Gut, Einfach
  const GRADE = Object.freeze({ 1: 1, 3: 2, 4: 3, 5: 4 }); // Knopf → FSRS-Note
  const LOG_KEY = 'sc_reviews';        // F5
  const LOG_MAX = 20000;

  // ===== HILFEN =====
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const roundTo = (n, d) => { const f = 10 ** d; return Math.round(n * f) / f; };

  function parseDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12); // Mittag: unempfindlich gegen Zeitumstellung
  }
  function dateKey(dt) {
    const p = n => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
  }
  function addDays(key, n) {
    const dt = parseDate(key);
    dt.setDate(dt.getDate() + n);
    return dateKey(dt);
  }
  function daysBetween(a, b) {
    return Math.round((parseDate(b) - parseDate(a)) / 86400000);
  }

  // ===== FSRS-6 =====
  function decayFactor(w) {
    const decay = -w[20];
    return { decay, factor: roundTo(Math.exp(Math.log(0.9) / decay) - 1, 8) };
  }

  // Abrufwahrscheinlichkeit nach t Tagen bei Stabilität s
  function forgettingCurve(t, s, w = DEFAULT_PARAMS) {
    const { decay, factor } = decayFactor(w);
    return roundTo(Math.pow(1 + factor * t / s, decay), 8);
  }

  // Tage, bis die Abrufwahrscheinlichkeit auf `retention` fällt (ungedeckelt, mindestens 1)
  function nextInterval(s, retention = DEFAULT_RETENTION, w = DEFAULT_PARAMS) {
    if (!(retention > 0 && retention <= 1)) throw new RangeError('Behaltensrate muss zwischen 0 und 1 liegen');
    const { decay, factor } = decayFactor(w);
    return Math.max(Math.round(s / factor * (Math.pow(retention, 1 / decay) - 1)), 1);
  }

  function initDifficulty(g, w) {
    return roundTo(w[4] - Math.exp((g - 1) * w[5]) + 1, 8);
  }

  function nextDifficulty(d, g, w) {
    const delta = -w[6] * (g - 3);
    const damped = d + roundTo(delta * (10 - d) / 9, 8);
    return clamp(roundTo(w[7] * initDifficulty(4, w) + (1 - w[7]) * damped, 8), 1, 10);
  }

  function recallStability(d, s, r, g, w) {
    const hard = g === 2 ? w[15] : 1;
    const easy = g === 4 ? w[16] : 1;
    return roundTo(clamp(
      s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1) * hard * easy),
      S_MIN, S_MAX), 8);
  }

  function forgetStability(d, s, r, w) {
    return roundTo(clamp(
      w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]),
      S_MIN, S_MAX), 8);
  }

  function shortTermStability(s, g, w) {
    const sinc = Math.pow(s, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]));
    return roundTo(clamp(s * (g >= 2 ? Math.max(sinc, 1) : sinc), S_MIN, S_MAX), 8);
  }

  // Gedächtniszustand nach einer Bewertung. memory = null für eine neue Karte.
  // t = Tage seit der letzten Wiederholung, g = FSRS-Note 1–4.
  function nextMemory(memory, t, g, w = DEFAULT_PARAMS) {
    if (![1, 2, 3, 4].includes(g)) throw new RangeError('Ungültige Note: ' + g);
    if (!memory) {
      return { difficulty: clamp(initDifficulty(g, w), 1, 10), stability: clamp(w[g - 1], S_MIN, S_MAX) };
    }
    const d = clamp(memory.difficulty, 1, 10);
    const s = Math.max(memory.stability, S_MIN);
    const elapsed = Math.max(0, t);
    let stability;
    if (elapsed === 0) {
      stability = shortTermStability(s, g, w);
    } else {
      const r = forgettingCurve(elapsed, s, w);
      stability = g === 1
        ? clamp(roundTo(s / Math.exp(w[17] * w[18]), 8), S_MIN, forgetStability(d, s, r, w))
        : recallStability(d, s, r, g, w);
    }
    return { difficulty: nextDifficulty(d, g, w), stability };
  }

  // ===== SM-2 (wie bisher in app.js, rechnet immer mit) =====
  function sm2Step(state, quality) {
    let { easeFactor = 2.5, interval = 0, repetitions = 0 } = state;
    if (quality >= 3) {
      if (repetitions === 0) interval = 1;
      else if (repetitions === 1) interval = 6;
      else interval = Math.round(interval * easeFactor);
      repetitions++;
    } else {
      repetitions = 0;
      interval = 1;
    }
    easeFactor = Math.max(1.3, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    if (quality === 3) interval = Math.max(1, Math.round(interval * 0.85));
    if (quality === 5) interval = Math.round(interval * 1.3);
    return { easeFactor, interval, repetitions };
  }

  // ===== KARTENZUSTAND (F2) =====
  function defaultState(today) {
    return {
      stability: 0, difficulty: 0, lapses: 0,
      easeFactor: 2.5,
      interval: 0, repetitions: 0, nextReview: today, lastReview: null,
      totalReviews: 0, correctReviews: 0,
    };
  }

  function normalizeOptions(opts = {}) {
    const algorithm = ALGORITHMS.includes(opts.algorithm) ? opts.algorithm : DEFAULT_ALGORITHM;
    const retention = RETENTION_OPTIONS.includes(opts.retention) ? opts.retention : DEFAULT_RETENTION;
    const maxInterval = Number.isInteger(opts.maxInterval) && opts.maxInterval >= 1 ? opts.maxInterval : MAX_INTERVAL;
    return { algorithm, retention, maxInterval, params: opts.params || DEFAULT_PARAMS };
  }

  // Bisheriges Gedächtnis aus dem Zustand: FSRS-Werte, alter SM-2-Zustand oder neu (null)
  function memoryOf(state) {
    if (state.stability > 0 && state.difficulty >= 1) return { stability: state.stability, difficulty: state.difficulty };
    if (state.totalReviews > 0) return { stability: Math.max(state.interval || 0, 1), difficulty: LEGACY_DIFFICULTY };
    return null;
  }

  // Alle vier möglichen Ergebnisse einer Bewertung (Schlüssel = Knopf 1/3/4/5).
  // Bei FSRS gilt: Schwer ≤ Gut < Einfach (außer am Höchstabstand).
  function preview(state, opts = {}) {
    const o = normalizeOptions(opts);
    const today = opts.today;
    if (!today) throw new Error('preview braucht opts.today');
    const base = { ...defaultState(today), ...(state || {}) };
    const memory = memoryOf(base);
    const elapsed = base.lastReview ? Math.max(0, daysBetween(base.lastReview, today)) : 0;

    const out = {};
    for (const q of QUALITIES) {
      const mem = nextMemory(memory, elapsed, GRADE[q], o.params);
      const sm2 = sm2Step(base, q);
      out[q] = {
        ...base,
        stability: mem.stability,
        difficulty: mem.difficulty,
        lapses: (base.lapses || 0) + (q === 1 && base.totalReviews > 0 ? 1 : 0),
        easeFactor: sm2.easeFactor,
        repetitions: sm2.repetitions,
        interval: o.algorithm === 'fsrs' ? nextInterval(mem.stability, o.retention, o.params) : sm2.interval,
        lastReview: today,
        lastQuality: q,
        totalReviews: base.totalReviews + 1,
        correctReviews: base.correctReviews + (q >= 3 ? 1 : 0),
      };
    }
    if (o.algorithm === 'fsrs') {
      out[3].interval = Math.min(out[3].interval, out[4].interval);
      out[4].interval = Math.max(out[4].interval, out[3].interval + 1);
      out[5].interval = Math.max(out[5].interval, out[4].interval + 1);
    }
    for (const q of QUALITIES) {
      out[q].interval = clamp(out[q].interval, 1, o.maxInterval);
      out[q].nextReview = addDays(today, out[q].interval);
    }
    return out;
  }

  // Neuer Zustand nach einer Bewertung (quality = Knopf 1/3/4/5)
  function review(state, quality, opts = {}) {
    if (!QUALITIES.includes(quality)) throw new RangeError('Ungültige Bewertung: ' + quality);
    return preview(state, opts)[quality];
  }

  // Abstände in Tagen für die Vorschau unter den Knöpfen
  function previewIntervals(state, opts = {}) {
    const p = preview(state, opts);
    return { 1: p[1].interval, 3: p[3].interval, 4: p[4].interval, 5: p[5].interval };
  }

  // Abrufwahrscheinlichkeit einer gelernten Karte an einem Tag (F4); null für neue Karten.
  // Alte SM-2-Zustände werden wie in F2 geschätzt (S = Abstand, mindestens 1).
  function retrievability(state, today, w = DEFAULT_PARAMS) {
    if (!state || !state.lastReview) return null;
    const memory = memoryOf(state);
    if (!memory) return null;
    return forgettingCurve(Math.max(0, daysBetween(state.lastReview, today)), memory.stability, w);
  }

  // ===== BEWERTUNGSPROTOKOLL (F5) =====
  // Eintrag: [Karten-ID, Datum, Knopf]. Liefert ein neues Array mit höchstens `max` Einträgen.
  function appendLog(log, cardId, today, quality, max = LOG_MAX) {
    const list = Array.isArray(log) ? log : [];
    const next = list.concat([[String(cardId), today, quality]]);
    return next.length > max ? next.slice(next.length - max) : next;
  }

  return {
    DEFAULT_PARAMS, ALGORITHMS, DEFAULT_ALGORITHM, RETENTION_OPTIONS, DEFAULT_RETENTION, MAX_INTERVAL,
    S_MIN, S_MAX, QUALITIES, GRADE, LOG_KEY, LOG_MAX,
    addDays, daysBetween,
    forgettingCurve, nextInterval, nextMemory, sm2Step,
    defaultState, preview, review, previewIntervals, retrievability, appendLog,
  };
});
