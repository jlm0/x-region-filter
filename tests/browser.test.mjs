import {chromium} from 'playwright';
import {profile, executablePath, cleanup} from './support/browser.mjs';
import {readFile, writeFile, mkdir, mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve('extension');
const context = await chromium.launchPersistentContext(profile, {
  executablePath, channel: 'chromium', headless: true, viewport: {width: 1100, height: 850},
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
const results = [];
const errors = [];
async function check(name, fn) {
  const start = performance.now();
  try {await fn(); results.push({name, passed: true, milliseconds: Math.round(performance.now() - start)}); console.log('PASS', name);}
  catch (error) {results.push({name, passed:false, error: error.message}); console.log('FAIL', name, error.message); throw error;}
}
function row(id, author, {quote, reposter, linkless = false, text = 'A fixture post', nested} = {}) {
  const header = handle => `<div data-testid="User-Name"><a href="/${handle}">${handle}</a><a href="/${handle}/status/${id}"><time>now</time></a></div>`;
  const quoteHeader = quote ? (linkless ? `<div data-testid="User-Name"><span>@misleading</span><div dir="ltr">@${quote}</div></div>` : header(quote)) : '';
  return `<div data-testid="cellInnerDiv"><article data-testid="tweet" id="p${id}">
  ${reposter ? `<div data-testid="socialContext"><a href="/${reposter}">${reposter} reposted</a></div>` : ''}
  ${header(author)}<div data-testid="tweetText">${text}</div>
  ${quote ? `<div role="link" class="quote">${quoteHeader}<p>Quoted content</p>${nested ? header(nested) : ''}</div>` : ''}
  <button aria-label="Like">Like</button></article></div>`;
}
const fixture = rows => `<!doctype html><html lang="en"><head><style>
body{margin:0;background:#fff;color:#16202b;font:15px system-ui}main{width:600px;margin:auto;border:1px solid #ddd}
article{padding:14px;border-bottom:1px solid #ddd;min-height:180px}article a{color:#1d9bf0;text-decoration:none;margin-right:12px}
.quote{margin:8px;border:1px solid #ccc;padding:12px;border-radius:12px}button{margin-top:12px}
</style></head><body><main><h1>Controlled X-shaped fixture</h1><div id="feed">${rows}</div><div id="sentinel">More posts</div></main></body></html>`;
let worker;
const fixtureCalls=[];
const fixtureLabels={indian:'India',african:'Nigeria',europe:'France',unknown:null,asia:'Asia',delayed:'India',reposter:'South Africa',quoted:'Kenya',rotate1:'France',rotate2:'France',young:'France',youngunknown:null,invalidage:'France',aging:'France'};
try {
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  worker.on('console', message => {if (message.type() === 'error') errors.push(message.text());});
  const id = worker.url().split('/')[2];
  const popup = await context.newPage();
  popup.on('pageerror', error => errors.push(error.message));
  await popup.goto(`chrome-extension://${id}/popup/index.html`);
  await check('Fresh install has no selected regions and retains the age filter', async () => {
    await popup.locator('#settings:not([disabled])').waitFor();
    assert.equal(await popup.locator('#chips button').count(),0);
    assert.match(await popup.locator('#chips').innerText(),/No regions blocked/);
    assert.equal(await popup.locator('#expand').isChecked(), true);
    assert.equal(await popup.locator('#new-accounts').isChecked(), true);
  });
  // These regions are explicit test selections, not installation defaults.
  for(const label of ['India','Africa']) {
    await popup.locator('#place').fill(label);
    await popup.locator('#place').press('Enter');
  }
  await popup.evaluate(()=>saving);
  await popup.screenshot({path: path.resolve('test-results/popup.png'), fullPage: true});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await context.addCookies([{name:'ct0',value:'fixture-current-csrf',domain:'x.com',path:'/',secure:true}]);
  await context.route('https://x.com/**', async route => {
    if (route.request().resourceType() === 'document') return route.fulfill({contentType:'text/html', body:fixture('')});
    if(new URL(route.request().url()).pathname.endsWith('/AboutAccountQuery')){
      const handle=JSON.parse(new URL(route.request().url()).searchParams.get('variables')).screenName;
      const headers=route.request().headers();
      fixtureCalls.push({handle,time:Date.now(),authorization:headers.authorization,csrf:headers['x-csrf-token']});
      if(handle==='delayed')await new Promise(resolve=>setTimeout(resolve,350));
      let createdAt='Sat Dec 08 09:42:25 +0000 2018';
      if(['young','youngunknown'].includes(handle))createdAt=new Date(Date.now()-14*86400000).toISOString();
      if(handle==='invalidage')createdAt='not a valid date';
      if(handle==='aging'){const date=new Date(Date.now()+3000);date.setUTCMonth(date.getUTCMonth()-3);createdAt=date.toISOString();}
      return route.fulfill({contentType:'application/json',headers:{'x-rate-limit-limit':'50','x-rate-limit-remaining':String(49-fixtureCalls.length),'x-rate-limit-reset':String(Math.ceil(Date.now()/1000)+900)},body:JSON.stringify({data:{user_result_by_screen_name:{result:{
        __typename:'User',core:{screen_name:handle,created_at:createdAt},about_profile:{account_based_in:fixtureLabels[handle]??null}
      }}}})});
    }
    return route.fulfill({contentType:'application/json', body:'{}'});
  });
  // Deterministic X data. The real extension's worker, messaging, cache and DOM code still run.
  await worker.evaluate(async () => {
    await ready;
    sessionHeaders = {'x-csrf-token': 'stale-must-not-be-used', authorization: 'Bearer fixture-only'};
    guard = {starts:[], nextAt:0, until:0, reason:''};
    cache.clear();
    // Accelerate only the queue wait in this DOM/transport fixture. The fake-clock
    // worker suite separately proves the unchanged production 30-second/15-minute limits.
    globalThis.fixturePulse=setInterval(()=>{if(!running){guard.nextAt=0;clearTimeout(timer);timer=null;schedule();}},50);
  });
  await page.goto('https://x.com/home');
  const setFeed = html => page.locator('#feed').evaluate((el, markup) => {el.innerHTML = markup;}, html);
  const hidden = id => page.locator(`#p${id}[data-xrf-hidden="true"]`).waitFor({timeout:20000});
  await check('Direct blocked author and country-to-region membership', async () => {
    await setFeed(row(1,'indian')+row(2,'african')+row(3,'europe'));
    await hidden(1); await hidden(2);
    assert.equal(await page.locator('#p3').getAttribute('data-xrf-hidden'),null);
    assert.equal(await page.locator('#p1').evaluate(e=>Math.round(e.getBoundingClientRect().height)),28);
    assert.equal(await page.locator('#p1').evaluate(e=>e.inert),true);
    assert.equal(await page.locator('[data-testid="cellInnerDiv"]').count(),3);
  });
  await check('Unblocked author quoting blocked author hides entire item', async () => {
    await setFeed(row(4,'europe',{quote:'indian'})); await hidden(4);
  });
  await check('Repost: blocked original author and independently blocked reposter', async () => {
    await setFeed(row(5,'indian',{reposter:'europe'})+row(6,'europe',{reposter:'reposter'}));
    await hidden(5); await hidden(6);
  });
  await check('Linkless quote header uses actual handle, not display-name lookalike', async () => {
    await setFeed(row(7,'europe',{quote:'quoted',linkless:true})); await hidden(7);
  });
  await check('Nested rendered quote author and repost of quote are included', async () => {
    await setFeed(row(8,'europe',{quote:'europe',nested:'indian',reposter:'europe'})); await hidden(8);
  });
  await check('Plain mentions and unavailable labels stay visible', async () => {
    await setFeed(row(9,'unknown',{text:'Mention <a href="/indian">@indian</a>'})+row(10,'asia'));
    await page.waitForTimeout(4500);
    assert.equal(await page.locator('[data-xrf-hidden="true"]').count(),0);
  });
  await check('Recycled hidden row immediately recovers for an unblocked author', async () => {
    await setFeed(row(11,'indian')); await hidden(11);
    await page.locator('#p11').evaluate(el => {
      for (const a of el.querySelectorAll('[data-testid="User-Name"] a')) a.href=a.href.replace('indian','europe');
    });
    await page.waitForFunction(()=>!document.querySelector('#p11').hasAttribute('data-xrf-hidden'));
    assert.equal(await page.locator('#p11').evaluate(el=>el.inert),false);
    assert.equal(await page.locator('#p11').getAttribute('aria-hidden'),null);
  });
  await check('Delayed blocked-author response cannot hide a recycled row', async () => {
    await setFeed(row(12,'delayed'));
    await page.waitForTimeout(100);
    await page.locator('#p12').evaluate(el => {
      for (const a of el.querySelectorAll('[data-testid="User-Name"] a')) a.href=a.href.replace('delayed','europe');
    });
    await page.waitForTimeout(2200);
    assert.equal(await page.locator('#p12').getAttribute('data-xrf-hidden'),null);
  });
  await check('Leaving Home restores posts; returning reapplies without reload', async () => {
    await setFeed(row(13,'indian')); await hidden(13);
    await page.evaluate(()=>history.pushState({},'','/europe/status/13'));
    await page.waitForFunction(()=>!document.querySelector('#p13').hasAttribute('data-xrf-hidden'));
    await page.evaluate(()=>history.pushState({},'','/home'));
    await hidden(13);
  });
  await check('Toggle off restores all rows and toggle on reapplies', async () => {
    await popup.locator('#enabled').uncheck();
    await page.waitForFunction(()=>document.querySelectorAll('[data-xrf-hidden="true"]').length===0);
    await popup.locator('#enabled').check(); await hidden(13);
  });
  await check('Repeated authors use the cache, not repeated X requests', async () => {
    const before = fixtureCalls.length;
    await setFeed(Array.from({length:60},(_,i)=>row(100+i,'indian')).join(''));
    await page.waitForFunction(()=>document.querySelectorAll('[data-xrf-hidden="true"]').length===60);
    assert.equal(fixtureCalls.length,before);
  });
  await check('Removed rows and quote replacement do not preserve stale hiding', async () => {
    await setFeed(row(200,'europe',{quote:'indian'})); await hidden(200);
    await page.locator('#p200 .quote').evaluate(el=>el.remove());
    await page.waitForFunction(()=>!document.querySelector('#p200').hasAttribute('data-xrf-hidden'));
  });
  await check('Region expansion can be switched off without leaving stale filtering', async () => {
    await setFeed(row(201,'african')); await hidden(201);
    await popup.locator('#expand').uncheck();
    await page.waitForFunction(()=>!document.querySelector('#p201').hasAttribute('data-xrf-hidden'));
    await popup.locator('#expand').check(); await hidden(201);
  });
  await check('List feeds filter, while search and profiles remain readable', async () => {
    await page.evaluate(()=>history.pushState({},'','/i/lists/123'));
    await hidden(201);
    await page.evaluate(()=>history.pushState({},'','/search?q=test'));
    await page.waitForFunction(()=>!document.querySelector('#p201').hasAttribute('data-xrf-hidden'));
    await page.evaluate(()=>history.pushState({},'','/african'));
    assert.equal(await page.locator('#p201').getAttribute('data-xrf-hidden'),null);
    await page.evaluate(()=>history.pushState({},'','/home')); await hidden(201);
  });
  await setFeed(row(301,'europe')+row(302,'europe',{quote:'indian'})+row(303,'indian',{reposter:'europe'})+row(304,'unknown'));
  await hidden(302); await hidden(303);
  await check('Popup reports real feed counts and the latest successful account lookup',async()=>{
    await popup.locator('.activity').evaluate(el => {el.open = true;});
    await page.bringToFront();
    await popup.evaluate(()=>status());
    assert.match(await popup.locator('#feed-status').innerText(),/^2 posts hidden in this feed/);
    assert.match(await popup.locator('#last-lookup').innerText(),/^Last lookup: @/);
    assert.match(await popup.locator('#status').innerText(),/Connected/);
  });
  await page.screenshot({path:path.resolve('test-results/feed.png'),fullPage:true});
  await check('Regression: Authorization has one Bearer prefix and CSRF is read fresh from the tab', async () => {
    assert.ok(fixtureCalls.every(call=>call.authorization==='Bearer fixture-only'));
    assert.ok(fixtureCalls.every(call=>call.csrf==='fixture-current-csrf'));
    await context.addCookies([{name:'ct0',value:'fixture-rotated-csrf',domain:'x.com',path:'/',secure:true}]);
    await setFeed(row(401,'rotate1'));
    await page.waitForTimeout(2500);
    assert.equal(fixtureCalls.find(call=>call.handle==='rotate1')?.csrf,'fixture-rotated-csrf');
  });
  await check('Young authors hide regardless of region; invalid dates remain visible',async()=>{
    await setFeed(row(600,'young')+row(601,'youngunknown')+row(602,'invalidage'));
    await hidden(600);await hidden(601);await page.waitForTimeout(300);
    assert.equal(await page.locator('#p600').getAttribute('data-xrf-reason'),'age');
    assert.match(await page.locator('#p600').evaluate(el=>getComputedStyle(el,'::after').content),/under 3 months old/);
    assert.equal(await page.locator('#p602').getAttribute('data-xrf-hidden'),null);
    assert.equal(fixtureCalls.filter(call=>call.handle==='young').length,1);
    await page.screenshot({path:path.resolve('test-results/age-feed.png'),fullPage:true});
  });
  await check('Young quote authors, repost originals and reposters hide the whole item using the cache',async()=>{
    const before=fixtureCalls.length;
    await setFeed(row(603,'europe',{quote:'young',linkless:true})+row(604,'europe',{reposter:'young'})+row(605,'young',{reposter:'europe'}));
    await hidden(603);await hidden(604);await hidden(605);assert.equal(fixtureCalls.length,before);
  });
  await check('Age toggle restores young posts independently, and works with an empty region list',async()=>{
    await setFeed(row(606,'young')+row(607,'indian'));await hidden(606);await hidden(607);
    const before=fixtureCalls.length;
    await popup.locator('#new-accounts').uncheck();
    await page.waitForFunction(()=>!document.querySelector('#p606').hasAttribute('data-xrf-hidden'));await hidden(607);
    await popup.locator('#new-accounts').check();await hidden(606);
    await popup.getByRole('button',{name:'Remove India',exact:true}).click();
    await popup.getByRole('button',{name:'Remove Africa',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('#p607').hasAttribute('data-xrf-hidden'));await hidden(606);
    assert.equal(fixtureCalls.length,before);
    await popup.evaluate(()=>{config.blocked=['India','Africa'];save();});await hidden(607);
  });
  await check('An account reaching three months restores automatically without another lookup',async()=>{
    await setFeed(row(608,'aging'));await hidden(608);const before=fixtureCalls.length;
    await page.waitForFunction(()=>!document.querySelector('#p608').hasAttribute('data-xrf-hidden'),{},{timeout:7000});
    assert.equal(await page.locator('#p608').getAttribute('data-xrf-reason'),null);assert.equal(fixtureCalls.length,before);
  });
  await check('Legacy cached countries are retained without early age backfill requests',async()=>{
    await worker.evaluate(()=>cache.set('legacyage',{location:'France',expiresAt:Date.now()+3600000}));
    const before=fixtureCalls.length;await setFeed(row(609,'legacyage'));await page.waitForTimeout(300);
    assert.equal(fixtureCalls.length,before);assert.equal(await page.locator('#p609').getAttribute('data-xrf-hidden'),null);
  });
  const calls = fixtureCalls;
  await writeFile('test-results/browser-requests.json',JSON.stringify(calls,null,2));
  await check('Successful lookup headers reach the shared quota tracker', async () => {
    const quota=await worker.evaluate(()=>globalThis.fixtureQuota=quota);
    assert.equal(quota.limit,50);assert.equal(quota.remaining,49-calls.length);
  });
  await check('Reserve pauses unfamiliar accounts while cached blocked posts still hide', async () => {
    await worker.evaluate(async()=>{await observeQuota(new Headers({'x-rate-limit-limit':'50','x-rate-limit-remaining':'10','x-rate-limit-reset':String(Math.ceil(Date.now()/1000)+900)}));});
    const count=fixtureCalls.length;
    await setFeed(row(501,'indian')+row(502,'neverchecked'));
    await hidden(501);await page.waitForTimeout(300);
    assert.equal(fixtureCalls.length,count);
    assert.equal(await page.locator('#p502').getAttribute('data-xrf-hidden'),null);
    await page.bringToFront();await popup.evaluate(()=>status());
    assert.match(await popup.locator('#status').innerText(),/preserve About-page capacity/);
    assert.match(await popup.locator('#quota-status').innerText(),/10 of 50/);
  });
  await check('No extension page errors', async () => {assert.deepEqual(errors,[]);});
  console.log(JSON.stringify({passed:results.length,requests:calls.length}));
} finally {
  if(results.some(result=>!result.passed))console.log('DIAGNOSTIC',JSON.stringify({fixtureCalls,worker:await worker.evaluate(()=>({guard,cache:[...cache],running,pending:jobs.size,authorization:sessionHeaders?.authorization}))}));
  await writeFile('test-results/browser-results.json',JSON.stringify({results,errors},null,2));
  await context.close();
  await cleanup();
}
