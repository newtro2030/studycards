# StudyCards — Architektur & Technologie

---

## Gesamtkonzept

```
┌──────────────┐     auto-push      ┌──────────────┐     GitHub API     ┌──────────────┐
│   Obsidian   │ ──────────────────▶ │    GitHub     │ ◀──────────────── │  StudyCards   │
│  (Studium    │   Obsidian Git      │    Repo       │   fetch .md       │   PWA         │
│   Vault)     │   Plugin, 10min     │  (öffentlich) │   Dateien         │  (Offline)    │
└──────────────┘                     └──────────────┘                    └──────────────┘
       ↑                                    ↑                                  ↑
  iCloud Sync                        GitHub Pages                        localStorage
  (Mac ↔ iPhone)                     (Hosting)                          (Lernfortschritt)
                                                                         Service Worker
                                                                         (Caching + Updates)
```

---

## 1. Datenfluss

| Schritt | Was passiert | Technologie |
|---------|-------------|-------------|
| **Notizen schreiben** | Markdown-Dateien in Obsidian bearbeiten | Obsidian + iCloud |
| **Auto-Sync** | Git Plugin committed & pusht alle 10 Min | Obsidian Git Plugin → GitHub |
| **App öffnen** | StudyCards lädt die Datei-Liste des Repos | GitHub REST API (`/git/trees/`) |
| **Karten parsen** | `.md`-Dateien werden nach `## Lernkarten` durchsucht | `raw.githubusercontent.com` + JS-Parser |
| **Tags zuordnen** | Hashtags im Header werden extrahiert | Regex-Parser |
| **Lernen** | SM-2 Algorithmus berechnet Wiederholungs-Intervalle | JavaScript (Client-side) |
| **Fortschritt speichern** | XP, Streak, Kartenstände lokal gespeichert | `localStorage` |
| **Offline-Cache** | App-Shell + CDN-Ressourcen gecached | Service Worker |
| **Auto-Update** | Neue Version erkannt → Update-Toast | Service Worker Lifecycle |

---

## 2. Technologie-Stack

| Komponente | Technologie | Begründung |
|-----------|-------------|------------|
| **Frontend** | Vanilla HTML/CSS/JS | Kein Framework nötig, schnell, kein Build-Step |
| **Hosting** | GitHub Pages | Kostenlos, automatisches Deployment via Actions |
| **PWA** | Service Worker + Manifest | Offline-fähig, Home-Screen-Installation |
| **Persistenz** | `localStorage` | Kein Server nötig, Daten bleiben im Browser |
| **Kartenquelle** | GitHub API v3 | Öffentliches Repo, kein Token nötig |
| **LaTeX** | KaTeX v0.16.9 (mit SRI) | Schneller als MathJax, ideal für Mobile |
| **Schrift** | Google Fonts (Inter) | Professionell, gut lesbar auf Mobile |
| **Sync** | Obsidian Git Plugin | Automatisch, kein manuelles Eingreifen |

---

## 3. Dateistruktur

```
studycards/
├── index.html                 ← HTML-Struktur (7 Screens) + CSP + SRI
├── style.css                  ← Dark Mode, Animationen, Mobile-First
├── app.js                     ← App-Logik (~1000 Zeilen)
├── sw.js                      ← Service Worker (Caching, Updates)
├── manifest.json              ← PWA-Manifest
├── icons/
│   ├── icon.svg               ← Quell-Icon
│   ├── icon-192.png           ← PWA Icon
│   ├── icon-512.png           ← PWA Icon (hochauflösend)
│   └── apple-touch-icon.png   ← iOS Home-Screen Icon
├── .gitignore
├── LICENSE                    ← MIT
├── README.md
├── ARCHITEKTUR.md             ← Diese Datei
└── .github/workflows/
    └── deploy.yml             ← GitHub Pages Deployment

studium-cards/                 ← Separates Repo (Kartenquelle)
├── 01_Fächer/
│   └── .../Kapitalwertmethode.md   ← ## Lernkarten #BWL
├── 02_Wissen/
│   ├── DHCP.md                     ← ## Lernkarten #Rechnernetze
│   ├── Transaktionskonzept.md      ← ## Lernkarten #Datenbanken
│   └── ...
└── .obsidian/
```

---

## 4. Kartenformat

