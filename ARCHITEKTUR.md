# StudyCards — Architektur & Technologie

Stand: **v1.18**

---

## Gesamtkonzept

```
┌──────────────┐     auto-push      ┌──────────────┐     GitHub API     ┌──────────────┐
│   Obsidian   │ ──────────────────▶ │    GitHub     │ ◀──────────────── │  StudyCards   │
│  (Studium    │   Obsidian Git      │    Repo       │   fetch .md +     │   PWA         │
│   Vault)     │   Plugin            │  (privat)     │   Bilder (Token)  │  (Offline)    │
└──────────────┘                     └──────────────┘                    └──────────────┘
       ↑                                    ↑                                  ↑
  iCloud Sync                        GitHub Pages                        localStorage
  (Mac ↔ iPhone)                     (Hosting der App)                   (Lernfortschritt)
                                                                         Service Worker
                                                                         (Caching + Updates)
```

Die App selbst liegt in einem **öffentlichen** Repo (Voraussetzung für GitHub Pages im Free-Plan). Die Lernkarten liegen in einem **separaten, privaten** Repo und werden mit einem Fine-grained Token (nur Lesezugriff) geladen. Öffentliche Karten-Repos funktionieren weiterhin ohne Token.

---

## 1. Datenfluss

| Schritt | Was passiert | Technologie |
|---------|-------------|-------------|
| **Notizen schreiben** | Markdown-Dateien in Obsidian bearbeiten, Screenshots einfügen | Obsidian + iCloud |
| **Auto-Sync** | Git Plugin committed & pusht automatisch | Obsidian Git Plugin → GitHub |
| **App öffnen** | StudyCards lädt die Datei-Liste des Repos (Markdown + Bilder) | GitHub REST API (`/git/trees/`) |
| **Karten laden** | `.md`-Dateien in 10er-Batches abrufen | Mit Token: Contents-API · ohne: `raw.githubusercontent.com` |
| **Karten parsen** | `## Lernkarten`-Abschnitt → `Q:`/`A:`-Paare | JS-Parser |
| **Ordner & Fächer** | Verschachtelte Tags `#Ordner/Fach` auswerten | Regex-Parser |
| **Bilder anzeigen** | `![[bild.png]]` über den Repo-Index auflösen, als Blob laden | Fetch + Object-URLs + Cache API |
| **Lernen** | SM-2 berechnet Wiederholungs-Intervalle | JavaScript (Client-side) |
| **Fortschritt speichern** | XP, Streak, Kartenstände lokal | `localStorage` |
| **Offline-Cache** | App-Shell, CDN-Ressourcen und Bilder | Service Worker + Cache API |
| **Updates** | Automatischer Hinweis oder manuell „Nach Updates suchen“ | Service Worker Lifecycle |

---

## 2. Technologie-Stack

| Komponente | Technologie | Begründung |
|-----------|-------------|------------|
| **Frontend** | Vanilla HTML/CSS/JS | Kein Framework nötig, schnell, kein Build-Step |
| **Hosting** | GitHub Pages (Branch `main`, Root) | Kostenlos, kein Workflow nötig — jeder Push auf `main` wird automatisch veröffentlicht |
| **PWA** | Service Worker + Manifest | Offline-fähig, Home-Screen-Installation |
| **Persistenz** | `localStorage` | Kein Server nötig, Daten bleiben auf dem Gerät |
| **Bild-Cache** | Cache API (`studycards-img`) | Bilder offline verfügbar, übersteht App-Updates |
| **Kartenquelle** | GitHub REST API v3 | Private Repos via Fine-grained Token (read-only) |
| **LaTeX** | KaTeX v0.16.9 (mit SRI) | Schneller als MathJax, ideal für Mobile |
| **Schrift** | Google Fonts (Inter) | Professionell, gut lesbar auf Mobile |
| **Sync** | Obsidian Git Plugin | Automatisch, kein manuelles Eingreifen |

---

## 3. Dateistruktur

```
studycards/                    ← Öffentliches Repo (App)
├── index.html                 ← HTML-Struktur (Screens, Lightbox) + CSP + SRI
├── style.css                  ← Dark Mode, Animationen, Mobile-First, Querformat
├── app.js                     ← App-Logik (~1400 Zeilen), APP_VERSION
├── sw.js                      ← Service Worker (Caching, Updates), CACHE_NAME
├── manifest.json              ← PWA-Manifest
├── icons/
│   ├── icon.svg               ← Quell-Icon
│   ├── icon-192.png           ← PWA Icon
│   ├── icon-512.png           ← PWA Icon (hochauflösend)
│   └── apple-touch-icon.png   ← iOS Home-Screen Icon
├── .gitignore
├── LICENSE                    ← MIT
├── README.md
└── ARCHITEKTUR.md             ← Diese Datei

studium-cards/                 ← Separates, privates Repo (Kartenquelle)
├── 02_Wissen/
│   ├── DHCP.md                     ← ## Lernkarten #Semester-4/Rechnernetze
│   ├── Projekt.md                  ← ## Lernkarten #Semester-5/Projektmanagement
│   ├── ...
│   └── +/                          ← Anhänge (Screenshots, Grafiken)
└── 03_Canvas/
```

