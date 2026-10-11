import { CookieJar } from 'tough-cookie';
import { load } from 'cheerio/slim';
import { ErgoReadError, resolveErgoDay, validateReadInput, decodeOccupancy, calculateAvailability } from './domain.mjs';
import { ERGO_ORIGIN, READ_PATH, assertReadRequest } from './policy.mjs';
const fail = code => { throw new ErgoReadError(code); };
const MAX_BODY = 2 * 1024 * 1024;
export function createErgoReader({ username, password }, { fetchImpl = globalThis.fetch, now = () => new Date(), timeoutMs = 15000 } = {}) {
  if (typeof username !== 'string' || !username || typeof password !== 'string' || !password || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('INVALID_CONFIG');
  const jar = new CookieJar(undefined, { prefixSecurity: 'strict' });
  let busy = false, closed = false, prepared = false;
  async function exclusive(fn) {
    if (closed) fail('CLIENT_CLOSED');
    if (busy) fail('CLIENT_BUSY');
    busy = true;
    try { return await fn(); }
    catch (error) {
      if (error?.code === 'SESSION_EXPIRED' || error?.code === 'LOGIN_FAILED') { prepared = false; await jar.removeAllCookies(); }
      if (error instanceof ErgoReadError) throw error;
      throw new ErgoReadError('READ_FAILED'); // Never attach raw errors, URLs, HTML, cookies or causes.
    } finally { busy = false; }
  }
  async function hop(url, method, fields) {
    assertReadRequest(url.href, method, fields);
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail('TLS_REQUIRED');
    const controller = new AbortController();
    let timer;
    const work = async () => {
      const headers = { Accept: 'application/json, text/html' };
      const cookie = await jar.getCookieString(url.href, { sameSiteContext: 'strict' });
      if (cookie) headers.Cookie = cookie;
      if (method === 'POST') Object.assign(headers, { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ERGO_ORIGIN, Referer: ERGO_ORIGIN + '/' });
      const response = await fetchImpl(url.href, { method, headers, redirect: 'manual', signal: controller.signal, ...(method === 'POST' ? { body: new URLSearchParams(fields).toString() } : {}) });
      try {
        if (response.redirected) fail('UNEXPECTED_REDIRECT');
        for (const cookie of response.headers.getSetCookie()) await jar.setCookie(cookie, url.href);
        const reader = response.body?.getReader(); let length = 0; const chunks = [];
        if (reader) {
          try { while (true) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > MAX_BODY) fail('RESPONSE_TOO_LARGE'); chunks.push(Buffer.from(value)); } }
          finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        return { status: response.status, location: response.headers.get('location'), type: response.headers.get('content-type') || '', text: Buffer.concat(chunks).toString('utf8'), url };
      } catch (error) { controller.abort(); throw error; }
    };
    try { return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ErgoReadError('HTTP_TIMEOUT')); }, timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }
  async function pageRequest(path, method = 'GET', fields = {}) {
    let url = new URL(path, ERGO_ORIGIN);
    for (let count = 0; count <= 4; count++) {
      const result = await hop(url, method, fields);
      if ([301, 302, 303, 307, 308].includes(result.status)) {
        if (!result.location || count === 4) fail('REDIRECT_LIMIT');
        if (method === 'POST' && [307, 308].includes(result.status)) fail('UNSAFE_REDIRECT');
        url = new URL(result.location, url);
        // Only normal login/root navigations; never redirect into API endpoints.
        if (!['/', '/wp-login.php'].includes(url.pathname)) fail('ENDPOINT_BLOCKED');
        method = 'GET'; fields = {};
      } else {
        if ([401, 403].includes(result.status)) fail('SESSION_EXPIRED');
        if (result.status !== 200) fail('HTTP_STATUS');
        if (!/^text\/html\b/i.test(result.type)) fail('INVALID_RESPONSE');
        return result;
      }
    }
  }
  const loggedIn = result => result.url.pathname === '/' && (() => { const $ = load(result.text); return !$('#user_login, #loginform').length && $('#saeulennr-select').length === 1 && $('#reservieren-button').length === 1; })();
  async function verify() {
    const result = await pageRequest('/');
    if (!loggedIn(result)) fail('SESSION_EXPIRED');
    return result;
  }
  async function jsonRequest(path, method, fields) {
    const result = await hop(new URL(path, ERGO_ORIGIN), method, fields);
    if ([301, 302, 303, 307, 308, 401, 403].includes(result.status) || /text\/html/i.test(result.type)) fail('SESSION_EXPIRED');
    if (result.status !== 200) fail('HTTP_STATUS');
    if (!/^application\/json\b/i.test(result.type)) fail('INVALID_RESPONSE');
    return result.text;
  }
  return Object.freeze({
    prepareSession: () => exclusive(async () => {
      let result = await pageRequest('/');
      if (!loggedIn(result)) {
        const $ = load(result.text), form = $('#loginform');
        if (form.length !== 1 || (form.attr('method') || '').toLowerCase() !== 'post') fail('UNSUPPORTED_LOGIN');
        const action = new URL(form.attr('action') || '', result.url);
        if (action.href !== ERGO_ORIGIN + '/wp-login.php') fail('ENDPOINT_BLOCKED');
        const fields = Object.create(null);
        for (const element of form.find('input[name], button[name]').toArray()) {
          const el = $(element), name = el.attr('name');
          if (el.is('[disabled]')) continue;
          if (!['log', 'pwd', 'rememberme', 'wp-submit', 'redirect_to', 'testcookie'].includes(name) || Object.hasOwn(fields, name)) fail('UNSUPPORTED_LOGIN');
          fields[name] = el.attr('value') || '';
        }
        if (!Object.hasOwn(fields, 'log') || !Object.hasOwn(fields, 'pwd')) fail('UNSUPPORTED_LOGIN');
        Object.assign(fields, { log: username, pwd: password, rememberme: 'forever' });
        result = await pageRequest(action.href, 'POST', fields);
        if (!loggedIn(result)) fail('LOGIN_FAILED');
      }
      prepared = true;
      return { sessionReady: true, mode: 'read-only' };
    }),
    checkSession: () => exclusive(async () => { await verify(); prepared = true; return { sessionReady: true, mode: 'read-only' }; }),
    inspectAvailability: input => exclusive(async () => {
      const valid = validateReadInput(input), day = resolveErgoDay(valid.date, now());
      if (!prepared) fail('SESSION_REQUIRED');
      await verify();
      let config;
      try { config = JSON.parse(await jsonRequest('/ergo/data/config.json?nocache=' + now().getTime(), 'GET', {})); }
      catch (error) { if (error instanceof ErgoReadError) throw error; fail('INVALID_RESPONSE'); }
      if (resolveErgoDay(valid.date, now()) !== day) fail('DAY_CHANGED');
      const occupancy = decodeOccupancy(await jsonRequest(READ_PATH, 'POST', { today: String(day) }));
      if (resolveErgoDay(valid.date, now()) !== day) fail('DAY_CHANGED');
      return calculateAvailability(config, occupancy, valid, day);
    }),
    close: () => exclusive(async () => { await jar.removeAllCookies(); username = ''; password = ''; closed = true; prepared = false; })
  });
}
