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
  };

  const XP_TABLE = { 1: 2, 3: 5, 4: 10, 5: 15 };
  const XP_PER_LEVEL = 100;
  const DEFAULT_NEW_PER_DAY = 20;

  // ===== HELPERS =====
  function today() {
    return new Date().toISOString().split('T')[0];
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
  const APP_VERSION = 'v1.15'; // beim Release zusammen mit CACHE_NAME in sw.js erhöhen
  const SAFE_TOKEN = /^[A-Za-z0-9_]{20,255}$/;
  const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
  const IMAGE_CACHE = 'studycards-img';

  // ===== MARKDOWN PARSER =====
  const Parser = {
    extractCards(markdown, filePath) {
      const cards = [];
      const fileName = filePath.split('/').pop().replace(/\.md$/, '');

      // Find ## Lernkarten section (case insensitive), optionally with #tags
      const sectionRegex = /^##\s+Lernkarten?\s*(.*)?$/im;
      const match = sectionRegex.exec(markdown);
      if (!match) return cards;

      // Extract hashtags from header line: ## Lernkarten #Semester-4/Rechnernetze #BWL
      // Verschachtelte Tags: vor dem "/" steht der Ordner, danach das Fach
      const tagString = match[1] || '';
      const tags = (tagString.match(/#([a-zA-ZäöüÄÖÜß0-9_\/-]+)/g) || [])
        .map(t => t.slice(1).replace(/^\/+|\/+$/g, '')) // Remove # prefix and stray slashes
        .filter(Boolean);

      // Get content after ## Lernkarten until next ## or end
      const afterSection = markdown.slice(match.index + match[0].length);
      const nextHeadingMatch = afterSection.match(/^##\s+/m);
      const sectionContent = nextHeadingMatch
        ? afterSection.slice(0, nextHeadingMatch.index)
        : afterSection;

      // Parse Q: / A: pairs
      const lines = sectionContent.split('\n');
      let currentQ = null;
      let currentA = [];
      let currentOpts = []; // Multiple-Choice: { text, correct }
      let collecting = null; // 'q' or 'a'

      // Normale Karte braucht eine Antwort, MC-Karte mindestens zwei Optionen
      const pushCard = () => {
        if (!currentQ) return;
        if (currentA.length > 0 || currentOpts.length >= 2) {
          cards.push(this._makeCard(currentQ, currentA.join('\n').trim(), filePath, fileName, tags,
            currentOpts.length >= 2 ? currentOpts : null));
        }
      };

      for (const rawLine of lines) {
        // Aus Word/Web eingefügter Text: führende &#x20;/&nbsp; und Hard-Break-Backslash am Zeilenende entfernen
        const line = rawLine
          .replace(/^(?:\s|&#x20;|&#32;|&nbsp;|\u00a0)+/i, '')
          .replace(/\s*\\$/, '');
        const qMatch = line.match(/^Q:\s*(.+)/);
        const aMatch = line.match(/^A:\s*(.+)/);
        // Obsidian-Checkboxen unter der Frage = Multiple-Choice-Optionen: "- [x] richtig" / "- [ ] falsch"
        const optMatch = collecting === 'q' && line.match(/^[-*+]\s+\[([ xX])\]\s+(.+)/);

        if (optMatch) {
          currentOpts.push({ text: optMatch[2].trim(), correct: optMatch[1] !== ' ' });
        } else if (qMatch) {
          pushCard(); // Save previous card
          currentQ = qMatch[1].trim();
          currentA = [];
          currentOpts = [];
          collecting = 'q';
        } else if (aMatch) {
          currentA = [aMatch[1].trim()];
          collecting = 'a';
        } else if (collecting === 'q' && line.trim() !== '') {
          // Mehrzeilige Frage, z.B. Bild unter der Frage
          currentQ += '\n' + line;
        } else if (collecting === 'a' && line.trim() !== '') {
          currentA.push(line);
        } else if (collecting === 'a' && line.trim() === '' && currentA.length > 0) {
          // Empty line in answer - keep it for multi-paragraph answers
          currentA.push('');
        }
      }

      // Save last card
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

  // ===== SM-2 ALGORITHM =====
  const SM2 = {
    defaultState() {
      return {
        easeFactor: 2.5,
        interval: 0,
        repetitions: 0,
        nextReview: today(),
        lastReview: null,
        totalReviews: 0,
        correctReviews: 0,
      };
    },

    calcNext(state, quality) {
      // quality: 1=again, 3=hard, 4=good, 5=easy
      const s = { ...state };
      s.totalReviews++;
      s.lastReview = today();

      if (quality >= 3) {
        // Correct
        s.correctReviews++;
        if (s.repetitions === 0) {
          s.interval = 1;
        } else if (s.repetitions === 1) {
          s.interval = 6;
        } else {
          s.interval = Math.round(s.interval * s.easeFactor);
        }
        s.repetitions++;
      } else {
        // Incorrect - reset
        s.repetitions = 0;
        s.interval = 1;
      }

      // Update ease factor
      s.easeFactor = Math.max(
        1.3,
        s.easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
      );

      // Hard: reduce interval by 15%
      if (quality === 3) {
        s.interval = Math.max(1, Math.round(s.interval * 0.85));
      }

      // Easy: bonus
      if (quality === 5) {
        s.interval = Math.round(s.interval * 1.3);
      }

      // Set next review date
      const next = new Date();
      next.setDate(next.getDate() + s.interval);
      s.nextReview = next.toISOString().split('T')[0];

      return s;
    },

    previewIntervals(state) {
      return {
        1: this.calcNext(state, 1).interval,
        3: this.calcNext(state, 3).interval,
        4: this.calcNext(state, 4).interval,
        5: this.calcNext(state, 5).interval,
      };
    }
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
      const yesterdayStr = yesterday.toISOString().split('T')[0];

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
        const key = d.toISOString().split('T')[0];
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
      return this.states[cardId] || SM2.defaultState();
    },

    updateState(cardId, quality) {
      const current = this.getState(cardId);
      this.states[cardId] = SM2.calcNext(current, quality);
      this.save();
      return this.states[cardId];
    },

    isDue(cardId) {
      const state = this.states[cardId];
      if (!state) return false; // new card, not "due" but "new"
      return state.nextReview <= today();
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
      return config;
    },

    // ----- Init -----
    async init() {
      Stats.load();
      CardStore.load();
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
          this.showScreen(screen);
        });
      });

      // Dashboard
      document.getElementById('btn-refresh').addEventListener('click', () => this._refresh());
      document.getElementById('btn-start-study').addEventListener('click', () => this._startStudy());

      // Study
      document.getElementById('btn-back-study').addEventListener('click', () => this.showScreen('dashboard'));
      document.getElementById('btn-show-answer').addEventListener('click', () => this._flipCard());
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
      document.getElementById('btn-continue-study').addEventListener('click', () => this._startStudy());

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
          mdFiles = tree.filter(f => f.path.startsWith(prefix));
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
    },

    // ----- Dashboard -----
    _renderDashboard() {
      const visibleCards = this._getFilteredCards();
      const dueCards = visibleCards.filter(c => CardStore.isDue(c.id));
      const newCards = visibleCards.filter(c => CardStore.isNew(c.id));
      const newPerDay = this.config?.newPerDay || DEFAULT_NEW_PER_DAY;

      // Tageslimit GLOBAL berechnen (über alle Karten, nicht nur gefilterte)
      const todayNewLearned = this.allCards.filter(c => {
        const state = CardStore.states[c.id];
        return state && state.lastReview === today() && state.totalReviews === 1;
      }).length;
      const remainingNew = Math.max(0, newPerDay - todayNewLearned);
      const availableNew = Math.min(newCards.length, remainingNew);

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
        if (CardStore.isDue(card.id)) deckMap[card.deck].due++;
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
    _startStudy(deckFilter) {
      const newPerDay = this.config?.newPerDay || DEFAULT_NEW_PER_DAY;

      // Tag-Filter anwenden, dann optional Deck-Filter
      let cards = this._getFilteredCards();
      if (deckFilter) {
        cards = cards.filter(c => c.deck === deckFilter);
      }

      // Get due cards and new cards
      const dueCards = cards.filter(c => CardStore.isDue(c.id));
      const newCards = cards.filter(c => CardStore.isNew(c.id));

      // Limit new cards per day
      const todayNewLearned = this.allCards.filter(c => {
        const state = CardStore.states[c.id];
        return state && state.lastReview === today() && state.totalReviews === 1;
      }).length;
      const remainingNew = Math.max(0, newPerDay - todayNewLearned);
      const selectedNew = newCards.slice(0, remainingNew);

      // Build queue: due first, then new
      this.studyQueue = [...dueCards, ...selectedNew];

      if (this.studyQueue.length === 0) {
        this.showToast('Keine Karten fällig!');
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
      document.getElementById('flashcard').classList.remove('flipped');
      document.getElementById('show-answer-container').classList.remove('hidden');
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
      const previews = SM2.previewIntervals(state);
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
      document.getElementById('flashcard').classList.add('flipped');
      document.getElementById('show-answer-container').classList.add('hidden');
      document.getElementById('rating-container').classList.remove('hidden');
    },

    _unflipCard() {
      if (!this.isFlipped) return;
      this.isFlipped = false;
      document.getElementById('flashcard').classList.remove('flipped');
      document.getElementById('show-answer-container').classList.remove('hidden');
      document.getElementById('rating-container').classList.add('hidden');
    },

    _rateCard(quality) {
      const card = this.studyQueue[this.studyIndex];

      // Update SM2 state
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
      this.showScreen('complete');
      document.getElementById('complete-total').textContent = this.sessionTotal;
      document.getElementById('complete-xp').textContent = '+' + this.sessionXP;
      const accuracy = this.sessionTotal > 0
        ? Math.round((this.sessionCorrect / this.sessionTotal) * 100)
        : 0;
      document.getElementById('complete-accuracy').textContent = accuracy + '%';
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

      // Neuer Service Worker wartet → Update-Toast zeigen
      const showUpdateToast = () => {
        const toast = document.getElementById('toast');
        toast.textContent = '';

        const msg = document.createElement('span');
        msg.textContent = 'Neue Version verfügbar! ';

        const btn = document.createElement('button');
        btn.textContent = 'Aktualisieren';
        btn.style.cssText = 'background:var(--accent);color:#fff;border:none;padding:4px 12px;border-radius:8px;margin-left:8px;font-weight:600;cursor:pointer;';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          btn.disabled = true;
          btn.textContent = 'Lädt …';
          // Immer den AKTUELL wartenden Worker nehmen – der beim Anzeigen gemerkte kann
          // inzwischen von einer noch neueren Version abgelöst (redundant) sein
          const waiting = reg.waiting;
          if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
          // Fallback: Kommt kein controllerchange, trotzdem neu laden (App-Dateien sind Network-First)
          setTimeout(() => window.location.reload(), waiting ? 3000 : 0);
        });

        const close = document.createElement('button');
        close.textContent = '✕';
        close.setAttribute('aria-label', 'Hinweis schließen');
        close.style.cssText = 'background:none;color:var(--text-secondary);border:none;padding:4px 8px;margin-left:4px;font-size:15px;cursor:pointer;';
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          toast.classList.remove('show');
          toast.classList.add('hidden');
        });

        toast.appendChild(msg);
        toast.appendChild(btn);
        toast.appendChild(close);
        toast.classList.remove('hidden');
        toast.classList.add('show');
        // Kein Auto-Hide — User soll bewusst klicken
      };

      if (reg.waiting) {
        showUpdateToast();
      }

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateToast();
          }
        });
      });
    }).catch((err) => {
      console.warn('Service Worker Registrierung fehlgeschlagen:', err);
    });

    // Wenn neuer SW aktiviert wird → Seite neu laden
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      sessionStorage.setItem('sc_updated', '1');
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
