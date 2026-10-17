/** G97: one installed tarball is the ONLY native source of test RPC + model. */
import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exerciseRPCPackage } from './offline-rpc-package.mjs';
import { createModelBridge } from './smoke-packaged-model.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const descriptor = {
  name: 'opencode-webbridge-g97-combined-test',
  id: 'opencode.webbridge.g97-combined-test',
  entry: await readFile(join(root, 'fixtures/g97-combined-preview.mjs'), 'utf8'),
  description: 'G97 standalone test-only local fake model and native RPC. NEVER commercial.',
};

export async function verifyCombined({ native = false } = {}) {
  const local = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'opencode.cmd' : 'opencode');
  if (native && !existsSync(local)) throw new Error('pinned local OpenCode CLI missing');
  const result = await exerciseRPCPackage({ descriptor,
    ...(native ? { nativeBin: local, modelBridge: createModelBridge({ directoryModel: false }) } : {}) });
  if (native) {
    assert.equal(result.nativeChecks.length, 2);
    for (const check of result.nativeChecks) {
      assert.equal(check.model?.nativeModel, true);
      assert.equal(check.model?.packagedRpcUsed, true);
      assert.ok(check.model.sseFrames >= 2);
    }
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyCombined({ native: process.argv.includes('--native') })
    .then((result) => console.log('G97 combined standalone model+RPC PASS', JSON.stringify(result)))
    .catch((error) => { console.error('G97 combined model+RPC FAIL:', error.message); process.exitCode = 1; });
}
