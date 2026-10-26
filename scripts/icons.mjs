import {chromium} from 'playwright';
import {mkdir, readFile} from 'node:fs/promises';

await mkdir('extension/assets/icons', {recursive:true});
const svg = await readFile('extension/assets/mark.svg', 'utf8');
const browser = await chromium.launch({channel:'chromium', executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined});
try {
  const page = await browser.newPage({deviceScaleFactor:1});
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({width:size, height:size});
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:100vw;height:100vh}</style>${svg}`);
    await page.screenshot({path:`extension/assets/icons/icon-${size}.png`, omitBackground:true});
  }
} finally {await browser.close();}
