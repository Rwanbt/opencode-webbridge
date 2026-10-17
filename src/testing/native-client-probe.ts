import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { trackNativeChild } from './native-child-lifecycle.js';

/** Require the CLI's parsed response to be scoped to our isolated directory. */
export function validNativeClientProbe(raw: string, cwd: string): boolean {
  try {
    const result: unknown = JSON.parse(raw);
    if (!result || typeof result !== 'object' || !('location' in result) ||
      !('data' in result) || !Array.isArray(result.data) || !result.location ||
      typeof result.location !== 'object' || !('directory' in result.location)) return false;
    return result.location.directory === resolve(cwd);
  } catch { return false; }
}

/** Read-only client handshake; a failed probe may be retried, a prompt never may. */
export async function requireNativeClientReady(
  check: () => Promise<boolean>, attempts = 2,
): Promise<void> {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw new Error('invalid probe budget');
  for (let i = 0; i < attempts; i++) {
    if (await check()) return;
  }
  throw new Error(`native CLI connection unavailable after ${attempts} read-only probes`);
}

/** Check the *empty* isolated relay before the first submit; never retry writes. */
export async function requireEmptyRelayReady(
  check: () => Promise<unknown>, attempts = 3,
): Promise<void> {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3) throw new Error('invalid relay probe budget');
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await check();
      if (result && typeof result === 'object' && 'found' in result) {
        if (result.found === false) return;
        throw new Error('relay unexpectedly holds a job before submit');
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('unexpectedly holds a job')) throw error;
      // A transient transport failure is safe to retry only before submit.
    }
  }
  throw new Error(`RPC fixture unavailable after ${attempts} empty-queue probes`);
}

/** Uses the CLI's own --server resolver against our isolated loopback endpoint. */
export async function probeNativeClient(binary: string, serverURL: string, cwd: string,
  env: NodeJS.ProcessEnv, deadlineMs = 8_000): Promise<boolean> {
  const url = new URL(serverURL);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
    !url.port || url.pathname !== '/' || url.search || url.hash ||
    url.username || url.password) throw new Error('probe requires explicit loopback server');
  if (!Number.isInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 10_000) {
    throw new Error('invalid probe timeout');
  }
  const child = spawn(binary, ['api', '--server', serverURL, 'GET', '/api/plugin'], {
    cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false,
  });
  const lifecycle = trackNativeChild(child);
  let overflow = false;
  let size = 0;
  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (stream === child.stdout && output.length < 64_000) output += chunk.toString('utf8');
      if (size > 64_000) { overflow = true; void lifecycle.stop().catch(() => {}); }
    });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once('close', resolve);
    child.once('error', reject);
  });
  try {
    timer = setTimeout(() => { timedOut = true; void lifecycle.stop().catch(() => {}); }, deadlineMs);
    const code = await completion;
    return !timedOut && !overflow && code === 0 && validNativeClientProbe(output, cwd);
  } finally {
    if (timer) clearTimeout(timer);
    await lifecycle.stop();
  }
}
