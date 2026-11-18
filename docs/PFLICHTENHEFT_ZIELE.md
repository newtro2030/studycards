# Pflichtenheft – Lernziele („Ziel festlegen“)

Version 1.0 · 18. November 2026 · Status: **freigegeben** (Umsetzung in Schritten, siehe Abschnitt 5)

## 1. Zweck

Ein Lernziel verbindet einen Kartenumfang mit einem Termin, zum Beispiel „Mathe – Brüche, Klassenarbeit am 4. Dezember, Wunschnote 2“. Die App berechnet daraus den täglichen Lernplan und zeigt gut sichtbar Countdown und Fortschritt. Wenn das Ziel erreicht ist, gibt es Konfetti.

Zielgruppen sind sowohl das Studium (Prüfungen pro Semester) als auch die Schule (Klara, 6. Klasse und später, Klassenarbeiten und Vokabeltests).

## 2. Begriffe und Kartenumfang

Die vorhandene Tag-Struktur wird unverändert genutzt:

| Tag in der Notiz | Ordner (oben) | Fach/Thema (darunter) |
|---|---|---|
| `#Semester-5/Projektmanagement` | Semester 5 | Projektmanagement |
| `#Mathe/Brüche` | Mathe | Brüche |
| `#Englisch/Unit-2` | Englisch | Unit 2 |

- Ein Ziel umfasst **einen Ordner** und darin **ein oder mehrere Themen**, standardmäßig alle.
- Der Parser bleibt unverändert, und die Karten-IDs bleiben gleich. Der Lernfortschritt geht also nicht verloren.
- `klara-cards` ist auf `#Fach/Thema` umgestellt: `#Englisch/Blue-Line-1`, `#MNT/Wirbeltiere`, `#Mathe/Beispiele`. Die Vokabelliste enthält keine Unit-Grenzen; neue Units bekommen eigene Abschnitte, zum Beispiel `## Lernkarten #Englisch/Blue-Line-2-Unit-1`.

## 3. Funktionen

### Z1 Ziel anlegen und bearbeiten
- Name (frei, max. 60 Zeichen), Ordner und Themen, Prüfungsdatum.
- Wunschnote:
  - Schule: 1–6
  - Studium: 1,0–4,0
  - Die App leitet daraus eine Zielmarke in % ab (siehe Z3). Die Marke lässt sich manuell überschreiben.
- Puffertage vor der Prüfung, Standard 2. In dieser Zeit gibt es keine neuen Karten, nur Wiederholung.
- Mehrere Ziele können gleichzeitig aktiv sein, etwa für verschiedene Fächer.

### Z2 Tagesplan
- `neue Karten pro Tag für dieses Ziel = offene neue Karten ÷ verbleibende Lerntage`, wobei die Lerntage bis zum Prüfungsdatum minus Puffertage gezählt werden, aufgerundet.
- Für Karten eines Ziels **ersetzt** diese Zahl die Einstellung „Neue Karten pro Tag“. Für alle übrigen Karten gilt die Einstellung weiter.
- Die Zahl ist auf höchstens 60 neue Karten pro Tag und Ziel gedeckelt. Liegt der Bedarf darüber, zeigt das Ziel den Hinweis „Plan wird knapp“.
- Fällige Wiederholungen werden immer zusätzlich angezeigt.
- **Nachholen:** Gibt es in den Puffertagen oder am Prüfungstag noch nie gelernte Karten, etwa bei Rückstand oder einem spät angelegten Ziel, kommen sie sofort, höchstens 60 pro Tag. Sonst blieben sie bis zur Prüfung ungelernt.

### Z3 Wissensstand und Wunschnote
- Eine Karte gilt als **sicher**, wenn ihre letzte Antwort mindestens „Gut“ war und ihr Abstand mindestens 3 Tage beträgt.
- Wissensstand = sichere Karten ÷ alle Karten des Ziels, in %.
- Vorgeschlagene Zuordnung von Note zu Zielmarke. Sie ist eine Richtschnur, keine Garantie für die echte Note.

