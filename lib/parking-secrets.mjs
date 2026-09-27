const REDACTED = '[entfernt]';
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Preserve the message itself. Known credentials/session values are removed
// before truncation so a clipped secret cannot survive as a prefix.
export function redactSecrets(value, secrets = []) {
  let text = String(value);
  const variants = new Set();
  for (const secret of secrets) {
    if (typeof secret !== 'string' || !secret) continue;
    variants.add(secret);
    try { variants.add(encodeURIComponent(secret)); } catch { /* Keep the raw value even for malformed Unicode. */ }
    variants.add(JSON.stringify(secret).slice(1, -1));
  }
  for (const secret of [...variants].sort((a, b) => b.length - a.length)) {
    text = text.replace(new RegExp(escapeRegExp(secret), 'gi'), REDACTED);
  }
  // Header-like lines may contain arbitrarily named cookie values.
  text = text.replace(/\b(?:set-cookie|cookie|cookies|authorization|proxy-authorization)\s*:\s*[^\r\n]+/gi, label => `${label.split(':')[0]}: ${REDACTED}`);
  text = text.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi, scheme => `${scheme.split(/\s/)[0]} ${REDACTED}`);
  // Named credentials/tokens in prose or JSON, including quoted multiword values.
  text = text.replace(/((?:["']?)(?:PARKING_USERNAME|PARKING_PASSWORD|password|passwd|passwort|username|benutzername|access[_-]?token|refresh[_-]?token|id[_-]?token|token|csrf(?:[_-]?token)?|nonce|api[_-]?key|secret|session(?:[_-]?id)?|sessionid|phpsessid|cookie)(?:["']?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;<>]+)/gi, (_, label) => `${label}${REDACTED}`);
  // URLs can carry credentials in userinfo, paths, queries or fragments.
  text = text.replace(/https?:\/\/[^\s<>"']+/gi, '[URL entfernt]');
  text = text.replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED);
  text = text.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED);
  text = text.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/g, REDACTED);
  text = text.replace(/\b[A-Za-z0-9_+/-]{32,}={0,2}/g, REDACTED);
  return text;
}

// Sensitive values stay in memory and are never included in diagnostics.
export async function collectDiagnosticSecrets(page, credentials = []) {
  const state = await page.context().storageState();
  const sessionValues = await page.evaluate(() => Object.values(sessionStorage));
  return [...credentials, ...state.cookies.map(cookie => cookie.value),
    ...state.origins.flatMap(origin => origin.localStorage.map(item => item.value)),
    ...sessionValues];
}
