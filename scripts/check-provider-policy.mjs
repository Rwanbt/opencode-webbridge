import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'planning/provider-policy-review.json');
const matrix = JSON.parse(readFileSync(input, 'utf8'));
const catalog = ['chatgpt', 'deepseek', 'gemini', 'qwen', 'mistral'];
// An official host alone is not proof: another vendor's terms or unrelated
// content under an allowed domain must never satisfy the reviewed evidence.
const reviewedSource = {
  chatgpt: 'https://openai.com/fr-FR/policies/eu-terms-of-use/',
  deepseek: 'https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html',
  gemini: 'https://policies.google.com/terms?hl=fr',
  qwen: 'https://qwen.ai/termsservice',
  mistral: 'https://legal.mistral.ai/terms/eu-consumers-terms-of-service/',
};
const check = (okay, reason) => { if (!okay) throw new Error(`Provider policy gate: ${reason}`); };

check(matrix.observedAt === '2026-10-17', 'terms observations need dated review');
check(matrix.commercialAutomationEnabled === false, 'commercial automation not authorized');
check(matrix.decisionOwner === 'maintainer-review-required', 'maintainer approval not evidenced');
check(typeof matrix.scope === 'string' && matrix.scope.includes('web-chat'), 'missing policy scope');
check(Array.isArray(matrix.providers) && matrix.providers.length === 5, 'expected five assessments');
check(matrix.providers.map((x) => x.id).join(',') === catalog.join(','), 'provider catalog mismatch');
for (const item of matrix.providers) {
  check(item.approved === false, `${item.id}: unverified approval`);
  check(['restricted', 'unverified', 'written-authorization-required'].includes(item.decision),
    `${item.id}: unexpected activation decision`);
  check(typeof item.policyDate === 'string' && item.policyDate.length >= 7, `${item.id}: missing version`);
  const url = new URL(item.source);
  check(url.protocol === 'https:' && !url.username && !url.password &&
    ['openai.com', 'cdn.deepseek.com', 'policies.google.com', 'qwen.ai', 'legal.mistral.ai'].includes(url.hostname),
    `${item.id}: nonofficial/credential-bearing evidence URL`);
  check(item.source === reviewedSource[item.id], `${item.id}: wrong/stale terms document`);
  check(typeof item.finding === 'string' && item.finding.length >= 60 && item.finding.length <= 400,
    `${item.id}: ungrounded policy review`);
}
console.log('Provider policy gate PASS: 5/5 assessed conservatively, 0/5 permitted for commercial automation');