| Schule | Studium | Zielmarke |
|---|---|---|
| 1 | 1,0–1,3 | 92 % |
| 2 | 1,7–2,3 | 81 % |
| 3 | 2,7–3,3 | 67 % |
| 4 | 3,7–4,0 | 50 % |
| 5/6 | – | kein sinnvolles Ziel; die Auswahl wird nicht angeboten |

### Z4 Prüfungsmodus
- Eine gelernte Karte eines laufenden Ziels, deren nächster Termin nach dem Tag vor der Prüfung läge, wird **am Tag vor der Prüfung** fällig. So kommt jede Karte vor der Prüfung noch einmal dran. Ausgenommen sind Karten, die an diesem Tag schon wiederholt wurden.
- Der Termin wird nur bei der Abfrage begrenzt und nicht gespeichert:
  - Das gilt auch für Karten, die schon vor dem Anlegen des Ziels eingeplant waren.
  - Nach Löschen oder Archivieren des Ziels gelten wieder die normalen Termine.
- Die Abstände auf den Bewertungsknöpfen zeigen den tatsächlichen nächsten Termin.
- Die Bewertung der Karte selbst (SM-2, Abstand, Wissensstand) bleibt unverändert.

### Z5 Anzeige und Gamification
- **Startseite:** Eine Zielkarte pro aktivem Ziel steht ganz oben, vor den Stapeln. Sie zeigt:
  - Name und Countdown („noch 16 Tage“)
  - einen Fortschrittsbalken mit Markierung der Zielmarke
  - die Wunschnote
  - das Tagesziel („heute 12 neu · 30 fällig“) mit Häkchen, sobald es erledigt ist
- **Tippen auf die Zielkarte** startet eine Lernrunde nur mit den Karten dieses Ziels.
- **Meilensteine:** Bei 25 %, 50 % und 75 % erscheint ein kurzer Hinweis. Beim Erreichen der Zielmarke gibt es Konfetti und den Hinweis „Ziel erreicht – Note 2 in Reichweite!“.
- **Tagesziel erledigt:** Es gibt eine kleine Bestätigung und Bonus-XP für das vorhandene XP-System.
- Das Konfetti ist selbst gebaut, ohne externe Bibliothek, und bei „Bewegung reduzieren“ abgeschwächt.

### Z6 Archiv
- Am Tag nach dem Prüfungsdatum wandert ein Ziel automatisch ins Archiv, sobald die Startseite mit geladenen Karten angezeigt wird. Manuell geht das auch früher, etwa wenn die Arbeit verschoben wird.
- Im Archiv stehen der beim Archivieren festgehaltene Wissensstand (in der Regel der Stand am Ende des Prüfungstags) und die Zielmarke.
- Optional lässt sich die tatsächliche Note eintragen.
- Archivierte Ziele lassen sich löschen oder als neues Ziel kopieren.
- Die Karten selbst laufen nach dem Archivieren normal weiter.

### Z7 Daten
- Die Ziele werden lokal gespeichert, versioniert wie beim Pomodoro (`sc_goals`, `{version, data}`). Sie gelten pro Gerät.
- Die Ziele haben eine **eigene Sicherung** im Lernziele-Bildschirm (Format `studycards-goals-backup`), getrennt von der Pomodoro-Sicherung, damit ein Pomodoro-Import keine Ziele überschreibt. Ein Import ersetzt alle Ziele des Geräts, nach Rückfrage.

## 4. Technische Vorarbeit (gefunden bei der Prüfung)

`today()` in `app.js` rechnet in UTC. In Deutschland ist zwischen 0 und 1 Uhr (Sommerzeit 0–2 Uhr) dadurch noch „gestern“. Das betrifft schon heute die Fälligkeit und das Tageslimit. Für Countdown und Tagesziel muss das korrigiert werden, damit die App mit dem lokalen Datum rechnet wie beim Pomodoro. Gespeicherte Daten bleiben gültig.

