# Pflichtenheft – FSRS statt SM-2

Version 1.0 · 18. November 2026 · Status: **Entscheidungen getroffen** (Abschnitt 7), Schritt 1 wartet auf Freigabe

## 1. Zweck

StudyCards plant Wiederholungen bisher mit **SM-2** (1987). SM-2 vergrößert den Abstand nach festen Faustregeln, etwa „richtig, also mal 2,5“. Das gilt für jede Karte und jeden Menschen gleich.

**FSRS** (Free Spaced Repetition Scheduler) beschreibt das Gedächtnis pro Karte mit zwei Werten:

- **Stabilität S:** Nach wie vielen Tagen man die Karte noch mit 90 % Wahrscheinlichkeit weiß.
- **Schwierigkeit D:** Ein Wert von 1 bis 10, der bestimmt, wie stark S nach einer richtigen Antwort wächst.

Daraus berechnet FSRS den Tag, an dem die **Abrufwahrscheinlichkeit R** auf die gewünschte Behaltensrate fällt (Standard 90 %). Genau dann kommt die Karte wieder. In öffentlichen Vergleichen mit Millionen von Wiederholungen braucht FSRS für denselben Lernerfolg etwa 20–30 % weniger Wiederholungen als SM-2. Das ist die Zahl, mit der retain.cards wirbt. Anki bietet FSRS seit Version 23.10 ebenfalls an.

Der Lernstand ist noch leer (Aussage vom 18.11.2026), eine Umrechnung alter Daten ist also nicht nötig. **FSRS wird Standard. SM-2 bleibt in den Einstellungen wählbar** (Entscheidung, Abschnitt 7).

## 2. Prüfung: Passt FSRS zur App?

| Stelle in der App | Heute (SM-2) | Mit FSRS | Aufwand |
|---|---|---|---|
| Bewertung | 4 Knöpfe: Nochmal 1, Schwer 3, Gut 4, Einfach 5 | FSRS kennt genau 4 Noten: Again 1, Hard 2, Good 3, Easy 4. Die Zuordnung ist eins zu eins. | keiner |
| Zeiteinheit | ganze Tage (`nextReview` als Datum) | FSRS-6 arbeitet mit Tagen. Mehrfaches Wiederholen am selben Tag hat eine eigene Formel. | gering |
| „Nochmal“ in der Sitzung | Karte kommt 3–5 Karten später erneut | Bleibt so. Die zweite Bewertung am selben Tag nutzt die Kurzzeitformel (Abschnitt 4). | gering |
| Kartenzustand `sc_cards` | `easeFactor, interval, repetitions, …` | Neu: `stability, difficulty, lapses`. `interval` und `repetitions` werden weiter geschrieben. | gering |
| Vorschau unter den Knöpfen | `SM2.previewIntervals` | Gleiche Schnittstelle, neue Rechnung | keiner |
| Lernziele „sicher“ (`goals.js`) | `interval ≥ 3`, `repetitions > 0`, `lastQuality ≥ 4` | Funktioniert unverändert, weil `interval` und `repetitions` bleiben. Besser wäre es, R am Prüfungstag zu nutzen (Abschnitt 7, Frage 3). | keiner / mittel |
| Prüfungsmodus (`effectiveDue`) | deckelt den Termin auf den Tag vor der Prüfung | unverändert | keiner |
| Statistik „Gefestigt“ (`interval ≥ 21`) | | unverändert | keiner |
| Bibliothek | | **Keine fremde Bibliothek.** Eigenes Modul `fsrs.js` mit den veröffentlichten Formeln (etwa 120 Zeilen), wie `goals.js` als UMD-Modul und mit Node-Tests. Die CSP bleibt unverändert. | mittel |

Ergebnis: Die App ist gut vorbereitet. Alles, was SM-2 nutzt, läuft über `SM2.calcNext` und `SM2.previewIntervals`. Wenn diese beiden Funktionen ersetzt werden, ist der Kern umgestellt.

## 3. Funktionen

### F1 Planung mit FSRS-6
- Ein neues Modul `fsrs.js` setzt FSRS-6 mit den 21 Standardparametern um. Quelle ist die Referenz-Bibliothek `ts-fsrs` (MIT-Lizenz), nachprogrammiert und nicht eingebunden:
  `0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542`
