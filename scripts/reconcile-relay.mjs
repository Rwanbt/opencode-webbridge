/** Offline-only administrative inspection/attestation. Never opens a browser. */
import { createHash } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { DurableRelayJournal } from '../dist/src/core/durable-relay-journal.js';

const required = ['dir', 'session', 'provider', 'tab', 'account'];
const resolution = ['turn', 'outcome', 'evidence-sha256', 'evidence-file', 'operator', 'ack'];
const optional = ['witness-dir'];

function parse(args) {
  const [command, ...pairs] = args;
  if (command !== 'inspect' && command !== 'resolve') throw new Error('choose inspect or resolve');
  if (pairs.length % 2) throw new Error('every flag needs a value');
  const must = command === 'inspect' ? required : [...required, ...resolution];
  const allowed = [...must, ...optional];
  const options = {};
  for (let i = 0; i < pairs.length; i += 2) {
    const name = pairs[i]?.startsWith('--') ? pairs[i].slice(2) : '';
    if (!allowed.includes(name) || Object.hasOwn(options, name) || !pairs[i + 1]) {
      throw new Error('invalid, duplicated or missing operator flag');
    }
    options[name] = pairs[i + 1];
  }
  if (must.some((name) => !options[name])) throw new Error('missing required operator flag');
  if (options['witness-dir'] && !isAbsolute(options['witness-dir'])) {
    throw new Error('witness directory must be an absolute path');
  }
  if (!isAbsolute(options.dir) || !existsSync(join(options.dir, 'journal.json')) ||
    !lstatSync(options.dir).isDirectory() || !lstatSync(join(options.dir, 'journal.json')).isFile()) {
    throw new Error('existing local journal directory required');
  }
  return { command, options };
}

/** Verify bytes, not only an operator-supplied checksum. Never print evidence contents. */
function verifyEvidence(file, dir, claimedHash) {
  if (!isAbsolute(file) || !/^[a-f0-9]{64}$/.test(claimedHash)) {
    throw new Error('absolute evidence file and SHA256 required');
  }
  const rel = relative(resolve(dir), resolve(file));
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error('evidence must be external to the journal directory');
  }
  if (!lstatSync(file).isFile()) throw new Error('evidence must be a regular file');
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.size < 1 || stats.size > 64_000) {
      throw new Error('evidence file size or type invalid');
    }
    // An ancestor junction can make a lexically external path point inside the
    // journal. A hard link can make an external name share an internal inode.
    const physicalRelative = relative(realpathSync(dir), realpathSync(file));
    if (!physicalRelative || (!physicalRelative.startsWith('..') && !isAbsolute(physicalRelative))) {
      throw new Error('evidence must be physically external to journal');
    }
    if (stats.nlink !== 1) throw new Error('evidence hard-linked file is not independently trusted');
    const hash = createHash('sha256').update(readFileSync(fd)).digest('hex');
    if (hash !== claimedHash) throw new Error('evidence SHA256 does not match reviewed file');
  } finally { closeSync(fd); }
}

let journal;
try {
  const { command, options } = parse(process.argv.slice(2));
  const secret = process.env.WEBBRIDGE_RELAY_TOKEN;
  if (!secret) throw new Error('missing WEBBRIDGE_RELAY_TOKEN environment key');
  journal = DurableRelayJournal.open(options.dir, {
    sessionID: options.session, providerID: options.provider,
    tabID: options.tab, accountRef: options.account,
  }, secret, options['witness-dir'] ? { witnessDir: options['witness-dir'] } : undefined);
  if (command === 'inspect') {
    console.log(JSON.stringify({ journal: 'validated', turns: journal.status() }, null, 2));
  } else {
    if (options.ack !== 'I-VERIFIED-REMOTE-OUTCOME') {
      throw new Error('missing explicit remote-outcome attestation');
    }
    verifyEvidence(options['evidence-file'], options.dir, options['evidence-sha256']);
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
