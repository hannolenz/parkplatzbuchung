# Bestehender Automatisierungskern (Referenz)

Seit Phase 2B sind die manuellen ERGO-Routen der Web-App deaktiviert. Die folgende Dokumentation beschreibt den erhaltenen Kern und frühere Befunde; sie ist keine Freigabe für eine echte Reservierung.

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
