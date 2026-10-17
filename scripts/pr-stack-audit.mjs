/** Read-only topology audit. NEVER merges, rebases, cherry-picks or edits a branch. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const deny = (reason) => { throw new Error(`PR stack unsafe: ${reason}`); };

/** The pre-merge stack is expected to contain every Draft PR from #67 onward. */
export function auditStack(input, first = 67) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 250) deny('count out of bounds');
  const numbered = new Map();
  const heads = new Map();
  for (const row of input) {
    if (!row || !Number.isSafeInteger(row.number) || row.number < first ||
      typeof row.headRefName !== 'string' || !/^[a-zA-Z0-9._/-]{1,160}$/.test(row.headRefName) ||
      typeof row.baseRefName !== 'string' || !/^[a-zA-Z0-9._/-]{1,160}$/.test(row.baseRefName) ||
      !/^[a-f0-9]{40}$/.test(row.headRefOid) || row.isDraft !== true) {
      deny('malformed or non-Draft PR');
    }
    if (numbered.has(row.number) || heads.has(row.headRefName)) deny('duplicate PR/head');
    numbered.set(row.number, row);
    heads.set(row.headRefName, row);
  }
  const last = Math.max(...numbered.keys());
  if (numbered.size !== last - first + 1) deny('missing PR in unmerged contiguous range');

  const roots = [];
  const children = new Map([...numbered.keys()].map((n) => [n, []]));
  for (const row of numbered.values()) {
    if (row.baseRefName === 'main') {
      roots.push(row.number);
      continue;
    }
    const parent = heads.get(row.baseRefName);
    if (!parent) deny(`PR #${row.number} missing parent branch`);
    children.get(parent.number).push(row.number);
  }
  if (roots.length !== 1 || roots[0] !== first) deny('unexpected root / main dependency');

  const visited = new Set();
  const visiting = new Set();
  const depth = new Map();
  const visit = (number) => {
    if (visiting.has(number)) deny('cycle detected');
    if (visited.has(number)) return depth.get(number);
    visiting.add(number);
    const row = numbered.get(number);
    const ancestor = heads.get(row.baseRefName);
    const value = ancestor ? visit(ancestor.number) + 1 : 1;
    visiting.delete(number);
    visited.add(number);
    depth.set(number, value);
    return value;
  };
  for (const number of numbered.keys()) visit(number);
  const tips = [...children].filter(([, entries]) => entries.length === 0).map(([n]) => n).sort((a, b) => a - b);
  const forks = [...children].filter(([, entries]) => entries.length > 1)
    .map(([pr, entries]) => ({ pr, children: entries.slice().sort((a, b) => a - b) }));
  return Object.freeze({ first, last, count: numbered.size, root: first,
    maxDepth: Math.max(...depth.values()), tips, forks, noMergePerformed: true,
    scope: 'draft-topology-only-not-a-release' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const fileAt = process.argv.indexOf('--file');
    const input = fileAt !== -1
      ? JSON.parse(readFileSync(resolve(process.argv[fileAt + 1]), 'utf8'))
      : JSON.parse(execFileSync('gh', ['pr', 'list', '--repo', 'Rwanbt/opencode-webbridge',
        '--state', 'open', '--limit', '250', '--json',
        'number,headRefName,baseRefName,headRefOid,isDraft'],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 }));
    console.log(JSON.stringify(auditStack(input)));
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
