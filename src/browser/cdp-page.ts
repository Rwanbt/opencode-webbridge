/** A page driver over the TAB'S OWN CDP endpoint.
 *
 *  Why this exists (measured 2026-10-19): Playwright's `connectOverCDP`
 *  enumerates pages through the BROWSER endpoint, and on Chrome 155 that
 *  enumeration is unreliable — the same version, the same browser, the same five
 *  tabs present in `/json/list`, reported `pages=5`, then `pages=1`, then
 *  `pages=0` across instances. The tab's own `webSocketDebuggerUrl` is
 *  authoritative and always works, so the reads and the send are driven here
 *  directly instead of depending on that enumeration.
 *
 *  This module deliberately implements ONLY the surface the transport already
 *  uses: `evaluate`, `locator().count()/isVisible()/evaluate()/fill()/click()`,
 *  `context().newCDPSession()`, and `url()`. Nothing about the existing reviewed
 *  contracts changes: the same in-page functions are executed, only the channel
 *  differs.
 *
 *  `:visible` is a Playwright pseudo-class, not CSS: it is stripped and replaced
 *  by an explicit visibility filter, so a selector behaves the same way here. */

export interface CdpTargetInfo {
  readonly id: string;
  readonly url: string;
  readonly wsUrl: string;
}

const CONNECT_TIMEOUT_MS = 8000;
const CALL_TIMEOUT_MS = 15000;
const VISIBLE = /:visible/;

