import { redactSecrets } from './parking-secrets.mjs';

export function trackReservationDialogs(page, { secrets = [], now = () => performance.now(), timestamp = () => new Date().toISOString() } = {}) {
  const startedAt = now();
  let clickStartedAt = null;
  let phase = 'before_click';
  let sensitiveValues = [...secrets];
  const entries = [];
  const pending = new Set();

  const onDialog = dialog => {
    const receivedAt = now();
    const type = dialog.type();
    const entry = {
      type,
      message: '',
      timestamp: timestamp(),
      phase,
      sinceReservationStartMs: Math.max(0, Math.round(receivedAt - startedAt)),
      sinceClickMs: clickStartedAt === null ? null : Math.max(0, Math.round(receivedAt - clickStartedAt)),
      action: type === 'alert' ? 'accept' : 'dismiss',
      handled: false
    };
    try { entry.message = redactSecrets(dialog.message(), sensitiveValues).slice(0, 20000); }
    catch { entry.message = '[Dialogtext konnte nicht bereinigt werden]'; }
    entries.push(entry);
    // Alerts are acknowledged; confirmation/prompt dialogs are never consented
    // to implicitly. Handle immediately so Playwright actions can finish.
    const handling = (async () => {
      try {
        if (type === 'alert') await dialog.accept();
        else await dialog.dismiss();
        entry.handled = true;
      } catch {
        entry.handlingFailed = true;
        // A page may have closed; never persist raw browser exception messages.
      }
    })();
    pending.add(handling);
    void handling.then(() => pending.delete(handling));
  };
  page.on('dialog', onDialog);

  async function drain() {
    while (pending.size) await Promise.all([...pending]);
  }
  return {
    addSecrets(values) {
      sensitiveValues.push(...values);
      for (const entry of entries) entry.message = redactSecrets(entry.message, sensitiveValues);
    },
    markClickStarted() { clickStartedAt = now(); phase = 'click'; },
    markClickFinished() { phase = 'after_click'; },
    async snapshot() { await drain(); return entries.map(entry => ({ ...entry })); },
    async dispose() {
      page.off('dialog', onDialog);
      await drain();
      sensitiveValues = [];
    }
  };
}
