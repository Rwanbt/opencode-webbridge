import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'planning/compatibility.json');
const compat = JSON.parse(readFileSync(path, 'utf8'));
const ensure = (valid, reason) => { if (!valid) throw new Error(`Compatibility guard: ${reason}`); };

const UPSTREAM_SHA = '4617210822bdbb31e5749751afbfb4584ccedac8';
const PATCH = 'docs/patches/opencode-v2-4617210-browser-plugin-capability.patch';
const COMMERCIAL = ['chatgpt', 'deepseek', 'gemini', 'qwen', 'mistral'];

ensure(compat.schemaVersion === 1, 'unsupported schema');
ensure(compat.observedAt === '2026-10-17', 'observation requires a new review');
ensure(Object.keys(compat).sort().join(',') ===
  'browserWritesEnabled,observedAt,operatingSystems,products,providers,reference,schemaVersion', 'unexpected fields');

const reference = compat.reference;
ensure(reference && Object.keys(reference).sort().join(',') === 'patch,upstreamRepo,upstreamSHA', 'reference fields');
ensure(reference.upstreamRepo === 'https://github.com/anomalyco/opencode', 'upstream repo');
ensure(reference.upstreamSHA === UPSTREAM_SHA, 'upstream revision is not the pinned proof');
ensure(reference.patch === PATCH && existsSync(resolve(root, reference.patch)), 'patch reference');

ensure(Array.isArray(compat.products) && compat.products.length === 2, 'product count');
ensure(compat.products.every((p) => Object.keys(p).sort().join(',') === 'evidence,id,limits,proven,scope,version'), 'product fields');
const byProduct = Object.fromEntries(compat.products.map((p) => [p.id, p]));
const cli = byProduct['opencode-cli'];
const desktop = byProduct['opencode-desktop-electron'];
ensure(cli && desktop, 'exact products');
ensure(cli.version === '2.0.29' && cli.scope === 'native-fixture' && cli.proven === true, 'cli scope');
ensure(desktop.version === '2.0.32' && desktop.scope === 'desktop' && desktop.proven === false, 'desktop can never be claimed proven');
for (const p of compat.products) {
  ensure(typeof p.evidence === 'string' && p.evidence.length >= 16 && typeof p.limits === 'string' && p.limits.length >= 16, `evidence/limits ${p.id}`);
}

const os = compat.operatingSystems;
ensure(Array.isArray(os) && os.length === 2 && os.map((o) => o.id).sort().join(',') === 'linux,windows', 'os matrix');
ensure(os.every((o) => Object.keys(o).sort().join(',') === 'evidence,id,proven'), 'os fields');
const linux = os.find((o) => o.id === 'linux');
const windows = os.find((o) => o.id === 'windows');
ensure(linux.proven === 'full-native-fixture', 'linux full native fixture');
ensure(windows.proven === 'bounded-rpc-only', 'windows bounded rpc only');
for (const o of os) ensure(typeof o.evidence === 'string' && o.evidence.length >= 16, `os evidence ${o.id}`);

const providers = compat.providers;
ensure(providers && Object.keys(providers).sort().join(',') === 'commercial,liveAutomationAuthorized,operational', 'providers fields');
ensure(providers.commercial.join(',') === COMMERCIAL.join(','), 'exact commercial set');
ensure(providers.operational === 0, 'commercial providers remain non-operational');
ensure(providers.liveAutomationAuthorized === false, 'live commercial automation is not authorized');

ensure(compat.browserWritesEnabled === false, 'browser writes remain disabled');

console.log('Compatibility guard PASS: opencode-cli 2.0.29 native-fixture on linux full native fixture; ' +
  'windows bounded-rpc-only; opencode-desktop-electron 2.0.32 desktop NOT PROVEN; 0/5 commercial; writes disabled');
