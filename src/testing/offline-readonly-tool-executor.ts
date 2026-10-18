/** T02/G135: DISPOSABLE fixtures only. Not a Core capability, sandbox or production tool. */
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { validateToolProposal, type ToolProposal, type ToolScope } from '../core/tool-proposal.js';

export interface OfflineReadonlyOptions {
  readonly workspace: string;
  /** Independently host-owned async permission check; mandatory before AND after effects. */
  readonly authorize: (proposal: ToolProposal) => Promise<boolean>;
  readonly signal?: AbortSignal;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}
export interface OfflineReadonlyResult { readonly action: ToolProposal['action']; readonly output: string; readonly bytes: number }
const within = (root: string, path: string): boolean => {
  const rel = relative(root, path);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
};
const unsafe = (text: string): boolean =>
  /(?:secret|password|token|api[_-]?key|private[_-]?key)\s*[:=]\s*\S+/i.test(text) ||
  /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b|\bsk-[a-zA-Z0-9]{12,}\b/i.test(text) ||
  /\\(?:u[0-9a-f]{4}|x[0-9a-f]{2})|%[0-9a-f]{2}/i.test(text) ||
  /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text);
const fail = (reason: string): never => { throw new Error('G135 NO-GO: ' + reason); };

async function fixedRoot(path: string): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path)) return fail('workspace root must be absolute');
  const tmp = await realpath(tmpdir()), target = resolve(path);
  const stat = await lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return fail('workspace root must be a real directory');
  const canonical = await realpath(target);
  if (!within(tmp, canonical) || tmp === canonical || canonical !== target)
    return fail('workspace must be a direct canonical temporary fixture directory');
  return canonical;
}

/** Reject each existing ancestor and the leaf before opening, including reparse links. */
async function checkPath(root: string, path: string): Promise<{ path: string; ino: bigint; dev: bigint }> {
  if (!path || path.split('/').some((part) => part === '.git')) return fail('internal Git files are forbidden');
  const target = resolve(root, path);
  if (!within(root, target) || root === target) return fail('path outside fixture workspace');
  let parent = root;
  for (const item of relative(root, target).split(sep)) {
    parent = join(parent, item);
    const stat = await lstat(parent, { bigint: true });
    if (stat.isSymbolicLink()) return fail('symlink/reparse traversal denied');
  }
  const stat = await lstat(target, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n) return fail('non-file or hardlink alias denied');
  if (!within(root, await realpath(target))) return fail('resolved path outside workspace');
  return { path: target, ino: stat.ino, dev: stat.dev };
}

async function fileRead(root: string, path: string, max: number): Promise<string> {
  // Node has no portable openat2(RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS) or
  // Windows HANDLE-based reparse proof. Windows therefore fails CLOSED here.
  if (process.platform !== 'linux') return fail('file descriptor confinement unsupported on this OS');
  const initial = await checkPath(root, path);
  const fd = await open(initial.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await fd.stat({ bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.ino !== initial.ino || stat.dev !== initial.dev ||
      stat.size > BigInt(max)) return fail('file changed or exceeded output budget');
    // Linux procfd resolves the ACTUAL opened inode, not the untrusted pathname.
    const opened = await readlink(`/proc/self/fd/${fd.fd}`);
    if (!within(root, opened) || opened.endsWith(' (deleted)')) return fail('opened handle escaped confinement');
    const data = Buffer.alloc(max + 1);
    const result = await fd.read(data, 0, max + 1, 0);
    if (result.bytesRead > max) return fail('file read exceeds byte budget');
    const after = await checkPath(root, path);
    const inode = await fd.stat({ bigint: true });
    if (after.ino !== inode.ino || after.dev !== inode.dev ||
      stat.ctimeNs !== inode.ctimeNs || stat.mtimeNs !== inode.mtimeNs ||
      stat.size !== inode.size ||
      !within(root, await readlink(`/proc/self/fd/${fd.fd}`)))
      return fail('path replaced during open/read');
    return new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, result.bytesRead));
  } finally { await fd.close(); }
}

