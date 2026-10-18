/** Offline-only administrative inspection/attestation. Never opens a browser. */
import { existsSync, lstatSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DurableRelayJournal } from '../dist/src/core/durable-relay-journal.js';

const required = ['dir', 'session', 'provider', 'tab', 'account'];
const resolution = ['turn', 'outcome', 'evidence-sha256', 'operator', 'ack'];

function parse(args) {
  const [command, ...pairs] = args;
  if (command !== 'inspect' && command !== 'resolve') throw new Error('choose inspect or resolve');
  if (pairs.length % 2) throw new Error('every flag needs a value');
  const allowed = command === 'inspect' ? required : [...required, ...resolution];
  const options = {};
  for (let i = 0; i < pairs.length; i += 2) {
    const name = pairs[i]?.startsWith('--') ? pairs[i].slice(2) : '';
    if (!allowed.includes(name) || Object.hasOwn(options, name) || !pairs[i + 1]) {
      throw new Error('invalid, duplicated or missing operator flag');
    }
    options[name] = pairs[i + 1];
  }
  if (allowed.some((name) => !options[name])) throw new Error('missing required operator flag');
  if (!isAbsolute(options.dir) || !existsSync(join(options.dir, 'journal.json')) ||
    !lstatSync(options.dir).isDirectory() || !lstatSync(join(options.dir, 'journal.json')).isFile()) {
    throw new Error('existing local journal directory required');
  }
  return { command, options };
}

let journal;
try {
  const { command, options } = parse(process.argv.slice(2));
  const secret = process.env.WEBBRIDGE_RELAY_TOKEN;
  if (!secret) throw new Error('missing WEBBRIDGE_RELAY_TOKEN environment key');
  journal = DurableRelayJournal.open(options.dir, {
    sessionID: options.session, providerID: options.provider,
    tabID: options.tab, accountRef: options.account,
  }, secret);
  if (command === 'inspect') {
    console.log(JSON.stringify({ journal: 'validated', turns: journal.status() }, null, 2));
  } else {
    if (options.ack !== 'I-VERIFIED-REMOTE-OUTCOME') {
      throw new Error('missing explicit remote-outcome attestation');
    }
    journal.reconcile(options.turn, {
      outcome: options.outcome, evidenceHash: options['evidence-sha256'],
      operatorID: options.operator, acknowledged: true,
    });
    console.log(JSON.stringify({ turnID: options.turn, phase: 'reconciled' }));
  }
} catch (error) {
  console.error(`operator action refused: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  journal?.close();
}
