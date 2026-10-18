/** Deterministic probe: does the installed public plugin SDK expose a browser
 *  capability a server plugin could use to drive the OpenCode integrated browser?
 *
 *  The consumption side already exists in this repository
 *  (`src/core/browser-host-capability.ts`: a host supplies a `BrowserHostRegistration`).
 *  This probe pins the PRODUCTION side of the public surface, so the gap is a
 *  recorded fact rather than an assumption, and so a future SDK that adds the
 *  capability makes the guard fail loudly instead of drifting silently.
 *
 *  Reads only the published type surface of `@opencode/plugin` under `node_modules`:
 *  no network, no browser, no account, no Desktop. Exits 0 when the surface is
 *  understood; exits 1 (fail-closed) when it cannot be read as expected.
 *
 *  Usage: node scripts/probe-plugin-browser-capability.mjs [--json] */
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SDK_DIR = resolve(ROOT, 'node_modules/@opencode/plugin');

/** Minimal public capability WebBridge needs; mirrors BrowserHostRegistration. */
export const REQUESTED_CAPABILITY = Object.freeze({
  api: 'ctx.browser',
  shape: '{ claim(binding), submit(binding, request), events(binding, turnID, afterSeq), cancel(binding, turnID), release(binding) }',
  mapping: 'BrowserHostRegistration (src/core/browser-host-capability.ts)',
  permissionActions: ['browser', 'webbridge_browser'],
});

/** The consumption contract this repository already implements and tests. */
export const CONSUMER_CONTRACT = Object.freeze([
  'claim', 'submit', 'events', 'cancel', 'release',
]);

const domainOf = (file) => file.replace(/\.d\.ts$/, '');

/** Pure: same inputs always produce the same verdict. */
export function verdict({ pluginVersion, domains, filesContainingBrowser }) {
  const browserDomain = domains.includes('browser');
  const browserMentioned = filesContainingBrowser.length > 0;
  const status = browserDomain || browserMentioned
    ? 'PUBLIC_PLUGIN_BROWSER_CAPABILITY_PRESENT'
    : 'NO_PUBLIC_PLUGIN_BROWSER_CAPABILITY';
  return {
    status,
    pluginVersion,
    domains,
    browserDomain,
    browserMentioned,
    requestedCapability: REQUESTED_CAPABILITY.api,
    requestedShape: REQUESTED_CAPABILITY.shape,
    consumerContract: CONSUMER_CONTRACT,
    nativeDesktopExecuted: false,
  };
}

export async function probePluginBrowserCapability() {
  const manifest = JSON.parse(await readFile(resolve(SDK_DIR, 'package.json'), 'utf8'));
  const entries = await readdir(resolve(SDK_DIR, 'dist'));
  const declarators = entries.filter((name) => name.endsWith('.d.ts')).sort();
  if (declarators.length === 0) throw new Error('public SDK surface unreadable: no .d.ts declarations');
  const domains = declarators.map(domainOf);
  const filesContainingBrowser = [];
  for (const name of declarators) {
    const text = await readFile(resolve(SDK_DIR, 'dist', name), 'utf8');
    // A real capability must be *declared*; a passing mention in a comment is not one.
    if (/\bbrowser\b\s*[?:)]/.test(text) || /\bbrowser\b.*\b(capability|port|tab|driver)\b/i.test(text)) {
      filesContainingBrowser.push(name);
    }
  }
  return verdict({ pluginVersion: manifest.version, domains, filesContainingBrowser });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await probePluginBrowserCapability();
    console.log(JSON.stringify(result));
    process.exit(result.status === 'PUBLIC_PLUGIN_BROWSER_CAPABILITY_PRESENT' ? 2 : 0);
  } catch (error) {
    console.error(JSON.stringify({ status: 'PROBE_FAILED_CLOSED', error: String(error?.message ?? error) }));
    process.exit(1);
  }
}
