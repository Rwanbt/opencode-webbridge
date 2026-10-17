import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'planning/provider-policy-review.json');
const matrix = JSON.parse(readFileSync(input, 'utf8'));
const catalog = ['chatgpt', 'deepseek', 'gemini', 'qwen', 'mistral'];
const hosts = { chatgpt: 'openai.com', deepseek: 'cdn.deepseek.com',
  gemini: 'policies.google.com', qwen: 'qwen.ai', mistral: 'mistral.ai' };
const check = (okay, reason) => { if (!okay) throw new Error(`Provider policy gate: ${reason}`); };

check(/^20\d\d-\d\d-\d\d$/.test(matrix.observedAt), 'terms observations need dated review');
check(matrix.decisionOwner === 'maintainer-review-required', 'maintainer approval not evidenced');
check(typeof matrix.scope === 'string' && matrix.scope.includes('web-chat'), 'missing policy scope');
check(Array.isArray(matrix.providers) && matrix.providers.length === 5, 'expected five assessments');
check(matrix.providers.map((x) => x.id).join(',') === catalog.join(','), 'provider catalog mismatch');
for (const item of matrix.providers) {
  check(typeof item.approved === 'boolean' && (!item.approved || item.decision === 'permitted'),
    `${item.id}: inconsistent user opt-in and reviewed provider state`);
  check(['restricted', 'unverified', 'written-authorization-required', 'permitted'].includes(item.decision),
    `${item.id}: unexpected activation decision`);
  check(typeof item.policyDate === 'string' && item.policyDate.length >= 7, `${item.id}: missing version`);
  const url = new URL(item.source);
  check(url.protocol === 'https:' && !url.username && !url.password &&
    hosts[item.id] === url.hostname,
    `${item.id}: nonofficial/credential-bearing evidence URL`);
  check(typeof item.finding === 'string' && item.finding.length >= 60 && item.finding.length <= 400,
    `${item.id}: ungrounded policy review`);
}
const opted = matrix.providers.filter((p) => p.decision === 'permitted' && p.approved).length;
console.log(`Provider policy gate PASS: 5/5 individually reviewed, ${opted}/5 user-enabled (not evidence of a functioning web provider)`);
