import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { openLocalChatPage } from '../src/testing/local-chat-page.js';

test('local fixture serves only its exact loopback page without browsing capabilities', async () => {
  const fixture = await openLocalChatPage();
  try {
    assert.match(fixture.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const valid = await fetch(fixture.url);
    assert.equal(valid.status, 200);
    assert.match(valid.headers.get('content-security-policy') ?? '', /connect-src 'none'/);
    assert.match(await valid.text(), /WebBridge browser test page/);
    const blocked = await fetch(new URL('/admin', fixture.url));
    assert.equal(blocked.status, 404);
  } finally { await fixture.close(); }
});