async function gitRead(root: string, proposal: ToolProposal, max: number, timeout: number,
  signal?: AbortSignal): Promise<string> {
  const metadata = await lstat(join(root, '.git'));
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
    !within(root, await realpath(join(root, '.git')))) return fail('unsafe Git repository');
  const a = proposal.args;
  const args = ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'diff.external=',
    '-C', root, '--no-pager'];
  if (proposal.action === 'git.status')
    args.push('status', '--porcelain=v1', '--untracked-files=no', '--no-renames');
  else if (proposal.action === 'git.log')
    args.push('log', '--no-show-signature', '--no-decorate', '--max-count=' + Math.min(10, Number(a.limit ?? 5)),
      '--format=%h %s');
  else if (proposal.action === 'git.diff') {
    if (a.path !== undefined) await checkPath(root, String(a.path));
    args.push('diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-color');
    if (a.staged === true) args.push('--cached');
    args.push('--');
    if (a.path !== undefined) args.push(String(a.path));
  } else return fail('unknown Git action');
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR, GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_LFS_SKIP_SMUDGE: '1', LC_ALL: 'C' };
  return new Promise<string>((done, reject) => {
    const child = spawn('git', args, { cwd: root, env, shell: false,
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let size = 0; const chunks: Buffer[] = []; let exceeded = false; let expired = false;
    const timer = setTimeout(() => { expired = true; child.kill(); }, timeout);
    const onAbort = () => { expired = true; child.kill(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) { exceeded = true; child.kill(); }
      else chunks.push(chunk);
    });
    child.stderr.resume(); // Never disclose potentially sensitive Git diagnostics.
    child.on('error', () => { /* close also fires; no untrusted text in errors */ });
    child.on('close', (code) => {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (expired || signal?.aborted) reject(new Error('G135 interrupted/uncertain Git read'));
      else if (exceeded) reject(new Error('G135 Git output byte budget exceeded'));
      else if (code !== 0) reject(new Error('G135 Git read unavailable (NO-GO)'));
      else {
        try { done(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { reject(new Error('G135 invalid UTF-8 Git output')); }
      }
    });
  });
}

export function createOfflineReadonlyExecutor(options: OfflineReadonlyOptions) {
  if (typeof options.authorize !== 'function') return fail('host authorization callback mandatory');
  const max = options.maxBytes ?? 16_384;
  const timeout = options.timeoutMs ?? 4000;
  if (!Number.isSafeInteger(max) || max < 128 || max > 16_384 ||
    !Number.isSafeInteger(timeout) || timeout < 100 || timeout > 10_000)
    return fail('invalid resource budgets');
  return { async execute(raw: unknown, scope: ToolScope): Promise<Readonly<OfflineReadonlyResult>> {
    const validated = validateToolProposal(raw, scope);
    if (!validated.ok) return fail('proposal denied: ' + validated.reason);
    const proposal = validated.proposal;
    const authorize = async () => {
      if (options.signal?.aborted) return fail('interrupted/uncertain authorization');
      if (await options.authorize(proposal) !== true) return fail('host policy denied');
      if (options.signal?.aborted) return fail('interrupted/uncertain authorization');
    };
    const root = await fixedRoot(options.workspace);
    await authorize();
    const output = proposal.action === 'file.read'
      ? await fileRead(root, proposal.args.path as string, max)
      : await gitRead(root, proposal, max, timeout, options.signal);
    await authorize(); // Revocation during asynchronous filesystem/Git read denies output.
    if (await fixedRoot(options.workspace) !== root) return fail('workspace root replaced');
    if (proposal.action === 'file.read') await checkPath(root, proposal.args.path as string);
    if (Buffer.byteLength(output, 'utf8') > max) return fail('output size exceeded');
    if (unsafe(output)) return fail('unsafe/escaped secret output (DLP NO-GO)');
    return Object.freeze({ action: proposal.action, output, bytes: Buffer.byteLength(output, 'utf8') });
  } };
}
