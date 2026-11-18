// ============================================================
// StudyCards - Lernziele: Wissensstand, Tagesplan, Notenschlüssel, Archiv
// Reine Logik ohne Oberfläche. Alle Funktionen sind seiteneffektfrei und
// bekommen das heutige Datum ('YYYY-MM-DD', lokal) übergeben → testbar.
// Siehe docs/PFLICHTENHEFT_ZIELE.md (Z1–Z7).
// ============================================================

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; // Node-Tests
  else root.Goals = api;                                                  // Browser
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const STORAGE_KEY = 'sc_goals';

  const NAME_MAX_LENGTH = 60;
  const MAX_NEW_PER_DAY = 60;          // Z2: Obergrenze pro Ziel und Tag
  const DEFAULT_BUFFER_DAYS = 2;       // Z1
  const BUFFER_LIMITS = { min: 0, max: 14 };
  const TARGET_LIMITS = { min: 10, max: 100 };
  const SECURE_MIN_INTERVAL = 3;       // Z3: "sicher" ab 3 Tagen Abstand
  const SECURE_MIN_QUALITY = 4;        // Z3: letzte Antwort mindestens "Gut"
  const MILESTONES = [25, 50, 75];     // Z5
  const DAILY_DONE_KEEP = 366;         // Z5: gespeicherte Tage mit erledigtem Tagesziel
  const BONUS_XP = { milestone: 15, daily: 25, target: 100 }; // Z5

  // Z3: Wunschnote → Zielmarke in %
  const SCALES = {
    school: { label: 'Schule', grades: ['1', '2', '3', '4'] },
    uni: { label: 'Studium', grades: ['1,0', '1,3', '1,7', '2,0', '2,3', '2,7', '3,0', '3,3', '3,7', '4,0'] },
  };
  const GRADE_TARGETS = {
    school: { '1': 92, '2': 81, '3': 67, '4': 50 },
    uni: {
      '1,0': 92, '1,3': 92,
      '1,7': 81, '2,0': 81, '2,3': 81,
      '2,7': 67, '3,0': 67, '3,3': 67,
      '3,7': 50, '4,0': 50,
    },
  };

  // ===== DATUM (nur Kalendertage, keine Uhrzeit) =====
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isDateKey(s) {
    if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  // Tagesarithmetik über UTC-Mitternacht → unabhängig von Sommer-/Winterzeit
  function toUTC(key) {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function addDays(key, n) {
    const dt = new Date(toUTC(key) + n * 86400000);
    return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  }

  function daysBetween(a, b) {
    return Math.round((toUTC(b) - toUTC(a)) / 86400000);
  }

  // ===== TAGS (gleiche Regel wie App._splitTag) =====
  function splitTag(tag) {
    const idx = tag.lastIndexOf('/');
    return idx === -1 ? { folder: '', subject: tag } : { folder: tag.slice(0, idx), subject: tag.slice(idx + 1) };
  }

  // Gehört die Karte zum Ziel? Ordner muss passen; leere Themenliste = alle Themen des Ordners.
  function cardMatches(goal, card) {
    const tags = card && Array.isArray(card.tags) ? card.tags : [];
    if (tags.length === 0) return goal.folder === '' && goal.topics.length === 0;
    return tags.some(t => {
      if (splitTag(t).folder !== goal.folder) return false;
      return goal.topics.length === 0 || goal.topics.includes(t);
    });
  }

  function goalCards(goal, cards) {
    return (cards || []).filter(c => cardMatches(goal, c));
  }

  // ===== NOTEN (Z3) =====
  function targetForGrade(scale, grade) {
    const table = GRADE_TARGETS[scale];
    return table && Object.prototype.hasOwnProperty.call(table, grade) ? table[grade] : null;
  }

  // ===== ANLEGEN / PRÜFEN (Z1) =====
  function parseWholeNumber(value) {
    if (typeof value === 'number') return Number.isInteger(value) ? value : NaN;
    if (typeof value !== 'string' || !/^\s*\d+\s*$/.test(value)) return NaN;
    return parseInt(value, 10);
  }

  // Prüft Formulareingaben. `today` = heutiges Datum, `id`/`createdAt` werden übernommen.
  // → { ok: true, value } oder { ok: false, errors: { feld: 'Hinweis' } }
  function validateGoal(input, { today, id, createdAt } = {}) {
    const errors = {};
    const src = input || {};

    const name = typeof src.name === 'string' ? src.name.trim() : '';
    if (!name) errors.name = 'Bitte einen Namen eingeben.';
    else if (name.length > NAME_MAX_LENGTH) errors.name = `Höchstens ${NAME_MAX_LENGTH} Zeichen.`;

    const folder = typeof src.folder === 'string' ? src.folder : null;
    if (folder === null) errors.folder = 'Bitte ein Fach wählen.';

    const topics = Array.isArray(src.topics) ? [...new Set(src.topics.filter(t => typeof t === 'string' && t))] : [];
    if (folder !== null && topics.some(t => splitTag(t).folder !== folder)) errors.topics = 'Themen passen nicht zum Fach.';

    const examDate = src.examDate;
    if (!isDateKey(examDate)) errors.examDate = 'Bitte ein gültiges Datum wählen.';
    else if (today && examDate <= today) errors.examDate = 'Das Datum muss in der Zukunft liegen.';

    const scale = src.scale;
    if (!SCALES[scale]) errors.scale = 'Bitte Schule oder Studium wählen.';

    let grade = null;
    if (src.grade !== undefined && src.grade !== null && src.grade !== '') {
      grade = String(src.grade);
      if (SCALES[scale] && targetForGrade(scale, grade) === null) errors.grade = 'Diese Note gibt es hier nicht.';
    }

    let targetPercent;
    if (src.targetPercent === undefined || src.targetPercent === null || src.targetPercent === '') {
      targetPercent = grade !== null && SCALES[scale] ? targetForGrade(scale, grade) : null;
      if (targetPercent === null && !errors.grade) errors.targetPercent = 'Bitte Wunschnote oder Zielmarke angeben.';
    } else {
      targetPercent = parseWholeNumber(src.targetPercent);
      if (Number.isNaN(targetPercent) || targetPercent < TARGET_LIMITS.min || targetPercent > TARGET_LIMITS.max) {
        errors.targetPercent = `Zielmarke: erlaubt sind ${TARGET_LIMITS.min} bis ${TARGET_LIMITS.max} %.`;
      }
    }

    let bufferDays = DEFAULT_BUFFER_DAYS;
    if (src.bufferDays !== undefined && src.bufferDays !== null && src.bufferDays !== '') {
      bufferDays = parseWholeNumber(src.bufferDays);
      if (Number.isNaN(bufferDays) || bufferDays < BUFFER_LIMITS.min || bufferDays > BUFFER_LIMITS.max) {
        errors.bufferDays = `Puffertage: erlaubt sind ${BUFFER_LIMITS.min} bis ${BUFFER_LIMITS.max}.`;
      }
    }

    if (Object.keys(errors).length) return { ok: false, errors };
    return {
      ok: true,
      value: {
        id: id || null, name, folder, topics, examDate, scale, grade, targetPercent, bufferDays,
        createdAt: createdAt || today || null,
        reached: [],          // erreichte Meilensteine (25/50/75/'target'), damit jeder nur einmal feiert
        dailyDone: [],        // Tage mit erledigtem Tagesziel (für Bonus-XP und Serie)
        archived: null,       // { on, finalPercent, actualGrade } nach Z6
      },
    };
  }

  // ===== WISSENSSTAND (Z3) =====
  // Ältere Lernstände ohne lastQuality: "richtig wiederholt" (repetitions > 0) genügt.
  function isSecure(state) {
    if (!state || !(state.interval >= SECURE_MIN_INTERVAL) || !(state.repetitions > 0)) return false;
    return state.lastQuality === undefined || state.lastQuality >= SECURE_MIN_QUALITY;
  }

  function knowledge(goal, cards, states) {
    const list = goalCards(goal, cards);
    let secure = 0, fresh = 0;
    for (const c of list) {
      const s = states ? states[c.id] : undefined;
      if (!s) fresh++;
      else if (isSecure(s)) secure++;
    }
    const total = list.length;
    return {
      total, secure, newCount: fresh,
      percent: total ? Math.floor((secure / total) * 100) : 0,
    };
  }

  // ===== PHASE & COUNTDOWN =====
  // Letzter Tag mit neuen Karten = Prüfung − Puffertage − 1
  function lastLearnDay(goal) {
    return addDays(goal.examDate, -goal.bufferDays - 1);
  }

  function daysLeft(goal, today) {
    return daysBetween(today, goal.examDate);
  }

  // 'learn' | 'buffer' | 'exam' (Prüfungstag) | 'over' (danach)
  function phase(goal, today) {
    if (today > goal.examDate) return 'over';
    if (today === goal.examDate) return 'exam';
    if (today > lastLearnDay(goal)) return 'buffer';
    return 'learn';
  }

  // ===== TAGESPLAN (Z2) =====
  // learnedToday = heute erstmals gelernte Karten dieses Ziels.
  // Der Bedarf wird inkl. der heute schon gelernten Karten berechnet → bleibt über den Tag stabil.
  // In Puffertagen und am Prüfungstag gibt es planmäßig keine neuen Karten. Sind aber noch nie
  // gelernte Karten übrig (Rückstand oder spät angelegtes Ziel), werden sie sofort nachgeholt (catchUp).
  function dailyPlan(goal, { newCount, learnedToday = 0, today }) {
    const p = phase(goal, today);
    if (p === 'over') return { phase: p, learnDays: 0, needed: 0, quota: 0, remainingToday: 0, tight: false, catchUp: false };
    if (p !== 'learn') {
      const needed = newCount + learnedToday;
      const quota = Math.min(needed, MAX_NEW_PER_DAY);
      return {
        phase: p, learnDays: 0, needed, quota,
        remainingToday: Math.max(0, Math.min(quota - learnedToday, newCount)),
        tight: needed > MAX_NEW_PER_DAY, catchUp: newCount > 0,
      };
    }
    const learnDays = daysBetween(today, lastLearnDay(goal)) + 1;
    const needed = Math.ceil((newCount + learnedToday) / learnDays);
    const quota = Math.min(needed, MAX_NEW_PER_DAY);
    return {
      phase: p, learnDays, needed, quota,
      remainingToday: Math.max(0, Math.min(quota - learnedToday, newCount)),
      tight: needed > MAX_NEW_PER_DAY, catchUp: false,
    };
  }

  // ===== PRÜFUNGSMODUS (Z4) =====
  // Wirksamer Fälligkeitstermin einer gelernten Karte: Gehört sie zu einem laufenden Ziel und läge
  // ihr Termin nach dem Tag vor der Prüfung, wird sie an diesem Tag fällig – es sei denn, sie wurde
  // an diesem Tag schon wiederholt. Gespeichert wird nichts: Nach Löschen/Archivieren gilt wieder
  // der normale Termin. Am Prüfungstag selbst wird nichts vorgezogen.
  function effectiveDue(state, card, goals, today) {
    let due = state.nextReview;
    for (const g of goals || []) {
      if (g.archived) continue;
      const p = phase(g, today);
      if ((p !== 'learn' && p !== 'buffer') || !cardMatches(g, card)) continue;
      const limit = addDays(g.examDate, -1);
      if (due > limit && (!state.lastReview || state.lastReview < limit)) due = limit;
    }
    return due;
  }

  // ===== MEILENSTEINE (Z5) =====
  // Liefert neu erreichte Meilensteine (Zahlen und ggf. 'target') – jeder nur einmal.
  function newMilestones(goal, percent) {
    const done = new Set(goal.reached || []);
    const out = MILESTONES.filter(m => percent >= m && m < goal.targetPercent && !done.has(m));
    if (percent >= goal.targetPercent && !done.has('target')) out.push('target');
    return out;
  }

  function markReached(goal, milestones) {
    if (!milestones.length) return goal;
    return { ...goal, reached: [...new Set([...(goal.reached || []), ...milestones])] };
  }

  // ===== TAGESZIEL & SERIE (Z5) =====
  function markDailyDone(goal, today) {
    const days = goal.dailyDone || [];
    if (days.includes(today)) return goal;
    return { ...goal, dailyDone: [...days, today].sort().slice(-DAILY_DONE_KEEP) };
  }

  // Tage in Folge mit erledigtem Tagesziel – zählt ab heute oder (noch offen) ab gestern
  function dailyStreak(goal, today) {
    const days = new Set(goal.dailyDone || []);
    let day = days.has(today) ? today : addDays(today, -1);
    let n = 0;
    while (days.has(day)) {
      n++;
      day = addDays(day, -1);
    }
    return n;
  }

  // ===== ARCHIV (Z6) =====
  function shouldArchive(goal, today) {
    return !goal.archived && phase(goal, today) === 'over';
  }

  function archive(goal, { today, finalPercent }) {
    if (goal.archived) return goal;
    return { ...goal, archived: { on: today, finalPercent, actualGrade: null } };
  }

  // ===== SPEICHERN (Z7) =====
  function isValidGoal(g) {
    if (!g || typeof g.id !== 'string' || !g.id) return false;
    const check = validateGoal(g, { id: g.id, createdAt: g.createdAt });
    if (!check.ok) return false;
    if (!Array.isArray(g.reached) || !g.reached.every(m => m === 'target' || MILESTONES.includes(m))) return false;
    // dailyDone fehlt bei Zielen aus v1.29–v1.31 → gültig, wird als [] geladen
    if (g.dailyDone !== undefined && (!Array.isArray(g.dailyDone) || !g.dailyDone.every(isDateKey))) return false;
    if (g.archived !== null) {
      const a = g.archived;
      if (!a || !isDateKey(a.on) || !Number.isInteger(a.finalPercent) || a.finalPercent < 0 || a.finalPercent > 100) return false;
      if (a.actualGrade !== null && typeof a.actualGrade !== 'string') return false;
    }
    return true;
  }

  // Nur bekannte Felder übernehmen
  function clean(g) {
    return {
      id: g.id, name: g.name.trim(), folder: g.folder, topics: [...g.topics], examDate: g.examDate,
      scale: g.scale, grade: g.grade === null ? null : String(g.grade), targetPercent: g.targetPercent,
      bufferDays: g.bufferDays, createdAt: g.createdAt ?? null, reached: [...g.reached],
      dailyDone: [...new Set(g.dailyDone || [])].sort().slice(-DAILY_DONE_KEEP),
      archived: g.archived ? { on: g.archived.on, finalPercent: g.archived.finalPercent, actualGrade: g.archived.actualGrade ?? null } : null,
    };
  }

  function serialize(goals) {
    return JSON.stringify({ version: SCHEMA_VERSION, data: goals });
  }

  // → { ok: true, value: Ziel-Liste } oder { ok: false, corrupt: true }; fehlend → leere Liste
  function parse(raw) {
    if (raw === null || raw === undefined) return { ok: true, value: [] };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.data) || !parsed.data.every(isValidGoal)) {
        return { ok: false, corrupt: true };
      }
      return { ok: true, value: parsed.data.map(clean) };
    } catch {
      return { ok: false, corrupt: true };
    }
  }

  return {
    SCHEMA_VERSION, STORAGE_KEY, NAME_MAX_LENGTH, MAX_NEW_PER_DAY, DEFAULT_BUFFER_DAYS, BUFFER_LIMITS,
    TARGET_LIMITS, MILESTONES, SCALES, GRADE_TARGETS, BONUS_XP,
    isDateKey, addDays, daysBetween, splitTag,
    cardMatches, goalCards, targetForGrade, validateGoal,
    isSecure, knowledge, lastLearnDay, daysLeft, phase, dailyPlan,
    effectiveDue, newMilestones, markReached, markDailyDone, dailyStreak, shouldArchive, archive,
    serialize, parse,
  };
});
