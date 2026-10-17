import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const positional = [];
let expectedSha256;
let archivePath;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--sha256') expectedSha256 = args[++i];
  else if (args[i] === '--archive') archivePath = args[++i];
  else positional.push(args[i]);
}
const [dirArg, versionArg] = positional;
if (!dirArg) {
  console.error('usage: node scripts/diagnose-install.mjs <installed-plugin-dir> [expected-version] [--archive <tarball> --sha256 <hex>]');
  process.exit(2);
}

const own = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const target = resolve(dirArg);

let manifest = null;
const manifestPath = resolve(target, 'package.json');
if (existsSync(manifestPath)) {
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { manifest = null; }
}

let configRaw;
const configPath = resolve(target, 'webbridge.config.json');
if (existsSync(configPath)) {
  try { configRaw = JSON.parse(readFileSync(configPath, 'utf8')); } catch { configRaw = null; }
}

const observedSha256 = archivePath && existsSync(archivePath)
  ? createHash('sha256').update(readFileSync(archivePath)).digest('hex')
  : undefined;

const { diagnoseInstall } = await import(pathToFileURL(resolve(root, 'dist/src/core/install-diagnostics.js')).href);
const report = diagnoseInstall({
  manifest,
  expectedName: own.name,
  expectedVersion: versionArg ?? own.version,
  configRaw,
  expectedSha256,
  observedSha256,
});

if (report.ok) {
  const advisories = report.advisories.length ? `; advisories: ${report.advisories.join(', ')}` : '';
  console.log(`Install diagnostics PASS: ${own.name}@${report.version}${advisories}`);
  process.exit(0);
}
console.error(`Install diagnostics FAIL: ${report.findings.join(', ')}`);
process.exit(1);
