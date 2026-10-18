/** Desktop/Electron qualification: the four proof levels stay separated, the
 *  capability gate never claims a packaged-Desktop run, the static official
 *  proof stays hash-pinned, and the levels document stays consistent with both.
 *  No packaged Desktop is ever executed here. */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  browserApiAvailable, desktopE2EProven, detectDesktopCapabilities, diagnostic,
} from "../src/core/desktop-capability.js";

/** Loaded by path at runtime: the probe is a script, never part of the compiled tree. */
const { FILES, TAG } = await import(
  pathToFileURL(resolve("scripts/probe-d01d02-desktop-public-api.mjs")).href
) as { readonly TAG: string; readonly FILES: Readonly<Record<string, string>> };

const ROOT = process.cwd();
const DOC = "docs/DESKTOP-LEVELS.fr.md";
const caps = (overrides: Record<string, unknown> = {}) => detectDesktopCapabilities({
  opencodeVersion: "2.0.32", hasRpc: true, hasPermission: true, hasBrowser: false,
  hasModelRegistration: true, desktopE2EAvailable: false, ...overrides,
});

test("no packaged-Desktop capability is ever claimed without an explicit attestation", () => {
  assert.equal(desktopE2EProven(caps()), false);
  assert.equal(desktopE2EProven(caps({ desktopE2EAvailable: true })), true,
    "only an explicit attestation may flip the Desktop E2E claim");
  assert.equal(browserApiAvailable(caps()), false, "a server plugin never gains a browser domain");
  const report = diagnostic(caps());
  assert.match(report, /Desktop E2E proven: false/);
  assert.match(report, /2\.0\.32/);
});

test("the static official proof stays pinned to exact official sources", () => {
  assert.match(TAG, /^[a-f0-9]{40}$/, "the official commit must be a pinned 40-hex SHA");
  const entries = Object.entries(FILES);
  assert.equal(entries.length, 4, "exactly the four reviewed official files are pinned");
  for (const [path, digest] of entries) {
    assert.match(path, /^packages\/.+\.ts$/);
    assert.match(digest, /^[a-f0-9]{64}$/, "each official file is content-pinned: " + path);
  }
  for (const required of [
    "packages/desktop/src/main/ipc-handlers/extensions.ts",
    "packages/gui-extensions/src/renderer.ts",
    "packages/app/src/runtime/extension/builtins.ts",
    "packages/plugin/src/promise/plugin.ts",
  ]) assert.ok(required in FILES, "the official proof must keep pinning " + required);
});

test("the levels document states each level and the real Desktop verdict, with no overclaim", async () => {
  const doc = await readFile(join(ROOT, DOC), "utf8");
  for (const phrase of [
    "**L1**", "**L2**", "**L3**", "**L4**",
    "NO_GO_PACKAGED_GUI_EXTENSION",
    "nativeDesktopExecuted: false",
    "nativeDesktopElectronE2E=false",
    "ExtensionInstall",
    "never replace system Desktop",
    "Contrefactuel",
    "Chemin de résolution",
  ]) assert.ok(doc.includes(phrase), "the levels document must state: " + phrase);
  // The document must not present a CLI result as a Desktop result.
  assert.match(doc, /ne disent \*\*rien\*\* du rendu ni du cycle de vie\s+Desktop/);
});