/** The pages the browser advertises, with the endpoint each one owns. */
export async function cdpTargets(endpoint: string): Promise<readonly CdpTargetInfo[]> {
  const response = await fetch(endpoint + "/json/list", {
    redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("CDP inventory unavailable (HTTP " + response.status + ")");
  const list = await response.json();
  if (!Array.isArray(list)) throw new Error("CDP inventory is not a JSON array");
  return list
    .filter((item) => item?.type === "page" && typeof item.id === "string" &&
      typeof item.webSocketDebuggerUrl === "string")
    .map((item) => ({ id: item.id, url: String(item.url ?? ""), wsUrl: item.webSocketDebuggerUrl }));
}

/** Selector -> an in-page expression returning the matching elements. */
export function elementsExpression(selector: string): string {
  if (typeof selector !== "string" || !selector.trim() || selector.length > 512)
    throw new Error("CDP locator: invalid selector");
  const wantVisible = VISIBLE.test(selector);
  const css = selector.replace(/:visible/g, "");
  if (!css.trim()) throw new Error("CDP locator: selector is only a visibility pseudo-class");
  return "(() => { const els = [...document.querySelectorAll(" + JSON.stringify(css) + ")];"
    + (wantVisible ? " return els.filter((el) => !!(el.offsetWidth || el.offsetHeight));" : " return els;")
    + " })()";
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class CdpLocator {
  constructor(private readonly page: CdpPage, private readonly selector: string) {}

  async count(): Promise<number> {
    return this.page.evaluateSource<number>("(" + elementsExpression(this.selector) + ").length");
  }

  async isVisible(): Promise<boolean> {
    return (await this.count()) > 0;
  }

  /** Runs `fn(element, arg)` on the FIRST match; undefined when nothing matches. */
  async evaluate<T>(fn: (element: never, arg?: never) => T, arg?: unknown): Promise<T> {
    const source = "(() => { const els = " + elementsExpression(this.selector) + ";"
      + " const el = els[0]; if (!el) return undefined;"
      + " return (" + fn.toString() + ")(" + JSON.stringify(arg ?? null) + ", " + JSON.stringify(arg ?? null) + "); })()";
    return this.page.evaluateSource<T>(source);
  }

  async fill(value: string): Promise<void> {
    if (typeof value !== "string" || value.length > 16_000) throw new Error("CDP locator: invalid fill value");
    const ok = await this.page.evaluateSource<boolean>("(() => { const els = " + elementsExpression(this.selector) + ";"
      + " const el = els[0]; if (!el) return false;"
      + " try { el.focus(); } catch { /* ignore */ }"
      + " if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) el.value = " + JSON.stringify(value) + ";"
      + " else el.textContent = " + JSON.stringify(value) + ";"
      + " el.dispatchEvent(new Event('input', { bubbles: true }));"
      + " el.dispatchEvent(new Event('change', { bubbles: true }));"
      + " return true; })()");
    if (ok !== true) throw new Error("CDP locator: nothing to fill");
  }

  async click(): Promise<void> {
    const ok = await this.page.evaluateSource<boolean>("(() => { const els = " + elementsExpression(this.selector) + ";"
      + " const el = els[0]; if (!el) return false;"
      + " try { el.scrollIntoView({ block: 'center' }); } catch { /* ignore */ }"
      + " el.click(); return true; })()");
    if (ok !== true) throw new Error("CDP locator: nothing to click");
  }
}

/** A CDP session handle with the two methods the transport uses. */
export interface CdpSession {
  send(method: string, params?: object): Promise<unknown>;
  detach(): Promise<void>;
}

export class CdpPage {
  private sequence = 0;
  private readonly pending = new Map<number, Pending>();
  private currentUrl: string;

  private constructor(private readonly socket: WebSocket, url: string) {
    this.currentUrl = url;
    socket.onmessage = (message) => {
      let reply: { id?: unknown; result?: unknown; error?: { message?: unknown }; method?: unknown; params?: unknown };
      try { reply = JSON.parse(String(message.data)); } catch { return; }
      if (typeof reply.id === "number") {
        const waiting = this.pending.get(reply.id);
        if (!waiting) return;
        this.pending.delete(reply.id);
        if (reply.error) waiting.reject(new Error("CDP " + String(reply.error.message ?? "error")));
        else waiting.resolve(reply.result);
        return;
      }
      if (reply.method === "Page.frameNavigated") {
        const frame = (reply.params as { frame?: { url?: unknown } } | undefined)?.frame;
        if (typeof frame?.url === "string") this.currentUrl = frame.url;
      }
    };
  }

  static async open(target: CdpTargetInfo): Promise<CdpPage> {
    if (!target || typeof target.wsUrl !== "string" || !target.wsUrl.startsWith("ws://"))
      throw new Error("CDP page: a tab-local websocket endpoint is required");
    const socket = new WebSocket(target.wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP page: connect timeout")), CONNECT_TIMEOUT_MS);
      socket.onopen = () => { clearTimeout(timer); resolve(); };
      socket.onerror = () => { clearTimeout(timer); reject(new Error("CDP page: connect failed")); };
    });
    const page = new CdpPage(socket, target.url);
    await page.call("Page.enable", {});
    await page.call("Runtime.enable", {});
    return page;
  }

  private call(method: string, params: object): Promise<unknown> {
    const id = ++this.sequence;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CDP page: " + method + " timed out"));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  url(): string {
    return this.currentUrl;
  }

  async session(): Promise<CdpSession> {
    return {
      send: (method: string, params?: object) => this.call(method, params ?? {}),
      detach: async () => { /* the socket is owned by the page */ },
    };
  }

  locator(selector: string): CdpLocator {
    return new CdpLocator(this, selector);
  }

  /** Runs a page-source expression and returns its value. Used by the locator. */
  async evaluateSource<T>(source: string): Promise<T> {
    const result = await this.call("Runtime.evaluate", {
      expression: source, returnByValue: true, awaitPromise: true,
    }) as { exceptionDetails?: { text?: unknown }; result?: { value?: unknown } };
    if (result?.exceptionDetails)
      throw new Error("CDP page: evaluate failed (" + String(result.exceptionDetails.text ?? "unknown") + ")");
    return result?.result?.value as T;
  }

  /** Same contract as a Playwright page: `fn(arg)` evaluated in the page. */
  async evaluate<T>(fn: (arg: never) => T, arg?: unknown): Promise<T> {
    return this.evaluateSource<T>("(" + fn.toString() + ")(" + JSON.stringify(arg ?? null) + ")");
  }

  async close(): Promise<void> {
    try { this.socket.close(); } catch { /* ignore */ }
  }
}
