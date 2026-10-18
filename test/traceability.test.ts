/** Traceability matrix contract: the committed document must be exactly what the
 *  generator produces from the planning sources (no drift), and the matrix must
 *  cover every epic and story with an honest level and no invented acceptance. */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const DOC = join(ROOT, "docs/TRACEABILITY.fr.md");
const generator = await import(
  pathToFileURL(resolve("scripts/generate-traceability.mjs")).href
) as {
  readonly loadSources: () => Promise<{
    backlog: { epics: Array<{ id: string }>; stories: Array<{ id: string; epic: string; priority: string }> };
    acceptance: { stories: Array<{ id: string; level: string; evidence: string }> };
    issues: { issues: Record<string, { number: number }> };
    progress: {
      acceptance: Record<string, unknown>;
      evidence: unknown[];
      unverified: unknown[];
      blockers: unknown[];
    };
  }>;
  readonly renderTraceability: (sources: unknown) => string;
};
/** Generated with LF; compare after normalising whatever the checkout produced. */
const normalize = (text: string) => text.replace(/\r\n/g, "\n");

test("the committed traceability matrix is exactly what the generator produces", async () => {
  const sources = await generator.loadSources();
  const rendered = normalize(generator.renderTraceability(sources));
  const committed = normalize(await readFile(DOC, "utf8"));
  assert.equal(committed, rendered,
    "docs/TRACEABILITY.fr.md drifted from the planning sources: run `npm run docs:traceability`");
});

test("the matrix covers every epic and story with a real issue and an honest level", async () => {
  const sources = await generator.loadSources();
  const levels = new Map(sources.acceptance.stories.map((story) => [story.id, story.level]));
  assert.equal(sources.backlog.epics.length, 9, "9 epics must stay covered");
  assert.equal(sources.backlog.stories.length, 54, "54 stories must stay covered");
  for (const epic of sources.backlog.epics) {
    assert.ok(sources.issues.issues[epic.id]?.number, "epic issue missing: " + epic.id);
  }
  for (const story of sources.backlog.stories) {
    assert.ok(sources.issues.issues[story.id]?.number, "story issue missing: " + story.id);
    assert.match(levels.get(story.id) ?? "", /^L[0-3]$/, "story level missing: " + story.id);
    assert.ok(["P0", "P1", "P2"].includes(story.priority), "story priority invalid: " + story.id);
  }
});

test("acceptance stays provably empty and the indicators stay unchanged", async () => {
  const sources = await generator.loadSources();
  const accepted = sources.progress.acceptance.productionAcceptedStoryIDs as string[];
  assert.deepEqual(accepted, [], "no story may be accepted without a real user session");
  assert.equal((sources.progress.acceptance.commercialProvidersOperational as string[]).length, 0);
  assert.equal(sources.progress.acceptance.nativeDesktopElectronE2E, false);
  assert.equal(sources.progress.acceptance.atomicCoreChromiumRevocation, false);
  assert.equal(sources.progress.acceptance.webbridgeWritesEnabled, false);
  const doc = normalize(await readFile(DOC, "utf8"));
  assert.match(doc, /stories acceptées production : \*\*0\/54\*\*/);
  assert.match(doc, /NO-GO-PRODUCTION/);
  assert.match(doc, /preuves partielles enregistrées : \*\*\d+\*\*/);
});
