# Parkplatzbuchung

Private Next.js-Webanwendung zur Planung von Parkplatzbuchungen. Technischer Name: `parkplatzbuchung`.

**Phase 2B bereitet den privaten Onlinebetrieb vor. Noch kein Deployment, kein Scheduler, kein produktiver Worker und keine automatische Reservierung.** Die Oberfläche zeigt diesen Zustand ausdrücklich an. Geplante Buchungen lassen sich nach Anmeldung anlegen, ändern, stornieren und einsehen. Es gibt keinen Web-Endpunkt zum Starten des Workers.

## Architektur

```text
Browser → Next.js 16 / Login / Planung / Status → zentrale PostgreSQL-Datenbank
          später Vercel                            ↑
                                                  separater 24/7-Worker (später)
                                                  Playwright + ERGO-Session
```

Die Web-App verwendet nur ihre eigenen Login-Einstellungen und PostgreSQL. **ERGO-Zugangsdaten gehören später ausschließlich auf den Worker, nicht in die Vercel-Web-App.** Die drei bisherigen `/api/parking/*`-Routen liefern jetzt grundsätzlich 403 und importieren keinen Playwright-Adapter mehr. Auch angemeldete Benutzer können darüber keine Browseraktion auslösen. Der vorhandene Automatisierungskern bleibt für eine spätere gezielte Worker-Anbindung erhalten; seine funktionale Logik wurde in Phase 2B nicht verändert.

`pg` und die SQL-Repository-Schicht bleiben bestehen. Versionierte SQL-Migrationen sichern Schema und Constraints. PGlite wird ausschließlich für lokale Tests im Arbeitsspeicher verwendet, niemals als produktive Datenbank.

## Single-User-Authentifizierung

Die Anwendung verwendet eine kleine, datenbankgestützte Single-User-Session-Lösung mit Next.js-Route-Handlern und Node.js-Kryptografie. Es gibt keine Registrierung, Benutzerverwaltung, Passwort-zurücksetzen-API oder OAuth-Abhängigkeit. Der bewusst begrenzte Umfang benötigt keinen allgemeinen Auth-Provider und nutzt die ohnehin vorhandene PostgreSQL-Datenbank.

- `APP_AUTH_USERNAME` und ein gesalzener **scrypt-Passworthash** konfigurieren den einzigen Benutzer. Scrypt: N=32768, r=8, p=1, 64 Byte Schlüssel, zufälliger 16-Byte-Salt, konstanter Hashvergleich. Das Setup-Skript verlangt mindestens 16 Zeichen; ein langes zufälliges Passwort verwenden.
- Nach erfolgreicher Anmeldung entsteht ein neues zufälliges 256-Bit-Session-Token. Nur dessen SHA-256-Hash liegt in `app_sessions`; das Token steht ausschließlich im Cookie und wird nicht als JSON zurückgegeben oder geloggt. Ein vorgelegtes altes Session-Token wird widerrufen (Schutz vor Session-Fixation).
- Serverseitige Lebensdauer und Cookie-Laufzeit sind acht Stunden, ohne automatische Verlängerung. Logout löscht die Datenbanksession und das Cookie. Änderungen von Benutzername oder Passworthash entwerten bestehende Sessions. Bereits andere angemeldete Browser bleiben bei einem normalen Login gültig.
- Cookie: `HttpOnly`, `SameSite=Strict`, `Path=/`, kein `Domain`. In Production bzw. auf Vercel zusätzlich `Secure` und Name `__Host-parking_session`. Production erfordert eine HTTPS-Origin. Lokal mit `npm run dev` ist HTTP auf Loopback möglich.
- Die Konfiguration bleibt ausschließlich serverseitig; keine `NEXT_PUBLIC_*`-Authvariablen, kein Klartextpasswort in Environment oder Repository. Ein zusätzlicher Signaturschlüssel ist für diese zufälligen, serverseitig validierten Sessions nicht nötig.

