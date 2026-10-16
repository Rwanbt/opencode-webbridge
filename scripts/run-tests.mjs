import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const tests = readdirSync('dist/test')
  .filter((file) => file.endsWith('.test.js'))
  .sort()
  .map((file) => resolve('dist/test', file));

if (tests.length === 0) throw new Error('No compiled .test.js files found');
const result = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
