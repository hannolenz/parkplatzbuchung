# Parkplatzbuchung

Private Next.js-Anwendung zur Prüfung und manuellen Reservierung von ERGO-Ladesäulen.
Technischer Projektname: `parkplatzbuchung`.

## Aktueller Stand

- Next.js mit React; serverseitige Browserautomatisierung mit Playwright/Chromium.
- Login auf https://duesseldorf.ergoladesaeulen.de und lokale Speicherung der Browser-Session in `.data/parking-session.json`.
- Das gewählte Parkdatum bestimmt die Buchung. Datumsreiter werden über ihren sichtbaren Text erkannt, beispielsweise `Heute (23.8.2026)`, `Morgen (24.8.2026)` oder `24.08.2026`.
- Zeitslots: **07:00–12:30 Uhr** und **13:00–15:00 Uhr**. Zwischen 12:30 und 13:00 Uhr findet der Fahrzeugwechsel statt.
- Säulen und Verfügbarkeit werden dynamisch aus der ERGO-Seite gelesen.
- Frei definierbare Säulen-Prioritäten; optional wird eine andere freie Säule gewählt.
- „Verfügbarkeit prüfen“ bucht nicht. **„Jetzt reservieren“ kann nach Bestätigung eine echte Reservierung auslösen.** Die Serverroute verlangt zusätzlich `confirm: true` und prüft die erwartete Säule erneut.
- Ein Reservierungsklick liefert derzeit bewusst **keine Erfolgsmeldung**, sondern `outcome: unknown` (HTTP 409), bis ein verlässlicher ERGO-Erfolgszustand anhand einer echten Testbuchung belegt ist.
- Es gibt noch keinen Scheduler und keinen separaten Worker.

Der Login wurde im bisherigen Projektstand erfolgreich getestet. Ohne lokale Zugangsdaten lässt sich dieser Live-Test nicht wiederholen.

## Lokale Einrichtung

Node.js gemäß den Anforderungen der festgeschriebenen Abhängigkeiten und npm werden benötigt.

```bash
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3001
```

Das bestehende `postinstall`-Skript installiert Chromium über Playwright. Falls die Browserinstallation separat erforderlich ist:

```bash
npx playwright install chromium
```

Lege `.env.local` ausschließlich lokal im Projektverzeichnis an und trage dort die tatsächlichen Werte ein:

| Variable | Zweck |
| --- | --- |
| `PARKING_URL` | URL der ERGO-Buchungsseite |
| `PARKING_USERNAME` | Persönlicher Benutzername |
| `PARKING_PASSWORD` | Persönliches Passwort |
| `PLAYWRIGHT_HEADLESS` | `true` für unsichtbaren Browser, `false` für sichtbaren Browser |

Benutzername und Passwort werden ausschließlich aus der Serverumgebung gelesen. Next.js lädt dafür lokal `.env.local`. Der vorhandene Code verwendet bei fehlender `PARKING_URL` die ERGO-URL als Standard und startet Chromium unsichtbar, solange `PLAYWRIGHT_HEADLESS` nicht `false` ist. Keine dieser Variablen darf als `NEXT_PUBLIC_*` angelegt werden.

```bash
npm run build
npm run start -- --hostname 127.0.0.1 --port 3001
```

```bash
npm test
npm audit
```

Die Tests nutzen Nodes eingebauten Testrunner (Node.js 20.9 oder neuer, geprüft mit Node.js 24). Sie testen Entscheidungen, Eingaben, API-Prüfungen, Dateisperren, Browser-Cleanup und Buchungsfehlerpfade mit Testdoubles. Die Select-Regressionstests starten zusätzlich lokales Chromium mit synthetischem HTML und vollständig blockierten Netzwerkanfragen; Chromium muss über das bestehende Postinstall-Skript installiert sein. Kein Test startet eine ERGO-Sitzung oder löst eine echte Buchung aus. Ein Lint-Skript und eine ESLint-Konfiguration sind weiterhin nicht eingerichtet.

## Projektstruktur

