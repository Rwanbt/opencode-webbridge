/** Public plugin browser capability: the absence must be a recorded, re-derivable
 *  fact (not an assumption), and the upstream request must stay wired to the
 *  consumption contract this repository already implements. */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DOC = join(ROOT, 'docs/proposals/plugin-browser-capability.fr.md');
const probe = await import(
  pathToFileURL(resolve('scripts/probe-plugin-browser-capability.mjs')).href
) as {
  readonly probePluginBrowserCapability: () => Promise<{
    status: string;
    pluginVersion: string;
    domains: string[];
    browserDomain: boolean;
    browserMentioned: boolean;
    requestedCapability: string;
    requestedShape: string;
    consumerContract: string[];
    nativeDesktopExecuted: boolean;
  }>;
  readonly REQUESTED_CAPABILITY: { api: string; permissionActions: readonly string[] };
  readonly CONSUMER_CONTRACT: readonly string[];
};

/** Sorted domains observed on the pinned public SDK. A future SDK that adds a
 *  browser domain (or a browser capability declaration) fails this pin, which is
 *  the intended alarm: WebBridge must then adopt the public capability. */
const PINNED_DOMAINS = [
  'app', 'host', 'options', 'permission', 'rpc', 'runtime-modules', 'runtime',
  'source.bun', 'source', 'source.node', 'source.package', 'storage', 'worktree',
];

test('the pinned public plugin SDK exposes no browser capability', async () => {
  const first = await probe.probePluginBrowserCapability();
  const second = await probe.probePluginBrowserCapability();
  assert.deepEqual(first, second, 'the probe must be deterministic');
  assert.equal(first.status, 'NO_PUBLIC_PLUGIN_BROWSER_CAPABILITY');
  assert.equal(first.browserDomain, false);
  assert.equal(first.browserMentioned, false);
  assert.equal(first.nativeDesktopExecuted, false);
  assert.deepEqual([...first.domains].sort(), [...PINNED_DOMAINS].sort());
  assert.match(first.pluginVersion, /^\d+\.\d+\.\d+$/);
});

test('the request is stated against the exact consumption contract', async () => {
  const result = await probe.probePluginBrowserCapability();
  assert.equal(result.requestedCapability, probe.REQUESTED_CAPABILITY.api);
  assert.deepEqual(result.consumerContract, [...probe.CONSUMER_CONTRACT]);
  assert.deepEqual([...probe.CONSUMER_CONTRACT].sort(),
    ['cancel', 'claim', 'events', 'release', 'submit']);
  assert.deepEqual([...probe.REQUESTED_CAPABILITY.permissionActions].sort(),
    ['browser', 'webbridge_browser']);
});

test('the upstream proposal states the capability, the mapping and no fake support', async () => {
  const doc = await readFile(DOC, 'utf8');
  assert.match(doc, /Propriété de navigation et d'onglet|navigation et d'onglet|ctx\.browser/);
  for (const anchor of [
    'ctx.browser',
    'BrowserHostRegistration',
    'browser-host-capability.ts',
    'claim', 'submit', 'events', 'cancel', 'release',
    'webbridge_browser',
    'NO PUBLIC',
  ]) {
    assert.ok(doc.includes(anchor), 'the proposal must state: ' + anchor);
  }
  // The proposal must never claim the capability exists today.
  assert.doesNotMatch(doc, /ctx\.browser\s*est\s*(disponible|présent|fourni)/i);
  assert.match(doc, /Statut\s*:\s*\*\*proposition\*\*/);
});

test('the upstream issue draft is ready to file and stays honest', async () => {
  const issue = await readFile(join(ROOT, 'docs/proposals/upstream/browser-capability-issue.md'), 'utf8');
  for (const anchor of [
    'ctx.browser', 'BrowserCapability', 'BrowserTab', 'plugin_browser',
    'Acceptance criteria', 'Non-goals', 'ready to file', 'check:d01d02',
    'generation', 'release()',
  ]) {
    assert.ok(issue.includes(anchor), 'the issue draft must state: ' + anchor);
  }
  // It is a draft, never presented as already filed, and never claims availability.
  assert.match(issue, /Not filed/i);
  assert.doesNotMatch(issue, /ctx\.browser\s+is\s+(available|implemented|shipped)/i);
  // It names the workaround honestly.
  assert.match(issue, /remote-debugging-port/);
});

test('the upstream PR draft is ready to submit and stays honest', async () => {
  const pr = await readFile(join(ROOT, 'docs/proposals/upstream/browser-capability-pr.md'), 'utf8');
  for (const anchor of [
    'ctx.browser', 'BrowserCapability', 'BrowserTab', 'plugin_browser',
    'generation', 'release()', 'revoke', 'packaged Desktop',
  ]) {
    assert.ok(pr.includes(anchor), 'the PR draft must state: ' + anchor);
  }
  assert.match(pr, /ready to submit/i);
  assert.match(pr, /never touches the upstream remote/i);
  assert.doesNotMatch(pr, /ctx\.browser\s+is\s+(available|implemented|shipped)/i);
  // It must never present the spec as an already-applied change.
  assert.match(pr, /specification\*, not a compilable diff|\*specification\*, not a compilable diff/);
});


