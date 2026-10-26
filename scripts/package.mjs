import {readFile, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {zipSync, unzipSync} from 'fflate';
import assert from 'node:assert/strict';
import {filesIn} from './check.mjs';

const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
const entries = {};
// Fixed timestamps and sorted entries make equal sources produce equal archives.
for (const file of await filesIn('extension')) {
  entries[path.relative('extension', file).split(path.sep).join('/')] = [
    new Uint8Array(await readFile(file)), {mtime: new Date('2026-01-01T00:00:00Z')}
  ];
}
const archive = zipSync(entries, {level: 9});
const unpacked = unzipSync(archive);
for (const [name, [bytes]] of Object.entries(entries)) assert.deepEqual(unpacked[name], bytes);
await mkdir('dist', {recursive: true});
const target = `dist/x-region-filter-${manifest.version}.zip`;
await writeFile(target, archive);
console.log(`Packaged and verified ${Object.keys(entries).length} files: ${target}`);
