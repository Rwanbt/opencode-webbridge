/** G155: explicit user-owned Chrome debug endpoint; read-only public CDP transport.
 * NOT OS/Electron attestation. Deliberately not wired into the distributed plugin. */
const PROVIDERS = {
  'https://chatgpt.com': 'chatgpt', 'https://chat.deepseek.com': 'deepseek',
  'https://gemini.google.com': 'gemini', 'https://chat.qwen.ai': 'qwen',
  'https://chat.mistral.ai': 'mistral',
} as const;
export type CdpProviderID = (typeof PROVIDERS)[keyof typeof PROVIDERS];
const fail = (why: string): never => { throw new Error('G155 CDP denied: ' + why); };
const pageOrigin = (raw: string): string => {
  try {
    const url = new URL(raw);
    if (!(url.origin in PROVIDERS) || url.username || url.password) return fail('unapproved page origin');
    return url.origin;
  } catch { return fail('unapproved page URL'); }
};
export interface CdpTab {
  readonly providerID: CdpProviderID;
  readonly tabID: string;
  readonly url: string;
  readonly generation: number;
}
export interface CdpReadOnlyPage extends CdpTab { readonly headings: readonly string[] }
export interface CdpConsent {
  /** This is operator self-declaration, NOT trusted OS process identification. */
  readonly userDeclaresBrowserOwnership: true;
  readonly approve: (scope: 'read-only-headings', endpoint: string) => Promise<boolean>;
}
type Target = { id: string; type: string; url: string; webSocketDebuggerUrl?: string };
type Selected = { id: string; url: string; ws: string; generation: number; seen: boolean };
const MAX_HTTP = 128 * 1024;
const MAX_CDP = 512 * 1024;

