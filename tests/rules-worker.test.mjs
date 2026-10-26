import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve('extension');
fs.mkdirSync('test-results', {recursive:true});
const report = [];
const clone = v => v === undefined ? undefined : structuredClone(v);
async function test(name, fn) {
  try {await fn(); report.push({name,passed:true}); console.log('PASS',name);}
  catch(error) {report.push({name,passed:false,error:error.message}); console.error('FAIL',name,error); process.exitCode=1;}
}
const settle = async () => {for(let i=0;i<25;i++) await Promise.resolve();};
async function harness(saved={}) {
  let now = 1700000000000;
  let counter=0;
  const timers = new Map();
  const events={};
  const calls=[];
  let active=0,maxActive=0;
  const local = clone(saved.local || {});
  const session = clone(saved.session || {});
  const event = name => ({addListener(fn) {(events[name] ||= []).push(fn);}});
  function storage(target,area) {
    return {
      async get(keys) {return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,clone(target[k])]));},
      async set(values) {
        const changed={};
        for(const [key,value] of Object.entries(values)){changed[key]={oldValue:clone(target[key]),newValue:clone(value)};target[key]=clone(value);}
        for(const fn of events.change || [])fn(changed,area);
      },
      async remove(key) {const oldValue=clone(target[key]);delete target[key];for(const fn of events.change || [])fn({[key]:{oldValue}},area);}
    };
  }
  const fakeDate=class extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  const context=vm.createContext({console,URL,Response,Headers,AbortController,Intl,Date:fakeDate,structuredClone,crypto:globalThis.crypto,
    setTimeout(fn,delay=0){const id=++counter;timers.set(id,{fn,at:now+delay});return id;},
    clearTimeout(id){timers.delete(id);},
    chrome:{storage:{local:storage(local,'local'),session:storage(session,'session'),onChanged:event('change')},
      webRequest:{onSendHeaders:event('headers'),onCompleted:event('completed'),onHeadersReceived:event('responseHeaders')},
      tabs:{onRemoved:event('tabRemoved'),query:async()=>[],async sendMessage(tabId,message){
        if(message.type==='cancelLookup')return {ok:true};
        if(message.type!=='fetchCountry')throw new Error('Unexpected message');
        active++;maxActive=Math.max(maxActive,active);calls.push({handle:message.handle,time:now,authorization:message.authorization});
        try{const response=await context.response(message.handle,{});const data=await response.json().catch(()=>null);
          if(!response.ok)return{status:response.status,headers:Object.fromEntries(response.headers),errorCode:data?.errors?.[0]?.code};
          try{return{status:response.status,headers:Object.fromEntries(response.headers),...context.XRF.parseAccountDetails(data,message.handle)};}catch{return{status:response.status,headers:Object.fromEntries(response.headers),error:'unsupported-response'};}
        }finally{active--;}
      }},runtime:{onInstalled:event('install'),onMessage:event('message'),getURL:p=>'chrome-extension://fixture/'+p}},
    async fetch(url,options){
      active++;maxActive=Math.max(maxActive,active);
      const handle=JSON.parse(new URL(url).searchParams.get('variables')).screenName;
      calls.push({handle,time:now,headers:options.headers});
      try {return await context.response(handle,options);}finally{active--;}
    }
  });
  context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context));
  context.response=async handle=>new Response(JSON.stringify({data:{user_result_by_screen_name:{result:{
    core:{screen_name:handle},about_profile:{account_based_in:'India'}
  }}}}),{status:200,headers:{'content-type':'application/json'}});
  vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context);
  await settle();
  async function advance(ms=0){
    const end=now+ms;
    await settle();
    for(let turns=0;turns<10000;turns++){
      const next=[...timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next){now=end;await settle();return;}
      now=next[1].at;timers.delete(next[0]);next[1].fn();await settle();
    }
    throw new Error('Runaway timer loop');
  }
  const run=code=>vm.runInContext(code,context);
  async function connect(){for(const fn of events.headers)fn({tabId:1,requestHeaders:[{name:'authorization',value:'Bearer test-only-token'}]});await settle();}
  return {context,run,advance,connect,events,calls,local,session,get maxActive(){return maxActive;}};
}
await test('Fresh installs choose no regions; updates retain saved filters and limits',async()=>{
  const fresh=await harness();
  assert.equal(fresh.context.XRF.settings().blocked.length,0);
  assert.equal(fresh.context.XRF.settings().blockNewAccounts,true);
  for(const fn of fresh.events.install)fn();await settle();
  assert.deepEqual(fresh.local.settings.blocked,[]);
  const settings={enabled:false,blocked:['Europe'],expandRegions:false,blockNewAccounts:false};
  const guard={starts:[1699999999000],nextAt:1700000030000,until:1700000060000,reason:'Saved cooldown'};
  const existing=await harness({local:{settings,guard}});
  for(const fn of existing.events.install)fn();await settle();
  assert.deepEqual(existing.local.settings,settings);
  assert.deepEqual(existing.local.guard,guard);
});
await test('Region hierarchy: Africa, countries, subregions, aliases, and exact-only mode',async()=>{
  const h=await harness();const x=h.context.XRF;
  const c=x.settings({blocked:['India','Africa']});
  for(const label of ['India','Nigeria','South Africa','Northern Africa','Sub-Saharan Africa','Africa','Kenya','IN']) assert.equal(x.matches(label,c),true,label);
  for(const label of ['France','Asia','Indiana','Indian Ocean','Unknown',''])assert.equal(x.matches(label,c),false,label);
  assert.equal(x.matches('India',x.settings({blocked:['South Asia']})),true);
  assert.equal(x.matches('India',x.settings({blocked:['South Asia'],expandRegions:false})),false);
  assert.equal(x.matches('Northern Africa',x.settings({blocked:['Africa'],expandRegions:false})),false);
  assert.ok(x.members('Africa').length>50);
});
await test('Response parser rejects wrong author and changed schema; missing labels stay unknown',async()=>{
  const h=await harness();const x=h.context.XRF;
  assert.throws(()=>x.parseAccount({},'alice'));
  assert.throws(()=>x.parseAccount({data:{user_result_by_screen_name:{result:{core:{screen_name:'bob'},about_profile:{account_based_in:'India'}}}}},'alice'));
  assert.equal(x.parseAccount({data:{user_result_by_screen_name:{result:{core:{screen_name:'alice'},about_profile:{}}}}},'alice'),null);
});
await test('No credentials means no network request; observed Authorization stays session-only',async()=>{
  const h=await harness();const result=await h.run("lookup('alice',1)");assert.equal(result.location,null);assert.equal(h.calls.length,0);
  await h.connect();assert.ok(h.session.sessionHeaders);assert.equal(h.local.sessionHeaders,undefined);
  assert.ok(!JSON.stringify(h.local).includes('test-only-token'));
});
await test('Regression: native Authorization is forwarded verbatim, with exactly one Bearer prefix',async()=>{
  const h=await harness();await h.connect();const p=h.run("lookup('alice',1)");await h.advance(0);await p;
  assert.equal(h.calls[0].authorization,'Bearer test-only-token');
  assert.equal(h.session.sessionHeaders.authorization,'Bearer test-only-token');
});
await test('Regression: legacy double-prefixed session headers are discarded on startup',async()=>{
  const h=await harness({session:{sessionHeaders:{authorization:'Bearer Bearer old-token'}}});
  await h.run("lookup('alice',1)");assert.equal(h.calls.length,0);assert.equal(h.run('sessionHeaders'),null);
});
await test('Concurrent repeated authors share one lookup and use persisted cache',async()=>{
  const h=await harness();await h.connect();const a=h.run("lookup('alice',1)"),b=h.run("lookup('alice',2)");
  await h.advance(0);assert.equal((await a).location,'India');assert.equal((await b).location,'India');
  assert.equal(h.calls.length,1);await h.run("lookup('alice',1)");assert.equal(h.calls.length,1);
  const restarted=await harness(h);assert.equal((await restarted.run("lookup('alice',1)")).location,'India');assert.equal(restarted.calls.length,0);
});
await test('Global pacing: one active request, 30 seconds apart, at most 20 starts per 15 minutes',async()=>{
  const h=await harness();await h.connect();
  for(let i=0;i<20;i++){const p=h.run(`lookup('author${i}',1)`);await h.advance(i?30000:0);await p;}
  assert.equal(h.calls.length,20);assert.equal(h.maxActive,1);
  for(let i=1;i<h.calls.length;i++)assert.ok(h.calls[i].time-h.calls[i-1].time>=30000);
  const blocked=await h.run("lookup('author20',1)");assert.match(blocked.reason,/20 new accounts/);
  assert.equal(h.calls.length,20);assert.ok((await h.run("lookup('author0',1)")).cached);
  await h.advance(330001);const next=h.run("lookup('author20',1)");await h.advance(0);await next;assert.equal(h.calls.length,21);
});
await test('Success headers stop automatic traffic at the reserve and cache still works',async()=>{
  const h=await harness();await h.connect();
  h.context.response=async handle=>new Response(JSON.stringify({data:{user_result_by_screen_name:{result:{core:{screen_name:handle},about_profile:{account_based_in:'India'}}}}}),{status:200,headers:{'x-rate-limit-limit':'50','x-rate-limit-remaining':'10','x-rate-limit-reset':'1700000900'}});
  const p=h.run("lookup('alice',1)");await h.advance(0);await p;
  const blocked=await h.run("lookup('bob',1)");assert.match(blocked.reason,/preserve About-page capacity/);
  assert.equal(h.calls.length,1);assert.equal((await h.run("lookup('alice',1)")).location,'India');
  const restarted=await harness(h);await restarted.connect();await restarted.run("lookup('bob',1)");assert.equal(restarted.calls.length,0);
  await restarted.advance(900001);const next=restarted.run("lookup('bob',1)");await restarted.advance(0);await next;assert.equal(restarted.calls.length,1);
});
await test('Manual About visits update the shared reserve; delayed responses cannot add quota back',async()=>{
  const h=await harness();await h.connect();
  const fire=(remaining,reset='1700000900',statusCode=200)=>h.events.responseHeaders.forEach(fn=>fn({tabId:1,statusCode,responseHeaders:[{name:'x-rate-limit-limit',value:'50'},{name:'x-rate-limit-remaining',value:String(remaining)},{name:'x-rate-limit-reset',value:reset}]}));
  fire(9);await settle();fire(15);await settle();assert.equal(h.local.quota.remaining,9);
  await h.run("lookup('alice',1)");assert.equal(h.calls.length,0);
  fire(0,'1700000900',429);await settle();assert.match(h.local.guard.reason,/X rate limit/);
  fire(49,'1700000800');await settle();assert.equal(h.local.quota.remaining,0);
});
await test('Rate-limit reset survives worker restart and prevents retries',async()=>{
  const h=await harness();await h.connect();h.context.response=async()=>new Response('',{status:429,headers:{'retry-after':'120'}});
  const request=h.run("lookup('alice',1)");await h.advance(0);const result=await request;assert.ok(result.retryAt);
  await h.run("lookup('bob',1)");assert.equal(h.calls.length,1);
  const restarted=await harness(h);await restarted.run("lookup('bob',1)");await restarted.advance(10000);assert.equal(restarted.calls.length,0);
});
await test('A successful in-flight lookup cannot erase a concurrent native rate-limit warning',async()=>{
  const h=await harness();await h.connect();const base=h.context.response;let complete;
  h.context.response=handle=>new Promise(resolve=>{complete=()=>base(handle).then(resolve);});
  const pending=h.run("lookup('alice',1)");await h.advance(0);
  for(const fn of h.events.responseHeaders)fn({tabId:1,statusCode:429,responseHeaders:[{name:'retry-after',value:'120'}]});
  await settle();await complete();await settle();await pending;
  assert.match(h.run('capacity().reason'),/X rate limit/);
  assert.equal((await h.run("lookup('alice',1)")).location,'India');
  await h.run("lookup('bob',1)");assert.equal(h.calls.length,1);
});
await test('Authentication and malformed responses fail open with a cooldown',async()=>{
  for(const mode of ['auth','schema']){
    const h=await harness();await h.connect();h.context.response=async()=>mode==='auth'?new Response('',{status:403}):new Response('{}',{status:200});
    const p=h.run("lookup('alice',1)");await h.advance(0);const r=await p;assert.equal(r.location,null);assert.ok(r.retryAt);
    await h.run("lookup('bob',1)");assert.equal(h.calls.length,1);if(mode==='auth')assert.equal(h.session.sessionHeaders,undefined);
  }
});
await test('Queue remains capped, paused settings cancel queued work, invisible tabs do not fetch',async()=>{
  const h=await harness();await h.connect();
  const requests=Array.from({length:100},(_,i)=>h.run(`lookup('person${i}',1)`));await settle();
  assert.equal(h.run('queue.length'),60);
  await h.context.chrome.storage.local.set({settings:{enabled:false,blocked:['India']}});await h.advance(0);
  assert.equal(h.calls.length,0);await Promise.all(requests);assert.equal(h.run('jobs.size'),0);
  await h.context.chrome.storage.local.set({settings:{enabled:true,blocked:['India']}});
  h.run('visibility.set(1,false)');const p=h.run("lookup('invisible',1)");await h.advance(0);await p;assert.equal(h.calls.length,0);
});
await test('Cache expiry and 2,000-entry bound preserve freshness and memory limits',async()=>{
  const h=await harness();await h.connect();
  h.run("for(let i=0;i<2000;i++)cache.set('old'+i,{location:'France',expiresAt:Date.now()+100000})");
  const p=h.run("lookup('alice',1)");await h.advance(0);await p;assert.equal(h.run('cache.size'),2000);assert.equal(h.run("cache.has('old0')"),false);
  await h.advance(21600001);const p2=h.run("lookup('alice',1)");await h.advance(0);await p2;assert.equal(h.calls.length,2);
});
await test('Only successful native About-account responses refresh the endpoint',async()=>{
  const h=await harness();await h.connect();
  const fire=(tabId,statusCode)=>h.events.completed.forEach(fn=>fn({tabId,statusCode,url:'https://x.com/i/api/graphql/new-query-id-123/AboutAccountQuery?variables=x'}));
  fire(-1,200);fire(1,403);await settle();assert.equal(h.local.queryId,undefined);
  fire(1,200);await settle();assert.equal(h.local.queryId,'new-query-id-123');
});
await test('Age settings preserve regions and allow age-only filtering',async()=>{
  const h=await harness();const x=h.context.XRF;
  const c=x.settings({blocked:['India','Africa']});assert.equal(c.blockNewAccounts,true);assert.equal(c.blocked.join(','),'India,Africa');
  assert.equal(x.active(x.settings({blocked:[]})),true);
  assert.equal(x.active(x.settings({blocked:[],blockNewAccounts:false})),false);
  assert.equal(x.settings({blockNewAccounts:false}).blockNewAccounts,false);
});
await test('Three calendar months: exact anniversary, month ends, leap years and invalid dates',async()=>{
  const h=await harness();const x=h.context.XRF,c=x.settings({blocked:['India','Africa']});
  const createdAt=Date.parse('2026-07-25T12:00:00Z'),end=Date.parse('2026-10-25T12:00:00Z');
  assert.equal(x.matchReason({location:'France',createdAt},c,end-1),'age');
  assert.equal(x.matchReason({location:'France',createdAt},c,end),null);
  assert.equal(x.ageLimitAt(Date.parse('2026-01-31T12:00:00Z')),Date.parse('2026-04-30T12:00:00Z'));
  assert.equal(x.ageLimitAt(Date.parse('2023-11-30T12:00:00Z')),Date.parse('2024-02-29T12:00:00Z'));
  for(const value of [undefined,null,NaN,'2026-10-24',end+1000])assert.equal(x.matchReason({location:'France',createdAt:value},c,end),null);
  assert.equal(x.matchReason({location:'India',createdAt:null},c,end),'region');
  assert.equal(x.matchReason({location:null,createdAt},c,end-1),'age');
  assert.equal(x.matchReason({createdAt},x.settings({blockNewAccounts:false}),end-1),null);
});
await test('Creation date is parsed from the same response and absent or future dates stay unknown',async()=>{
  const h=await harness();const x=h.context.XRF,now=h.run('Date.now()');
  const response=date=>({data:{user_result_by_screen_name:{result:{core:{screen_name:'alice',created_at:date},about_profile:{account_based_in:'India'}}}}});
  assert.equal(x.parseAccountDetails(response(new Date(now-86400000).toISOString()),'alice').createdAt,now-86400000);
  for(const date of [undefined,'not a date',new Date(now+86400000).toISOString()]){
    const parsed=x.parseAccountDetails(response(date),'alice');assert.equal(parsed.createdAt,null);assert.equal(parsed.location,'India');
  }
});
await test('One lookup caches both region and age; old cache is not refetched for missing age',async()=>{
  const h=await harness();await h.connect();const createdAt=h.run('Date.now()')-86400000;
  h.context.response=async handle=>new Response(JSON.stringify({data:{user_result_by_screen_name:{result:{core:{screen_name:handle,created_at:new Date(createdAt).toISOString()},about_profile:{account_based_in:null}}}}}),{status:200});
  const pending=h.run("lookup('alice',1)");await h.advance(0);const result=await pending;
  assert.equal(result.createdAt,createdAt);assert.equal(result.location,null);assert.equal(h.context.XRF.matchReason(result,h.context.XRF.settings(),h.run('Date.now()')),'age');
  await h.run("lookup('alice',1)");assert.equal(h.calls.length,1);
  const restarted=await harness(h);assert.equal((await restarted.run("lookup('alice',1)")).createdAt,createdAt);assert.equal(restarted.calls.length,0);
  h.run("cache.set('legacy',{location:'France',expiresAt:Date.now()+3600000})");
  assert.equal((await h.run("lookup('legacy',1)")).createdAt,undefined);assert.equal(h.calls.length,1);
});
await test('Turning off the final rule cancels an in-flight check without a failure cooldown',async()=>{
  const h=await harness();await h.connect();h.context.response=()=>new Promise(()=>{});
  const pending=h.run("lookup('alice',1)");await h.advance(0);
  await h.context.chrome.storage.local.set({settings:{enabled:true,blocked:[],blockNewAccounts:false}});await settle();
  assert.equal((await pending).reason,'paused');assert.equal(h.run('guard.until'),0);assert.equal(h.run('guard.reason'),'');
});
fs.writeFileSync('test-results/rules-worker-results.json',JSON.stringify(report,null,2));