- `SM2.calcNext(state, quality)` wird durch `Scheduler.calcNext` ersetzt. Die Zuordnung ist: Nochmal → 1, Schwer → 2, Gut → 3, Einfach → 4.
- **Beide Verfahren rechnen immer mit.** Jede Bewertung aktualisiert die FSRS-Werte (`stability`, `difficulty`) und den SM-2-Wert (`easeFactor`). Die Einstellung bestimmt nur, welches Verfahren den **nächsten Termin** festlegt. So geht beim Umschalten nichts verloren, und schon geplante Termine bleiben stehen.
- Neuer Abstand = Tage, bis R auf die Behaltensrate fällt. Gerundet, mindestens 1 Tag, höchstens der Höchstabstand (F3).
- Damit die Knöpfe logisch bleiben, gilt immer: Schwer ≤ Gut < Einfach. Wenn die Formel das nicht ergibt, wird um einen Tag angehoben (so macht es auch Anki).
- Kein Zufallsanteil („Fuzz“). Die Vorschau unter den Knöpfen zeigt also genau den Termin, der später gilt.

### F2 Kartenzustand
```
{ stability, difficulty, lapses,          // neu (FSRS)
  easeFactor,                             // SM-2, rechnet weiter mit
  interval, repetitions, nextReview, lastReview,
  totalReviews, correctReviews, lastQuality }   // wie bisher
```
- `interval` ist der geplante Abstand in Tagen. `repetitions` zählt die richtigen Antworten in Folge und wird nach „Nochmal“ auf 0 gesetzt.
- **Alte SM-2-Zustände** ohne `stability` (falls doch einer existiert): Bei der nächsten Bewertung startet FSRS mit `S = interval` (mindestens 1) und `D = 5`. Die Zähler bleiben erhalten. Es gibt keine Fehlermeldung und keinen Datenverlust.

### F3 Einstellungen (Bereich „Lernen“)
- **Lernverfahren:** FSRS (Standard) oder SM-2, als Auswahl mit zwei Knöpfen. Darunter steht eine kurze Erklärung, die bei Wechsel mitwechselt:
  - **FSRS (empfohlen):** „Die App merkt sich für jede Karte, wie gut du sie kannst. Sie fragt dich genau dann wieder, wenn du sie sonst bald vergessen würdest. Leichte Karten kommen seltener, schwere öfter. So brauchst du etwa ein Fünftel weniger Zeit für dasselbe Wissen.“
  - **SM-2 (klassisch):** „Das alte Verfahren aus Anki. Nach jeder richtigen Antwort wird der Abstand nach einer festen Regel ungefähr 2,5-mal so lang. Einfach und bewährt, aber du wiederholst leichte Karten öfter als nötig.“
  - Zusatz: „Du kannst jederzeit wechseln. Dein Lernstand bleibt erhalten.“
- **Behaltensrate** (nur bei FSRS, Standard **90 %**). Mit 80 / 85 / 90 / 95 % zur Auswahl. Erklärung: „So sicher willst du deine Karten können. Mehr Prozent bedeutet mehr Wiederholungen.“
- **Höchstabstand: 365 Tage** (fest, für beide Verfahren). FSRS dehnt die Abstände bei leichten Karten schnell aus (siehe Beispiel unten). Spätestens nach einem Jahr kommt jede Karte wieder.

### F4 Anzeige
- In der Statistik zusätzlich: **Ø Abrufwahrscheinlichkeit heute** über alle gelernten Karten, zum Beispiel „Du weißt heute voraussichtlich 91 % deiner Karten“.
- README und ARCHITEKTUR beschreiben FSRS statt SM-2, mit Hinweis auf ts-fsrs (MIT).

### F5 Bewertungsprotokoll
- Jede Bewertung wird kurz mitgeschrieben: Karten-ID, Datum, Knopf. Das sind etwa 30 Byte pro Bewertung.
- **Ort:** nur im Speicher des Browsers auf dem Gerät (`localStorage`, Schlüssel `sc_reviews`), genau wie der Lernstand. Es gelangt **nicht** zu GitHub, nicht ins Repo und auf kein anderes Gerät.
- Obergrenze: die letzten **20 000 Bewertungen** (etwa 0,6 MB). Ältere fallen automatisch heraus.
- Keine eigene Oberfläche. Es wird gelöscht, wenn der Lernfortschritt zurückgesetzt oder die App-Daten im Browser gelöscht werden.
- Zweck: ein späteres Parameter-Training. Heute wird es noch nicht ausgewertet.

### Nicht im Umfang
- **Parameter-Training** auf die eigene Lerngeschichte („FSRS lernt, wie du vergisst“). Dafür braucht es einen Optimierer. Die Standardparameter sind schon deutlich besser als SM-2. Das Protokoll aus F5 schafft die Grundlage.
- Lernschritte in Minuten wie bei Anki („in 10 Minuten wieder“). Die App plant in Tagen, und „Nochmal“ innerhalb der Sitzung deckt das ab.

