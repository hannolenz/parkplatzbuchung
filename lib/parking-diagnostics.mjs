import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { redactSecrets } from './parking-secrets.mjs';

const words = new Set('reservierung reservierungen reserviert reservieren erfolgreich erfolg bestätigt bestätigung gebucht buchung buchungen fehlgeschlagen fehler nicht keine kein bereits frei belegt verfügbar storniert stornieren heute morgen säule ladesäule parkplatz datum zeitslot uhr wurde ist wurde ihre für am bis von'.split(' '));

export function projectText(text, secrets = []) {
  const clean = redactSecrets(text, secrets).slice(0, 20000);
  // Only fixed vocabulary is persisted; no names, numbers, arbitrary text or URLs.
  return (clean.toLowerCase().match(/[\p{L}\p{N}_@./:+-]+/gu) || [])
    .slice(0, 1000).map(token => words.has(token) ? token : '[entfernt]').join(' ');
}

export async function captureDiagnostic(page, secrets, expectedOrigin) {
  const raw = await page.evaluate(() => ({
    text: document.body?.innerText || '',
    messages: [...document.querySelectorAll('[role="alert"], [role="status"], .notice, .error, .success')].slice(0, 20).map(el => el.innerText || ''),
    elements: Object.fromEntries(['form', 'select', 'option', 'button', 'input', 'table'].map(tag => [tag, document.querySelectorAll(tag).length])),
    selects: [...document.querySelectorAll('select')].slice(0, 10).map(el => ({ disabled: el.disabled, optionCount: el.options.length, selectedText: el.selectedOptions[0]?.textContent || '' }))
  }));
  const url = new URL(page.url());
  return {
    // Query, fragment and arbitrary path segments can contain tokens: never persist them.
    url: { sameOrigin: url.origin === expectedOrigin, loginPage: url.pathname.endsWith('/wp-login.php') },
    textProjection: projectText(raw.text, secrets),
    messages: raw.messages.map(text => projectText(text, secrets)),
    elements: raw.elements,
    selects: raw.selects.map(item => ({ ...item, selectedText: projectText(item.selectedText, secrets) }))
  };
}

export async function saveDiagnostic(directory, data) {
  const diagnostics = path.join(directory, 'diagnostics');
  await fs.mkdir(diagnostics, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  await fs.writeFile(path.join(diagnostics, `${id}.json`), JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), ...data }, null, 2), { flag: 'wx', mode: 0o600 });
  return id;
}
