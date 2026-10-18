/** Build the REAL root + reachable runtime only; never package stale test/fixture output. */
import { lstat, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (resolve(process.cwd()) !== root) throw new Error('G164 prepack must run from package root');
const output = join(root, 'dist');
try {
  const stat = await lstat(output);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error('G164 dist is not a real owned directory');
  await rm(output, { recursive: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const result = spawnSync(process.execPath,
  [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.pack.json'],
  { cwd: root, stdio: 'inherit', timeout: 90_000, windowsHide: true });
if (result.status !== 0 || result.error) throw new Error('G164 production compile failed closed');
