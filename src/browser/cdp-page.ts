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
/** The opening handshake is short on purpose. A discarded or frozen tab (Brave's
 *  memory saver does this to background tabs) stays listed in the inventory but
 *  never answers. Measured live: exactly that happened, and the attachment hung
 *  for the full call timeout instead of failing fast and naming the cause. */
const HANDSHAKE_TIMEOUT_MS = 5000;
/** The retry window after a revive reload, which is slower than a live tab. */
const REVIVE_TIMEOUT_MS = 12000;
const UNRESPONSIVE =
  "the tab did not answer; it may be discarded or frozen, and refreshing the page fixes it";
const UNRESPONSIVE_AFTER_RELOAD =
  "the tab did not answer even after a reload; it may be closed or still starting up";
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

  /** Runs `fn(element, arg)` on the FIRST match; undefined when nothing matches.
   *  The element is the FIRST parameter, exactly like Playwright: the transport
   *  relies on that shape (`(el) => el.value`). */
  async evaluate<T>(fn: (element: Element, arg?: unknown) => T, arg?: unknown): Promise<T> {
    const source = "(() => { const els = " + elementsExpression(this.selector) + ";"
      + " const el = els[0]; if (!el) return undefined;"
      + " return (" + fn.toString() + ")(el, " + JSON.stringify(arg ?? null) + "); })()";
    return this.page.evaluateSource<T>(source);
  }

  /** Attribute of the first match, or null. Reads do not auto-wait: the callers
   *  bracket every read with their own re-verification. */
  async getAttribute(name: string): Promise<string | null> {
    if (typeof name !== "string" || !name || name.length > 128)
      throw new Error("CDP locator: invalid attribute name");
    const value = await this.page.evaluateSource<unknown>("(() => { const el = ("
      + elementsExpression(this.selector) + ")[0];"
      + " return el ? el.getAttribute(" + JSON.stringify(name) + ") : null; })()");
    return typeof value === "string" ? value : null;
  }

  async textContent(): Promise<string | null> {
    const value = await this.page.evaluateSource<unknown>("(() => { const el = ("
      + elementsExpression(this.selector) + ")[0];"
      + " return el ? el.textContent : null; })()");
    return typeof value === "string" ? value : null;
  }

  async isEnabled(): Promise<boolean> {
    return await this.page.evaluateSource<boolean>("(() => { const el = ("
      + elementsExpression(this.selector) + ")[0];"
      + " if (!el) return false;"
      + " return !el.disabled && el.getAttribute('aria-disabled') !== 'true'; })()");
  }

  async focus(): Promise<void> {
    await this.page.evaluateSource<boolean>("(() => { const el = ("
      + elementsExpression(this.selector) + ")[0];"
      + " if (!el) return false; try { el.focus(); } catch { /* ignore */ } return true; })()");
  }

  /** Same contract as Playwright: a bubbling, cancelable event of that type. */
  async dispatchEvent(type: string): Promise<void> {
    if (typeof type !== "string" || !type || type.length > 64)
      throw new Error("CDP locator: invalid event type");
    const ok = await this.page.evaluateSource<boolean>("(() => { const el = ("
      + elementsExpression(this.selector) + ")[0];"
      + " if (!el) return false;"
      + " el.dispatchEvent(new Event(" + JSON.stringify(type) + ", { bubbles: true, cancelable: true }));"
      + " return true; })()");
    if (ok !== true) throw new Error("CDP locator: nothing to dispatch on");
  }

  /** Actionability state of the first match. `hit` is the receives-events test:
   *  the element must be the topmost node at its own centre. */
  private async actionability(): Promise<{
    present: boolean; visible: boolean; enabled: boolean; hit: boolean;
    box: { x: number; y: number; w: number; h: number } | null;
  }> {
    return this.page.evaluateSource("(() => { const el = (" + elementsExpression(this.selector) + ")[0];"
      + " if (!el) return { present: false, visible: false, enabled: false, hit: false, box: null };"
      + " const rect = el.getBoundingClientRect();"
      + " const visible = !!(el.offsetWidth || el.offsetHeight) && getComputedStyle(el).visibility !== 'hidden';"
      + " const enabled = !el.disabled && el.getAttribute('aria-disabled') !== 'true';"
      + " const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);"
      + " return { present: true, visible, enabled,"
      + " hit: !!top && (el === top || el.contains(top)),"
      + " box: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } }; })()");
  }

  private async scrollIntoView(): Promise<void> {
    await this.page.evaluateSource<boolean>("(() => { const el = ("
      + elementsExpression(this.selector) + ")[0];"
      + " if (!el) return false;"
      + " try { el.scrollIntoView({ block: 'center' }); } catch { /* ignore */ } return true; })()");
  }

  /** `fill(value, { timeout })`, like Playwright: waits for the element to be
   *  present and visible, then sets the value and notifies the framework. */
  async fill(value: string, options?: { timeout?: number }): Promise<void> {
    if (typeof value !== "string" || value.length > 16_000) throw new Error("CDP locator: invalid fill value");
    const timeout = typeof options?.timeout === "number" ? options.timeout : 5000;
    const deadline = Date.now() + timeout;
    for (;;) {
      const state = await this.actionability();
      const expired = Date.now() > deadline;
      if (state.present && state.visible) {
        const focused = await this.page.evaluateSource<boolean>("(() => { const els = " + elementsExpression(this.selector) + ";"
          + " const el = els[0]; if (!el) return false;"
          + " try { el.focus(); } catch { /* ignore */ }"
          + " return document.activeElement === el || el.contains(document.activeElement); })()");
        if (focused === true) {
          if (value === "") {
            // Clearing is a different operation: the guard that matters reads the
            // DOM value back, so an empty DOM is what must be guaranteed here.
            await this.page.evaluateSource<boolean>("(() => { const el = (" + elementsExpression(this.selector) + ")[0];"
              + " if (!el) return false;"
              + " if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) el.value = '';"
              + " else el.textContent = '';"
              + " el.dispatchEvent(new Event('input', { bubbles: true }));"
              + " return true; })()");
            return;
          }
          await this.page.selectAll();
          await this.page.insertText(value);
          return;
        }
      }
      if (expired) throw new Error("CDP locator: nothing to fill");
      await pause(50);
    }
  }

  /** `click({ timeout, force, noWaitAfter })`, like Playwright. Actionability is
   *  enforced unless `force` is set: present, visible, enabled, stable across two
   *  samples, and receiving events at its own centre. `noWaitAfter` is naturally
   *  satisfied -- this driver never waits for a navigation after the click. */
  async click(options?: { timeout?: number; force?: boolean; noWaitAfter?: boolean }): Promise<void> {
    const timeout = typeof options?.timeout === "number" ? options.timeout : 5000;
    const force = options?.force === true;
    const deadline = Date.now() + timeout;
    if (!force) await this.scrollIntoView();
    for (;;) {
      const state = await this.actionability();
      const expired = Date.now() > deadline;
      if (state.present && (force || (state.visible && state.enabled && state.hit))) {
        if (force || await this.stable(state.box)) {
          const box = state.box;
          if (!box) {
            if (expired) throw new Error("CDP locator: nothing to click");
            await pause(50);
            continue;
          }
          const x = box.x + box.w / 2, y = box.y + box.h / 2;
          await this.page.dispatchMouse("mousePressed", x, y);
          await this.page.dispatchMouse("mouseReleased", x, y);
          return;
        }
      }
      if (expired) throw new Error("CDP locator: nothing to click");
      await pause(50);
    }
  }

  /** Two bounding-box samples: an element that moves between them is animating,
   *  and clicking it would land on the wrong pixel. */
  private async stable(before: { x: number; y: number } | null): Promise<boolean> {
    if (!before) return false;
    await pause(30);
    const after = await this.actionability();
    return !!after.box && after.box.x === before.x && after.box.y === before.y;
  }
}

