import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { auditStack } from '../scripts/pr-stack-audit.mjs';

const sha = (digit) => digit.repeat(40);
const row = (number, headRefName, baseRefName, digit = 'a') =>
  ({ number, headRefName, baseRefName, headRefOid: sha(digit), isDraft: true });

function valid() {
  return [
    row(67, 'feat/root', 'main', 'a'),
    row(68, 'feat/stream', 'feat/root', 'b'),
    row(69, 'fix/authority', 'feat/root', 'c'),
    row(70, 'fix/stream-end', 'feat/stream', 'd'),
  ];
}

test('read-only Draft PR dependency DAG has one main root and reports independent tips', () => {
  const report = auditStack(valid());
  assert.deepEqual({ first: report.first, last: report.last, count: report.count,
    root: report.root, maxDepth: report.maxDepth, tips: report.tips },
  { first: 67, last: 70, count: 4, root: 67, maxDepth: 3, tips: [69, 70] });
  assert.deepEqual(report.forks, [{ pr: 67, children: [68, 69] }]);
  assert.equal(report.scope, 'draft-topology-only-not-a-release');
});

test('parent cycles, missing parent and a second main root are refused', () => {
  const cycle = valid();
  cycle[1] = { ...cycle[1], baseRefName: 'fix/stream-end' };
  assert.throws(() => auditStack(cycle), /cycle detected/);
  const missing = valid();
  missing[1] = { ...missing[1], baseRefName: 'nonexistent/parent' };
  assert.throws(() => auditStack(missing), /missing parent/);
  const second = valid();
  second[1] = { ...second[1], baseRefName: 'main' };
  assert.throws(() => auditStack(second), /unexpected root/);
});

test('missing or duplicate PRs, duplicate branch or forged SHA cannot be called an integrated stack', () => {
  const gap = valid().filter(({ number }) => number !== 68);
  assert.throws(() => auditStack(gap), /missing PR/);
  const duplicatePR = valid();
  duplicatePR.push({ ...duplicatePR[0], headRefName: 'fix/extra' });
  assert.throws(() => auditStack(duplicatePR), /duplicate PR/);
  const duplicateHead = valid();
  duplicateHead[3] = { ...duplicateHead[3], headRefName: 'feat/stream' };
  assert.throws(() => auditStack(duplicateHead), /duplicate PR\/head/);
  const forged = valid();
  forged[2] = { ...forged[2], headRefOid: 'not-a-sha' };
  assert.throws(() => auditStack(forged), /malformed/);
  const merged = valid();
  merged[2] = { ...merged[2], isDraft: false };
  assert.throws(() => auditStack(merged), /non-Draft/);
});

test('the topology audit never turns fixture status into a release readiness result', () => {
  const report = auditStack(valid());
  assert.equal(report.noMergePerformed, true);
  assert.equal(Object.hasOwn(report, 'productionReady'), false);
  assert.equal(Object.hasOwn(report, 'acceptance'), false);
});