## 5. Umsetzungsschritte (Vorschlag)

| Schritt | Inhalt | Dateien |
|---|---|---|
| 1 | Lokales Datum korrigieren; reine Ziel-Logik in `goals.js` (Wissensstand, Tagesplan, Notenschlüssel, Archivregel, Speichern), dazu Tests | `app.js` (nur `today()`), `goals.js` neu, `tests/goals.test.cjs` neu, `sw.js` (App-Shell) |
| 2 | Ziel anlegen, bearbeiten und löschen (Formular) | `index.html`, `app.js`, `style.css` |
| 3 | Zielkarte auf der Startseite und Lernrunde pro Ziel | `index.html`, `app.js`, `style.css` |
| 4 | Tagesplan ersetzt „Neue Karten pro Tag“ für Ziel-Karten; Prüfungsmodus (Z4) | `app.js`, `goals.js` |
| 5 | Gamification: Meilensteine, Konfetti, Bonus-XP | `app.js`, `style.css` |
| 6 | Archiv, Sicherung, Doku, Versionssprung | `app.js`, `index.html`, `README.md`, `ARCHITEKTUR.md`, dieses Dokument |

Nach jedem Schritt folgen ein Bericht und die Prüfung (Tests, Vorschau auf 375 px und 1440 px), danach deine Freigabe vor dem Push.

## 6. Entscheidungen vom 18. November 2026

1. Die Zuordnung von Note zu % (Z3) ist freigegeben.
2. Standardmäßig gibt es 2 Puffertage, pro Ziel änderbar. Freigegeben.
3. Die Obergrenze von 60 neuen Karten pro Tag und Ziel ist freigegeben.
4. Die `klara-cards`-Tags sind auf `#Fach/Thema` umgestellt.
5. Der Tagesplan ersetzt für die Karten eines Ziels die Einstellung „Neue Karten pro Tag“. Das ist eine Entscheidung des Entwicklers, vom Auftraggeber übertragen.
6. Mehrere Ziele können gleichzeitig aktiv sein, für Studium und Schule.

## 7. Umsetzungsstand

- **Schritt 1:** Erledigt.
  - `today()` und alle Tagesschlüssel rechnen mit lokalem Datum.
  - SM-2 speichert zusätzlich `lastQuality`.
  - `goals.js` enthält die reine Logik, `tests/goals.test.cjs` 25 Tests.
- **Schritt 2:** Erledigt.
  - Die Startseiten-Kachel „Lernziele“ führt zur Zielliste.
  - Das Formular hat die Felder Name, Bereich Schule/Studium, Fach, Themen (Mehrfachauswahl), Prüfungsdatum, Wunschnote, Puffertage und eine optionale Zielmarke.
  - Eine Vorschau zeigt Kartenzahl und neue Karten pro Tag.
  - Ziele lassen sich bearbeiten und löschen.
  - Beschädigte Daten werden erkannt und nicht überschrieben.
- **Schritt 3:** Erledigt.
  - Zielkarten stehen oben auf der Startseite. Sie zeigen Countdown (orange ab 3 Tagen), Fortschrittsbalken (hell: angefangen, Verlauf: sicher, Strich: Zielmarke) und die Tagesaufgabe mit „Los ›“.
  - Antippen startet eine Lernrunde nur mit den Karten dieses Ziels; „Weiter lernen“ bleibt im Ziel.
  - Der Abschluss-Bildschirm zeigt den Fortschritt der Runde.
  - Neu ist das Nachholen nie gelernter Karten in den Puffertagen (Z2).
- **Schritt 4:** Erledigt.
  - „Lernen starten“ und die Stapel nehmen die neuen Karten laufender Ziele nach deren Tagesplan auf.
  - Für alle anderen Karten gilt „Neue Karten pro Tag“; dabei zählen nur Karten ohne Ziel.
  - Der Prüfungsmodus (Z4) gilt für Fälligkeit, Zielkarten, Stapel und die Intervall-Vorschau.
