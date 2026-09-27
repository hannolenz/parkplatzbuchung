import ParkingCard from './components/ParkingCard';
export default function Home() {
  return <main className="shell">
    <header className="hero"><div><p className="eyebrow">PRIVATE PARKPLATZBUCHUNG</p><h1>Parkplatzbuchung</h1><p className="lead">Parkdatum wählen, Verfügbarkeit prüfen und Ladesäule reservieren.</p></div><div className="statusPill"><span/> System bereit</div></header>
    <section className="sectionHead"><div><h2>Parkplatz-Automation</h2><p>ERGO-Ladesäule für den nächsten Parktag vorbereiten.</p></div></section>
    <section className="grid single"><ParkingCard/></section>
    <section className="activity card"><div><p className="eyebrow">MANUELLE BUCHUNG</p><h2>Verfügbarkeit zuerst</h2><p>Die Verfügbarkeitsprüfung wählt das gewünschte Parkdatum und liest die Säulenliste aus. „Jetzt reservieren“ löst nach deiner Bestätigung eine echte Reservierung aus.</p></div><div className="securityNote">Zugangsdaten bleiben in <code>.env.local</code>. Die gespeicherte Browser-Session liegt lokal in <code>.data</code>.</div></section>
  </main>;
}
