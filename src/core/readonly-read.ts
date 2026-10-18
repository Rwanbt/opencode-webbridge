/** Production read-only file/Git reads for the plugin root.
 *
 * The semantics were reviewed in the disposable G135 fixture and are promoted
 * here for a REAL operator workspace:
 *  - every proposal goes through `validateToolProposal` (read-only actions only);
 *  - workspace confinement: canonical root, per-component lstat, no symlink or
 *    reparse traversal, `.git` internals never readable as files;
 *  - Linux additionally proves the OPENED inode is the confined leaf
 *    (O_NOFOLLOW + /proc/self/fd); on other platforms only the weaker realpath
 *    containment is available and it is reported as such — never claimed as
 *    equivalent;
 *  - Git runs hardened (no optional locks, no external diff, no textconv, no
 *    pager, system/global config ignored), with bounded output and time, and
 *    stderr is never disclosed;
 *  - DLP: secret-looking output is refused, never returned.
 *
 * This module performs NO writes and every failure is explicit. */
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath, readlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  validateToolProposal, type ReadOnlyAction, type ToolProposal, type ToolScope,
} from './tool-proposal.js';

export interface ReadonlyReadOptions {
  /** Absolute (canonical) session workspace directory. */
  readonly workspace: string;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

export interface ReadonlyReadResult {
  readonly action: ReadOnlyAction;
  readonly output: string;
  readonly bytes: number;
  /** Which confinement proof actually ran for this read. */
  readonly confinement: 'openat' | 'realpath';
}

const fail = (reason: string): never => { throw new Error('WebBridge read-only tool refused: ' + reason); };
const within = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
};
/** Same reviewed DLP patterns as the fixture: refuse secret-looking output. */
const unsafe = (text: string): boolean =>
  /(?:secret|password|token|api[_-]?key|private[_-]?key)\s*[:=]\s*\S+/i.test(text) ||
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\bsk-[a-zA-Z0-9]{12,}\b/i.test(text) ||
  /\\u[0-9a-f]{4}|\\x[0-9a-f]{2}|%[0-9a-f]{2}/i.test(text) ||
  /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text);

async function workspaceRoot(path: string): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path)) return fail('workspace must be absolute');
  const target = resolve(path);
  const stat = await lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return fail('workspace must be a real directory');
  const canonical = await realpath(target);
  if (canonical !== target) return fail('workspace must be a canonical path (no symlink indirection)');
  return canonical;
}

/** Reject each existing ancestor and the leaf before opening, including reparse links. */
async function checkPath(root: string, path: string): Promise<{ path: string; ino: bigint; dev: bigint }> {
  if (!path || path.split('/').some((part) => part === '.git'))
    return fail('internal Git files are forbidden');
  const target = resolve(root, path);
  if (!within(root, target) || root === target) return fail('path outside the workspace');
  let parent = root;
  for (const item of relative(root, target).split(sep)) {
    parent = join(parent, item);
    const stat = await lstat(parent, { bigint: true });
    if (stat.isSymbolicLink()) return fail('symlink/reparse traversal denied');
  }
  const stat = await lstat(target, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n) return fail('non-file or hardlink alias denied');
  if (!within(root, await realpath(target))) return fail('resolved path outside the workspace');
  return { path: target, ino: stat.ino, dev: stat.dev };
}

async function readFileConfined(root: string, path: string, max: number):
  Promise<{ text: string; confinement: 'openat' | 'realpath' }> {
  const initial = await checkPath(root, path);
  if (process.platform !== 'linux') {
    // No portable openat2(RESOLVE_BENEATH|RESOLVE_NO_SYMLINKS) and no
    // HANDLE-based reparse proof: only the realpath containment above applies.
    const info = await lstat(initial.path);
    if (info.size > max) return fail('file exceeds the read budget');
    const handle = await open(initial.path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const data = Buffer.alloc(max + 1);
      const result = await handle.read(data, 0, max + 1, 0);
      if (result.bytesRead > max) return fail('file read exceeds the byte budget');
      const again = await checkPath(root, path);
      if (again.ino !== initial.ino || again.dev !== initial.dev)
        return fail('path replaced during read');
      return { text: decode(data.subarray(0, result.bytesRead)), confinement: 'realpath' };
    } finally { await handle.close(); }
  }
  const fd = await open(initial.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await fd.stat({ bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.ino !== initial.ino || stat.dev !== initial.dev ||
      stat.size > BigInt(max)) return fail('file changed or exceeded the read budget');
    const opened = await readlink(`/proc/self/fd/${fd.fd}`);
    if (!within(root, opened) || opened.endsWith(' (deleted)'))
      return fail('opened handle escaped confinement');
    const data = Buffer.alloc(max + 1);
    const result = await fd.read(data, 0, max + 1, 0);
    if (result.bytesRead > max) return fail('file read exceeds the byte budget');
    const after = await checkPath(root, path);
    const inode = await fd.stat({ bigint: true });
    if (after.ino !== inode.ino || after.dev !== inode.dev ||
      stat.ctimeNs !== inode.ctimeNs || stat.mtimeNs !== inode.mtimeNs || stat.size !== inode.size ||
      !within(root, await readlink(`/proc/self/fd/${fd.fd}`)))
      return fail('path replaced during open/read');
    return { text: decode(data.subarray(0, result.bytesRead)), confinement: 'openat' };
  } finally { await fd.close(); }
}

const decode = (bytes: Uint8Array): string => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return fail('invalid UTF-8 content'); }
};

