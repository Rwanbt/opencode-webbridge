/**
 * Exclusive binding of a visible browser tab to one local session/account.
 *
 * A tab cannot silently serve two sessions, providers, or accounts. Replacing or
 * closing the tab invalidates the binding. All IDs are opaque; no credentials.
 */

import { assertOpaqueID } from './browser-port.js';

export interface SessionBinding {
  readonly sessionID: string;
  readonly providerID: string;
  readonly accountRef: string;
  readonly tabID: string;
  readonly tabGeneration: string;
  readonly boundAt: number;
}

export type BindResult =
  | { readonly ok: true; readonly binding: SessionBinding }
  | { readonly ok: false; readonly reason:
      | 'missing-field'
      | 'invalid-id'
      | 'already-bound'
      | 'tab-replaced'
      | 'tab-closed'
      | 'account-mismatch' };

export class SessionBindingRegistry {
  // tabID -> binding
  private readonly byTab = new Map<string, SessionBinding>();
  // sessionID -> tabID
  private readonly bySession = new Map<string, string>();

  bind(input: {
    sessionID: string; providerID: string; accountRef: string;
    tabID: string; tabGeneration: string; now: number;
  }): BindResult {
    const { sessionID, providerID, accountRef, tabID, tabGeneration, now } = input;
    for (const [k, v] of Object.entries({ sessionID, providerID, accountRef, tabID, tabGeneration })) {
      try { assertOpaqueID(v, k); } catch { return { ok: false, reason: 'invalid-id' }; }
    }
    if (typeof now !== 'number' || !Number.isSafeInteger(now) || now < 0) {
      return { ok: false, reason: 'invalid-id' };
    }
    // A session already bound to a different tab cannot silently take another.
    const existingTab = this.bySession.get(sessionID);
    if (existingTab && existingTab !== tabID) {
      return { ok: false, reason: 'already-bound' };
    }
    // A tab already bound to a different session/account cannot be reused.
    const existing = this.byTab.get(tabID);
    if (existing && (existing.sessionID !== sessionID || existing.accountRef !== accountRef)) {
      return { ok: false, reason: 'account-mismatch' };
    }
    // Tab generation changed => replaced; old binding invalidated.
    if (existing && existing.tabGeneration !== tabGeneration) {
      this.byTab.delete(tabID);
      this.bySession.delete(existing.sessionID);
      return { ok: false, reason: 'tab-replaced' };
    }
    const binding: SessionBinding = {
      sessionID, providerID, accountRef, tabID, tabGeneration, boundAt: now,
    };
    this.byTab.set(tabID, binding);
    this.bySession.set(sessionID, tabID);
    return { ok: true, binding };
  }

  lookup(sessionID: string): SessionBinding | undefined {
    const tabID = this.bySession.get(sessionID);
    if (!tabID) return undefined;
    return this.byTab.get(tabID);
  }

  /** Invalidate binding when the tab is closed. */
  closeTab(tabID: string): boolean {
    const b = this.byTab.get(tabID);
    if (!b) return false;
    this.byTab.delete(tabID);
    this.bySession.delete(b.sessionID);
    return true;
  }

  /** Invalidate when the tab generation changes (replacement). */
  invalidateIfStale(tabID: string, tabGeneration: string): boolean {
    const b = this.byTab.get(tabID);
    if (!b) return false;
    if (b.tabGeneration === tabGeneration) return false;
    this.byTab.delete(tabID);
    this.bySession.delete(b.sessionID);
    return true;
  }

  size(): number { return this.byTab.size; }
  reset(): void { this.byTab.clear(); this.bySession.clear(); }
}
