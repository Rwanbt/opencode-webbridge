import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Resolve only the executable belonging to the same npm shim, not another OpenCode installation. */
export function resolveNpmOpenCodeShim(wrapper: string,
  file: (path: string) => boolean = (path) => existsSync(path) && lstatSync(path).isFile()): string {
  if (!/\.cmd$/i.test(wrapper)) return wrapper;
  const dir = dirname(wrapper);
  const candidates = [
    join(dir, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe'),
    resolve(dir, '..', '@opencode', 'cli', 'bin', 'opencode.exe'),
  ];
  const executable = candidates.find(file);
  if (!executable) throw new Error('OpenCode npm CLI native executable unavailable; do not use a shell shim');
  return executable;
}

/** Windows shell wrappers create an extra parent process and leave watchers alive. */
export function nativeOpenCodeExecutable(): string {
  if (process.env.OPENCODE_BIN) return resolveNpmOpenCodeShim(process.env.OPENCODE_BIN);
  if (process.platform !== 'win32') return 'opencode';
  const found = spawnSync('where.exe', ['opencode.cmd'], { encoding: 'utf8', windowsHide: true });
  const wrapper = found.stdout?.split(/\r?\n/).find((line) => line.trim().toLowerCase().endsWith('opencode.cmd'));
  if (!wrapper) throw new Error('OpenCode v2 npm shim unavailable');
  return resolveNpmOpenCodeShim(wrapper.trim());
}
