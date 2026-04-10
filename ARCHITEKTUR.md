# StudyCards -- Architektur & Technologie

---

## Gesamtkonzept

```
┌──────────────┐     auto-push      ┌──────────────┐     GitHub API     ┌──────────────┐
│   Obsidian   │ ──────────────────▶ │    GitHub     │ ◀──────────────── │  StudyCards   │
│  (Studium    │   Obsidian Git      │    Repo       │   fetch .md       │   Web-App     │
│   Vault)     │   Plugin, 10min     │  (öffentlich) │   Dateien         │  (Browser)    │
└──────────────┘                     └──────────────┘                    └──────────────┘
       ↑                                    ↑                                  ↑
  iCloud Sync                        GitHub Pages                        localStorage
  (Mac ↔ iPhone)                     (Hosting)                          (Lernfortschritt)
```

---

## 1. Datenfluss

| Schritt | Was passiert | Technologie |
|---------|-------------|-------------|
| **Notizen schreiben** | Du schreibst/bearbeitest `.md`-Dateien in Obsidian | Obsidian + iCloud |
| **Auto-Sync** | Git Plugin committed & pusht alle 10 Min | Obsidian Git Plugin → GitHub API |
| **App öffnen** | StudyCards lädt die Datei-Liste des Repos | GitHub REST API (`/git/trees/`) |
| **Karten parsen** | Jede `.md`-Datei wird nach `## Lernkarten` durchsucht | `raw.githubusercontent.com` + JS-Parser |
| **Lernen** | SM-2 Algorithmus berechnet Wiederholungs-Intervalle | JavaScript im Browser |
| **Fortschritt speichern** | XP, Streak, Kartenstände werden lokal gespeichert | `localStorage` (5-10 MB) |

---

## 2. Technologie-Stack

| Komponente | Technologie | Warum |
|-----------|-------------|-------|
| **Frontend** | Vanilla HTML/CSS/JS | Kein Framework nötig, schnell, keine Build-Tools |
| **Hosting** | GitHub Pages | Kostenlos, automatisches Deployment |
| **Datenbank** | `localStorage` | Kein Server nötig, Daten bleiben im Browser |
| **Kartenquelle** | GitHub API v3 | Öffentliches Repo, kein Token nötig |
| **LaTeX-Rendering** | KaTeX | Schneller als MathJax, perfekt für mobile |
| **Schrift** | Google Fonts (Inter) | Professionell, gut lesbar auf Mobile |
| **Sync** | Obsidian Git Plugin | Automatisch, kein manuelles Eingreifen |

---

## 3. Dateistruktur

```
studycards/                    ← GitHub Repo (Web-App)
├── index.html                 ← Komplette HTML-Struktur (alle 6 Screens)
├── style.css                  ← Dark Mode, Animationen, Mobile-First
├── app.js                     ← Gesamte App-Logik (900+ Zeilen)
└── .github/workflows/
    └── deploy.yml             ← Automatisches GitHub Pages Deployment

studium-cards/                 ← GitHub Repo (Kartenquelle)
├── 01_Fächer/
│   └── .../Kapitalwertmethode.md   ← enthält ## Lernkarten
├── 02_Wissen/
│   └── Transaktionskonzept.md      ← enthält ## Lernkarten
├── 03_Canvas/
└── .obsidian/
```

---

## 4. Kartenformat

```markdown
# Beliebige Notiz

Normaler Obsidian-Inhalt, Wikilinks, Tags etc.

## Lernkarten              ← Trigger für den Parser

Q: Frage hier?             ← Vorderseite der Karte
A: Antwort hier.           ← Rückseite, unterstützt **Bold**, $LaTeX$

Q: Nächste Frage?
A: Mehrzeilige Antwort
mit **Formatierung** möglich.
```

**Parser-Logik:**
1. Sucht `## Lernkarten` (case-insensitive)
2. Extrahiert alles bis zur nächsten `##`-Überschrift
3. Splittet in `Q:`/`A:`-Paare
4. Generiert eine eindeutige ID pro Karte via Hash (`Dateipfad + Frage`)

---

## 5. SM-2 Spaced Repetition Algorithmus

```
Bewertung:  Nochmal(1)  Schwer(3)  Gut(4)  Leicht(5)
                │           │         │         │
                ▼           ▼         ▼         ▼
            Reset auf    Intervall  Intervall  Intervall
            1 Tag        ×0.85      ×EF       ×EF×1.3

Ease Factor (EF): startet bei 2.5, passt sich an (min. 1.3)

Intervall-Entwicklung bei "Gut":
  1. Review → 1 Tag
  2. Review → 6 Tage
  3. Review → 6 × 2.5 = 15 Tage
  4. Review → 15 × 2.5 = 38 Tage
  ...
```

**Pro Karte gespeichert:**
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

## 6. Gamification-System

| Feature | Berechnung |
|---------|-----------|
| **XP pro Karte** | Nochmal: 2 XP, Schwer: 5 XP, Gut: 10 XP, Leicht: 15 XP |
| **Streak-Bonus** | +1 XP pro Streak-Tag (max +10) |
| **Level** | Alle 100 XP ein Level-Up |
| **Streak** | Tage in Folge gelernt (reset bei verpasstem Tag) |

---

## 7. App-Screens

```
┌─ Loading ──▶ Setup ──▶ Dashboard ──┐
│                           │         │
│                     ┌─────┼─────┐   │
│                     ▼     ▼     ▼   │
│                   Stats  Study  Settings
│                           │
│                           ▼
│                       Complete ──▶ Dashboard
└─────────────────────────────────────┘
```

| Screen | Funktion |
|--------|----------|
| **Loading** | Zeigt Spinner während KaTeX + Karten laden |
| **Setup** | GitHub-Repo Verbindung konfigurieren |
| **Dashboard** | Streak/XP/Level, fällige Karten, Deck-Liste |
| **Study** | Karteikarten mit Flip-Animation + Rating |
| **Complete** | Session-Zusammenfassung (Karten, XP, Genauigkeit) |
| **Stats** | Gesamtfortschritt, 7-Tage-Heatmap, Bestleistungen |
| **Settings** | Repo-Config, Karten/Tag, XP-Toggle, Reset |

---

## 8. Limitierungen & zukünftige Erweiterungen

| Limitierung | Mögliche Lösung |
|------------|----------------|
| Fortschritt nur auf einem Gerät | JSON-Export ins GitHub-Repo |
| GitHub API Rate-Limit (60/h ohne Token) | Token-Support oder Caching |
| Nur klassische Karteikarten | Lückentext + Multiple Choice ergänzen |
| Keine Offline-Nutzung | Service Worker / PWA |