export class ExplicitCdpReadBridge {
  private readonly endpoint!: string;
  private readonly selected = new Map<string, Selected>();
  private generation = 0;
  private live = false;
  private closed = false;
  private readonly pending = new Set<WebSocket>();
  constructor(endpoint: string, private readonly consent: CdpConsent) {
    let url: URL;
    try { url = new URL(endpoint); } catch { return fail('invalid debug endpoint'); }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
        !/^\d+$/.test(url.port) || url.port === '0' ||
        url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
        consent?.userDeclaresBrowserOwnership !== true || typeof consent.approve !== 'function')
      return fail('explicit loopback endpoint and operator ownership declaration required');
    this.endpoint = url.origin;
  }
  async open(): Promise<void> {
    if (this.closed || this.live) return fail('session already used or closed');
    if (await this.consent.approve('read-only-headings', this.endpoint) !== true ||
        this.closed) return fail('operator permission absent or revoked');
    this.live = true;
  }
  close(): void {
    this.closed = true;
    this.live = false;
    for (const socket of this.pending) socket.close();
    this.selected.clear();
  }
  private requireLive(): void {
    if (!this.live || this.closed) return fail('operator session not live');
  }
  private async inventory(): Promise<Map<string, Selected>> {
    this.requireLive();
    const response = await fetch(this.endpoint + '/json/list', {
      redirect: 'error', signal: AbortSignal.timeout(4000),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_HTTP)
      return fail('debug endpoint unavailable or oversized');
    const reader = response.body?.getReader();
    if (!reader) return fail('missing debug response body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_HTTP) return fail('oversized debug inventory');
        chunks.push(value);
      }
    } finally { reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let entries: unknown;
    try { entries = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { return fail('invalid CDP inventory JSON'); }
    if (!Array.isArray(entries) || entries.length > 250) return fail('invalid CDP inventory');
    const current = new Map<string, Selected>();
    for (const target of entries as Target[]) {
      if (!target || target.type !== 'page' || typeof target.url !== 'string' ||
          typeof target.id !== 'string' || !/^[A-Za-z0-9_-]{4,128}$/.test(target.id)) continue;
      try { pageOrigin(target.url); } catch { continue; }
      let ws: URL;
      try { ws = new URL(target.webSocketDebuggerUrl ?? ''); } catch { continue; }
      if (ws.protocol !== 'ws:' || ws.hostname !== '127.0.0.1' ||
          ws.port !== new URL(this.endpoint).port || ws.username || ws.password ||
          ws.search || ws.hash || ws.pathname !== '/devtools/page/' + target.id) continue;
      if (current.has(target.id)) return fail('duplicate debug target id');
      const prev = this.selected.get(target.id);
      const generation = prev?.seen && prev.url === target.url && prev.ws === ws.href
        ? prev.generation : ++this.generation;
      current.set(target.id, { id: target.id, url: target.url, ws: ws.href, generation, seen: true });
    }
    for (const prev of this.selected.values()) {
      if (!current.has(prev.id)) current.set(prev.id, { ...prev, seen: false });
    }
    this.selected.clear();
    for (const [id, value] of current) this.selected.set(id, value);
    return new Map([...current].filter(([, t]) => t.seen));
  }
  async tabs(): Promise<readonly CdpTab[]> {
    return Object.freeze([...((await this.inventory()).values())]
      .map(({ id, url, generation }) => Object.freeze({
        tabID: id, url, generation,
        providerID: PROVIDERS[new URL(url).origin as keyof typeof PROVIDERS],
      })));
  }
  /** Revalidates after asynchronous policy/permission waits; no stored URL is authoritative. */
  async verify(tab: CdpTab): Promise<void> {
    const current = (await this.inventory()).get(tab.tabID);
    if (!current || current.generation !== tab.generation || current.url !== tab.url ||
        PROVIDERS[new URL(current.url).origin as keyof typeof PROVIDERS] !== tab.providerID)
      return fail('tab replaced or provider origin changed');
  }
  private async call(socket: WebSocket, id: number, method: 'Page.getFrameTree' | 'Accessibility.getFullAXTree'): Promise<any> {
    this.requireLive();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => done(new Error('CDP response timeout')), 4000);
      const onClose = () => done(new Error('CDP target closed or replaced'));
      const onMessage = (event: MessageEvent) => {
        if (typeof event.data !== 'string' || event.data.length > MAX_CDP)
          return done(new Error('CDP response oversized'));
        let item: any;
        try { item = JSON.parse(event.data); } catch { return done(new Error('invalid CDP response')); }
        if (item.id === id) {
          if (item.error || !item.result) return done(new Error('CDP command refused'));
          done(undefined, item.result);
        }
      };
      const done = (err?: Error, value?: unknown) => {
        clearTimeout(timer);
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('close', onClose);
        if (err) reject(err); else resolve(value);
      };
      socket.addEventListener('message', onMessage);
      socket.addEventListener('close', onClose, { once: true });
      socket.send(JSON.stringify({ id, method })); // NO arbitrary CDP commands or parameters
    });
  }
  async headings(tab: CdpTab): Promise<readonly string[]> {
    await this.verify(tab);
    const first = this.selected.get(tab.tabID);
    if (!first || first.generation !== tab.generation || first.url !== tab.url)
      return fail('tab replaced before attach');
    const socket = new WebSocket(first.ws);
    this.pending.add(socket);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CDP handshake timeout')), 4000);
        socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection refused')); }, { once: true });
      });
      const attached = (await this.inventory()).get(tab.tabID);
      if (!attached || attached.generation !== tab.generation || attached.ws !== first.ws)
        return fail('tab replaced while attaching');
      const before = await this.call(socket, 1, 'Page.getFrameTree');
      const result = await this.call(socket, 2, 'Accessibility.getFullAXTree');
      const after = await this.call(socket, 3, 'Page.getFrameTree');
      const last = (await this.inventory()).get(tab.tabID);
      if (!last || last.generation !== tab.generation ||
          JSON.stringify(before?.frameTree?.frame) !== JSON.stringify(after?.frameTree?.frame) ||
          !before?.frameTree?.frame?.loaderId) return fail('document navigation or target replacement');
      const nodes = result?.nodes;
      if (!Array.isArray(nodes) || nodes.length > 5000) return fail('invalid accessibility snapshot');
      // Only heading names are emitted. Never return cookies, input values, DOM or CDP frames.
      this.requireLive();
      return Object.freeze(nodes.filter((n: any) => n?.role?.value === 'heading' &&
        typeof n?.name?.value === 'string').slice(0, 24)
        .map((n: any) => String(n.name.value).slice(0, 180)));
    } finally { this.pending.delete(socket); socket.close(); }
  }
  /** Result is bounded, read-only and independently reverified; never expose raw CDP frames. */
  async readOnlyPage(tab: CdpTab): Promise<CdpReadOnlyPage> {
    const headings = await this.headings(tab);
    return Object.freeze({ ...tab, headings });
  }
}
