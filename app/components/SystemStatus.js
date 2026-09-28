'use client';
import { useState, useEffect } from 'react';
export default function SystemStatus() {
  const [status, setStatus] = useState(null);
  const [message, setMessage] = useState('');
  async function load() {
    try {
      const response = await fetch('/api/system/status', { cache: 'no-store' });
      if (response.status === 401) { window.location.assign('/login'); return; }
      if (!response.ok) throw new Error();
      setStatus(await response.json()); setMessage('');
    } catch { setStatus(null); setMessage('Systemstatus nicht verfügbar. Datenbank oder Anmeldung prüfen.'); }
  }
  useEffect(() => { load(); }, []);
  async function logout() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error();
      window.location.assign('/login');
    } catch { setMessage('Abmeldung nicht bestätigt. Bitte erneut versuchen.'); }
  }
  return <section className="card planningCard" style={{ marginBottom: 20 }}><div className="planningHeading"><h2>Systemstatus</h2><div className="planningActions"><button className="secondaryButton" onClick={load}>Status prüfen</button><button className="secondaryButton" onClick={logout}>Abmelden</button></div></div>
    <p><strong>Echte Parkplatzbuchungen sind deaktiviert.</strong> Ein verbundener Worker führt ausschließlich Simulationen aus.</p>
    {status && <ul><li>Web-App: erreichbar</li><li>Datenbank: {status.database === 'reachable' ? 'erreichbar' : 'nicht erreichbar'}</li><li>Migrationen: {status.migrations === 'current' ? 'aktuell' : status.migrations === 'pending' ? 'nicht aktuell' : 'nicht prüfbar'}</li><li>Worker: {status.worker === 'dry-run' ? 'Dry Run aktiv' : status.worker === 'degraded' ? 'gestört' : status.worker === 'unavailable' ? 'Status nicht verfügbar' : 'nicht verbunden'}</li></ul>}
    {status?.workers?.map(worker => <div className="planningHint" key={worker.workerId}>
      <strong>{worker.workerId}: {worker.state === 'disconnected' ? 'nicht verbunden' : worker.state === 'degraded' ? 'gestört' : 'Dry Run aktiv'}</strong>
      <p>Modus: {worker.mode === 'live' ? 'Live gemeldet – in Phase 3A gesperrt' : 'Dry Run'} · Version: {worker.version}</p>
      <p>Letzter Heartbeat: {new Date(worker.lastHeartbeat).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} (Berlin)</p>
      {worker.lastSuccessfulJob && <p>Letzter abgeschlossener Dry Run: {worker.lastSuccessfulJob}</p>}
      {worker.lastError && <p>Hinweis: {worker.lastError}</p>}
    </div>)}
    {message && <p role="status">{message}</p>}</section>;
}
