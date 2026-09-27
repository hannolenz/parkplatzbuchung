import ParkingCard from './components/ParkingCard';
import PlannedBookings from './components/PlannedBookings';
export default function Home() {
  return <main className="shell">
    <header className="hero"><div><p className="eyebrow">PRIVATE PARKPLATZBUCHUNG</p><h1>Parkplatzbuchung</h1><p className="lead">Parktage planen und Ergebnisse im Blick behalten.</p></div><div className="statusPill"><span/> Vorbereitungsphase</div></header>
    <PlannedBookings/>
    <details className="manualTools"><summary>Lokale manuelle Parkplatzaktionen</summary>
      <p>Die bestehenden Aktionen verwenden die ERGO-Seite. „Jetzt reservieren“ kann nach Bestätigung eine echte Reservierung auslösen.</p>
      <section className="grid single"><ParkingCard/></section>
    </details>
  </main>;
}