/** A bounded wait between actionability samples. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A CDP session handle with the two methods the transport uses. Playwright's
 *  own CDPSession satisfies this too, so a helper can take either. */
export interface CdpSessionLike {
  send(method: string, params?: object): Promise<unknown>;
  detach(): Promise<void>;
}

export type CdpSession = CdpSessionLike;

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

  /** Opens a driver on the tab's own endpoint. With `revive`, a tab that does not
   *  answer the handshake -- the signature of a discarded or frozen tab, which
   *  Chrome keeps listed in the inventory -- is RELOADED once, then the handshake
   *  is retried. Reloading is what a person does by hand, it is the only way to
   *  keep going on the SAME tab, and the conversation survives because the URL
   *  carries its id. This only ever touches the tab the caller already declared. */
  static async open(
    target: CdpTargetInfo, options?: { revive?: boolean; handshakeTimeoutMs?: number },
  ): Promise<CdpPage> {
    if (!target || typeof target.wsUrl !== "string" || !target.wsUrl.startsWith("ws://"))
      throw new Error("CDP page: a tab-local websocket endpoint is required");
    const handshakeMs = options?.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
    const retryMs = options?.handshakeTimeoutMs ?? REVIVE_TIMEOUT_MS;
    const socket = new WebSocket(target.wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP page: connect timeout")), CONNECT_TIMEOUT_MS);
      socket.onopen = () => { clearTimeout(timer); resolve(); };
      socket.onerror = () => { clearTimeout(timer); reject(new Error("CDP page: connect failed")); };
    });
    const page = new CdpPage(socket, target.url);
    try {
      await page.handshake(handshakeMs, UNRESPONSIVE);
      return page;
    } catch (error) {
      if (options?.revive !== true) { await page.close(); throw error; }
      await page.reload(handshakeMs);
      try {
        await page.handshake(retryMs, UNRESPONSIVE_AFTER_RELOAD);
        return page;
      } catch (retry) { await page.close(); throw retry; }
    }
  }

  /** The two domains the transport relies on. */
  private async handshake(timeoutMs: number, hint: string): Promise<void> {
    await this.call("Page.enable", {}, timeoutMs, hint);
    await this.call("Runtime.enable", {}, timeoutMs, hint);
  }

  /** Best effort by design: if the reload cannot be delivered either, the retry
   *  that follows is what reports the truth. */
  private async reload(timeoutMs: number): Promise<void> {
    try { await this.call("Page.reload", {}, timeoutMs, UNRESPONSIVE); }
    catch { /* the retry decides */ }
  }

  private call(method: string, params: object, timeoutMs = CALL_TIMEOUT_MS, hint = ""): Promise<unknown> {
    const id = ++this.sequence;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CDP page: " + method + " timed out" + (hint ? " -- " + hint : "")));
      }, timeoutMs);
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

  /** Types text through the browser's input pipeline instead of rewriting the
   *  DOM. Frameworks keep their own value tracker: only a real input event
   *  updates it, and only then does a send button bound to that state become
   *  live. Measured: Gemini's send control stayed inert while the draft was
   *  visibly present, so the click was a no-op and the draft was left behind. */
  async insertText(text: string): Promise<void> {
    if (typeof text !== "string") throw new Error("CDP page: invalid text");
    await this.call("Input.insertText", { text });
  }

  /** Selects the whole content of the focused field, so a following insert
   *  REPLACES it instead of appending. Measured: without this, repeated fills
   *  produced "WEBBRIDGE-OKWEBBRIDGE-OK". */
  async selectAll(): Promise<void> {
    await this.call("Input.dispatchKeyEvent", {
      type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2,
    });
    await this.call("Input.dispatchKeyEvent", {
      type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2,
    });
  }

  /** A real pointer event at viewport coordinates. `element.click()` is a DOM
   *  synthetic event, and frameworks that bind pointer/mouse handlers ignore it:
   *  measured on Gemini, where the send button appeared live yet a DOM click
   *  only emptied the composer without sending anything. */
  async dispatchMouse(type: "mousePressed" | "mouseReleased", x: number, y: number): Promise<void> {
    await this.call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }

  /** Opens the session for a document-epoch read. The driver owns exactly one
   *  session per attachment, so this is that session, and detaching it is a
   *  no-op: the attachment's socket outlives every read. */
  cdpSession(): Promise<CdpSessionLike> {
    return this.session();
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
