// ============================================================
// StudyCards - Obsidian Markdown Flashcard App with Spaced Repetition
// ============================================================

(function () {
  'use strict';

  // ===== CONFIG =====
  const STORAGE_KEYS = {
    config: 'sc_config',
    cards: 'sc_cards',
    stats: 'sc_stats',
    cache: 'sc_cache',
    reviews: 'sc_reviews', // Bewertungsprotokoll (FSRS F5)
  };

  const XP_TABLE = { 1: 2, 3: 5, 4: 10, 5: 15 };
  const XP_PER_LEVEL = 100;
  const DEFAULT_NEW_PER_DAY = 20;

  // ===== HELPERS =====
  // Lokales Kalenderdatum 'YYYY-MM-DD' (nicht UTC – sonst ist es in Deutschland
  // zwischen 0 und 1/2 Uhr noch "gestern")
  function localDateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function today() {
    return localDateKey(new Date());
  }

  function daysBetween(a, b) {
    const da = new Date(a);
    const db = new Date(b);
    return Math.round((db - da) / 86400000);
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  function load(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  }

  function save(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
  }

  function formatInterval(days) {
    if (days < 1) return '<1 T';
    if (days === 1) return '1 T';
    if (days < 30) return days + ' T';
    if (days < 365) return Math.round(days / 30) + ' M';
    return Math.round(days / 365) + ' J';
  }

  // ===== SECURITY: HTML Escaping =====
  const _escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  function escapeHTML(str) {
    return str.replace(/[&<>"']/g, c => _escapeMap[c]);
  }

  const SAFE_PARAM = /^[a-zA-Z0-9._-]+$/;
  const MAX_FILES = 500;
  const MAX_TEXT_LENGTH = 10000;
  const FETCH_BATCH_SIZE = 10;
  const APP_VERSION = 'v1.34'; // beim Release zusammen mit CACHE_NAME in sw.js erhöhen
  const SAFE_TOKEN = /^[A-Za-z0-9_]{20,255}$/;
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
  const IMAGE_CACHE = 'studycards-img';

  // ===== MARKDOWN PARSER =====
  const Parser = {
    extractCards(markdown, filePath) {
      const cards = [];
      const fileName = filePath.split('/').pop().replace(/\.md$/, '');
      let tags = null; // null = außerhalb eines Lernkartenabschnitts
      let currentQ = null;
      let currentA = [];
      let currentOpts = [];
      let collecting = null;
      let fence = null;
      let inComment = false;

      const pushCard = () => {
        const answer = currentA.join('\n').trim();
        if (currentQ && (answer || currentOpts.length >= 2)) {
          cards.push(this._makeCard(currentQ, answer, filePath, fileName, tags,
            currentOpts.length >= 2 ? currentOpts : null));
        }
      };

      const appendLine = (line) => {
        if (collecting === 'q' && line.trim()) {
          currentQ += '\n' + line;
        } else if (collecting === 'a' && (line.trim() || currentA.length)) {
          currentA.push(line);
        }
      };

      // Quellenkommentare bleiben wie in Markdown unsichtbar. Codebeispiele
      // durchlaufen diese Funktion nicht, damit HTML-Kommentare darin erhalten bleiben.
      const withoutComments = (line) => {
        let visible = '';
        let offset = 0;
        while (offset < line.length) {
          if (inComment) {
            const end = line.indexOf('-->', offset);
            if (end < 0) break;
            inComment = false;
            offset = end + 3;
          } else {
            const start = line.indexOf('<!--', offset);
            if (start < 0) {
              visible += line.slice(offset);
              break;
            }
            visible += line.slice(offset, start);
            inComment = true;
            offset = start + 4;
          }
        }
        return visible;
      };

      for (const rawLine of markdown.split(/\r?\n/)) {
        // Innerhalb von Codeblöcken sind Q:, A: und ## normaler Beispieltext.
        if (fence) {
          const end = rawLine.trim().match(/^(`{3,}|~{3,})\s*$/);
          if (tags !== null) appendLine(rawLine);
          if (end && end[1][0] === fence[0] && end[1].length >= fence.length) fence = null;
          continue;
        }

        const visible = withoutComments(rawLine);
        const line = visible
          .replace(/^(?:\s|&#x20;|&#32;|&nbsp;|\u00a0)+/i, '')
          .replace(/\s*\\$/, '');
        const startFence = line.match(/^(`{3,}|~{3,})/);
        if (startFence) {
          fence = startFence[1];
          if (tags !== null) appendLine(visible);
          continue;
        }

        const heading = line.match(/^##[ \t]+(.+)$/);
        if (heading) {
          pushCard();
          currentQ = null;
          currentA = [];
          currentOpts = [];
          collecting = null;
          const section = heading[1].match(/^Lernkarten?(?:[ \t]+(.*))?$/i);
          tags = section
            ? ((section[1] || '').match(/#([a-zA-ZäöüÄÖÜß0-9_\/-]+)/g) || [])
              .map(t => t.slice(1).replace(/^\/+|\/+$/g, '')).filter(Boolean)
            : null;
          continue;
        }
        if (tags === null) continue;

        const qMatch = line.match(/^Q:\s*(.+)/);
        const aMatch = line.match(/^A:\s*(.*)$/); // Antwort darf in der nächsten Zeile beginnen
        const optMatch = collecting === 'q' && line.match(/^[-*+]\s+\[([ xX])\]\s+(.+)/);

        if (optMatch) {
          currentOpts.push({ text: optMatch[2].trim(), correct: optMatch[1] !== ' ' });
        } else if (qMatch) {
          pushCard();
          currentQ = qMatch[1].trim();
          currentA = [];
          currentOpts = [];
          collecting = 'q';
        } else if (aMatch && currentQ) {
          currentA = aMatch[1].trim() ? [aMatch[1].trim()] : [];
          collecting = 'a';
        } else {
          appendLine(line);
        }
      }

      pushCard();
      return cards;
    },

    _makeCard(question, answer, filePath, fileName, tags, options = null) {
      // ID nur aus der ersten Fragezeile → Fortschritt bleibt erhalten, wenn z.B. ein Bild ergänzt wird
      const id = hashString(filePath + '::' + question.split('\n')[0]);
      return {
        id,
        question,
        answer,
        source: filePath,
        deck: fileName,
        tags: tags || [],
        options, // null = normale Karte, sonst Multiple-Choice
      };
    },

    renderMarkdown(text) {
      if (!text) return '';

      // DoS-Schutz: Textlänge begrenzen
      if (text.length > MAX_TEXT_LENGTH) {
        text = text.slice(0, MAX_TEXT_LENGTH) + '\n\n[Text gekürzt...]';
      }

      // Bilder: ![[bild.png]], ![[bild.png|300]] (Obsidian) und ![alt](pfad/bild.png)
      // werden durch Platzhalter ersetzt und erst nach dem Escapen als <img> eingesetzt
      const images = [];
      text = text
        .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, (m, name) => {
          if (!IMAGE_EXT.test(name.trim())) return m; // z.B. Audio-Einbettungen nicht als Bild behandeln
          images.push(name.trim());
          return `\u0000IMG${images.length - 1}\u0000`;
        })
        .replace(/!\[[^\]]*\]\(([^)\s]+)\)/g, (m, src) => {
          let name = src;
          try { name = decodeURIComponent(src); } catch {}
          images.push(name);
          return `\u0000IMG${images.length - 1}\u0000`;
        });

      // SECURITY: Zuerst alle HTML-Entities escapen, dann Markdown-Syntax ersetzen
      let html = escapeHTML(text)
        // Bold (sicherer Regex: [^*]+ statt .+?)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // Italic (Negative Lookaround verhindert Konflikte mit Bold)
        .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Unordered lists
        .replace(/^[-*]\s+(.+)/gm, '<li>$1</li>')
        // Ordered lists
        .replace(/^\d+\.\s+(.+)/gm, '<li>$1</li>')
        // Line breaks -> paragraphs
        .split(/\n\n+/)
        .map(block => {
          if (block.includes('<li>')) {
            return '<ul>' + block + '</ul>';
          }
          return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
        })
        .join('');

      // Tables (simple)
      html = html.replace(/<p>\|(.+)\|<\/p>/g, (match) => {
        const rows = match.replace(/<\/?p>/g, '').split('<br>').filter(r => r.trim());
        if (rows.length < 2) return match;
        let table = '<table>';
        rows.forEach((row, i) => {
          if (row.match(/^\|[\s-|]+\|$/)) return; // separator row
          const cells = row.split('|').filter(c => c.trim());
          const tag = i === 0 ? 'th' : 'td';
          table += '<tr>' + cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('') + '</tr>';
        });
        table += '</table>';
        return table;
      });

      // Bild-Platzhalter einsetzen (src wird später von App._hydrateImages gesetzt)
      html = html.replace(/\u0000IMG(\d+)\u0000/g, (m, i) =>
        `<img class="card-img" alt="" data-img="${escapeHTML(images[+i] || '')}">`);

      return html;
    }
  };

  // ===== WIEDERHOLUNGSPLANUNG =====
  // Rechenlogik in fsrs.js: FSRS-6 (Standard) oder SM-2, beide rechnen immer mit.
  // Siehe docs/PFLICHTENHEFT_FSRS.md.
  const Scheduler = {
    options() {
      const c = App.config || {};
      return { today: today(), algorithm: c.algorithm, retention: c.retention };
    },
    defaultState() {
      return window.FSRS.defaultState(today());
    },
    calcNext(state, quality) {
      return window.FSRS.review(state, quality, this.options());
    },
    previewIntervals(state) {
      return window.FSRS.previewIntervals(state, this.options());
    },
  };

  // Bewertungsprotokoll (F5): nur lokal, für ein späteres Parameter-Training.
  // Fehler beim Speichern dürfen das Lernen nie stören.
  const ReviewLog = {
    add(cardId, quality) {
      try {
        let log = window.FSRS.appendLog(load(STORAGE_KEYS.reviews), cardId, today(), quality);
        try {
          save(STORAGE_KEYS.reviews, log);
        } catch {
          log = log.slice(Math.floor(log.length / 2)); // Speicher voll: ältere Hälfte verwerfen
          save(STORAGE_KEYS.reviews, log);
        }
      } catch { /* Protokoll ist optional */ }
    },
    reset() {
      try { localStorage.removeItem(STORAGE_KEYS.reviews); } catch { /* egal */ }
    },
  };

  // ===== GITHUB API =====
  const GitHub = {
    token: null, // optional: Fine-grained PAT für private Repos (nur Lesezugriff)

    _validateParams(owner, repo, branch) {
      if (!SAFE_PARAM.test(owner) || !SAFE_PARAM.test(repo) || !SAFE_PARAM.test(branch)) {
        throw new Error('Ungültige Repository-Parameter (nur a-z, 0-9, . _ - erlaubt)');
      }
    },

    _headers(extra = {}) {
      return this.token ? { ...extra, Authorization: `Bearer ${this.token}` } : extra;
    },

    _encodePath(path) {
      return encodeURIComponent(path).replace(/%2F/g, '/');
    },

    async _fetchRaw(owner, repo, branch, path) {
      this._validateParams(owner, repo, branch);
      // Mit Token: Contents-API (unterstützt Auth + CORS), ohne Token: raw.githubusercontent.com
      const url = this.token
        ? `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${this._encodePath(path)}?ref=${encodeURIComponent(branch)}`
        : `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${this._encodePath(path)}`;
      const res = await fetch(url, { headers: this._headers({ Accept: 'application/vnd.github.raw' }) });
      if (!res.ok) throw new Error(`Datei nicht gefunden: ${path}`);
      return res;
    },

    async fetchTree(owner, repo, branch) {
      this._validateParams(owner, repo, branch);
      const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
      const res = await fetch(url, { headers: this._headers() });
      if (res.status === 401) throw new Error('GitHub-Token ungültig oder abgelaufen');
      if (res.status === 404) throw new Error('Repo nicht gefunden (bei privaten Repos Token prüfen)');
      if (!res.ok) throw new Error(`GitHub API Fehler: ${res.status} ${res.statusText}`);
      const data = await res.json();
      return data.tree.filter(f => f.type === 'blob');
    },

    async fetchFile(owner, repo, branch, path) {
      return (await this._fetchRaw(owner, repo, branch, path)).text();
    },

    async fetchBlob(owner, repo, branch, path) {
      return (await this._fetchRaw(owner, repo, branch, path)).blob();
    }
  };

  // ===== STATS & GAMIFICATION =====
  const Stats = {
    _data: null,

    load() {
      this._data = load(STORAGE_KEYS.stats) || {
        xp: 0,
        streak: 0,
        bestStreak: 0,
        lastStudyDate: null,
        dailyReviews: {},
        totalReviews: 0,
        totalCorrect: 0,
        bestDay: 0,
      };
    },

    save() {
      save(STORAGE_KEYS.stats, this._data);
    },

    get data() {
      if (!this._data) this.load();
      return this._data;
    },

    get level() {
      return Math.floor(this.data.xp / XP_PER_LEVEL) + 1;
    },

    get xpInLevel() {
      return this.data.xp % XP_PER_LEVEL;
    },

    // Bonus-XP für Lernziele (Z5) – zählt nicht als Wiederholung
    addBonus(xp) {
      this.data.xp += xp;
      this.save();
      return xp;
    },

    addReview(quality) {
      const d = this.data;
      const t = today();

      // XP
      const baseXP = XP_TABLE[quality] || 2;
      const streakBonus = Math.min(d.streak, 10);
      const earned = baseXP + streakBonus;
      d.xp += earned;

      // Daily reviews
      if (!d.dailyReviews[t]) d.dailyReviews[t] = 0;
      d.dailyReviews[t]++;

      // Total
      d.totalReviews++;
      if (quality >= 3) d.totalCorrect++;

      // Best day
      if (d.dailyReviews[t] > d.bestDay) d.bestDay = d.dailyReviews[t];

      // Streak
      this._updateStreak();

      // Cleanup old daily data (keep 30 days)
      const keys = Object.keys(d.dailyReviews).sort();
      while (keys.length > 30) {
        delete d.dailyReviews[keys.shift()];
      }

      this.save();
      return earned;
    },

    _updateStreak() {
      const d = this.data;
      const t = today();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = localDateKey(yesterday);

      if (d.lastStudyDate === t) {
        // Already studied today, no change
      } else if (d.lastStudyDate === yesterdayStr) {
        d.streak++;
      } else if (d.lastStudyDate !== t) {
        d.streak = 1;
      }

      d.lastStudyDate = t;
      if (d.streak > d.bestStreak) d.bestStreak = d.streak;
    },

    getTodayReviews() {
      return this.data.dailyReviews[today()] || 0;
    },

    getLast7Days() {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = localDateKey(d);
        const dayNames = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
        days.push({
          date: key,
          label: dayNames[d.getDay()],
          count: this.data.dailyReviews[key] || 0,
        });
      }
      return days;
    }
  };

  // ===== CARD STATE MANAGER =====
  const CardStore = {
    _states: null,

    load() {
      this._states = load(STORAGE_KEYS.cards) || {};
    },

    save() {
      save(STORAGE_KEYS.cards, this._states);
    },

    get states() {
      if (!this._states) this.load();
      return this._states;
    },

    getState(cardId) {
      return this.states[cardId] || Scheduler.defaultState();
    },

    updateState(cardId, quality) {
      const current = this.getState(cardId);
      this.states[cardId] = Scheduler.calcNext(current, quality);
      this.save();
      ReviewLog.add(cardId, quality);
      return this.states[cardId];
    },

    // card (optional): mit Karte gilt der Prüfungsmodus der Lernziele (Z4)
    isDue(cardId, card) {
      const state = this.states[cardId];
      if (!state) return false; // new card, not "due" but "new"
      const due = card ? GoalsUI.effectiveDue(state, card) : state.nextReview;
      return due <= today();
    },

    isNew(cardId) {
      return !this.states[cardId];
    },

    isMature(cardId) {
      const state = this.states[cardId];
      return state && state.interval >= 21;
    },

    getLearnedCount() {
      return Object.keys(this.states).length;
    },

    getMatureCount() {
      return Object.values(this.states).filter(s => s.interval >= 21).length;
    },

    getAccuracy() {
      const states = Object.values(this.states);
      if (states.length === 0) return 0;
      const total = states.reduce((a, s) => a + s.totalReviews, 0);
      const correct = states.reduce((a, s) => a + s.correctReviews, 0);
      return total > 0 ? Math.round((correct / total) * 100) : 0;
    },

    reset() {
      this._states = {};
      this.save();
      ReviewLog.reset();
    }
  };

  // ===== APP STATE =====
  const App = {
    config: null,
    allCards: [],
    studyQueue: [],
    studyIndex: 0,
    sessionXP: 0,
    sessionCorrect: 0,
    sessionTotal: 0,
    isFlipped: false,
    currentDeckFilter: null,
    currentTagFilter: null,
    currentFolderFilter: null,
    imageIndex: new Map(),   // Dateiname/Pfad → { path, sha }
    imageUrls: new Map(),    // sha → Object-URL

    // ----- Config Validation -----
    _validateConfig(config) {
      if (!config || typeof config !== 'object') return null;
      if (!config.owner || !config.repo) return null;
      if (!SAFE_PARAM.test(config.owner) || !SAFE_PARAM.test(config.repo)) return null;
      if (config.branch && !SAFE_PARAM.test(config.branch)) return null;
      config.branch = config.branch || 'main';
      if (config.token && !SAFE_TOKEN.test(config.token)) return null;
      GitHub.token = config.token || null;
      config.newPerDay = Math.min(Math.max(1, parseInt(config.newPerDay) || DEFAULT_NEW_PER_DAY), 999);
      // Lernverfahren (FSRS F3): unbekannte Werte → Standard
      if (!window.FSRS.ALGORITHMS.includes(config.algorithm)) config.algorithm = window.FSRS.DEFAULT_ALGORITHM;
      if (!window.FSRS.RETENTION_OPTIONS.includes(config.retention)) config.retention = window.FSRS.DEFAULT_RETENTION;
      return config;
    },

    // ----- Init -----
    async init() {
      Stats.load();
      CardStore.load();
      GoalsUI.init();
      Celebrate.init();
      PomodoroUI.init(); // vor dem Kartenladen: Timer funktioniert auch ohne Karten
      const rawConfig = load(STORAGE_KEYS.config);
      this.config = this._validateConfig(rawConfig);
      if (rawConfig && !this.config) {
        console.warn('Ungültige Config gefunden, wird verworfen');
        localStorage.removeItem(STORAGE_KEYS.config);
      }
      this._bindEvents();

      if (!this.config) {
        this.showScreen('setup');
      } else {
        await this.loadCards();
      }

      // Update-Bestätigung nach Reload
      if (sessionStorage.getItem('sc_updated')) {
        sessionStorage.removeItem('sc_updated');
        this.showToast(`App aktualisiert auf ${APP_VERSION} ✓`);
      }
    },

    // ----- Events -----
    _bindEvents() {
      // Toast soll keine Klicks durchlassen
      document.getElementById('toast').addEventListener('click', (e) => e.stopPropagation());

      // Lightbox: Pinch = zoomen, Doppeltipp = 1x/2,5x, Tap daneben / ✕ = schließen
      const lightbox = document.getElementById('lightbox');
      const lbImg = document.getElementById('lightbox-img');
      const lbScroll = lightbox.querySelector('.lightbox-scroll');
      let pinch = null;
      let lastTap = 0;

      // Zoom über die Bildbreite (nicht transform) → der Scroll-Container kann normal verschieben
      const setZoom = (scale, cx, cy) => {
        scale = Math.min(Math.max(scale, 1), 5);
        const prev = this._lbScale || 1;
        this._lbScale = scale;
        lbImg.classList.toggle('zoomed', scale > 1);
        lbImg.style.width = scale > 1 ? `${scale * 100}%` : '';
        // Punkt unter den Fingern an Ort und Stelle halten
        const ratio = scale / prev;
        lbScroll.scrollLeft = (lbScroll.scrollLeft + cx) * ratio - cx;
        lbScroll.scrollTop = (lbScroll.scrollTop + cy) * ratio - cy;
      };
      this._resetLightboxZoom = () => { this._lbScale = 1; lbImg.style.width = ''; lbImg.classList.remove('zoomed'); };

      const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
      lbScroll.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          pinch = { d: dist(e.touches), s: this._lbScale || 1 };
        }
      }, { passive: true });
      lbScroll.addEventListener('touchmove', (e) => {
        if (!pinch || e.touches.length !== 2) return;
        e.preventDefault();
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        setZoom(pinch.s * dist(e.touches) / pinch.d, cx, cy);
      }, { passive: false });
      lbScroll.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) pinch = null;
      });

      lightbox.addEventListener('click', (e) => {
        e.stopPropagation();
        if (e.target !== lbImg) {
          lightbox.classList.add('hidden');
          return;
        }
        // Doppeltipp (bzw. Doppelklick am Mac) wechselt zwischen 1x und 2,5x
        const now = Date.now();
        if (now - lastTap < 300) {
          setZoom((this._lbScale || 1) > 1 ? 1 : 2.5, e.clientX, e.clientY);
          lastTap = 0;
        } else {
          lastTap = now;
        }
      });
      // Setup form
      document.getElementById('setup-form').addEventListener('submit', (e) => {
        e.preventDefault();
        this._handleSetup();
      });

      // Navigation
      document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
          const screen = btn.dataset.screen;
          this.showScreen(screen === 'dashboard' && !this.config ? 'setup' : screen);
        });
      });

      // Dashboard
      document.getElementById('btn-refresh').addEventListener('click', () => this._refresh());
      document.getElementById('btn-start-study').addEventListener('click', () => this._startStudy());

      // Study
      // Zurück-Pfeil = Kartenrunde bewusst verlassen (E6); der Weg zum Timer hält sie offen
      document.getElementById('btn-back-study').addEventListener('click', () => {
        this._endStudyRound();
        this.showScreen('dashboard');
      });
      document.getElementById('btn-show-answer').addEventListener('click', () => this._flipCard());
      document.getElementById('flashcard').addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'flashcard') {
          e.preventDefault();
          e.currentTarget.click();
        }
      });
      document.getElementById('flashcard').addEventListener('click', () => {
        if (!this.isFlipped) {
          // Bei Multiple-Choice erst auswählen, dann bewusst "Prüfen" tippen
          if (!this._currentCard()?.options) this._flipCard();
        } else {
          this._unflipCard();
        }
      });

      // Rating buttons
      document.querySelectorAll('.btn-rate').forEach(btn => {
        btn.addEventListener('click', () => {
          const quality = parseInt(btn.dataset.quality);
          this._rateCard(quality);
        });
      });

      // Complete
      document.getElementById('btn-back-dashboard').addEventListener('click', () => this.showScreen('dashboard'));
      document.getElementById('btn-continue-study').addEventListener('click', () => {
        if (this.currentGoalId) this._startGoalStudy(this.currentGoalId);
        else this._startStudy();
      });

      // Settings
      document.getElementById('btn-change-repo').addEventListener('click', () => {
        this.showScreen('setup');
        this._populateSetup();
      });

      document.getElementById('btn-check-update').addEventListener('click', () => this._checkForUpdate());

      document.getElementById('btn-reset-progress').addEventListener('click', () => {
        if (confirm('Fortschritt wirklich zurücksetzen? Alle Lernstände gehen verloren!')) {
          CardStore.reset();
          Stats._data = null;
          localStorage.removeItem(STORAGE_KEYS.stats);
          this.showToast('Fortschritt zurückgesetzt');
          this.showScreen('dashboard');
        }
      });

      document.getElementById('settings-new-per-day').addEventListener('change', (e) => {
        if (this.config) {
          this.config.newPerDay = parseInt(e.target.value);
          save(STORAGE_KEYS.config, this.config);
        }
      });

      document.getElementById('settings-show-xp').addEventListener('change', (e) => {
        if (this.config) {
          this.config.showXP = e.target.checked;
          save(STORAGE_KEYS.config, this.config);
        }
      });
    },

    // ----- Setup -----
    _handleSetup() {
      const owner = document.getElementById('setup-owner').value.trim();
      const repo = document.getElementById('setup-repo').value.trim();
      const folder = document.getElementById('setup-folder').value.trim();
      const branch = document.getElementById('setup-branch').value.trim() || 'main';
      const token = document.getElementById('setup-token').value.trim();

      if (!owner || !repo) return;

      // Input-Validierung
      if (!SAFE_PARAM.test(owner) || !SAFE_PARAM.test(repo) || !SAFE_PARAM.test(branch)) {
        this.showToast('Ungültige Zeichen! Nur a-z, 0-9, . _ - erlaubt.');
        return;
      }
      if (token && !SAFE_TOKEN.test(token)) {
        this.showToast('Ungültiger Token – bitte vollständig kopieren.');
        return;
      }

      const prev = this.config || {};
      this.config = {
        owner, repo, folder, branch, token: token || undefined,
        newPerDay: prev.newPerDay || DEFAULT_NEW_PER_DAY,
        showXP: prev.showXP !== false,
        algorithm: prev.algorithm || window.FSRS.DEFAULT_ALGORITHM,
        retention: prev.retention || window.FSRS.DEFAULT_RETENTION,
      };
      GitHub.token = token || null;
      save(STORAGE_KEYS.config, this.config);
      this.loadCards();
    },

    _populateSetup() {
      if (!this.config) return;
      document.getElementById('setup-owner').value = this.config.owner || '';
      document.getElementById('setup-repo').value = this.config.repo || '';
      document.getElementById('setup-folder').value = this.config.folder || '';
      document.getElementById('setup-branch').value = this.config.branch || 'main';
      document.getElementById('setup-token').value = this.config.token || '';
    },

    // ----- Load Cards from GitHub -----
    async loadCards() {
      this.showScreen('loading');

      try {
        const { owner, repo, branch, folder } = this.config;
        const tree = await GitHub.fetchTree(owner, repo, branch);

        // Bilder indexieren: Obsidian verlinkt meist nur den Dateinamen, daher Name UND Pfad
        this.imageIndex = new Map();
        tree.filter(f => IMAGE_EXT.test(f.path)).forEach(f => {
          const entry = { path: f.path, sha: f.sha };
          this.imageIndex.set(f.path, entry);
          const name = f.path.split('/').pop();
          if (!this.imageIndex.has(name)) this.imageIndex.set(name, entry);
        });

        // Filter by folder if set
        let mdFiles = tree.filter(f => f.path.endsWith('.md'));
        if (folder) {
          const prefix = folder.endsWith('/') ? folder : folder + '/';
          mdFiles = mdFiles.filter(f => f.path.startsWith(prefix));
        }

        // DoS-Schutz: Datei-Anzahl begrenzen
        if (mdFiles.length > MAX_FILES) {
          console.warn(`${mdFiles.length} Dateien gefunden, auf ${MAX_FILES} begrenzt`);
          mdFiles = mdFiles.slice(0, MAX_FILES);
        }

        // Batch-Loading: nicht alle gleichzeitig fetchen
        this.allCards = [];
        for (let i = 0; i < mdFiles.length; i += FETCH_BATCH_SIZE) {
          const batch = mdFiles.slice(i, i + FETCH_BATCH_SIZE);
          const results = await Promise.all(
            batch.map(async (file) => {
              try {
                const content = await GitHub.fetchFile(owner, repo, branch, file.path);
                return Parser.extractCards(content, file.path);
              } catch {
                return [];
              }
            })
          );
          this.allCards.push(...results.flat());
        }

        // Cache timestamp
        save(STORAGE_KEYS.cache, { lastFetch: new Date().toISOString(), cardCount: this.allCards.length });

        this.showScreen('dashboard');
      } catch (err) {
        console.error('Load error:', err);
        this.showScreen('setup');
        this.showToast('Fehler: ' + err.message);
      }
    },

    async _refresh() {
      const btn = document.getElementById('btn-refresh');
      btn.classList.add('spinning');
      await this.loadCards();
      btn.classList.remove('spinning');
      this.showToast(this.allCards.length + ' Karten geladen');
    },

    // ----- Screen Management -----
    showScreen(name) {
      this.currentScreen = name;
      document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
      const screen = document.getElementById(name + '-screen');
      if (screen) {
        screen.classList.remove('hidden');
      }

      // Update nav
      document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.screen === name);
      });

      // Render screen content
      if (name === 'dashboard') this._renderDashboard();
      if (name === 'stats') this._renderStats();
      if (name === 'settings') this._renderSettings();
      if (name === 'pomodoro') PomodoroUI.render();
      if (name === 'dashboard') PomodoroUI.renderTile();
      if (name === 'dashboard') GoalsUI.renderTile();
      if (name === 'dashboard') GoalsUI.renderCards();
      if (name === 'goals') GoalsUI.renderList();

      if (name === 'study') PomodoroUI.renderMini();
      this._maybeApplyUpdate();
    },

    _endStudyRound() {
      this.studyActive = false;
      this._maybeApplyUpdate();
    },

    // Update nur ohne aktive Kartenrunde und ohne gestartete/ungeklärte Pomodoro-Phase –
    // unabhängig vom sichtbaren Screen (Pflichtenheft Abschnitt 5)
    _updateBlocked() {
      return !!this.studyActive || PomodoroUI.isActive();
    },

    _maybeApplyUpdate() {
      if (!this._pendingUpdate || this._updateBlocked()) return;
      const apply = this._pendingUpdate;
      this._pendingUpdate = null;
      apply();
    },

    // ----- Dashboard -----
    _renderDashboard() {
      const visibleCards = this._getFilteredCards();
      const dueCards = visibleCards.filter(c => CardStore.isDue(c.id, c));
      const newCards = visibleCards.filter(c => CardStore.isNew(c.id));
      const availableNew = this._plannedNew(visibleCards).length;

      // Stats bar
      document.getElementById('dash-streak').textContent = Stats.data.streak;
      document.getElementById('dash-xp').textContent = Stats.data.xp;
      document.getElementById('dash-level').textContent = Stats.level;

      // Level progress
      const progress = (Stats.xpInLevel / XP_PER_LEVEL) * 100;
      document.getElementById('dash-level-progress').style.width = progress + '%';
      document.getElementById('dash-level-text').textContent =
        Stats.xpInLevel + ' / ' + XP_PER_LEVEL + ' XP bis Level ' + (Stats.level + 1);

      // Daily stats: echte Zahlen anzeigen (Neue = alle neuen, nicht gekappt)
      document.getElementById('dash-due').textContent = dueCards.length;
      document.getElementById('dash-new').textContent = newCards.length;
      document.getElementById('dash-reviewed').textContent = Stats.getTodayReviews();

      // Study button: gekappt (was du tatsächlich lernst)
      const totalStudy = dueCards.length + availableNew;
      const studyBtn = document.getElementById('btn-start-study');
      if (totalStudy > 0) {
        studyBtn.textContent = `Lernen starten (${totalStudy})`;
        studyBtn.disabled = false;
        studyBtn.style.opacity = '1';
      } else {
        studyBtn.textContent = 'Keine Karten fällig';
        studyBtn.disabled = true;
        studyBtn.style.opacity = '0.5';
      }

      // Tag filter + Deck list
      this._renderTagFilter();
      this._renderDecks();
    },

    // ----- Tag Filter -----
    // Tag "Semester-4/Rechnernetze" → Ordner "Semester-4", Fach "Rechnernetze"
    // Tag ohne "/" → Ordner "" (Allgemein)
    _splitTag(tag) {
      const idx = tag.lastIndexOf('/');
      return idx === -1
        ? { folder: '', subject: tag }
        : { folder: tag.slice(0, idx), subject: tag.slice(idx + 1) };
    },

    _cardFolders(card) {
      if (card.tags.length === 0) return [''];
      return card.tags.map(t => this._splitTag(t).folder);
    },

    _folderLabel(folder) {
      return folder ? folder.replace(/[-_]/g, ' ').replace(/\//g, ' › ') : 'Allgemein';
    },

    _getFilteredCards() {
      let cards = this.allCards;
      if (this.currentFolderFilter !== null) {
        cards = cards.filter(c => this._cardFolders(c).includes(this.currentFolderFilter));
      }
      if (this.currentTagFilter) {
        cards = cards.filter(c => c.tags.includes(this.currentTagFilter));
      }
      return cards;
    },

    _renderTagFilter() {
      this._renderFolderRow();
      this._renderSubjectRow();
    },

    _renderFolderRow() {
      const container = document.getElementById('folder-filter');
      const folders = new Set();
      this.allCards.forEach(c => this._cardFolders(c).forEach(f => folders.add(f)));

      // Ordner-Zeile nur zeigen, wenn es echte Ordner gibt
      if (![...folders].some(Boolean)) {
        this.currentFolderFilter = null;
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
      }
      if (this.currentFolderFilter !== null && !folders.has(this.currentFolderFilter)) {
        this.currentFolderFilter = null;
      }

      container.classList.remove('hidden');
      // Benannte Ordner alphabetisch, "Allgemein" ans Ende
      const sorted = [...folders].sort((a, b) => {
        if (!a) return 1;
        if (!b) return -1;
        return a.localeCompare(b, 'de', { numeric: true });
      });

      container.innerHTML =
        `<button class="tag-chip folder-chip ${this.currentFolderFilter === null ? 'active' : ''}" data-all="1">Alle Ordner</button>` +
        sorted.map(folder => {
          const isActive = this.currentFolderFilter === folder;
          return `<button class="tag-chip folder-chip ${isActive ? 'active' : ''}" data-folder="${escapeHTML(folder)}">${escapeHTML(this._folderLabel(folder))}</button>`;
        }).join('');

      container.querySelectorAll('.tag-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          this.currentFolderFilter = btn.dataset.all ? null : btn.dataset.folder;
          this.currentTagFilter = null;
          this._renderDashboard();
        });
      });
    },

    _renderSubjectRow() {
      const container = document.getElementById('tag-filter');
      // Nur Fächer des gewählten Ordners anbieten
      const subjects = new Map(); // tag → Anzeigename
      this.allCards.forEach(c => c.tags.forEach(t => {
        const { folder, subject } = this._splitTag(t);
        if (this.currentFolderFilter === null || this.currentFolderFilter === folder) {
          subjects.set(t, subject);
        }
      }));

      if (subjects.size === 0) {
        this.currentTagFilter = null;
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
      }
      if (this.currentTagFilter && !subjects.has(this.currentTagFilter)) {
        this.currentTagFilter = null;
      }

      container.classList.remove('hidden');
      const sorted = [...subjects.entries()].sort((a, b) => a[1].localeCompare(b[1], 'de'));

      container.innerHTML =
        `<button class="tag-chip ${!this.currentTagFilter ? 'active' : ''}" data-tag="">Alle</button>` +
        sorted.map(([tag, subject]) => {
          const isActive = this.currentTagFilter === tag;
          return `<button class="tag-chip ${isActive ? 'active' : ''}" data-tag="${escapeHTML(tag)}">${escapeHTML(subject)}</button>`;
        }).join('');

      container.querySelectorAll('.tag-chip').forEach(btn => {
        btn.addEventListener('click', () => {
          this.currentTagFilter = btn.dataset.tag || null;
          this._renderDashboard();
        });
      });
    },

    _renderDecks() {
      const container = document.getElementById('deck-list');
      const deckMap = {};
      const visibleCards = this._getFilteredCards();

      visibleCards.forEach(card => {
        if (!deckMap[card.deck]) deckMap[card.deck] = { total: 0, due: 0, new: 0 };
        deckMap[card.deck].total++;
        if (CardStore.isDue(card.id, card)) deckMap[card.deck].due++;
        if (CardStore.isNew(card.id)) deckMap[card.deck].new++;
      });

      if (Object.keys(deckMap).length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">&#x1F4DA;</div>
            <h3>Keine Lernkarten gefunden</h3>
            <p>Füge <code>## Lernkarten</code> mit <code>Q:</code>/<code>A:</code>-Paaren in deine Markdown-Dateien ein.</p>
          </div>`;
        return;
      }

      container.innerHTML = Object.entries(deckMap)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, info]) => {
          const totalAvailable = info.due + info.new;
          const hasDue = totalAvailable > 0;
          const safeName = escapeHTML(name);
          return `
            <button class="deck-item" data-deck="${safeName}">
              <span class="deck-item-name">${safeName}</span>
              <span class="deck-item-count ${hasDue ? 'has-due' : ''}">${hasDue ? totalAvailable + ' fällig' : info.total + ' Karten'}</span>
            </button>`;
        })
        .join('');

      // Deck click events
      container.querySelectorAll('.deck-item').forEach(item => {
        item.addEventListener('click', () => {
          this.currentDeckFilter = item.dataset.deck;
          this._startStudy(item.dataset.deck);
        });
      });
    },

    // ----- Study Session -----
    // Neue Karten für heute aus `cards`:
    // - Karten laufender Lernziele nach deren Tagesplan (Z2),
    // - alle übrigen nach "Neue Karten pro Tag" – dabei zählen nur Nicht-Ziel-Karten zum Limit.
    _plannedNew(cards) {
      const newPerDay = this.config?.newPerDay || DEFAULT_NEW_PER_DAY;
      const goalIds = GoalsUI.runningCardIds();
      const t = today();
      const learnedToday = this.allCards.filter(c => {
        if (goalIds.has(c.id)) return false;
        const state = CardStore.states[c.id];
        return state && state.lastReview === t && state.totalReviews === 1;
      }).length;
      const remaining = Math.max(0, newPerDay - learnedToday);
      const plain = cards.filter(c => CardStore.isNew(c.id) && !goalIds.has(c.id)).slice(0, remaining);
      const inScope = new Set(cards.map(c => c.id));
      const fromGoals = GoalsUI.plannedNewCards().filter(c => inScope.has(c.id));
      return [...plain, ...fromGoals];
    },

    _startStudy(deckFilter) {
      this.currentGoalId = null;

      // Tag-Filter anwenden, dann optional Deck-Filter
      let cards = this._getFilteredCards();
      if (deckFilter) {
        cards = cards.filter(c => c.deck === deckFilter);
      }

      // Get due cards and new cards
      const dueCards = cards.filter(c => CardStore.isDue(c.id, c));
      const selectedNew = this._plannedNew(cards);

      // Build queue: due first, then new
      this._beginRound([...dueCards, ...selectedNew], 'Keine Karten fällig!');
    },

    // Lernrunde nur mit den Karten eines Ziels – neue Karten nach dessen Tagesplan (Z2)
    _startGoalStudy(goalId) {
      const goal = GoalsUI.goals.find(g => g.id === goalId);
      if (!goal) return;
      const task = GoalsUI.todayTask(goal);
      this.currentGoalId = goal.id;
      this.goalRoundStart = task.knowledge;
      const empty = task.knowledge.total === 0 ? 'Für dieses Ziel gibt es keine Karten.'
        : task.plan.phase === 'learn' ? 'Tagesziel schon erledigt ✓' : 'Heute ist nichts fällig ✓';
      this._beginRound([...task.dueCards, ...task.newCards], empty);
    },

    _beginRound(queue, emptyMessage) {
      this.studyQueue = queue;

      if (this.studyQueue.length === 0) {
        this.showToast(emptyMessage);
        return;
      }

      // Shuffle
      for (let i = this.studyQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.studyQueue[i], this.studyQueue[j]] = [this.studyQueue[j], this.studyQueue[i]];
      }

      this.studyIndex = 0;
      this.sessionXP = 0;
      this.sessionCorrect = 0;
      this.sessionTotal = 0;
      this.studyActive = true;

      this.showScreen('study');
      this._showCurrentCard();
    },

    _showCurrentCard() {
      if (this.studyIndex >= this.studyQueue.length) {
        this._showComplete();
        return;
      }

      const card = this.studyQueue[this.studyIndex];
      const total = this.studyQueue.length;

      // Reset flip
      this.isFlipped = false;
      this._setFlipped(false, false);
      document.getElementById('flashcard').classList.toggle('is-mc', !!card.options);
      // Normale Karten werden per Tap umgedreht – den Knopf braucht nur Multiple Choice ("Prüfen")
      document.getElementById('show-answer-container').classList.toggle('hidden', !card.options);
      document.querySelector('.study-actions').classList.toggle('reserve', !card.options);
      document.getElementById('rating-container').classList.add('hidden');

      // Progress
      document.getElementById('study-counter').textContent = `${this.studyIndex + 1} / ${total}`;
      document.getElementById('study-source').textContent = card.deck;
      document.getElementById('study-progress-fill').style.width =
        ((this.studyIndex / total) * 100) + '%';

      // Render question and answer
      const questionEl = document.getElementById('card-question');
      const answerEl = document.getElementById('card-answer');
      questionEl.innerHTML = Parser.renderMarkdown(card.question);
      answerEl.innerHTML = Parser.renderMarkdown(card.answer);

      document.querySelectorAll('.btn-rate.suggested').forEach(b => b.classList.remove('suggested'));
      document.getElementById('btn-show-answer').textContent = card.options ? 'Prüfen' : 'Antwort zeigen';
      if (card.options) this._renderMcOptions(card, questionEl);

      // Render LaTeX
      this._renderKaTeX(questionEl);
      this._renderKaTeX(answerEl);
      this._hydrateImages(questionEl);
      this._hydrateImages(answerEl);

      // Show interval previews
      const state = CardStore.getState(card.id);
      const previews = Scheduler.previewIntervals(state);
      for (const q of [1, 3, 4, 5]) previews[q] = GoalsUI.cappedDays(card, previews[q]);
      document.getElementById('interval-again').textContent = formatInterval(previews[1]);
      document.getElementById('interval-hard').textContent = formatInterval(previews[3]);
      document.getElementById('interval-good').textContent = formatInterval(previews[4]);
      document.getElementById('interval-easy').textContent = formatInterval(previews[5]);
    },

    _currentCard() {
      return this.studyQueue[this.studyIndex] || null;
    },

    // ----- Multiple Choice -----
    _renderMcOptions(card, questionEl) {
      // Reihenfolge jedes Mal neu mischen, damit man sich nicht die Position merkt
      const order = card.options.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      this.mcOrder = order;
      this.mcSelected = new Set();

      const list = document.createElement('div');
      list.className = 'mc-options';
      order.forEach(i => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mc-option';
        btn.dataset.i = i;
        btn.innerHTML = `<span class="mc-box"></span><span class="mc-text">${Parser.renderMarkdown(card.options[i].text)}</span>`;
        btn.addEventListener('click', (e) => {
          e.stopPropagation(); // Auswahl soll die Karte nicht umdrehen
          if (this.mcSelected.has(i)) this.mcSelected.delete(i); else this.mcSelected.add(i);
          btn.classList.toggle('selected', this.mcSelected.has(i));
        });
        list.appendChild(btn);
      });
      questionEl.appendChild(list);
      list.querySelectorAll('.mc-text').forEach(el => this._renderKaTeX(el));
    },

    _renderMcResult(card) {
      const answerEl = document.getElementById('card-answer');
      let right = 0;
      const rows = this.mcOrder.map(i => {
        const opt = card.options[i];
        const picked = this.mcSelected.has(i);
        const ok = picked === opt.correct;
        if (ok) right++;
        // ✓ richtig angekreuzt · ✗ falsch angekreuzt · ! übersehen · leer: richtig weggelassen
        const state = opt.correct ? (picked ? 'hit' : 'missed') : (picked ? 'wrong' : 'skip');
        const icon = { hit: '✓', wrong: '✗', missed: '!', skip: '' }[state];
        const hint = { hit: 'richtig', wrong: 'falsch angekreuzt', missed: 'übersehen', skip: '' }[state];
        return `<div class="mc-result ${state}"><span class="mc-icon">${icon}</span>` +
          `<span class="mc-text">${Parser.renderMarkdown(opt.text)}${hint ? `<small>${hint}</small>` : ''}</span></div>`;
      }).join('');

      const total = card.options.length;
      const perfect = right === total;
      answerEl.innerHTML =
        `<p class="mc-summary ${perfect ? 'perfect' : ''}">${perfect ? 'Alles richtig! 🎉' : `${right} von ${total} Aussagen richtig beurteilt`}</p>` +
        `<div class="mc-results">${rows}</div>` +
        (card.answer ? `<div class="mc-explanation">${Parser.renderMarkdown(card.answer)}</div>` : '');
      this._renderKaTeX(answerEl);
      this._hydrateImages(answerEl);

      // Bewertung vorschlagen – entscheiden darf der Nutzer trotzdem selbst
      document.querySelectorAll('.btn-rate.suggested').forEach(b => b.classList.remove('suggested'));
      document.querySelector(`.btn-rate[data-quality="${perfect ? 4 : 1}"]`)?.classList.add('suggested');
    },

    _flipCard() {
      if (this.isFlipped) return;
      const card = this._currentCard();
      if (card?.options) this._renderMcResult(card);
      this.isFlipped = true;
      this._setFlipped(true);
      document.getElementById('show-answer-container').classList.add('hidden');
      document.getElementById('rating-container').classList.remove('hidden');
    },

    _unflipCard() {
      if (!this.isFlipped) return;
      this.isFlipped = false;
      this._setFlipped(false);
      document.getElementById('show-answer-container').classList.toggle('hidden', !this._currentCard()?.options);
      document.getElementById('rating-container').classList.add('hidden');
    },

    // Seite wechseln: halb zusammenklappen → Seite tauschen → aufklappen
    _setFlipped(flipped, animate = true) {
      const card = document.getElementById('flashcard');
      const inner = document.getElementById('flashcard-inner');
      const apply = () => {
        card.classList.toggle('flipped', flipped);
        card.querySelectorAll('.flashcard-front, .flashcard-back').forEach(f => { f.scrollTop = 0; });
      };
      clearTimeout(this._flipTimer);
      inner.classList.remove('flip-out', 'flip-in');
      if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        apply();
        return;
      }
      inner.classList.add('flip-out');
      this._flipTimer = setTimeout(() => {
        inner.classList.remove('flip-out');
        apply();
        inner.classList.add('flip-in');
        this._flipTimer = setTimeout(() => inner.classList.remove('flip-in'), 160);
      }, 150);
    },

    _rateCard(quality) {
      const card = this.studyQueue[this.studyIndex];

      // Lernstand aktualisieren (FSRS oder SM-2)
      CardStore.updateState(card.id, quality);

      // If wrong, add back to queue for re-review
      if (quality < 3) {
        const laterIndex = Math.min(
          this.studyIndex + 3 + Math.floor(Math.random() * 3),
          this.studyQueue.length
        );
        this.studyQueue.splice(laterIndex, 0, card);
      }

      // Stats
      const xpEarned = Stats.addReview(quality);
      this.sessionXP += xpEarned;

      // Lernziele: Meilensteine, Tagesziel, Zielmarke (Z5)
      const goalEvents = GoalsUI.afterRating(card);
      this.sessionXP += goalEvents.reduce((sum, e) => sum + e.xp, 0);
      Celebrate.show(goalEvents);
      this.sessionTotal++;
      if (quality >= 3) this.sessionCorrect++;

      // XP popup (nur wenn aktiviert)
      const showXP = this.config?.showXP !== false;
      if (showXP) {
        this._showXPPopup('+' + xpEarned + ' XP');
      }

      // Next card
      this.studyIndex++;
      this._showCurrentCard();
    },

    _showXPPopup(text) {
      const popup = document.createElement('div');
      popup.className = 'xp-popup';
      popup.textContent = text;
      document.body.appendChild(popup);
      setTimeout(() => popup.remove(), 1000);
    },

    _renderKaTeX(element) {
      if (typeof renderMathInElement === 'function') {
        renderMathInElement(element, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false },
          ],
          throwOnError: false,
        });
      }
    },

    // ----- Complete Screen -----
    _showComplete() {
      this.studyActive = false; // Runde abgeschlossen → hebt ihren Teil der Update-Sperre auf
      this.showScreen('complete');
      document.getElementById('complete-total').textContent = this.sessionTotal;
      document.getElementById('complete-xp').textContent = '+' + this.sessionXP;
      const accuracy = this.sessionTotal > 0
        ? Math.round((this.sessionCorrect / this.sessionTotal) * 100)
        : 0;
      document.getElementById('complete-accuracy').textContent = accuracy + '%';
      GoalsUI.renderComplete(this.currentGoalId, this.goalRoundStart);
    },

    // ----- Stats Screen -----
    _renderStats() {
      document.getElementById('stats-total-cards').textContent = this.allCards.length;
      document.getElementById('stats-learned').textContent = CardStore.getLearnedCount();
      document.getElementById('stats-mature').textContent = CardStore.getMatureCount();
      document.getElementById('stats-accuracy').textContent = CardStore.getAccuracy() + '%';
      document.getElementById('stats-best-streak').textContent = Stats.data.bestStreak;
      document.getElementById('stats-total-xp').textContent = Stats.data.xp;
      document.getElementById('stats-total-reviews').textContent = Stats.data.totalReviews;
      document.getElementById('stats-best-day').textContent = Stats.data.bestDay;

      // Heatmap
      const heatmap = document.getElementById('stats-heatmap');
      const days = Stats.getLast7Days();
      const maxCount = Math.max(...days.map(d => d.count), 1);

      heatmap.innerHTML = days.map(d => {
        let level = 0;
        if (d.count > 0) level = Math.min(4, Math.ceil((d.count / maxCount) * 4));
        return `
          <div class="heatmap-day">
            <div class="heatmap-block level-${level}"></div>
            <span class="heatmap-label">${d.label}</span>
          </div>`;
      }).join('');

      PomodoroUI.renderStats();
    },

    // ----- Bilder -----
    async _hydrateImages(container) {
      const imgs = container.querySelectorAll('img.card-img[data-img]');
      for (const img of imgs) {
        const ref = img.dataset.img;
        const entry = this.imageIndex.get(ref) || this.imageIndex.get(ref.split('/').pop());
        if (!entry) {
          img.replaceWith(Object.assign(document.createElement('span'), {
            className: 'card-img-missing', textContent: `Bild nicht gefunden: ${ref}`,
          }));
          continue;
        }
        img.addEventListener('click', (e) => {
          e.stopPropagation(); // Tap aufs Bild soll die Karte nicht umdrehen
          this._openLightbox(img.src);
        });
        try {
          img.src = await this._imageUrl(entry);
        } catch {
          img.alt = 'Bild konnte nicht geladen werden';
        }
      }
    },

    // Lädt ein Bild (Cache-First, Schlüssel = Git-SHA → ändert sich das Bild, ändert sich der SHA)
    async _imageUrl({ path, sha }) {
      if (this.imageUrls.has(sha)) return this.imageUrls.get(sha);
      const key = `./__img/${sha}`;
      let blob = null;
      const cache = 'caches' in window ? await caches.open(IMAGE_CACHE).catch(() => null) : null;
      const hit = cache && await cache.match(key);
      if (hit) {
        blob = await hit.blob();
      } else {
        const { owner, repo, branch } = this.config;
        blob = await GitHub.fetchBlob(owner, repo, branch, path);
        if (cache) cache.put(key, new Response(blob)).catch(() => {});
      }
      const url = URL.createObjectURL(blob);
      this.imageUrls.set(sha, url);
      return url;
    },

    _openLightbox(src) {
      if (!src) return;
      const box = document.getElementById('lightbox');
      const img = document.getElementById('lightbox-img');
      img.src = src;
      this._resetLightboxZoom();
      box.classList.remove('hidden');
    },

    // ----- App-Update (manuell) -----
    async _checkForUpdate() {
      const btn = document.getElementById('btn-check-update');
      const status = document.getElementById('update-status');
      const setStatus = (text) => { status.textContent = text; status.classList.remove('hidden'); };
      btn.disabled = true;
      setStatus('Suche nach Updates …');

      try {
        // Neueste Version direkt vom Server lesen, an allen Caches vorbei
        const res = await fetch(`app.js?check=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status);
        const latest = ((await res.text()).match(/const APP_VERSION = '([^']+)'/) || [])[1];

        const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
        if (reg) await reg.update().catch(() => {});

        if (!latest || (latest === APP_VERSION && !(reg && reg.waiting))) {
          setStatus(`✓ Du hast die neueste Version (${APP_VERSION}).`);
          btn.disabled = false;
          return;
        }

        setStatus(`Aktualisiere auf ${latest} …`);
        // Alte App-Caches löschen (Bild-Cache bleibt), damit garantiert die neuen Dateien geladen werden
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.filter(k => k.startsWith('studycards-v')).map(k => caches.delete(k)));
        }
        sessionStorage.setItem('sc_updated', '1');
        if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); // löst controllerchange → Reload aus
        setTimeout(() => window.location.reload(), 1500); // Fallback
      } catch {
        setStatus('Keine Verbindung – bitte später erneut versuchen.');
        btn.disabled = false;
      }
    },

    // ----- Settings Screen -----
    _renderSettings() {
      document.getElementById('app-version').textContent = APP_VERSION;
      PomodoroUI.resetSettingsMessages(); // beim Öffnen der Einstellungen alte Hinweise ausblenden
      PomodoroUI.renderSettings();
      if (!this.config) return;
      document.getElementById('settings-owner').textContent = this.config.owner;
      document.getElementById('settings-repo').textContent = this.config.repo;
      document.getElementById('settings-folder').textContent = this.config.folder || '(Alle)';
      document.getElementById('settings-branch').textContent = this.config.branch;
      document.getElementById('settings-token').textContent = this.config.token ? 'gesetzt (privates Repo)' : '–';
      document.getElementById('settings-card-count').textContent = Object.keys(CardStore.states).length;
      document.getElementById('settings-new-per-day').value = this.config.newPerDay || DEFAULT_NEW_PER_DAY;
      document.getElementById('settings-show-xp').checked = this.config.showXP !== false;
    },

    // ----- Toast -----
    showToast(message) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.classList.remove('hidden');
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 2500);
    },
  };

  // ===== LERNZIELE: OBERFLÄCHE (Pflichtenheft Ziele, Z1/Z7) =====
  // Logik steckt in goals.js (window.Goals); hier nur Speichern, Formular und Liste.
  const GoalsUI = {
    goals: [],
    corrupt: false,
    editingId: null,
    scaleTouched: false,

    init() {
      this._load();
      const $ = (id) => document.getElementById(id);

      $('goal-tile').addEventListener('click', () => {
        $('goal-data-status').classList.add('hidden');
        App.showScreen('goals');
      });
      $('btn-back-goals').addEventListener('click', () => App.showScreen('dashboard'));
      $('goal-new').addEventListener('click', () => this.edit(null));
      $('btn-back-goal-edit').addEventListener('click', () => App.showScreen('goals'));
      $('goal-corrupt-reset').addEventListener('click', () => {
        if (!confirm('Alle gespeicherten Lernziele werden gelöscht. Fortfahren?')) return;
        this.corrupt = false;
        this.goals = [];
        if (this._save()) App.showToast('Lernziele zurückgesetzt');
        this.renderList();
      });

      $('goal-form').addEventListener('submit', (e) => {
        e.preventDefault();
        this._onSave();
      });
      $('goal-delete').addEventListener('click', () => this._onDelete());
      $('goal-archive').addEventListener('click', () => this._onArchive());
      this._bindArchive();
      this._bindBackup();
      // Hinweis eines Feldes verschwindet, sobald es geändert wird
      const clearFieldError = (e) => {
        e.target.removeAttribute('aria-invalid');
        const err = e.target.closest('.goal-field, .pomo-field')?.querySelector('.pomo-field-error');
        if (err) err.textContent = '';
      };
      $('goal-form').addEventListener('input', clearFieldError);
      $('goal-form').addEventListener('change', clearFieldError);

      $('goal-folder').addEventListener('change', () => {
        const folder = this._selectedFolder();
        if (!this.scaleTouched) this._setScale(this._guessScale(folder));
        this._renderTopics(folder, []);
        this._renderPreview();
      });
      document.querySelectorAll('input[name="goal-scale"]').forEach(r => r.addEventListener('change', () => {
        this.scaleTouched = true;
        this._renderGrades(null);
        this._renderTargetInfo();
        this._renderPreview();
      }));
      $('goal-grades').addEventListener('change', () => {
        this._renderTargetInfo();
        this._renderPreview();
      });
      $('goal-topic-list').addEventListener('change', (e) => this._onTopicChange(e.target));
      ['goal-date', 'goal-buffer', 'goal-target'].forEach(id => $(id).addEventListener('input', () => {
        if (id === 'goal-target') this._renderTargetInfo();
        this._renderPreview();
      }));

      // Änderungen aus einem anderen Tab übernehmen
      window.addEventListener('storage', (e) => {
        if (e.key !== window.Goals.STORAGE_KEY) return;
        this._load();
        if (App.currentScreen === 'goals') this.renderList();
        if (App.currentScreen === 'dashboard') { this.renderTile(); this.renderCards(); }
      });
    },

    // ----- Speichern (Z7) -----
    _load() {
      let raw = null;
      try { raw = localStorage.getItem(window.Goals.STORAGE_KEY); } catch {}
      const res = window.Goals.parse(raw);
      this.corrupt = !res.ok;
      this.goals = res.ok ? res.value : [];
    },

    _save() {
      if (this.corrupt) return false; // beschädigte Daten nie stillschweigend überschreiben
      try {
        localStorage.setItem(window.Goals.STORAGE_KEY, window.Goals.serialize(this.goals));
        return true;
      } catch {
        App.showToast('Speichern fehlgeschlagen – Speicher voll?');
        return false;
      }
    },

    active() {
      return this.goals.filter(g => !g.archived);
    },

    // ----- Kartenumfang -----
    // Ordner → Map(Tag → { label, count }) aus den geladenen Karten
    _folderIndex() {
      const index = new Map();
      for (const card of App.allCards) {
        if (card.tags.length === 0) {
          if (!index.has('')) index.set('', new Map());
          continue;
        }
        for (const tag of card.tags) {
          const { folder, subject } = App._splitTag(tag);
          if (!index.has(folder)) index.set(folder, new Map());
          const topics = index.get(folder);
          const entry = topics.get(tag) || { label: this._topicLabel(subject), count: 0 };
          entry.count++;
          topics.set(tag, entry);
        }
      }
      return index;
    },

    _topicLabel(subject) {
      return subject.replace(/[-_]/g, ' ');
    },

    _guessScale(folder) {
      return /^semester/i.test(folder || '') ? 'uni' : 'school';
    },

    // ----- Formular -----
    // id: bestehendes Ziel bearbeiten · template: neues Ziel aus Vorlage (Archiv → "Als neues Ziel")
    edit(id, template = null) {
      const G = window.Goals;
      const existing = id ? this.goals.find(g => g.id === id) : null;
      this.editingId = existing ? existing.id : null;
      const goal = existing || template; // Werte zum Vorbelegen
      const $ = (x) => document.getElementById(x);

      $('goal-edit-title').textContent = existing ? 'Ziel bearbeiten' : 'Neues Ziel';
      $('goal-delete').classList.toggle('hidden', !existing);
      $('goal-archive').classList.toggle('hidden', !existing);
      this._clearErrors();

      // Fachauswahl
      const index = this._folderIndex();
      const folders = [...index.keys()];
      if (goal && !index.has(goal.folder)) folders.push(goal.folder);
      folders.sort((a, b) => (a === '') - (b === '') || a.localeCompare(b, 'de', { numeric: true }));
      $('goal-folder').innerHTML = folders.length
        ? folders.map(f => `<option value="${escapeHTML(f)}">${escapeHTML(App._folderLabel(f))}${index.has(f) ? '' : ' (keine Karten)'}</option>`).join('')
        : '<option value="" disabled>Keine Karten geladen</option>';

      let folder, topics;
      if (goal) {
        folder = goal.folder;
        topics = goal.topics;
      } else {
        folder = App.currentFolderFilter !== null && index.has(App.currentFolderFilter) ? App.currentFolderFilter : (folders[0] ?? '');
        topics = App.currentTagFilter && App._splitTag(App.currentTagFilter).folder === folder ? [App.currentTagFilter] : [];
      }
      $('goal-folder').value = folder;

      this.scaleTouched = !!goal;
      this._setScale(goal ? goal.scale : this._guessScale(folder));
      this._renderTopics(folder, topics);
      this._renderGrades(goal ? goal.grade : null);

      $('goal-name').value = goal ? goal.name : '';
      $('goal-date').min = G.addDays(today(), 1);
      $('goal-date').value = goal ? goal.examDate : '';
      $('goal-buffer').value = goal ? goal.bufferDays : G.DEFAULT_BUFFER_DAYS;
      // Zielmarke nur anzeigen, wenn sie von der Note abweicht (= eigene Eingabe)
      const fromGrade = goal && goal.grade !== null ? G.targetForGrade(goal.scale, goal.grade) : null;
      $('goal-target').value = goal && goal.targetPercent !== null && goal.targetPercent !== fromGrade ? goal.targetPercent : '';

      this._renderTargetInfo();
      this._renderPreview();
      App.showScreen('goal-edit');
      if (!existing) $(template ? 'goal-date' : 'goal-name').focus({ preventScroll: true });
    },

    _selectedFolder() {
      return document.getElementById('goal-folder').value;
    },

    _selectedScale() {
      const r = document.querySelector('input[name="goal-scale"]:checked');
      return r ? r.value : 'school';
    },

    _setScale(scale) {
      document.querySelectorAll('input[name="goal-scale"]').forEach(r => { r.checked = r.value === scale; });
      this._renderGrades(null);
    },

    _selectedGrade() {
      const r = document.querySelector('input[name="goal-grade"]:checked');
      return r ? r.value : null;
    },

    _renderGrades(selected) {
      const scale = window.Goals.SCALES[this._selectedScale()];
      document.getElementById('goal-grades').innerHTML = scale.grades.map(g =>
        `<label class="goal-grade"><input type="radio" name="goal-grade" value="${escapeHTML(g)}"${g === selected ? ' checked' : ''}><span>${escapeHTML(g)}</span></label>`
      ).join('');
    },

    _renderTopics(folder, selected) {
      const topics = this._folderIndex().get(folder) || new Map();
      const sorted = [...topics.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label, 'de', { numeric: true }));
      const total = App.allCards.filter(c => window.Goals.cardMatches({ folder, topics: [] }, c)).length;
      const chip = (value, label, count, checked) =>
        `<label class="goal-topic"><input type="checkbox" value="${escapeHTML(value)}"${checked ? ' checked' : ''}><span>${escapeHTML(label)} <small>${count}</small></span></label>`;
      // Gespeicherte Themen, die es nicht mehr gibt, bleiben wählbar
      const missing = selected.filter(t => !topics.has(t));
      document.getElementById('goal-topic-list').innerHTML =
        chip('*', 'Alle Themen', total, selected.length === 0) +
        sorted.map(([tag, t]) => chip(tag, t.label, t.count, selected.includes(tag))).join('') +
        missing.map(tag => chip(tag, this._topicLabel(App._splitTag(tag).subject), 0, true)).join('');
    },

    _onTopicChange(input) {
      const boxes = [...document.querySelectorAll('#goal-topic-list input')];
      const all = boxes.find(b => b.value === '*');
      if (input === all && all.checked) {
        boxes.forEach(b => { if (b !== all) b.checked = false; });
      } else if (input !== all && input.checked) {
        all.checked = false;
      }
      if (!boxes.some(b => b.checked)) all.checked = true;
      this._renderPreview();
    },

    _selectedTopics() {
      return [...document.querySelectorAll('#goal-topic-list input:checked')]
        .map(b => b.value).filter(v => v !== '*');
    },

    _formInput() {
      const $ = (x) => document.getElementById(x);
      return {
        name: $('goal-name').value,
        folder: this._selectedFolder(),
        topics: this._selectedTopics(),
        examDate: $('goal-date').value,
        scale: this._selectedScale(),
        grade: this._selectedGrade(),
        targetPercent: $('goal-target').value.trim(),
        bufferDays: $('goal-buffer').value.trim(),
      };
    },

    _renderTargetInfo() {
      const G = window.Goals;
      const el = document.getElementById('goal-target-info');
      const own = document.getElementById('goal-target').value.trim();
      const grade = this._selectedGrade();
      if (own) {
        el.textContent = `Eigene Zielmarke: ${own} % sicher gelernte Karten.`;
      } else if (grade) {
        el.textContent = `Note ${grade} ≙ ${G.targetForGrade(this._selectedScale(), grade)} % sicher gelernte Karten – eine Richtschnur, keine Garantie.`;
      } else {
        el.textContent = 'Wähle deine Wunschnote – daraus ergibt sich, wie viel du sicher können solltest.';
      }
    },

    // Vorschau: Umfang und Tagesplan aus den aktuellen Eingaben
    _renderPreview() {
      const G = window.Goals;
      const el = document.getElementById('goal-preview');
      const input = this._formInput();
      const probe = { folder: input.folder, topics: input.topics };
      const k = G.knowledge(probe, App.allCards, CardStore.states);
      el.classList.remove('is-warn');

      if (k.total === 0) {
        el.textContent = 'Für diese Auswahl gibt es keine Karten.';
        el.classList.add('is-warn');
        return;
      }
      const parts = [`<strong>${k.total} Karten</strong>, davon ${k.newCount} neu`];
      const buffer = parseInt(input.bufferDays, 10);
      if (G.isDateKey(input.examDate) && input.examDate > today() && Number.isInteger(buffer) && buffer >= 0 && buffer <= 14) {
        const goal = { examDate: input.examDate, bufferDays: buffer };
        const days = G.daysLeft(goal, today());
        parts.push(days === 1 ? 'Prüfung morgen' : `noch ${days} Tage bis zur Prüfung`);
        const plan = G.dailyPlan(goal, { newCount: k.newCount, today: today() });
        if (plan.phase !== 'learn') {
          parts.push(k.newCount > 0
            ? `Puffertage schon erreicht – die neuen Karten werden sofort nachgeholt (bis ${G.MAX_NEW_PER_DAY} pro Tag)`
            : 'nur noch Wiederholung (Puffertage)');
          if (k.newCount > 0) el.classList.add('is-warn');
        } else if (k.newCount > 0) {
          parts.push(`ca. <strong>${plan.quota} neue ${plan.quota === 1 ? 'Karte' : 'Karten'} pro Tag</strong>`);
          if (plan.tight) {
            parts.push(`eigentlich ${plan.needed} pro Tag nötig – der Plan wird knapp`);
            el.classList.add('is-warn');
          }
        }
      }
      el.innerHTML = parts.join(' · ');
    },

    _clearErrors() {
      document.querySelectorAll('#goal-form .pomo-field-error').forEach(e => { e.textContent = ''; });
      document.querySelectorAll('#goal-form [aria-invalid]').forEach(e => e.removeAttribute('aria-invalid'));
    },

    _showErrors(errors, input) {
      // Fehler → Anzeigeort; "Note oder Zielmarke fehlt" gehört zur Note, solange keine Zielmarke eingegeben ist
      const map = {
        name: ['goal-name-error', 'goal-name'],
        folder: ['goal-folder-error', 'goal-folder'],
        topics: ['goal-topics-error', null],
        examDate: ['goal-examDate-error', 'goal-date'],
        scale: ['goal-grade-error', null],
        grade: ['goal-grade-error', null],
        bufferDays: ['goal-bufferDays-error', 'goal-buffer'],
        targetPercent: input.targetPercent ? ['goal-targetPercent-error', 'goal-target'] : ['goal-grade-error', null],
      };
      let first = null;
      for (const [field, msg] of Object.entries(errors)) {
        const [errId, inputId] = map[field] || [];
        if (!errId) continue;
        document.getElementById(errId).textContent = msg;
        const target = inputId ? document.getElementById(inputId) : document.getElementById(errId).closest('.goal-field');
        if (inputId) target.setAttribute('aria-invalid', 'true');
        if (!first) first = target;
      }
      if (first) {
        first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (first.focus && first.matches('input, select')) first.focus({ preventScroll: true });
      }
    },

    _onSave() {
      const G = window.Goals;
      if (this.corrupt) {
        App.showToast('Lernziele sind beschädigt – bitte erst zurücksetzen');
        return;
      }
      this._clearErrors();
      const input = this._formInput();
      const existing = this.editingId ? this.goals.find(g => g.id === this.editingId) : null;
      // Bestehendes Ziel mit unverändertem Datum darf auch am Prüfungstag noch umbenannt werden
      const checkDate = !(existing && existing.examDate === input.examDate);
      const res = G.validateGoal(input, {
        today: checkDate ? today() : undefined,
        id: existing ? existing.id : 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        createdAt: existing ? existing.createdAt : today(),
      });
      if (!res.ok) {
        this._showErrors(res.errors, input);
        return;
      }
      let goal = res.value;
      if (existing) {
        // Meilensteine behalten; bei geänderter Zielmarke nur die weiterhin gültigen
        const reached = existing.reached.filter(m => goal.targetPercent === existing.targetPercent ||
          (m !== 'target' && m < goal.targetPercent));
        goal = { ...goal, reached, archived: existing.archived, dailyDone: existing.dailyDone };
        this.goals = this.goals.map(g => (g.id === goal.id ? goal : g));
      } else {
        this.goals = [...this.goals, goal];
      }
      if (!this._save()) return;
      App.showToast(existing ? 'Ziel gespeichert' : 'Ziel festgelegt 🎯');
      App.showScreen('goals');
    },

    _onDelete() {
      const goal = this.goals.find(g => g.id === this.editingId);
      if (!goal || !confirm(`Ziel „${goal.name}“ löschen? Deine Karten und dein Lernfortschritt bleiben erhalten.`)) return;
      this.goals = this.goals.filter(g => g.id !== goal.id);
      if (!this._save()) return;
      App.showToast('Ziel gelöscht');
      App.showScreen('goals');
    },

    // ----- Archiv (Z6) -----
    _onArchive() {
      const goal = this.goals.find(g => g.id === this.editingId);
      if (!goal || !confirm(`Ziel „${goal.name}“ jetzt ins Archiv verschieben? Der aktuelle Wissensstand wird festgehalten.`)) return;
      const k = window.Goals.knowledge(goal, App.allCards, CardStore.states);
      this.goals = this.goals.map(g => (g.id === goal.id ? window.Goals.archive(g, { today: today(), finalPercent: k.percent }) : g));
      if (!this._save()) return;
      App.showToast('Ziel archiviert');
      App.showScreen('goals');
    },

    // Am Tag nach der Prüfung automatisch archivieren – nur mit geladenen Karten,
    // damit der festgehaltene Wissensstand stimmt
    autoArchive() {
      const G = window.Goals;
      if (this.corrupt || App.allCards.length === 0) return;
      const t = today();
      const moved = [];
      this.goals = this.goals.map(g => {
        if (!G.shouldArchive(g, t)) return g;
        moved.push(g.name);
        return G.archive(g, { today: t, finalPercent: G.knowledge(g, App.allCards, CardStore.states).percent });
      });
      if (!moved.length || !this._save()) return;
      App.showToast(moved.length === 1 ? `„${moved[0]}“ ist ins Archiv gewandert` : `${moved.length} Ziele sind ins Archiv gewandert`);
    },

    _bindArchive() {
      const list = document.getElementById('goal-archive-list');
      list.addEventListener('change', (e) => {
        const id = e.target.dataset.gradeFor;
        if (!id) return;
        this.goals = this.goals.map(g => (g.id === id ? window.Goals.setActualGrade(g, e.target.value || null) : g));
        if (this._save()) {
          App.showToast(e.target.value ? 'Note eingetragen' : 'Note entfernt');
          this.renderList(id);
        }
      });
      list.addEventListener('click', (e) => {
        const copy = e.target.closest('[data-copy]');
        const del = e.target.closest('[data-delete]');
        if (copy) {
          const goal = this.goals.find(g => g.id === copy.dataset.copy);
          if (goal) this.edit(null, window.Goals.copyTemplate(goal));
        } else if (del) {
          const goal = this.goals.find(g => g.id === del.dataset.delete);
          if (!goal || !confirm(`Archiviertes Ziel „${goal.name}“ löschen? Karten und Lernfortschritt bleiben erhalten.`)) return;
          this.goals = this.goals.filter(g => g.id !== goal.id);
          if (this._save()) {
            App.showToast('Ziel gelöscht');
            this.renderList();
          }
        }
      });
    },

    _renderArchive(openId) {
      const G = window.Goals;
      const list = this.corrupt ? [] : this.goals.filter(g => g.archived)
        .sort((a, b) => b.examDate.localeCompare(a.examDate) || a.name.localeCompare(b.name, 'de'));
      document.getElementById('goal-archive-section').classList.toggle('hidden', list.length === 0);
      document.getElementById('goal-archive-list').innerHTML = list.map(goal => {
        const a = goal.archived;
        const reached = a.finalPercent >= goal.targetPercent;
        const wish = goal.grade !== null ? ` · Wunschnote ${escapeHTML(goal.grade)}` : '';
        const options = ['<option value="">–</option>'].concat(G.ACTUAL_GRADES[goal.scale].map(gr =>
          `<option value="${escapeHTML(gr)}"${a.actualGrade === gr ? ' selected' : ''}>${escapeHTML(gr)}</option>`)).join('');
        const gradeId = 'goal-actual-' + escapeHTML(goal.id);
        return `<details class="card-panel goal-archived"${goal.id === openId ? ' open' : ''}>
          <summary class="goal-row">
            <span class="goal-row-text">
              <span class="goal-row-name">${escapeHTML(goal.name)}</span>
              <span class="goal-row-meta">${escapeHTML(this._scopeLabel(goal))} · ${escapeHTML(this._formatDate(goal.examDate))}</span>
              <span class="goal-row-meta ${reached ? 'is-reached' : ''}">${reached ? '✓ ' : ''}${a.finalPercent} % sicher · Ziel ${goal.targetPercent} %${wish}</span>
            </span>
            <span class="goal-row-badge">${a.actualGrade ? `<strong>${escapeHTML(a.actualGrade)}</strong>Note` : '<strong>–</strong>Note'}</span>
          </summary>
          <div class="goal-archived-actions">
            <label class="goal-actual" for="${gradeId}">Echte Note
              <select id="${gradeId}" data-grade-for="${escapeHTML(goal.id)}">${options}</select>
            </label>
            <button type="button" class="btn btn-secondary btn-sm" data-copy="${escapeHTML(goal.id)}">Als neues Ziel</button>
            <button type="button" class="btn btn-danger btn-sm" data-delete="${escapeHTML(goal.id)}">Löschen</button>
          </div>
        </details>`;
      }).join('');
    },

    // ----- Sicherung (Z7) -----
    _bindBackup() {
      const $ = (id) => document.getElementById(id);
      const G = window.Goals;
      const status = (text) => {
        $('goal-data-status').textContent = text;
        $('goal-data-status').classList.remove('hidden');
      };
      const count = (n, dative = false) => (n === 1 ? '1 Ziel' : `${n} ${dative ? 'Zielen' : 'Ziele'}`);

      $('goal-export').addEventListener('click', () => {
        if (this.corrupt) return status('Die gespeicherten Ziele sind beschädigt und können nicht gesichert werden.');
        const backup = G.createBackup(this.goals, Date.now());
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: `studycards-lernziele-${today()}.json` });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        status(`Sicherung mit ${count(backup.goals.length, true)} erstellt.`);
      });

      $('goal-import').addEventListener('click', () => {
        $('goal-import-file').value = '';
        $('goal-import-file').click();
      });
      $('goal-import-file').addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        let text = '';
        try { text = await file.text(); } catch { return status('Die Datei konnte nicht gelesen werden.'); }
        const res = G.parseBackup(text);
        if (!res.ok) return status(`Import abgebrochen: ${res.error} Deine Ziele sind unverändert.`);
        if (!confirm(`Sicherung importieren?\n\nAlle Lernziele auf diesem Gerät werden durch die Sicherung ersetzt (${count(res.value.length)}). Karten und Lernfortschritt bleiben unverändert.`)) return;
        this.corrupt = false; // ersetzt auch beschädigte Daten
        this.goals = res.value;
        if (!this._save()) return;
        this.renderList();
        status(`Sicherung importiert (${count(res.value.length)}).`);
      });
    },

    // ----- Anzeige -----
    _formatDate(key) {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
    },

    _scopeLabel(goal) {
      const folder = App._folderLabel(goal.folder);
      if (goal.topics.length === 0) return folder;
      return folder + ' · ' + goal.topics.map(t => this._topicLabel(App._splitTag(t).subject)).join(', ');
    },

    _daysBadge(goal) {
      const days = window.Goals.daysLeft(goal, today());
      if (days > 1) return `<strong>${days}</strong>Tage`;
      if (days === 1) return '<strong>1</strong>Tag';
      if (days === 0) return '<strong>heute</strong>';
      return '<strong>✓</strong>vorbei';
    },

    renderList(openArchivedId) {
      const G = window.Goals;
      this._renderArchive(openArchivedId);
      document.getElementById('goal-corrupt').classList.toggle('hidden', !this.corrupt);
      document.getElementById('goal-new').disabled = this.corrupt;
      const list = this.active().sort((a, b) => a.examDate.localeCompare(b.examDate) || a.name.localeCompare(b.name, 'de'));
      document.getElementById('goal-empty').classList.toggle('hidden', list.length > 0 || this.corrupt);
      const container = document.getElementById('goal-list');
      container.innerHTML = list.map(goal => {
        const k = G.knowledge(goal, App.allCards, CardStore.states);
        const grade = goal.grade !== null ? `Note ${escapeHTML(goal.grade)} · ` : '';
        return `<button type="button" class="card-panel goal-row" data-goal="${escapeHTML(goal.id)}" aria-label="${escapeHTML(goal.name)} bearbeiten">
          <span class="goal-row-text">
            <span class="goal-row-name">${escapeHTML(goal.name)}</span>
            <span class="goal-row-meta">${escapeHTML(this._scopeLabel(goal))}</span>
            <span class="goal-row-meta">${escapeHTML(this._formatDate(goal.examDate))} · ${grade}${k.percent} % von ${goal.targetPercent} %</span>
          </span>
          <span class="goal-row-badge">${this._daysBadge(goal)}</span>
        </button>`;
      }).join('');
      container.querySelectorAll('[data-goal]').forEach(btn =>
        btn.addEventListener('click', () => this.edit(btn.dataset.goal)));
    },

    // Ziele, deren Prüfung noch nicht vorbei ist (lernen, Puffer, Prüfungstag)
    running() {
      if (this.corrupt) return [];
      const t = today();
      return this.active().filter(g => window.Goals.phase(g, t) !== 'over');
    },

    // Karten-IDs aller laufenden Ziele – diese folgen dem Ziel-Tagesplan statt dem allgemeinen Limit
    runningCardIds() {
      const ids = new Set();
      for (const g of this.running()) {
        for (const c of window.Goals.goalCards(g, App.allCards)) ids.add(c.id);
      }
      return ids;
    },

    // Heute geplante neue Karten aller laufenden Ziele (früheste Prüfung zuerst, ohne Doppelte)
    plannedNewCards() {
      const seen = new Set();
      const out = [];
      const list = this.running().sort((a, b) => a.examDate.localeCompare(b.examDate));
      for (const g of list) {
        for (const c of this.todayTask(g).newCards) {
          if (!seen.has(c.id)) {
            seen.add(c.id);
            out.push(c);
          }
        }
      }
      return out;
    },

    // Prüfungsmodus (Z4)
    effectiveDue(state, card) {
      return this.corrupt ? state.nextReview : window.Goals.effectiveDue(state, card, this.goals, today());
    },

    // Intervall-Vorschau: Abstand bis zum tatsächlichen nächsten Termin (ggf. vorgezogen)
    cappedDays(card, days) {
      const t = today();
      const due = this.effectiveDue({ nextReview: window.Goals.addDays(t, days), lastReview: t }, card);
      return Math.min(days, window.Goals.daysBetween(t, due));
    },

    // Nach einer Bewertung: neu erreichte Meilensteine und erledigte Tagesziele der Ziele dieser Karte.
    // Vergibt Bonus-XP und speichert, damit jedes Ereignis nur einmal gefeiert wird.
    afterRating(card) {
      const G = window.Goals;
      const t = today();
      const events = [];
      let changed = false;
      this.goals = this.goals.map(goal => {
        if (goal.archived || G.phase(goal, t) === 'over' || !G.cardMatches(goal, card)) return goal;
        let g = goal;
        const k = G.knowledge(g, App.allCards, CardStore.states);
        const ms = G.newMilestones(g, k.percent);
        if (ms.length) {
          g = G.markReached(g, ms);
          const target = ms.includes('target');
          events.push({ type: target ? 'target' : 'milestone', goal: g, percent: k.percent,
            milestone: target ? g.targetPercent : Math.max(...ms.filter(m => m !== 'target')),
            xp: Stats.addBonus(target ? G.BONUS_XP.target : G.BONUS_XP.milestone) });
        }
        if (!(g.dailyDone || []).includes(t) && this.todayTask(g).done) {
          g = G.markDailyDone(g, t);
          events.push({ type: 'daily', goal: g, streak: G.dailyStreak(g, t), xp: Stats.addBonus(G.BONUS_XP.daily) });
        }
        if (g !== goal) changed = true;
        return g;
      });
      if (changed) this._save();
      return events;
    },

    // Heutige Aufgabe eines Ziels: fällige + geplante neue Karten (Z2)
    todayTask(goal) {
      const G = window.Goals;
      const t = today();
      const cards = G.goalCards(goal, App.allCards);
      const states = CardStore.states;
      const knowledge = G.knowledge(goal, App.allCards, states);
      const dueCards = cards.filter(c => CardStore.isDue(c.id, c));
      const fresh = cards.filter(c => CardStore.isNew(c.id));
      const learnedToday = cards.filter(c => {
        const s = states[c.id];
        return s && s.lastReview === t && s.totalReviews === 1;
      }).length;
      const plan = G.dailyPlan(goal, { newCount: fresh.length, learnedToday, today: t });
      const newCards = fresh.slice(0, plan.remainingToday);
      return {
        knowledge, plan, dueCards, newCards, learnedToday,
        done: dueCards.length === 0 && newCards.length === 0,
        streak: G.dailyStreak(goal, t),
      };
    },

    _countdown(goal) {
      const days = window.Goals.daysLeft(goal, today());
      if (days > 1) return { html: `<strong>${days}</strong> Tage`, urgent: days <= 3 };
      if (days === 1) return { html: '<strong>morgen</strong>', urgent: true };
      if (days === 0) return { html: '<strong>heute</strong>', urgent: true };
      return { html: 'vorbei', urgent: false };
    },

    // Zeile "Heute …" einer Zielkarte
    _taskLine(task) {
      const { plan, dueCards, newCards, knowledge } = task;
      const n = (count, one, many) => `<strong>${count}</strong> ${count === 1 ? one : many}`;
      if (knowledge.total === 0) return { html: 'Keine Karten für dieses Ziel gefunden', state: 'warn' };
      if (plan.phase === 'over') return { html: 'Prüfung vorbei', state: 'muted' };
      if (plan.catchUp && newCards.length) {
        const parts = [n(newCards.length, 'neue Karte', 'neue Karten')];
        if (dueCards.length) parts.push(n(dueCards.length, 'Wiederholung', 'Wiederholungen'));
        return { html: 'Nachholen: ' + parts.join(' · '), state: 'todo' };
      }
      if (plan.phase === 'exam') {
        return dueCards.length
          ? { html: `Heute ist Prüfung – viel Erfolg! 🍀 Noch ${n(dueCards.length, 'Wiederholung', 'Wiederholungen')}`, state: 'todo' }
          : { html: 'Heute ist Prüfung – viel Erfolg! 🍀', state: 'done' };
      }
      if (plan.phase === 'buffer') {
        return dueCards.length
          ? { html: `Puffertag: ${n(dueCards.length, 'Wiederholung', 'Wiederholungen')}`, state: 'todo' }
          : { html: '✓ Puffertag – heute nichts fällig' + (task.streak > 1 ? ` · 🔥 ${task.streak} Tage in Folge` : ''), state: 'done' };
      }
      if (task.done) return { html: '✓ Tagesziel erledigt' + (task.streak > 1 ? ` · 🔥 ${task.streak} Tage in Folge` : ''), state: 'done' };
      const parts = [];
      if (newCards.length) parts.push(n(newCards.length, 'neue Karte', 'neue Karten'));
      if (dueCards.length) parts.push(n(dueCards.length, 'Wiederholung', 'Wiederholungen'));
      return { html: 'Heute: ' + parts.join(' · ') + (task.streak > 1 ? ` · 🔥 ${task.streak}` : ''), state: 'todo' };
    },

    renderCards() {
      this.autoArchive();
      this.renderTile();
      const container = document.getElementById('goal-cards');
      const list = this.corrupt ? [] : this.active().sort((a, b) => a.examDate.localeCompare(b.examDate) || a.name.localeCompare(b.name, 'de'));
      container.innerHTML = list.map(goal => {
        const task = this.todayTask(goal);
        const k = task.knowledge;
        const started = k.total ? Math.floor(((k.total - k.newCount) / k.total) * 100) : 0;
        const reached = k.percent >= goal.targetPercent;
        const cd = this._countdown(goal);
        const line = this._taskLine(task);
        const target = goal.grade !== null ? `Ziel: Note ${escapeHTML(goal.grade)} · ${goal.targetPercent} %` : `Ziel: ${goal.targetPercent} %`;
        const tight = task.plan.tight
          ? `<span class="goal-card-warn">Plan wird knapp: eigentlich ${task.plan.needed} neue Karten pro Tag nötig</span>` : '';
        return `<button type="button" class="card-panel goal-card${reached ? ' is-reached' : ''}" data-goal-study="${escapeHTML(goal.id)}">
          <span class="goal-card-head">
            <span class="goal-card-title">
              <span class="goal-card-name">${escapeHTML(goal.name)}</span>
              <span class="goal-card-scope">${escapeHTML(this._scopeLabel(goal))}</span>
            </span>
            <span class="goal-card-countdown${cd.urgent ? ' is-urgent' : ''}">${cd.html}</span>
          </span>
          <span class="goal-bar" role="progressbar" aria-label="Wissensstand ${escapeHTML(goal.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${k.percent}" aria-valuetext="${k.percent} % sicher, Ziel ${goal.targetPercent} %">
            <span class="goal-bar-started" style="width:${started}%"></span>
            <span class="goal-bar-fill" style="width:${k.percent}%"></span>
            <span class="goal-bar-target" style="left:${goal.targetPercent}%" aria-hidden="true"></span>
          </span>
          <span class="goal-card-row">
            <span><strong>${k.percent} %</strong> sicher · ${started} % angefangen</span>
            <span>${target}</span>
          </span>
          <span class="goal-card-task is-${line.state}"><span class="goal-card-task-text">${line.html}</span>${line.state === 'todo' ? '<span class="goal-card-go" aria-hidden="true">Los ›</span>' : ''}</span>
          ${tight}
        </button>`;
      }).join('');
      container.querySelectorAll('[data-goal-study]').forEach(btn =>
        btn.addEventListener('click', () => App._startGoalStudy(btn.dataset.goalStudy)));
    },

    // Abschluss einer Ziel-Runde: Fortschritt seit Rundenbeginn
    renderComplete(goalId, before) {
      const el = document.getElementById('complete-goal');
      const goal = goalId ? this.goals.find(g => g.id === goalId) : null;
      if (!goal) {
        el.classList.add('hidden');
        return;
      }
      const task = this.todayTask(goal);
      const k = task.knowledge;
      const pct = (x) => (x.total ? Math.floor(((x.total - x.newCount) / x.total) * 100) : 0);
      const startedNow = pct(k);
      const startedBefore = before ? pct(before) : startedNow;
      const parts = [`🎯 <strong>${escapeHTML(goal.name)}</strong>`];
      parts.push(startedNow > startedBefore
        ? `angefangen ${startedBefore} % → <strong>${startedNow} %</strong>`
        : `${startedNow} % angefangen`);
      parts.push(`${k.percent} % sicher (Ziel ${goal.targetPercent} %)`);
      const line = this._taskLine(task);
      el.innerHTML = parts.join(' · ') + `<br><span class="is-${line.state}">${line.html}</span>`;
      el.classList.remove('hidden');
    },

    renderTile() {
      const el = document.getElementById('goal-tile-status');
      const list = this.active().sort((a, b) => a.examDate.localeCompare(b.examDate));
      if (this.corrupt) {
        el.textContent = 'Daten beschädigt – bitte prüfen';
      } else if (list.length === 0) {
        el.textContent = 'Ziel festlegen – z. B. für eine Prüfung';
      } else {
        el.textContent = `${list.length} ${list.length === 1 ? 'aktives Ziel' : 'aktive Ziele'} · verwalten oder neues Ziel`;
      }
    },
  };

  // ===== LERNZIELE: FEIERN (Z5) =====
  // Konfetti (eigene Canvas-Animation, keine Bibliothek), Banner für Meilenstein/Tagesziel,
  // große Anzeige beim Erreichen der Zielmarke. "Bewegung reduzieren" → kein Konfetti.
  const Celebrate = {
    COLORS: ['#7c3aed', '#a78bfa', '#06b6d4', '#10b981', '#f59e0b', '#f472b6'],
    _bannerTimer: null,
    _returnFocus: null,

    init() {
      document.getElementById('celebrate-close').addEventListener('click', () => this.close());
      document.getElementById('celebrate').addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this.close();
        if (e.key === 'Tab') { // Fokus bleibt im Dialog (nur ein Knopf)
          e.preventDefault();
          document.getElementById('celebrate-close').focus();
        }
      });
    },

    reducedMotion() {
      return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    },

    show(events) {
      if (!events.length) return;
      const targets = events.filter(e => e.type === 'target');
      const others = events.filter(e => e.type !== 'target');
      if (targets.length) {
        this.overlay(targets, others);
      } else {
        this.banner(others);
      }
    },

    _line(e) {
      const name = escapeHTML(e.goal.name);
      if (e.type === 'daily') {
        const streak = e.streak > 1 ? ` · 🔥 ${e.streak} Tage in Folge` : '';
        return `✓ Tagesziel erledigt: <strong>${name}</strong> · +${e.xp} XP${streak}`;
      }
      if (e.type === 'milestone') return `🎯 <strong>${name}</strong>: ${e.milestone} % sicher geschafft! · +${e.xp} XP`;
      return '';
    },

    banner(events) {
      const el = document.getElementById('goal-banner');
      el.innerHTML = events.map(e => `<span>${this._line(e)}</span>`).join('');
      el.classList.remove('hidden');
      el.classList.remove('show');
      void el.offsetWidth; // Animation neu starten
      el.classList.add('show');
      clearTimeout(this._bannerTimer);
      this._bannerTimer = setTimeout(() => {
        el.classList.remove('show');
        this._bannerTimer = setTimeout(() => el.classList.add('hidden'), 300);
      }, 3200);
      this.confetti(events.some(e => e.type === 'daily') ? 70 : 40);
    },

    overlay(targets, others) {
      const e = targets[0];
      const g = e.goal;
      const reach = g.grade !== null
        ? `Note ${escapeHTML(g.grade)} ist in Reichweite!`
        : `Zielmarke ${g.targetPercent} % erreicht!`;
      document.getElementById('celebrate-title').textContent = 'Ziel erreicht!';
      document.getElementById('celebrate-text').innerHTML =
        `<strong>${escapeHTML(g.name)}</strong>: ${e.percent} % sicher gelernt.<br>${reach}`;
      const xp = targets.reduce((s, t) => s + t.xp, 0) + others.reduce((s, o) => s + o.xp, 0);
      const extra = others.map(o => this._line(o)).filter(Boolean);
      document.getElementById('celebrate-xp').innerHTML = `+${xp} XP` + (extra.length ? `<small>${extra.join('<br>')}</small>` : '');
      this._returnFocus = document.activeElement;
      document.getElementById('celebrate').classList.remove('hidden');
      document.getElementById('celebrate-close').focus({ preventScroll: true });
      this.confetti(180);
    },

    close() {
      document.getElementById('celebrate').classList.add('hidden');
      if (this._returnFocus && document.contains(this._returnFocus)) this._returnFocus.focus({ preventScroll: true });
      this._returnFocus = null;
    },

    confetti(count) {
      if (this.reducedMotion()) return;
      const canvas = document.createElement('canvas');
      canvas.className = 'confetti-canvas';
      canvas.setAttribute('aria-hidden', 'true');
      document.body.appendChild(canvas);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth, h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const parts = Array.from({ length: count }, () => ({
        x: w / 2 + (Math.random() - 0.5) * w * 0.3,
        y: h * 0.35,
        vx: (Math.random() - 0.5) * 14,
        vy: -Math.random() * 14 - 5,
        size: 5 + Math.random() * 6,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: this.COLORS[Math.floor(Math.random() * this.COLORS.length)],
        round: Math.random() < 0.3,
      }));
      const start = performance.now();
      const DURATION = 2600;
      const frame = (now) => {
        const t = now - start;
        ctx.clearRect(0, 0, w, h);
        ctx.globalAlpha = t > DURATION - 600 ? Math.max(0, (DURATION - t) / 600) : 1;
        for (const p of parts) {
          p.vy += 0.35;      // Schwerkraft
          p.vx *= 0.99;
          p.x += p.vx;
          p.y += p.vy;
          p.rot += p.vr;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          if (p.round) {
            ctx.beginPath();
            ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          }
          ctx.restore();
        }
        if (t < DURATION) requestAnimationFrame(frame);
        else canvas.remove();
      };
      requestAnimationFrame(frame);
    },
  };

  // ===== POMODORO: SIGNALTON (F05) =====
  // Töne werden per Web Audio erzeugt (E3) – keine Audiodateien. Browser (v. a. Safari/iOS)
  // geben Audio erst nach einer Nutzeraktion frei → unlock() bei Start und "Ton testen".
  const PomodoroSound = {
    ctx: null,

    _context() {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      if (!this.ctx) this.ctx = new Ctx();
      return this.ctx;
    },

    // Innerhalb eines Klicks aufrufen
    unlock() {
      const ctx = this._context();
      if (!ctx) return;
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      // iOS: ein stiller Puffer im Klick schaltet die Ausgabe dauerhaft frei
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    },

    // → true, wenn abgespielt; false, wenn nicht möglich (blockiert/nicht unterstützt)
    async play(tone, volume) {
      const ctx = this._context();
      if (!ctx) return false;
      if (ctx.state !== 'running') {
        try { await ctx.resume(); } catch {}
        if (ctx.state !== 'running') return false;
      }
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(100, volume)) / 100 * 0.5;
      gain.connect(ctx.destination);
      const t0 = ctx.currentTime + 0.02;
      // Glocke: drei kurze, aufsteigende Töne · Gong: tiefer Ton mit Obertönen, länger ausklingend
      const notes = tone === 'gong'
        ? [[0, 196, 3.5, 1], [0, 392, 2.5, 0.4], [0, 588, 1.6, 0.2]]
        : [[0, 880, 1.2, 1], [0.35, 1109, 1.2, 1], [0.7, 1319, 1.6, 1]];
      for (const [delay, freq, dur, level] of notes) {
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        env.gain.setValueAtTime(0.0001, t0 + delay);
        env.gain.exponentialRampToValueAtTime(level, t0 + delay + 0.02);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur); // endet sicher < 5 s
        osc.connect(env).connect(gain);
        osc.start(t0 + delay);
        osc.stop(t0 + delay + dur + 0.05);
      }
      return true;
    },
  };

  // ===== POMODORO: SYSTEMMITTEILUNGEN (F06) =====
  const PomodoroNotify = {
    // 'unsupported' | 'default' | 'granted' | 'denied'
    permission() {
      return 'Notification' in window ? Notification.permission : 'unsupported';
    },

    // Nur nach ausdrücklichem Klick aufrufen; bei 'denied' fragt der Browser nicht erneut
    async request() {
      if (this.permission() !== 'default') return this.permission();
      try { return await Notification.requestPermission(); } catch { return this.permission(); }
    },

    // Über den Service Worker, weil iOS (Home-Screen-App) nur diesen Weg unterstützt
    async show(title, body) {
      if (this.permission() !== 'granted') return;
      const options = { body, tag: 'studycards-pomodoro', icon: 'icons/icon-192.png' };
      try {
        const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
        if (reg) return void await reg.showNotification(title, options);
        new Notification(title, options);
      } catch {}
    },
  };

  // ===== POMODORO (Oberfläche) =====
  // Logik und Zählregeln liegen in pomodoro.js (window.Pomodoro); hier nur Speicherung,
  // Takt und Darstellung. Ton, Mitteilungen, Statistik und Einstellungen folgen später.
  const PomodoroUI = {
    settings: null,
    state: null,
    sessions: [],
    corrupt: [],        // Speicherbereiche mit beschädigten Daten → werden nicht überschrieben
    saveFailed: false,
    notice: '',
    returnTo: 'dashboard',
    _timer: null,
    isLeader: false,    // F11: nur der steuernde Tab verarbeitet Phasenenden, Signal und Protokoll
    channel: null,

    PHASE_LABELS: { work: 'Lernzeit', shortBreak: 'Kurze Pause', longBreak: 'Lange Pause' },
    START_LABELS: { work: 'Lernphase starten', shortBreak: 'Kurze Pause starten', longBreak: 'Lange Pause starten' },

    init() {
      const P = window.Pomodoro;
      const read = (kind) => {
        let raw = null;
        try { raw = localStorage.getItem(P.STORAGE_KEYS[kind]); } catch {}
        const res = P.parse(kind, raw);
        if (!res.ok) this.corrupt.push(kind);
        return res.value;
      };
      this.settings = read('settings') || P.defaultSettings();
      this.sessions = read('sessions') || [];
      this.state = read('state') || P.createInitialState();

      this._initTabs();
      // F04: abgelaufene Phasen beim Öffnen sofort verarbeiten (ohne Ton: das Ende liegt zurück)
      this._mutate(st => P.restore(st, { now: Date.now(), profile: this.profile() }), { silent: true })
        .then(() => this._refreshViews());

      document.querySelectorAll('[data-open-pomodoro]').forEach(btn =>
        btn.addEventListener('click', () => this.open()));
      document.getElementById('btn-back-pomodoro').addEventListener('click', () => this.close());
      document.getElementById('pomo-main').addEventListener('click', () => this._onMain());
      document.getElementById('pomo-reset').addEventListener('click', () => this._onReset());
      document.getElementById('pomo-skip').addEventListener('click', () => this._act(st => P.skipBreak(st)));
      document.getElementById('pomo-restart').addEventListener('click', () => this._act(st => P.restartCycle(st)));
      document.getElementById('pomo-review-done').addEventListener('click', () =>
        this._act(st => P.resolveReview(st, { outcome: 'completed', profile: this.profile() })));
      document.getElementById('pomo-mini-toggle').addEventListener('click', () => this._onMain());
      document.getElementById('pomo-mini-next').addEventListener('click', () => this._onMain());
      document.getElementById('pomo-mini-dismiss').addEventListener('click', () => {
        this.notice = '';
        this.renderMini();
      });
      this._bindSettings();
      this._bindProfile();
      this._bindData();
      document.getElementById('btn-pomodoro-settings').addEventListener('click', () => {
        App.showScreen('settings');
        document.getElementById('settings-pomodoro-profile').scrollIntoView({ block: 'start' });
      });
      document.getElementById('pomo-review-aborted').addEventListener('click', () =>
        this._act(st => P.resolveReview(st, { outcome: 'aborted', profile: this.profile() })));

      // Bei Rückkehr in den Tab sofort abgleichen (Hintergrund-Timer werden gedrosselt)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this._tick();
      });
      this._syncTimer();
      this.renderTile();
    },

    profile() {
      return window.Pomodoro.activeProfile(this.settings);
    },

    isActive() {
      return window.Pomodoro.isActive(this.state);
    },

    open() {
      if (App.currentScreen && App.currentScreen !== 'pomodoro' && App.currentScreen !== 'loading') {
        this.returnTo = App.currentScreen;
      }
      App.showScreen('pomodoro');
    },

    close() {
      let target = this.returnTo || 'dashboard';
      // Zurück zur Karte nur, wenn die Runde noch läuft – sie wird nicht neu gestartet (F12)
      if (target === 'study' && !App.studyActive) target = 'dashboard';
      // Ohne Repository-Verbindung zurück zum Setup statt auf ein leeres Dashboard
      if (target === 'dashboard' && !App.config) target = 'setup';
      App.showScreen(target);
    },

    // ----- Zustandsänderungen -----

    // Übernimmt ein Ergebnis aus pomodoro.js: Zustand, Protokolleintrag, Ereignis
    _apply(res, { silent = false } = {}) {
      if (!res) return;
      this.state = res.state;
      if (res.session) {
        this.sessions = window.Pomodoro.appendSession(this.sessions, res.session);
        this._save('sessions', this.sessions);
        if (App.currentScreen === 'stats') this.renderStats();
      }
      this._save('state', this.state);
      if (res.event) this._onEvent(res.event, { silent });
      if (App.currentScreen === 'settings') this.renderSettings(); // Sperre für Import/Löschen aktualisieren
      App._maybeApplyUpdate(); // Phase beendet/zurückgesetzt → zurückgehaltenes Update ggf. jetzt
    },

    async _act(fn) {
      const res = await this._mutate(fn, { clearNotice: true });
      if (res && res.error === 'review-pending') {
        this._setNotice('Bitte zuerst den Abschluss der letzten Lerneinheit prüfen.');
      }
      this._refreshViews();
    },

    _refreshViews() {
      this._syncTimer();
      if (App.currentScreen === 'pomodoro') this.render();
      if (App.currentScreen === 'settings') this.renderSettings();
      if (App.currentScreen === 'stats') this.renderStats();
      this.renderTile();
      this.renderMini();
    },

    // ----- Mehrere Tabs (F11, E4) -----
    // Jede Zustandsänderung läuft unter einer Web-Lock-Sperre und beginnt mit dem
    // aktuellen gespeicherten Stand – so ergibt auch ein fast gleichzeitiger Start in
    // zwei Tabs nur einen Timer. Andere Tabs werden per BroadcastChannel/storage informiert.
    _initTabs() {
      if ('BroadcastChannel' in window) {
        this.channel = new BroadcastChannel('studycards-pomodoro');
        this.channel.onmessage = (e) => this._onRemote(e.data);
      }
      // Fallback ohne BroadcastChannel: storage-Ereignis feuert in den anderen Tabs
      window.addEventListener('storage', (e) => {
        if (e.key && e.key.startsWith('sc_pomodoro_')) this._onRemote({ type: 'changed' });
      });
      if (navigator.locks) {
        // Sperre bleibt bis zum Schließen des Tabs gehalten; danach übernimmt ein anderer Tab
        navigator.locks.request('studycards-pomodoro-leader', () => {
          this.isLeader = true;
          this._tick();
          return new Promise(() => {});
        });
      } else {
        this.isLeader = true;
      }
    },

    async _mutate(fn, { silent = false, clearNotice = false } = {}) {
      const run = () => {
        this._reload();
        const res = fn(this.state);
        if (!res.error) {
          if (clearNotice) this.notice = '';
          this._apply(res, { silent });
        }
        return res;
      };
      return navigator.locks ? navigator.locks.request('studycards-pomodoro-write', run) : run();
    },

    // Aktuellen Stand aus dem Speicher übernehmen (beschädigte Bereiche bleiben im Speicher)
    _reload() {
      const P = window.Pomodoro;
      for (const kind of ['settings', 'state', 'sessions']) {
        if (this.corrupt.includes(kind)) continue;
        let raw = null;
        try { raw = localStorage.getItem(P.STORAGE_KEYS[kind]); } catch { continue; }
        const res = P.parse(kind, raw);
        if (res.ok && res.value !== null) this[kind] = res.value;
      }
    },

    // Mehrere Speichervorgänge in einem Schritt → eine Nachricht
    _broadcastChanged() {
      if (this._changeQueued) return;
      this._changeQueued = true;
      queueMicrotask(() => {
        this._changeQueued = false;
        this._broadcast({ type: 'changed' });
      });
    },

    _broadcast(msg) {
      if (this.channel) this.channel.postMessage(msg);
    },

    _onRemote(msg) {
      if (!msg) return;
      if (msg.type === 'notice') {
        // Sichtbarer Hinweis auch in anderen Tabs – Ton/Mitteilung nur im verarbeitenden Tab
        this._setNotice(msg.text);
        document.getElementById('pomo-announce').textContent = msg.text;
        if (App.currentScreen !== 'pomodoro' && App.currentScreen !== 'study') App.showToast(msg.text);
      }
      this._reload();
      this._refreshViews();
      App._maybeApplyUpdate();
    },

    _onMain() {
      PomodoroSound.unlock();
      const P = window.Pomodoro;
      const now = Date.now();
      switch (this.state.status) {
        case 'idle': {
          const topic = App.currentScreen === 'pomodoro' ? document.getElementById('pomo-topic').value : '';
          return this._act(st => P.start(st, { now, profile: this.profile(), id: this._newId(), topic }));
        }
        case 'running': return this._act(st => P.pause(st, { now }));
        case 'paused': return this._act(st => P.resume(st, { now }));
      }
    },

    _onReset() {
      const isWork = this.state.phase === 'work';
      const question = isWork
        ? 'Lernphase zurücksetzen? Sie wird als abgebrochen protokolliert.'
        : 'Pause zurücksetzen?';
      if (!window.confirm(question)) return;
      this._act(st => window.Pomodoro.reset(st, { now: Date.now() }));
    },

    _onEvent(event, { silent = false } = {}) {
      let text;
      if (event.type === 'needs-review') {
        text = 'Lernphase abgelaufen – bitte Abschluss prüfen.';
      } else if (event.phase === 'work') {
        text = `Lernphase beendet. Als Nächstes: ${this.PHASE_LABELS[event.next]}.`;
      } else {
        text = `${this.PHASE_LABELS[event.phase]} beendet. Nächste Lernphase ist bereit.`;
      }
      this._setNotice(text);
      this._broadcast({ type: 'notice', text });
      document.getElementById('pomo-announce').textContent = text; // für Screenreader
      if (App.currentScreen !== 'pomodoro' && App.currentScreen !== 'study') App.showToast(text);
      this.renderMini();
      if (!silent) this._signal(text);
    },

    // F05/F06: genau einmal pro Endereignis (Ereignisse entstehen nur beim Zustandswechsel)
    async _signal(text) {
      const { sound, notifications } = this.settings;
      if (sound.enabled && sound.volume > 0) {
        const played = await PomodoroSound.play(sound.tone, sound.volume);
        if (!played) {
          this.notice = `${text} (Ton blockiert – siehe Einstellungen → „Ton testen“.)`;
          this.render();
          this.renderMini();
        }
      }
      // Außerhalb der App nur, wenn sie gerade nicht im Blick ist
      if (notifications && (document.visibilityState !== 'visible' || !document.hasFocus())) {
        PomodoroNotify.show('StudyCards · Pomodoro', text);
      }
    },

    _setNotice(text) {
      this.notice = text;
    },

    _newId() {
      return (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    },

    // ----- Takt -----
    // Nur während einer laufenden Phase; die Restzeit kommt immer aus der Endzeit.
    _syncTimer() {
      const running = this.state.status === 'running';
      if (running && !this._timer) this._timer = setInterval(() => this._tick(), 250);
      if (!running && this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    },

    async _tick() {
      // Nur der steuernde Tab verarbeitet das Ende – genau einmal (F11)
      if (this.isLeader && !this._processing && this.state.status === 'running' && Date.now() >= this.state.endsAt) {
        this._processing = true;
        try {
          await this._mutate(st => window.Pomodoro.tick(st, { now: Date.now(), profile: this.profile() }));
        } finally {
          this._processing = false;
        }
        this._refreshViews();
        return;
      }
      if (App.currentScreen === 'pomodoro') this.render();
      if (App.currentScreen === 'dashboard') this.renderTile();
      if (App.currentScreen === 'study') this.renderMini();
    },

    // ----- Speicherung (F09) -----
    _save(kind, data) {
      if (this.corrupt.includes(kind)) return; // beschädigte Daten nicht still überschreiben
      try {
        localStorage.setItem(window.Pomodoro.STORAGE_KEYS[kind], window.Pomodoro.serialize(data));
        this.saveFailed = false;
        this._broadcastChanged();
      } catch {
        this.saveFailed = true;
      }
    },

    // ----- Einstellungen: Ton und Mitteilungen -----
    _bindSettings() {
      const $ = (id) => document.getElementById(id);
      const update = (fn) => {
        fn(this.settings);
        this._save('settings', this.settings);
        this.renderSettings();
      };
      $('pomo-sound-enabled').addEventListener('change', (e) => update(st => { st.sound.enabled = e.target.checked; }));
      $('pomo-sound-tone').addEventListener('change', (e) => update(st => { st.sound.tone = e.target.value; }));
      $('pomo-sound-volume').addEventListener('input', (e) => update(st => { st.sound.volume = parseInt(e.target.value, 10); }));
      $('pomo-sound-test').addEventListener('click', async () => {
        PomodoroSound.unlock();
        const { tone, volume } = this.settings.sound;
        const ok = await PomodoroSound.play(tone, volume);
        this._soundHint = ok
          ? (volume === 0 ? 'Lautstärke steht auf 0 % – es ist nichts zu hören.' : 'Nichts gehört? Prüfe Stummschaltung und Lautstärke von Gerät und Tab.')
          : 'Der Browser blockiert die Tonausgabe. In Safari: Einstellungen für diese Website → Automatische Wiedergabe → „Alle Medien erlauben“. Der Timer funktioniert trotzdem.';
        this.renderSettings();
      });
      $('pomo-notify-btn').addEventListener('click', async () => {
        if (this.settings.notifications && PomodoroNotify.permission() === 'granted') {
          update(st => { st.notifications = false; });
          return;
        }
        const result = await PomodoroNotify.request();
        update(st => { st.notifications = result === 'granted'; });
      });
    },

    // ----- Zeitprofil (F01) -----
    PROFILE_FIELDS: ['work', 'shortBreak', 'longBreak', 'longBreakAfter'],

    _bindProfile() {
      const $ = (id) => document.getElementById(id);
      document.querySelectorAll('input[name="pomo-profile"]').forEach(radio =>
        radio.addEventListener('change', () => {
          this._profileErrors = null;
          this._profileStatus = '';
          // Wechsel aktiviert das gewählte Profil sofort; eigene Werte bleiben in beiden Fällen erhalten
          this.settings.activeProfile = radio.value;
          this._save('settings', this.settings);
          this._profileStatus = this._appliesHint(radio.value === 'standard' ? 'Standard aktiv.' : 'Individuell aktiv.');
          this._profileEditing = radio.value === 'custom';
          this.renderSettings();
        }));
      $('pomo-profile-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const input = Object.fromEntries(this.PROFILE_FIELDS.map(f => [f, $(`pomo-profile-${f}`).value]));
        const check = window.Pomodoro.validateProfile(input);
        if (!check.ok) {
          this._profileErrors = check.errors; // nichts speichern
          this._profileStatus = '';
          this.renderSettings();
          $(`pomo-profile-${Object.keys(check.errors)[0]}`).focus();
          return;
        }
        this._profileErrors = null;
        this.settings.activeProfile = 'custom';
        this.settings.custom = check.value;
        this._save('settings', this.settings);
        this._profileStatus = this._appliesHint('Gespeichert.');
        this.renderSettings();
        this.renderTile();
      });
    },

    resetSettingsMessages() {
      this._dataStatus = '';
      this._profileStatus = '';
      this._profileErrors = null;
      this._profileEditing = undefined;
    },

    _appliesHint(prefix) {
      return this.isActive() ? `${prefix} Gilt ab der nächsten Phase – die laufende Phase behält ihre Dauer.` : prefix;
    },

    _renderProfile() {
      const $ = (id) => document.getElementById(id);
      const s = this.settings;
      const editing = this._profileEditing ?? s.activeProfile === 'custom';
      document.querySelectorAll('input[name="pomo-profile"]').forEach(r => {
        r.checked = r.value === (editing ? 'custom' : 'standard');
      });
      const p = window.Pomodoro.activeProfile(s);
      $('pomo-profile-summary').textContent =
        `Aktiv: ${s.activeProfile === 'custom' ? 'Individuell' : 'Standard'} · ${p.work} / ${p.shortBreak} / ${p.longBreak} min, lange Pause nach ${p.longBreakAfter} Einheiten`;
      $('pomo-profile-form').classList.toggle('hidden', !editing);
      const errors = this._profileErrors || {};
      for (const f of this.PROFILE_FIELDS) {
        const input = $(`pomo-profile-${f}`);
        if (!errors[f] && document.activeElement !== input && !this._profileErrors) input.value = s.custom[f];
        input.setAttribute('aria-invalid', errors[f] ? 'true' : 'false');
        $(`pomo-profile-${f}-error`).textContent = errors[f] || '';
      }
      $('pomo-profile-status').classList.toggle('hidden', !this._profileStatus);
      $('pomo-profile-status').textContent = this._profileStatus || '';
    },

    // ----- Sicherung, Import, Löschen (F09, F10) -----
    _bindData() {
      const $ = (id) => document.getElementById(id);
      const P = window.Pomodoro;
      const setStatus = (text) => { this._dataStatus = text; this.renderSettings(); };

      $('pomo-export').addEventListener('click', () => {
        const backup = P.createBackup(this.settings, this.sessions, Date.now());
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), {
          href: url, download: `studycards-pomodoro-${P.localDayKey(Date.now())}.json`,
        });
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        setStatus(`Sicherung mit ${this._entries(backup.sessions.length, true)} erstellt.`);
      });

      $('pomo-import').addEventListener('click', () => {
        if (this.isActive()) return setStatus(this._lockedHint());
        $('pomo-import-file').value = '';
        $('pomo-import-file').click();
      });
      $('pomo-import-file').addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (this.isActive()) return setStatus(this._lockedHint());
        let text = '';
        try { text = await file.text(); } catch { return setStatus('Die Datei konnte nicht gelesen werden.'); }
        const res = P.parseBackup(text);
        if (!res.ok) return setStatus(`Import abgebrochen: ${res.error} Deine Daten sind unverändert.`);
        const n = res.value.sessions.length;
        if (!window.confirm(`Sicherung importieren?\n\nPomodoro-Einstellungen und Verlauf werden durch die Sicherung ersetzt (${this._entries(n)}). Der Zyklus beginnt neu. Kartendaten bleiben unverändert.`)) return;
        this.settings = res.value.settings;
        this.sessions = res.value.sessions;
        this.state = P.createInitialState();
        this.corrupt = []; // ersetzt auch beschädigte Bereiche
        this._save('settings', this.settings);
        this._save('sessions', this.sessions);
        this._save('state', this.state);
        this._profileEditing = undefined;
        this.notice = '';
        this._afterDataChange(`Sicherung importiert (${this._entries(n)}).`);
      });

      $('pomo-clear').addEventListener('click', () => {
        if (this.isActive()) return setStatus(this._lockedHint());
        if (!window.confirm('Pomodoro-Verlauf löschen?\n\nAlle protokollierten Einheiten werden entfernt und der Zyklus beginnt neu. Einstellungen und Kartendaten bleiben erhalten. Das lässt sich nur mit einer vorher exportierten Sicherung rückgängig machen.')) return;
        this.sessions = [];
        this.state = P.createInitialState();
        this.corrupt = this.corrupt.filter(k => k !== 'sessions' && k !== 'state');
        this._save('sessions', this.sessions);
        this._save('state', this.state);
        this.notice = '';
        this._afterDataChange('Verlauf gelöscht.');
      });

      $('pomo-corrupt-reset').addEventListener('click', () => {
        if (!window.confirm(`Beschädigte Pomodoro-Daten zurücksetzen?\n\nBetroffen: ${this._corruptLabel()}. Andere Pomodoro-Daten und alle Kartendaten bleiben erhalten.`)) return;
        const kinds = this.corrupt;
        this.corrupt = [];
        if (kinds.includes('settings')) { this.settings = P.defaultSettings(); this._save('settings', this.settings); }
        if (kinds.includes('sessions')) { this.sessions = []; this._save('sessions', this.sessions); }
        if (kinds.includes('state')) { this.state = P.createInitialState(); this._save('state', this.state); }
        this._afterDataChange('Beschädigte Daten zurückgesetzt.');
      });
    },

    // "1 Eintrag" / "3 Einträge"; im Dativ ("mit 3 Einträgen")
    _entries(n, dative = false) {
      if (n === 1) return '1 Eintrag';
      return `${n} ${dative ? 'Einträgen' : 'Einträge'}`;
    },

    _lockedHint() {
      return 'Nicht möglich, solange eine Pomodoro-Phase läuft, pausiert ist oder auf „Abschluss prüfen“ wartet.';
    },

    _corruptLabel() {
      const names = { settings: 'Einstellungen', state: 'aktueller Timer', sessions: 'Verlauf' };
      return this.corrupt.map(k => names[k]).join(', ');
    },

    _afterDataChange(status) {
      this._dataStatus = status;
      this._syncTimer();
      this.renderSettings();
      this.renderTile();
      App._maybeApplyUpdate();
    },

    renderSettings() {
      const $ = (id) => document.getElementById(id);
      this._renderProfile();

      // Daten: Sperre bei aktiver Phase, Hinweis bei Beschädigung
      const locked = this.isActive();
      $('pomo-import').disabled = locked;
      $('pomo-clear').disabled = locked;
      $('pomo-import').title = locked ? this._lockedHint() : '';
      $('pomo-clear').title = locked ? this._lockedHint() : '';
      $('pomo-corrupt').classList.toggle('hidden', !this.corrupt.length);
      $('pomo-corrupt-text').textContent = this.corrupt.length
        ? `Beschädigte Pomodoro-Daten erkannt (${this._corruptLabel()}). Sie werden nicht überschrieben. Importiere eine Sicherung oder setze die betroffenen Daten zurück.`
        : '';
      const dataStatus = this._dataStatus || (locked ? this._lockedHint().replace('Nicht möglich', 'Import und Löschen sind nicht möglich') : '');
      $('pomo-data-status').classList.toggle('hidden', !dataStatus);
      $('pomo-data-status').textContent = dataStatus;

      const { sound } = this.settings;
      $('pomo-sound-enabled').checked = sound.enabled;
      $('pomo-sound-tone').value = sound.tone;
      $('pomo-sound-tone').disabled = !sound.enabled;
      $('pomo-sound-volume').value = sound.volume;
      $('pomo-sound-volume').disabled = !sound.enabled;
      $('pomo-sound-volume').setAttribute('aria-valuetext', `${sound.volume} Prozent`);
      $('pomo-sound-volume-value').textContent = `${sound.volume} %`;
      $('pomo-sound-hint').classList.toggle('hidden', !this._soundHint);
      $('pomo-sound-hint').textContent = this._soundHint || '';

      // Status als Text, Button nur wenn sinnvoll – keine wiederholten Berechtigungsdialoge
      const perm = PomodoroNotify.permission();
      const active = perm === 'granted' && this.settings.notifications;
      const status = {
        unsupported: 'nicht unterstützt',
        denied: 'blockiert',
        default: 'aus',
        granted: active ? 'aktiv' : 'erlaubt, aus',
      }[perm];
      $('pomo-notify-status').textContent = status;
      const btn = $('pomo-notify-btn');
      btn.classList.toggle('hidden', perm === 'unsupported' || perm === 'denied');
      btn.textContent = active ? 'Mitteilungen ausschalten' : 'Mitteilungen aktivieren';
      const hint = perm === 'denied'
        ? 'Mitteilungen wurden abgelehnt. Erlauben kannst du sie in den Website-Einstellungen des Browsers bzw. in den Systemeinstellungen.'
        : perm === 'unsupported'
          ? 'Dieser Browser unterstützt keine Mitteilungen. Auf dem iPhone funktionieren sie nur, wenn StudyCards über „Zum Home-Bildschirm“ geöffnet wird.'
          : '';
      $('pomo-notify-hint').classList.toggle('hidden', !hint);
      $('pomo-notify-hint').textContent = hint;
    },

    // ----- Statistik (F08) -----
    HISTORY_LIMIT: 30,

    renderStats() {
      const $ = (id) => document.getElementById(id);
      const now = Date.now();
      const sum = window.Pomodoro.summarize(this.sessions, now);
      $('pomo-stats-today-count').textContent = sum.today.count;
      $('pomo-stats-today-min').textContent = sum.today.minutes;
      $('pomo-stats-week-count').textContent = sum.last7.count;
      $('pomo-stats-week-min').textContent = sum.last7.minutes;

      // Tagesübersicht: Balkenhöhe relativ zum stärksten Tag, Wert immer auch als Text
      const max = Math.max(1, ...sum.days.map(d => d.minutes));
      const todayKey = window.Pomodoro.localDayKey(now);
      $('pomo-stats-bars').innerHTML = sum.days.map(d => {
        const [y, m, day] = d.day.split('-').map(Number);
        const date = new Date(y, m - 1, day);
        const weekday = date.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '');
        const long = date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
        const pct = Math.round((d.minutes / max) * 100);
        return `<li class="pomo-bar${d.day === todayKey ? ' is-today' : ''}" aria-label="${escapeHTML(`${long}: ${d.count} ${d.count === 1 ? 'Einheit' : 'Einheiten'}, ${d.minutes} ${d.minutes === 1 ? 'Minute' : 'Minuten'}`)}">
          <span class="pomo-bar-value" aria-hidden="true">${d.minutes}</span>
          <span class="pomo-bar-track" aria-hidden="true"><span class="pomo-bar-fill" style="height:${pct}%"></span></span>
          <span class="pomo-bar-label" aria-hidden="true">${escapeHTML(weekday)}</span>
        </li>`;
      }).join('');

      // Ungeklärte Einheit zählt noch nicht (F04) – darauf hinweisen
      $('pomo-stats-pending').classList.toggle('hidden', this.state.status !== 'review');
      $('pomo-stats-pending').textContent = 'Eine Lerneinheit wartet auf „Abschluss prüfen“ und ist noch nicht mitgezählt.';

      // Verlauf: neueste zuerst
      const list = [...this.sessions].sort((a, b) => b.endedAt - a.endedAt).slice(0, this.HISTORY_LIMIT);
      $('pomo-stats-empty').classList.toggle('hidden', list.length > 0);
      $('pomo-stats-history').innerHTML = list.map(s => {
        const when = new Date(s.endedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        const done = s.status === 'completed';
        const minutes = s.learnedMs === null ? null : Math.round(s.learnedMs / 60000);
        const duration = done ? `${minutes} min`
          : minutes === null ? 'abgebrochen' : `abgebrochen nach ${minutes} min`;
        return `<li class="pomo-history-item">
          <div class="pomo-history-main">
            <span class="pomo-history-topic">${escapeHTML(s.topic || 'Ohne Thema')}</span>
            <span class="pomo-history-when">${escapeHTML(when)} · ${escapeHTML(duration)}</span>
          </div>
          <span class="pomo-history-status ${done ? 'is-done' : 'is-aborted'}">${done ? 'Abgeschlossen' : 'Abgebrochen'}</span>
        </li>`;
      }).join('') + (this.sessions.length > list.length
        ? `<li class="pomo-history-more">${this.sessions.length - list.length} ältere Einträge nicht angezeigt</li>` : '');
    },

    // ----- Darstellung -----
    formatTime(ms) {
      const total = Math.ceil(ms / 1000);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const sec = String(total % 60).padStart(2, '0');
      return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
    },

    _statusText() {
      switch (this.state.status) {
        case 'running': return 'Läuft';
        case 'paused': return 'Pausiert';
        case 'review': return 'Abschluss prüfen';
        default: return 'Bereit';
      }
    },

    // Kompakte Leiste im Lernmodus: laufender/pausierter Timer, offene Prüfung
    // oder Hinweis nach Phasenende mit dem nächsten Schritt
    renderMini() {
      const bar = document.getElementById('pomo-mini');
      if (!bar) return;
      const st = this.state;
      const $ = (id) => document.getElementById(id);
      const showNotice = st.status === 'idle' && !!this.notice;
      bar.classList.toggle('hidden', !(this.isActive() || showNotice));
      bar.dataset.phase = st.phase;

      const time = this.formatTime(window.Pomodoro.remainingMs(st, Date.now(), this.profile()));
      $('pomo-mini-text').textContent =
        st.status === 'review' ? 'Abschluss prüfen'
        : showNotice ? this.notice
        : `${this.PHASE_LABELS[st.phase]} ${time}${st.status === 'paused' ? ' · pausiert' : ''}`;

      const toggle = $('pomo-mini-toggle');
      const canToggle = st.status === 'running' || st.status === 'paused';
      toggle.classList.toggle('hidden', !canToggle);
      toggle.textContent = st.status === 'running' ? 'Pausieren' : 'Fortsetzen';

      $('pomo-mini-next').classList.toggle('hidden', !showNotice);
      $('pomo-mini-next').textContent = this.START_LABELS[st.phase];
      $('pomo-mini-dismiss').classList.toggle('hidden', !showNotice);
      $('pomo-mini-open').textContent = st.status === 'review' ? 'Prüfen' : 'Timer';
    },

    renderTile() {
      const el = document.getElementById('pomo-tile-status');
      if (!el) return;
      const st = this.state;
      const time = this.formatTime(window.Pomodoro.remainingMs(st, Date.now(), this.profile()));
      el.textContent = st.status === 'review'
        ? 'Abschluss prüfen'
        : `${this.PHASE_LABELS[st.phase]} ${time} · ${this._statusText().toLowerCase()}`;
      document.getElementById('pomo-tile').classList.toggle('is-active', this.isActive());
    },

    render() {
      const P = window.Pomodoro;
      const st = this.state;
      const profile = this.profile();
      const $ = (id) => document.getElementById(id);

      $('pomo-phase').textContent = this.PHASE_LABELS[st.phase];
      $('pomo-time').textContent = this.formatTime(P.remainingMs(st, Date.now(), profile));
      $('pomo-status').textContent = this._statusText();
      document.querySelector('.pomo-timer').dataset.phase = st.phase;

      // Zyklusfortschritt: gefüllte Punkte = abgeschlossene Lerneinheiten
      const total = profile.longBreakAfter;
      const done = Math.min(st.completedInCycle, total);
      $('pomo-cycle').innerHTML = Array.from({ length: total }, (_, i) =>
        `<span class="pomo-dot${i < done ? ' done' : ''}"></span>`).join('');
      $('pomo-cycle-text').textContent = `${done} von ${total} Lerneinheiten bis zur langen Pause`;

      // Lernthema: vor dem Start eingeben, danach nur anzeigen
      const editTopic = st.phase === 'work' && st.status === 'idle';
      $('pomo-topic-wrap').classList.toggle('hidden', !editTopic);
      $('pomo-topic-current').classList.toggle('hidden', !(st.phase === 'work' && !editTopic && st.topic));
      $('pomo-topic-current').textContent = st.topic ? `Thema: ${st.topic}` : '';

      // Hauptbutton benennt den nächsten Schritt
      const main = $('pomo-main');
      main.classList.toggle('hidden', st.status === 'review');
      main.textContent = st.status === 'running' ? 'Pausieren'
        : st.status === 'paused' ? 'Fortsetzen'
        : this.START_LABELS[st.phase];

      const isBreak = st.phase !== 'work';
      $('pomo-reset').classList.toggle('hidden', !(st.status === 'running' || st.status === 'paused'));
      $('pomo-skip').classList.toggle('hidden', !(isBreak && st.status !== 'review'));
      $('pomo-restart').classList.toggle('hidden',
        !(st.status === 'idle' && (st.phase !== 'work' || st.completedInCycle > 0)));
      $('pomo-review').classList.toggle('hidden', st.status !== 'review');

      $('pomo-notice').classList.toggle('hidden', !this.notice);
      $('pomo-notice').textContent = this.notice;

      // Speicherprobleme (F09)
      const warn = this.saveFailed ? 'Daten werden aktuell nicht gespeichert.'
        : this.corrupt.length ? 'Gespeicherte Pomodoro-Daten sind beschädigt und werden nicht überschrieben. Eine Sicherung importieren oder die Daten zurücksetzen kannst du unter Einstellungen → Pomodoro · Daten.'
        : '';
      $('pomo-storage-notice').classList.toggle('hidden', !warn);
      $('pomo-storage-notice').textContent = warn;
    },
  };

  // ===== SERVICE WORKER & PWA =====
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    // Pfad dynamisch: /studycards/sw.js auf GitHub Pages, /sw.js lokal
    const basePath = location.pathname.includes('/studycards') ? '/studycards/' : '/';
    navigator.serviceWorker.register(basePath + 'sw.js').then((reg) => {
      // Prüfe regelmäßig auf Updates (alle 30 Min)
      setInterval(() => reg.update(), 30 * 60 * 1000);
      // iOS holt Home-Screen-Apps meist nur aus dem Hintergrund statt neu zu laden →
      // beim Zurückkehren in die App ebenfalls nach Updates suchen
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });

      // Neue Version installiert → still aktivieren (kein Hinweisbalken mehr).
      // Nie während einer Kartenrunde oder einer gestarteten/ungeklärten Pomodoro-Phase.
      const applyUpdate = () => {
        if (!reg.waiting) return;
        sessionStorage.setItem('sc_updated', '1');
        reg.waiting.postMessage({ type: 'SKIP_WAITING' }); // → controllerchange → Reload
      };
      const onUpdateReady = () => {
        App._pendingUpdate = applyUpdate;
        App._maybeApplyUpdate();
      };

      if (reg.waiting && navigator.serviceWorker.controller) {
        onUpdateReady();
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdateReady();
          }
        });
      });
    }).catch((err) => {
      console.warn('Service Worker Registrierung fehlgeschlagen:', err);
    });

    // Wenn neuer SW aktiviert wird → Seite neu laden
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }

  // ===== BOOT =====
  document.addEventListener('DOMContentLoaded', () => {
    // Service Worker registrieren
    registerServiceWorker();

    // Wait for KaTeX to load
    const waitForKaTeX = () => {
      if (typeof renderMathInElement === 'function') {
        App.init();
      } else {
        setTimeout(waitForKaTeX, 100);
      }
    };
    waitForKaTeX();
  });
})();