- `app/page.js`: Startseite.
- `app/layout.js`: HTML-Grundstruktur und Metadaten.
- `app/globals.css`: Darstellung.
- `app/components/ParkingCard.js`: Parkdatum, Slot, Prioritäten und manuelle Aktionen.
- `app/api/parking/login-test/route.js`: Login-Test.
- `app/api/parking/availability/route.js`: Verfügbarkeitsprüfung.
- `app/api/parking/reserve/route.js`: bestätigte Reservierung.
- `lib/parking.js`: Playwright-Adapter für Login, Session, Datumsauswahl und Seitenbedienung.
- `lib/parking-domain.mjs`: reine Validierung, Slotbezeichnungen und Säulenauswahl.
- `lib/parking-selects.mjs`: gezielte Select-Auswahl und Warten auf die asynchron aktualisierte Säulenliste.
- `lib/parking-runtime.mjs`: prozessübergreifende Dateisperre, Ressourcenbereinigung und Versuchsjournal.
- `lib/parking-attempt.mjs`: Grenze zum Reservierungsklick; persistente Sperre und unbekanntes Ergebnis.
- `lib/parking-diagnostics.mjs`: streng reduzierte lokale Seitendiagnose.
- `lib/parking-dialogs.mjs`: Dialogereignisse, relative Zeitpunkte und sicheres Schließen.
- `lib/parking-secrets.mjs`: gemeinsame gezielte Secret-Bereinigung; Sessionwerte bleiben im Arbeitsspeicher.
- `lib/parking-api.mjs`: gemeinsamer POST-Handler, Zugriffshaken, begrenzte JSON-Eingaben und sichere Fehlermeldungen.
- `tests/*.test.mjs`: ausschließlich lokale automatisierte Tests.
- `package-lock.json`: festgeschriebene Abhängigkeiten; gemeinsam mit `package.json` versionieren.

## Git und vertrauliche Daten

`.gitignore` schließt insbesondere `.env*`, `.data`, Browser-Sessions und -Profile, lokale Zugangsdaten- und Schlüsseldateien, `node_modules`, Build-Ausgaben, Logs und Browser-Diagnosedaten aus.

Keine echten Zugangsdaten in Quellcode, README, Beispieldateien, Screenshots, Logs oder Commits eintragen. Die Browser-Session enthält sensible Authentifizierungsdaten und bleibt lokal. Bei einem Umzug Zugangsdaten und Session ausschließlich separat und geschützt übertragen.

Vor einem Commit im eingerichteten Git-Repository prüfen:

```bash
git status --short
git diff --cached --stat
git check-ignore .env.local .data/parking-session.json node_modules/
```

Git-Ausschlüsse schützen vor normalem versehentlichem Hinzufügen. Sie verhindern weder `git add -f` noch Secrets in beliebigen Quelltexten und entfernen keine bereits versionierten Dateien oder historischen Secrets. Vor Veröffentlichung deshalb auch den vorgemerkten Inhalt und eine vorhandene Historie auf Secrets prüfen; kompromittierte Zugangsdaten ersetzen.

## Spätere Zielarchitektur

Geplant sind GitHub zur Versionsverwaltung, eine online betriebene Next.js-Oberfläche und ein separater, dauerhaft laufender Server-Worker mit Playwright/Chromium. Geplante Buchungen sollen ohne eingeschalteten Mac erfolgen. Diese Trennung und eine zeitgesteuerte Buchung sind noch nicht implementiert; aktuell läuft Playwright direkt in den Next.js-API-Routen.

## Absicherung der Browser- und Buchungsaktionen

Alle Aktionen durchlaufen dieselbe Dateisperre `.data/operation.lock`. Ein zweiter Prozess erhält sofort HTTP 409 (`PARKING_BUSY`); es gibt keine Warteschlange und keine automatische Wiederholung. Die Sperre gilt auch für Login und Verfügbarkeitsprüfung, da diese dieselbe Session nutzen. Sie benötigt ein gemeinsames lokales Dateisystem; mehrere Server mit eigenen Verzeichnissen werden damit nicht koordiniert.

