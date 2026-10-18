/** Packaging/documentation contract: the install guide states only verified
 *  compatibility, the changelog invents no released version, and no shipped
 *  instruction ever tells an operator to copy `dist/` by hand. */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (file: string) => readFile(join(ROOT, file), "utf8");
const INSTALL = "docs/INSTALL.fr.md";
const CHANGELOG = "CHANGELOG.md";
const SHIPPED = ["README.md", INSTALL, "SECURITY.md", CHANGELOG];

test("the install guide claims only verified compatibility and pinned versions", async () => {
  const doc = await read(INSTALL);
  for (const phrase of [
    "**Linux**", "**Windows**", "**macOS**", "**NON VÉRIFIÉ**",
    "**Desktop/Electron packagé**", "**NON PROUVÉ**",
    "OpenCode CLI 2.0.32", "Node **>= 22.19.0**", "@opencode/plugin` **2.0.29**",
    "npm pack", "opencode-webbridge-0.0.0.tgz", "npm install -g",
    "npm uninstall -g opencode-webbridge",
    "WEBBRIDGE_NATIVE_WEB_MODELS", "WEBBRIDGE_NATIVE_TAB_<PROVIDER>",
    "WEBBRIDGE_NATIVE_JOURNAL_DIR", "WEBBRIDGE_PERSONAL_READONLY_TOOLS",
    "WEBBRIDGE_PERSONAL_WORKSPACE",
    "diagnose-install.mjs", "check:sbom", "check:release",
    "sha256", "NO-GO-PRODUCTION",
  ]) assert.ok(doc.includes(phrase), "the install guide must state: " + phrase);
  // macOS must be described as unverified, never silently omitted or claimed.
  assert.match(doc, /\*\*macOS\*\* \| \*\*NON VÉRIFIÉ\*\*/);
});

test("the changelog invents no release and points at real pull requests", async () => {
  const changelog = await read(CHANGELOG);
  assert.match(changelog, /^## Unreleased$/m, "everything lands under Unreleased");
  assert.doesNotMatch(changelog, /^## \[?\d+\.\d+\.\d+/m, "no released version may be invented");
  assert.match(changelog, /NO-GO-PRODUCTION/);
  const refs = [...changelog.matchAll(/#(\d{3})\b/g)].map((match) => Number(match[1]));
  assert.ok(refs.length >= 15, "the changelog must reference the wave's pull requests");
  for (const pr of refs) {
    assert.ok(pr >= 230 && pr <= 300, `suspicious pull request reference: #${pr}`);
  }
});

test("no shipped document instructs copying the compiled output by hand", async () => {
  for (const file of SHIPPED) {
    const text = await read(file);
    assert.doesNotMatch(text, /cp\s+-r\s+dist|copy\s+(?:the\s+)?dist\s+(?:folder|directory)|copier\s+dist/i,
      file + ": a manual dist copy must never be instructed");
  }
  const install = await read(INSTALL);
  assert.match(install, /copier `dist\/` à la main/, "the guide must explicitly forbid it");
});