---

## 4. Kartenformat

```markdown
# Beliebiges Thema

Normaler Obsidian-Inhalt...

## Lernkarten #Semester-4/Rechnernetze   ← Trigger + Ordner/Fach

Q: Frage hier?                           ← Vorderseite
A: Antwort hier.                         ← Rückseite (**Bold**, $LaTeX$)

Q: Wie ist das Wasserfallmodell aufgebaut?
A: Sequenzielle Phasen …
![[Pasted image 20260408145215.png]]     ← Bild (Frage oder Antwort)
```

**Tag-Syntax:**
```markdown
## Lernkarten #Semester-4/Rechnernetze           ← Ordner „Semester 4“, Fach „Rechnernetze“
## Lernkarten #Semester-4/Rechnerarchitektur #Semester-4/Datenbanken   ← Mehrere Fächer
## Lernkarten #Englisch                          ← Ohne Ordner → „Allgemein“
## Lernkarten                                    ← Ohne Tags
```

**Bild-Syntax:**
```markdown
![[bild.png]]              ← Obsidian-Embed (nur Dateiname genügt)
![[bild.png|300]]          ← Größenangabe wird ignoriert
![Beschreibung](pfad.png)  ← Standard-Markdown
```
Unterstützt: `png`, `jpg`, `jpeg`, `gif`, `webp`, `svg`. Andere Einbettungen (z. B. Audio) bleiben Text.

**Parser-Logik:**
1. Sucht `## Lernkarten` (case-insensitive)
2. Extrahiert Hashtags inkl. `/` aus dem Header
3. Content bis zur nächsten `##`-Überschrift
4. Bereinigt eingefügte Formatierung (`&#x20;`, `&nbsp;`, Hard-Break-Backslash)
5. Splittet in `Q:`/`A:`-Paare — Frage und Antwort dürfen mehrzeilig sein
6. Generiert eindeutige IDs via Hash (`Dateipfad + erste Fragezeile`)

> Die ID nutzt bewusst nur die **erste** Fragezeile: Wird später ein Bild unter der Frage ergänzt, bleibt der Lernfortschritt erhalten.

---

## 5. Ordner- & Fach-Filter

```
┌──────────────────────────────────────────┐
│  [ Lernen starten (20) ]                 │  ← Gekappt auf Tageslimit
├──────────────────────────────────────────┤
│  [Alle Ordner] [Semester 4] [Semester 5] │  ← Ordner-Zeile
│  [Alle] [Datenbanken] [Rechnernetze] …   │  ← Fächer des gewählten Ordners
├──────────────────────────────────────────┤
│  DECKS                                   │  ← Folgen beiden Filtern
└──────────────────────────────────────────┘
```

- Tag `Ordner/Fach` wird am **letzten** `/` getrennt
- Anzeige: `-` und `_` im Ordnernamen werden zu Leerzeichen (`Semester-4` → „Semester 4“)
- Ordner werden numerisch sortiert, „Allgemein“ steht am Ende
- Ordner-Zeile erscheint nur, wenn mindestens ein Tag einen Ordner hat
- Wechsel des Ordners setzt den Fach-Filter zurück
- **„Neue“** zeigt die echte Anzahl, **„Lernen starten“** respektiert das globale Tageslimit (Standard: 20/Tag)

---

## 6. Bilder

```
Repo-Tree (einmal pro Laden)
   └─ imageIndex: Dateiname + Pfad → { path, sha }

Karte anzeigen
   └─ <img data-img="bild.png">  → _hydrateImages()
        ├─ Cache API: studycards-img / <sha>  → Treffer? → Object-URL
        └─ sonst GitHub laden (mit/ohne Token) → in Cache legen → Object-URL
```

- **Cache-Schlüssel ist der Git-SHA:** Ändert sich ein Bild, ändert sich der SHA → automatisch neu geladen
- Bilder werden erst geladen, wenn die Karte angezeigt wird
- **Lightbox:** Tap aufs Bild öffnet Vollbild (dreht die Karte nicht um), Pinch-Zoom 1–5×, Doppeltipp 1×/2,5×, Wischen verschiebt
- Fehlende Bilder: Hinweis „Bild nicht gefunden: …“ statt kaputtem Bild

---

## 7. SM-2 Spaced Repetition

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

## 8. Gamification

