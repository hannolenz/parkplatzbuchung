# Parkplatzbuchung

Private Next.js-Anwendung zur Planung sowie zur lokalen Prüfung und manuellen Reservierung von ERGO-Ladesäulen.
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
- Es gibt keinen Scheduler und keine automatische echte Ausführung. Phase 2A ergänzt PostgreSQL-Pläne und einen separaten, ausschließlich simulierenden Worker.

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

`.gitignore` schließt insbesondere `.env*` (mit der einzigen Ausnahme der geprüften, geheimnisfreien `.env.example`), `.data`, Browser-Sessions und -Profile, lokale Zugangsdaten- und Schlüsseldateien, `node_modules`, Build-Ausgaben, Logs und Browser-Diagnosedaten aus.

Keine echten Zugangsdaten in Quellcode, README, Beispieldateien, Screenshots, Logs oder Commits eintragen. Die Browser-Session enthält sensible Authentifizierungsdaten und bleibt lokal. Bei einem Umzug Zugangsdaten und Session ausschließlich separat und geschützt übertragen.

Vor einem Commit im eingerichteten Git-Repository prüfen:

```bash
git status --short
git diff --cached --stat
git check-ignore .env.local .data/parking-session.json node_modules/
```

Git-Ausschlüsse schützen vor normalem versehentlichem Hinzufügen. Sie verhindern weder `git add -f` noch Secrets in beliebigen Quelltexten und entfernen keine bereits versionierten Dateien oder historischen Secrets. Vor Veröffentlichung deshalb auch den vorgemerkten Inhalt und eine vorhandene Historie auf Secrets prüfen; kompromittierte Zugangsdaten ersetzen.

## Spätere Zielarchitektur

Geplant sind GitHub zur Versionsverwaltung, eine online betriebene Next.js-Oberfläche und ein separater, dauerhaft laufender Server-Worker mit Playwright/Chromium. Geplante Buchungen sollen ohne eingeschalteten Mac erfolgen. Die Planung und die Worker-Datenbankschnittstelle sind vorbereitet (siehe Phase 2A). Die bisherigen manuellen Aktionen starten Playwright weiterhin direkt in lokalen Next.js-API-Routen. Vor Vercel-Betrieb müssen diese Aktionen entfernt oder an einen gesicherten Worker übergeben werden.

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

Alle drei POST-Routen verwenden den zentralen Handler `parkingPost` und `authorizeParkingRequest`. Aktuell werden nur lokale Hostnamen und ein exakt passender Origin akzeptiert. In einer Vercel-Umgebung sind die manuellen APIs zusätzlich gesperrt. Die Oberfläche sendet diesen Origin bei ihren Browseranfragen automatisch. Direkte API-Clients benötigen ihn ebenfalls. Fehlerantworten sind standardisiert und ohne rohe Playwright-/Seitenmeldungen; Antworten sind nicht cachebar.

**Dies ist keine Benutzer-Authentifizierung.** Origin und Host können von direkten HTTP-Clients vorgetäuscht werden. Den Server deshalb ausschließlich an Loopback binden (siehe Startbefehle), nicht über Tunnel oder öffentliche Reverse-Proxys bereitstellen. Vor Online-Betrieb muss der zentrale Zugriffshaken eine echte serverseitige Authentifizierung und Autorisierung erhalten; zusätzlich sind Rate-Limits und eine geeignete Betriebsumgebung erforderlich.

- `/api/parking/reserve`: besonders kritisch, löst eine reale Reservierung aus. Bestätigungsparameter sind keine Zugriffsberechtigung.
- `/api/parking/login-test`: nutzt Zugangsdaten und speichert eine authentifizierte Session.
- `/api/parking/availability`: nutzt die Session, startet Chromium und liest Kontodaten/Verfügbarkeit.

Beim Abschluss von Phase 2A wurden die bisherigen Audit-Befunde durch das kompatible Next.js-Minor-Update 16.2.11 → 16.3.6 behoben. Der abschließende `npm audit` meldet **0 Schwachstellen**, einschließlich Entwicklungsabhängigkeiten. Details stehen im folgenden Sicherheitsprotokoll. Kein `npm audit fix --force`, keine Major-Upgrades und keine erzwungenen Overrides wurden verwendet.

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

## Phase 2A: Planung und PostgreSQL

