import {readFile, readdir, access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';

export async function filesIn(dir) {
  const entries = await readdir(dir, {withFileTypes: true});
  return (await Promise.all(entries.map(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesIn(file) : [file];
  }))).flat().sort();
}

const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(manifest.version, pkg.version, 'Package and extension versions must agree');
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(manifest.permissions, ['storage', 'webRequest']);
assert.deepEqual(manifest.host_permissions, ['https://x.com/*']);
const assets = [manifest.background.service_worker, manifest.action.default_popup,
  ...manifest.content_scripts.flatMap(script => [...script.js, ...script.css]),
  ...Object.values(manifest.icons || {})];
for (const asset of assets) await access(path.join('extension', asset));
const files = await filesIn('extension');
for (const file of files) {
  if (file.endsWith('.js')) execFileSync(process.execPath, ['--check', file]);
  if (!/\.(js|html|css|json)$/.test(file)) continue;
  const source = await readFile(file, 'utf8');
  assert.ok(!/\/Users\/|C:\\\\Users\\\\/.test(source), `${file}: machine-specific path`);
  assert.ok(!/Bearer\s+[A-Za-z0-9%]{20,}/.test(source), `${file}: embedded credential`);
  if (file.endsWith('.html')) {
    assert.ok(!/<script\b[^>]*src=["']https?:/i.test(source), `${file}: remote script`);
    for (const match of source.matchAll(/(?:src|href)=["']([^"'#]+)["']/g)) {
      if (/^(https?:|chrome:|brave:|mailto:)/.test(match[1])) continue;
      await access(path.resolve(path.dirname(file), match[1]));
    }
  }
}
console.log(`Checked manifest, versions, permissions, syntax, and assets (${files.length} files).`);
