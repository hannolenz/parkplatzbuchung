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
    <p><strong>Automatische Ausführung ist noch nicht aktiviert.</strong> Gespeicherte Pläne lösen keine Reservierung aus.</p>
    {status && <ul><li>Web-App: erreichbar</li><li>Datenbank: {status.database === 'reachable' ? 'erreichbar' : 'nicht erreichbar'}</li><li>Migrationen: {status.migrations === 'current' ? 'aktuell' : status.migrations === 'pending' ? 'nicht aktuell' : 'nicht prüfbar'}</li><li>Worker: nicht aktiv</li></ul>}
    {message && <p role="status">{message}</p>}</section>;
}
