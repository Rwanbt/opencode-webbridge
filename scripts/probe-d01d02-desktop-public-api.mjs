/** D01/D02: execute official pinned 2.0.32 IPC handler and renderer composition without Electron. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { strict as assert } from 'node:assert';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const TAG = '843a6c514e606b436a7fe713422ace0a93ad3d61';
export const FILES = Object.freeze({
  'packages/desktop/src/main/ipc-handlers/extensions.ts': '9f80ed828c60f217650ab32020fe3b41aae0aca0824291c4c8a4b71892f216e2',
  'packages/gui-extensions/src/renderer.ts': '78dac854aa8c923efeefd6c6d7c5be6dd08f81c1666185c926b5d1c37da1bc24',
  'packages/app/src/runtime/extension/builtins.ts': '2fd5755b7098e16462db8be9b02fd4b42d4343b1a9b50dc480fba847072c9d5a',
  'packages/plugin/src/promise/plugin.ts': '3990c2a177ebe917dcd8c94c25c4368d0e293c09e15ef9f8fdc7ce66bd86d081',
});

export async function loadOfficial(sourceRoot) {
  const entries = await Promise.all(Object.entries(FILES).map(async ([path, expected]) => {
    const source = sourceRoot
      ? await readFile(resolve(sourceRoot, path), 'utf8')
      : await fetch(`https://raw.githubusercontent.com/anomalyco/opencode/${TAG}/${path}`,
        { signal: AbortSignal.timeout(10_000) }).then((response) => {
          if (!response.ok || Number(response.headers.get('content-length')) > 65_536)
            throw new Error(`Official source unavailable: ${path}`);
          return response.text();
        });
    if (source.length > 65_536 || createHash('sha256').update(source).digest('hex') !== expected)
      throw new Error(`Official 2.0.32 source mismatch: ${path}`);
    return [path, source];
  }));
  return Object.fromEntries(entries);
}

function evaluateOfficial(source, requireModule) {
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  const module = { exports: {} };
  // The input is hash-pinned official code. This VM has no native require, filesystem or Electron.
  runInNewContext('(function(require, module, exports) { ' + compiled + '\n})',
    { Object, Error, Promise, AbortSignal, Uint8Array }, { timeout: 2000 })(requireModule, module, module.exports);
  return module.exports;
}

function runOfficialIpcHandler(source, packaged) {
  const calls = [];
  const app = { isPackaged: packaged };
  const ErrorType = class ExtensionError extends Error {};
  const extensions = { host: async () => {
    calls.push('host');
    return { install: async () => { calls.push('install'); }, source: async () => {
      calls.push('source'); return 'trusted';
    } };
  } };
  const token = (name) => ({ *[Symbol.iterator]() { return yield name; } });
  const Effect = {
    gen(generator) {
      const iterator = generator();
      let result = iterator.next();
      while (!result.done) {
        result = iterator.next(result.value === 'extensions' ? extensions : {});
      }
      return result.value;
    },
    tryPromise(input) { return async () => {
      try { return await input.try(); } catch (error) { throw input.catch(error); }
    }; },
    sync(fn) { return fn; },
    promise(fn) { return fn; },
  };
  const modules = {
    electron: { app, BrowserWindow: {} },
    effect: { Effect },
    '../../shared/ipc-rpc': { ExtensionRpcs: { toLayer: (value) => value, of: (value) => value } },
    '../extension/error': { ExtensionError: ErrorType, extensionFailure: (error) => error },
    '../extension': { Extensions: { Service: token('extensions') } },
    '../ipc-transport': { IpcPortHandoff: token('handoff') },
    '../windows/scheme': { isRendererUrl: () => true },
    './context': { sender: () => undefined },
  };
  const requireModule = (name) => {
    if (!(name in modules)) throw new Error(`Unknown official dependency: ${name}`);
    return modules[name];
  };
  return { handlers: evaluateOfficial(source, requireModule).extensionHandlers, calls };
}

export async function proveOfficialPublicApi(source) {
  const ipc = source['packages/desktop/src/main/ipc-handlers/extensions.ts'];
  const packaged = runOfficialIpcHandler(ipc, true);
  for (const [name, request] of [
    ['ExtensionInstall', { source: new Uint8Array([1]) }],
    ['ExtensionSource', { id: 'webbridge' }],
    ['ExtensionEnable', { id: 'webbridge' }],
    ['ExtensionReload', { id: 'webbridge' }],
  ]) {
    await assert.rejects(packaged.handlers[name](request)(), /unavailable/);
  }
  assert.deepEqual(packaged.calls, [], 'packaged IPC must reject before host effects');
  // Counterfactual: prove this harness actually detects removal of the packaged gate.
  const gate = 'if (app.isPackaged) throw new ExtensionError("unavailable")';
  assert.equal(ipc.split(gate).length, 2, 'packaged guard must appear exactly once');
  const unguarded = runOfficialIpcHandler(ipc.replace(gate, ''), true);
  await unguarded.handlers.ExtensionInstall({ source: new Uint8Array([1]) })();
  assert.deepEqual(unguarded.calls, ['host', 'install'], 'without gate, the effect must execute');
  const development = runOfficialIpcHandler(ipc, false);
  await development.handlers.ExtensionInstall({ source: new Uint8Array([1]) })();
  assert.deepEqual(development.calls, ['host', 'install'], 'developer branch must reach host');

  const sourceRenderer = source['packages/gui-extensions/src/renderer.ts'];
  const definitions = [
    'context', 'btw', 'debug', 'terminal', 'file', 'review', 'details', 'browser',
    'pairing', 'updater', 'ssh', 'wsl', 'microsoft-office',
  ];
  const renderer = evaluateOfficial(sourceRenderer, (name) => {
    if (name === './sdk') return { Extension: { compose: (...entries) => entries } };
    const id = name.replace(/^\.\//, '').replace(/\/renderer$/, '');
    if (!definitions.includes(id)) throw new Error(`Unknown renderer module: ${name}`);
    return { default: name.endsWith('/renderer') ? () => {} : { id } };
  }).builtins;
  assert.deepEqual(Array.from(renderer, (item) => item.id), definitions);
  const appBuiltins = source['packages/app/src/runtime/extension/builtins.ts'];
  assert.match(appBuiltins, /import\s*\{\s*builtins\s*\}\s*from\s*["']@opencode\/gui-extensions\/renderer["']/);
  const plugin = source['packages/plugin/src/promise/plugin.ts'];
  const context = plugin.match(/export interface Context\s*\{([\s\S]*?)^\}/m)?.[1];
  assert.ok(context, 'official server plugin Context missing');
  assert.match(context, /readonly provider: ProviderDomain/);
  assert.match(context, /readonly rpc: RpcDomain/);
  assert.doesNotMatch(context, /readonly (?:renderer|gui|browser):/);
  return { status: 'NO_GO_PACKAGED_GUI_EXTENSION', tag: TAG,
    packagedManagerCalls: packaged.calls.length, builtins: definitions.length,
    serverPluginRenderer: false, nativeDesktopExecuted: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = await loadOfficial(process.argv[2]);
  console.log('D01/D02 pinned official executable IPC negative:', JSON.stringify(await proveOfficialPublicApi(source)));
}
