import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { trackReservationDialogs } from '../lib/parking-dialogs.mjs';
import { redactSecrets, collectDiagnosticSecrets } from '../lib/parking-secrets.mjs';
import { runReservationAttempt } from '../lib/parking-attempt.mjs';

function dialog(message, type = 'alert') {
  const calls = [];
  return { calls, type: () => type, message: () => message,
    accept: async () => { calls.push('accept'); }, dismiss: async () => { calls.push('dismiss'); } };
}
test('alert text is preserved and timestamped relative to reservation and click', async () => {
  const page = new EventEmitter();
  let clock = 100;
  const tracker = trackReservationDialogs(page, { now: () => clock, timestamp: () => '2026-09-27T12:00:00.000Z' });
  clock = 120;
  const before = dialog('Bitte wählen Sie einen Zeitslot.'); page.emit('dialog', before);
  clock = 130; tracker.markClickStarted();
  clock = 145;
  const alert = dialog('Die Startzeit liegt in der Vergangenheit.'); page.emit('dialog', alert);
  tracker.markClickFinished(); clock = 160;
  page.emit('dialog', dialog('Weitere Information.'));
  const entries = await tracker.snapshot();
  assert.deepEqual(entries.map(e => e.phase), ['before_click', 'click', 'after_click']);
  assert.deepEqual(entries.map(e => e.sinceClickMs), [null, 15, 30]);
  assert.equal(entries[1].sinceReservationStartMs, 45);
  assert.equal(entries[1].timestamp, '2026-09-27T12:00:00.000Z');
  assert.equal(entries[1].type, 'alert');
  assert.equal(entries[1].message, 'Die Startzeit liegt in der Vergangenheit.');
  assert.equal(entries[1].handled, true);
  assert.deepEqual(alert.calls, ['accept']);
  entries[1].message = 'changed copy';
  assert.notEqual((await tracker.snapshot())[1].message, 'changed copy');
  await tracker.dispose();
  assert.equal(page.listenerCount('dialog'), 0);
});
test('known credentials, cookies and storage values are removed; normal sentence remains', () => {
  const secrets = ['test-user', 'fake-Pa$$word!', 'cookie-value-123', 'storage-value-456'];
  const text = 'Buchung abgelehnt. test-user fake-Pa$$word! cookie-value-123 storage-value-456';
  const result = redactSecrets(text, secrets);
  assert.ok(result.startsWith('Buchung abgelehnt.'));
  for (const secret of secrets) assert.ok(!result.includes(secret));
  assert.ok(!redactSecrets(encodeURIComponent(secrets[1]), secrets).includes('Pa'));
});
test('unknown named tokens, headers, URLs and email addresses are redacted', () => {
  const cases = [
    ['Token=short-token;', 'short-token'],
    ['{"password":"two word password"}', 'two word password'],
    ['Cookie: arbitrary=abc; another=xyz', 'abc'],
    ['Authorization: Bearer bearer-secret', 'bearer-secret'],
    ['Bearer bearer-secret', 'bearer-secret'],
    ['sessionid=short-session', 'short-session'],
    ['https://example.invalid/path?secret=unknown#fragment', 'unknown'],
    ['someone@example.invalid', 'someone'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signaturevalue', 'eyJhbGci'],
    ['aabbccddeeff00112233445566778899', 'aabbccdd']
  ];
  for (const [text, sensitive] of cases) assert.ok(!redactSecrets(text).includes(sensitive));
  assert.equal(redactSecrets('Säule 1181 ist am 27.09.2026 von 13:00 bis 15:00 nicht verfügbar.'), 'Säule 1181 ist am 27.09.2026 von 13:00 bis 15:00 nicht verfügbar.');
});
test('no dialog is a valid empty diagnostic; pending close failures do not leak details', async () => {
  const page = new EventEmitter();
  const tracker = trackReservationDialogs(page);
  assert.deepEqual(await tracker.snapshot(), []);
  page.emit('dialog', { ...dialog('Hinweis'), accept: async () => { throw new Error('private-browser-data'); } });
  const data = await tracker.snapshot();
  assert.equal(data[0].handlingFailed, true);
  assert.ok(!JSON.stringify(data).includes('private-browser-data'));
  await tracker.dispose();
});
test('confirmation and prompt are dismissed without implicit additional consent', async () => {
  const page = new EventEmitter(); const tracker = trackReservationDialogs(page);
  for (const type of ['confirm', 'prompt', 'beforeunload']) {
    const item = dialog('Weiter?', type); page.emit('dialog', item); await tracker.snapshot();
    assert.deepEqual(item.calls, ['dismiss']);
  }
  await tracker.dispose();
});
test('session secrets are collected in memory for subsequent dialog redaction', async () => {
  const page = { context: () => ({ storageState: async () => ({ cookies: [{ value: 'cookie-secret' }], origins: [{ localStorage: [{ value: 'local-secret' }] }] }) }), evaluate: async () => ['session-secret'] };
  const secrets = await collectDiagnosticSecrets(page, ['credential-secret']);
  assert.deepEqual(secrets, ['credential-secret', 'cookie-secret', 'local-secret', 'session-secret']);
  const emitter = new EventEmitter(); const tracker = trackReservationDialogs(emitter);
  tracker.addSecrets(secrets);
  emitter.emit('dialog', dialog(secrets.join(' ')));
  const entries = await tracker.snapshot();
  for (const secret of secrets) assert.ok(!entries[0].message.includes(secret));
  await tracker.dispose();
});
test('even success-sounding dialog alone never turns a reservation attempt into ok:true', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'parking-dialog-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const page = new EventEmitter(); const tracker = trackReservationDialogs(page);
  const saved = [];
  const result = await runReservationAttempt({ directory,
    input: { date: '2026-09-27', slot: 'afternoon', expectedStation: '1181' },
    capture: async () => ({}),
    save: async data => { saved.push({ ...data, dialogs: await tracker.snapshot() }); return 'test-diagnostic'; },
    click: async () => { tracker.markClickStarted(); page.emit('dialog', dialog('Reservierung erfolgreich!')); tracker.markClickFinished(); },
    observe: async () => {}
  });
  assert.equal(result.ok, false); assert.equal(result.outcome, 'unknown');
  assert.equal(saved[1].dialogs[0].message, 'Reservierung erfolgreich!');
  await tracker.dispose();
});
test('real local Chromium alert is captured and closed without hanging or any reservation click', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    const tracker = trackReservationDialogs(page, { secrets: ['synthetic-cookie'] });
    tracker.markClickStarted();
    await page.evaluate(() => alert('Die Startzeit liegt in der Vergangenheit. Token=synthetic-cookie'));
    tracker.markClickFinished();
    const entries = await tracker.snapshot();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].type, 'alert');
    assert.ok(entries[0].message.includes('Die Startzeit liegt in der Vergangenheit.'));
    assert.ok(!entries[0].message.includes('synthetic-cookie'));
    assert.equal(entries[0].handled, true);
    assert.equal(await page.evaluate(() => confirm('Nur lokaler Test')), false);
    await tracker.dispose();
  } finally { await browser.close(); }
});
