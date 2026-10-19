#!/usr/bin/env node
/** Deploy the built plugin into the directory OpenCode ACTUALLY loads.
 *
 *  Why this exists: on 2026-10-19 a whole session of changes was green in CI and
 *  live-verified in the worktree while OpenCode kept loading an older copy from
 *  the custom-plugins directory. Every turn failed with "Model unavailable" and
 *  the cause was invisible. Deploying is part of shipping, so it is a command
 *  with a verification step, not a paragraph in a document.
 *
 *  Usage:
 *    npm run build
 *    node scripts/deploy-local.mjs [--target <custom-plugins/opencode-webbridge>]
 *
 *  It copies dist/src into <target>/dist/src, then proves the markers that matter
 *  are present in the deployed files. A missing marker is a failure, never a
 *  warning. It never touches the user's browser, profile or provider accounts.
 */
import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = join(root, "dist", "src");

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function defaultTarget() {
  const localApp = process.env.LOCALAPPDATA;
  if (localApp) {
    return join(localApp, "OpenCode", "custom-plugins", "opencode-webbridge");
  }
  return undefined;
}

const target = resolve(argument("--target") ?? defaultTarget() ?? "");
if (!argument("--target") && !defaultTarget()) {
  console.error("deploy: no target. Pass --target <custom-plugins/opencode-webbridge>.");
  process.exit(2);
}
if (!existsSync(built) || !statSync(built).isDirectory()) {
  console.error("deploy: " + built + " is missing. Run `npm run build` first.");
  process.exit(2);
}
if (!existsSync(target)) {
  console.error("deploy: target does not exist: " + target);
  console.error("deploy: install the plugin once, or pass --target explicitly.");
  process.exit(2);
}

const destination = join(target, "dist", "src");
cpSync(built, destination, { recursive: true, force: true });

/** Each marker is a behaviour that must be present where OpenCode reads it. */
const markers = [
  { file: join(destination, "native", "registration.js"), text: 'WEB_PROVIDER_ID = "webbridge"', why: "single provider" },
  { file: join(destination, "browser", "cdp-page.js"), text: "Input.insertText", why: "real typing" },
  { file: join(destination, "browser", "cdp-page.js"), text: "Input.dispatchMouseEvent", why: "real click" },
  { file: join(destination, "browser", "tab-page-state.js"), text: "home/new-chat page", why: "page-state guard" },
];

const missing = [];
for (const marker of markers) {
  if (!existsSync(marker.file)) { missing.push(marker.why + " (file missing: " + marker.file + ")"); continue; }
  if (!readFileSync(marker.file, "utf8").includes(marker.text)) missing.push(marker.why);
}

if (missing.length > 0) {
  console.error("deploy: deployed files are missing expected behaviour:");
  for (const item of missing) console.error("  - " + item);
  process.exit(1);
}

console.log("deploy: copied " + built + " -> " + destination);
console.log("deploy: verified " + markers.length + " markers (" + markers.map((m) => m.why).join(", ") + ")");
console.log("deploy: RESTART OpenCode so the new plugin module is loaded.");
console.log("deploy: the running server keeps the plugin it loaded at startup.");
