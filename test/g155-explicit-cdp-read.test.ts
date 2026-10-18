import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { ExplicitCdpReadBridge } from '../src/browser/explicit-cdp-read.js';

const approved = { userDeclaresBrowserOwnership: true as const,
  approve: async () => true };
const refused = { ...approved, approve: async () => false };
const port = async () => {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const selected = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return selected;
};
const target = (portNumber: number, url: string, id = 'A1234567') => ({
  id, type: 'page', url, webSocketDebuggerUrl: `ws://127.0.0.1:${portNumber}/devtools/page/${id}`,
});
async function mockInventory(run: (endpoint: string, set: (targets: object[]) => void) => Promise<void>) {
  let entries: object[] = [];
  const server = createServer((request, response) => {
    if (request.url !== '/json/list') { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(entries));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address() as { port: number };
  try { await run(`http://127.0.0.1:${address.port}`, (targets) => { entries = targets; }); }
  finally { await new Promise<void>((done) => server.close(() => done())); }
}

test('G155 rejects remote, implicit, credentials, path or spoofed loopback CDP endpoints', () => {
  for (const candidate of ['http://localhost:9222', 'http://127.0.0.2:9222',
    'http://evil.example:9222', 'http://127.0.0.1:9222/json',
    'http://127.0.0.1:9222?x=1', 'http://admin@127.0.0.1:9222',
    'https://127.0.0.1:9222', 'http://127.0.0.1', 'file:///tmp/devtools']) {
    assert.throws(() => new ExplicitCdpReadBridge(candidate, approved), /denied/);
  }
  assert.throws(() => new ExplicitCdpReadBridge('http://127.0.0.1:9222',
    { userDeclaresBrowserOwnership: false as never, approve: async () => true }), /denied/);
});

test('G155 host consent denied before even issuing /json/list', async () => {
  await mockInventory(async (endpoint) => {
    const bridge = new ExplicitCdpReadBridge(endpoint, refused);
    await assert.rejects(bridge.open(), /permission/);
    await assert.rejects(bridge.tabs(), /not live/);
  });
});

test('G155 five exact origins only, replacement invalidates capability and cross-origin is refused', async () => {
  await mockInventory(async (endpoint, set) => {
    const p = Number(new URL(endpoint).port);
    const bridge = new ExplicitCdpReadBridge(endpoint, approved);
    await bridge.open();
    const origins = ['https://chatgpt.com', 'https://chat.deepseek.com',
      'https://gemini.google.com', 'https://chat.qwen.ai', 'https://chat.mistral.ai'];
    set([...origins.map((s, i) => target(p, s + '/c/' + i, 'A123456' + i)),
      target(p, 'http://chatgpt.com', 'BAD1'),
      target(p, 'https://chatgpt.com.evil.example', 'BAD2'),
      target(p, 'https://user:pass@chatgpt.com', 'BAD3'),
      { ...target(p, origins[0], 'BAD4'), webSocketDebuggerUrl: 'ws://evil.example:9222/devtools/page/BAD4' },
    ]);
    const tabs = await bridge.tabs();
    assert.deepEqual(tabs.map((t) => new URL(t.url).origin).sort(), origins.sort());
    assert.deepEqual(new Set(tabs.map((t) => t.providerID)),
      new Set(['chatgpt','deepseek','gemini','qwen','mistral']));
    set([target(p, 'https://chatgpt.com/another', 'A1234560')]);
    const changed = await bridge.tabs();
    assert.ok(changed[0].generation > tabs[0].generation);
    await assert.rejects(bridge.verify(tabs[0]), /replaced/);
    await assert.rejects(bridge.headings(tabs[0]), /replaced/);
    set([]);
    assert.equal((await bridge.tabs()).length, 0);
    set([target(p, 'https://chatgpt.com/another', 'A1234560')]);
    assert.ok((await bridge.tabs())[0].generation > changed[0].generation);
    bridge.close();
    await assert.rejects(bridge.tabs(), /not live/);
  });
});

test('G155 real Linux Chromium debug port: read headings only, reject navigation and revoked session',
  { skip: process.platform !== 'linux' || process.env.G155_REAL_CDP !== '1' },
  async () => {
    const profile = await mkdtemp(join(tmpdir(), 'g155-cdp-'));
    const debugPort = await port();
    let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
    try {
      context = await chromium.launchPersistentContext(profile, {
        headless: true, args: [`--remote-debugging-port=${debugPort}`, '--no-first-run'],
        serviceWorkers: 'block', acceptDownloads: false,
      });
      const page = context.pages()[0] ?? await context.newPage();
      await page.route('https://chatgpt.com/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'text/html',
          body: '<html><body><h1>G155 Local Headline</h1><input type="password" value="PRIVATE-TOKEN-DO-NOT-RETURN"></body></html>' });
      });
      await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
      const bridge = new ExplicitCdpReadBridge(`http://127.0.0.1:${debugPort}`, approved);
      await bridge.open();
      const tabs = await bridge.tabs();
      const selected = tabs.find((tab) => new URL(tab.url).origin === 'https://chatgpt.com');
      assert.ok(selected, 'real Chromium did not expose the permitted target');
      const result = await bridge.readOnlyPage(selected);
      assert.equal(result.providerID, 'chatgpt');
      assert.equal(result.tabID, selected.tabID);
      assert.ok(result.headings.some((s) => s.includes('G155 Local Headline')));
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE-TOKEN-DO-NOT-RETURN/);
      await page.goto('about:blank');
      await assert.rejects(bridge.headings(selected), /replaced/);
      bridge.close();
      await assert.rejects(bridge.tabs(), /not live/);
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