Die Startseite enthält „Geplante Buchungen“ mit Anlegen, Auflisten, Ändern und Stornieren. Angezeigt werden Parkdatum, Slot, Ausführungszeit in Berlin, Prioritäten, Fallback, Status, Säule und Ergebnis. Die manuellen Aktionen bleiben separat eingeklappt erhalten. Das Speichern eines Plans startet weder Chromium noch eine Reservierung.

### DB-Lösung und Zielarchitektur

Verwendet wird **PostgreSQL mit `pg` (node-postgres)** und einer kleinen Repository-Schicht, ohne ORM. Für die wenigen Tabellen bleibt SQL übersichtlich; atomare Claims, Sperren und partielle eindeutige Indizes sind unmittelbar überprüfbar. Alle Eingaben werden als [SQL-Parameter](https://node-postgres.com/features/queries) gebunden. Der Pool entsteht erst beim ersten DB-Zugriff, mit höchstens drei Verbindungen pro Prozess und begrenzten Verbindungs-/Abfragezeiten.

```text
Browser → Next.js /api/bookings → PostgreSQL ← separater Worker
          später Vercel                       später VPS + Chromium
                                             jetzt nur Dry-run
```

Die Webapp verwaltet Pläne über `lib/planning/service.mjs` und `repository.mjs`. Der Worker nutzt ausschließlich `worker/repository.mjs` und einen eigenen Prozess. Es gibt bewusst keine öffentliche Worker-HTTP-API. Die heutige Simulation importiert keine Playwright-Logik. Die spätere Aufteilung benötigt einen gemeinsam erreichbaren PostgreSQL-Dienst; es wurde weder ein Dienst noch ein Deployment eingerichtet.

### Lokale Konfiguration und Migrationen

Zusätzlich zu den oben beschriebenen Variablen werden serverseitig benötigt:

| Variable | Bedeutung |
| --- | --- |
| `DATABASE_URL` | Verbindungszeichenfolge zur eigenen PostgreSQL-Datenbank; niemals `NEXT_PUBLIC_*` |
| `BOOKING_RELEASE_LEAD_DAYS` | **Bestätigte fachliche Konfiguration: `1`** — Freigabe am Vortag um 00:01 Uhr Europe/Berlin. Die zentrale Konfiguration erlaubt 0–365, hat aber keinen impliziten Standardwert. |
| `WORKER_ID` | Optionale nicht geheime Kennung, 1–64 Buchstaben/Ziffern/Unterstriche/Bindestriche; lokal standardmäßig `local-dry-run` |

Die Freigaberegel ist fachlich bestätigt: Ein Parkplatz wird am **vorherigen Kalendertag ab 00:01 Uhr Europe/Berlin** buchbar. `.env.example` enthält `BOOKING_RELEASE_LEAD_DAYS=1`, eine ausdrücklich als Platzhalter gekennzeichnete `DATABASE_URL` und leere Zugangsdatenfelder. Bei einer neuen Einrichtung die Vorlage nach `.env.local` kopieren und dort die DB-Verbindung ergänzen; eine vorhandene `.env.local` nicht überschreiben. Ohne gültige Konfiguration oder Datenbank bleibt Speichern gesperrt. Der Build benötigt keine Datenbank und keine ERGO-Zugangsdaten.

Nach Bereitstellung einer eigenen lokalen PostgreSQL-Datenbank und Konfiguration in der ignorierten `.env.local`:

```bash
npm run db:migrate
npm run dev -- --hostname 127.0.0.1 --port 3001
```

Die npm-DB-/Worker-Skripte benötigen Node.js **22 oder neuer** und laden `.env.local` ausdrücklich mit `--env-file`. Im späteren Betrieb mit bereits gesetzten Umgebungsvariablen direkt `node scripts/migrate.mjs` bzw. `node worker/dry-run.mjs` verwenden. Keine Verbindungszeichenfolgen als Kommandozeilenargumente übergeben. Der Migrationseinstieg gibt nur Migrationsnamen oder eine allgemeine Fehlermeldung aus.

`db/migrations/001_planned_bookings.sql` ist versioniert. `lib/db/migrate.mjs` führt ausstehende Migrationen transaktional unter einer PostgreSQL-Advisory-Sperre aus und protokolliert Namen, SHA-256-Prüfsumme und Zeitpunkt in `schema_migrations`. Angewandte Dateien nicht ändern, sondern neue nummerierte Migrationen hinzufügen. Keine automatische Migration beim Webstart, keine automatischen Down-Migrationen. Für einen späteren Betrieb sind Backups und ein eigener Migrations-DB-Benutzer vorzusehen.

### Datenmodell

`planned_bookings` enthält alle Planfelder: `id`, `parking_date`, `slot`, `station_priorities`, `allow_fallback`, `status`, `scheduled_execution_at`, `selected_station`, `created_at`, `updated_at`, `started_at`, `finished_at`, `attempt_count`, `last_error`, `result_message`. Hinzu kommen `version` für konkurrierende Änderungen, `release_lead_days` und `time_zone` als gespeicherte Berechnungsgrundlage sowie `dry_run_completed_at`.

`booking_attempts` hält jeden Versuch separat mit UUID, Plan-ID und -Version, Modus `dry_run`/`live`, Status, Worker-Kennung, eingefrorenen Eingaben, Zeitpunkten und begrenzten Ergebnis-/Fehlerfeldern. Im aktuellen Code wird ausschließlich `dry_run` angelegt. Ein Versuch ist kein Nachweis einer ERGO-Buchung.

Datenbank-Constraints sichern Datum-/Slot-Zuordnung, Stationsformat, Zustände und Eindeutigkeit:

- Höchstens ein nicht stornierter Plan pro Parkdatum und Slot im Single-User-Betrieb. Auch `failed` und `unknown` bleiben vorsichtshalber gesperrt.
- Höchstens ein Versuch pro Planversion und Modus sowie ein aktiver Versuch pro Plan.
- Höchstens ein zukünftiger `live`-Versuch pro Plan über alle Versionen; noch kein Code führt ihn aus.
- Ein Dry-run-Versuch darf niemals `booked` sein.

### Berechnung des Buchungszeitpunkts

`scheduledExecutionAt(parkingDate, leadDays)` in `lib/planning/domain.mjs` zieht zuerst die konfigurierte Zahl **Kalendertage** vom Parkdatum ab und setzt am resultierenden Datum **00:01 Europe/Berlin**. Anschließend wird in einen UTC-Zeitpunkt umgerechnet und als `timestamptz` gespeichert. Sommer-/Winterzeit und Jahreswechsel werden berücksichtigt; es werden nicht pauschal 24-Stunden-Blöcke vom UTC-Zeitpunkt abgezogen. Beide Zeitslots nutzen dieselbe Freigabezeit.

Für den Betrieb gilt `BOOKING_RELEASE_LEAD_DAYS=1`. Regressionstests prüfen die bestätigte Regel für beide Slots: **29.09.2026 → 28.09.2026 00:01 Europe/Berlin** (27.09.2026 22:01 UTC) und **02.10.2026 → 01.10.2026 00:01 Europe/Berlin** (30.09.2026 22:01 UTC). Weitere Tests decken beide Zeitumstellungen, Schaltjahr und Jahreswechsel ab. Änderungen der Umgebungskonfiguration verschieben bestehende Pläne nicht stillschweigend. Erst ein explizites Bearbeiten berechnet erneut und erhöht die Planversion. Bereits vergangene Ausführungszeitpunkte werden beim Speichern abgelehnt. Die bestätigte Regel verwendet Kalendertage ohne Wochenend- oder Feiertagsausnahme.

### Statusmodell und atomare Claims

Für die spätere echte Ausführung ist vorgesehen:

```text
planned → preparing → running → booked | failed | unknown
   ↓           └──────────────→ failed | unknown
cancelled
```

`booked` darf später nur nach einem belegten ERGO-Erfolgssignal entstehen. Dieses ist weiterhin nicht bekannt. `failed`, `unknown`, `booked` und `cancelled` werden nicht automatisch neu gestartet. Änderungen sind nur bei `planned` und vor dem gespeicherten Ausführungszeitpunkt möglich. Stornieren ist bei `planned` möglich und storniert ausschließlich den Plan, niemals eine echte ERGO-Reservierung. Beide Aktionen prüfen die mitgesendete Version; konkurrierende Änderungen liefern HTTP 409.

Ein Claim sperrt genau einen fälligen Plan mit [`FOR UPDATE SKIP LOCKED`](https://www.postgresql.org/docs/current/sql-select.html), legt den Versuch an und setzt Planstatus/Zähler in derselben Transaktion. Andere Worker überspringen gesperrte Zeilen. Die Rückgabe enthält Versuch-ID, Plan-ID, Version, Worker-Kennung und eingefrorene Eingaben. Start und Abschluss prüfen Versuch, Besitzer und Status erneut. Ein wiederholter Abschluss einer bereits beendeten Simulation ist idempotent. Die DB-Verbindung bleibt nicht über eine spätere Browseraktion offen.

Für Simulationen gilt `planned → preparing → running → planned`; der Versuch endet als `simulated`, und Planergebnis/`dry_run_completed_at` kennzeichnen den Abschluss ausdrücklich. Die einzigartige Versuchskombination verhindert, dass dieselbe Planversion erneut simuliert wird. Es wird keine Säule ausgewählt und niemals `booked` gesetzt. Fehler enden als `failed`, ohne Retry.

### Dry-run-Worker

```bash
npm run worker:dry-run -- --once
```

Ein Aufruf verarbeitet **höchstens einen fälligen Plan** und beendet sich anschließend. Er protokolliert ausschließlich die vorgesehenen Planparameter und technischen IDs. Kein Polling, Scheduler, Timer, Chromium oder ERGO-Aufruf. Ohne fälligen Plan geschieht nichts. Der Worker verwendet die Datenbankzeit zum Erkennen fälliger Pläne. Für einen lokalen Test muss ein korrekt konfigurierter Plan bis zu seinem Ausführungszeitpunkt warten; keine reale Buchung wird durchgeführt.

Ein Prozessabsturz lässt einen beanspruchten Plan bewusst in `preparing`/`running`. Es gibt keine automatische Übernahme abgelaufener Claims. Vor einer späteren echten Ausführung werden Prozessaufsicht, sichere Wiederanlaufstrategie, Zeitabgleich, Überwachung und Umgang mit überfälligen Jobs benötigt. DB-Idempotenz allein kann keine exakt einmalige externe ERGO-Wirkung garantieren: Ein Absturz nach dem Klick erfordert den Zustand `unknown` und manuelle Klärung, keinen erneuten Klick. Die bisherigen lokalen Buchungsmarker müssen bei der späteren Anbindung zusätzlich berücksichtigt werden.

### API und Sicherheitsgrenzen

- `GET /api/bookings`: Konfigurationsbereitschaft und bis zu 200 Pläne; enthält keine Verbindungszeichenfolge oder Zugangsdaten.
- `POST /api/bookings`: validierten Plan erstellen.
- `PATCH /api/bookings/:id`: zukünftigen unbeanspruchten Plan mit Versionsprüfung ändern.
- `DELETE /api/bookings/:id`: Plan mit Versionsprüfung stornieren, Datensatz bleibt erhalten.

`lib/planning/http.mjs` bildet den zentralen Zugriffshaken für Planungsrouten. Aktuell nur Loopback-Hostnamen, passende Origin bei Änderungen, begrenzte JSON-Eingaben, `no-store` und bereinigte Fehlermeldungen; auf Vercel vollständig gesperrt. Auch Planung und Lesen benötigen vor Onlinebetrieb echte Authentifizierung/Autorisierung. Die Worker-Schnittstelle wird nur serverseitig direkt über PostgreSQL aufgerufen. Es gibt keinen Client-Parameter zum Setzen von `status`, `attemptCount`, `selectedStation` oder Erfolgsmeldungen.

Vor Vercel-/VPS-Betrieb: Benutzerzugriff und CSRF-Schutz vervollständigen, öffentliche manuelle Playwright-Routen entfernen, Rollen mit minimalen DB-Rechten für Web/Worker/Migration trennen, PostgreSQL-TLS nach Anbieter konfigurieren, Pooling/Verbindungslimits und Backups festlegen. ERGO-Zugangsdaten und Session gehören später ausschließlich auf den Worker. Das bisherige `postinstall` lädt noch Chromium; die Trennung der Installationspakete ist eine spätere Deployment-Aufgabe. `.gitignore` bleibt für `.env*`, `.data`, Sessions, Diagnose, `node_modules` und `.next` wirksam. Es wurden keine Secrets angelegt.

### Tests und neue Dateien

`tests/planning-domain.test.mjs` prüft Eingaben, Berechnung einschließlich Zeitumstellungen, Zustände und CRUD-Validierung. `tests/planning-api.test.mjs` prüft Zugriff, JSON-Grenzen und sichere Fehler. `tests/planning-connection.test.mjs` prüft Transaktionsabschluss, Rollback und Freigabe defekter Verbindungen. `tests/planning-db.test.mjs` verwendet **PGlite als ausschließlich lokale PostgreSQL-Testinstanz im Speicher**, ohne Server, Zugangsdaten oder ERGO. Getestet werden die echten Migrationen/SQL-Abfragen, Constraints, konkurrierende Claim-Aufrufe, Versionskonflikte, Rollback, Besitzerprüfung und idempotente Simulation. PGlite serialisiert seine Transaktionen; ein zusätzlicher Mehrprozess-/Mehrverbindungstest gegen echtes PostgreSQL bleibt vor Produktionsbetrieb erforderlich.

Neue Verantwortungsbereiche: `lib/db/` (Verbindung/Migration), `lib/planning/` (Domain, Service, Web-Repository, API), `db/migrations/`, `scripts/migrate.mjs`, `worker/`, `app/api/bookings/`, `app/components/PlannedBookings.js` und die Planungstests. Die bestehende Playwright-/Reservierungslogik wurde für Phase 2A nicht verändert.


## Sicherheitsprotokoll zum Abschluss von Phase 2A (27.09.2026)

| Paket | Vorher | Nachher | Änderung |
| --- | --- | --- | --- |
| Next.js | 16.2.11 | 16.3.6 | Gezieltes Minor-Update innerhalb Major 16, exakt festgeschrieben |
| PostCSS | 8.4.31 | 8.5.23 | Transitiv durch Next.js aktualisiert |
| Sharp | 0.34.5 | 0.35.5 | Transitive von Next.js vorgesehene Version; keine eigene Überschreibung |

React/React DOM 19.2.0, Playwright 1.62.0, pg 8.23.0 und PGlite 0.5.8 bleiben unverändert. Next.js 16.3.6 unterstützt die vorhandenen React-19-Abhängigkeiten und Node >=20.9; lokal wird Node 24 verwendet. Die Phase-2-Skripte setzen weiterhin Node >=22 voraus. `package-lock.json` wurde durch npm konsistent aktualisiert.

Der Audit vor dem Update meldete folgende konkrete Advisories; die installierten neuen Versionen liegen außerhalb aller gemeldeten betroffenen Bereiche:

| Paket | Advisory | Schweregrad | Betroffener Bereich laut Audit |
| --- | --- | --- | --- |
| next | [GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) — Next.js: Unauthenticated Remote Code Execution on windows-hosted servers | critical | `>=16.0.0 <16.3.3` |
| next | [GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) — Next.js: Unauthenticated Remote Code Execution in Image Optimization API when AVIF files are used | critical | `>=16.0.0 <16.3.3` |
| postcss | [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) — PostCSS has XSS via Unescaped `</style>` in its CSS Stringify Output | moderate | `<8.5.10` |
| postcss | [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) — PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments | high | `<=8.5.11` |
| postcss | [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) — PostCSS: incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled sourceMappingURL reads arbitrary .map files when `from` is unset | moderate | `<=8.5.22` |
| postcss | [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) — PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure | high | `<=8.5.17` |
| sharp | [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) — sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 | high | `<0.35.0` |
| sharp | [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) — sharp: Vulnerabilities in libheif: GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545 | high | `<0.35.4` |

Die Windows-RCE betrifft Windows-gehostete Server; die Image-Optimization-RCE betrifft AVIF-Verarbeitung. PostCSS meldete XSS im Stringify-Ergebnis und Dateizugriffe über Source-Map-Kommentare. Sharp war über native Bildbibliotheken betroffen. Die Anwendung wird lokal auf macOS entwickelt; das ersetzt keine Aktualisierung vor einem späteren Onlinebetrieb. Das [Release 16.3.6](https://github.com/vercel/next.js/releases/tag/v16.3.6) enthält außerdem die Korrektur für GHSA-vcvr-r3jv-pc5j (`next/og` ImageResponse). Keine der gemeldeten Schwachstellen bleibt im abschließenden npm-Audit offen; der Audit ist eine Momentaufnahme bekannter Meldungen.

Weiterhin offen vor Onlinebetrieb: echte Authentifizierung/Autorisierung, produktiver 24/7-Worker auf separatem Server, sichere Wiederanlaufstrategie und ein eindeutig belegtes ERGO-Erfolgssignal. Die zentrale PostgreSQL-Datenbank und ein Mehrprozess-Claim-Test gegen echtes PostgreSQL müssen noch eingerichtet bzw. durchgeführt werden. Ein Dry-run bleibt eine Simulation. Es wurde kein Deployment eingerichtet und keine ERGO-Seite aufgerufen.
