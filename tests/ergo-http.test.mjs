import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createErgoReader } from '../lib/ergo-http/client.mjs';
import { resolveErgoDay, assertAutomaticTomorrow, decodeOccupancy, calculateAvailability, intervalsOverlap } from '../lib/ergo-http/domain.mjs';
import { assertReadRequest, ERGO_ORIGIN as O, READ_PATH } from '../lib/ergo-http/policy.mjs';
import { createHttpPreviewService } from '../worker/http-preview-service.mjs';
const current = new Date('2026-10-11T10:00:00Z');
const input = { date: '2026-10-12', slot: 'afternoon', priorities: ['1181','1183','1185'], fallback: true };
const config = () => ({ saeulen: { '11': '1181', '12': '1183', '13': '1185', '14': '1199' }, zeiten: { startStunde: 7, endStunde: 15, maxLaengeMinuten: 600, slots: { slotsAllowed: true, slots: [[7,0,12,30],[13,0,15,0]] } }, morgenBuchen: true });
const occupancy = () => Object.assign({ user_id: 17 }, Object.fromEntries(['11','12','13','14'].map(k=>[k,{ reservations: [], isCharging: false }])));
const form = `<form id="loginform" method="post" action="${O}/wp-login.php"><input name="log"><input name="pwd" type="password"><input name="rememberme"><input name="wp-submit" value="Anmelden"><input name="redirect_to" value="${O}/"><input name="testcookie" value="1"></form><input id="user_login">`;
const home = '<select id="saeulennr-select"></select><button id="reservieren-button">RESERVIEREN</button>';
const html = (s, headers={}) => new Response(s,{status:200,headers:{'content-type':'text/html',...headers}});
const json = v => new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
function fixture({ hook, now=()=>current, timeoutMs=1000 }={}) {
  const calls=[];const state={ authenticated:false, badLogin:false, config:config(), occupancy:occupancy(), form };
  const fetchImpl=async (url, options)=>{
    const u=new URL(url);const fields=Object.fromEntries(new URLSearchParams(options.body));
    calls.push({url,options,fields});assert.equal(options.redirect,'manual');assert.equal(u.origin,O);
    const override=await hook?.(u,options,state,calls);if(override)return override;
    if(u.pathname==='/')return state.authenticated?html(home):new Response(null,{status:302,headers:{location:O+'/wp-login.php?redirect_to='+encodeURIComponent(O+'/')}});
    if(u.pathname==='/wp-login.php'&&options.method==='GET')return html(state.form,{'set-cookie':'wordpress_test_cookie=synthetic; Secure; HttpOnly; Path=/'});
    if(u.pathname==='/wp-login.php'&&options.method==='POST') {
      assert.equal(fields.log,'synthetic-user');assert.equal(fields.pwd,'synthetic-password');
      assert.match(options.headers.Cookie,/wordpress_test_cookie=synthetic/);
      if(state.badLogin)return html(form);
      state.authenticated=true;return new Response(null,{status:302,headers:{location:'/', 'set-cookie':'wordpress_logged_in_test=synthetic-session; Secure; HttpOnly; SameSite=Lax; Path=/'}});
    }
    assert.match(options.headers.Cookie,/wordpress_logged_in_test=synthetic-session/);
    if(u.pathname==='/ergo/data/config.json')return json(state.config);
    if(u.pathname===READ_PATH)return json(JSON.stringify(state.occupancy));
    throw Error('UNEXPECTED_SYNTHETIC_REQUEST');
  };
  return { calls,state,reader:createErgoReader({username:'synthetic-user',password:'synthetic-password'},{fetchImpl,now,timeoutMs}) };
}
for(const [name,date,instant,expected] of [
  ['today','2026-10-11','2026-10-11T10:00:00Z',true],['tomorrow','2026-10-12','2026-10-11T10:00:00Z',false],
  ['Berlin midnight','2026-10-12','2026-10-11T22:00:00Z',true],['before midnight','2026-10-12','2026-10-11T21:59:59Z',false],
  ['spring forward','2027-03-29','2027-03-28T01:30:00Z',false],['fall back first','2026-10-26','2026-10-25T00:30:00Z',false],['fall back second','2026-10-26','2026-10-25T01:30:00Z',false],
  ['year boundary','2027-01-01','2026-12-31T22:59:00Z',false],['leap day','2028-02-29','2028-02-28T12:00:00Z',false]
])test('HTTP calendar: '+name,()=>assert.equal(resolveErgoDay(date,new Date(instant),'Europe/Berlin'),expected));
test('HTTP calendar rejects invalid, past, distant dates and non-Berlin timezone',()=>{
 for(const date of ['2026-02-30','2026-10-10','2026-10-13'])assert.throws(()=>resolveErgoDay(date,current));
 assert.throws(()=>resolveErgoDay(input.date,current,'UTC'));assert.throws(()=>resolveErgoDay(input.date,new Date('invalid')));
 assert.equal(assertAutomaticTomorrow(input.date,current),false);assert.throws(()=>assertAutomaticTomorrow('2026-10-11',current),{code:'AUTOMATIC_REQUIRES_TOMORROW'});
});
for(const [name,a,b,result] of [
 ['touching start',[780,900],[600,780],false],['touching end',[780,900],[900,1000],false],['equal',[780,900],[780,900],true],
 ['contains',[780,900],[800,850],true],['contained',[780,900],[700,1000],true],['left',[780,900],[700,800],true],['right',[780,900],[880,1000],true],['disjoint',[780,900],[420,750],false]
])test('HTTP interval: '+name,()=>assert.equal(intervalsOverlap(a,b),result));
test('double JSON required; malformed data rejected',()=>{
 assert.deepEqual(decodeOccupancy(JSON.stringify(JSON.stringify(occupancy()))),occupancy());
 for(const value of ['bad',JSON.stringify(occupancy()),'"null"','"[]"'])assert.throws(()=>decodeOccupancy(value),{code:'INVALID_RESPONSE'});
});
test('priorities use dynamic display numbers, first free preferred, fallback and no selection',()=>{
 const c=config(),o=occupancy();o['11'].reservations=[[13,0,15,0,19]];
 assert.equal(calculateAvailability(c,o,input,false).suggested.number,'1183');
 o['12'].reservations=[[13,0,14,0,19]];o['13'].reservations=[[14,0,15,0,19]];
 assert.equal(calculateAvailability(c,o,input,false).suggested.number,'1199');
 assert.equal(calculateAvailability(c,o,{...input,fallback:false},false).suggested,null);
 o['14'].reservations=[[13,30,14,0,19]];assert.equal(calculateAvailability(c,o,input,false).suggested,null);
});
test('multiple intervals, morning slot and exact vehicle-change boundaries',()=>{
 const o=occupancy();o['11'].reservations=[[7,0,12,30,19],[15,0,16,0,20]];
 assert.equal(calculateAvailability(config(),o,input,false).suggested.number,'1181');
 assert.equal(calculateAvailability(config(),o,{...input,slot:'morning'},false).suggested.number,'1183');
});
test('isCharging true is conservatively excluded and IDs never leak',()=>{
 const o=occupancy();o['11'].isCharging=true;
 const result=calculateAvailability(config(),o,input,false);
 assert.equal(result.suggested.number,'1183');assert.equal(result.chargingExcluded,1);assert.equal(result.stations[0].reason,'CHARGING_UNVERIFIED');
 assert.ok(!JSON.stringify(result).includes('user_id'));assert.ok(!JSON.stringify(result).includes('reservations'));
});
test('invalid config/occupancy never makes a station free',()=>{
 const cases=[(c,o)=>delete o['11'],(c,o)=>o.extra={},(c,o)=>o.user_id='17',(c,o)=>o['11'].isCharging='false',
 (c,o)=>delete o['11'].isCharging,(c,o)=>o['11'].reservations=[[13,60,15,0,1]],(c,o)=>o['11'].reservations=[[15,0,13,0,1]],
 (c,o)=>o['11'].reservations=[[13,0,15,0,'secret']],(c,o)=>o['11'].reservations=[[13,0,15,0]],
 (c)=>c.saeulen['11']='personal text',(c)=>c.saeulen['11']='1183',(c)=>c.zeiten.slots.slots=[[13,0,15]],(c)=>c.zeiten.maxLaengeMinuten=1];
 for(const mutate of cases){const c=config(),o=occupancy();mutate(c,o);assert.throws(()=>calculateAvailability(c,o,input,false));}
 const c=config();c.morgenBuchen=false;assert.throws(()=>calculateAvailability(c,occupancy(),input,false),{code:'TOMORROW_DISABLED'});
 assert.throws(()=>calculateAvailability(config(),occupancy(),{...input,slot:'invalid'},false));
});
test('WordPress login, cookie session, fresh reads and safe outputs',async()=>{
 const f=fixture();assert.deepEqual(await f.reader.prepareSession(),{sessionReady:true,mode:'read-only'});
 assert.equal((await f.reader.inspectAvailability(input)).suggested.number,'1181');
 assert.deepEqual(f.calls.at(-1).fields,{today:'false'});await f.reader.checkSession();await f.reader.prepareSession();
 assert.equal(f.calls.filter(c=>c.options.method==='POST'&&c.url.endsWith('wp-login.php')).length,1);
 assert.deepEqual(Object.keys(f.reader).sort(),['checkSession','close','inspectAvailability','prepareSession']);
 await f.reader.close();await assert.rejects(f.reader.prepareSession(),{code:'CLIENT_CLOSED'});
});
test('failed login is not retried, errors have no secrets or raw cause',async()=>{
 const f=fixture();f.state.badLogin=true;
 await assert.rejects(f.reader.prepareSession(),e=>e.code==='LOGIN_FAILED'&&!JSON.stringify(e).includes('synthetic')&&!e.cause);
 assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);await f.reader.close();
});
test('unknown hidden login fields/nonce require review instead of omission',async()=>{
 const f=fixture();f.state.form=form.replace('</form>','<input name="_wpnonce" value="synthetic-token"></form>');
 await assert.rejects(f.reader.prepareSession(),{code:'UNSUPPORTED_LOGIN'});assert.ok(!f.calls.some(c=>c.options.method==='POST'));await f.reader.close();
});
test('expired session blocks availability without deadline login retries',async()=>{
 const f=fixture();await f.reader.prepareSession();f.state.authenticated=false;
 await assert.rejects(f.reader.inspectAvailability(input),{code:'SESSION_EXPIRED'});
 await assert.rejects(f.reader.inspectAvailability(input),{code:'SESSION_REQUIRED'});
 assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);await f.reader.prepareSession();await f.reader.close();
});
test('session expiry during JSON read fails safely',async()=>{
 const f=fixture({hook:u=>u.pathname===READ_PATH?html(form):null});await f.reader.prepareSession();
 await assert.rejects(f.reader.inspectAvailability(input),{code:'SESSION_EXPIRED'});await f.reader.close();
});
test('cookies respect path, Secure, domain and Max-Age deletion',async()=>{
 let round=0;const f=fixture({hook:(u,opts,state)=>{
  if(u.pathname==='/ergo/data/config.json'){
   round++;const h=new Headers({'content-type':'application/json'});
   if(round===1){h.append('set-cookie','narrow=only-api; Secure; Path=/ergo/functions');h.append('set-cookie','old=removed; Secure; Path=/');h.append('set-cookie','old=removed; Max-Age=0; Path=/');}
   return new Response(JSON.stringify(state.config),{headers:h});
  }
 }});
 await f.reader.prepareSession();await f.reader.inspectAvailability(input);
 const api=f.calls.find(c=>new URL(c.url).pathname===READ_PATH);assert.match(api.options.headers.Cookie,/narrow=only-api/);assert.doesNotMatch(api.options.headers.Cookie,/old=/);
 await f.reader.checkSession();assert.doesNotMatch(f.calls.at(-1).options.headers.Cookie,/narrow=/);await f.reader.close();
 const g=fixture({hook:u=>u.pathname==='/wp-login.php'?html(form,{'set-cookie':'bad=value; Domain=evil.example; Path=/'}):null});
 await assert.rejects(g.reader.prepareSession(),{code:'READ_FAILED'});await g.reader.close();
});
test('request policy blocks booking/cancellation, unknown paths, origins and fields',()=>{
 for(const p of ['/ergo/functions/process_add_reservation.php','/ergo/functions/process_cancel_reservation.php','/wp-admin/admin-ajax.php','/wp-login.php?action=logout','/ergo/functions/%70rocess_return_reservations.php'])
  for(const method of ['GET','POST','PUT','DELETE'])assert.throws(()=>assertReadRequest(O+p,method,{today:'true'}),{code:'ENDPOINT_BLOCKED'});
 for(const url of ['http://duesseldorf.ergoladesaeulen.de/','https://evil.example/','https://u:p@duesseldorf.ergoladesaeulen.de/',O+'/#token'])assert.throws(()=>assertReadRequest(url,'GET'));
 assert.throws(()=>assertReadRequest(O+READ_PATH,'POST',{today:'true',action:'book'}));assert.throws(()=>assertReadRequest(O+'/wp-login.php?redirect_to=https://evil.example','GET'));
 assertReadRequest(O+READ_PATH,'POST',{today:'true'});
});
test('malicious redirects never reach a writing or foreign endpoint',async()=>{
 for(const location of ['/ergo/functions/process_add_reservation.php','/ergo/functions/process_cancel_reservation.php','https://evil.example/','http://duesseldorf.ergoladesaeulen.de/','/wp-login.php?action=logout']){
  const f=fixture({hook:()=>new Response(null,{status:302,headers:{location}})});
  await assert.rejects(f.reader.prepareSession(),{code:'ENDPOINT_BLOCKED'});assert.equal(f.calls.length,1);await f.reader.close();
 }
});
test('redirect loop bounded, 303 handled and POST 307 never replays credentials',async()=>{
 const f=fixture({hook:()=>new Response(null,{status:302,headers:{location:'/'}})});await assert.rejects(f.reader.prepareSession(),{code:'REDIRECT_LIMIT'});assert.equal(f.calls.length,5);await f.reader.close();
 const g=fixture({hook:(u,opts)=>opts.method==='POST'?new Response(null,{status:307,headers:{location:'/wp-login.php'}}):null});
 await assert.rejects(g.reader.prepareSession(),{code:'UNSAFE_REDIRECT'});assert.equal(g.calls.filter(c=>c.options.method==='POST').length,1);await g.reader.close();
 const h=fixture({hook:(u,opts,state)=>{ if(u.pathname==='/wp-login.php'&&opts.method==='POST'){state.authenticated=true;return new Response(null,{status:303,headers:{location:'/', 'set-cookie':'wordpress_logged_in_test=synthetic-session; Secure; Path=/'}})} }});await h.reader.prepareSession();assert.equal(h.calls.at(-1).options.method,'GET');await h.reader.close();
});
test('invalid JSON, response status and size limit are sanitized',async()=>{
 for(const [response,code] of [[()=>new Response('synthetic-secret',{headers:{'content-type':'application/json'}}),'INVALID_RESPONSE'],[()=>new Response('synthetic-secret',{status:500}),'HTTP_STATUS'],[()=>new Response('x'.repeat(2*1024*1024+1)),'RESPONSE_TOO_LARGE']]){
  const f=fixture({hook:u=>u.pathname==='/ergo/data/config.json'?response():null});await f.reader.prepareSession();await assert.rejects(f.reader.inspectAvailability(input),{code});await f.reader.close();
 }
});
test('timeout covers stalled headers and stalled response body',async()=>{
 for(const body of [false,true]){
  const f=fixture({timeoutMs:20,hook:(_u,options)=>body?new Response(new ReadableStream({start(controller){options.signal.addEventListener('abort',()=>controller.error(new Error('synthetic-secret')))}}),{headers:{'content-type':'text/html'}}):new Promise(()=>{})});
  await assert.rejects(f.reader.prepareSession(),{code:'HTTP_TIMEOUT'});await f.reader.close();
 }
});
test('parallel client access fails rather than sharing mutable session concurrently',async()=>{
 let release;const f=fixture({hook:()=>new Promise(r=>release=r)});const first=f.reader.prepareSession();await new Promise(r=>setImmediate(r));
 await assert.rejects(f.reader.prepareSession(),{code:'CLIENT_BUSY'});release(new Response(null,{status:500}));await assert.rejects(first);await f.reader.close();
});
test('midnight change during preparation of read rejects stale day mapping',async()=>{
 let clock=new Date('2026-10-11T21:59:59Z');const f=fixture({now:()=>clock,hook:u=>{if(u.pathname==='/ergo/data/config.json')clock=new Date('2026-10-11T22:00:00Z')}});
 await f.reader.prepareSession();await assert.rejects(f.reader.inspectAvailability(input),{code:'DAY_CHANGED'});assert.ok(!f.calls.some(c=>new URL(c.url).pathname===READ_PATH));await f.reader.close();
});
test('midnight change during occupancy request rejects result',async()=>{
 let clock=new Date('2026-10-11T21:59:59Z');const f=fixture({now:()=>clock,hook:u=>{if(u.pathname===READ_PATH)clock=new Date('2026-10-11T22:00:00Z')}});
 await f.reader.prepareSession();await assert.rejects(f.reader.inspectAvailability(input),{code:'DAY_CHANGED'});await f.reader.close();
});
test('HTTP preview integrates with dry-run journal and never marks booked',async()=>{
 const f=fixture(),service=createHttpPreviewService(f.reader,{mode:'dry-run'});const events=[],logs=[];
 const plan={parkingDate:input.date,slot:input.slot,stationPriorities:input.priorities,allowFallback:input.fallback};
 const repo={claimDue:async()=>({bookingId:'synthetic',attemptId:'synthetic',input:plan}),start:async()=>events.push('start'),markSimulatedCritical:async()=>events.push('critical'),finishDryRun:async()=>events.push('simulated'),failDryRun:async()=>events.push('failed')};
 await service.prepareSession();const result=await service.runJob(repo,{log:v=>logs.push(v)});
 assert.equal(result.booked,false);assert.equal(result.selectedStation,'1181');assert.deepEqual(events,['start','critical','simulated']);assert.equal(logs[0].selectedStation,'1181');
 assert.ok(f.calls.every(c=>!c.url.includes('add_reservation')&&!c.url.includes('cancel_reservation')));await f.reader.close();
 assert.throws(()=>createHttpPreviewService({}, {mode:'live'}));
});
test('HTTP preview live CLI stops before network or database use',()=>{
 const result=spawnSync(process.execPath,['worker/http-preview.mjs',input.date,input.slot,'1181','true'],{env:{PATH:process.env.PATH,WORKER_MODE:'live',WORKER_ID:'synthetic'},encoding:'utf8',timeout:10000});
 assert.equal(result.status,1);assert.match(result.stderr,/Keine Buchung/);
});

