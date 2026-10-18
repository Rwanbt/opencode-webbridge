import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { ExplicitCdpReadBridge } from '../src/browser/explicit-cdp-read.js';

const enabled = process.platform === 'linux' && process.env.G177_REAL_PTY === '1';
const npm = (args: string[], cwd: string) => {
  const result = spawnSync('npm', args, { cwd, encoding: 'utf8', timeout: 120_000,
    maxBuffer: 1024 * 1024, env: { ...process.env, npm_config_audit: 'false' } });
  assert.equal(result.status, 0, 'npm packaging failure: ' + (result.stderr ?? '').slice(-400));
  return result.stdout;
};
async function freePort() {
  const server = createServer();
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((ok) => server.close(() => ok()));
  return port;
}
test('G177 raw tarball-installed interactive operator authorizes one browser click, receives provisional DOM, no false finality',
  { skip: !enabled, timeout: 90_000 }, async () => {
    const temp = await mkdtemp(join(tmpdir(), 'g177-packed-'));
    const chromeProfile = await mkdtemp(join(tmpdir(), 'g177-chrome-'));
    const journal = await mkdtemp(join(tmpdir(), 'g177-journal-'));
    let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
    try {
      await access('/usr/bin/script');
      const meta = JSON.parse(npm(['pack', resolve('.'), '--json', '--pack-destination', temp], temp));
      const archive = join(temp, meta[0].filename);
      const prefix = join(temp, 'installed');
      npm(['install', archive, '--prefix', prefix, '--ignore-scripts', '--no-save',
        '--no-package-lock', '--no-audit', '--no-fund'], temp);
      const root = join(prefix, 'node_modules', 'opencode-webbridge');
      const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      assert.equal(manifest.bin['webbridge-manual-chatgpt'], './bin/webbridge-manual-chatgpt.mjs');
      const executable = join(root, 'bin', 'webbridge-manual-chatgpt.mjs');
      await access(join(root, 'dist/src/runtime/g166-chatgpt-manual-turn.js'));
      const port = await freePort();
      const endpoint = `http://127.0.0.1:${port}`;
      browser = await chromium.launchPersistentContext(chromeProfile, {
        headless: true, args: [`--remote-debugging-port=${port}`, '--no-first-run'],
        serviceWorkers: 'block', acceptDownloads: false,
      });
      const page = browser.pages()[0] ?? await browser.newPage();
      await page.route('https://chatgpt.com/**', (route) => route.fulfill({
        status: 200, contentType: 'text/html', body: `<body>
          <article data-turn="assistant" data-turn-id="old_answer"><div class="markdown">PRIVATE_OLD_REPLY</div></article>
          <div id="prompt-textarea" contenteditable="true" role="textbox"></div>
          <button data-testid="send-button" disabled>Send</button>
          <script>
          window.sent=[];
          const editor=document.getElementById('prompt-textarea'), button=document.querySelector('button');
          editor.addEventListener('input',()=>button.disabled=!editor.textContent.trim());
          button.addEventListener('click',()=>{
            window.sent.push(editor.textContent); editor.textContent='';button.disabled=true;
            setTimeout(()=>document.body.insertAdjacentHTML('beforeend',
              '<article data-turn="assistant" data-turn-id="new_answer"><div class="markdown">Fixture candidate</div></article>'),20);
          });
          </script></body>`,
      }));
      await page.goto('https://chatgpt.com/c/g177-fixture', { waitUntil: 'domcontentloaded' });
      const consent = { userDeclaresBrowserOwnership: true as const, approve: async () => true };
      const discovery = new ExplicitCdpReadBridge(endpoint, consent);
      await discovery.open();
      const tabID = (await discovery.tabs()).find((tab) => tab.providerID === 'chatgpt')?.tabID;
      discovery.close();
      assert.ok(tabID);
      const command = [process.execPath, executable, '--owned-browser', '--endpoint', endpoint,
        '--tab', tabID, '--session', 'session_g177', '--turn', 'turn_g177_once', '--journal', journal]
        .map((part) => JSON.stringify(part)).join(' ');
      const child = spawn('/usr/bin/script', ['-q', '-e', '-c', command, '/dev/null'], {
        cwd: temp, stdio: ['pipe', 'pipe', 'pipe'], env: process.env,
      });
      let output = '', errors = '', phase = 0;
      const prompts = [
        ['Confirm you own/control', 'YES\n'],
        ['Allow read-only assistant text', 'YES\n'],
        ['Enter exact prompt', 'G177 authorized test prompt\n'],
        ['Approve this exact prompt and target?', 'YES\n'],
      ] as const;
      child.stdout.on('data', (value: Buffer) => {
        output += value.toString();
        if (phase < prompts.length && output.includes(prompts[phase][0])) {
          child.stdin.write(prompts[phase][1]);
          phase++;
        }
      });
      child.stderr.on('data', (value: Buffer) => { errors += value.toString(); });
      const code = await new Promise<number | null>((ok, bad) => {
        child.once('error', bad);
        child.once('close', ok);
      });
      assert.equal(code, 0, 'installed command failed: ' + errors + output.slice(-1400));
      assert.equal(phase, 4, 'not all human approvals were requested');
      assert.match(output, /\[UNVERIFIED\] Fixture candidate/);
      assert.match(output, /TERMINAL UNCERTAIN: provider-finality-unverified/);
      assert.doesNotMatch(output, /PRIVATE_OLD_REPLY/);
      assert.deepEqual(await page.evaluate(() => (window as unknown as {sent: string[]}).sent),
        ['G177 authorized test prompt']);
    } finally {
      await browser?.close();
      await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await rm(chromeProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      await rm(journal, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