Der [Next.js-Proxy](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) schützt alle Seiten/API-Pfade außer Login, Login/Logout-Handlern und öffentlichen Framework-Assets. Private Seiten und Booking-/Status-Handler prüfen die Datenbanksession **zusätzlich selbst**, wie in den [Next.js-Auth-Empfehlungen](https://nextjs.org/docs/app/guides/authentication) vorgesehen. Der Proxy ist keine alleinige Zugriffsschranke. Neue Seiten müssen ebenfalls `requirePageSession()` verwenden; neue private APIs den zentralen Handler. Die Loginseite ist absichtlich öffentlich, enthält aber keine privaten Daten. Es gibt keine Server Actions.

### CSRF, Rate-Limit und Fehler

`APP_AUTH_ORIGIN` ist die exakte erlaubte Origin. Schreibende Anfragen einschließlich Login und Logout benötigen einen exakt passenden `Origin`-Header; `same-site`/`cross-site` im Fetch-Metadata-Header wird abgewiesen. Es wird nicht auf ungeprüfte `Host`-/`X-Forwarded-*`-Werte vertraut. Bei lesenden Anfragen wird ein vorhandener abweichender Origin ebenfalls abgelehnt. Zusammen mit `SameSite=Strict`, ausschließlich POST/PATCH/DELETE für Änderungen, JSON-Eingaben und fehlendem CORS-Allow-Origin verhindert dies gewöhnliche CSRF-Angriffe. GET löst keine Änderungen aus.

Alle Instanzen teilen einen festen PostgreSQL-Loginzähler: höchstens **10 Versuche pro 15 Minuten**, einschließlich erfolgreicher Versuche. Die Zulassung wird atomar vor der teuren Passwortprüfung verbucht. Keine manipulierbaren IP-Header, keine flüchtigen In-Memory-Limits. HTTP 429 liefert `Retry-After: 900`. Der Zähler wird nicht bei Erfolg zurückgesetzt; ein Angreifer kann daher die Anmeldung vorübergehend blockieren. Vor Freigabe ist zusätzlich Vercel-WAF/Edge-Rate-Limiting sinnvoll, um Last vor der DB abzufangen. Keine automatische IP-Sperre und keine komplexe Benutzerverwaltung.

Fehlerantworten enthalten keine Stacktraces, SQL-Details, Verbindungszeichenfolgen oder Rohmeldungen. Antworten privater APIs/Seiten sind nicht cachebar. Browser-Header verhindern Framing und MIME-Sniffing, beschränken Referrer und deaktivieren Kamera/Mikrofon/Geolocation. Die CSP begrenzt Frames, Objekte und Basis-URLs; sie ist **keine vollständige nonce-basierte Script-CSP**. Session-Tokens sind Bearer-Zugangsdaten; HTTPS, XSS-Vermeidung und geschützte Geräte bleiben erforderlich.

## Environment Variables

`.env.example` enthält ausschließlich Platzhalter bzw. leere Loginfelder. Bei neuer Einrichtung lokal nach `.env.local` kopieren; eine vorhandene Datei nicht überschreiben. Die Web-App benötigt keine ERGO-Zugangsdaten.

| Bereich | Variable | Zweck |
| --- | --- | --- |
| Web-App | `DATABASE_URL` | Eigene PostgreSQL-Verbindung, idealerweise Pooler-Endpunkt; keine `ssl*`-URL-Parameter |
| Web-App | `DATABASE_SSL` | Standard `verify-full`; `disable` ausschließlich lokal in Entwicklung auf Loopback |
| Web-App | `DATABASE_SSL_CA` | Optionales PEM einer privaten CA, echte oder als `\n` codierte Zeilenumbrüche |
| Web-App | `DATABASE_POOL_MAX` | 1–10 Verbindungen pro Instanz, Standard 3 |
| Web-App | `APP_AUTH_ORIGIN` | Exakte Origin ohne Pfad/abschließenden Slash; Produktion `https://...`, lokal z.B. `http://localhost:3001` |
| Web-App | `APP_AUTH_USERNAME` | Eigenständiger Web-Benutzername, nicht ERGO-Login |
| Web-App | `APP_AUTH_PASSWORD_HASH` | Format `scrypt:SALT_HEX:HASH_HEX`; nur mit dem lokalen Helper erzeugen |
| Planung | `BOOKING_RELEASE_LEAD_DAYS` | Bestätigte fachliche Konfiguration **1** |
| Späterer Worker | `PARKING_URL` | ERGO-Buchungsseite |
| Späterer Worker | `PARKING_USERNAME`, `PARKING_PASSWORD` | Ausschließlich beim Worker speichern |
| Späterer Worker | `PLAYWRIGHT_HEADLESS` | Chromium-Modus |
| Dry-run/Worker | `WORKER_ID` | Nicht geheime technische Kennung |

Keine dieser sensiblen Variablen als `NEXT_PUBLIC_*` anlegen. Ein Passwort darf weder als Kommandozeilenargument noch in Shell-History stehen. Das Hashformat verwendet bewusst Doppelpunkte statt Dollarzeichen, damit Next.js `.env.local` nicht als Variableninterpolation interpretiert.

## Lokale Einrichtung

Node.js **22 oder neuer** und npm; geprüft mit Node 24. PostgreSQL lokal oder als eigener externer Dienst bereitstellen. Es wurde in dieser Phase kein Dienst angelegt.

```bash
npm ci
```

Das Postinstall-Skript installiert Chromium nur außerhalb von Vercel (für bestehende lokale Tests). Die Web-App selbst benötigt es nicht. Kein Installationsskript ruft ERGO auf.

Eigenes Web-Passwort über eine versteckte Eingabe hashen:

```bash
python3 -c 'import getpass,sys; sys.stdout.write(getpass.getpass("Neues Web-Passwort: "))' | npm run --silent auth:hash
```

Nur den ausgegebenen Hash privat in `APP_AUTH_PASSWORD_HASH` übernehmen, niemals in Git oder Diagnoseprotokolle. Der Helper liest ausschließlich stdin. Es wurden für die Anwendung keine echten Login-Zugangsdaten erzeugt.

In `.env.local` DB, Auth und Terminregel konfigurieren. Für lokales PostgreSQL ohne TLS zusätzlich `DATABASE_SSL=disable`; für externe Datenbanken bleibt `verify-full`. Anschließend:

```bash
npm run db:migrate
npm run dev -- --hostname localhost --port 3001
```

Die Browseradresse muss zu `APP_AUTH_ORIGIN` passen. `npm run build` benötigt weder DB-Zugang noch Auth-/ERGO-Secrets. Ein lokaler Production-Start benötigt dagegen wie online HTTPS vor der Anwendung, da Secure-Cookies und HTTPS-Origin erzwungen werden. Ohne Auth-Konfiguration gelangt man nur zur Loginseite; ohne funktionierende DB/Auth-Migration ist keine Anmeldung möglich.

## PostgreSQL und Vercel

Die Anwendung verwendet Node.js-Runtime, keinen Edge-DB-Treiber. Ein wiederverwendeter Pool wird pro Prozess/Instanz erzeugt; lokal verhindert ein `globalThis`-Cache zusätzliche Pools bei Hot Reload. Auf Vercel übernimmt [`attachDatabasePool` aus `@vercel/functions`](https://vercel.com/kb/guide/connection-pooling-with-functions) den Lebenszyklus vor dem Pausieren einer Instanz. Idle-Timeout 5 Sekunden, Verbindungsaufbau 5 Sekunden, SQL-Timeout 10 Sekunden, maximale Verbindungslebensdauer 5 Minuten. Der Pool wird nicht nach jeder Anfrage geschlossen. CLI-Prozesse schließen ihn im `finally`.

Die drei Verbindungen gelten **pro Instanz**, nicht global. Deshalb für Vercel einen providerseitigen PostgreSQL-Pooler vorsehen, Verbindungsbudget und Region abstimmen und unter paralleler Last prüfen. Weder Anbieter noch Credentials sind fest eingebaut. PostgreSQL-Transaktionen benutzen immer denselben ausgeliehenen Client; bei Fehler folgt Rollback, bei defektem Rollback wird die Verbindung verworfen. Keine automatische Wiederholung von Schreiboperationen. Statement-/Transaktions-Timeouts begrenzen hängen gebliebene Operationen.

TLS ist standardmäßig an und prüft Zertifikate einschließlich Hostname. `rejectUnauthorized:false` wird nicht unterstützt. `sslmode`, `sslcert`, `sslkey`, `sslrootcert` und andere `ssl*`-URL-Parameter werden abgelehnt, weil sie laut [node-postgres](https://node-postgres.com/features/ssl) die explizite SSL-Konfiguration überschreiben können. Vom Anbieter mitgelieferte `sslmode`-Parameter deshalb entfernen und TLS über die dokumentierten Variablen konfigurieren. Private CAs über `DATABASE_SSL_CA` bereitstellen. Niemals die Zertifikatsprüfung zum Beheben eines Verbindungsfehlers abschalten.

### Migrationen und Systemstatus

`001_planned_bookings.sql` bleibt unverändert; `002_web_auth.sql` ergänzt `app_sessions` und `app_login_limits`. Migrationen laufen explizit, nicht beim Webstart oder Build, transaktional unter einer Advisory-Sperre. Bereits angewandte Dateien werden über SHA-256 kontrolliert und dürfen nicht verändert werden. Vor jeder neuen Migration:

```bash
npm run db:manifest
npm test
npm run db:migrate
```

Das versionierte `lib/db/migration-manifest.json` ermöglicht den Health-Check ohne Dateisystemabhängigkeit im Serverless-Bundle. Ein Test prüft die exakten SQL-Prüfsummen. Für Migrationen einen direkten DB-Endpunkt mit eigenem DDL-Benutzer verwenden; dazu `DATABASE_URL` im separaten Migrationsprozess passend setzen. Später getrennte Rollen für Web-App (Planung/Sessions/Limit sowie lesender Migrationsstatus), Worker und Migrationen. Der Web-Benutzer benötigt keine DDL-Rechte und keine Schreibrechte auf `booking_attempts`.

`GET /api/system/status` ist sessiongeschützt und zeigt nur: Web erreichbar, DB erreichbar/nicht erreichbar, Migrationen aktuell/nicht aktuell/nicht prüfbar, Worker inaktiv. Keine Hostnamen, Versionen, Checksummen oder Verbindungsdaten. Es wird kein Worker kontaktiert. **Bei DB-Ausfall kann schon die Sessionprüfung scheitern:** Dann bleibt der Statuszugriff gesperrt und die UI zeigt eine allgemeine Nichtverfügbarkeit. Das ist bewusst kein öffentliches Diagnose-Hintertürchen. Vollständige DB-Ausfälle müssen zusätzlich über private Infrastrukturüberwachung untersucht werden.

## Planung, Termine und Datenmodell

`planned_bookings` enthält ID, Parkdatum, Slot, Prioritäten, Fallback, Status, Ausführungszeit, ausgewählte Säule, Erstellungs-/Änderungs-/Start-/Endzeit, Versuchszähler, Fehler und Ergebnis. Planversion, gespeicherte Terminregel und `dry_run_completed_at` ergänzen das Modell. `booking_attempts` speichert Versuchs-ID, Planversion, Modus, Besitzer, eingefrorene Eingaben und Ergebnis. Keine Auth-Daten in Planungsantworten.

Die bestätigte Freigabe ist **Vortag 00:01 Uhr Europe/Berlin**, `BOOKING_RELEASE_LEAD_DAYS=1`:

- 29.09.2026 → 28.09.2026 00:01 Berlin (27.09.2026 22:01 UTC).
- 02.10.2026 → 01.10.2026 00:01 Berlin (30.09.2026 22:01 UTC).

`scheduledExecutionAt()` zieht Kalendertage ab und konvertiert anschließend die lokale Uhrzeit nach UTC, niemals pauschal 24 Stunden. Sommer-/Winterzeit, Schaltjahr und Jahreswechsel sind getestet. Vormittag: 07:00–12:30, Nachmittag: 13:00–15:00. Bereits vergangene Ausführungszeitpunkte werden abgelehnt. Änderungen an der Umgebung verschieben gespeicherte Pläne nicht stillschweigend.

Private Routen: `GET/POST /api/bookings`, `PATCH/DELETE /api/bookings/:id`. Eingaben sind strikt validiert, parametrisiert, auf 16 KiB begrenzt; kontrollierte Statusfelder sind keine Client-Eingaben. Änderungen funktionieren nur bei zukünftigem `planned`-Plan. Änderungen/Stornierung verlangen die Version; konkurrierende Aktionen liefern 409. Stornieren betrifft ausschließlich den Plan, niemals eine ERGO-Buchung.

Statusmodell: `planned → preparing → running → booked | failed | unknown`; vor Start `planned → cancelled`. Fehler und unbekannte Ergebnisse werden nicht automatisch neu gestartet. `booked` bleibt ohne belegtes ERGO-Erfolgssignal unzulässig. Constraints verhindern doppelte aktive Datum-/Slot-Pläne, doppelte Versuche pro Planversion/Modus und mehr als einen zukünftigen Live-Versuch pro Plan.

## Dry-run und späterer Worker

```bash
npm run worker:dry-run -- --once
```

Nur ein lokaler CLI-Prozess, **kein Browser-Endpunkt**. Ein Aufruf claimt höchstens einen fälligen Plan per Transaktion mit `FOR UPDATE SKIP LOCKED`, protokolliert vorgesehene Parameter und beendet die Simulation. Keine Auswahl einer real verfügbaren Säule, kein Playwright, kein ERGO, kein Scheduler. Der Plan bleibt danach `planned` mit ausdrücklichem Simulationshinweis; der Versuch wird `simulated`. Dieselbe Planversion wird nicht erneut simuliert. Abschließen ist idempotent und an den Besitzer gebunden. Ein Dry-run darf niemals `booked` werden.

Bei Absturz bleibt `preparing`/`running` bestehen. Vor einem produktiven 24/7-Worker fehlen sichere Wiederanlauf-/Übernahmeregeln, Überwachung und Zeitabgleich. Externe Exactly-once-Wirkung lässt sich nicht allein durch DB-Claims garantieren; ein unklarer Zustand nach einem echten Klick muss `unknown` bleiben und darf keinen Retry auslösen. PGlite testet SQL/Constraints, ersetzt aber keinen Mehrprozess-Claim-Test mit echtem PostgreSQL.

## Deployment-Vorbereitung – noch nicht ausgeführt

1. Eigene PostgreSQL-Datenbank, TLS, Pooler, Rollen, Backups und Region festlegen. Direkten Migrationszugang separat halten.
2. Eigene Web-Zugangsdaten einrichten. Produktions-/Preview-Umgebungen trennen; jede freigegebene Umgebung braucht ihre exakte `APP_AUTH_ORIGIN`. Keine pauschalen Preview-Wildcards. Für Preview möglichst getrennte DB/Anmeldung oder zusätzlichen Plattformschutz verwenden.
3. Migrationen mit einem kontrollierten Prozess ausführen; Manifest und Schema müssen übereinstimmen. Produktionsdaten vorher sichern.
4. Später Vercel-Projekt als Next.js/Node-Anwendung einrichten: `npm ci`, `npm run build`. Nur Web-/Planungsvariablen hinterlegen, **keine PARKING-Zugangsdaten**. Browserinstallation wird auf Vercel übersprungen.
5. Erst nach ausdrücklichem Deploymentauftrag veröffentlichen. Danach HTTPS/Secure-Cookie, Login/Logout, CSRF, Sessionablauf, private Routen, DB/TLS/Pooler, Migrationsstatus und Last-Limits prüfen. Der echte Worker bleibt weiterhin inaktiv.

Noch offen: echte Infrastrukturprüfung und Deployment-Freigabe, produktiver Worker, Wiederanlaufstrategie und ein eindeutig belegtes ERGO-Erfolgssignal. Authentifizierung ist implementiert, aber noch nicht gegen eine reale Vercel-/PostgreSQL-Installation getestet. Kein MFA/Passwortreset; bei Verlust des Web-Passworts Hash über den Betreiberzugang ersetzen.

## Tests und Git-Sicherheit

```bash
npm test
npm run build
npm audit
npm ls --depth=0
git diff --check
```

Tests verwenden synthetische Zugangsdaten, lokale PGlite-Datenbanken und Testdoubles. Die bestehenden Chromium-Tests arbeiten ausschließlich mit synthetischem HTML und blockieren das Netzwerk. Kein Test löst eine echte Reservierung oder ERGO-Sitzung aus. Kein Lint-Skript vorhanden.

`.gitignore` schützt `.env.local`, sonstige `.env*`, `.data`, Sessions, Diagnosen, Screenshots, Schlüssel, `node_modules` und `.next`. Einzige Ausnahme: die geprüfte, geheimnisfreie `.env.example`. Git-Ignore verhindert weder `git add -f` noch versehentliche Secrets in Quelltexten; vor Commit zusätzlich den tatsächlichen Index prüfen. Kein Auth-Hash, Session-Token oder echtes Login in Tests/Logs/README eintragen.

Die [Phase-2A-Sicherheitskorrekturen](docs/security-phase2a.md) dokumentieren die behobenen Advisories. [Bisherige Playwright-Diagnose und Buchungsmarker](docs/automation-background.md) bleiben als technische Referenz erhalten, erteilen aber keine Berechtigung zu einer Live-Aktion.
