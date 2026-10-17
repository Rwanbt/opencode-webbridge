import { createServer, type Server } from 'node:http';

/** Deliberately minimal, offline chat UI. Contains no user account or secrets. */
const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>WebBridge Local Fixture</title></head>
<body>
<h1>WebBridge browser test page</h1>
<form id="chat"><label for="prompt">Prompt</label>
<textarea id="prompt" aria-label="Prompt" maxlength="16000" required></textarea>
<button type="submit">Send</button></form>
<output id="response" role="status" data-state="idle"></output>
<button id="continue" type="button" hidden>Continue fixture stream</button>
<script>
let pending = null;
document.getElementById('chat').addEventListener('submit', (event) => {
  event.preventDefault();
  const prompt = document.getElementById('prompt').value;
  const response = document.getElementById('response');
  response.dataset.state = 'pending';
  response.textContent = '';
  document.getElementById('continue').hidden = true;
  pending = prompt;
  setTimeout(() => {
    response.textContent = 'WEBBRIDGE_LOCAL_PAGE_OK:' + prompt.slice(0, Math.max(1, Math.floor(prompt.length / 2)));
    response.dataset.state = 'streaming';
    document.getElementById('continue').hidden = false;
  }, 15);
});
document.getElementById('continue').addEventListener('click', () => {
  if (pending === null) return;
  const response = document.getElementById('response');
  if (response.dataset.state !== 'streaming') return;
  response.textContent = 'WEBBRIDGE_LOCAL_PAGE_OK:' + pending;
  response.dataset.state = 'finished';
  document.getElementById('continue').hidden = true;
  pending = null;
});
</script>
</body></html>`;

export async function openLocalChatPage(): Promise<{ readonly url: string; close(): Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const address = server.address();
    if (!address || typeof address === 'string') { res.writeHead(503); res.end(); return; }
    const host = `127.0.0.1:${address.port}`;
    if (req.method !== 'GET' || req.url !== '/' || req.headers.host !== host) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    });
    res.end(HTML);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new Error('invalid page listener'); }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