test('TLS bypass configuration rejected; TLS failures never expose raw details',async()=>{
 const original=process.env.NODE_TLS_REJECT_UNAUTHORIZED;
 try { process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';assert.throws(()=>fixture(),{code:'INVALID_CONFIG'}); }
 finally { if(original===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=original; }
 const f=fixture({hook:()=>{throw new Error('CERTIFICATE synthetic-password synthetic-cookie')}});
 await assert.rejects(f.reader.prepareSession(),e=>e.code==='READ_FAILED'&&!String(e).includes('synthetic')&&!e.cause);await f.reader.close();
});
test('all charging states excluded; no fallback cannot choose a non-priority station',()=>{
 const o=occupancy();for(const v of Object.values(o))if(v&&typeof v==='object')v.isCharging=true;
 assert.equal(calculateAvailability(config(),o,input,false).suggested,null);
 assert.equal(calculateAvailability(config(),occupancy(),{...input,priorities:[],fallback:false},false).suggested,null);
});
test('inspection failure stays before critical simulation and does not produce booked',async()=>{
 const events=[];const service=createHttpPreviewService({inspectAvailability:async()=>{throw Error('synthetic-secret')}},{mode:'dry-run'});
 const repo={claimDue:async()=>({input:{},bookingId:'test'}),start:async()=>events.push('start'),markSimulatedCritical:async()=>events.push('critical'),finishDryRun:async()=>events.push('finish'),failDryRun:async()=>events.push('failed')};
 await assert.rejects(service.runJob(repo,{log:()=>{}}),{message:'DRY_RUN_FAILED'});assert.deepEqual(events,['start','failed']);
});
