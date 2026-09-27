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
- Es gibt noch keinen Scheduler und keinen separaten Worker.

Der Login wurde im bisherigen Projektstand erfolgreich getestet. Ohne lokale Zugangsdaten lässt sich dieser Live-Test nicht wiederholen.

## Lokale Einrichtung

Node.js gemäß den Anforderungen der festgeschriebenen Abhängigkeiten und npm werden benötigt.

```bash
npm ci
npm run dev -- --port 3001
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
npm run start -- --port 3001
```

Ein Lint-Skript, eine ESLint-Konfiguration und automatisierte Tests sind derzeit nicht eingerichtet.

## Projektstruktur

- `app/page.js`: Startseite.
- `app/layout.js`: HTML-Grundstruktur und Metadaten.
- `app/globals.css`: Darstellung.
- `app/components/ParkingCard.js`: Parkdatum, Slot, Prioritäten und manuelle Aktionen.
- `app/api/parking/login-test/route.js`: Login-Test.
- `app/api/parking/availability/route.js`: Verfügbarkeitsprüfung.
- `app/api/parking/reserve/route.js`: bestätigte Reservierung.
- `lib/parking.js`: Login, Session, Datumsauswahl, Säulenwahl und Reservierung.
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

## Bekannte technische Grenzen

- `npm audit` meldete bei der Prüfung am 27.09.2026 drei betroffene Pakete: Next.js (kritisch), PostCSS (hoch) und Sharp (hoch). Die Abhängigkeiten wurden in diesem Auftrag nicht aktualisiert. Der Befund ist vor einem Online-Betrieb zu bearbeiten; die konkrete Ausnutzbarkeit hängt vom Einsatz ab.

- Die API-Routen besitzen noch keinen eigenen Zugriffsschutz. Vor einem öffentlich erreichbaren Betrieb ist dieser erforderlich.
- Fehler werden derzeit serverseitig protokolliert und als Meldungen zurückgegeben; externe Seiten- oder Browsermeldungen könnten sensible Informationen enthalten.
- Fehler während des Browseraufbaus bzw. Logins können einen Browser offen lassen, da die aufrufenden `finally`-Blöcke erst nach erfolgreichem Aufbau greifen.
- Datumserkennung und Verfügbarkeit beruhen auf Seitentexten, der Reihenfolge von Auswahlfeldern und festen kurzen Wartezeiten. Die Auswahl des Datums wird nicht separat verifiziert; Kalenderdatum, Slot und weitere Eingaben sind nur eingeschränkt validiert.
- Die Reservierungsbestätigung ist heuristisch; auch ohne eindeutigen Buchungsnachweis liefert die Funktion derzeit `ok: true` mit einem entsprechenden Hinweis zurück.
- Parallele Anfragen teilen dieselbe Sessiondatei; eine Koordination ist nicht implementiert.

Diese Punkte sind dokumentiert, aber im Rahmen der Umbenennung funktional unverändert geblieben.
