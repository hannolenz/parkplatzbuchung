import SystemStatus from './components/SystemStatus';
import { requirePageSession } from '@/lib/auth/page.mjs';
export const dynamic = 'force-dynamic';
import PlannedBookings from './components/PlannedBookings';
export default async function Home() {
  await requirePageSession();
  return <main className="shell">
    <header className="hero"><div><p className="eyebrow">PRIVATE PARKPLATZBUCHUNG</p><h1>Parkplatzbuchung</h1><p className="lead">Parktage planen und Ergebnisse im Blick behalten.</p></div><div className="statusPill"><span/> Vorbereitungsphase</div></header>
    <SystemStatus/>
    <PlannedBookings/>

  </main>;
}
