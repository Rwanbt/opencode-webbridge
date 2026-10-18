/** Qualification report contract: the committed document must be exactly what the
 *  generator produces from the planning sources (no drift), it must state the
 *  exact release verdict and pull-request inventory, and it must never claim a
 *  production-ready state that the evidence does not support. */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const DOC = join(ROOT, "docs/QUALIFICATION.fr.md");
const generator = await import(
  pathToFileURL(resolve("scripts/generate-qualification.mjs")).href
) as {
  readonly loadSources: () => Promise<{
    backlog: { stories: Array<{ id: string }> };
    acceptance: { stories: Array<{ id: string; level: string }>; gate: string };
    progress: {
      acceptance: Record<string, unknown>;
      evidence: Array<{ pr: number; sha: string; checks: number; scope: string }>;
      unverified: unknown[];
      blockers: unknown[];
    };
    posture: {
      decision: string;
      allowedClaims: Record<string, unknown>;
      blockers: Array<{ id: string; status: string; evidence: string }>;
    };
  }>;
  readonly renderQualification: (sources: unknown) => string;
  readonly REQUIRED_CONSENTS: readonly string[];
};
/** Generated with LF; compare after normalising whatever the checkout produced. */
const normalize = (text: string) => text.replace(/\r\n/g, "\n");

test("the committed qualification report is exactly what the generator produces", async () => {
  const sources = await generator.loadSources();
  const rendered = normalize(generator.renderQualification(sources));
  const committed = normalize(await readFile(DOC, "utf8"));
  assert.equal(committed, rendered,
    "docs/QUALIFICATION.fr.md drifted from the planning sources: run `npm run docs:qualification`");
});

test("the report states the exact release verdict, blockers and indicator values", async () => {
  const sources = await generator.loadSources();
  const doc = normalize(await readFile(DOC, "utf8"));
  assert.equal(sources.posture.decision, "NO-GO-PRODUCTION");
  assert.match(doc, /NO-GO-PRODUCTION/);
  assert.equal((sources.progress.acceptance.productionAcceptedStoryIDs as string[]).length, 0);
  assert.equal((sources.progress.acceptance.commercialProvidersOperational as string[]).length, 0);
  assert.equal(sources.progress.acceptance.nativeDesktopElectronE2E, false);
  assert.equal(sources.progress.acceptance.atomicCoreChromiumRevocation, false);
  assert.equal(sources.progress.acceptance.commercialAutomationAuthorized, false);
  assert.equal(sources.progress.acceptance.webbridgeWritesEnabled, false);
  // Every release-posture blocker must be listed with its own evidence row.
  assert.ok(sources.posture.blockers.length >= 5, "the release blockers must stay enumerated");
  for (const blocker of sources.posture.blockers) {
    assert.ok(doc.includes("`" + blocker.id + "`"), "blocker missing from report: " + blocker.id);
  }
  assert.match(doc, /Stories acceptées production : \*\*0\/54\*\*/);
  assert.match(doc, new RegExp("preuves partielles enregistrées : \\*\\*" + sources.progress.evidence.length + "\\*\\*"));
});

test("the wave inventory lists real SHAs and never an invented one", async () => {
  const sources = await generator.loadSources();
  const doc = normalize(await readFile(DOC, "utf8"));
  const wave = sources.progress.evidence.filter((entry) => entry.pr >= 258);
  assert.ok(wave.length >= 15, "the wave inventory must cover the effort's pull requests");
  for (const entry of wave) {
    assert.match(entry.sha, /^[0-9a-f]{40}$/, "a wave SHA must be a real 40-hex commit: #" + entry.pr);
    assert.ok(doc.includes(entry.sha), "a wave SHA is missing from the report: #" + entry.pr);
  }
  const last = wave[wave.length - 1];
  assert.ok(doc.includes("**PR #" + last.pr + "**"), "the last verified pull request must be stated");
});

test("the report keeps every required consent and never claims production-readiness", async () => {
  const doc = normalize(await readFile(DOC, "utf8"));
  for (const consent of generator.REQUIRED_CONSENTS) {
    assert.ok(doc.includes(consent), "a required consent must not be dropped: " + consent.slice(0, 40));
  }
  assert.doesNotMatch(doc, /PRODUCTION-READY/i, "the report must not advertise production readiness");
  assert.match(doc, /L3, 0\)/);
});
