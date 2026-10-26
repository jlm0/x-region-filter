import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

await mkdir('test-results', {recursive: true});
export const profile = await mkdtemp(path.join(tmpdir(), 'x-region-filter-test-'));
export const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH || undefined;
export const cleanup = () => rm(profile, {recursive: true, force: true});