async function gitRead(root: string, proposal: ToolProposal, max: number, timeout: number,
  signal?: AbortSignal): Promise<string> {
  let metadata;
  try { metadata = await lstat(join(root, '.git')); }
  catch { return fail('unsafe Git repository'); }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
    !within(root, await realpath(join(root, '.git')))) return fail('unsafe Git repository');
  const args = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'diff.external=',
    '-C', root, '--no-pager'];
  const a = proposal.args;
  if (proposal.action === 'git.status')
    args.push('status', '--porcelain=v1', '--untracked-files=no', '--no-renames');
  else if (proposal.action === 'git.log')
    args.push('log', '--no-show-signature', '--no-decorate',
      '--max-count=' + Math.min(10, Number(a.limit ?? 5)), '--format=%h %s');
  else if (proposal.action === 'git.diff') {
    if (a.path !== undefined) await checkPath(root, String(a.path));
    args.push('diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color');
    if (a.staged === true) args.push('--cached');
    args.push('--');
    if (a.path !== undefined) args.push(String(a.path));
  } else return fail('unknown Git action');
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_LFS_SKIP_SMUDGE: '1', LC_ALL: 'C',
  };
  return new Promise<string>((done, reject) => {
    const child = spawn('git', args, { cwd: root, env, shell: false,
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let size = 0; const chunks: Buffer[] = []; let exceeded = false; let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, timeout);
    const onAbort = () => { expired = true; child.kill(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) { exceeded = true; child.kill(); } else chunks.push(chunk);
    });
    child.stderr.resume(); // Never disclose potentially sensitive Git diagnostics.
    child.on('error', () => { /* close also fires; no untrusted text in errors */ });
    child.on('close', (code) => {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (expired || signal?.aborted) reject(new Error('WebBridge read-only tool refused: interrupted Git read'));
      else if (exceeded) reject(new Error('WebBridge read-only tool refused: Git output over budget'));
      else if (code !== 0) reject(new Error('WebBridge read-only tool refused: Git read unavailable'));
      else done(decode(Buffer.concat(chunks)));
    });
  });
}

export function createReadonlyReader(options: ReadonlyReadOptions) {
  const max = options.maxBytes ?? 16_384;
  const timeout = options.timeoutMs ?? 4_000;
  if (!Number.isSafeInteger(max) || max < 128 || max > 16_384 ||
    !Number.isSafeInteger(timeout) || timeout < 100 || timeout > 10_000)
    return fail('invalid resource budgets');
  return Object.freeze({
    /** Validate, confine, read, then re-verify confinement and DLP. Never writes. */
    async execute(raw: unknown, scope: ToolScope, signal?: AbortSignal): Promise<ReadonlyReadResult> {
      const validated = validateToolProposal(raw, scope);
      if (!validated.ok) return fail('proposal denied: ' + validated.reason);
      const proposal = validated.proposal;
      const root = await workspaceRoot(options.workspace);
      let output: string;
      let confinement: 'openat' | 'realpath';
      if (proposal.action === 'file.read') {
        const read = await readFileConfined(root, proposal.args.path as string, max);
        output = read.text; confinement = read.confinement;
      } else {
        output = await gitRead(root, proposal, max, timeout, signal);
        confinement = 'realpath';
      }
      if (await workspaceRoot(options.workspace) !== root) return fail('workspace root replaced');
      if (proposal.action === 'file.read') await checkPath(root, proposal.args.path as string);
      if (Buffer.byteLength(output, 'utf8') > max) return fail('output size exceeded');
      if (unsafe(output)) return fail('unsafe/secret-looking output refused (DLP)');
      return Object.freeze({
        action: proposal.action, output, bytes: Buffer.byteLength(output, 'utf8'), confinement,
      });
    },
  });
}
