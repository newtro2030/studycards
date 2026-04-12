# StudyCards

Eine Progressive Web App zum Lernen von Karteikarten aus Obsidian-Notizen mit Spaced Repetition.

![Version](https://img.shields.io/badge/version-1.4-7c3aed)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android%20%7C%20Desktop-brightgreen)

## Features

- **Spaced Repetition (SM-2)** — Optimierte Wiederholungs-Intervalle für langfristiges Behalten
- **Obsidian-Integration** — Liest `Q:/A:`-Karteikarten direkt aus Markdown-Dateien
- **Tag-basierte Filterung** — Karten nach Fächern gruppieren (`## Lernkarten #Rechnernetze`)
- **Offline-fähig** — PWA mit Service Worker, funktioniert ohne Internet
- **LaTeX-Support** — Mathematische Formeln via KaTeX
- **Gamification** — XP, Levels, Streaks für Lernmotivation
- **Dark Mode** — Mobile-first Design, optimiert für iPhone

## Schnellstart

1. Erstelle ein öffentliches GitHub-Repository mit deinen Obsidian-Notizen
2. Öffne [newtro2030.github.io/studycards](https://newtro2030.github.io/studycards/)
3. Gib deinen GitHub-Benutzernamen und Repository-Namen ein
4. Fertig — Karten werden automatisch geladen

## Kartenformat

Füge einen `## Lernkarten`-Abschnitt in eine beliebige `.md`-Datei ein:

```markdown
# Beliebiges Thema

Normaler Obsidian-Inhalt...

## Lernkarten #Modulname

Q: Was ist die Kapitalwertmethode?
A: Die Summe aller auf den Zeitpunkt $t_0$ abgezinsten Cashflows.

Q: Wofür steht ACID?
A: **Atomarität**, **Konsistenz**, **Isolation**, **Dauerhaftigkeit**
```

### Unterstützte Formatierung

| Format | Syntax |
|--------|--------|
| Fett | `**text**` |
| Kursiv | `*text*` |
| Code | `` `code` `` |
| Listen | `- item` oder `1. item` |
| LaTeX (inline) | `$formel$` |
| LaTeX (block) | `$$formel$$` |
| Tabellen | Standard-Markdown |

### Tags

Hashtags im Header gruppieren Karten nach Fächern:

```markdown
## Lernkarten #Rechnernetze           → Tag: Rechnernetze
## Lernkarten #BWL #Finanzierung      → Tags: BWL, Finanzierung
## Lernkarten                          → Keine Tags (funktioniert auch)
```

## Architektur

```
Obsidian → Obsidian Git Plugin → GitHub Repo → StudyCards PWA
                (auto-push)        (Quelle)      (Browser)
```

Siehe [ARCHITEKTUR.md](ARCHITEKTUR.md) für eine detaillierte technische Dokumentation.

## Technologie-Stack

| Komponente | Technologie |
|-----------|-------------|
| Frontend | Vanilla HTML/CSS/JS |
| Hosting | GitHub Pages |
| Offline | Service Worker (PWA) |
| Daten | localStorage |
| LaTeX | KaTeX |
| API | GitHub REST API v3 |

## Selbst hosten

```bash
git clone https://github.com/newtro2030/studycards.git
cd studycards
npx http-server -p 8080
```

Öffne `http://localhost:8080` im Browser.

## Obsidian-Sync einrichten

1. Installiere das [Obsidian Git Plugin](https://github.com/denolehov/obsidian-git)
2. Erstelle ein öffentliches GitHub-Repository
3. Konfiguriere Auto-Push (empfohlen: alle 10 Minuten)
4. Füge `## Lernkarten` mit `Q:/A:`-Paaren in deine Notizen ein

## Lizenz

MIT