## 4. Formeln (FSRS-6)

Mit `G` ∈ {1, 2, 3, 4}, `t` = Tage seit der letzten Wiederholung, `w` = Parameter oben, `decay = −w20`, `factor = 0,9^(1/decay) − 1`:

| Größe | Formel |
|---|---|
| Abrufwahrscheinlichkeit | `R(t,S) = (1 + factor · t / S)^decay` |
| Abstand | `I = S / factor · (r^(1/decay) − 1)`, `r` = Behaltensrate |
| Erste Bewertung | `S₀ = w[G−1]`, `D₀ = w4 − e^(w5·(G−1)) + 1`, auf 1…10 begrenzt |
| Schwierigkeit | `D' = D + (−w6·(G−3)) · (10−D)/9`, dann `D'' = w7·D₀(4) + (1−w7)·D'`, auf 1…10 |
| richtig (G ≥ 2) | `S' = S · (1 + e^w8 · (11−D) · S^(−w9) · (e^(w10·(1−R)) − 1) · Strafe · Bonus)`, mit Strafe = w15 bei Schwer, Bonus = w16 bei Einfach |
| vergessen (G = 1) | `S' = min( w11 · D^(−w12) · ((S+1)^w13 − 1) · e^(w14·(1−R)) , S / e^(w17·w18) )` |
| gleicher Tag (t = 0) | `S' = S · e^(w17·(G−3+w18)) · S^(−w19)`, bei G ≥ 2 mindestens S |

Stabilität begrenzt auf 0,001…36 500.

**Beispiel mit Standardwerten** (Abstände in Tagen, nachgerechnet):

| Verlauf | FSRS-6 | SM-2 heute |
|---|---|---|
| immer „Gut“ | 2 → 11 → 46 → 163 → 497 | 1 → 6 → 15 → 38 → 95 |
| „Schwer“, dann „Gut“ | 1 → 5 → 17 → 50 → 133 | 1 → 6 → 14 → 33 → 78 |
| „Gut“, „Gut“, „Gut“, vergessen, „Gut“ | 2 → 11 → 46 → **3** → 8 | 1 → 6 → 15 → **1** → 1 |

FSRS zeigt leichte Karten deutlich seltener. Daher kommt die Ersparnis. Bei vergessenen Karten fängt es nicht wieder bei null an.

## 5. Umsetzungsschritte (Vorschlag)

1. **`fsrs.js` und Tests.** Reine Logik ohne Oberfläche. Getestet wird gegen Werte, die mit den ts-fsrs-Formeln nachgerechnet sind: erste Bewertung, richtig, vergessen, gleicher Tag, Abstand, Grenzen, Reihenfolge Schwer ≤ Gut < Einfach, alte SM-2-Zustände.
2. **Einbau in die App.** `CardStore` und Vorschau nutzen FSRS (Standard), SM-2 rechnet mit, Höchstabstand 365 Tage, Bewertungsprotokoll. Prüfung im Browser bei 375 und 1440 px, Lernziele und Prüfungsmodus laufen weiter. Version **v1.34**.
3. **Einstellungen und Anzeige.** Wahl des Verfahrens mit Erklärung, Behaltensrate, Ø Abrufwahrscheinlichkeit, Doku. Version **v1.35**.

Nach jedem Schritt: Bericht mit Testergebnis und Freigabe, Push nur nach ausdrücklichem „pushen“.

## 6. Risiken

- **Abstände wirken anfangs ungewohnt lang** (11 Tage nach der zweiten Wiederholung). Das ist gewollt. Der Prüfungsmodus holt Karten vor einer Klassenarbeit trotzdem rechtzeitig zurück.
- **Rechenfehler** in der eigenen Umsetzung: abgesichert durch Tests mit Referenzwerten.
- **Spätere Änderungen an FSRS** (z. B. FSRS-7): Die Parameter stehen an einer Stelle, ein Wechsel ist ein kleiner Schritt.

## 7. Entscheidungen vom 18. November 2026

1. **FSRS ist Standard, SM-2 bleibt in den Einstellungen wählbar**, mit Erklärung in einfacher Sprache (F3). Beide Verfahren rechnen immer mit, damit der Wechsel verlustfrei ist (F1).
2. **Höchstabstand 365 Tage.**
3. **„Sicher“ bei den Lernzielen** bleibt vorerst wie heute. Später ist die Umstellung auf „R am Prüfungstag ≥ 90 %“ möglich.
4. **Bewertungsprotokoll: ja**, nur lokal im Browser, höchstens 20 000 Einträge (F5).

