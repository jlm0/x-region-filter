import {chromium} from 'playwright';
import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import path from 'node:path';
import {profile, executablePath, cleanup} from './support/browser.mjs';
const require = createRequire(import.meta.url);
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const root = path.resolve('extension');
const context = await chromium.launchPersistentContext(profile, {
  executablePath, channel: 'chromium', headless: true, viewport: {width: 460, height: 600},
  args: [`--load-extension=${root}`, `--disable-extensions-except=${root}`, '--blink-settings=minimumFontSize=16,minimumLogicalFontSize=16']
});
const report = [];
const requests = [];
const errors = [];
context.on('request', request => {if (/^https?:/.test(request.url())) requests.push(new URL(request.url()).origin);});
const test = async (name, run) => {
  await run(); report.push({name, passed: true}); console.log('PASS', name);
};
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const popup = await context.newPage();
  popup.on('pageerror', error => errors.push(error.message));
  await popup.goto(`chrome-extension://${worker.url().split('/')[2]}/popup/index.html`);
  await popup.locator('#settings:not([disabled])').waitFor();
  await popup.evaluate(() => document.fonts.ready);
  await test('Initial settings render with the bundled font and no invented feed totals', async () => {
    assert.equal(await popup.locator('#enabled').isChecked(), true);
    assert.equal(await popup.locator('#new-accounts').isChecked(), true);
    assert.equal(await popup.locator('#count').innerText(), '0 selected');
    assert.equal(await popup.locator('#state-title').innerText(), 'Ready for X');
    assert.equal(await popup.evaluate(() => document.fonts.check('14px Geist')), true);
    assert.match(await popup.locator('#feed-status').innerText(), /Open X Home/);
  });
  await test('Popup has an intrinsic 460px width even in a narrow initial window', async () => {
    for (const width of [460, 250]) {
      await popup.setViewportSize({width, height: 600});
      const size = await popup.evaluate(() => ({body:document.body.getBoundingClientRect().width, root:document.documentElement.getBoundingClientRect().width, height:document.body.scrollHeight}));
      assert.equal(size.body,460);
      assert.equal(size.root,460);
      assert.ok(size.height <= 600, `Popup is ${size.height}px tall`);
    }
    await popup.setViewportSize({width:460, height:600});
    await popup.locator('.popup').screenshot({path:'test-results/popup-460.png'});
    await popup.evaluate(()=>{config.blocked=['Japan','Europe','South Asia','North America'];render();});
    assert.ok(await popup.evaluate(()=>document.querySelector('#new-accounts').getBoundingClientRect().bottom <= 600));
    await popup.locator('.popup').screenshot({path:'test-results/popup-460-selected.png'});
    await popup.evaluate(()=>{config.blocked=[];render();});
  });
  await test('South Asia appears in the picker and matches Southern Asia without duplicates', async () => {
    assert.equal(await popup.locator('#places option[value="South Asia"]').count(),1);
    await popup.locator('#place').fill('South Asia');
    await popup.locator('#place').press('Enter');
    await popup.evaluate(()=>saving);
    assert.equal(await worker.evaluate(()=>XRF.matches('Southern Asia',config)),true);
    assert.equal(await worker.evaluate(()=>XRF.matches('India',config)),true);
    await popup.locator('#place').fill('Southern Asia');
    await popup.locator('#place').press('Enter');
    assert.equal(await popup.locator('#chips button').count(),1);
    await popup.getByRole('button',{name:'Remove South Asia',exact:true}).click();
  });
  await test('The native toolbar popup fits its 460px content and main controls', async () => {
    await popup.evaluate(()=>saving);
    // Leave room for the browser's toolbar window around the 460px action.
    await popup.setViewportSize({width:1100,height:850});
    const saved=await worker.evaluate(()=>config);
    const browserSession=await context.browser().newBrowserCDPSession();
    const before=new Set((await browserSession.send('Target.getTargets')).targetInfos.map(target=>target.targetId));
    let targetId;
    try {
      await worker.evaluate(async()=>{
        await chrome.storage.local.set({settings:{...config,blocked:['Japan','Europe','South Asia','North America']}});
        const [window]=await chrome.windows.getAll();
        await chrome.action.openPopup({windowId:window.id});
      });
      targetId=(await browserSession.send('Target.getTargets')).targetInfos.find(target=>!before.has(target.targetId)&&target.url===popup.url())?.targetId;
      assert.ok(targetId,'A native browser-action popup must open');
      const {sessionId}=await browserSession.send('Target.attachToTarget',{targetId,flatten:false});
      const result=new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('Native popup did not respond')),10000);
        const receive=event=>{
          if(event.sessionId!==sessionId)return;
          const message=JSON.parse(event.message);
          if(message.id!==1)return;
          clearTimeout(timeout);browserSession.off('Target.receivedMessageFromTarget',receive);
          message.error?reject(new Error(message.error.message)):resolve(message.result);
        };
        browserSession.on('Target.receivedMessageFromTarget',receive);
      });
      await browserSession.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:1,method:'Runtime.evaluate',params:{awaitPromise:true,returnByValue:true,expression:`(async()=>{
        await document.fonts.ready;
        while(document.querySelector('#settings')?.disabled) await new Promise(resolve=>setTimeout(resolve,20));
        return {width:innerWidth,height:innerHeight,clientWidth:document.documentElement.clientWidth,
          scrollWidth:document.documentElement.scrollWidth,body:document.body.getBoundingClientRect().width,
          chips:document.querySelectorAll('#chips button').length,ageBottom:document.querySelector('#new-accounts').getBoundingClientRect().bottom};
      })()`}})});
      const metrics=(await result).result.value;
      // The browser can reserve native gutter space outside the 460px document.
      // The product requirement is that the content is neither squeezed nor clipped.
      assert.ok(metrics.clientWidth>=metrics.body,JSON.stringify(metrics));
      assert.ok(metrics.scrollWidth<=metrics.clientWidth,JSON.stringify(metrics));
      assert.equal(metrics.body,460);assert.equal(metrics.chips,4);
      assert.ok(metrics.ageBottom<=metrics.height,JSON.stringify(metrics));
    } finally {
      if(targetId)await browserSession.send('Target.closeTarget',{targetId});
      await browserSession.detach();
      await worker.evaluate(async settings=>chrome.storage.local.set({settings}),saved);
      await popup.setViewportSize({width:460,height:600});
    }
  });
  await test('Keyboard can add a region; duplicate and long labels stay readable', async () => {
    await popup.locator('#place').fill('Europe');
    await popup.locator('#place').press('Enter');
    await popup.getByRole('button', {name:'Remove Europe', exact:true}).waitFor();
    await popup.waitForFunction(() => document.querySelector('#save-status').textContent === 'Saved');
    assert.ok((await worker.evaluate(async () => (await chrome.storage.local.get('settings')).settings)).blocked.includes('Europe'));
    await popup.locator('#place').fill('europe');
    await popup.locator('#place').press('Enter');
    assert.equal(await popup.locator('#chips button').count(), 1);
    assert.match(await popup.locator('#place-feedback').innerText(), /already blocked/);
    await popup.locator('#place').fill('A'.repeat(80));
    await popup.locator('#place').press('Enter');
    assert.ok(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await popup.getByRole('button', {name:`Remove ${'A'.repeat(80)}`, exact:true}).click();
  });
  await test('Removal preserves keyboard focus and an empty region list keeps age filtering', async () => {
    for (const label of ['Europe']) await popup.getByRole('button', {name:`Remove ${label}`, exact:true}).click();
    assert.equal(await popup.evaluate(() => document.activeElement.id), 'place');
    assert.match(await popup.locator('#chips').innerText(), /No regions blocked/);
    await popup.evaluate(() => saving);
    assert.equal(await worker.evaluate(() => XRF.active(config)), true);
    await popup.locator('#new-accounts').uncheck();
    await popup.waitForFunction(() => document.querySelector('#state-title').textContent === 'No filters selected');
  });
  await test('Pause and resume preserve saved choices across popup reopen', async () => {
    await popup.locator('#new-accounts').check();
    await popup.locator('#enabled').uncheck();
    await popup.waitForFunction(() => document.querySelector('#state-title').textContent === 'Filtering paused');
    await popup.reload();
    await popup.locator('#settings:not([disabled])').waitFor();
    assert.equal(await popup.locator('#enabled').isChecked(), false);
    assert.equal(await popup.locator('#new-accounts').isChecked(), true);
    assert.equal(await popup.locator('#chips button').count(), 0);
    await popup.locator('#enabled').check();
    await popup.evaluate(() => saving);
  });
  await test('Clear cache preserves settings and the existing cooldown', async () => {
    await worker.evaluate(async () => {
      cache.set('fixture', {location:'India', expiresAt:Date.now()+3600000});
      guard.until = Date.now()+60000; guard.reason = 'Fixture cooldown';
      await chrome.storage.local.set({cache:[...cache], guard});
    });
    const before = await worker.evaluate(() => ({config, until:guard.until}));
    await popup.locator('.activity>summary').click();
    await popup.locator('#clear').click();
    await popup.waitForFunction(() => document.querySelector('#save-status').textContent === 'Account cache cleared');
    const after = await worker.evaluate(() => ({config, until:guard.until, size:cache.size}));
    assert.deepEqual({config:after.config, until:after.until}, before);
    assert.equal(after.size, 0);
    await popup.locator('#refresh').click();
    assert.match(await popup.locator('#status').innerText(), /Fixture cooldown/);
  });
  await test('Expanded and collapsed controls pass automated accessibility checks', async () => {
    await popup.evaluate(axe);
    for (const expanded of [true, false]) {
      await popup.locator('.activity').evaluate((el, expanded) => {el.open = expanded;}, expanded);
      const result = await popup.evaluate(async () => axe.run(document, {runOnly:{type:'tag', values:['wcag2a','wcag2aa','wcag21aa']}}));
      assert.deepEqual(result.violations.map(v => ({id:v.id, targets:v.nodes.map(n=>n.target)})), []);
    }
  });
  await test('Status errors and save failures are visible without losing controls', async () => {
    await popup.evaluate(async () => {
      globalThis.originalSend = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = async () => {throw new Error('Fixture failure');};
      await status();
    });
    assert.equal(await popup.locator('#state-title').innerText(), 'Status unavailable');
    await popup.evaluate(() => {
      chrome.runtime.sendMessage = originalSend;
      globalThis.originalSet = chrome.storage.local.set;
      chrome.storage.local.set = async () => {throw new Error('Fixture failure');};
    });
    await popup.locator('#expand').uncheck();
    await popup.waitForFunction(() => document.querySelector('#save-status').textContent === 'Not saved');
    assert.match(await popup.locator('#error').innerText(), /Could not save/);
    await popup.evaluate(() => {chrome.storage.local.set = originalSet;});
  });
  await test('Settings loading failures leave controls disabled and explain recovery', async () => {
    const failure = await context.newPage();
    await failure.addInitScript(() => {chrome.storage.local.get = async () => {throw new Error('Fixture failure');};});
    await failure.goto(popup.url());
    await failure.getByRole('heading', {name:'Settings unavailable'}).waitFor();
    assert.equal(await failure.locator('#enabled').isDisabled(), true);
    assert.equal(await failure.locator('#place').isDisabled(), true);
    await failure.close();
  });
  await test('Popup interaction sends no HTTP requests or account lookups', async () => {
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
  });
} finally {
  await writeFile('test-results/popup-results.json', JSON.stringify(report, null, 2));
  await context.close();
  await cleanup();
}
