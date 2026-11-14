# Pflichtenheft für Pomodoro in StudyCards

Version 0.2 · Stand 14. November 2026 · Entwurf zur Freigabe

## 1 Ziel und Umfang

Die Pomodoro-Erweiterung unterstützt regelmäßiges, konzentriertes Lernen innerhalb der bestehenden App [StudyCards](https://newtro2030.github.io/studycards/). Sie bietet einstellbare Lern- und Pausenzeiten, signalisiert das Ende einer Phase und protokolliert die Lerneinheiten. Die Bedienung soll unmittelbar verständlich sein und sich innerhalb der vorhandenen Gestaltung an Apples ruhiger, klarer Oberfläche orientieren.

Die erste Version ergänzt Timer, Einstellungen und eine einfache Auswertung im [bestehenden Repository newtro2030/studycards](https://github.com/newtro2030/studycards). Sie ist für eine einzelne Person und die Nutzung in einem Browserprofil ausgelegt. Die Sprache ist Deutsch. Ein separates Pomodoro-Repository entfällt.

Die nachfolgenden Anforderungen bilden den vorgeschlagenen Umfang der ersten Version. Nicht enthalten sind Aufgabenverwaltung, Kalenderanbindung, neue Benutzerkonten, Cloud-Synchronisierung des Pomodoro-Verlaufs, KI-Funktionen, soziale Funktionen, Website-Sperren und eine native macOS-App. Die vorhandene PWA bleibt Grundlage. Eine globale Umgestaltung, eine neue Hell/Dunkel-Umschaltung und automatische Folgestarts können später ergänzt werden.

## 2 Grundeinstellungen und Ablauf

| Einstellung | Standard | Individuell einstellbar |
| --- | --- | --- |
| Lernzeit | 25 Minuten | 1 bis 180 Minuten |
| Kurze Pause | 5 Minuten | 1 bis 60 Minuten |
| Lange Pause | 15 Minuten | 1 bis 60 Minuten |
| Lange Pause nach | 4 abgeschlossenen Lerneinheiten | 2 bis 8 Einheiten |
| Start der nächsten Phase | Per Klick | In Version 1 immer manuell |

Alle Zeitangaben werden in ganzen Minuten eingestellt. Diese Werte sind Produktvorschläge und werden mit dem Konzept freigegeben.

**Typischer Ablauf:** Eingerichtetes StudyCards öffnen → Pomodoro auf Home öffnen → optional ein Lernthema eintragen → Lernphase starten → Karten lernen oder anderes Lernmaterial nutzen → Endsignal erhalten → vorgeschlagene Pause starten → nächste Lernphase starten. Der Verlauf wird dabei automatisch geführt. Pomodoro benötigt keine zusätzliche Repository-Verbindung.

## 3 Bedienung und Gestaltung

Pomodoro nutzt die vorhandenen Bereiche von StudyCards:

| Bereich | Inhalt |
| --- | --- |
| Home und Timer | Pomodoro-Kachel als Einstieg; eigener Timer-Screen mit aktueller Phase, großer Restzeit, Zyklusfortschritt, optionalem Lernthema und Steuerung |
| Kartenlernen | Kompakte Anzeige eines aktiven Timers mit Pausieren/Fortsetzen und Zugang zum großen Timer |
| Statistik | Ergänzender Pomodoro-Abschnitt mit Verlauf, Tageswerten und Übersicht der letzten sieben Tage |
| Einstellungen | Ergänzender Pomodoro-Abschnitt mit Zeitprofil, Tönen, Mitteilungen sowie Sicherung und Löschen |

Vom vorhandenen Home-Screen ist der Timer mit einem Klick erreichbar. Auf dem Timer-Screen startet die voreingestellte Lernphase mit einem weiteren Klick, ohne zusätzliche Einrichtung. Die vorhandene Navigation zu Home, Statistik und Einstellungen bleibt bestehen. Nach einer Phase benennt der Hauptbutton den nächsten Schritt, beispielsweise „Kurze Pause starten“.

Die Gestaltung übernimmt die vorhandene Schrift, dunklen Flächen, CSS-Farbvariablen und violetten Akzente von StudyCards. Großzügige Abstände, eine große Zeitanzeige und wenige Aktionen sorgen für Klarheit. Animationen bleiben kurz und berücksichtigen reduzierte Bewegung. Aufwendige Glaseffekte sind für die erste Version nicht erforderlich. Die vorhandene Gestaltung ist im [Stylesheet](https://github.com/newtro2030/studycards/blob/main/style.css) definiert.

Alle neuen Pomodoro-Aktionen sind per Tastatur erreichbar und haben einen sichtbaren Fokus. Neue Symbolbuttons erhalten verständliche Namen für Screenreader. Phasen und Zustände sind auch als Text erkennbar. In den ergänzten Bereichen erreichen Texte mindestens 4,5:1 Kontrast, große Texte und wesentliche Bedienelemente mindestens 3:1. Der Countdown wird Screenreadern nicht jede Sekunde vorgelesen; Phasenwechsel werden angekündigt. Die ergänzten Bereiche erzeugen zwischen 375 und 1440 Pixeln Breite keine horizontalen Scrollleisten.

## 4 Funktionale Anforderungen

### F01 Standard und eigenes Zeitprofil

Die App bietet „Standard“ und ein gespeichertes Profil „Individuell“. Ein Wechsel löscht die individuellen Werte nicht. Ungültige, leere oder außerhalb der Grenzen liegende Eingaben verhindern das Speichern und erhalten einen verständlichen Hinweis. Änderungen gelten ab der nächsten neu gestarteten Phase; eine laufende oder pausierte Phase behält ihre Dauer. Das Zurücksetzen der Einstellungen verändert keine Verlaufsdaten.

### F02 Timer steuern

Jede Phase lässt sich starten, pausieren, fortsetzen und zurücksetzen. Pausieren hält die Restzeit fest; Fortsetzen beginnt mit dieser Restzeit. Beim Zurücksetzen einer begonnenen Lernphase wird nach Bestätigung ein Abbruch protokolliert und die konfigurierte Dauer wieder angezeigt. Eine noch nicht gestartete Phase erzeugt keinen Protokolleintrag.

### F03 Pausenfolge

Nach einer abgeschlossenen Lernphase schlägt die App eine kurze Pause vor; nach der eingestellten Anzahl die lange Pause. Sobald die lange Pause beendet oder übersprungen wird, setzt sich der Zykluszähler auf null zurück und die nächste Lernphase wird vorbereitet. Abgebrochene Einheiten erhöhen den Zykluszähler nicht. Eine Pause darf übersprungen werden, ohne eine Lerneinheit zu erzeugen. Der Fortschritt bleibt beim Neuladen erhalten; ein neuer Kalendertag setzt ihn nicht automatisch zurück. Ohne gestartete oder ungeklärte Phase kann der Nutzer den Zyklus ausdrücklich neu beginnen, ohne den Verlauf zu löschen.

### F04 Zeitberechnung und Wiederaufnahme

Die Restzeit wird aus einer gespeicherten Endzeit berechnet, statt lediglich pro ausgeführtem Sekundentakt heruntergezählt zu werden. Bei Rückkehr aus einem anderen Tab wird die Anzeige sofort abgeglichen. Restzeiten werden nie negativ. Pausierte Zustände und laufende Phasen werden bei einem Neuladen wiederhergestellt, sofern die lokale Speicherung verfügbar ist.

Wird der Ablauf einer Lernphase erst nach Wiederöffnung erkannt oder mehr als zehn Sekunden nach dem geplanten Ende verarbeitet, erhält die Lerneinheit den Status „Abschluss prüfen“. Der Nutzer bestätigt „Abgeschlossen“ oder „Abgebrochen“. Bis zur Klärung zählt sie nicht zur Lernstatistik und blockiert den nächsten Pomodoro-Lernstart; Kartenlernen bleibt möglich. Eine nachträglich als abgelaufen erkannte Pause bereitet die nächste Lernphase vor, ohne sie zu starten. Eine noch nicht abgelaufene Phase wird mit der verbleibenden Zeit wiederhergestellt. Verstrichene Zeit allein ist kein Nachweis tatsächlichen Lernens.

### F05 Endsignal

Beim Ende jeder Lern- oder Pausenphase erscheinen ein sichtbarer Hinweis und, sofern eingeschaltet und vom Browser zugelassen, ein kurzer Signalton. Es gibt mindestens zwei dezente Töne, einen Lautstärkeregler von 0 bis 100 Prozent und „Ton testen“. Der Standardton ist eingeschaltet, auf 50 Prozent gestellt und endet nach höchstens fünf Sekunden. Ein Endereignis löst das Signal nur einmal aus. Bei erkennbar blockierter Audiowiedergabe erscheint eine verständliche Hilfe; der Timer bleibt bedienbar.

### F06 Optionale Systemmitteilungen

Mitteilungen werden nur nach ausdrücklichem Klick auf „Mitteilungen aktivieren“ angefragt. Die App zeigt, ob sie erlaubt, blockiert oder nicht unterstützt sind. Eine Ablehnung löst keine wiederholten Berechtigungsdialoge aus. Bei erlaubten Mitteilungen wird das Ende zusätzlich außerhalb der Website angekündigt. Der sichtbare Hinweis innerhalb der App funktioniert unabhängig von dieser Erlaubnis.

### F07 Sitzungsprotokoll

Jede begonnene Lernphase erhält eine eindeutige Kennung. Gespeichert werden Start, Ende, geplante Dauer, erfasste Lernzeit ohne manuelle Unterbrechungen, Abschlussstatus und optional ein Lernthema mit höchstens 100 Zeichen. Pausen erzeugen keine Lerneinheiten.

Eine regulär vollständig abgelaufene Lernphase zählt als ein Pomodoro. Abbrüche bleiben als solche sichtbar und zählen weder als abgeschlossene Einheit noch zu den ausgewerteten Lernminuten. Bei „Abschluss prüfen“ übernimmt eine Bestätigung die geplante Lernzeit und erhöht den Zykluszähler genau einmal; „Abgebrochen“ tut beides nicht. Neuladen und mehrfach ausgelöste Ereignisse erzeugen keine doppelten Einträge. Das Lernthema einer gestarteten Einheit bleibt für diesen Eintrag erhalten.

### F08 Einfache Statistik

Die App zeigt die Anzahl abgeschlossener Lerneinheiten und die Summe ihrer Lernminuten für heute sowie die letzten sieben Kalendertage einschließlich heute. Dazu gibt es eine kleine Tagesübersicht und einen Verlauf mit Datum, Thema, Dauer und Status. Einheiten werden dem Tag ihres Endes in der lokalen Zeitzone zugeordnet; bei vollständigen Einheiten ist das die geplante Endzeit einschließlich manueller Unterbrechungen, auch bei späterer Bestätigung. Bei null Einträgen erscheint ein verständlicher leerer Zustand. Die Statistik beschreibt Timer-Einheiten und misst keine Aufmerksamkeit oder Lernleistung.

### F09 Lokale Speicherung

Zeitprofile, Toneinstellungen, Zyklusstand, aktive Phase und Verlauf bleiben beim Schließen und erneuten Öffnen im selben Browserprofil und unter derselben Webadresse erhalten, solange der Browser die Daten aufbewahrt. Pomodoro verwendet eigene Speicherbereiche, beispielsweise `sc_pomodoro_settings`, `sc_pomodoro_state` und `sc_pomodoro_sessions`. Die Erweiterung sendet keine Pomodoro-Protokolle an GitHub oder andere Dienste. Bei fehlgeschlagenem Speichern meldet sie „Daten werden aktuell nicht gespeichert“; bestehende Daten werden nicht stillschweigend überschrieben. Bei beschädigten Pomodoro-Daten bietet sie den Import einer Sicherung oder ein bestätigtes Zurücksetzen der betroffenen Daten an.

### F10 Sicherung und Löschen

Eine JSON-Datei sichert ausschließlich Pomodoro-Einstellungen und abgeschlossene beziehungsweise abgebrochene Pomodoro-Protokolleinträge. Aktive und ungeklärte Einheiten, Kartendaten und GitHub-Token werden nicht exportiert. Eine gültige Sicherung lässt sich wieder einlesen; sie ersetzt nach Bestätigung die Pomodoro-Einstellungen und den Pomodoro-Verlauf, setzt den Zyklus auf null und bereitet eine neue Lernphase vor. Dateiformat und Werte werden vor einer Änderung geprüft; ein ungültiger Import erhält den bisherigen Stand. Das Löschen des Pomodoro-Verlaufs verlangt eine separate Bestätigung, setzt den Zyklus zurück und erhält die Einstellungen. Import und Verlaufslöschen sind nur ohne laufende, pausierte oder ungeklärte Pomodoro-Phase möglich. Beide Aktionen verändern keine Kartendaten.

### F11 Mehrere geöffnete Tabs

Im selben Browserprofil kann nur eine Lern- oder Pausenphase gleichzeitig laufen. Weitere Tabs derselben App zeigen den gemeinsamen Stand und starten keinen unabhängigen Timer. Je Einheit werden Abschluss, Alarm und Protokollierung nur einmal verarbeitet. Nach dem Schließen des steuernden Tabs kann ein anderer Tab übernehmen. Die Regel gilt auch für einen nahezu gleichzeitigen Start in zwei Tabs.

### F12 Verbindung mit dem Kartenlernen

Kartenlernen funktioniert weiterhin ohne gestarteten Pomodoro. Ein laufender Timer bleibt beim Wechsel zwischen Home, Timer, Statistik, Einstellungen und Kartenlernen aktiv. Die Rückkehr vom Timer zur Karte erhält die aktuelle Karte, ihren Antwortzustand und die laufende Kartenrunde. Dafür darf die Runde nicht erneut gestartet werden.

Beim Timerende erscheint ein Hinweis mit der nächsten möglichen Phase; die App bewertet keine Karte, beendet keine Kartenrunde und verändert weder Wiederholungsintervalle noch XP. Eine Pause lässt sich bewusst starten und danach dieselbe Kartenrunde fortsetzen. Ein Lernthema ist optional und wird in Version 1 nicht automatisch mit Kartendecks verknüpft. Eine Kartenrunde kann enden, während der Pomodoro für anderes Lernmaterial weiterläuft.

## 5 Technisches Konzept und Qualität

StudyCards verwendet bereits Vanilla HTML, CSS und JavaScript ohne Build-Schritt, GitHub Pages, lokale Speicherung und einen Service Worker. Die Erweiterung nutzt diesen Bestand. Sie benötigt weder ein neues Framework noch eine TypeScript-Migration, ein Build-System oder einen zusätzlichen Server. Siehe [bestehende Architektur](https://github.com/newtro2030/studycards/blob/main/ARCHITEKTUR.md) und [README](https://github.com/newtro2030/studycards/blob/main/README.md).

Timerzustand und Zählregeln werden als kleines getrenntes JavaScript-Modul gehalten; die Oberfläche bindet es in die vorhandene Navigation ein. Voraussichtlich betroffen sind `index.html`, `style.css`, `app.js`, `sw.js`, README und Architektur-Dokumentation sowie ein neues `pomodoro.js` mit gezielten Tests.

Die vorhandene Update-Sperre schützt bisher den Karten-Lernscreen. Sie wird um laufende, pausierte und ungeklärte Pomodoro-Phasen erweitert, unabhängig vom sichtbaren Screen. Eine Kartenrunde gilt nach Abschluss oder bewusstem Verlassen als beendet; der vorübergehende Wechsel zum Timer hält sie aktiv. Ein Update darf erst eingespielt werden, wenn keine solche Kartenrunde und keine gestartete oder ungeklärte Pomodoro-Phase mehr besteht. Neue Dateien kommen in den vorhandenen PWA-Cache; App- und Cache-Version werden gemeinsam aktualisiert. Quellen: [Update-Steuerung](https://github.com/newtro2030/studycards/blob/main/app.js#L1505) und [Service Worker](https://github.com/newtro2030/studycards/blob/main/sw.js).

Die erste Zielumgebung ist die stabile Safari-Version auf dem MacBook zum Zeitpunkt der Entwicklung; zusätzlich wird die dann aktuelle stabile Chrome-Version auf macOS geprüft. Die konkret getesteten macOS- und Browserversionen werden zur Abnahme festgehalten. Kleine Bildschirmbreiten werden unterstützt; mobile Hintergrundalarme gehören nicht zur zugesicherten Funktion.

Bei sichtbarem Tab und ohne unterbrochene Browserausführung soll die Restzeitanzeige höchstens eine Sekunde von der berechneten Endzeit abweichen. Aufwendige Daueranimationen und zusätzliche Netzwerkanfragen für den Timer entfallen. Pomodoro übernimmt die vorhandene Schrift und lädt seine zusätzlichen Dateien aus der eigenen Bereitstellung. Die Erweiterung führt keine Werbung, Analyse-Tracker oder externen Schrift-Dienste ein.

Die Pomodoro-Speicherung wird versioniert, damit spätere Änderungen den bestehenden Verlauf erhalten können. Kartenkonfiguration, Lernfortschritt und Kartenstatistik behalten ihre eigenen Speicherbereiche. Die vorhandene Datumsfunktion arbeitet mit UTC; Pomodoro bildet seine zugesagten lokalen Kalendertage gesondert. Persönliche Lernprotokolle und exportierte Sicherungen gehören nicht in das Quellcode-Repository. Quellen: [Speicherbereiche und Datumsfunktion](https://github.com/newtro2030/studycards/blob/main/app.js#L9). Der Browser kann lokale Daten löschen; für wichtige Verläufe dient die Sicherungsfunktion.

## 6 Browser und macOS

Für Töne nutzt die App Browser-Audio. Beim Klick auf Start oder „Ton testen“ wird die Audioausgabe aktiviert; Wiedergabefehler werden behandelt. Ein besonderer macOS-Systemzugriff ist dafür nicht vorgesehen. Safari kann automatische Wiedergabe anhand der Website-Einstellungen blockieren. Siehe [MDN zu Audio und Autoplay](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay) und [WebKit zu den Autoplay-Regeln auf macOS](https://webkit.org/blog/7734/auto-play-policy-changes-for-macos/).

Systemmitteilungen sind eine separate Browserfunktion mit Nutzererlaubnis. Die bereitgestellte App verwendet HTTPS und fragt die Erlaubnis nur nach einem Klick an. Browser- und Systemeinstellungen bestimmen die tatsächliche Ausgabe. Siehe [MDN zur Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API).

Browser können die Ausführung in Hintergrundtabs verzögern. Eine absolute Endzeit hält die Berechnung korrekt, garantiert aber keinen sekundengenauen Alarm. Bei geschlossenem Tab, beendetem Browser oder schlafendem Mac ist kein pünktliches Signal zugesichert. Auch ein Service Worker allein wird hier nicht als Wecker eingeplant. Die vorgesehenen Mitteilungen entstehen beim Ablauf in der ausführbaren App; ein Push-Server ist nicht Teil der ersten Version. Siehe [MDN zu Hintergrundausführung](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) und [verzögerten Browser-Timern](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#timeouts_in_inactive_tabs).

Für die normale Nutzung bleibt StudyCards geöffnet und der Mac wach. Die Erweiterung verändert keine Systemlautstärke oder Energiespareinstellungen. Ein stummgeschalteter Tab oder eine stummgeschaltete Audioausgabe kann den Ton verhindern. Die Ton-Testfunktion hilft, die Ausgabe vor dem Lernen zu prüfen. Die bereits vorhandene Offline-Installation beseitigt die Grenzen der Hintergrundausführung nicht.

Lokale Daten gehören zum Browserprofil und zur Herkunft der Website. Andere Browserprofile oder Geräte haben einen eigenen Verlauf; ein Wechsel der Domain kann eine Wiederherstellung aus der Sicherung erfordern. Im privaten Modus kann der Verlauf beim Schließen verschwinden. Siehe [MDN zur lokalen Browserspeicherung](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API).

## 7 Abnahmekriterien

Die erste Version ist abnahmefähig, wenn die folgenden Prüfungen in beiden Zielbrowsern erfolgreich sind. Kurze Testlaufzeiten dürfen über eine getrennte Testkonfiguration verwendet werden.

| Prüfung | Erwartetes Ergebnis | Anforderungen |
| --- | --- | --- |
| Einstieg | Pomodoro ist über Home erreichbar; auf dem Timer-Screen sind 25/5/15 und vier Einheiten voreingestellt; Lernen startet dort mit einem Klick. | F01–F03, F12 |
| Eigenes Profil | 50/10/20 und drei Einheiten speichern und nach Neuladen wiederherstellen; 0, leere und zu große Werte ablehnen; Profilwechsel erhält eigene Werte. | F01, F09 |
| Pausieren und Änderungen | Nach Pausieren bleibt die Restzeit stehen; Fortsetzen setzt sie fort; Einstellungsänderungen verändern die aktuelle Phase nicht. | F01, F02 |
| Zyklus | Nach vier abgeschlossenen Lernphasen wird die lange Pause vorgeschlagen; ihr Ende oder Überspringen setzt den Zyklus zurück; Abbruch erhöht den Zähler nicht; die nächste Phase wartet auf Start. | F03, F07 |
| Alarm und Berechtigung | Ton testen, Lautstärke und Stumm prüfen; Phasenende sichtbar und hörbar melden, soweit erlaubt; erlaubte, abgelehnte und blockierte Mitteilungen korrekt behandeln. | F05, F06 |
| Hintergrund und Wiederöffnung | Nach Tabwechsel stimmt die Restzeit wieder; laufende und pausierte Zustände bleiben erhalten; ein beim Wiederöffnen abgelaufener Lerntimer verlangt eine Abschlussprüfung; eine abgelaufene Pause startet keine Lernphase. | F04 |
| Verlauf und Tageswechsel | Zwei vollständige Einheiten von je 25 Minuten ergeben 2 und 50 Minuten; Abbrüche und ungeklärte Einheiten erhöhen diese Werte nicht; Tageswechsel wird korrekt zugeordnet. | F07, F08 |
| Doppelte Ereignisse und Tabs | Neuladen, wiederholte Endereignisse und nahezu gleichzeitiger Start in zwei Tabs erzeugen insgesamt einen Timer, einen Abschluss und einen Alarm. | F04, F07, F11 |
| Speicherung und Sicherung | Verlauf nach Neustart vorhanden; Export/Import stellt Pomodoro wieder her und setzt den Zyklus auf null; aktive Zustände sperren Import/Löschen; ungültiger Import lässt Daten unverändert; die Sicherung enthält keine Karten oder Token. | F09, F10 |
| Kartenintegration | Kartenlernen ohne Timer bleibt möglich; Screenwechsel erhält Timer und Karte; Phasenende verändert keine Bewertungen, Intervalle oder XP; Pomodoro-Löschen erhält den Kartenfortschritt. | F10, F12 |
| App-Update | Ein vorbereitetes Update lädt StudyCards bei einer aktiven Kartenrunde oder gestarteten beziehungsweise ungeklärten Pomodoro-Phase auf keinem Screen neu. Timerbesuch erhält die Kartenrunde; ihr Abschluss oder bewusstes Verlassen hebt diese Sperre auf, sobald auch Pomodoro frei ist. | Abschnitt 5 |
| Bedienbarkeit | Tastatur, sichtbarer Fokus, VoiceOver, reduzierte Bewegung, Kontraste und Layout bei 375 sowie 1440 Pixeln prüfen. | Abschnitt 3 |

Automatisierte Prüfungen konzentrieren sich auf Timerzustände, Zyklen, Zählregeln, Wiederherstellung und Sicherungsformat. Die vorhandenen Parser-Tests werden zusätzlich mit `node --test tests/parser.test.cjs` ausgeführt. Kartenrunde, Navigation, Update-Verhalten, Tonausgabe und macOS-Mitteilungen werden auf dem MacBook manuell geprüft. Schlafen oder Schließen während einer Einheit darf beim Wiederöffnen keine Serie automatisch nachgeholter Lerneinheiten erzeugen. Diese Prüfungen sind Anforderungen an die spätere Umsetzung; bisher wurde kein Anwendungscode geändert.

## 8 GitHub Grundlage und Ablage

### Vergleich vorhandener Projekte

Recherche vom 14. November 2026 anhand von README, Lizenzdateien und ausgewählten Quellcodedateien; die Projekte wurden nicht ausgeführt. Die folgende Eignungsbewertung ist eine Einschätzung für dieses Vorhaben.

| Projekt | Passende Grundlage | Anpassungsbedarf |
| --- | --- | --- |
| [sametcelikbicak/pomodoro](https://github.com/sametcelikbicak/pomodoro) | Einstellbare Zeiten, lokale Summenstatistik, Mitteilungen; [MIT-Lizenz](https://github.com/sametcelikbicak/pomodoro/blob/main/LICENSE) | Eine datierte Historie ist im README nicht beschrieben. Die geprüfte Timerlogik zählt Intervalle herunter; Hintergrundverhalten und Abschlussregeln müssten überarbeitet werden. |
| [natuomi/pomodoro](https://github.com/natuomi/pomodoro) | Kleiner Timer mit individuellen Zeiten, Audio und lokalem Sitzungszähler; [MIT-Lizenz](https://github.com/natuomi/pomodoro/blob/main/LICENSE) | Ein Sitzungszähler deckt den gewünschten datierten Verlauf nicht ab. Die Next.js-Basis bietet für diesen Umfang keinen klaren Vorteil. |
| [sefaonder/local-focus](https://github.com/sefaonder/local-focus) | Lokaler Verlauf, Statistik und Sicherung; [MIT-Lizenz](https://github.com/sefaonder/local-focus/blob/main/LICENSE) | Laut README Pre-Alpha; zusätzliche Aufgabenverwaltung und PWA-Funktionen gehen über den Einstieg hinaus. |
| [jakedahn/pomodoro](https://github.com/jakedahn/pomodoro) über skills.sh | Lokaler Timer mit individuellen Zeiten, Historie und Statistik; [MIT-Lizenz](https://github.com/jakedahn/pomodoro/blob/main/LICENSE) | Claude-Code-Skill mit Terminal-CLI und SQLite. Keine Browser-Oberfläche; Timer und Speicheranbindung müssten für StudyCards neu umgesetzt werden. |

**Empfehlung:** Pomodoro wird als kleines Modul in StudyCards selbst entwickelt. Die vorhandene Navigation, Speicherung, PWA und Bereitstellung sind die passendere Grundlage. Ein Fork einer anderen App oder die Installation des verlinkten Skills würde die Integration nicht ersetzen. Eine Übernahme von Fremdcode ist bisher nicht erfolgt. Die Aussage zur intervallbasierten Timerlogik beruht auf dieser [Quellcodedatei](https://github.com/sametcelikbicak/pomodoro/blob/main/src/components/Pomodoro/Pomodoro.tsx).

[skills.sh](https://www.skills.sh/docs) ist zur Suche nach Arbeitsanleitungen für KI-Agenten nützlich. Der verlinkte [Pomodoro-Skill](https://github.com/jakedahn/pomodoro/blob/main/src/SKILL.md) erklärt die Bedienung seines lokalen Timers. Für das Entwickeln einer Browser-Oberfläche enthält er keinen passenden Workflow. Seine Beschreibung und sein Quellcode wurden gelesen; der Skill wurde nicht installiert.

### Repository und Bereitstellung

Ziel ist das bestehende Repository `newtro2030/studycards`. Dort ist folgende Ergänzung vorgesehen:

```text
docs/
  PFLICHTENHEFT_POMODORO.md
```

Die bestehende README erhält einen Link auf das Pflichtenheft. Später werden Anwendungscode, gezielte Tests und die vorhandene Architektur-Dokumentation ergänzt. Repository und Bereitstellung bleiben bei [StudyCards auf GitHub Pages](https://newtro2030.github.io/studycards/). Die zusätzliche Funktion verwendet dieselbe App-Adresse und denselben PWA-Service-Worker. Das überarbeitete Konzept liegt derzeit lokal vor; weder Repository noch veröffentlichte App wurden geändert.
