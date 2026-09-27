'use client';
import { useState } from 'react';
export default function Login() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function login(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) });
      const result = await response.json();
      if (!response.ok) { setMessage(result.message || 'Anmeldung fehlgeschlagen.'); return; }
      window.location.assign('/');
    } catch { setMessage('Anmeldung vorübergehend nicht verfügbar.'); }
    finally { setBusy(false); }
  }
  return <main className="shell"><section className="card planningCard"><h1>Parkplatzbuchung</h1><h2>Anmelden</h2><p>Privater Zugang zur Planung. Verwende dein Web-App-Login, keine ERGO-Zugangsdaten.</p>
    <form onSubmit={login}><div className="formGrid"><label>Benutzername<input name="username" autoComplete="username" required maxLength={128}/></label><label>Passwort<input name="password" type="password" autoComplete="current-password" required maxLength={1024}/></label></div><button className="primaryButton" disabled={busy}>Anmelden</button></form>
    {message && <p className="planningHint" role="alert">{message}</p>}</section></main>;
}
