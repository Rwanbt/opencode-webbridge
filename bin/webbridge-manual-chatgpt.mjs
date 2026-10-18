#!/usr/bin/env node
/** Deliberately interactive. No automatic model/browser writes from this command. */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const fail = (reason) => { throw new Error('WebBridge operator refusal: ' + reason); };
const ID = /^[A-Za-z0-9_-]{8,128}$/;
const fields = ['endpoint', 'tab', 'session', 'turn', 'journal'];
export const parseManualArgs = (args) => {
  const data = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--owned-browser') { if (data.owned) fail('duplicate ownership flag'); data.owned = true; continue; }
    if (!key.startsWith('--') || !fields.includes(key.slice(2)) ||
        Object.hasOwn(data, key.slice(2)) || i + 1 >= args.length) fail('unknown or duplicate argument');
    data[key.slice(2)] = args[++i];
  }
  if (!data.owned || fields.some((key) => !data[key])) fail('explicit owned browser and required args missing');
  if (!ID.test(data.tab) || !ID.test(data.session) || !ID.test(data.turn)) fail('invalid opaque identifier');
  let endpoint;
  try { endpoint = new URL(data.endpoint); } catch { fail('bad CDP endpoint'); }
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' ||
      !/^\d+$/.test(endpoint.port) || endpoint.port === '0' || endpoint.pathname !== '/' ||
      endpoint.search || endpoint.hash || endpoint.username || endpoint.password) fail('local CDP endpoint required');
  return {endpoint: endpoint.origin, tabID: data.tab, sessionID: data.session,
    turnID: data.turn, journalDir: resolve(data.journal)};
};

export async function main(args = process.argv.slice(2), io = {stdin, stdout, stderr}) {
  if (!io.stdin.isTTY || !io.stdout.isTTY) fail('interactive terminal required (no piping or unattended sends)');
  const input = parseManualArgs(args);
  const readline = createInterface({input: io.stdin, output: io.stdout, terminal: true});
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  process.once('SIGINT', onAbort);
  const yes = async (question) => (await readline.question(question)).trim() === 'YES';
  let sendApproved = false;
  try {
    if (!await yes('Confirm you own/control the existing Chromium CDP session and selected ChatGPT tab. Type YES: '))
      return fail('browser ownership not confirmed');
    if (!await yes('Allow read-only assistant text in the selected ChatGPT tab? Type YES: '))
      return fail('assistant read not approved');
    const prompt = await readline.question('Enter exact prompt (up to 4000 characters): ');
    if (!prompt.trim() || prompt.length > 4000) return fail('empty or oversized prompt');
    const consent = {
      userDeclaresBrowserOwnership: true,
      approve: async () => !ctrl.signal.aborted,
      allowAssistantText: async () => !ctrl.signal.aborted,
      approveSend: async (action, exactPrompt) => {
        sendApproved = false;
        io.stdout.write('\nPROPOSED SINGLE SEND (NO AUTOMATIC RETRY)\n' +
          JSON.stringify(action, null, 2) + '\nPROMPT: ' + exactPrompt + '\n');
        sendApproved = !ctrl.signal.aborted && await yes('Approve this exact prompt and target? Type YES: ');
        return sendApproved && !ctrl.signal.aborted;
      },
      isStillApproved: () => sendApproved && !ctrl.signal.aborted,
    };
    const {g166ChatgptManualTurn} = await import('../dist/src/runtime/g166-chatgpt-manual-turn.js');
    for await (const event of g166ChatgptManualTurn({...input, prompt, consent,
      signal: ctrl.signal, polls: 12, intervalMs: 200})) {
      if (event.kind === 'candidate') io.stdout.write('[UNVERIFIED] ' + event.text + '\n');
      else io.stdout.write('TERMINAL UNCERTAIN: ' + event.reason + '\n');
    }
  } finally {
    sendApproved = false;
    process.removeListener('SIGINT', onAbort);
    readline.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    stderr.write((error instanceof Error ? error.message : 'operator refused') + '\n');
    process.exitCode = 1;
  });
}
