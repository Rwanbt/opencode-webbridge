import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const gate = await import(pathToFileURL(resolve('scripts/g111-desktop-release-gate.mjs')).href);
const app = 'opencode-desktop-linux-x86_64.AppImage';
const version = gate.VERSION;
const hash = 'v7bD3BJ478IFPkjbP25Wqgla1rqTJNX6RRlHef6Bp8ju+xHVpx6S78ZYBxSRWSuyFA5C8jRqmhBZ7Sn/zGnVZg==';
const feed = (v = version, imageHash = hash) => `files:
  - url: https://opencode.ai/files/bin/${v}/${app}
    sha512: ${imageHash}
    size: 274268075
  - url: https://opencode.ai/files/bin/${v}/opencode-desktop-linux-amd64.deb
    sha512: ${hash}
    size: 218628704
  - url: https://opencode.ai/files/bin/${v}/opencode-desktop-linux-x86_64.rpm
    sha512: ${hash}
    size: 194144437
releaseDate: 2026-10-16T21:58:11.465Z
version: ${v}
`;

test('G111 official 2.0.32 feed is pinned but SHA512 alone NEVER authorizes Electron', () => {
  assert.equal(gate.parseFeed(feed()).version, '2.0.32');
  const proof = gate.assess({ feed: feed(), platform: 'linux', freeBytes: 16 * 1024 ** 3,
    source: { bogus: 'not official' }, signedArtifactVerified: true, guiModelTurnVerified: true });
  assert.equal(proof.versionMatched, true);
  assert.equal(proof.status, 'SKIP_NO_ELECTRON_E2E');
  assert.equal(proof.electronExecuted, false);
  assert.equal(proof.signedArtifactVerified, false);
  assert.equal(proof.guiModelTurnVerified, false);
  assert.ok(proof.reasons.includes('INDEPENDENT_LINUX_PUBLISHER_SIGNATURE_UNATTESTED'));
  assert.ok(proof.reasons.includes('PACKAGED_GUI_MODEL_PICKER_AND_PLUGIN_DISCOVERY_NOT_TESTED'));
});

test('G111 mutable latest feed, invalid URLs, missing hashes and forged source all fail closed', () => {
  for (const corrupted of [
    feed('2.0.33'), feed(version, 'A'.repeat(86) + '=='),
    feed().replace('https://opencode.ai/files/bin/', 'https://attacker.example/files/bin/'),
    feed().replace('    size: 274268075', '    size: 9'),
    feed().replace('  - url: https://opencode.ai/files/bin/2.0.32/opencode-desktop-linux-amd64.deb',
      '  - url: https://opencode.ai/files/bin/2.0.32/opencode-desktop-linux-x86_64.AppImage'),
  ]) {
    const inspected = gate.assess({ platform: 'linux', feed: corrupted, source: {} });
    assert.equal(inspected.electronExecuted, false);
    assert.equal(inspected.guiModelTurnVerified, false);
    assert.ok(inspected.reasons.some((reason: string) => reason.includes('RELEASE')));
  }
  assert.throws(() => gate.verifySource({
    'packages/desktop/src/main/lifecycle/configure.ts':
      'if (!app.isPackaged) app.commandLine.appendSwitch("remote-debugging-port")',
    'packages/desktop/src/main/service/background-service.ts': 'isolated = true',
  }), /source mismatch/);
});

test('G111 unsafe Windows RAM and existing instances deny before any GUI process', () => {
  for (const args of [
    { platform: 'win32', freeBytes: gate.MEMORY_FLOOR - 1, desktopInstances: 6 },
    { platform: 'win32', freeBytes: 8 * 1024 ** 3, desktopInstances: 1 },
    { platform: 'win32', freeBytes: 8 * 1024 ** 3, desktopInstances: null },
  ]) {
    const result = gate.assess({ ...args, source: {}, feed: feed() });
    assert.equal(result.status, 'SKIP_NO_ELECTRON_E2E');
    assert.equal(result.electronExecuted, false);
    assert.ok(result.reasons.some((reason: string) =>
      reason === 'WINDOWS_RAM_BELOW_6_GIB' ||
      reason === 'DESKTOP_INSTANCES_PRESENT_OR_UNATTESTED'));
  }
});

test('G111 network probe accesses only fixed raw pinned tag and official metadata, never binary', async () => {
  const accesses: string[] = [];
  await gate.inspectLive(async (url: string) => {
    accesses.push(url);
    return { ok: true, text: async () => url.endsWith('.yml') ? feed() : 'SOURCE_TEST_PLACEHOLDER' };
  });
  assert.equal(accesses.length, 3);
  assert.ok(accesses.slice(0, 2).every((url) =>
    url.includes('843a6c514e606b436a7fe713422ace0a93ad3d61/') && url.includes('raw.githubusercontent.com/')));
  assert.ok(accesses[2].endsWith('/latest-linux.yml'));
  assert.ok(accesses.every((url) => !url.endsWith('.AppImage') && !url.endsWith('.deb')));
});
