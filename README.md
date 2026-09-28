# Parkplatzbuchung

Private Next.js-Webanwendung zur Planung von Parkplatzbuchungen. Technischer Name: `parkplatzbuchung`.

**Phase 3A bereitet einen dauerhaft laufenden, ausschließlich simulierenden Worker vor. Der bestehende Webbetrieb auf Vercel/Neon wurde vom Betreiber bestätigt; in Phase 3A wird nichts deployt oder produktiv migriert. Keine echte automatische Reservierung.** Die Oberfläche zeigt diesen Zustand ausdrücklich an. Geplante Buchungen lassen sich nach Anmeldung anlegen, ändern, stornieren und einsehen. Es gibt keinen Web-Endpunkt zum Starten des Workers.

## Architektur

```text
Browser → Next.js 16 / Login / Planung / Status → zentrale PostgreSQL-Datenbank
          später Vercel                            ↑
                                                  separater 24/7-Worker (Phase 3A: Dry Run)
                                                  Playwright + ERGO-Session erst in späterer Phase
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
| Dry-run/Worker | `WORKER_ID` | Pflicht: eindeutige nicht geheime technische Kennung |
| Dry-run/Worker | `WORKER_MODE` | Pflicht: exakt `dry-run`; `live` wird technisch abgewiesen |

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

`GET /api/system/status` ist sessiongeschützt und zeigt nur: Web erreichbar, DB erreichbar/nicht erreichbar, Migrationen aktuell/nicht aktuell/nicht prüfbar, Workerzustand einschließlich letzter Heartbeat, Modus, technische Version/Commit, letzter erfolgreich simulierter Auftrag und fest definierter Fehlercode. Keine DB-Hostnamen, Schema-Checksummen oder Verbindungsdaten. Der Status wird aus PostgreSQL gelesen; es gibt keinen Steuerungsaufruf an den Worker. **Bei DB-Ausfall kann schon die Sessionprüfung scheitern:** Dann bleibt der Statuszugriff gesperrt und die UI zeigt eine allgemeine Nichtverfügbarkeit. Das ist bewusst kein öffentliches Diagnose-Hintertürchen. Vollständige DB-Ausfälle müssen zusätzlich über private Infrastrukturüberwachung untersucht werden.

## Planung, Termine und Datenmodell

`planned_bookings` enthält ID, Parkdatum, Slot, Prioritäten, Fallback, Status, Ausführungszeit, ausgewählte Säule, Erstellungs-/Änderungs-/Start-/Endzeit, Versuchszähler, Fehler und Ergebnis. Planversion, gespeicherte Terminregel und `dry_run_completed_at` ergänzen das Modell. `booking_attempts` speichert Versuchs-ID, Planversion, Modus, Besitzer, eingefrorene Eingaben und Ergebnis. Keine Auth-Daten in Planungsantworten.

Die bestätigte Freigabe ist **Vortag 00:01 Uhr Europe/Berlin**, `BOOKING_RELEASE_LEAD_DAYS=1`:

- 29.09.2026 → 28.09.2026 00:01 Berlin (27.09.2026 22:01 UTC).
- 02.10.2026 → 01.10.2026 00:01 Berlin (30.09.2026 22:01 UTC).

`scheduledExecutionAt()` zieht Kalendertage ab und konvertiert anschließend die lokale Uhrzeit nach UTC, niemals pauschal 24 Stunden. Sommer-/Winterzeit, Schaltjahr und Jahreswechsel sind getestet. Vormittag: 07:00–12:30, Nachmittag: 13:00–15:00. Bereits vergangene Ausführungszeitpunkte werden abgelehnt. Änderungen an der Umgebung verschieben gespeicherte Pläne nicht stillschweigend.

Private Routen: `GET/POST /api/bookings`, `PATCH/DELETE /api/bookings/:id`. Eingaben sind strikt validiert, parametrisiert, auf 16 KiB begrenzt; kontrollierte Statusfelder sind keine Client-Eingaben. Änderungen funktionieren nur bei zukünftigem `planned`-Plan. Änderungen/Stornierung verlangen die Version; konkurrierende Aktionen liefern 409. Stornieren betrifft ausschließlich den Plan, niemals eine ERGO-Buchung.

Statusmodell: `planned → preparing → running → booked | failed | unknown`; vor Start `planned → cancelled`. Fehler und unbekannte Ergebnisse werden nicht automatisch neu gestartet. `booked` bleibt ohne belegtes ERGO-Erfolgssignal unzulässig. Constraints verhindern doppelte aktive Datum-/Slot-Pläne, doppelte Versuche pro Planversion/Modus und mehr als einen zukünftigen Live-Versuch pro Plan.

## Phase 3A: dauerhaft betreibbarer Dry-run-Worker

Der Worker benötigt **keine ERGO-Zugangsdaten und keinen Browser**. Seine Importkette enthält keinen Playwright-/ERGO-Adapter. `WORKER_MODE` muss ausdrücklich `dry-run` sein; fehlender Wert, `live` oder andere Werte beenden den CLI-Prozess bereits **vor dem DB-Zugriff**. Auch der bisherige Einmalbefehl erzwingt diese Prüfung. Das Setzen von `live` allein aktiviert keinerlei echte Ausführung. Die vorhandenen manuellen Web-Routen bleiben gesperrt.

Start mit bereits gesetzter Worker-Umgebung:

```bash
npm run worker:start
```

Einmalige Simulation, höchstens ein fälliger Auftrag:

```bash
npm run worker:dry-run -- --once
```

Die Worker-Skripte laden nicht mehr automatisch die lokale `.env.local` mit Web-/ERGO-Daten. Für eine explizite, separate lokale Testkonfiguration:

```bash
node --env-file=/pfad/zur/worker.env worker/run.mjs --once
```

**Diese Befehle wurden nicht gegen die produktive Datenbank ausgeführt.** Der vorhandene produktive Testplan für den 01.10.2026 wurde weder verändert noch geclaimt. Sobald später ein Worker mit produktiver DB startet, simuliert er alle fälligen, noch nicht simulierten Pläne. Vor diesem Start die Warteschlange prüfen.

### Zeitsteuerung und Neustart

- `scheduled_execution_at` bleibt der gespeicherte UTC-Zeitpunkt aus „Vortag 00:01 Europe/Berlin“. Keine neue Datumsrechnung im Worker und keine UTC-Subtraktion von 24 Stunden.
- PostgreSQL liefert die verbleibende Zeit bis zum nächsten fälligen Plan. Der Worker verwendet diese Differenz und monotone Laufzeitmessung, nicht die lokale VPS-Wanduhr.
- Ohne nahe Aufträge höchstens 30 Sekunden bis zur nächsten Abfrage. Für bekannte Termine wacht der Prozess spätestens fünf Sekunden vorher auf; im Nahbereich werden 25–250 Millisekunden gewartet. Gemessene DB-Roundtrip-Zeit wird konservativ abgezogen.
- Ein Claim ist erst zulässig, wenn die **Datenbankzeit** den Termin erreicht hat. Keine vorzeitige Simulation. Nach einem Neustart werden bereits fällige Pläne sofort geprüft; es wird nicht auf die nächste volle Minute gewartet.
- Neue oder kurzfristig vorverlegte Pläne können während einer langen Wartephase bis zu 30 Sekunden unentdeckt bleiben. Für den späteren kurzfristigen Integrationstest deshalb standardmäßig 60 Sekunden Vorlauf verwenden. Vorher bekannte Termine werden gezielt zeitnah bedient.
- Dies ist keine Echtzeitgarantie: Netzwerk, PostgreSQL-Cold-Start, Prozesslast und Ausfallzeiten verursachen Verzögerungen. Die tatsächliche Latenz muss auf dem späteren VPS gemessen werden. Vor Livebetrieb sind zusätzlich Browser-/Login-Vorbereitung und eine verbindliche Policy für stark verspätete Aufträge erforderlich. Dry Runs dürfen überfällige Pläne simulieren.

### Claims, Leases und Idempotenz

Ein Auftrag wird mit `FOR UPDATE SKIP LOCKED` atomar gesperrt, ein UUID-Attempt angelegt und der Plan auf `preparing` gesetzt. Verarbeitung erfolgt pro Prozess seriell, höchstens ein laufender Job. Die bisherigen eindeutigen Indizes bleiben bestehen: ein Versuch pro Planversion/Modus, ein aktiver Versuch pro Plan, höchstens ein zukünftiger Live-Versuch pro Plan.

Jeder Prozess hat zusätzlich zur stabilen `WORKER_ID` eine zufällige Instanz-ID. Zwei aktive Prozesse mit derselben Worker-ID werden abgewiesen; eine seit 60 Sekunden nicht mehr gemeldete Instanz darf ersetzt werden. Die alte Instanz verliert ihre Schreibberechtigung. Claims haben eine **120-Sekunden-Lease**; Heartbeats erneuern nur noch gültige Leases. Abgelaufene Claims können nicht durch einen verspäteten Prozess wiederbelebt werden. Start, kritischer Simulationsmarker und Abschluss prüfen Besitzer, Instanz, Lease und Status unter Transaktion erneut.

Erfolg der Simulation: Plan `planned` mit `dry_run_completed_at` und ausdrücklichem Ergebnistext; Attempt `simulated`, Phase `completed`. Ein Abschluss wird idempotent behandelt. Neustart allein erzeugt keinen weiteren Versuch derselben Planversion. Der letzte erfolgreiche Auftrag wird gemeinsam mit dem Simulationsabschluss in derselben Transaktion gespeichert. **Kein Dry Run schreibt `booked`.**

### Wiederanlauf und kritischer Punkt

| Situation | Zustand/Policy |
| --- | --- |
| A: nachweislich vor kritischem Punkt | `failed`, Retry grundsätzlich zulässig, aber ausschließlich explizit freigegeben |
| B: während/nach kritischem Punkt ohne eindeutigen Nachweis | `unknown`, kein automatischer und kein CLI-Retry; menschliche Prüfung |
| C: eindeutig bestätigter Erfolg | In Phase 3A nur `simulated`; später bei belegtem ERGO-Signal `booked` |
| D: eindeutig bestätigter Misserfolg ohne Reservierung | Reine zukünftige Policy erlaubt kontrollierten Retry; in Phase 3A kein Live-Nachweis und kein entsprechender Executor |

Die Entscheidung ist als reine Funktion getestet. Der Dry-run-Executor speichert vor dem simulierten kritischen Punkt die Phase `critical`; selbst eine unklare Bestätigung dieses DB-Schreibens kann daher keinen unbemerkten Retry erlauben. Es wird kein Reservierungsklick simuliert, indem eine Website bedient wird: die eigentliche Simulation ist eine leere lokale Funktion. Testfehler werden ausschließlich über Testdoubles injiziert.

Bei einem harten Absturz findet die nächste Bereinigung abgelaufene `preparing`/`running`-Attempts. Sie prüft höchstens alle 30 Sekunden bis zu 20 Einträge pro Lauf. Vor kritischem Punkt: `failed`, sonst `unknown`. Bestehende alte Attempts bekommen `legacy_unknown`; ihr unbekannter Ablauf wird niemals als sicherer Vor-Klick-Fehler interpretiert. Nur Dry-run-Claims werden automatisch klassifiziert, keine Live-Claims.

Retry wird nicht automatisch ausgelöst. Das lokale Admin-CLI akzeptiert nur `failed` + `before_critical` + `retry_eligible`, prüft die erwartete Planversion und erlaubt höchstens **drei Gesamtversuche**. Es erhöht die Version, erhält das alte Attempt-Journal und markiert den Plan dauerhaft als Dry-run-only. Beispiel mit bewusst einzusetzender UUID und aktueller Version:

```bash
npm run worker:admin -- retry-before-critical BOOKING_UUID PLAN_VERSION --confirm-dry-run
```

Der bestehende Index `one_live_attempt_per_booking` bleibt bewusst unverändert und erlaubt weiterhin höchstens einen Live-Attempt je Plan. Die reine zukünftige Live-Retry-Policy aktiviert daher noch keinen Live-Retry; eine sichere Umsetzung samt Schemaentscheidung gehört in Phase 3B.

Für `unknown`, alte ungeklärte Attempts und spätere echte Live-Fehler existiert kein Entsperr-Endpunkt. Keine direkten manuellen Statuskorrekturen auf Verdacht. Vor Livebetrieb muss die bestehende lokale Buchungsmarker-Logik zusätzlich angebunden und ein belastbarer ERGO-Erfolgsnachweis etabliert werden. DB-Idempotenz allein garantiert keine Exactly-once-Wirkung bei einem externen System.

### Heartbeat und geschützter Status

`worker_instances` speichert Worker-ID, Instanz, Modus, Version/Commit, Zustand, Startzeit, letzten Heartbeat, letzten abgeschlossenen Dry Run und ausschließlich feste Fehlercodes. Während längerer Operationen läuft ein unabhängiger Heartbeat alle 15 Sekunden; zusätzliche Statusaktualisierungen erneuern ihn ebenfalls. Nach 60 Sekunden ohne Meldung zeigt die Oberfläche „nicht verbunden“, bei aktuellen Fehlern „gestört“. Ein sauber gestoppter Worker ist nicht verbunden, behält aber seine letzte Erfolgsinformation.

Die bestehende **authentifizierte** Route `/api/system/status` liest diese Daten. Die UI zeigt Modus und letzten Heartbeat in Berlin an, ohne Start-/Reservierungsbutton. Ein eventuell als Live gemeldeter Datensatz wird in Phase 3A als nicht unterstützter/gestörter Zustand angezeigt, niemals als aktivierte echte Automatik. `automaticExecution` bleibt `false`. Fehlt die neue Tabelle, wird der Workerstatus als nicht verfügbar ausgegeben, nicht öffentlich diagnostiziert.

### Migration 003 und produktive Daten

`003_worker_runtime.sql` ergänzt ausschließlich Felder/Tabelle/Indizes/Schutztrigger; Migrationen 001/002 und vorhandene Pläne/Auth-Sessions bleiben erhalten. Neue Attempt-Felder: `execution_phase`, `lease_until`, `heartbeat_at`, `worker_instance_id`, `retry_eligible`. Neue Planfelder: `dry_run_only` und `dry_run_original_execution_at`.

Das Migrationsmanifest ist aktualisiert. Die Migration wurde nur in PGlite-Tests angewendet, **nicht auf Neon**. Reihenfolge für den später freigegebenen Rollout: Backup/Rechte prüfen → Migration 003 → aktualisierte Web-App → kontrollierter Workerstart. Die alte Web-App kann die zusätzlichen Spalten ignorieren; ihr älterer Health-Check zeigt bis zum Web-Update wegen des zusätzlichen Migrationsstands „nicht aktuell“. Alte Einmalworker dürfen beim Rollout nicht parallel weiterlaufen, weil sie noch keine Instanz-/Lease-Prüfung besitzen.

### Sicherer kurzfristiger Testauftrag

Nur lokales CLI mit Worker-DB-Zugang und expliziter Bestätigung, keine HTTP-Steuerung. Für einen **separaten unversuchten Testplan**:

```bash
npm run worker:admin -- make-due BOOKING_UUID PLAN_VERSION --confirm-dry-run 60
```

Der Aufruf prüft UUID, Version, `planned` und das Fehlen jedes bisherigen Attempts, speichert den ursprünglichen Termin und setzt die Fälligkeit auf DB-Zeit + 60 Sekunden (zulässig 0–300). `dry_run_only=true` ist danach durch DB-Trigger unumkehrbar; ein Live-Attempt und `booked` sind für diesen Plan gesperrt. Auch ein späterer Live-Worker muss diese Kennzeichnung beachten. Einen normalen Plan für einen echten Parktag nicht versehentlich als Testplan verwenden. Nach dem Test kann ein noch `planned`-Plan über die Web-App storniert werden.

Späterer Nachweis: Plan anlegen → UUID/Version prüfen → CLI-Testfreigabe → Heartbeat/Claim/Attempt/Simulation in Neon → Ergebnis/Workerstatus in Web-App. Keiner dieser Schritte wurde in Phase 3A produktiv ausgeführt.

### Linux-/systemd-Vorbereitung

Vorlagen: `deploy/worker.env.example` und `deploy/parkplatzbuchung-worker.service`. Noch kein VPS ausgewählt oder konfiguriert. Voraussetzungen: Linux mit systemd, Node >=22, dedizierter unprivilegierter Benutzer, Repo unter `/opt/parkplatzbuchung`, Node-Pfad prüfen. Installation für diesen Worker ohne Browserdownload:

```bash
npm ci --omit=dev --ignore-scripts
```

Separates Environment unter `/etc/parkplatzbuchung/worker.env`, root:root, Modus 0600; systemd liest es vor dem Benutzerwechsel. Benötigt werden `DATABASE_URL` (ohne verbotene `ssl*`-Parameter), `DATABASE_SSL=verify-full`, `WORKER_ID`, `WORKER_MODE=dry-run`. Optional Pool-Maximum 3, private CA und `WORKER_VERSION` mit tatsächlichem Git-Commit. **Keine PARKING-Zugangsdaten und keine APP_AUTH-Zugangsdaten.** Vercel erhält weiterhin keine Worker-/ERGO-Secrets.

Der Service verwendet `Restart=on-failure`, fünf Sekunden Neustartabstand und höchstens 30 Starts pro 300 Sekunden. Das überbrückt die 60-Sekunden-Sperre einer nach hartem Absturz noch frisch gemeldeten Worker-ID, ohne zuvor ins Startlimit zu laufen. Hinzu kommen SIGTERM und 45 Sekunden Stop-Frist sowie Dateisystem-/Benutzer-Isolation. SIGTERM/SIGINT unterbrechen Wartezeiten, verhindern neue Claims und lassen einen bereits kritischen Dry Run kontrolliert abschließen. Bei Signal vor dem kritischen Punkt wird der Claim sicher beendet; Datenbankverbindungen und Listener werden aufgeräumt. Bei SIGKILL/Stromausfall übernehmen Lease-Erkennung und die konservative Wiederanlaufpolicy. Fehlgeschlagene Zyklen verwenden einen Backoff von 1 bis maximal 30 Sekunden; sie wiederholen keinen gescheiterten Job automatisch.

Systemd-Unit erst auf dem späteren Zielhost prüfen und erst nach Freigabe installieren/starten. Noch offen: echte PostgreSQL-Mehrprozessprüfung (`SKIP LOCKED`/Instanzwechsel), Vercel-Neon-VPS-Gesamttest, Latenzmessung, Rollen/Rechte, NTP, Ressourcenlimits, Monitoring und systemd-Verifikation. PGlite serialisiert Transaktionen und ersetzt diese Betriebsprüfung nicht.

## Deployment-Vorbereitung – noch nicht ausgeführt

1. Eigene PostgreSQL-Datenbank, TLS, Pooler, Rollen, Backups und Region festlegen. Direkten Migrationszugang separat halten.
2. Eigene Web-Zugangsdaten einrichten. Produktions-/Preview-Umgebungen trennen; jede freigegebene Umgebung braucht ihre exakte `APP_AUTH_ORIGIN`. Keine pauschalen Preview-Wildcards. Für Preview möglichst getrennte DB/Anmeldung oder zusätzlichen Plattformschutz verwenden.
3. Migrationen mit einem kontrollierten Prozess ausführen; Manifest und Schema müssen übereinstimmen. Produktionsdaten vorher sichern.
4. Später Vercel-Projekt als Next.js/Node-Anwendung einrichten: `npm ci`, `npm run build`. Nur Web-/Planungsvariablen hinterlegen, **keine PARKING-Zugangsdaten**. Browserinstallation wird auf Vercel übersprungen.
5. Erst nach ausdrücklichem Deploymentauftrag veröffentlichen. Danach HTTPS/Secure-Cookie, Login/Logout, CSRF, Sessionablauf, private Routen, DB/TLS/Pooler, Migrationsstatus und Last-Limits prüfen. Der echte Worker bleibt weiterhin inaktiv.

Für die späteren Schritte bleiben reale Infrastruktur-/Rolloutprüfungen, produktive Live-Ausführung und ein eindeutig belegtes ERGO-Erfolgssignal offen. Die Dry-run-Wiederanlaufstrategie ist in Phase 3A implementiert. Authentifizierung ist implementiert, aber noch nicht gegen eine reale Vercel-/PostgreSQL-Installation getestet. Kein MFA/Passwortreset; bei Verlust des Web-Passworts Hash über den Betreiberzugang ersetzen.

## Tests und Git-Sicherheit

```bash
npm test
npm run build
npm audit
npm ls --depth=0
git diff --check
```

Tests verwenden synthetische Zugangsdaten, lokale PGlite-Datenbanken und Testdoubles. Die bestehenden Chromium-Tests arbeiten ausschließlich mit synthetischem HTML und blockieren das Netzwerk. Kein Test löst eine echte Reservierung oder ERGO-Sitzung aus. Kein Lint-Skript vorhanden.

`.gitignore` schützt `.env.local`, sonstige `.env*`, `.data`, Sessions, Diagnosen, Screenshots, Schlüssel, `node_modules` und `.next`. Ausnahmen sind ausschließlich die geprüften, geheimnisfreien `.env.example` und `deploy/worker.env.example`. Git-Ignore verhindert weder `git add -f` noch versehentliche Secrets in Quelltexten; vor Commit zusätzlich den tatsächlichen Index prüfen. Kein Auth-Hash, Session-Token oder echtes Login in Tests/Logs/README eintragen.

Die [Phase-2A-Sicherheitskorrekturen](docs/security-phase2a.md) dokumentieren die behobenen Advisories. [Bisherige Playwright-Diagnose und Buchungsmarker](docs/automation-background.md) bleiben als technische Referenz erhalten, erteilen aber keine Berechtigung zu einer Live-Aktion.