Browser und Context werden bereits ab dem Browserstart in einem gemeinsamen Cleanup verwaltet. Der Context schließt alle Pages und Popups. Auch bei fehlgeschlagenem Context-Cleanup wird der Browser geschlossen. Bei einem Cleanup-Fehler bleibt die Dateisperre vorsichtshalber bestehen. Sessiondateien werden atomar ersetzt und mit Dateimodus `0600` angelegt; neue Datenverzeichnisse mit `0700`.

Vor dem echten Klick werden eine Diagnose und `.data/attempts/YYYY-MM-DD-SLOT.json` exklusiv geschrieben. Der Versuchsmarker wird vor dem Klick synchronisiert. Er bleibt auch bei Timeout, Verbindungsabbruch oder fehlender Bestätigung bestehen. Ein weiterer Versuch für denselben Tag und Slot ist unabhängig von der Säule gesperrt. Es gibt bewusst keinen HTTP-Endpunkt zum Entsperren.

**Nach einem unklaren Versuch:** Zuerst direkt auf der ERGO-Seite die eigenen Reservierungen prüfen. Nicht erneut klicken. Nur wenn sicher keine Buchung besteht und kein zugehöriger Prozess mehr läuft, darf die betreffende Versuchsdatei lokal manuell entfernt werden. Bei bestätigter Buchung bleibt der Marker erhalten. Auch ein Fehler unmittelbar vor dem Klick kann vorsichtshalber einen Marker hinterlassen.

**Nach einem Prozessabbruch:** Server und zugehörige Chromium-Prozesse prüfen und beenden, bevor eine übrig gebliebene `.data/operation.lock` lokal entfernt wird. Eine Sperre wird nie allein wegen ihres Alters aufgehoben. `SIGKILL`, Stromausfall und Betriebssystemfehler können von JavaScript nicht bereinigt werden; dafür ist später zusätzlich eine Prozessaufsicht erforderlich.

## Sichere Diagnose und noch fehlender Erfolgsnachweis

Der bisherige Code belegt keinen verlässlichen ERGO-Erfolgszustand. Allgemeine Wörter wie „Reservierung“ und ein nicht mehr freier Eintrag reichen nicht aus. Daher gibt es derzeit **keinen positiven Erfolgszweig** nach dem Reservierungsklick, auch wenn die Buchung tatsächlich funktioniert hat.

Bei der nächsten vom Benutzer bewusst ausgelösten echten Testreservierung werden vorher und nachher Dateien in `.data/diagnostics/` angelegt. Die API liefert eine Diagnose-ID; die Nachher-Datei referenziert die Vorher-Datei. `diagnosticSaved: false` bedeutet, dass nur die vorherige Diagnose gespeichert werden konnte. Der Versuchsmarker bleibt trotzdem bestehen.

Gespeichert werden Elementzahlen, reduzierte Auswahlzustände, ein Text mit ausschließlich fest freigegebenen Buchungswörtern und zwei URL-Merkmale (gleicher Ursprung / Loginseite). Benutzername und Passwort werden zusätzlich aus den Texten entfernt. Unbekannte Wörter und Zahlen werden durch `[entfernt]` ersetzt. Es werden **keine Roh-DOMs, vollständigen URLs, Queryparameter, Cookies, Formularwerte, Screenshots, Traces oder vollständigen Seitentexte** gespeichert oder protokolliert. Die Dateien bleiben lokal, sind durch `.gitignore` ausgeschlossen und erhalten Dateimodus `0600`.

**JavaScript-Dialoge werden separat erfasst:** Ein vor der Auswahl registrierter `page.on('dialog', ...)`-Listener speichert `type`, gezielt bereinigtes `message`, UTC-Zeitstempel, Millisekunden seit Beginn der Reservierungsvorbereitung sowie seit Start des Klicks und die Phase `before_click`, `click` oder `after_click`. Vor dem Klick ist der relative Klickzeitpunkt `null`. Die Ereignisse werden als `dialogs` in die lokale Vorher-/Nachher-Diagnose aufgenommen, auch wenn die nachträgliche Seitenerfassung fehlschlägt. Ohne Dialog ist die Liste leer.