| Feature | Berechnung |
|---------|-----------|
| **XP** | Nochmal: 2, Schwer: 5, Gut: 10, Leicht: 15 |
| **Streak-Bonus** | +1 XP pro Streak-Tag (max +10) |
| **Level** | 100 XP pro Level |
| **Streak** | Konsekutive Lerntage |

---

## 9. Security

| Maßnahme | Implementierung |
|----------|-----------------|
| **XSS-Schutz** | `escapeHTML()` vor Markdown-Parsing; Bilder über Platzhalter, `src` nur als Blob-URL |
| **CSP** | `script-src 'self' cdn.jsdelivr.net`, `img-src 'self' data: blob:`, `connect-src 'self'` + GitHub |
| **SRI** | SHA-384 Hashes für KaTeX-CDN |
| **Input-Validierung** | `[a-zA-Z0-9._-]` für GitHub-Parameter, Token-Format `[A-Za-z0-9_]{20,255}` |
| **Token** | Fine-grained PAT, nur `Contents: Read-only` für ein Repo; liegt nur in `localStorage` des Geräts |
| **Private Kartenquelle** | Karten-Repo privat → Skript-Grafiken nicht öffentlich abrufbar |
| **DoS-Schutz** | Max 500 Dateien, 10er Batch, 10k Zeichen pro Karte |
| **Clickjacking** | `frame-ancestors 'none'` |

---

## 10. PWA, Service Worker & Updates

```
Fetch-Strategien:
  App-Dateien       → Network-First mit cache: 'no-cache'
                      (umgeht den 10-Min-HTTP-Cache von GitHub Pages, Offline-Fallback)
  CDN (KaTeX/Fonts) → Cache-First (einmal laden, dann gecached)
  GitHub API / raw  → Kein SW-Cache (Karten immer frisch)
  Bilder            → Cache API im App-Code (studycards-img, bleibt bei Updates erhalten)

Update-Wege:
  1. Automatisch:  Start / App in den Vordergrund / alle 30 Min → reg.update()
                   → neuer SW installiert → still aktivieren (kein Hinweisbalken)
                   → während einer Lernsitzung zurückgehalten, bis der Lern-Screen verlassen wird
  2. Manuell:      Einstellungen → „Nach Updates suchen“
                   → liest APP_VERSION vom Server (no-store) → bei neuer Version:
                     App-Caches löschen → SKIP_WAITING → Reload
  Nach Reload:     Toast „App aktualisiert auf vX ✓“
```

**Release-Checkliste:** `APP_VERSION` in `app.js` **und** `CACHE_NAME` in `sw.js` gemeinsam erhöhen.

> iOS hält Home-Screen-Apps im Hintergrund, statt sie neu zu laden — deshalb der Update-Check bei `visibilitychange`. Jede Home-Screen-App hat außerdem einen eigenen `localStorage` (Fortschritt, Token): Die App vom Home-Bildschirm zu löschen setzt beides zurück.

---

## 11. Versionshistorie

| Version | Änderungen |
|---------|------------|
| **v1.0** | Initiale App: SM-2, Dark Mode, Gamification |
| **v1.1** | Security: XSS-Fix, CSP, SRI, Input-Validierung |
| **v1.2** | PWA: Service Worker, Manifest, Icons, Auto-Updates |
| **v1.3** | Tag-Filter für Fach-Gruppierung |
| **v1.4** | Konsistente Kartenzählung über Filter hinweg |
| **v1.5** | Karte per Tap zurück zur Frage drehen, Update-Bestätigung nach Reload |
| **v1.6** | Datei-Limit von 100 auf 500 erhöht |
| **v1.7** | Ordner über verschachtelte Tags (`#Semester-4/Fach`) |
| **v1.8** | Parser toleriert eingefügte Formatierung aus Word/Web |
| **v1.9** | Bilder in Karten, private Repos per Token, mehrzeilige Fragen |
| **v1.10** | Keine Auto-Großschreibung/-Korrektur in den Setup-Feldern |
| **v1.11** | Querformat-Layout korrigiert, Pinch-Zoom in der Bildansicht |
| **v1.12** | Update-Check beim Zurückkehren in die App (iOS) |
| **v1.13** | Update-Hinweis zuverlässig, mit ✕ schließbar |
| **v1.14** | „Nach Updates suchen“ in den Einstellungen, HTTP-Cache umgangen |
| **v1.15** | Multiple-Choice-Karten über Obsidian-Checkboxen (`- [x]` / `- [ ]`) |
| **v1.16** | Stille Auto-Updates statt Hinweisbalken; flache Karten-Animation statt 3D (Scrollen auf iOS) |
| **v1.17** | „Antwort zeigen“-Knopf entfernt: Karte per Tap umdrehen, Umdreh-Symbol oben rechts (MC behält „Prüfen“) |
| **v1.18** | Karte nutzt die volle Bildschirmhöhe; Platz für Bewertungsknöpfe wird reserviert (kein Springen beim Umdrehen) |
