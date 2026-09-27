> Historischer Stand zum Abschluss von Phase 2A. Die aktuelle Authentifizierung und Betriebsgrenzen stehen in der README.

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
