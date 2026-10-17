import { spawnSync, type ChildProcess } from 'node:child_process';

/**
 * Attach immediately after spawn: `close` can fire before cleanup starts.
 * Cleanup must not delete an isolated profile while the child holds files open.
 */
export function trackNativeChild(child: ChildProcess): { stop(): Promise<void> } {
  let closed = false;
  const finished = new Promise<void>((resolve) => {
    child.once('close', () => { closed = true; resolve(); });
  });

  return {
    async stop() {
      if (closed) return;
      if (child.exitCode === null && child.signalCode === null) {
        if (process.platform === 'win32' && child.pid) {
          const stopped = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore', windowsHide: true, timeout: 2_000,
          });
          // Some isolated runner hosts cannot launch taskkill. Fall back to the
          // direct native child (which G14 deliberately runs without cmd.exe).
          if (stopped.error || stopped.status !== 0) child.kill();
        } else {
          child.kill();
        }
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          finished,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('native child did not close; profile cleanup unsafe')), 5_000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}