```markdown
# Beliebiges Thema

Normaler Obsidian-Inhalt...

## Lernkarten #Rechnernetze       ← Trigger + Fach-Tags

Q: Frage hier?                    ← Vorderseite
A: Antwort hier.                  ← Rückseite (**Bold**, $LaTeX$)

Q: Nächste Frage?
A: Mehrzeilige Antwort
mit **Formatierung** möglich.
```

**Tag-Syntax:**
```markdown
## Lernkarten #BWL #Finanzierung       ← Mehrere Tags
## Lernkarten #Rechnernetze            ← Ein Tag
## Lernkarten                          ← Ohne Tags
```

**Parser-Logik:**
1. Sucht `## Lernkarten` (case-insensitive)
2. Extrahiert Hashtags aus dem Header
3. Content bis zur nächsten `##`-Überschrift
4. Splittet in `Q:`/`A:`-Paare
5. Generiert eindeutige IDs via Hash (`Dateipfad + Frage`)

---

## 5. Tag-basierte Filterung

```
┌──────────────────────────────────────────┐
│  [ Alle ]  [ BWL ]  [ Datenbanken ]     │  ← Tag-Chips
│  [ Rechnernetze ]                        │
├──────────────────────────────────────────┤
│  Fällig: 1   Neue: 107   Gelernt: 0     │  ← Zahlen folgen Filter
├──────────────────────────────────────────┤
│  [ Lernen starten (21) ]                 │  ← Gekappt auf Tageslimit
└──────────────────────────────────────────┘
```

- **"Neue"** zeigt die echte Anzahl (ohne Cap)
- **"Lernen starten"** respektiert das globale Tageslimit (Standard: 20/Tag)
- Filter-Leiste versteckt sich wenn keine Tags vorhanden

---

## 6. SM-2 Spaced Repetition

```
Bewertung:  Nochmal(1)  Schwer(3)  Gut(4)  Leicht(5)
                │           │         │         │
                ▼           ▼         ▼         ▼
            Reset auf    Intervall  Intervall  Intervall
            1 Tag        ×0.85      ×EF       ×EF×1.3

Ease Factor: startet 2.5, Minimum 1.3

Intervall-Entwicklung (bei "Gut"):
  1d → 6d → 15d → 38d → 94d → ...
```

**State pro Karte:**
```json
{
  "easeFactor": 2.5,
  "interval": 15,
  "repetitions": 3,
  "nextReview": "2026-04-25",
  "lastReview": "2026-04-10",
  "totalReviews": 5,
  "correctReviews": 4
}
```

---

## 7. Gamification

| Feature | Berechnung |
|---------|-----------|
| **XP** | Nochmal: 2, Schwer: 5, Gut: 10, Leicht: 15 |
| **Streak-Bonus** | +1 XP pro Streak-Tag (max +10) |
| **Level** | 100 XP pro Level |
| **Streak** | Konsekutive Lerntage |

---

## 8. Security

| Maßnahme | Implementierung |
|----------|-----------------|
| **XSS-Schutz** | `escapeHTML()` vor Markdown-Parsing |
| **CSP** | `script-src 'self' cdn.jsdelivr.net`, kein `unsafe-inline` |
| **SRI** | SHA-384 Hashes für KaTeX-CDN |
| **Input-Validierung** | `[a-zA-Z0-9._-]` für GitHub-Parameter |
| **DoS-Schutz** | Max 100 Dateien, 10er Batch, 10k Zeichen Limit |
| **Clickjacking** | `frame-ancestors 'none'` |

---

## 9. PWA & Service Worker

```
Fetch-Strategien:
  App-Dateien       → Network-First (immer aktuell, Offline-Fallback)
  CDN (KaTeX/Fonts) → Cache-First (einmal laden, dann gecached)
  GitHub API        → Kein Cache (Karten immer frisch)

Update-Flow:
  Deploy → SW erkennt Änderung → Toast → User klickt → Reload
```

---

## 10. Versionshistorie

| Version | Änderungen |
|---------|------------|
| **v1.0** | Initiale App: SM-2, Dark Mode, Gamification |
| **v1.1** | Security: XSS-Fix, CSP, SRI, Input-Validierung |
| **v1.2** | PWA: Service Worker, Manifest, Icons, Auto-Updates |
| **v1.3** | Tag-Filter für Fach-Gruppierung |
| **v1.4** | Konsistente Kartenzählung über Filter hinweg |
