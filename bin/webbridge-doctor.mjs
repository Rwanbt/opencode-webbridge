#!/usr/bin/env node
/** WebBridge doctor — read-only setup check and ready-to-paste configuration.
 *
 *  It NEVER reads cookies, tokens or passwords, NEVER sends a prompt and NEVER
 *  modifies the browser. It only reads the public CDP inventory
 *  (`/json/version`, `/json/list`) on an explicit loopback endpoint and checks
 *  the local journal directory.
 *
 *  Usage:
 *    webbridge-doctor [--endpoint http://127.0.0.1:9222] [--journal <dir>] [--json]
 */
import { lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Single-sourced provider origins (mirrors src/catalog.ts). */
export const PROVIDERS = [
  { id: 'chatgpt', origin: 'https://chatgpt.com', label: 'ChatGPT' },
  { id: 'deepseek', origin: 'https://chat.deepseek.com', label: 'DeepSeek' },
  { id: 'gemini', origin: 'https://gemini.google.com', label: 'Gemini' },
  { id: 'qwen', origin: 'https://chat.qwen.ai', label: 'Qwen' },
  { id: 'mistral', origin: 'https://chat.mistral.ai', label: 'Mistral Le Chat' },
];

export const tabEnv = (id) => 'WEBBRIDGE_NATIVE_TAB_' + id.toUpperCase();

/** Pure: the exact configuration lines an operator can paste. */
export function configLines({ endpoint, journalDir, tabs }) {
  const declared = tabs.filter((tab) => tab.tabID).map((tab) => tab.id);
  const lines = [];
  lines.push('export WEBBRIDGE_NATIVE_WEB_MODELS=' + declared.join(','));
  for (const tab of tabs) {
    if (tab.tabID) lines.push('export ' + tabEnv(tab.id) + '=' + endpoint + '#' + tab.tabID);
  }
  lines.push('export WEBBRIDGE_NATIVE_JOURNAL_DIR=' + journalDir);
  return lines;
}

const originOf = (raw) => { try { return new URL(raw).origin; } catch { return null; } };

/** Read-only inventory: maps the live CDP pages onto the five providers. */
export async function inventory(endpoint) {
  const response = await fetch(endpoint + '/json/list', {
    redirect: 'error', signal: AbortSignal.timeout(5000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('CDP inventory unavailable (HTTP ' + response.status + ')');
  const list = await response.json();
  if (!Array.isArray(list)) throw new Error('CDP inventory is not a JSON array');
  return list
    .filter((item) => item && item.type === 'page' && typeof item.id === 'string')
    .map((item) => ({ tabID: item.id, url: typeof item.url === 'string' ? item.url : '' }));
}

async function journalState(dir) {
  if (!dir) return { configured: false };
  try {
    const info = await lstat(dir);
    const privateEnough = process.platform === 'win32' || (info.mode & 0o077) === 0;
    return { configured: true, directory: info.isDirectory() && !info.isSymbolicLink(),
      privateEnough };
  } catch {
    return { configured: true, directory: false, privateEnough: false };
  }
}

export async function diagnose({ endpoint = 'http://127.0.0.1:9222', journalDir, models } = {}) {
  const result = { endpoint, version: null, providers: [], journal: null, errors: [] };
  try {
    const version = await fetch(endpoint + '/json/version', {
      redirect: 'error', signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' },
    });
    if (!version.ok) throw new Error('HTTP ' + version.status);
    result.version = (await version.json()).Browser ?? 'unknown';
  } catch (error) {
    result.errors.push('endpoint ' + endpoint + ' unreachable: ' + String(error.message));
    return result;
  }
  const pages = await inventory(endpoint);
  result.providers = PROVIDERS.map((provider) => {
    const matches = pages.filter((page) => originOf(page.url) === provider.origin);
    return { ...provider, tabs: matches.length, tabID: matches.length === 1 ? matches[0].tabID : null };
  });
  result.journal = await journalState(journalDir);
  if (models) {
    const wanted = String(models).split(',').map((v) => v.trim()).filter(Boolean);
    for (const id of wanted) {
      if (!PROVIDERS.some((provider) => provider.id === id))
        result.errors.push('WEBBRIDGE_NATIVE_WEB_MODELS lists unknown provider "' + id + '"');
    }
  }
  return result;
}

function render(result, { journalDir }) {
  const lines = [];
  lines.push('WebBridge doctor — endpoint ' + result.endpoint);
  if (result.version) lines.push('[ok] browser: ' + result.version);
  for (const error of result.errors) lines.push('[fail] ' + error);
  for (const provider of result.providers) {
    if (provider.tabs === 1) lines.push('[ok] ' + provider.id + ': 1 tab (' + provider.tabID + ')');
    else if (provider.tabs === 0) lines.push('[--] ' + provider.id + ': no tab at ' + provider.origin);
    else lines.push('[warn] ' + provider.id + ': ' + provider.tabs + ' tabs — declare exactly one');
  }
  if (result.journal?.configured) {
    if (result.journal.directory && result.journal.privateEnough) lines.push('[ok] journal: private directory');
    else lines.push('[fail] journal: must be an existing private directory');
  } else {
    lines.push('[--] journal: not provided (required once a tab is declared)');
  }
  const ready = result.providers.filter((provider) => provider.tabID);
  if (ready.length) {
    lines.push('');
    lines.push('Suggested configuration:');
    for (const line of configLines({ endpoint: result.endpoint,
      journalDir: journalDir ?? '<private-journal-dir>', tabs: result.providers }))
      lines.push('  ' + line);
    lines.push('');
    lines.push('Then: opencode run --model webbridge-' + ready[0].id + '/' + ready[0].id + '-web "..."');
  }
  return lines.join('\n');
}

function parse(argv) {
  const out = { endpoint: 'http://127.0.0.1:9222', journalDir: process.env.WEBBRIDGE_NATIVE_JOURNAL_DIR,
    models: process.env.WEBBRIDGE_NATIVE_WEB_MODELS, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--endpoint') out.endpoint = argv[++i];
    else if (arg === '--journal') out.journalDir = argv[++i];
    else if (arg === '--json') out.json = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error('unknown argument: ' + arg);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parse(process.argv.slice(2));
    if (options.help) {
      console.log('Usage: webbridge-doctor [--endpoint http://127.0.0.1:9222] [--journal <dir>] [--json]');
      process.exit(0);
    }
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(options.endpoint))
      throw new Error('--endpoint must be an explicit loopback origin (http://127.0.0.1:<port>)');
    const result = await diagnose(options);
    if (options.json) console.log(JSON.stringify(result));
    else console.log(render(result, options));
    process.exit(result.errors.length ? 1 : 0);
  } catch (error) {
    console.error('webbridge-doctor: ' + String(error?.message ?? error));
    process.exit(2);
  }
}