Für Dialogtexte gilt keine Wort-Whitelist: Normale Meldungen wie „Die Startzeit liegt in der Vergangenheit.“ bleiben lesbar (dies ist ein synthetisches Testbeispiel, nicht der rekonstruierte Text des bisherigen Live-Alerts). Entfernt werden bekannte Zugangsdaten, Cookie-, Local-Storage- und Session-Storage-Werte sowie erkennbare sensible Schlüssel/Werte, Authentifizierungsheader, URLs, E-Mail-Adressen und Tokenmuster. Sessionwerte werden ausschließlich im Speicher zur Bereinigung verwendet, niemals selbst in der Diagnose gespeichert. Beliebige unbekannte, kurze sensible Werte ohne Kennzeichnung sind nicht zuverlässig automatisch erkennbar; Diagnosen bleiben deshalb lokal und Git-ignoriert. Die strenge Wortprojektion des übrigen Seitentexts bleibt bestehen.

Alerts werden mit `accept()` geschlossen. `confirm`, `prompt` und `beforeunload` werden mit `dismiss()` geschlossen, ohne weitere Aktionen zu bestätigen oder Eingaben zu übermitteln. Listener werden anschließend entfernt. Fehler beim Schließen werden nur als Status gespeichert, ohne rohe Browserfehlermeldungen. **Auch ein positiv formulierter Alert führt weiterhin niemals zu `ok: true`.** Die echte Erfolgssemantik ist nach wie vor unbelegt; es wurde für diese Erweiterung kein weiterer Live-Test durchgeführt.

Diese absichtlich stark reduzierte Diagnose kann für die exakte Erfolgsprüfung noch unzureichend sein. Dann muss bei einer ausdrücklich autorisierten Live-Sitzung gezielt ein relevantes Element untersucht werden; erst daraus darf ein überprüfbarer Vertrag (zum Beispiel konkrete Buchung mit Datum, Slot und Säule) entstehen. Ein geänderter Seitentext nach dem Klick ist nur ein Diagnoseereignis, kein Erfolgsnachweis.

## Serverseitige Eingaben und Wartebedingungen

Datum: striktes `YYYY-MM-DD` und echtes Kalenderdatum ab 2000; kein künstlicher Buchungshorizont und keine Annahme über die ERGO-Freischaltung. Slot: nur `morning` oder `afternoon`. Säulen: positive Ganzzahlen als Strings, maximal zehn Ziffern. Prioritäten: höchstens 100 Einträge, Duplikate werden in Reihenfolge entfernt. Fallback: ausschließlich Boolean. Reservierung: `confirm: true` und eine gültige `expectedStation` sind Pflicht. Unbekannte Felder werden abgelehnt; JSON-Anfragen sind auf 16 KiB begrenzt.

Nur ein exakt „frei“ lautender Säulenstatus zählt als frei; „nicht frei“ und unbekannte Statusformulierungen sind ausgeschlossen. Rohtexte belegter Säulen werden nicht an die Oberfläche zurückgegeben.

Feste Sleeps wurden entfernt. Playwright wartet auf sichtbare Bedienelemente, ein Login-Ergebnis, bedienbare Auswahlfelder und die tatsächlich ausgewählte Slotbezeichnung. Nach dem Klick wird begrenzt auf eine Text-/URL-Änderung gewartet. **Der tatsächlich aktive Datumsreiter ist noch nicht unabhängig verifiziert.** Die Säulenauslese wartet jetzt auf die nach der Slotwahl beobachtete Aktualisierung der Optionen und erkennbare Säuleneinträge. Bleibt nur ein Platzhalter oder erfolgt keine Aktualisierung, wird mit Timeout abgebrochen statt irreführend eine leere Verfügbarkeit zu melden. Eine künftig geänderte Seitensemantik oder in mehreren asynchronen Schritten aufgebaute Liste muss erneut untersucht werden.

## API-Zugriff und Risiken vor Online-Betrieb

