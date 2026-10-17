import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const proof = await import(pathToFileURL(resolve('scripts/check-g119-cross-stream.mjs')).href);
const entries = await Promise.all(Object.keys(proof.EXPECTED).map(async (path: string) =>
  [path, await readFile(resolve(path))]));
const files = Object.fromEntries(entries);

test('G119 exact independently verified G106 security artifact AND G113 installed model/page fixture', () => {
  const observed = proof.inspect(files);
  assert.equal(observed.policyPatch, 'aaefcf8c0ef2776ba6bd62a587eafbe749f18b30');
  assert.equal(observed.localPage, 'e1a04479876fcb469309cbbb9526639964bf35e3');
  assert.equal(observed.installedPluginPreserved, true);
  assert.equal(observed.desktopElectronProof, false);
  assert.equal(observed.browserWritesEnabled, false);
});

test('G119 older native patch, truncated patch, tampered model, and plugin changes fail closed', () => {
  for (const path of Object.keys(files)) {
    const adversarial = { ...files, [path]: Buffer.concat([files[path], Buffer.from('\n// modified')]) };
    assert.throws(() => proof.inspect(adversarial), /mismatch/);
  }
  assert.throws(() => proof.inspect({
    ...files, [proof.ARTIFACT]: files[proof.ARTIFACT].subarray(0, 100_000),
  }), /mismatch/);
  assert.throws(() => proof.inspect({
    ...files, [proof.ARTIFACT]: 'G106 patch marker only',
  }), /mismatch/);
});
