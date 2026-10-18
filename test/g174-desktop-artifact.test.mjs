import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { inspectRelease, inspectTag, OFFICIAL_SHA } from '../scripts/g174-desktop-artifact.mjs';

const respond = (status, payload = {}) => async () => ({
  status, ok: status >= 200 && status < 300, json: async () => payload,
});
test('G174 missing exact 2.0.32 Desktop release is NO-GO, not successful Electron', async () => {
  assert.deepEqual(await inspectRelease(respond(404)), {
    status: 'NO_GO_OFFICIAL_DESKTOP_RELEASE_ABSENT', tag: 'v2.0.32', assets: 0,
  });
  await assert.rejects(inspectRelease(respond(403)), /inconclusive HTTP 403/);
  await assert.rejects(inspectRelease(respond(401)), /inconclusive HTTP 401/);
});
test('G174 accepts only official matching tag, exact URL, bounded size and sha256 digest', async () => {
  const correct = {
    name: 'opencode-desktop-linux-amd64.deb', size: 125_000_000,
    digest: 'sha256:' + 'a'.repeat(64),
    browser_download_url: 'https://github.com/anomalyco/opencode/releases/download/' +
      'v2.0.32/opencode-desktop-linux-amd64.deb',
  };
  const verified = await inspectRelease(respond(200, {
    tag_name: 'v2.0.32', assets: [correct],
  }));
  assert.equal(verified.status, 'DESKTOP_BINARY_REQUIRES_REAL_EXECUTION');
  assert.equal(verified.assets[0].digest, correct.digest);
  for (const corrupt of [
    { ...correct, browser_download_url: 'https://evil.example/desktop.deb' },
    { ...correct, size: 0 }, { ...correct, digest: undefined },
  ]) await assert.rejects(inspectRelease(respond(200, {
    tag_name: 'v2.0.32', assets: [corrupt],
  })), /unverifiable/);
  await assert.rejects(inspectRelease(respond(200, {
    tag_name: 'v1.19.3', assets: [correct],
  })), /mismatch/);
  assert.equal((await inspectRelease(respond(200, {
    tag_name: 'v2.0.32', assets: [],
  }))).status, 'NO_GO_OFFICIAL_DESKTOP_BINARY_ABSENT');
});
test('G174 source tag must resolve exact pinned 2.0.32 SHA (not any v1.x release)', async () => {
  assert.equal(await inspectTag(respond(200, {
    ref: 'refs/tags/v2.0.32', object: { sha: OFFICIAL_SHA },
  })), true);
  await assert.rejects(inspectTag(respond(200, {
    ref: 'refs/tags/v2.0.32', object: { sha: '0'.repeat(40) },
  })), /tag was moved/);
});
