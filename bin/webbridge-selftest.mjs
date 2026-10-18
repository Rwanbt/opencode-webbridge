#!/usr/bin/env node
/** WebBridge self-test — ONE real turn per declared provider through the
 *  installed plugin and the official CLI.
 *
 *  It SENDS a real prompt, so it requires an explicit `--yes`. It never reads
 *  cookies/tokens and never touches the browser directly: the plugin does that
 *  through the consented declared tab, exactly like a normal turn.
 *
 *  Usage:
 *    webbridge-selftest --provider chatgpt --yes
 *    webbridge-selftest --all --yes
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROVIDER_IDS = ['chatgpt', 'deepseek', 'gemini', 'qwen', 'mistral'];
const PROMPT = 'Réponds en une phrase courte: combien font 2 + 2 ?';

export function modelRef(id) { return 'webbridge-' + id + '/' + id + '-web'; }

/** Pure: extract the streamed answer text from `opencode run --format json`. */
export function answerFrom(stdout) {
  let answer = '';
  let events = 0;
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event;
    try { event = JSON.parse(trimmed); } catch { continue; }
    events += 1;
    if (event?.type === 'text' && typeof event?.part?.text === 'string')
      answer += event.part.text;
  }
  return { answer, events };
}

export function oneTurn(id, { timeoutMs = 180_000 } = {}) {
  return new Promise((done) => {
    const child = spawn('opencode', ['run', '--model', modelRef(id), '--format', 'json', PROMPT], {
      shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (value) => { stdout += value.toString(); });
    child.stderr.on('data', (value) => { stderr = (stderr + value.toString()).slice(-800); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); done({ ok: false, error: String(error.message) }); });
    child.once('close', (code) => {
      clearTimeout(timer);
      const { answer, events } = answerFrom(stdout);
      done({ ok: answer.trim().length > 0, code, events, answer: answer.trim(), stderr: stderr.trim() });
    });
  });
}

function parse(argv) {
  const out = { providers: [], yes: false, timeoutMs: 180_000 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--provider') out.providers.push(argv[++i]);
    else if (arg === '--all') out.providers = [...PROVIDER_IDS];
    else if (arg === '--yes') out.yes = true;
    else if (arg === '--timeout') out.timeoutMs = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error('unknown argument: ' + arg);
  }
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parse(process.argv.slice(2));
    if (options.help) {
      console.log('Usage: webbridge-selftest --provider <id> --yes | --all --yes');
      console.log('Providers: ' + PROVIDER_IDS.join(', '));
      process.exit(0);
    }
    const unknown = options.providers.filter((id) => !PROVIDER_IDS.includes(id));
    if (unknown.length) throw new Error('unknown provider: ' + unknown.join(', '));
    if (!options.providers.length) throw new Error('choose --provider <id> or --all');
    if (!options.yes) {
      console.error('webbridge-selftest sends ONE real prompt per provider.');
      console.error('Re-run with --yes to confirm, once the tab is declared and authenticated.');
      process.exit(2);
    }
    let passed = 0;
    for (const id of options.providers) {
      process.stdout.write('[' + id + '] sending one prompt... ');
      const result = await oneTurn(id, options);
      if (result.ok) {
        passed += 1;
        console.log('OK (' + result.answer.length + ' chars, ' + result.events + ' events)');
        console.log('        "' + result.answer.replace(/\s+/g, ' ').slice(0, 120) + '"');
      } else {
        console.log('FAILED');
        if (result.error) console.log('        ' + result.error);
        else if (result.stderr) console.log('        ' + result.stderr.split(/\r?\n/).slice(-3).join(' | '));
        else console.log('        no assistant text (terminal UNCERTAIN by design; check the tab and journal)');
      }
    }
    console.log('\n' + passed + '/' + options.providers.length + ' provider(s) answered.');
    process.exit(passed === options.providers.length ? 0 : 1);
  } catch (error) {
    console.error('webbridge-selftest: ' + String(error?.message ?? error));
    process.exit(2);
  }
}
