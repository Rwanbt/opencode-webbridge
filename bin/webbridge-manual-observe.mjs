#!/usr/bin/env node
/** Deliberately interactive, READ-ONLY observation of one declared provider tab.
 * This command has no send path: it can never write to a provider, never claims
 * finality, and refuses piped/unattended execution. The message to observe is
 * either passed explicitly (--message) or discovered, displayed and confirmed.
 * Qwen terminates with an explicit NO-GO after a real readiness probe. */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout, stderr } from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const fail = (reason) => { throw new Error('WebBridge observe refusal: ' + reason); };

export async function main(args = process.argv.slice(2), io = {stdin, stdout, stderr}) {
  if (!io.stdin.isTTY || !io.stdout.isTTY) fail('interactive terminal required (no piping or unattended reads)');
  const {parseObserveInvocation, discoverProviderAssistant, observeProviderAssistant} =
    await import('../dist/src/runtime/observe-provider.js');
  const {requireProviderAdapter} = await import('../dist/src/providers/provider-adapters.js');
  const input = parseObserveInvocation(args);
  const adapter = requireProviderAdapter(input.provider);
  io.stdout.write('Provider ' + adapter.id + ' (' + adapter.label + ' - ' + adapter.origin + ')\n' +
    'read primitive: ' + adapter.readPrimitive + (adapter.discoverable ? ' (discovery available)' : ' (probe only)') + '\n' +
    'send: ' + (adapter.sendPrimitive ?? 'NONE') + ' - this command never sends\n' +
    'completion: uncertain-only (' + adapter.completionProof + ' proof) - ' + adapter.notes + '\n');
  const readline = createInterface({input: io.stdin, output: io.stdout, terminal: true});
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  process.once('SIGINT', onAbort);
  const yes = async (question) => (await readline.question(question)).trim() === 'YES';
  let readApproved = false;
  try {
    if (!await yes('Confirm you own/control the existing Chromium CDP session and the selected '
      + adapter.label + ' tab. Type YES: ')) return fail('browser ownership not confirmed');
    if (!await yes('Allow READ-ONLY assistant text in the selected ' + adapter.label
      + ' tab? Type YES: ')) return fail('assistant read not approved');
    readApproved = true;
    const consent = {
      userDeclaresBrowserOwnership: true,
      approve: async () => !ctrl.signal.aborted,
      allowAssistantText: async () => readApproved && !ctrl.signal.aborted,
      isStillApproved: (provider, tabID) => readApproved && !ctrl.signal.aborted &&
        provider === adapter.id && tabID === input.tabID,
    };
    let messageKey = input.messageKey;
    if (messageKey === undefined) {
      const found = await discoverProviderAssistant({...input, consent, signal: ctrl.signal});
      if (!found) { io.stdout.write('TERMINAL UNCERTAIN: no-message\n'); return; }
      io.stdout.write('\nMESSAGE ' + found.messageKey + '\n[UNVERIFIED] ' + found.preview + '\n');
      if (!await yes('Observe progress on this exact message only? Type YES: ')) return fail('message not confirmed');
      messageKey = found.messageKey;
    }
    for await (const event of observeProviderAssistant({...input, messageKey, consent, signal: ctrl.signal})) {
      if (event.kind === 'candidate') io.stdout.write('[UNVERIFIED] ' + event.text + '\n');
      else io.stdout.write('TERMINAL ' + (event.status === 'no-go' ? 'NO-GO' : 'UNCERTAIN') + ': ' + event.reason + '\n');
    }
  } finally {
    readApproved = false;
    process.removeListener('SIGINT', onAbort);
    readline.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    stderr.write((error instanceof Error ? error.message : 'observe refused') + '\n');
    process.exitCode = 1;
  });
}