Alle drei POST-Routen verwenden den zentralen Handler `parkingPost` und `authorizeParkingRequest`. Aktuell werden nur lokale Hostnamen und ein exakt passender Origin akzeptiert. Die Oberfläche sendet diesen Origin bei ihren Browseranfragen automatisch. Direkte API-Clients benötigen ihn ebenfalls. Fehlerantworten sind standardisiert und ohne rohe Playwright-/Seitenmeldungen; Antworten sind nicht cachebar.

**Dies ist keine Benutzer-Authentifizierung.** Origin und Host können von direkten HTTP-Clients vorgetäuscht werden. Den Server deshalb ausschließlich an Loopback binden (siehe Startbefehle), nicht über Tunnel oder öffentliche Reverse-Proxys bereitstellen. Vor Online-Betrieb muss der zentrale Zugriffshaken eine echte serverseitige Authentifizierung und Autorisierung erhalten; zusätzlich sind Rate-Limits und eine geeignete Betriebsumgebung erforderlich.

- `/api/parking/reserve`: besonders kritisch, löst eine reale Reservierung aus. Bestätigungsparameter sind keine Zugriffsberechtigung.
- `/api/parking/login-test`: nutzt Zugangsdaten und speichert eine authentifizierte Session.
- `/api/parking/availability`: nutzt die Session, startet Chromium und liest Kontodaten/Verfügbarkeit.

`npm audit` meldete am 27.09.2026 drei betroffene Pakete: Next.js (kritisch), PostCSS (hoch), Sharp (hoch). Die konkreten Einsatzbedingungen bestimmen die Ausnutzbarkeit. Abhängigkeiten wurden in dieser Phase nicht aktualisiert; die Befunde sind vor einem Online-Betrieb zu bearbeiten. Kein `npm audit fix --force` wurde ausgeführt.

## Befund zur Säulenauslese (27.09.2026)

Eine ausschließlich lesende Live-Diagnose für den 27.09.2026, 13:00–15:00 Uhr zeigte vier Selects:

| ID | name | Optionen nach Aktualisierung | Verwendung |
| --- | --- | ---: | --- |
| `slots-select` | leer | 2 | Zeitfenster; vorher 3 inklusive Platzhalter |
| `saeulennr-select` | leer | 44 | Platzhalter und 43 buchbare Säuleneinträge |
| `saeulennr-report-select` | `saeulennr-report-select` | 44 | separate Säulenauswahl für Meldungen |
| `reason-report-select` | `reason-report-select` | 2 | Meldegrund, keine Buchungsauswahl |

Unmittelbar nach der Slotwahl stand im Buchungs-Select noch ein einzelner Platzhalter. Erst nach asynchronen DOM-Änderungen erschienen Einträge wie `1181 - frei` mit `value="1181"`. Das Zahlen-/Bindestrichformat und der Parser waren korrekt; gelesen wurde zu früh. Während des Vorlaufs wurden XHR-Anfragen und 95 Mutationsereignisse an Selects beobachtet. Es wurden keine Request-Bodies, Tokens oder vollständigen Request-URLs protokolliert.

Die neue Auslese adressiert `#slots-select` und `#saeulennr-select` gezielt. Ein vor der Slotwahl installierter MutationObserver verhindert, dass unveränderte alte Optionen oder Platzhalter als fertiges Ergebnis gelesen werden. Deaktivierte Optionen gelten nicht als frei. Es gibt keinen festen Sleep und keinen Produktions-Wait auf globales `networkidle`.

Die erneute Live-Verfügbarkeitsprüfung erkannte **43 Säulen, davon 43 frei**; bei Priorität 1181 → 1183 → 1185 war **1181** der Vorschlag. Das ist eine Momentaufnahme, keine Reservierung. Der Reservierungsbutton wurde nicht angeklickt. Die vollständige bereinigte Select-/Optionsdiagnose liegt ausschließlich lokal unter `.data/diagnostics/select-inspection-2026-09-27.json`; unbekannte Texte und nicht numerische Werte sind entfernt. Kein Diagnoseinhalt wird versioniert.
