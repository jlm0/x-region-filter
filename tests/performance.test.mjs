import {chromium} from 'playwright';
import {profile, executablePath, cleanup} from './support/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const keyPath=path.join(profile,'key.pem'),certPath=path.join(profile,'cert.pem');
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyPath,'-out',certPath,'-days','1','-subj','/CN=x.com'],{stdio:'ignore'});
const server=https.createServer({key:fs.readFileSync(keyPath),cert:fs.readFileSync(certPath)},(req,res)=>{
  res.writeHead(200,{'content-type':'application/json','access-control-allow-origin':'https://x.com','access-control-allow-headers':'x-csrf-token,authorization','access-control-allow-methods':'GET,OPTIONS'});
  res.end('{}');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const root=path.resolve('extension');
const context=await chromium.launchPersistentContext(profile,{
  executablePath, channel: 'chromium',
  headless:true,ignoreHTTPSErrors:true,viewport:{width:1100,height:850},
  args:[`--load-extension=${root}`,`--disable-extensions-except=${root}`,'--host-resolver-rules=MAP x.com 127.0.0.1']
});
const result={};
try{
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{await ready;sessionHeaders=null;await chrome.storage.session.remove('sessionHeaders');});
  const page=await context.newPage();
  await context.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><main><div id="feed"></div></main><style>article{height:150px;border:1px solid gray}main{width:600px;margin:auto}</style>`}));
  await page.goto(`https://x.com:${port}/home`);
  await page.evaluate(async port=>{
    await fetch(`https://x.com:${port}/i/api/graphql/nativefixture123/TestQuery`,{headers:{authorization:'Bearer native-fixture-authorization','x-csrf-token':'native-fixture-csrf'}});
  },port);
  await worker.waitForFunction?.(()=>!!sessionHeaders);
  for(let tries=0;tries<30;tries++){
    if(await worker.evaluate(()=>sessionHeaders?.authorization==='Bearer native-fixture-authorization'))break;
    await page.waitForTimeout(50);
  }
  result.nativeHeaderCapture=await worker.evaluate(()=>sessionHeaders?.authorization==='Bearer native-fixture-authorization'&&!sessionHeaders['x-csrf-token']);
  assert.equal(result.nativeHeaderCapture,true,'Native onSendHeaders must capture Authorization verbatim without persisting CSRF or patching X networking.');
  result.noPersistentCredential=await worker.evaluate(async()=>!JSON.stringify(await chrome.storage.local.get(null)).includes('native-fixture-'));
  assert.equal(result.noPersistentCredential,true);
  let lookupRequests=0;
  page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/AboutAccountQuery'))lookupRequests++;});
  await page.goto('https://x.com/home');
  await worker.evaluate(async()=>{
    cache.clear();
    cache.set('blocked',{location:'India',createdAt:Date.now()-365*86400000,expiresAt:Date.now()+21600000});
    cache.set('allowed',{location:'France',createdAt:Date.now()-365*86400000,expiresAt:Date.now()+21600000});
    cache.set('young',{location:'France',createdAt:Date.now()-7*86400000,expiresAt:Date.now()+21600000});
    await chrome.storage.local.set({cache:[...cache]});
  });
  const cdp=await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  await page.evaluate(()=>{
    window.longTasks=[];
    new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(x=>x.duration))).observe({type:'longtask'});
  });
  async function run(enabled,iterations=100){
    await worker.evaluate(async enabled=>{await chrome.storage.local.set({settings:{enabled,blocked:['India','Africa'],expandRegions:true}});},enabled);
    await page.waitForTimeout(100);
    await cdp.send('HeapProfiler.collectGarbage');
    const before=await metrics();
    const frameTimes=await page.evaluate(async iterations=>{
      window.longTasks=[];
      const feed=document.querySelector('#feed');
      const frames=[];
      let previous=performance.now();
      for(let batch=0;batch<iterations;batch++){
        await new Promise(requestAnimationFrame);
        const now=performance.now();frames.push(now-previous);previous=now;
        feed.innerHTML=Array.from({length:40},(_,i)=>{
          const who=['allowed','blocked','allowed','young'][i%4];const post=batch*40+i;
          return `<div data-testid="cellInnerDiv"><article data-testid="tweet"><div data-testid="User-Name"><a href="/${who}">${who}</a><a href="/${who}/status/${post}"><time>Now</time></a></div><div data-testid="tweetText">Fixture ${post}</div><button>Like</button></article></div>`;
        }).join('');
        window.scrollTo(0,batch%2?1500:0);
      }
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      return frames.slice(5).sort((a,b)=>a-b);
    },iterations);
    await page.waitForTimeout(150);
    await cdp.send('HeapProfiler.collectGarbage');
    const after=await metrics();
    return {renderedPosts:40*iterations,mountedRows:await page.locator('article').count(),
      hiddenRows:await page.locator('[data-xrf-hidden="true"]').count(),
      taskTimeMs:Math.round((after.TaskDuration-before.TaskDuration)*1000),
      layoutTimeMs:Math.round((after.LayoutDuration-before.LayoutDuration)*1000),
      heapAfterBytes:after.JSHeapUsedSize,heapGrowthBytes:after.JSHeapUsedSize-before.JSHeapUsedSize,
      p95FrameIntervalMs:Math.round(frameTimes[Math.floor(frameTimes.length*.95)]*10)/10,
      longTasks:await page.evaluate(()=>window.longTasks),
      listeners:after.JSEventListeners};
  }
  result.disabled=await run(false);
  result.enabled=await run(true);
  result.enabledRepeat=await run(true);
  result.requestsForCachedAuthors=lookupRequests;
  assert.equal(result.requestsForCachedAuthors,0);
  assert.equal(result.enabledRepeat.mountedRows,40);
  assert.equal(result.enabledRepeat.hiddenRows,20);
  assert.ok(result.enabledRepeat.heapGrowthBytes<5*1024*1024,'Repeated recycling should not retain detached rows');
  assert.equal(result.enabledRepeat.listeners,result.enabled.listeners,'No accumulating event listeners');
  await worker.evaluate(async()=>{await chrome.storage.local.set({settings:{enabled:false,blocked:['India','Africa'],expandRegions:true}});});
  await page.waitForFunction(()=>!document.querySelector('[data-xrf-hidden="true"]'));
  result.pauseRestoresAfterStress=true;
  console.log(JSON.stringify(result,null,2));
}finally{
  fs.writeFileSync('test-results/performance-results.json',JSON.stringify(result,null,2));
  await context.close();
  await cleanup();
  await new Promise(resolve=>server.close(resolve));
}
