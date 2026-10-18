#!/usr/bin/env node
/** Operator reconciliation for the durable native attempt journal.
 * READ-ONLY by default (listing). `--abandon <target>` requires an explicit
 * turn id or key prefix, an interactive terminal and a YES confirmation; it
 * never claims a completion, never deletes evidence, and never prints assistant
 * text (none is stored). */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const fail = (reason) => { throw new Error('WebBridge journal refusal: ' + reason); };

export async function main(args = process.argv.slice(2), io = {stdin, stdout, stderr}) {
  if (!io.stdin.isTTY || !io.stdout.isTTY) fail('interactive terminal required (no piping or unattended runs)');
  const {parseJournalInvocation, resolveJournalTarget, abandonJournalEntry, describeJournalEntry} =
    await import('../dist/src/native/journal-operator.js');
  const {createFileAttemptStore, NATIVE_JOURNAL_DIR_OPT} =
    await import('../dist/src/native/attempt-store.js');
  const input = parseJournalInvocation(args);
  const journalDir = input.journalDir ?? (process.env[NATIVE_JOURNAL_DIR_OPT] ?? '').trim();
  if (!journalDir)
    fail(NATIVE_JOURNAL_DIR_OPT + ' (or --journal <dir>) must point to the private journal directory');
  const store = createFileAttemptStore(journalDir);
  const entries = await store.list();
  const now = Date.now();
  io.stdout.write('journal ' + journalDir + ' : ' + entries.length + ' record(s)\n');
  for (const entry of entries) io.stdout.write('  ' + describeJournalEntry(entry, now) + '\n');
  if (input.action === 'list') {
    io.stdout.write('read-only listing: no record was modified\n');
    return;
  }
  const target = resolveJournalTarget(entries, input.target);
  io.stdout.write('\nTARGET ' + describeJournalEntry(target, now) + '\n');
  const readline = createInterface({input: io.stdin, output: io.stdout, terminal: true});
  try {
    const answer = (await readline.question('Abandon this attempt (never reconciled again; '
      + 'no completion is claimed)? Type YES: ')).trim();
    if (answer !== 'YES') return fail('abandonment not confirmed');
  } finally { readline.close(); }
  const result = await abandonJournalEntry(store, target, Date.now());
  io.stdout.write(result.changed
    ? 'ABANDONED turn ' + result.turnID + ': a later identical prompt is a new turn\n'
    : 'unchanged: turn ' + result.turnID + ' is already abandoned\n');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    stderr.write((error instanceof Error ? error.message : 'journal refused') + '\n');
    process.exitCode = 1;
  });
}
