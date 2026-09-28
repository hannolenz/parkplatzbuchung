'use client';
import { useEffect, useState } from 'react';
const initial = { parkingDate: '', slot: 'morning', priorities: '1181, 1183, 1185', allowFallback: true };
const statuses = { planned: 'Geplant', preparing: 'In Vorbereitung', running: 'In Bearbeitung', booked: 'Gebucht', failed: 'Fehlgeschlagen', unknown: 'Ergebnis unklar', cancelled: 'Storniert' };
const dateLabel = date => date ? date.split('-').reverse().join('.') : '–';
const instantLabel = value => value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' }).format(new Date(value)) + ' (Berlin)' : '–';
export default function PlannedBookings() {
  const [form, setForm] = useState(initial);
  const [editing, setEditing] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [configuration, setConfiguration] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  async function request(url, options) {
    const response = await fetch(url, { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Die Aktion konnte nicht abgeschlossen werden.');
    return data;
  }
  async function load() {
    const data = await request('/api/bookings');
    setBookings(data.bookings); setConfiguration(data.configuration);
  }
  useEffect(() => { load().catch(error => setMessage(error.message)).finally(() => setLoading(false)); }, []);
  function reset() { setForm(initial); setEditing(null); }
  async function save(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      const body = { parkingDate: form.parkingDate, slot: form.slot, stationPriorities: form.priorities.split(/[\s,;]+/).filter(Boolean), allowFallback: form.allowFallback,
        ...(editing ? { version: editing.version } : {}) };
      await request(editing ? `/api/bookings/${editing.id}` : '/api/bookings', { method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      reset(); await load(); setMessage('Plan gespeichert. Es wird keine echte Buchung ausgeführt.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  async function cancel(booking) {
    if (!window.confirm(`Plan für ${dateLabel(booking.parkingDate)} stornieren?`)) return;
    setBusy(true); setMessage('');
    try {
      await request(`/api/bookings/${booking.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: booking.version }) });
      if (editing?.id === booking.id) reset();
      await load(); setMessage('Plan storniert.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  const configured = configuration?.databaseConfigured && configuration?.schedulingConfigured;
  return <section className="card planningCard" aria-labelledby="planned-title">
    <div className="planningHeading"><div><p className="eyebrow">VORBEREITUNG · NUR SIMULATION</p><h2 id="planned-title">Geplante Buchungen</h2></div>
      <button type="button" className="secondaryButton" disabled={busy || loading} onClick={async () => { setLoading(true); try { await load(); setMessage(''); } catch (error) { setMessage(error.message); } finally { setLoading(false); } }}>Aktualisieren</button></div>
    <p>Parkdatum und Wünsche speichern. Der vorbereitete Worker simuliert die Ausführung; er reserviert keinen Parkplatz.</p>
    {configuration?.rule && <p className="planningHint">Ausführung: {configuration.rule.leadDays} Kalendertag(e) vor dem Parkdatum um 00:01 Uhr in Europe/Berlin.</p>}
    {configuration && !configured && <div className="planningHint" role="status">
      {!configuration.databaseConfigured && <p>Die PostgreSQL-Datenbank ist noch nicht eingerichtet.</p>}
      {!configuration.schedulingConfigured && <p>Die bestätigte Freigabe-Frist ist noch nicht konfiguriert. Bitte BOOKING_RELEASE_LEAD_DAYS=1 serverseitig einrichten.</p>}
      <p>Speichern ist erst nach Abschluss der Einrichtung möglich.</p>
    </div>}
    <form onSubmit={save}>
      <fieldset disabled={busy || !configured}>
        <legend>{editing ? 'Plan bearbeiten' : 'Neue Buchung planen'}</legend>
        <div className="formGrid">
          <label>Parkdatum<input required type="date" value={form.parkingDate} onChange={event => setForm({ ...form, parkingDate: event.target.value })}/></label>
          <label>Zeitslot<select value={form.slot} onChange={event => setForm({ ...form, slot: event.target.value })}>
            <option value="morning">Vormittag · 07:00–12:30 Uhr</option><option value="afternoon">Nachmittag · 13:00–15:00 Uhr</option>
          </select></label>
        </div>
        <label className="field">Säulen-Prioritäten<input value={form.priorities} onChange={event => setForm({ ...form, priorities: event.target.value })}/><small>In Wunschreihenfolge, durch Kommas getrennt.</small></label>
        <label className="checkRow"><input type="checkbox" checked={form.allowFallback} onChange={event => setForm({ ...form, allowFallback: event.target.checked })}/>Andere freie Säule erlauben</label>
        <div className="planningActions"><button className="primaryButton" type="submit">{editing ? 'Änderungen speichern' : 'Buchung speichern'}</button>{editing && <button className="secondaryButton" type="button" onClick={reset}>Bearbeitung abbrechen</button>}</div>
      </fieldset>
    </form>
    {message && <p className="planningHint" role="status">{message}</p>}
    {loading ? <p role="status">Pläne werden geladen …</p> : bookings.length === 0 ? <p>Noch keine geplanten Buchungen vorhanden.</p> :
      <div className="planningTableWrap"><table className="planningTable"><caption>Bis zu 200 zuletzt datierte Pläne</caption><thead><tr><th>Parkdatum / Slot</th><th>Ausführung</th><th>Prioritäten</th><th>Status</th><th>Säule / Ergebnis</th><th>Aktionen</th></tr></thead><tbody>
        {bookings.map(booking => <tr key={booking.id}>
          <td>{dateLabel(booking.parkingDate)}<br/>{booking.slot === 'morning' ? '07:00–12:30' : '13:00–15:00'}</td>
          <td>{instantLabel(booking.scheduledExecutionAt)}</td>
          <td>{booking.stationPriorities.join(' → ') || 'Beliebige freie Säule'}<br/><small>Fallback: {booking.allowFallback ? 'ja' : 'nein'}</small></td>
          <td>{statuses[booking.status]}{booking.dryRunOnly && <><br/><small>Dauerhaft nur Dry Run</small></>}{booking.dryRunCompletedAt && <><br/><small>Simulation abgeschlossen</small></>}<br/><small>Versuche: {booking.attemptCount}</small></td>
          <td>{booking.selectedStation || '–'}<br/>{booking.resultMessage || booking.lastError || 'Noch kein Ergebnis'}</td>
          <td><div className="planningRowActions">
            <button className="secondaryButton" disabled={busy || booking.status !== 'planned' || new Date(booking.scheduledExecutionAt) <= new Date()} onClick={() => { setEditing(booking); setForm({ parkingDate: booking.parkingDate, slot: booking.slot, priorities: booking.stationPriorities.join(', '), allowFallback: booking.allowFallback }); }}>Ändern</button>
            <button className="secondaryButton" disabled={busy || booking.status !== 'planned'} onClick={() => cancel(booking)}>Stornieren</button>
          </div></td>
        </tr>)}
      </tbody></table></div>}
  </section>;
}