- **Schritt 5:** Erledigt.
  - Nach jeder Bewertung werden die Ziele dieser Karte ausgewertet.
  - **Meilenstein** 25/50/75 %: Banner und +15 XP.
  - **Tagesziel erledigt:** Banner, kleines Konfetti, +25 XP; Serie „🔥 n Tage in Folge“ auf der Zielkarte.
  - **Zielmarke erreicht:** große Anzeige „Ziel erreicht! Note … ist in Reichweite!“, großes Konfetti, +100 XP.
  - Jedes Ereignis wird nur einmal gefeiert (`reached`, `dailyDone`).
  - Bei „Bewegung reduzieren“ gibt es kein Konfetti.
  - Ziele aus v1.29–v1.31 ohne `dailyDone` bleiben gültig.
- **Schritt 6:** Erledigt.
  - Automatisches und manuelles Archivieren.
  - Archivliste mit festgehaltenem Wissensstand, Zielmarke und Wunschnote, dazu die echte Note: Schule 1–6, Studium 1,0–5,0.
  - „Als neues Ziel“ kopiert Fach, Themen, Note und Puffer, ohne Datum.
  - Archivierte Ziele lassen sich löschen.
  - Eigene Sicherung mit Export und Import.
  - README und ARCHITEKTUR sind aktualisiert.

## 8. Abnahme-Checkliste (Umsetzung v1.33)

Je Gerät prüfen: iPhone (Home-Bildschirm-App), Safari (Mac) und Chrome.

| Nr. | Prüfung | Erwartung |
|---|---|---|
| Z-A1 | Update auf v1.33 (Einstellungen → Nach Updates suchen) | Kachel „Lernziele“ auf der Startseite |
| Z-A2 | Ziel anlegen: Fach, Thema, Datum, Wunschnote | Vorschau zeigt Karten und neue Karten pro Tag; nach dem Speichern erscheint die Zielkarte oben |
| Z-A3 | Pflichtfelder leer lassen und speichern | Klare Hinweise an den Feldern, nichts gespeichert |
| Z-A4 | Zielkarte antippen und Runde beenden | Nur Karten des Ziels; Abschluss zeigt Fortschritt; Banner „Tagesziel erledigt“ mit Konfetti |
| Z-A5 | „Lernen starten“ mit Ziel und anderen Fächern | Ziel-Karten nach Tagesplan plus übrige Karten nach „Neue Karten pro Tag“ |
| Z-A6 | Am nächsten Tag | Neuer Tagesplan; Serie 🔥 nach zwei Tagen in Folge |
| Z-A7 | Ziel bearbeiten (Name, Datum, Note) und löschen | Änderungen sofort auf der Zielkarte; Lernfortschritt bleibt |
| Z-A8 | Ziel mit Prüfung in 2 Tagen anlegen | „Nachholen: … neue Karten“ |
| Z-A9 | Tag vor der Prüfung | Alle Ziel-Karten fällig, die nicht gerade erst wiederholt wurden; danach nicht erneut |
| Z-A10 | Tag nach der Prüfung | Hinweis „… ist ins Archiv gewandert“; im Archiv: Wissensstand, Note eintragbar |
| Z-A11 | Archiv: „Als neues Ziel“ | Formular vorbelegt, Datum leer |
| Z-A12 | Sicherung exportieren und auf anderem Gerät importieren | Gleiche Ziele (iPhone: Teilen-Menü / Dateien) |
| Z-A13 | „Bewegung reduzieren“ (iPhone: Einstellungen → Bedienungshilfen) | Kein Konfetti, Anzeigen erscheinen trotzdem |
| Z-A14 | VoiceOver: Zielkarte, Formular, Anzeige „Ziel erreicht“ | Alles vorgelesen und bedienbar |
