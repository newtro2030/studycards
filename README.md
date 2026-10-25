# StudyCards

Eine Progressive Web App zum Lernen von Karteikarten aus Obsidian-Notizen mit Spaced Repetition.

![Version](https://img.shields.io/badge/version-1.17-7c3aed)
![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android%20%7C%20Desktop-brightgreen)

## Features

- **Spaced Repetition (SM-2)** — Optimierte Wiederholungs-Intervalle für langfristiges Behalten
- **Obsidian-Integration** — Liest `Q:/A:`-Karteikarten direkt aus Markdown-Dateien
- **Ordner & Fächer** — Karten per Tag gruppieren (`## Lernkarten #Semester-4/Rechnernetze`)
- **Bilder & Screenshots** — Obsidian-Embeds `![[bild.png]]` in Frage und Antwort, Vollbild mit Pinch-Zoom
- **Private Repos** — Optionaler GitHub-Token (nur Lesezugriff) für nicht-öffentliche Notizen
- **Offline-fähig** — PWA mit Service Worker; Karten-Bilder werden zwischengespeichert
- **Multiple Choice** — Obsidian-Checkboxen `- [x]` / `- [ ]` unter einer Frage werden zur MC-Aufgabe
- **Automatische Updates** — Still im Hintergrund, nie mitten in einer Lernsitzung; manuell über „Nach Updates suchen“
- **LaTeX-Support** — Mathematische Formeln via KaTeX
- **Gamification** — XP, Levels, Streaks für Lernmotivation
- **Dark Mode** — Mobile-first Design, optimiert für iPhone (Hoch- und Querformat)

## Schnellstart

1. Lege ein GitHub-Repository mit deinen Obsidian-Notizen an
2. Öffne [newtro2030.github.io/studycards](https://newtro2030.github.io/studycards/)
3. Gib GitHub-Benutzernamen und Repository-Namen ein
4. **Privates Repo?** Zusätzlich einen GitHub-Token eintragen (siehe unten)
5. Fertig — Karten werden automatisch geladen

Tipp: Über *Teilen → Zum Home-Bildschirm* wird StudyCards zur App auf dem Handy.

## Kartenformat

Füge einen `## Lernkarten`-Abschnitt in eine beliebige `.md`-Datei ein:

```markdown
# Beliebiges Thema

Normaler Obsidian-Inhalt...

## Lernkarten #Semester-4/Datenbanken

Q: Wofür steht ACID?
A: **Atomarität**, **Konsistenz**, **Isolation**, **Dauerhaftigkeit**

Q: Was ist die Kapitalwertmethode?
A: Die Summe aller auf den Zeitpunkt $t_0$ abgezinsten Cashflows.

Q: Wie ist das Wasserfallmodell aufgebaut?
A: Sequenzielle Phasen, die nacheinander durchlaufen werden.
![[wasserfallmodell.png]]
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
| Bilder | `![[bild.png]]` oder `![alt](pfad/bild.png)` |

Bilder (`png`, `jpg`, `gif`, `webp`, `svg`) werden im Repo per Dateiname gefunden — Obsidians Standard-Linkformat „kürzester Pfad“ funktioniert direkt. Tipp aufs Bild öffnet die Vollbildansicht.

### Ordner & Fächer

Tags im Header gruppieren Karten. Vor dem `/` steht der Ordner, danach das Fach:

```markdown
## Lernkarten #Semester-4/Rechnernetze    → Ordner „Semester 4“, Fach „Rechnernetze“
## Lernkarten #Semester-5/BWL #Semester-5/Recht   → Mehrere Fächer
## Lernkarten #Englisch                   → Ohne Ordner → „Allgemein“
## Lernkarten                             → Keine Tags (funktioniert auch)
```

Obsidian zeigt verschachtelte Tags im Tag-Bereich ebenfalls als Ordner an.

## Private Repositories

Für private Repos braucht StudyCards einen **Fine-grained Personal Access Token**:

1. [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
2. **Repository access:** *Only select repositories* → dein Karten-Repo
3. **Permissions → Contents:** *Read-only*
4. Token kopieren und in StudyCards unter *Einstellungen → Repository ändern → GitHub-Token* eintragen

Der Token wird nur lokal auf dem Gerät gespeichert und erlaubt ausschließlich Lesezugriff auf das gewählte Repo.

## Updates

Die App sucht beim Öffnen automatisch nach neuen Versionen und spielt sie still ein – während einer Lernsitzung erst, wenn du sie verlässt. Sofort aktualisieren: *Einstellungen → Info → Nach Updates suchen*. Lernfortschritt, Token und Bild-Cache bleiben bei Updates erhalten.

## Architektur

```
Obsidian → Obsidian Git Plugin → GitHub Repo → StudyCards PWA
                (auto-push)       (Quelle)       (Browser)
```

Siehe [ARCHITEKTUR.md](ARCHITEKTUR.md) für eine detaillierte technische Dokumentation.

## Technologie-Stack

| Komponente | Technologie |
|-----------|-------------|
| Frontend | Vanilla HTML/CSS/JS |
| Hosting | GitHub Pages |
| Offline | Service Worker (PWA) + Cache API |
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
2. Verbinde den Vault mit einem GitHub-Repository (privat empfohlen)
3. Konfiguriere Auto-Push (empfohlen: alle 10 Minuten)
4. Optional: *Einstellungen → Dateien & Links → Ordnerpfad für Anhänge* setzen, damit Screenshots gesammelt in einem Ordner landen
5. Füge `## Lernkarten` mit `Q:/A:`-Paaren in deine Notizen ein

## Lizenz

MIT
