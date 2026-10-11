import { ErgoReadError } from './domain.mjs';
export const ERGO_ORIGIN = 'https://duesseldorf.ergoladesaeulen.de';
export const READ_PATH = '/ergo/functions/process_return_reservations.php';
// Pure guard, no request function is exported. Every hop is checked before fetch.
export function assertReadRequest(rawUrl, method, fields = {}) {
  const block = () => { throw new ErgoReadError('ENDPOINT_BLOCKED'); };
  let url; try { url = new URL(rawUrl); } catch { block(); }
  if (url.origin !== ERGO_ORIGIN || url.username || url.password || url.hash || url.pathname.includes('%')) block();
  const keys = Object.keys(fields);
  if (method === 'GET') {
    if (keys.length) block();
    const allowed = { '/': [], '/wp-login.php': ['redirect_to'], '/ergo/data/config.json': ['nocache'] };
    if (!Object.hasOwn(allowed, url.pathname) || [...url.searchParams.keys()].some(k => !allowed[url.pathname].includes(k))) block();
    if (url.searchParams.getAll('redirect_to').length > 1 || url.searchParams.getAll('nocache').length > 1) block();
    if (url.searchParams.has('redirect_to')) {
      let target; try { target = new URL(url.searchParams.get('redirect_to'), ERGO_ORIGIN); } catch { block(); }
      if (target.href !== ERGO_ORIGIN + '/') block();
    }
    if (url.searchParams.has('nocache') && !/^\d{1,16}$/.test(url.searchParams.get('nocache'))) block();
  } else if (method === 'POST' && url.search === '') {
    if (url.pathname === READ_PATH) {
      if (keys.length !== 1 || keys[0] !== 'today' || !['true', 'false'].includes(fields.today)) block();
    } else if (url.pathname === '/wp-login.php') {
      const names = ['log', 'pwd', 'rememberme', 'wp-submit', 'redirect_to', 'testcookie'];
      if (keys.length !== names.length || keys.some(k => !names.includes(k) || typeof fields[k] !== 'string') || fields.redirect_to !== ERGO_ORIGIN + '/' || fields.testcookie !== '1' || fields.rememberme !== 'forever') block();
    } else block();
  } else block();
}