## 8. Umsetzungsstand

**Schritt 1 – `fsrs.js` und Tests (19.11.2026): fertig**
- Neues Modul `fsrs.js` (UMD, `window.FSRS` / `module.exports`), noch **nicht** in die App eingebunden.
- FSRS-6 mit Standardparametern: `nextMemory`, `forgettingCurve`, `nextInterval`. SM-2 unverändert als `sm2Step`.
- Kartenzustand: `preview(state, {today, algorithm, retention, maxInterval})` liefert alle vier Ergebnisse, `review(state, quality, opts)` eines, `previewIntervals` die Tage für die Knöpfe. Beide Verfahren rechnen immer mit. Reihenfolge Schwer ≤ Gut < Einfach, Höchstabstand 365 Tage.
- Alte SM-2-Zustände: Start mit S = Abstand (mindestens 1), D = 5.
- `retrievability(state, today)` für F4, `appendLog(log, cardId, today, quality)` für F5.
- Tests `tests/fsrs.test.cjs`: 20 Tests. Die Referenzwerte wurden mit dem Originalcode von ts-fsrs berechnet und stimmen auf 6 Nachkommastellen überein. Insgesamt 98/98 Tests grün.

**Schritt 2 – Einbau in die App (19.11.2026): fertig, v1.34**
- `index.html` lädt `fsrs.js` vor `app.js`, `sw.js` speichert es offline (`studycards-v1.34`).
- `app.js`: `SM2` ersetzt durch `Scheduler` (dünne Hülle um `window.FSRS`). Bewertung und Vorschau rechnen mit FSRS, wenn `config.algorithm` fehlt oder `'fsrs'` ist. Mit `'sm2'` plant SM-2 wie bisher.
- `config.algorithm` und `config.retention` werden geprüft; unbekannte Werte → Standard (FSRS, 90 %). Die Oberfläche dafür folgt in Schritt 3.
- `ReviewLog` schreibt jede Bewertung nach `sc_reviews`. Ist der Speicher voll, wird die ältere Hälfte verworfen. Fehler stören das Lernen nie. „Fortschritt zurücksetzen“ löscht das Protokoll mit.
- Prüfung im Browser (schule-cards, 513 Karten):
  - Neue Karte: Vorschau 1 · 1 · 2 · 8 Tage. „Gut“ speichert S = 2,3065, D = 2,118 und einen Termin in 2 Tagen. Das Protokoll hat 1 Eintrag.
  - „Nochmal“: Die Karte kommt in der Runde erneut (26 → 27) und ist morgen fällig.
  - Mit `algorithm: 'sm2'` zeigt die Vorschau 1 · 1 · 1 · 1 wie bisher. Zurück auf FSRS ohne Verlust.
  - Alter SM-2-Zustand (Abstand 6) ergibt mit FSRS 1 · 8 · 9 · 12 Tage.
  - Lernziele und Tagesplan laufen weiter, die Konsole zeigt keine Fehler. 98/98 Tests grün.

**Schritt 3 – Einstellungen, Anzeige, Doku (19.11.2026): fertig, v1.35**
- Einstellungen → **Lernverfahren**: Auswahl FSRS (empfohlen) / SM-2 (klassisch) mit der Erklärung aus F3, die beim Wechsel mitwechselt, und kurzem Hinweis. **Behaltensrate** 80–95 % ist nur bei FSRS sichtbar. Alles wird sofort gespeichert.
- Statistik → Gesamtfortschritt: „Du weißt heute voraussichtlich … % deiner … gelernten Karten.“ Gezählt werden die gelernten Karten, die gerade geladen sind. Alte SM-2-Stände werden geschätzt (S = Abstand).
- README (Feature, Lizenzhinweis ts-fsrs), ARCHITEKTUR (Abschnitt 7 neu, Dateibaum, Versionen).
- Prüfung im Browser bei 375 px: Wechsel auf SM-2 (Erklärung wechselt, Behaltensrate verschwindet, Hinweis „SM-2 ist aktiv“). Zurück auf FSRS, 85 % gewählt, nach dem Neuladen erhalten. Die Statistikzeile wird angezeigt. 98/98 Tests grün.
- **Hinweis:** „Gelernt“ in der Statistik zählt alle gespeicherten Lernstände, auch von Karten, die umbenannt oder gelöscht wurden. Die neue Zeile zählt nur vorhandene Karten. Das war schon vor FSRS so.
